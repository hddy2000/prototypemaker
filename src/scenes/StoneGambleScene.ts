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
  stunTimer: number;
  attackCooldown: number;
}

interface Stone {
  x: number;
  y: number;
  radius: number;
  faces: { cleaned: boolean; clueShown: boolean }[];
  fullyRevealed: boolean;
  abandoned: boolean;
  faceSprites: Phaser.GameObjects.Graphics[];
  innerSprite: Phaser.GameObjects.Graphics;
  stoneType: StoneType;
  stoneValue: number;
  cursed: boolean;
  revealStage: number; // 0=未开始, 1=第一面, 2=第二面, 3=完全揭晓
}

type StoneType = 'trash' | 'common' | 'good' | 'rare' | 'legendary' | 'medkit' | 'shield';

interface StoneTier {
  type: StoneType;
  color: number;
  glowColor: number;
  name: string;
  minVal: number;
  maxVal: number;
  weight: number;
  clue1: string;
  clue2: string;
  isUtility: boolean;
}

const STONE_TIERS: StoneTier[] = [
  { type: 'trash',     color: 0x555555, glowColor: 0x666666, name: '废料',   minVal: 5,   maxVal: 15,   weight: 40, clue1: '暗灰色石质…',           clue2: '灰色偏暗，裂纹很多…',     isUtility: false },
  { type: 'common',    color: 0xddccaa, glowColor: 0xddccaa, name: '普通石', minVal: 20,  maxVal: 50,   weight: 25, clue1: '米白色光泽…',           clue2: '白色石质，一般…',         isUtility: false },
  { type: 'good',      color: 0x44dd44, glowColor: 0x44ff44, name: '好玉',   minVal: 80,  maxVal: 150,  weight: 15, clue1: '淡绿色！有戏！',         clue2: '绿色清晰，不错！',       isUtility: false },
  { type: 'rare',      color: 0x00cc44, glowColor: 0x00ff44, name: '极品玉', minVal: 200, maxVal: 500,  weight: 8,  clue1: '绿色明显！感觉很好！',   clue2: '鲜艳绿色！很可能值钱！', isUtility: false },
  { type: 'legendary', color: 0x00ff44, glowColor: 0x00ff88, name: '帝王绿', minVal: 800, maxVal: 1200, weight: 4,  clue1: '浓郁翠绿！可能是极品！', clue2: '帝王色！极品中的极品！', isUtility: false },
  { type: 'medkit',    color: 0xff4444, glowColor: 0xff6666, name: '药石',   minVal: 0,   maxVal: 0,    weight: 5,  clue1: '米白色光泽…',           clue2: '白色石质…',               isUtility: true },
  { type: 'shield',    color: 0x44aaff, glowColor: 0x66ccff, name: '盾石',   minVal: 0,   maxVal: 0,    weight: 3,  clue1: '米白色光泽…',           clue2: '白色石质…',               isUtility: true },
];

const STONE_TIERS_TOTAL_WEIGHT = STONE_TIERS.reduce((s, t) => s + t.weight, 0);
const CURSED_CHANCE = 0.15;

// ─── Constants ─────────────────────────────────────────────
const PLAYER_BASE_SPEED = 160;
const PLAYER_SPRINT_SPEED = 260;
const STAMINA_MAX = 100;
const STAMINA_DRAIN_RATE = 35;
const STAMINA_REGEN_RATE = 20;
const STAMINA_SPRINT_MIN = 5;

const SPRAY_RANGE = 160;
const SPRAY_ANGLE = Math.PI / 12;

// ─── Scene ────────────────────────────────────────────────────

