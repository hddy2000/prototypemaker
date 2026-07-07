import Phaser from 'phaser';

// ── 撕名牌 (Name Tag) 俯视角竞技原型 ──────────────────────────────────────
// 核心机制：每个角色背后有一张名牌，靠近对手背后按空格撕掉对方名牌即淘汰。
// 玩家 vs 5 个 AI，最后存活者获胜。
//
// 关键设计：
// 1. 名牌朝向 = 角色朝向的反面，只有从背后才能撕
// 2. 体力系统：冲刺消耗体力，空了只能慢走（追逃节奏感）
// 3. 被撕后有 2.5 秒无敌逃跑时间（给翻盘机会）
// 4. 道具：护盾(挡一次)、烟雾弹(隐身3秒)、磁铁(吸近处敌人)
// 5. 缩圈：60秒后地图边缘开始收缩，逼迫接触

interface Fighter {
  sprite: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;          // 身体（圆形）
  nameTag: Phaser.GameObjects.Rectangle; // 名牌（在背后）
  nameText: Phaser.GameObjects.Text;     // 名牌上的名字
  facing: Phaser.Math.Vector2;           // 朝向（单位向量）
  speed: number;
  stamina: number;
  maxStamina: number;
  staminaDepleted: boolean;
  alive: boolean;
  invincibleTimer: number;               // 无敌时间(ms)
  shield: boolean;                       // 有护盾？
  stealthTimer: number;                  // 隐身剩余(ms)
  isPlayer: boolean;
  name: string;
  color: number;
  // AI
  aiState: 'wander' | 'chase' | 'flee';
  aiTimer: number;
  aiTargetId: number;
  wanderDir: Phaser.Math.Vector2;
}

interface ItemPickup {
  sprite: Phaser.GameObjects.Container;
  type: 'shield' | 'smoke' | 'magnet';
  x: number;
  y: number;
  collected: boolean;
}

const ARENA_W = 1600;
const ARENA_H = 1200;
const FIGHTER_COUNT = 6;
const BODY_RADIUS = 16;
const NAMETAG_DIST = 22;       // 名牌距身体中心
const NAMETAG_W = 30;
const NAMETAG_H = 20;
const TEAR_RANGE = 48;         // 撕名牌判定距离
const TEAR_ANGLE = Math.PI / 2.6; // 背后扇形角度
const INVINCIBLE_TIME = 2500;
const ITEM_SPAWN_INTERVAL = 8000;

const FIGHTER_COLORS = [0x4488ff, 0xff4444, 0x44dd44, 0xffaa22, 0xbb44ff, 0x22dddd];
const FIGHTER_NAMES = ['你', '红队', '绿队', '橙队', '紫队', '青队'];

export class NameTagScene extends Phaser.Scene {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;

  private fighters: Fighter[] = [];
  private items: ItemPickup[] = [];
  private obstacles: Phaser.GameObjects.Rectangle[] = [];

  private player!: Fighter;
  private playerId = 0;

  // UI
  private staminaText!: Phaser.GameObjects.Text;
  private aliveText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private shieldIcon!: Phaser.GameObjects.Text;
  private smokeIcon!: Phaser.GameObjects.Text;
  private magnetIcon!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;

  // 道具持有
  private playerShield = false;
  private playerSmoke = 0;
  private playerMagnet = 0;

  // 游戏状态
  private gameState: 'playing' | 'won' | 'lost' = 'playing';
  private itemSpawnTimer = 0;
  private shrinkTimer = 0;
  private shrinkRadius = 0;
  private shrinkActive = false;
  private shrinkGraphics!: Phaser.GameObjects.Graphics;
  private elapsed = 0;

  // 撕名牌反馈
  private tearFlash!: Phaser.GameObjects.Rectangle;
  private slowMoTimer = 0;

  constructor() {
    super({ key: 'NameTagScene' });
  }

