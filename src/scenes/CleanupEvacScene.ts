import Phaser from 'phaser';

// ─── Data types ──────────────────────────────────────────────

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Monster {
  sprite: Phaser.GameObjects.Rectangle;
  speed: number;
  chaseSpeed: number;
  direction: Phaser.Math.Vector2;
  patrolTimer: number;
  isChasing: boolean;
  visionRange: number;
  visionAngle: number;
  territoryRadius: number;
  homeX: number;
  homeY: number;
  giveUpTimer: number;
  giveUpDuration: number;
  isHunter: boolean;
  stunTimer: number; // 被水枪喷射时的眩晕计时
}

interface Stain {
  x: number;
  y: number;
  radius: number;
  cleanliness: number; // 0-100
  cleaned: boolean;
  sprite: Phaser.GameObjects.Graphics;
  onWall: boolean;
}

interface Loot {
  x: number;
  y: number;
  type: LootType;
  value: number;
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
}

type LootType = 'gold' | 'gem' | 'medkit' | 'shield';

const LOOT_INFO: Record<LootType, { color: number; name: string; label: string }> = {
  gold:    { color: 0xffdd00, name: '金币',  label: '🟡' },
  gem:     { color: 0x44ffff, name: '宝石',  label: '💎' },
  medkit:  { color: 0xff4444, name: '医疗包', label: '🔴' },
  shield:  { color: 0x44aaff, name: '护盾',   label: '🛡' },
};

// 正面掉落表
const POSITIVE_TABLE: { type: LootType; weight: number; value: number }[] = [
  { type: 'gold',   weight: 50, value: 10 },
  { type: 'gem',    weight: 30, value: 50 },
  { type: 'medkit', weight: 15, value: 30 },
  { type: 'shield', weight: 5,  value: 0 },
];

// 负面效果表
type NegativeType = 'spawn_monster' | 'alarm' | 'blind' | 'slow';
const NEGATIVE_TABLE: { type: NegativeType; weight: number }[] = [
  { type: 'spawn_monster', weight: 60 },
  { type: 'alarm',         weight: 20 },
  { type: 'blind',         weight: 15 },
  { type: 'slow',          weight: 5 },
];

// ─── Scene ────────────────────────────────────────────────────