export class StoneGambleScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;

  // Map
  private mapWidth = 2400;
  private mapHeight = 1600;
  private obstacles: Obstacle[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Fog of war
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'stoneGambleFog';
  private viewRadius = 180;
  private screenW = 800;
  private screenH = 600;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private stones: Stone[] = [];
  private monsters: Monster[] = [];
  private exit!: Phaser.GameObjects.Rectangle;

  // Water gun
  private isSpraying = false;
  private aimAngle = 0;
  private sprayGraphics!: Phaser.GameObjects.Graphics;
  private sprayTimer = 0;
  private sprayTarget: Stone | null = null;
  private readonly SPRAY_FACE_DURATION = 800; // ms to clean one face

  // Player stats
  private health = 100;
  private score = 0;
  private goalScore = 1000;
  private damageCooldown = 0;
  private hasShield = false;

  // Sprint & stamina
  private stamina = STAMINA_MAX;
  private isSprinting = false;
  private staminaBar!: Phaser.GameObjects.Graphics;

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
  private clueText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'StoneGambleScene' });
  }

  create() {
    // ── 重置所有实例状态 ──
    this.isDead = false;
    this.isWon = false;
    this.health = 100;
    this.score = 0;
    this.damageCooldown = 0;
    this.hasShield = false;
    this.isEvacuating = false;
    this.evacTimer = 0;
    this.isSpraying = false;
    this.aimAngle = 0;
    this.sprayTimer = 0;
    this.sprayTarget = null;
    this.stones = [];
    this.monsters = [];
    this.obstacles = [];
    this.stamina = STAMINA_MAX;
    this.isSprinting = false;

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateBuilding();
    this.drawMap();
    this.createPlayer();
    this.createStones();
    this.createMonsters();
    this.createExit();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('🎰 赌石撤离！\n\n找到石头，用水枪清洗石皮\n逐步揭晓内部价值——废料还是帝王绿？\n\n左键喷射清洗 | 右键放弃（止损）\nShift疾跑 | 收集价值1000后撤离！\n\n小心：15%的石头是诅咒石，完全揭晓会召唤怪物！');
    this.time.delayedCall(6000, () => this.hideMessage());
  }

  // ─── Map generation ─────────────────────────────────────────

  private generateBuilding() {
    this.obstacles = [];

    // 外墙
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    // 生成房间隔断
    const cols = 4;
    const rows = 3;
    const cellW = this.mapWidth / cols;
    const cellH = this.mapHeight / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const roomX = c * cellW;
        const roomY = r * cellH;

        const walls = Phaser.Math.Between(1, 3);
        for (let i = 0; i < walls; i++) {
          const isHorizontal = Math.random() > 0.5;
          if (isHorizontal) {
            const wallY = roomY + cellH * Phaser.Math.FloatBetween(0.3, 0.7);
            const gapStart = cellW * Phaser.Math.FloatBetween(0.1, 0.5);
            const gapW = cellW * Phaser.Math.FloatBetween(0.2, 0.35);
            if (gapStart > 30) {
              this.obstacles.push({ x: roomX + 20, y: wallY, w: gapStart - 20, h: 16 });
            }
            const rightStart = gapStart + gapW;
            const rightW = cellW - rightStart - 20;
            if (rightW > 30) {
              this.obstacles.push({ x: roomX + rightStart, y: wallY, w: rightW, h: 16 });
            }
          } else {
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

    // 随机散落的小障碍物
    for (let i = 0; i < 20; i++) {
      const w = Phaser.Math.Between(20, 50);
      const h = Phaser.Math.Between(20, 50);
      const x = Phaser.Math.Between(100, this.mapWidth - 100 - w);
      const y = Phaser.Math.Between(100, this.mapHeight - 100 - h);
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

  // ─── Stones ──────────────────────────────────────────────────

  private createStones() {
    const stoneCount = 30;
    let placed = 0;
    let attempts = 0;

    while (placed < stoneCount && attempts < 1000) {
      const x = Phaser.Math.Between(60, this.mapWidth - 60);
      const y = Phaser.Math.Between(60, this.mapHeight - 60);

      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 150) {
        attempts++;
        continue;
      }

      if (this.isInsideObstacle(x, y, 18)) {
        attempts++;
        continue;
      }

      const radius = Phaser.Math.Between(14, 24);
      const tier = this.rollStoneType();
      const stoneValue = tier.isUtility ? 0 : Phaser.Math.Between(tier.minVal, tier.maxVal);
      const cursed = !tier.isUtility && Math.random() < CURSED_CHANCE;

      // 内部石芯
      const innerG = this.add.graphics();
      innerG.setPosition(x, y);
      innerG.setDepth(1.5);
      innerG.fillStyle(tier.color, 1);
      innerG.fillCircle(0, 0, radius * 0.7);
      if (tier.type === 'rare' || tier.type === 'legendary') {
        innerG.fillStyle(tier.glowColor, 0.3);
        innerG.fillCircle(0, 0, radius * 1.0);
      }
      innerG.setAlpha(0);

      // 外皮（3面石皮）
      const dirtColors = [0x3a2a1a, 0x2a2a2a, 0x3a322a, 0x2a1a1a];
      const dirtColor = Phaser.Utils.Array.GetRandom(dirtColors);
      const faceOffset = Math.random() * Math.PI * 2;
      const faceSprites: Phaser.GameObjects.Graphics[] = [];
      const sectorHalf = (Math.PI / 3) * 0.92;
      for (let f = 0; f < 3; f++) {
        const fc = faceOffset + (f * Math.PI * 2 / 3);
        const sa = fc - sectorHalf;
        const ea = fc + sectorHalf;
        const fg = this.add.graphics();
        fg.fillStyle(dirtColor, 0.85);
        fg.beginPath();
        fg.slice(0, 0, radius * 1.1, sa, ea);
        fg.fillPath();
        fg.setPosition(x, y);
        fg.setDepth(2);
        faceSprites.push(fg);
      }

      this.stones.push({
        x, y, radius,
        faces: [
          { cleaned: false, clueShown: false },
          { cleaned: false, clueShown: false },
          { cleaned: false, clueShown: false },
        ],
        fullyRevealed: false,
        abandoned: false,
        faceSprites,
        innerSprite: innerG,
        stoneType: tier.type,
        stoneValue,
        cursed,
        revealStage: 0,
      });
      placed++;
      attempts++;
    }
  }

  private rollStoneType(): StoneTier {
    let roll = Math.random() * STONE_TIERS_TOTAL_WEIGHT;
    for (const tier of STONE_TIERS) {
      roll -= tier.weight;
      if (roll <= 0) return tier;
    }
    return STONE_TIERS[0];
  }

  // ─── Monsters ───────────────────────────────────────────────

  private createMonsters() {
    const monsterCount = 8;
    let placed = 0;
    let attempts = 0;

    while (placed < monsterCount && attempts < 500) {
      const x = Phaser.Math.Between(120, this.mapWidth - 120);
      const y = Phaser.Math.Between(120, this.mapHeight - 120);

      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 400) {
        attempts++;
        continue;
      }

      if (this.isInsideObstacle(x, y, 14)) {
        attempts++;
        continue;
      }

      const sprite = this.add.rectangle(x, y, 24, 24, 0xff00ff);
      sprite.setDepth(5);

      this.monsters.push({
        sprite,
        speed: 40,
        chaseSpeed: 165,
        direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
        patrolTimer: Phaser.Math.Between(0, 3000),
        isChasing: false,
        visionRange: 180,
        visionAngle: Math.PI / 3,
        territoryRadius: 9999,
        homeX: x,
        homeY: y,
        giveUpTimer: 0,
        giveUpDuration: 10000,
        stunTimer: 0,
        attackCooldown: 0,
      });
      placed++;
      attempts++;
    }
  }

  // ─── Exit ────────────────────────────────────────────────────

  private createExit() {
    this.exit = this.add.rectangle(this.mapWidth - 80, this.mapHeight - 80, 50, 50, 0x00ffff);
    this.exit.setAlpha(0.3);
    this.exit.setDepth(3);
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
    const radius = this.viewRadius;

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

    this.clueText = this.add.text(400, 540, '', {
      fontSize: '16px', color: '#ffff00', align: 'center',
      backgroundColor: '#000000aa',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    this.messageText = this.add.text(400, 500, '', {
      fontSize: '20px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    this.staminaBar = this.add.graphics();
    this.staminaBar.setScrollFactor(0).setDepth(20);

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

  private updateHealthUI() {
    const newText = `生命: ${this.health}`;
    if (this.healthText.text !== newText) {
      this.healthText.setText(newText);
      if (this.health <= 30) {
        this.healthText.setColor('#ff4444');
      } else if (this.health <= 60) {
        this.healthText.setColor('#ffaa44');
      } else {
        this.healthText.setColor('#ffffff');
      }
    }
  }

  private updateScoreUI() {
    const newText = `价值: ${this.score} / ${this.goalScore}`;
    if (this.scoreText.text !== newText) {
      this.scoreText.setText(newText);
      if (this.score >= this.goalScore) {
        this.scoreText.setColor('#00ff00');
        this.exit.setAlpha(0.8);
        this.tweens.add({
          targets: this.exit,
          alpha: { from: 0.4, to: 0.9 },
          duration: 1000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.inOut',
        });
      } else {
        this.scoreText.setColor('#ffdd00');
      }
    }
  }

  private updateStatusUI() {
    const effects: string[] = [];
    if (this.hasShield) effects.push('🛡护盾');
    const newText = effects.join(' ');
    if (this.statusText.text !== newText) {
      this.statusText.setText(newText);
    }
  }

  private showMessage(text: string, duration = 3000) {
    this.messageText.setText(text).setVisible(true);
    if (duration < 999999) {
      this.time.delayedCall(duration, () => this.hideMessage());
    }
  }

  private hideMessage() {
    this.messageText.setVisible(false);
  }

  // ─── Input ───────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.isSpraying = true;
      }
      if (pointer.rightButtonDown()) {
        this.tryAbandonStone();
      }
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) {
        this.isSpraying = false;
      }
    });

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

    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const mouseWorldX = pointer.x + cam.scrollX;
    const mouseWorldY = pointer.y + cam.scrollY;
    this.aimAngle = Math.atan2(mouseWorldY - this.player.y, mouseWorldX - this.player.x);

    this.handlePlayerMovement(delta);
    this.updateSpray(delta);
    this.updateStones(delta);
    this.updateMonsters(delta);
    this.checkMonsterCollision();
    this.checkEvacuation(delta);
    this.updateFog();
    this.updateStatusUI();
    this.drawStaminaBar();

    if (this.damageCooldown > 0) {
      this.damageCooldown -= delta;
    }
  }

  // ─── Player movement ─────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    const dt = delta / 1000;

    let dx = 0;
    let dy = 0;
    if (this.cursors.left?.isDown || this.wasdKeys.A.isDown) dx -= 1;
    if (this.cursors.right?.isDown || this.wasdKeys.D.isDown) dx += 1;
    if (this.cursors.up?.isDown || this.wasdKeys.W.isDown) dy -= 1;
    if (this.cursors.down?.isDown || this.wasdKeys.S.isDown) dy += 1;

    const isMoving = dx !== 0 || dy !== 0;
    this.isSprinting = isMoving && this.shiftKey.isDown && this.stamina > STAMINA_SPRINT_MIN;

    if (isMoving) {
      const len = Math.sqrt(dx * dx + dy * dy);
      dx /= len;
      dy /= len;

      const speed = this.isSprinting ? PLAYER_SPRINT_SPEED : PLAYER_BASE_SPEED;
      const newX = this.player.x + dx * speed * dt;
      const newY = this.player.y + dy * speed * dt;

      if (!this.collidesWithObstacle(newX, this.player.y, 12)) {
        this.player.x = newX;
      }
      if (!this.collidesWithObstacle(this.player.x, newY, 12)) {
        this.player.y = newY;
      }

      this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.mapWidth - 20);
      this.player.y = Phaser.Math.Clamp(this.player.y, 20, this.mapHeight - 20);
    }

    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_RATE * dt);
    } else {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * dt);
    }
  }

  private collidesWithObstacle(x: number, y: number, radius: number): boolean {
    for (const obs of this.obstacles) {
      const closestX = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
      const closestY = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
      const dist = Phaser.Math.Distance.Between(x, y, closestX, closestY);
      if (dist < radius) return true;
    }
    return false;
  }

  private isInsideObstacle(x: number, y: number, radius: number): boolean {
    return this.collidesWithObstacle(x, y, radius);
  }

  private drawStaminaBar() {
    this.staminaBar.clear();
    const barX = 16;
    const barY = 92;
    const barW = 150;
    const barH = 12;

    this.staminaBar.fillStyle(0x000000, 0.5);
    this.staminaBar.fillRect(barX, barY, barW, barH);

    const staminaRatio = this.stamina / STAMINA_MAX;
    const color = staminaRatio > 0.5 ? 0x00ff00 : staminaRatio > 0.25 ? 0xffff00 : 0xff0000;
    this.staminaBar.fillStyle(color, 0.8);
    this.staminaBar.fillRect(barX, barY, barW * staminaRatio, barH);

    this.staminaBar.lineStyle(1, 0xffffff, 0.5);
    this.staminaBar.strokeRect(barX, barY, barW, barH);
  }

  // ─── Spray ───────────────────────────────────────────────────

  private updateSpray(delta: number) {
    this.sprayGraphics.clear();

    if (!this.isSpraying) return;

    // 绘制喷射锥形
    this.sprayGraphics.fillStyle(0x4488ff, 0.3);
    this.sprayGraphics.beginPath();
    this.sprayGraphics.moveTo(this.player.x, this.player.y);
    const leftAngle = this.aimAngle - SPRAY_ANGLE;
    const rightAngle = this.aimAngle + SPRAY_ANGLE;
    this.sprayGraphics.lineTo(
      this.player.x + Math.cos(leftAngle) * SPRAY_RANGE,
      this.player.y + Math.sin(leftAngle) * SPRAY_RANGE
    );
    this.sprayGraphics.lineTo(
      this.player.x + Math.cos(rightAngle) * SPRAY_RANGE,
      this.player.y + Math.sin(rightAngle) * SPRAY_RANGE
    );
    this.sprayGraphics.closePath();
    this.sprayGraphics.fillPath();
  }

  // ─── Stones ──────────────────────────────────────────────────

  private updateStones(delta: number) {
    if (!this.isSpraying) {
      this.sprayTimer = 0;
      this.sprayTarget = null;
      this.clueText.setText('');
      return;
    }

    // 找到瞄准的石头
    let targetStone: Stone | null = null;
    let bestDist = Infinity;

    for (const stone of this.stones) {
      if (stone.fullyRevealed || stone.abandoned) continue;

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, stone.x, stone.y);
      if (dist > SPRAY_RANGE + stone.radius) continue;

      const angleToStone = Math.atan2(stone.y - this.player.y, stone.x - this.player.x);
      let angleDiff = Math.abs(angleToStone - this.aimAngle);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      if (angleDiff > SPRAY_ANGLE) continue;

      if (dist < bestDist) {
        bestDist = dist;
        targetStone = stone;
      }
    }

    if (!targetStone) {
      this.sprayTimer = 0;
      this.sprayTarget = null;
      this.clueText.setText('');
      return;
    }

    // 如果换了目标石头，重置计时器
    if (this.sprayTarget !== targetStone) {
      this.sprayTarget = targetStone;
      this.sprayTimer = 0;
    }

    // 累加喷射时间
    this.sprayTimer += delta;

    // 找到当前未清洗的面
    let currentFace = -1;
    for (let i = 0; i < 3; i++) {
      if (!targetStone.faces[i].cleaned) {
        currentFace = i;
        break;
      }
    }
    if (currentFace === -1) return;

    // 显示进度提示
    const tier = STONE_TIERS.find(t => t.type === targetStone.stoneType)!;
    const progress = Math.min(1, this.sprayTimer / this.SPRAY_FACE_DURATION);
    const progressPct = Math.floor(progress * 100);

    if (currentFace === 0) {
      this.clueText.setText(`清洗第1面... ${progressPct}%`);
    } else if (currentFace === 1) {
      this.clueText.setText(`清洗第2面... ${progressPct}%`);
    } else {
      this.clueText.setText(`清洗第3面... ${progressPct}%`);
    }

    // 面皮逐渐变透明（视觉反馈）
    targetStone.faceSprites[currentFace].setAlpha(0.85 - progress * 0.55);

    // 时间到了，完成这一面
    if (this.sprayTimer >= this.SPRAY_FACE_DURATION) {
      this.sprayTimer = 0;

      targetStone.faces[currentFace].cleaned = true;
      targetStone.faceSprites[currentFace].setAlpha(0.15);
      targetStone.revealStage = currentFace + 1;

      // 显示线索
      if (currentFace === 0) {
        this.clueText.setText(`线索1: ${tier.clue1}`);
      } else if (currentFace === 1) {
        this.clueText.setText(`线索2: ${tier.clue2}`);
      } else {
        // 完全揭晓
        targetStone.fullyRevealed = true;
        targetStone.innerSprite.setAlpha(1);
        this.clueText.setText('');

        if (targetStone.cursed) {
          this.showMessage('💀 诅咒石！怪物来了！', 2000);
          this.spawnCursedMonster(targetStone.x, targetStone.y);
        } else if (tier.isUtility) {
          if (tier.type === 'medkit') {
            this.health = Math.min(100, this.health + 30);
            this.showMessage('💊 药石！恢复30生命', 2000);
            this.updateHealthUI();
          } else if (tier.type === 'shield') {
            this.hasShield = true;
            this.showMessage('🛡 盾石！获得护盾', 2000);
          }
        } else {
          this.score += targetStone.stoneValue;
          this.showMessage(`💎 ${tier.name}！价值 +${targetStone.stoneValue}`, 2000);
          this.updateScoreUI();
        }
      }
    }
  }

  private tryAbandonStone() {
    // 找到正在清洗但未完成的石头
    for (const stone of this.stones) {
      if (stone.fullyRevealed || stone.abandoned) continue;
      if (stone.revealStage === 0) continue;

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, stone.x, stone.y);
      if (dist > SPRAY_RANGE + stone.radius + 50) continue;

      // 放弃这块石头
      stone.abandoned = true;
      this.showMessage('✋ 止损！放弃这块石头', 1500);

      // 如果已经洗了面，给一点安慰奖
      if (stone.revealStage > 0 && !stone.cursed) {
        const tier = STONE_TIERS.find(t => t.type === stone.stoneType)!;
        if (!tier.isUtility) {
          const partialValue = Math.floor(stone.stoneValue * 0.3 * (stone.revealStage / 3));
          if (partialValue > 0) {
            this.score += partialValue;
            this.showMessage(`✋ 止损！获得 ${partialValue} 安慰奖`, 1500);
            this.updateScoreUI();
          }
        }
      }
      break;
    }
  }

  private spawnCursedMonster(x: number, y: number) {
    const sprite = this.add.rectangle(x, y, 28, 28, 0xff0000);
    sprite.setDepth(5);
    sprite.setStrokeStyle(2, 0xffff00);

    this.monsters.push({
      sprite,
      speed: 60,
      chaseSpeed: 180,
      direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
      patrolTimer: 0,
      isChasing: true,
      visionRange: 300,
      visionAngle: Math.PI * 2,
      territoryRadius: 9999,
      homeX: x,
      homeY: y,
      giveUpTimer: 15000,
      giveUpDuration: 15000,
      stunTimer: 0,
      attackCooldown: 0,
    });
  }

  // ─── Monsters ───────────────────────────────────────────────

  private updateMonsters(delta: number) {
    const dt = delta / 1000;

    for (const monster of this.monsters) {
      if (monster.stunTimer > 0) {
        monster.stunTimer -= delta;
        continue;
      }

      if (monster.attackCooldown > 0) {
        monster.attackCooldown -= delta;
        continue;
      }

      const distToPlayer = Phaser.Math.Distance.Between(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y);

      // 检测玩家
      if (distToPlayer < monster.visionRange) {
        monster.isChasing = true;
        monster.giveUpTimer = monster.giveUpDuration;
      } else if (monster.isChasing) {
        monster.giveUpTimer -= delta;
        if (monster.giveUpTimer <= 0) {
          monster.isChasing = false;
        }
      }

      // 移动
      if (monster.isChasing) {
        const dx = this.player.x - monster.sprite.x;
        const dy = this.player.y - monster.sprite.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const newX = monster.sprite.x + (dx / len) * monster.chaseSpeed * dt;
          const newY = monster.sprite.y + (dy / len) * monster.chaseSpeed * dt;
          if (!this.collidesWithObstacle(newX, monster.sprite.y, 12)) {
            monster.sprite.x = newX;
          }
          if (!this.collidesWithObstacle(monster.sprite.x, newY, 12)) {
            monster.sprite.y = newY;
          }
        }
      } else {
        // 巡逻
        monster.patrolTimer -= delta;
        if (monster.patrolTimer <= 0) {
          monster.direction = new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize();
          monster.patrolTimer = Phaser.Math.Between(2000, 4000);
        }

        const newX = monster.sprite.x + monster.direction.x * monster.speed * dt;
        const newY = monster.sprite.y + monster.direction.y * monster.speed * dt;

        const distFromHome = Phaser.Math.Distance.Between(newX, newY, monster.homeX, monster.homeY);
        if (distFromHome < 300 && !this.collidesWithObstacle(newX, newY, 12)) {
          monster.sprite.x = newX;
          monster.sprite.y = newY;
        } else {
          monster.direction.negate();
        }
      }
    }
  }

  private checkMonsterCollision() {
    if (this.damageCooldown > 0) return;

    for (const monster of this.monsters) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, monster.sprite.x, monster.sprite.y);
      if (dist < 30) {
        if (this.hasShield) {
          this.hasShield = false;
          this.damageCooldown = 1000;
          this.showMessage('🛡 护盾抵挡！', 1500);
          monster.stunTimer = 2000;
        } else {
          this.health -= 20;
          this.damageCooldown = 1000;
          this.showMessage('💥 被怪物攻击！-20生命', 1500);
          monster.attackCooldown = 1500;
          this.updateHealthUI();

          if (this.health <= 0) {
            this.die('被怪物杀死');
          }
        }
        break;
      }
    }
  }

  // ─── Evacuation ──────────────────────────────────────────────

  private checkEvacuation(delta: number) {
    if (this.score < this.goalScore) {
      this.isEvacuating = false;
      this.evacTimer = 0;
      this.evacText.setText('');
      return;
    }

    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exit.x, this.exit.y);
    if (dist < 40) {
      if (!this.isEvacuating) {
        this.isEvacuating = true;
        this.evacTimer = 0;
      }

      this.evacTimer += delta;
      const remaining = Math.ceil((this.evacDuration - this.evacTimer) / 1000);
      const newText = `撤离中... ${remaining}s`;
      if (this.evacText.text !== newText) {
        this.evacText.setText(newText);
      }

      if (this.evacTimer >= this.evacDuration) {
        this.win();
      }
    } else {
      this.isEvacuating = false;
      this.evacTimer = 0;
      this.evacText.setText('');
    }
  }

  // ─── Game end ────────────────────────────────────────────────

  private die(cause: string) {
    this.isDead = true;
    this.showMessage(`💀 ${cause}\n\n最终价值: ${this.score}\n\n按ESC返回菜单`, 999999);
  }

  private win() {
    this.isWon = true;
    this.showMessage(`🎉 成功撤离！\n\n总价值: ${this.score}\n\n按ESC返回菜单`, 999999);
  }
}