  create() {
    // 重置所有实例属性（scene.start 复用同一对象）
    this.fighters = [];
    this.items = [];
    this.obstacles = [];
    this.playerShield = false;
    this.playerSmoke = 0;
    this.playerMagnet = 0;
    this.gameState = 'playing';
    this.itemSpawnTimer = 0;
    this.shrinkTimer = 0;
    this.shrinkRadius = 0;
    this.shrinkActive = false;
    this.elapsed = 0;
    this.slowMoTimer = 0;

    // 背景
    this.add.rectangle(ARENA_W / 2, ARENA_H / 2, ARENA_W, ARENA_H, 0x1a1a2e);

    // 网格
    const grid = this.add.graphics();
    grid.lineStyle(1, 0x2a2a4e, 0.5);
    for (let x = 0; x <= ARENA_W; x += 80) {
      grid.lineBetween(x, 0, x, ARENA_H);
    }
    for (let y = 0; y <= ARENA_H; y += 80) {
      grid.lineBetween(0, y, ARENA_W, y);
    }

    // 边界墙
    const wallThick = 40;
    const walls = [
      { x: ARENA_W / 2, y: wallThick / 2, w: ARENA_W, h: wallThick },
      { x: ARENA_W / 2, y: ARENA_H - wallThick / 2, w: ARENA_W, h: wallThick },
      { x: wallThick / 2, y: ARENA_H / 2, w: wallThick, h: ARENA_H },
      { x: ARENA_W - wallThick / 2, y: ARENA_H / 2, w: wallThick, h: ARENA_H },
    ];
    walls.forEach(w => {
      const r = this.add.rectangle(w.x, w.y, w.w, w.h, 0x444466);
      this.obstacles.push(r);
    });

    // 散布障碍物
    const obstacleDefs = [
      { x: 400, y: 300, w: 120, h: 30 },
      { x: 1200, y: 300, w: 30, h: 120 },
      { x: 400, y: 900, w: 30, h: 120 },
      { x: 1200, y: 900, w: 120, h: 30 },
      { x: 800, y: 600, w: 80, h: 80 },
      { x: 250, y: 600, w: 30, h: 200 },
      { x: 1350, y: 600, w: 30, h: 200 },
    ];
    obstacleDefs.forEach(o => {
      const r = this.add.rectangle(o.x, o.y, o.w, o.h, 0x555577);
      this.obstacles.push(r);
    });

    // 缩圈图形
    this.shrinkGraphics = this.add.graphics();
    this.shrinkGraphics.setDepth(5);

    // 创建角色
    this.createFighters();

    // 相机
    this.cameras.main.setBounds(0, 0, ARENA_W, ARENA_H);
    this.cameras.main.setZoom(0.85);
    this.cameras.main.startFollow(this.player.sprite, true, 0.1, 0.1);

    // UI
    this.createUI();

    // 输入
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    // 撕名牌闪屏
    this.tearFlash = this.add.rectangle(400, 300, 800, 600, 0xffffff, 0)
      .setScrollFactor(0).setDepth(100);

    // 初始道具
    this.spawnItem();
    this.spawnItem();
  }