export class CleanupEvacScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;

  // Map
  private mapWidth = 2400;
  private mapHeight = 1600;
  private obstacles: Obstacle[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Fog of war
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'cleanupEvacFog';
  private viewRadius = 180;
  private screenW = 800;
  private screenH = 600;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private stains: Stain[] = [];
  private monsters: Monster[] = [];
  private loots: Loot[] = [];
  private exit!: Phaser.GameObjects.Rectangle;

  // Water gun
  private isSpraying = false;
  private aimAngle = 0;
  private sprayRange = 160;
  private sprayAngle = Math.PI / 6; // 30° half-angle
  private sprayGraphics!: Phaser.GameObjects.Graphics;
  private waterParticles: Phaser.GameObjects.Arc[] = [];

  // Player stats
  private health = 100;
  private score = 0;
  private goalScore = 1000;
  private damageCooldown = 0;
  private hasShield = false;

  // Negative effects
  private blindTimer = 0;
  private slowTimer = 0;
  private alarmTimer = 0;

  // Evacuation
  private isEvacuating = false;
  private evacTimer = 0;
  private evacDuration = 3000;

  // Game state
  private isDead = false;
  private isWon = false;

  // UI
  private healthText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private evacText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'CleanupEvacScene' });
  }

  create() {
    // ── 重置所有实例状态 ──
    this.isDead = false;
    this.isWon = false;
    this.health = 100;
    this.score = 0;
    this.damageCooldown = 0;
    this.hasShield = false;
    this.blindTimer = 0;
    this.slowTimer = 0;
    this.alarmTimer = 0;
    this.isEvacuating = false;
    this.evacTimer = 0;
    this.isSpraying = false;
    this.aimAngle = 0;
    this.stains = [];
    this.monsters = [];
    this.loots = [];
    this.obstacles = [];
    this.waterParticles = [];

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateBuilding();
    this.drawMap();
    this.createPlayer();
    this.createStains();
    this.createMonsters();
    this.createExit();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('用水枪清扫污渍！\n收集价值1000的宝物后到撤离点撤离\n左键喷射，小心怪物！');
    this.time.delayedCall(4000, () => this.hideMessage());
  }

  // ─── Map generation (废弃建筑) ───────────────────────────────

  private generateBuilding() {
    this.obstacles = [];

    // 外墙
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    // 生成房间隔断——网格化房间
    const cols = 4;
    const rows = 3;
    const cellW = this.mapWidth / cols;
    const cellH = this.mapHeight / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const roomX = c * cellW;
        const roomY = r * cellH;

        // 每个房间随机生成1-3面内墙（留缺口做门）
        const walls = Phaser.Math.Between(1, 3);
        for (let i = 0; i < walls; i++) {
          const isHorizontal = Math.random() > 0.5;
          if (isHorizontal) {
            // 水平墙
            const wallY = roomY + cellH * Phaser.Math.FloatBetween(0.3, 0.7);
            const gapStart = cellW * Phaser.Math.FloatBetween(0.1, 0.5);
            const gapW = cellW * Phaser.Math.FloatBetween(0.2, 0.35);
            // 左段
            if (gapStart > 30) {
              this.obstacles.push({ x: roomX + 20, y: wallY, w: gapStart - 20, h: 16 });
            }
            // 右段
            const rightStart = gapStart + gapW;
            const rightW = cellW - rightStart - 20;
            if (rightW > 30) {
              this.obstacles.push({ x: roomX + rightStart, y: wallY, w: rightW, h: 16 });
            }
          } else {
            // 垂直墙
            const wallX = roomX + cellW * Phaser.Math.FloatBetween(0.3, 0.7);
            const gapStart = cellH * Phaser.Math.FloatBetween(0.1, 0.5);
            const gapH = cellH * Phaser.Math.FloatBetween(0.2, 0.35);
            if (gapStart > 30) {
              this.obstacles.push({ x: wallX, y: roomY + 20, w: 16, h: gapStart - 20 });
            }
            const bottomStart = gapStart + gapH;
            const bottomH = cellH - bottomStart - 20;
            if (bottomH > 30) {
              this.obstacles.push({ x: wallX, y: roomY + bottomStart, w: 16, h: bottomH });
            }
          }
        }
      }
    }

    // 随机散落的小障碍物（家具/碎片）
    for (let i = 0; i < 20; i++) {
      const w = Phaser.Math.Between(20, 50);
      const h = Phaser.Math.Between(20, 50);
      const x = Phaser.Math.Between(100, this.mapWidth - 100 - w);
      const y = Phaser.Math.Between(100, this.mapHeight - 100 - h);
      // 避开起点和撤离点
      if (x < 200 && y < 200) continue;
      if (x + w > this.mapWidth - 200 && y + h > this.mapHeight - 200) continue;
      this.obstacles.push({ x, y, w, h });
    }
  }

  private drawMap() {
    this.mapGraphics = this.add.graphics();

    // 地板
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

    // 地板网格
    this.mapGraphics.lineStyle(1, 0x222244, 0.3);
    for (let x = 0; x < this.mapWidth; x += 80) {
      this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += 80) {
      this.mapGraphics.lineBetween(0, y, this.mapWidth, y);
    }

    // 墙壁
    this.mapGraphics.fillStyle(0x3a3a55, 1);
    for (const obs of this.obstacles) {
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
      // 墙边高光
      this.mapGraphics.lineStyle(1, 0x555577, 0.5);
      this.mapGraphics.strokeRect(obs.x, obs.y, obs.w, obs.h);
    }
  }

  // ─── Player ──────────────────────────────────────────────────

  private createPlayer() {
    this.player = this.add.circle(80, 80, 12, 0x00ff00);
    this.player.setStrokeStyle(2, 0xffffff);
    this.player.setDepth(5);
  }

  // ─── Stains (污渍) ──────────────────────────────────────────

  private createStains() {
    const stainCount = 35;
    let placed = 0;
    let attempts = 0;

    while (placed < stainCount && attempts < 1000) {
      const x = Phaser.Math.Between(60, this.mapWidth - 60);
      const y = Phaser.Math.Between(60, this.mapHeight - 60);

      // 避开起点
      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 150) {
        attempts++;
        continue;
      }

      // 不能在障碍物内部
      if (this.isInsideObstacle(x, y, 18)) {
        attempts++;
        continue;
      }

      // 判断是否贴墙（onWall）
      let onWall = false;
      for (const obs of this.obstacles) {
        const closestX = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
        const closestY = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
        const dist = Phaser.Math.Distance.Between(x, y, closestX, closestY);
        if (dist < 25) {
          onWall = true;
          break;
        }
      }

      const radius = Phaser.Math.Between(12, 22);
      const g = this.add.graphics();
      const alpha = 0.7;
      // 污渍颜色——暗红/暗绿/暗棕随机
      const colors = [0x552222, 0x224422, 0x443311, 0x332233];
      const color = Phaser.Utils.Array.GetRandom(colors);

      g.fillStyle(color, alpha);
      // 不规则形状
      g.beginPath();
      const points = 8;
      for (let i = 0; i <= points; i++) {
        const a = (i / points) * Math.PI * 2;
        const r = radius * Phaser.Math.FloatBetween(0.7, 1.1);
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillPath();
      g.setPosition(x, y);
      g.setDepth(2);

      this.stains.push({
        x, y, radius,
        cleanliness: 100,
        cleaned: false,
        sprite: g,
        onWall,
      });
      placed++;
      attempts++;
    }
  }

  // ─── Monsters ───────────────────────────────────────────────

  private createMonsters() {
    const monsterCount = Phaser.Math.Between(4, 6);
    let placed = 0;
    let attempts = 0;

    while (placed < monsterCount && attempts < 500) {
      const x = Phaser.Math.Between(200, this.mapWidth - 200);
      const y = Phaser.Math.Between(200, this.mapHeight - 200);

      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 400) {
        attempts++;
        continue;
      }

      if (!this.isInsideObstacle(x, y, 14)) {
        const isHunter = placed < 2;
        const sprite = this.add.rectangle(x, y, 24, 24, isHunter ? 0xff00ff : 0xff8800);
        sprite.setDepth(5);

        this.monsters.push({
          sprite,
          speed: isHunter ? 40 : 30,
          chaseSpeed: isHunter ? 120 : 90,
          direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
          patrolTimer: Phaser.Math.Between(0, 3000),
          isChasing: false,
          visionRange: isHunter ? 200 : 140,
          visionAngle: Math.PI / 3,
          territoryRadius: isHunter ? 600 : 300,
          homeX: x,
          homeY: y,
          giveUpTimer: 0,
          giveUpDuration: isHunter ? 4000 : 2500,
          isHunter,
          stunTimer: 0,
        });
        placed++;
      }
      attempts++;
    }
  }

  // ─── Exit (撤离点) ──────────────────────────────────────────

  private createExit() {
    this.exit = this.add.rectangle(this.mapWidth - 80, this.mapHeight - 80, 50, 50, 0x00ffff);
    this.exit.setAlpha(0.8);
    this.exit.setDepth(3);

    this.tweens.add({
      targets: this.exit,
      alpha: { from: 0.4, to: 0.9 },
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  // ─── Fog of war ──────────────────────────────────────────────

  private createFog() {
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.screenW;
    this.fogCanvas.height = this.screenH;
    this.fogCtx = this.fogCanvas.getContext('2d')!;

    if (this.textures.exists(this.fogTextureKey)) {
      this.textures.remove(this.fogTextureKey);
    }
    this.textures.addCanvas(this.fogTextureKey, this.fogCanvas);

    this.fogImage = this.add.image(0, 0, this.fogTextureKey);
    this.fogImage.setOrigin(0, 0);
    this.fogImage.setScrollFactor(0);
    this.fogImage.setDepth(10);

    this.drawFog(this.screenW / 2, this.screenH / 2);
  }

  private drawFog(screenX: number, screenY: number) {
    const ctx = this.fogCtx;
    // 致盲时视野更小
    const radius = this.blindTimer > 0 ? this.viewRadius * 0.3 : this.viewRadius;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.94)';
    ctx.fillRect(0, 0, this.screenW, this.screenH);

    ctx.globalCompositeOperation = 'destination-out';
    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, radius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';

    // 手动上传canvas到WebGL纹理
    const renderer = this.game.renderer as any;
    const gl = renderer.gl;
    if (gl) {
      const source = this.fogImage.texture.source[0];
      const glTexture = source.glTexture;
      if (!glTexture) return;
      const webGLTexture = (glTexture as any).webGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, webGLTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fogCanvas);
    }
  }

  private updateFog() {
    const screenX = this.player.x - this.cam.scrollX;
    const screenY = this.player.y - this.cam.scrollY;
    this.drawFog(screenX, screenY);
  }

  // ─── UI ──────────────────────────────────────────────────────

  private createUI() {
    this.healthText = this.add.text(16, 16, '生命: 100', {
      fontSize: '18px', color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.scoreText = this.add.text(16, 40, '价值: 0 / 1000', {
      fontSize: '18px', color: '#ffdd00',
    }).setScrollFactor(0).setDepth(20);

    this.statusText = this.add.text(16, 68, '', {
      fontSize: '14px', color: '#ff8844',
    }).setScrollFactor(0).setDepth(20);

    this.evacText = this.add.text(400, 300, '', {
      fontSize: '32px', color: '#00ff00', align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    this.messageText = this.add.text(400, 500, '', {
      fontSize: '20px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    // 返回菜单按钮 — 用 Rectangle + Text 确保在雾之上可见
    const backBg = this.add.rectangle(730, 30, 110, 30, 0x333333, 0.85)
      .setScrollFactor(0).setDepth(29);
    backBg.setStrokeStyle(2, 0x888888);
    const backBtn = this.add.text(730, 30, '← 菜单', {
      fontSize: '16px', color: '#ffffff',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(30);

    backBtn.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });

    this.updateScoreUI();
  }

  private updateScoreUI() {
    this.scoreText.setText(`价值: ${this.score} / ${this.goalScore}`);
    if (this.score >= this.goalScore) {
      this.scoreText.setColor('#00ff00');
    } else {
      this.scoreText.setColor('#ffdd00');
    }
  }

  private updateStatusUI() {
    const effects: string[] = [];
    if (this.hasShield) effects.push('🛡护盾');
    if (this.blindTimer > 0) effects.push('👁致盲');
    if (this.slowTimer > 0) effects.push('🐌减速');
    if (this.alarmTimer > 0) effects.push('🚨警报');
    this.statusText.setText(effects.join(' '));
  }

  // ─── Input ───────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // 鼠标喷射
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.isSpraying = true;
      }
    });
    this.input.on('pointerup', () => {
      this.isSpraying = false;
    });

    // 喷射图形
    this.sprayGraphics = this.add.graphics();
    this.sprayGraphics.setDepth(7);
  }

  // ─── Update loop ─────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.isDead || this.isWon) {
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
        this.scene.start('MenuScene');
      }
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    // 更新瞄准角度 — 使用 positionToCamera 确保相机偏移正确
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const mouseWorldX = pointer.x + cam.scrollX;
    const mouseWorldY = pointer.y + cam.scrollY;
    this.aimAngle = Math.atan2(mouseWorldY - this.player.y, mouseWorldX - this.player.x);

    this.handlePlayerMovement(delta);
    this.updateSpray(delta);
    this.updateStains(delta);
    this.updateMonsters(delta);
    this.checkLootPickup();
    this.checkMonsterCollision();
    this.updateNegativeEffects(delta);
    this.checkEvacuation(delta);
    this.updateFog();
    this.updateStatusUI();

    if (this.damageCooldown > 0) {
      this.damageCooldown -= delta;
    }
  }

  // ─── Player movement ─────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    const baseSpeed = 160;
    const slowFactor = this.slowTimer > 0 ? 0.5 : 1;
    const speed = baseSpeed * slowFactor;
    const dt = delta / 1000;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) vx -= speed;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) vx += speed;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) vy -= speed;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) vy += speed;

    if (vx !== 0 && vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * speed;
      vy = (vy / len) * speed;
    }

    const halfSize = 11;

    if (vx !== 0) {
      const dx = vx * dt;
      const newX = this.player.x + dx;
      const edgeX = newX + (dx > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(edgeX, this.player.y - halfSize, 0) &&
          !this.isObstacleAt(edgeX, this.player.y + halfSize, 0)) {
        this.player.x = newX;
      }
    }

    if (vy !== 0) {
      const dy = vy * dt;
      const newY = this.player.y + dy;
      const edgeY = newY + (dy > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(this.player.x - halfSize, edgeY, 0) &&
          !this.isObstacleAt(this.player.x + halfSize, edgeY, 0)) {
        this.player.y = newY;
      }
    }

    // 地图边界 clamp — 防止玩家跑出地图
    this.player.x = Phaser.Math.Clamp(this.player.x, 16, this.mapWidth - 16);
    this.player.y = Phaser.Math.Clamp(this.player.y, 16, this.mapHeight - 16);
  }

  // ─── Water gun spray ─────────────────────────────────────────

  private updateSpray(delta: number) {
    const g = this.sprayGraphics;
    g.clear();

    if (!this.isSpraying) return;

    // 绘制锥形喷射区域
    const px = this.player.x;
    const py = this.player.y;
    const a = this.aimAngle;
    const halfAngle = this.sprayAngle;
    const range = this.sprayRange;

    g.fillStyle(0x44aaff, 0.2);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + Math.cos(a - halfAngle) * range, py + Math.sin(a - halfAngle) * range);
    g.lineTo(px + Math.cos(a + halfAngle) * range, py + Math.sin(a + halfAngle) * range);
    g.closePath();
    g.fillPath();

    // 中心水柱
    g.fillStyle(0x88ccff, 0.35);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + Math.cos(a - halfAngle * 0.4) * range, py + Math.sin(a - halfAngle * 0.4) * range);
    g.lineTo(px + Math.cos(a + halfAngle * 0.4) * range, py + Math.sin(a + halfAngle * 0.4) * range);
    g.closePath();
    g.fillPath();

    // 水滴粒子
    if (Math.random() < 0.6) {
      const pa = a + Phaser.Math.FloatBetween(-halfAngle, halfAngle);
      const pdist = Phaser.Math.FloatBetween(20, range);
      const dropX = px + Math.cos(pa) * pdist;
      const dropY = py + Math.sin(pa) * pdist;
      const drop = this.add.circle(dropX, dropY, 3, 0x88ccff, 0.6);
      drop.setDepth(6);
      this.waterParticles.push(drop);

      this.tweens.add({
        targets: drop,
        alpha: 0,
        scale: 0.3,
        duration: 300,
        onComplete: () => {
          drop.destroy();
        },
      });
    }

    // 清理已销毁的粒子引用
    this.waterParticles = this.waterParticles.filter(p => p.active);

    // 水枪击中怪物 → 眩晕 + 击退
    for (const monster of this.monsters) {
      const dx = monster.sprite.x - px;
      const dy = monster.sprite.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > range + 16) continue;

      const monAngle = Math.atan2(dy, dx);
      let diff = Math.abs(monAngle - a);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > halfAngle) continue;

      // 在喷射锥内 → 眩晕2秒 + 击退
      monster.stunTimer = 2000;
      monster.isChasing = false;
      monster.giveUpTimer = 0;

      // 击退
      const klen = dist || 1;
      const knockback = 60 * (delta / 1000);
      const newX = monster.sprite.x + (dx / klen) * knockback;
      const newY = monster.sprite.y + (dy / klen) * knockback;
      if (!this.isObstacleAt(newX, monster.sprite.y, 0)) {
        monster.sprite.x = newX;
      }
      if (!this.isObstacleAt(monster.sprite.x, newY, 0)) {
        monster.sprite.y = newY;
      }
    }
  }

  // ─── Stain cleaning ──────────────────────────────────────────

  private updateStains(delta: number) {
    if (!this.isSpraying) return;

    const px = this.player.x;
    const py = this.player.y;
    const a = this.aimAngle;
    const halfAngle = this.sprayAngle;
    const range = this.sprayRange;
    const cleanPower = 80 * (delta / 1000); // 每秒80

    for (const stain of this.stains) {
      if (stain.cleaned) continue;

      const dx = stain.x - px;
      const dy = stain.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > range + stain.radius) continue;

      // 角度判断
      const stainAngle = Math.atan2(dy, dx);
      let diff = Math.abs(stainAngle - a);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > halfAngle) continue;

      // 在喷射范围内 → 清洁
      stain.cleanliness -= cleanPower;

      // 更新视觉——越干净越淡
      const alpha = Math.max(0, stain.cleanliness / 100) * 0.7;
      stain.sprite.setAlpha(alpha);

      if (stain.cleanliness <= 0) {
        stain.cleaned = true;
        stain.sprite.setVisible(false);
        this.onStainCleaned(stain);
      }
    }
  }

  private onStainCleaned(stain: Stain) {
    // 60% 正面 / 40% 负面
    if (Math.random() < 0.6) {
      this.spawnPositiveLoot(stain.x, stain.y);
    } else {
      this.triggerNegativeEffect(stain.x, stain.y);
    }
  }

  // ─── Loot ───────────────────────────────────────────────────

  private spawnPositiveLoot(x: number, y: number) {
    const totalWeight = POSITIVE_TABLE.reduce((s, e) => s + e.weight, 0);
    let roll = Math.random() * totalWeight;
    let chosen = POSITIVE_TABLE[0];
    for (const entry of POSITIVE_TABLE) {
      roll -= entry.weight;
      if (roll <= 0) {
        chosen = entry;
        break;
      }
    }

    const info = LOOT_INFO[chosen.type];
    const circle = this.add.circle(0, 0, 10, info.color);
    circle.setStrokeStyle(2, 0xffffff);
    const container = this.add.container(x, y, [circle]);
    container.setDepth(4);

    // 发光脉冲
    this.tweens.add({
      targets: circle,
      scale: { from: 0.8, to: 1.3 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    this.loots.push({
      x, y,
      type: chosen.type,
      value: chosen.value,
      collected: false,
      sprite: container,
    });

    this.showMessage(`清扫完成！\n掉落: ${info.name}`);
    this.time.delayedCall(1200, () => this.hideMessage());
  }

  private checkLootPickup() {
    for (const loot of this.loots) {
      if (loot.collected) continue;

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, loot.x, loot.y);
      if (dist < 25) {
        loot.collected = true;
        loot.sprite.setVisible(false);
        this.tweens.killTweensOf(loot.sprite);

        const info = LOOT_INFO[loot.type];
        if (loot.type === 'medkit') {
          this.health = Math.min(100, this.health + 30);
          this.healthText.setText(`生命: ${this.health}`);
          this.showMessage(`拾取 ${info.name}！\n生命+30`);
        } else if (loot.type === 'shield') {
          this.hasShield = true;
          this.showMessage(`拾取 ${info.name}！\n获得护盾`);
        } else {
          this.score += loot.value;
          this.updateScoreUI();
          this.showMessage(`拾取 ${info.name}！\n+${loot.value} 价值`);
        }
        this.time.delayedCall(1000, () => this.hideMessage());
      }
    }
  }

  // ─── Negative effects ───────────────────────────────────────

  private triggerNegativeEffect(x: number, y: number) {
    const totalWeight = NEGATIVE_TABLE.reduce((s, e) => s + e.weight, 0);
    let roll = Math.random() * totalWeight;
    let chosen: NegativeType = 'spawn_monster';
    for (const entry of NEGATIVE_TABLE) {
      roll -= entry.weight;
      if (roll <= 0) {
        chosen = entry.type;
        break;
      }
    }

    switch (chosen) {
      case 'spawn_monster':
        this.spawnMonsterNear(x, y, true);
        this.showMessage('⚠ 清扫触发了怪物！\n一只猎手出现了！');
        break;
      case 'alarm':
        this.alarmTimer = 5000;
        for (const m of this.monsters) {
          m.isChasing = true;
          m.giveUpTimer = 5000;
        }
        this.showMessage('🚨 警报触发！\n所有怪物进入追击状态！');
        break;
      case 'blind':
        this.blindTimer = 4000;
        this.showMessage('👁 清扫溅起刺鼻气体！\n视野暂时缩小！');
        break;
      case 'slow':
        this.slowTimer = 5000;
        this.showMessage('🐌 清扫溅出粘液！\n移动减速！');
        break;
    }
    this.time.delayedCall(1500, () => this.hideMessage());
  }

  private spawnMonsterNear(x: number, y: number, isHunter: boolean) {
    // 在 (x,y) 附近找合法位置
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 100) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Phaser.Math.Between(80, 200);
      const mx = x + Math.cos(angle) * dist;
      const my = y + Math.sin(angle) * dist;

      if (mx > 30 && mx < this.mapWidth - 30 && my > 30 && my < this.mapHeight - 30) {
        if (!this.isInsideObstacle(mx, my, 14)) {
          const sprite = this.add.rectangle(mx, my, 24, 24, isHunter ? 0xff00ff : 0xff8800);
          sprite.setDepth(5);
          sprite.setAlpha(0);
          this.tweens.add({
            targets: sprite,
            alpha: 1,
            duration: 500,
          });

          this.monsters.push({
            sprite,
            speed: isHunter ? 40 : 30,
            chaseSpeed: isHunter ? 120 : 90,
            direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
            patrolTimer: 0,
            isChasing: true,
            visionRange: isHunter ? 200 : 140,
            visionAngle: Math.PI / 3,
            territoryRadius: 9999, // 刷出的怪不回家
            homeX: mx,
            homeY: my,
            giveUpTimer: 4000,
            giveUpDuration: 4000,
            isHunter,
            stunTimer: 0,
          });
          placed = true;
        }
      }
      attempts++;
    }
  }

  private updateNegativeEffects(delta: number) {
    if (this.blindTimer > 0) this.blindTimer -= delta;
    if (this.slowTimer > 0) this.slowTimer -= delta;
    if (this.alarmTimer > 0) this.alarmTimer -= delta;
  }

  // ─── Monster AI ──────────────────────────────────────────────

  private updateMonsters(delta: number) {
    const dt = delta / 1000;

    for (const monster of this.monsters) {
      // 眩晕期间不能移动也不能追击
      if (monster.stunTimer > 0) {
        monster.stunTimer -= delta;
        monster.sprite.setFillStyle(0x666666); // 眩晕时变灰
        continue;
      } else {
        monster.sprite.setFillStyle(monster.isHunter ? 0xff00ff : 0xff8800);
      }

      const distToPlayer = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y, this.player.x, this.player.y
      );

      const canSee = this.monsterCanSeePlayer(monster, distToPlayer);

      if (canSee) {
        monster.isChasing = true;
        monster.giveUpTimer = monster.giveUpDuration;
      } else if (monster.giveUpTimer > 0) {
        monster.giveUpTimer -= delta;
        if (monster.giveUpTimer <= 0) {
          monster.isChasing = false;
        }
      }

      const distFromHome = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y, monster.homeX, monster.homeY
      );
      if (monster.isChasing && distFromHome > monster.territoryRadius) {
        monster.isChasing = false;
        monster.giveUpTimer = 0;
      }

      if (monster.isChasing) {
        const dir = new Phaser.Math.Vector2(
          this.player.x - monster.sprite.x,
          this.player.y - monster.sprite.y
        ).normalize();

        const newX = monster.sprite.x + dir.x * monster.chaseSpeed * dt;
        const newY = monster.sprite.y + dir.y * monster.chaseSpeed * dt;

        if (!this.isObstacleAt(newX, monster.sprite.y, 0)) {
          monster.sprite.x = newX;
        }
        if (!this.isObstacleAt(monster.sprite.x, newY, 0)) {
          monster.sprite.y = newY;
        }
      } else {
        monster.patrolTimer += delta;
        if (monster.patrolTimer > 3000) {
          monster.patrolTimer = 0;
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          monster.direction.set(Math.cos(angle), Math.sin(angle));
        }

        if (distFromHome > monster.territoryRadius * 0.8) {
          const toHome = new Phaser.Math.Vector2(
            monster.homeX - monster.sprite.x, monster.homeY - monster.sprite.y
          ).normalize();
          monster.direction.lerp(toHome, 0.1).normalize();
        }

        const newX = monster.sprite.x + monster.direction.x * monster.speed * dt;
        const newY = monster.sprite.y + monster.direction.y * monster.speed * dt;

        if (!this.isObstacleAt(newX, monster.sprite.y, 0)) {
          monster.sprite.x = newX;
        } else {
          monster.direction.x *= -1;
        }
        if (!this.isObstacleAt(monster.sprite.x, newY, 0)) {
          monster.sprite.y = newY;
        } else {
          monster.direction.y *= -1;
        }
      }
    }
  }

  private monsterCanSeePlayer(monster: Monster, distToPlayer: number): boolean {
    if (distToPlayer > monster.visionRange) return false;

    const proximitySense = 60;

    if (monster.visionAngle > 0 && distToPlayer > proximitySense) {
      const angleToPlayer = Math.atan2(
        this.player.y - monster.sprite.y, this.player.x - monster.sprite.x
      );
      let facingAngle = Math.atan2(monster.direction.y, monster.direction.x);
      if (monster.isChasing) facingAngle = angleToPlayer;

      let diff = Math.abs(angleToPlayer - facingAngle);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > monster.visionAngle) return false;
    }

    if (distToPlayer > proximitySense &&
        this.lineBlockedByObstacle(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y)) {
      return false;
    }

    return true;
  }

  // ─── Combat ─────────────────────────────────────────────────

  private checkMonsterCollision() {
    if (this.damageCooldown > 0) return;

    for (const monster of this.monsters) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, monster.sprite.x, monster.sprite.y
      );

      if (dist < 28) {
        if (this.hasShield) {
          this.hasShield = false;
          this.showMessage('🛡 护盾抵挡了攻击！');
          this.time.delayedCall(1000, () => this.hideMessage());
          this.damageCooldown = 1000;
          // 击退怪物
          const kx = monster.sprite.x - this.player.x;
          const ky = monster.sprite.y - this.player.y;
          const klen = Math.sqrt(kx * kx + ky * ky) || 1;
          monster.sprite.x += (kx / klen) * 40;
          monster.sprite.y += (ky / klen) * 40;
        } else {
          this.health -= 15;
          this.healthText.setText(`生命: ${this.health}`);
          this.damageCooldown = 800;

          // 击退
          const kx = this.player.x - monster.sprite.x;
          const ky = this.player.y - monster.sprite.y;
          const klen = Math.sqrt(kx * kx + ky * ky) || 1;
          this.player.x += (kx / klen) * 20;
          this.player.y += (ky / klen) * 20;

          // 闪烁
          this.player.setFillStyle(0xff0000);
          this.time.delayedCall(200, () => {
            if (!this.isDead) this.player.setFillStyle(0x00ff00);
          });

          if (this.health <= 0) {
            this.die();
          }
        }
        break;
      }
    }
  }

  // ─── Evacuation ──────────────────────────────────────────────

  private checkEvacuation(delta: number) {
    const dist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y, this.exit.x, this.exit.y
    );

    if (dist < 40 && this.score >= this.goalScore) {
      if (this.eKey.isDown || this.isEvacuating) {
        if (!this.isEvacuating) {
          this.isEvacuating = true;
          this.evacTimer = this.evacDuration;
        }
        this.evacTimer -= delta;
        const sec = Math.ceil(this.evacTimer / 1000);
        this.evacText.setText(`撤离中... ${sec}`);

        if (this.evacTimer <= 0) {
          this.win();
        }
      } else {
        this.evacText.setText('按 E 撤离！');
      }
    } else {
      if (this.isEvacuating) {
        this.isEvacuating = false;
        this.evacTimer = 0;
      }
      if (dist < 40 && this.score < this.goalScore) {
        this.evacText.setText(`还需 ${this.goalScore - this.score} 价值`);
      } else {
        this.evacText.setText('');
      }
    }

    // 如果不在撤离点，取消撤离
    if (dist >= 40) {
      this.isEvacuating = false;
    }
  }

  // ─── Collision helpers ────────────────────────────────────────

  private isObstacleAt(px: number, py: number, _halfSize: number): boolean {
    for (const obs of this.obstacles) {
      if (px >= obs.x && px <= obs.x + obs.w && py >= obs.y && py <= obs.y + obs.h) {
        return true;
      }
    }
    return false;
  }

  private isInsideObstacle(x: number, y: number, radius: number): boolean {
    for (const obs of this.obstacles) {
      const closestX = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
      const closestY = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
      const dist = Phaser.Math.Distance.Between(x, y, closestX, closestY);
      if (dist < radius) return true;
    }
    return false;
  }

  private lineBlockedByObstacle(x1: number, y1: number, x2: number, y2: number): boolean {
    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const steps = Math.ceil(dist / 10);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      if (this.isObstacleAt(px, py, 0)) return true;
    }
    return false;
  }

  // ─── End states ──────────────────────────────────────────────

  private die() {
    this.isDead = true;
    this.player.setFillStyle(0x666666);
    this.isSpraying = false;
    this.sprayGraphics.clear();
    this.evacText.setText('');
    this.showMessage(`你死了！\n最终价值: ${this.score}\n\n按ESC返回菜单`);
  }

  private win() {
    this.isWon = true;
    this.exit.setFillStyle(0x00ff00);
    this.evacText.setText('');
    this.showMessage(`🎉 撤离成功！\n最终价值: ${this.score}\n\n按ESC返回菜单`);
  }

  // ─── Message ─────────────────────────────────────────────────

  private showMessage(text: string) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
  }

  private hideMessage() {
    this.messageText.setVisible(false);
  }
}