  private createFighters() {
    const positions = [
      { x: 200, y: 200 },
      { x: ARENA_W - 200, y: 200 },
      { x: 200, y: ARENA_H - 200 },
      { x: ARENA_W - 200, y: ARENA_H - 200 },
      { x: ARENA_W / 2, y: 150 },
      { x: ARENA_W / 2, y: ARENA_H - 150 },
    ];

    for (let i = 0; i < FIGHTER_COUNT; i++) {
      const pos = positions[i];
      const container = this.add.container(pos.x, pos.y);
      const color = FIGHTER_COLORS[i];

      // 身体
      const body = this.add.circle(0, 0, BODY_RADIUS, color);
      body.setStrokeStyle(2, 0xffffff, 0.8);

      // 朝向指示（前方小三角）
      const dirIndicator = this.add.triangle(
        0, -BODY_RADIUS - 4,
        { x: -6, y: 0 }, { x: 6, y: 0 }, { x: 0, y: -8 },
        color,
      );

      // 名牌（在背后）
      const nameTag = this.add.rectangle(0, NAMETAG_DIST, NAMETAG_W, NAMETAG_H, 0xffffff, 0.9);
      nameTag.setStrokeStyle(1, 0x333333);
      const nameText = this.add.text(0, NAMETAG_DIST, FIGHTER_NAMES[i], {
        fontSize: '10px', color: '#333333',
      }).setOrigin(0.5);

      container.add([body, dirIndicator, nameTag, nameText]);
      container.setDepth(10);

      const fighter: Fighter = {
        sprite: container,
        body,
        nameTag,
        nameText,
        facing: new Phaser.Math.Vector2(0, -1),
        speed: 160,
        stamina: 100,
        maxStamina: 100,
        staminaDepleted: false,
        alive: true,
        invincibleTimer: 0,
        shield: false,
        stealthTimer: 0,
        isPlayer: i === 0,
        name: FIGHTER_NAMES[i],
        color,
        aiState: 'wander',
        aiTimer: 0,
        aiTargetId: -1,
        wanderDir: new Phaser.Math.Vector2(
          Phaser.Math.FloatBetween(-1, 1),
          Phaser.Math.FloatBetween(-1, 1),
        ).normalize(),
      };

      this.fighters.push(fighter);

      if (i === 0) {
        this.player = fighter;
        this.playerId = i;
      }
    }
  }

  private createUI() {
    this.add.text(10, 10, '撕名牌', {
      fontSize: '20px', color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.staminaText = this.add.text(10, 36, '', {
      fontSize: '14px', color: '#88ff88',
    }).setScrollFactor(0).setDepth(20);

    this.aliveText = this.add.text(10, 56, '', {
      fontSize: '14px', color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.timerText = this.add.text(790, 10, '', {
      fontSize: '16px', color: '#ffaa00',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(20);

    // 道具图标
    this.shieldIcon = this.add.text(10, 76, '', {
      fontSize: '14px', color: '#88ddff',
    }).setScrollFactor(0).setDepth(20);
    this.smokeIcon = this.add.text(10, 94, '', {
      fontSize: '14px', color: '#aaaaaa',
    }).setScrollFactor(0).setDepth(20);
    this.magnetIcon = this.add.text(10, 112, '', {
      fontSize: '14px', color: '#ff88ff',
    }).setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 280, '', {
      fontSize: '32px', color: '#ffffff', align: 'center',
      backgroundColor: '#000000', padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setVisible(false);

    const backBtn = this.add.text(680, 10, '← 菜单', {
      fontSize: '16px', color: '#ffffff', backgroundColor: '#333333',
      padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);
    backBtn.on('pointerdown', () => this.scene.start('MenuScene'));

    this.add.text(400, 585,
      'WASD移动 • 空格撕名牌(需在对手背后) • Shift冲刺 • Q护盾 E烟雾 R磁铁',
      { fontSize: '11px', color: '#666666' },
    ).setOrigin(0.5).setScrollFactor(0).setDepth(20);
  }

  // ── Update Loop ──────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    // 慢动作恢复
    let effectiveDelta = delta;
    if (this.slowMoTimer > 0) {
      this.slowMoTimer -= delta;
      effectiveDelta = delta * 0.3;
    }

    if (this.gameState !== 'playing') {
      this.updateTearFlash(delta);
      return;
    }

    this.elapsed += effectiveDelta;

    // 玩家输入
    this.handlePlayerInput(effectiveDelta);

    // AI
    this.fighters.forEach((f, i) => {
      if (!f.alive || f.isPlayer) return;
      this.updateAI(f, i, effectiveDelta);
    });

    // 通用更新
    this.fighters.forEach((f, i) => {
      if (!f.alive) return;
      this.updateFighterCommon(f, i, effectiveDelta);
    });

    // 撕名牌判定
    this.checkTearAction();

    // 道具
    this.updateItems(effectiveDelta);
    this.checkItemPickup();

    // 缩圈
    this.updateShrink(effectiveDelta);

    // 闪屏
    this.updateTearFlash(delta);

    // 胜负判定
    this.checkWinLoss();

    // UI
    this.updateUI();
  }

  // ── 玩家输入 ─────────────────────────────────────────────────────────────

  private handlePlayerInput(delta: number) {
    const f = this.player;
    if (!f.alive) return;

    const dt = delta / 1000;
    const wantsSprint = this.shiftKey.isDown && !f.staminaDepleted;
    const isMoving = this.cursors.left.isDown || this.cursors.right.isDown ||
                     this.cursors.up.isDown || this.cursors.down.isDown ||
                     this.wasdKeys.A.isDown || this.wasdKeys.D.isDown ||
                     this.wasdKeys.W.isDown || this.wasdKeys.S.isDown;
    const isSprinting = wantsSprint && isMoving && f.stamina > 0;

    // 体力
    if (isSprinting) {
      f.stamina -= 40 * dt;
      if (f.stamina <= 0) { f.stamina = 0; f.staminaDepleted = true; }
    } else {
      f.stamina += 20 * dt;
      if (f.stamina >= f.maxStamina) f.stamina = f.maxStamina;
      if (f.staminaDepleted && f.stamina >= f.maxStamina * 0.3) f.staminaDepleted = false;
    }

    const baseSpeed = f.speed;
    const sprintSpeed = f.speed * 1.7;
    const speed = isSprinting ? sprintSpeed : baseSpeed;

    let vx = 0, vy = 0;
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) vy += 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx /= len; vy /= len;
      f.facing.set(vx, vy);
      this.moveFighter(f, vx * speed * dt, vy * speed * dt);
    }

    // 道具使用
    if (Phaser.Input.Keyboard.JustDown(this.input.keyboard!.addKey('Q')) && this.playerShield) {
      this.playerShield = false;
      f.shield = true;
      this.flashMessage('护盾激活！', '#88ddff', 800);
    }
    if (Phaser.Input.Keyboard.JustDown(this.input.keyboard!.addKey('E')) && this.playerSmoke > 0) {
      this.playerSmoke--;
      f.stealthTimer = 3000;
      f.sprite.setAlpha(0.3);
      this.flashMessage('烟雾弹！隐身3秒', '#aaaaaa', 800);
    }
    if (Phaser.Input.Keyboard.JustDown(this.input.keyboard!.addKey('R')) && this.playerMagnet > 0) {
      this.playerMagnet--;
      this.fighters.forEach(other => {
        if (other !== f && other.alive) {
          const dx = f.sprite.x - other.sprite.x;
          const dy = f.sprite.y - other.sprite.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 400 && dist > 0) {
            const pull = 200;
            this.moveFighter(other, (dx / dist) * pull * 0.5, (dy / dist) * pull * 0.5);
          }
        }
      });
      this.flashMessage('磁铁！拉近敌人', '#ff88ff', 800);
    }
  }

  // ── AI ───────────────────────────────────────────────────────────────────

  private updateAI(f: Fighter, index: number, delta: number) {
    const dt = delta / 1000;
    f.aiTimer -= delta;

    // 找最近的活着的对手
    let nearest: Fighter | null = null;
    let nearestDist = Infinity;
    this.fighters.forEach((other, i) => {
      if (i === index || !other.alive) return;
      const dx = other.sprite.x - f.sprite.x;
      const dy = other.sprite.y - f.sprite.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) { nearestDist = d; nearest = other; }
    });

    // 无敌时逃跑
    if (f.invincibleTimer > 0) {
      f.aiState = 'flee';
    } else if (f.aiTimer <= 0) {
      // 决策
      if (nearest && nearestDist < 200) {
        // 检查能不能撕对方（f 在对方背后）：从 nearest 看向 f 的方向应接近 nearest 背后
        const angleFromTargetToF = Math.atan2(f.sprite.y - nearest.sprite.y, f.sprite.x - nearest.sprite.x);
        const targetBack = Math.atan2(nearest.facing.y, nearest.facing.x) + Math.PI; // 对方背后方向
        let diff = Math.abs(this.angleDiff(angleFromTargetToF, targetBack));
        if (nearestDist < TEAR_RANGE + 10 && diff < TEAR_ANGLE / 2) {
          f.aiState = 'chase';
          f.aiTargetId = this.fighters.indexOf(nearest);
        } else if (Math.random() < 0.6) {
          f.aiState = 'chase';
          f.aiTargetId = this.fighters.indexOf(nearest);
        } else {
          f.aiState = 'wander';
          f.wanderDir.set(
            Phaser.Math.FloatBetween(-1, 1),
            Phaser.Math.FloatBetween(-1, 1),
          ).normalize();
        }
      } else {
        f.aiState = 'wander';
        if (f.aiTimer <= 0) {
          f.wanderDir.set(
            Phaser.Math.FloatBetween(-1, 1),
            Phaser.Math.FloatBetween(-1, 1),
          ).normalize();
        }
      }
      f.aiTimer = Phaser.Math.Between(1000, 3000);
    }

    let vx = 0, vy = 0;
    const speed = f.speed * 0.85; // AI 略慢于玩家

    if (f.aiState === 'chase' && nearest) {
      // 追对手的背后
      const targetBackX = nearest.sprite.x - nearest.facing.x * 30;
      const targetBackY = nearest.sprite.y - nearest.facing.y * 30;
      const dx = targetBackX - f.sprite.x;
      const dy = targetBackY - f.sprite.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) { vx = dx / d; vy = dy / d; }
    } else if (f.aiState === 'flee' && nearest) {
      // 逃离最近的人
      const dx = f.sprite.x - nearest.sprite.x;
      const dy = f.sprite.y - nearest.sprite.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) { vx = dx / d; vy = dy / d; }
    } else {
      // wander
      vx = f.wanderDir.x;
      vy = f.wanderDir.y;
      // 偶尔变向
      if (Math.random() < 0.02) {
        f.wanderDir.set(
          Phaser.Math.FloatBetween(-1, 1),
          Phaser.Math.FloatBetween(-1, 1),
        ).normalize();
      }
    }

    // 避开边界
    const margin = 80;
    if (f.sprite.x < margin) vx = Math.abs(vx);
    if (f.sprite.x > ARENA_W - margin) vx = -Math.abs(vx);
    if (f.sprite.y < margin) vy = Math.abs(vy);
    if (f.sprite.y > ARENA_H - margin) vy = -Math.abs(vy);

    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx /= len; vy /= len;
      f.facing.set(vx, vy);
      this.moveFighter(f, vx * speed * dt, vy * speed * dt);
    }
  }

  // ── 通用更新 ─────────────────────────────────────────────────────────────

  private updateFighterCommon(f: Fighter, _index: number, delta: number) {
    const dt = delta / 1000;

    // 无敌时间
    if (f.invincibleTimer > 0) {
      f.invincibleTimer -= delta;
      // 闪烁
      f.sprite.setAlpha(0.5 + 0.5 * Math.sin(this.elapsed * 0.02));
      if (f.invincibleTimer <= 0) {
        f.sprite.setAlpha(f.stealthTimer > 0 ? 0.3 : 1);
      }
    }

    // 隐身
    if (f.stealthTimer > 0) {
      f.stealthTimer -= delta;
      if (f.stealthTimer <= 0 && f.invincibleTimer <= 0) {
        f.sprite.setAlpha(1);
      }
    }

    // 更新名牌位置（跟随朝向，在背后）
    const backAngle = Math.atan2(f.facing.y, f.facing.x) + Math.PI;
    const tagX = Math.cos(backAngle) * NAMETAG_DIST;
    const tagY = Math.sin(backAngle) * NAMETAG_DIST;
    f.nameTag.setPosition(tagX, tagY);
    f.nameText.setPosition(tagX, tagY);

    // 名牌旋转跟随朝向
    const tagRotation = backAngle + Math.PI / 2;
    f.nameTag.setRotation(tagRotation);
    f.nameText.setRotation(tagRotation);

    // 护盾视觉
    if (f.shield) {
      f.body.setStrokeStyle(3, 0x88ddff, 1);
    } else {
      f.body.setStrokeStyle(2, 0xffffff, 0.8);
    }
  }

  // ── 撕名牌判定 ───────────────────────────────────────────────────────────

  private checkTearAction() {
    if (!Phaser.Input.Keyboard.JustDown(this.spaceKey)) return;
    if (!this.player.alive || this.player.invincibleTimer > 0) return;

    // 找最近的可撕目标
    let bestTarget: Fighter | null = null;
    let bestDist = TEAR_RANGE;

    this.fighters.forEach((other, i) => {
      if (i === this.playerId || !other.alive) return;
      const dx = other.sprite.x - this.player.sprite.x;
      const dy = other.sprite.y - this.player.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > bestDist) return;

      // 检查是否在对方背后：从 other 看向玩家的方向应接近 other 的背后方向
      const angleFromOtherToPlayer = Math.atan2(-dy, -dx);
      const otherBack = Math.atan2(other.facing.y, other.facing.x) + Math.PI;
      const diff = Math.abs(this.angleDiff(angleFromOtherToPlayer, otherBack));
      if (diff < TEAR_ANGLE / 2) {
        bestTarget = other;
        bestDist = dist;
      }
    });

    if (bestTarget) {
      this.tearNameTag(this.player, bestTarget);
    } else {
      // 撕空反馈
      this.flashMessage('没撕到！要在对手背后', '#ff6666', 600);
    }
  }

  private tearNameTag(tearer: Fighter, victim: Fighter) {
    // 护盾抵挡
    if (victim.shield) {
      victim.shield = false;
      this.flashMessage(`${victim.name} 护盾抵挡！`, '#88ddff', 800);
      this.cameras.main.shake(100, 0.005);
      return;
    }

    // 隐身无法被撕
    if (victim.stealthTimer > 0) {
      this.flashMessage(`${victim.name} 隐身中，撕不到！`, '#aaaaaa', 600);
      return;
    }

    // 撕掉！
    victim.alive = false;
    victim.sprite.setVisible(false);

    // 慢动作 + 闪屏
    this.slowMoTimer = 400;
    this.tearFlash.setFillStyle(0xffffff, 0.6);
    this.cameras.main.shake(200, 0.01);
    this.cameras.main.flash(200, 255, 255, 255);

    const isPlayerTearer = tearer.isPlayer;
    const isPlayerVictim = victim.isPlayer;

    if (isPlayerTearer) {
      this.flashMessage(`撕掉 ${victim.name} 的名牌！`, '#ffff00', 1200);
    } else if (isPlayerVictim) {
      this.flashMessage('你的名牌被撕了！', '#ff0000', 2000);
    } else {
      // AI 撕 AI，不显示
    }
  }

  // ── 道具 ─────────────────────────────────────────────────────────────────

  private spawnItem() {
    const types: ('shield' | 'smoke' | 'magnet')[] = ['shield', 'smoke', 'magnet'];
    const type = Phaser.Utils.Array.GetRandom(types);
    const x = Phaser.Math.Between(100, ARENA_W - 100);
    const y = Phaser.Math.Between(100, ARENA_H - 100);

    const container = this.add.container(x, y);
    let icon: Phaser.GameObjects.Text;
    let color: number;
    if (type === 'shield') { color = 0x88ddff; icon = this.add.text(0, 0, '🛡', { fontSize: '20px' }).setOrigin(0.5); }
    else if (type === 'smoke') { color = 0xaaaaaa; icon = this.add.text(0, 0, '💨', { fontSize: '20px' }).setOrigin(0.5); }
    else { color = 0xff88ff; icon = this.add.text(0, 0, '🧲', { fontSize: '20px' }).setOrigin(0.5); }

    const bg = this.add.circle(0, 0, 16, color, 0.3);
    bg.setStrokeStyle(2, color);
    container.add([bg, icon]);
    container.setDepth(8);

    // 浮动动画
    this.tweens.add({
      targets: container,
      y: y - 8,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    this.items.push({ sprite: container, type, x, y, collected: false });
  }

  private updateItems(delta: number) {
    this.itemSpawnTimer += delta;
    if (this.itemSpawnTimer >= ITEM_SPAWN_INTERVAL && this.items.filter(i => !i.collected).length < 4) {
      this.itemSpawnTimer = 0;
      this.spawnItem();
    }
  }

  private checkItemPickup() {
    this.fighters.forEach(f => {
      if (!f.alive) return;
      this.items.forEach(item => {
        if (item.collected) return;
        const dx = item.sprite.x - f.sprite.x;
        const dy = item.sprite.y - f.sprite.y;
        if (Math.sqrt(dx * dx + dy * dy) < BODY_RADIUS + 16) {
          item.collected = true;
          item.sprite.destroy();

          if (f.isPlayer) {
            if (item.type === 'shield') this.playerShield = true;
            else if (item.type === 'smoke') this.playerSmoke++;
            else this.playerMagnet++;
            this.flashMessage(`捡到 ${item.type === 'shield' ? '护盾' : item.type === 'smoke' ? '烟雾弹' : '磁铁'}`, '#ffff88', 600);
          } else {
            // AI 直接使用
            if (item.type === 'shield') f.shield = true;
            else if (item.type === 'smoke') { f.stealthTimer = 3000; f.sprite.setAlpha(0.3); }
            else {
              // AI 磁铁：拉近最近敌人
              this.fighters.forEach(other => {
                if (other !== f && other.alive) {
                  const ddx = f.sprite.x - other.sprite.x;
                  const ddy = f.sprite.y - other.sprite.y;
                  const d = Math.sqrt(ddx * ddx + ddy * ddy);
                  if (d < 400 && d > 0) {
                    this.moveFighter(other, (ddx / d) * 100, (ddy / d) * 100);
                  }
                }
              });
            }
          }
        }
      });
    });
  }

  // ── 缩圈 ─────────────────────────────────────────────────────────────────

  private updateShrink(delta: number) {
    this.shrinkTimer += delta;
    if (this.shrinkTimer > 60000 && !this.shrinkActive) {
      this.shrinkActive = true;
      this.shrinkRadius = Math.max(ARENA_W, ARENA_H) * 0.7;
      this.flashMessage('缩圈开始！', '#ff4444', 1500);
    }

    if (this.shrinkActive) {
      this.shrinkRadius -= 30 * (delta / 1000);
      const cx = ARENA_W / 2;
      const cy = ARENA_H / 2;

      this.shrinkGraphics.clear();
      this.shrinkGraphics.fillStyle(0x000000, 0.5);
      this.shrinkGraphics.fillRect(0, 0, ARENA_W, ARENA_H);
      this.shrinkGraphics.fillStyle(0x000000, 0);
      this.shrinkGraphics.fillCircle(cx, cy, this.shrinkRadius);
      // 用 erase 不行(WebGL)，改用画圈描边
      this.shrinkGraphics.lineStyle(4, 0xff4444, 0.8);
      this.shrinkGraphics.strokeCircle(cx, cy, this.shrinkRadius);

      // 圈外的人持续掉体力
      this.fighters.forEach(f => {
        if (!f.alive) return;
        const dx = f.sprite.x - cx;
        const dy = f.sprite.y - cy;
        if (Math.sqrt(dx * dx + dy * dy) > this.shrinkRadius) {
          f.stamina = Math.max(0, f.stamina - 20 * (delta / 1000));
          if (f.stamina <= 0) {
            // 圈外体力耗尽直接淘汰
            f.alive = false;
            f.sprite.setVisible(false);
            if (f.isPlayer) this.flashMessage('被缩圈淘汰！', '#ff0000', 2000);
          }
        }
      });
    }
  }

  // ── 胜负 ─────────────────────────────────────────────────────────────────

  private checkWinLoss() {
    const aliveCount = this.fighters.filter(f => f.alive).length;
    if (this.player.alive && aliveCount === 1) {
      this.gameState = 'won';
      this.showMessage('🏆 你赢了！', '#ffff00');
    } else if (!this.player.alive) {
      this.gameState = 'lost';
      this.showMessage('💀 你被淘汰了', '#ff4444');
    }
  }

  // ── UI 更新 ──────────────────────────────────────────────────────────────

  private updateUI() {
    const f = this.player;
    this.staminaText.setText(
      `体力: ${Math.ceil(f.stamina)}/${f.maxStamina}` +
      (f.staminaDepleted ? ' (恢复中)' : ' [Shift冲刺]'),
    );
    this.staminaText.setColor(f.staminaDepleted ? '#ff8888' : '#88ff88');

    const alive = this.fighters.filter(ff => ff.alive).length;
    this.aliveText.setText(`存活: ${alive}/${FIGHTER_COUNT}`);

    const mins = Math.floor(this.elapsed / 60000);
    const secs = Math.floor((this.elapsed % 60000) / 1000);
    this.timerText.setText(`${mins}:${secs.toString().padStart(2, '0')}`);

    this.shieldIcon.setText(this.playerShield ? '🛡 护盾 [Q]' : '');
    this.smokeIcon.setText(this.playerSmoke > 0 ? `💨 烟雾×${this.playerSmoke} [E]` : '');
    this.magnetIcon.setText(this.playerMagnet > 0 ? `🧲 磁铁×${this.playerMagnet} [R]` : '');
  }

  // ── 辅助 ─────────────────────────────────────────────────────────────────

  private moveFighter(f: Fighter, dx: number, dy: number) {
    let nx = f.sprite.x + dx;
    let ny = f.sprite.y + dy;

    // 障碍物碰撞（简单 AABB vs 圆心）
    for (const obs of this.obstacles) {
      const ox = obs.x - obs.width / 2;
      const oy = obs.y - obs.height / 2;
      const ow = obs.width;
      const oh = obs.height;
      // X 方向
      if (nx + BODY_RADIUS > ox && nx - BODY_RADIUS < ox + ow &&
          f.sprite.y + BODY_RADIUS > oy && f.sprite.y - BODY_RADIUS < oy + oh) {
        if (dx > 0) nx = ox - BODY_RADIUS;
        else if (dx < 0) nx = ox + ow + BODY_RADIUS;
      }
      // Y 方向
      if (ny + BODY_RADIUS > oy && ny - BODY_RADIUS < oy + oh &&
          nx + BODY_RADIUS > ox && nx - BODY_RADIUS < ox + ow) {
        if (dy > 0) ny = oy - BODY_RADIUS;
        else if (dy < 0) ny = oy + oh + BODY_RADIUS;
      }
    }

    // 边界
    nx = Phaser.Math.Clamp(nx, BODY_RADIUS + 40, ARENA_W - BODY_RADIUS - 40);
    ny = Phaser.Math.Clamp(ny, BODY_RADIUS + 40, ARENA_H - BODY_RADIUS - 40);

    f.sprite.setPosition(nx, ny);
  }

  private angleDiff(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  private flashMessage(text: string, color: string, duration: number) {
    this.messageText.setText(text);
    this.messageText.setColor(color);
    this.messageText.setVisible(true);
    this.messageText.setAlpha(1);
    this.time.delayedCall(duration, () => {
      this.messageText.setVisible(false);
    });
  }

  private showMessage(text: string, color: string) {
    this.messageText.setText(text);
    this.messageText.setColor(color);
    this.messageText.setVisible(true);
    this.messageText.setAlpha(1);
    this.messageText.setFontSize('40px');

    // 3秒后显示重启提示
    this.time.delayedCall(2500, () => {
      this.messageText.setText(text + '\n按空格重新开始 • ESC返回菜单');
      this.messageText.setFontSize('28px');
    });

    // 监听重启
    this.input.keyboard!.once('keydown-SPACE', () => {
      this.scene.restart();
    });
  }

  private updateTearFlash(delta: number) {
    if (this.tearFlash.fillAlpha > 0) {
      this.tearFlash.setFillStyle(0xffffff, Math.max(0, this.tearFlash.fillAlpha - delta / 300));
    }
  }
}
