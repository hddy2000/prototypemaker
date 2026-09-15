import Phaser from 'phaser';

// ─── Data types ──────────────────────────────────────────────

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

type BoxRarity = 'normal' | 'rare' | 'super_rare';

interface BoxRarityConfig {
  name: string;
  color: number;
  borderColor: number;
  size: number;
  maxHp: number;
  weight: number;
  valueRange: [number, number];
  glowColor: number;
}

const BOX_RARITIES: BoxRarityConfig[] = [
  { name: '普通', color: 0x8a6a3a, borderColor: 0xaa8a5a, size: 26, maxHp: 3, weight: 60, valueRange: [10, 50], glowColor: 0x665533 },
  { name: '稀有', color: 0x4488ff, borderColor: 0x66aaff, size: 30, maxHp: 5, weight: 30, valueRange: [100, 300], glowColor: 0x3366cc },
  { name: '超稀有', color: 0xff44ff, borderColor: 0xff88ff, size: 34, maxHp: 8, weight: 10, valueRange: [500, 1000], glowColor: 0xcc33cc },
];

const BOX_RARITY_TOTAL_WEIGHT = BOX_RARITIES.reduce((s, r) => s + r.weight, 0);

interface GameBox {
  x: number;
  y: number;
  rarity: BoxRarity;
  hp: number;
  maxHp: number;
  size: number;
  isOpen: boolean;
  sprite: Phaser.GameObjects.Container;
  crackSprite: Phaser.GameObjects.Graphics;
  glowSprite: Phaser.GameObjects.Graphics;
  value: number;       // 预先掷出的内部物品价值
  isHeld: boolean;     // 是否被玩家手持
  isFlying: boolean;   // 是否正在飞行中
}

interface GroundItem {
  x: number;
  y: number;
  value: number;
  rarity: BoxRarity;
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
}

interface FlyingObject {
  sprite: Phaser.GameObjects.Container;
  vx: number;
  vy: number;
  life: number;
  isBox: boolean;       // true=盒子, false=物品
  box?: GameBox;        // 如果是盒子
  item?: GroundItem;    // 如果是物品
  bounces: number;      // 碰撞计数
  maxBounces: number;   // 最大碰撞次数（盒子=剩余HP, 物品=1）
}

interface Shop {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
}

// ─── Constants ─────────────────────────────────────────────

const PLAYER_BASE_SPEED = 160;
const PLAYER_SPRINT_SPEED = 260;
const STAMINA_MAX = 100;
const STAMINA_DRAIN_RATE = 35;
const STAMINA_REGEN_RATE = 20;
const BOX_PICKUP_RANGE = 50;
const ITEM_PICKUP_RANGE = 40;
const THROW_SPEED = 450;
const THROW_LIFETIME = 2000;
const INVENTORY_SIZE = 4;
const SHOP_RANGE = 60;
const EXTRACTION_RANGE = 50;
const SHOP_COUNT = 3;
const TIMED_DURATION = 180; // 限时模式时长（秒）

// ─── Extraction modes (撤离模式) ───────────────────────────

type ExtractionMode = 'shop_quota' | 'timed' | 'timed_shop' | 'shop_throw' | 'ghost' | 'multi_point';

interface ExtractionModeDef {
  id: ExtractionMode;
  name: string;
  icon: string;
  color: number;
  desc: string;
  available: boolean;
}

// ─── Scene ────────────────────────────────────────────────────

export class BoxSmashScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private fKey!: Phaser.Input.Keyboard.Key;

  // Map
  private mapWidth = 2400;
  private mapHeight = 1600;
  private obstacles: Obstacle[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Fog of war
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'boxSmashFog';
  private viewRadius = 200;
  private screenW = 800;
  private screenH = 600;

  // Game objects
  private boxes: GameBox[] = [];
  private groundItems: GroundItem[] = [];
  private flyingObjects: FlyingObject[] = [];
  private shops: Shop[] = [];

  // Player state
  private heldBox: GameBox | null = null;
  private heldItem: GroundItem | null = null;
  private inventory: (GroundItem | null)[] = [null, null, null, null];
  private totalValue = 0;
  private stamina = STAMINA_MAX;
  private isSprinting = false;

  // Quota & extraction
  private quotaGoal = 0;
  private quotaFulfilled = 0;
  private isQuotaMet = false;
  private isEscaped = false;
  private extractionLabel!: Phaser.GameObjects.Text;

  // Player facing
  private playerFacingAngle = 0;

  // Smash effect
  private smashEffects: { sprite: Phaser.GameObjects.Graphics; life: number }[] = [];

  // UI
  private scoreText!: Phaser.GameObjects.Text;
  private staminaBar!: Phaser.GameObjects.Graphics;
  private heldText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private boxCountText!: Phaser.GameObjects.Text;
  private quotaText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private inventorySlots: Phaser.GameObjects.Container[] = [];
  private inventorySlotBgs: Phaser.GameObjects.Rectangle[] = [];
  private inventorySlotTexts: Phaser.GameObjects.Text[] = [];

  // Timed mode
  private timedRemaining = 0;
  private timedWarned60 = false;
  private timedWarned30 = false;
  private timedWarned10 = false;

  // Throttle
  private fogThrottle = 0;
  private uiThrottle = 0;

  // Sound
  private smashSound!: Phaser.Sound.BaseSound;

  // State
  private isDead = false;

  // Mode selection
  private gameState: 'select' | 'playing' = 'select';
  private extractionMode: ExtractionMode = 'shop_quota';
  private selectContainer!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'BoxSmashScene' });
  }

  create() {
    // ⚠️ 重置所有状态
    this.resetState();

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    // 选择界面需要ESC键
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    this.showModeSelection();
  }

  private resetState() {
    this.obstacles = [];
    this.boxes = [];
    this.groundItems = [];
    this.flyingObjects = [];
    this.shops = [];
    this.smashEffects = [];
    this.heldBox = null;
    this.heldItem = null;
    this.inventory = [null, null, null, null];
    this.totalValue = 0;
    this.quotaGoal = 0;
    this.quotaFulfilled = 0;
    this.isQuotaMet = false;
    this.isEscaped = false;
    this.isDead = false;
    this.isSprinting = false;
    this.stamina = STAMINA_MAX;
    this.playerFacingAngle = 0;
    this.inventorySlots = [];
    this.inventorySlotBgs = [];
    this.inventorySlotTexts = [];
    this.fogThrottle = 0;
    this.uiThrottle = 0;
    this.timedRemaining = 0;
    this.timedWarned60 = false;
    this.timedWarned30 = false;
    this.timedWarned10 = false;
    this.gameState = 'select';
  }

  // ─── Mode Selection (撤离模式选择) ─────────────────────────

  private showModeSelection() {
    this.gameState = 'select';
    this.cam.setScroll(0, 0);

    this.selectContainer = this.add.container(0, 0);
    this.selectContainer.setDepth(500);
    this.selectContainer.setScrollFactor(0);

    const bg = this.add.rectangle(0, 0, this.screenW, this.screenH, 0x000000, 0.92);
    bg.setOrigin(0, 0);
    this.selectContainer.add(bg);

    const title = this.add.text(this.screenW / 2, 55, '📦 砸盒惊魂', {
      fontSize: '32px', color: '#ffaa00', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.selectContainer.add(title);

    const subtitle = this.add.text(this.screenW / 2, 95, '选择撤离方式 — 砸盒子捡物品，想办法安全撤离！', {
      fontSize: '15px', color: '#aaaaaa',
    }).setOrigin(0.5);
    this.selectContainer.add(subtitle);

    const modes: ExtractionModeDef[] = [
      {
        id: 'shop_quota',
        name: '商店配额撤离',
        icon: '🏪',
        color: 0x44aa44,
        desc: '砸盒子捡物品 → 到商店卖货\n达到配额后回入口撤离',
        available: true,
      },
      {
        id: 'timed',
        name: '限时撤离',
        icon: '⏱',
        color: 0x4488ff,
        desc: `${TIMED_DURATION}秒倒计时！砸盒卖货赚多少算多少\n倒计时结束前必须回到入口，否则死亡！`,
        available: true,
      },
      {
        id: 'timed_shop',
        name: '限时·商店撤离',
        icon: '🏪',
        color: 0x00cccc,
        desc: `${TIMED_DURATION}秒倒计时！砸盒卖货赚多少算多少\n任意商店都能直接撤离，不用跑回入口！`,
        available: true,
      },
      {
        id: 'shop_throw',
        name: '商店投掷变现',
        icon: '🎯',
        color: 0xffcc00,
        desc: '砸盒子捡物品 → 直接扔进商店变现！\n达到配额后回入口撤离，扔准点！',
        available: true,
      },
      {
        id: 'ghost',
        name: '幽灵清场',
        icon: '👻',
        color: 0xaa44ff,
        desc: '超时后幽灵追杀，必须跑赢幽灵撤离',
        available: false,
      },
      {
        id: 'multi_point',
        name: '多点撤离',
        icon: '🚪',
        color: 0xff8844,
        desc: '多个撤离点独立变现，全部完成才通关',
        available: false,
      },
    ];

    modes.forEach((m, i) => {
      const x = 130 + (i % 3) * 270;
      const y = 200 + Math.floor(i / 3) * 210;

      const container = this.add.container(x, y);
      container.setDepth(501);
      container.setScrollFactor(0);

      const card = this.add.rectangle(0, 0, 240, 170, m.available ? 0x222244 : 0x1a1a2a, 0.9);
      card.setStrokeStyle(2, m.available ? m.color : 0x444444, 1);
      container.add(card);

      const iconText = this.add.text(-90, -55, m.icon, { fontSize: '30px' }).setOrigin(0.5);
      container.add(iconText);

      const nameText = this.add.text(15, -55, m.name, {
        fontSize: '16px', color: m.available ? '#ffffff' : '#666666', fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      container.add(nameText);

      const descText = this.add.text(0, 5, m.desc, {
        fontSize: '11px', color: m.available ? '#cccccc' : '#555555', align: 'center',
      }).setOrigin(0.5);
      container.add(descText);

      const btnText = this.add.text(0, 60, m.available ? '[ 开始 ]' : '[ 开发中 ]', {
        fontSize: '15px', color: m.available ? '#ffff00' : '#555555',
      }).setOrigin(0.5);
      container.add(btnText);

      if (m.available) {
        card.setInteractive({ useHandCursor: true });
        card.on('pointerover', () => { card.setFillStyle(0x333366, 0.95); });
        card.on('pointerout', () => { card.setFillStyle(0x222244, 0.9); });
        card.on('pointerdown', () => {
          this.extractionMode = m.id;
          this.startGame();
        });
      }

      this.selectContainer.add(container);
    });

    const hint = this.add.text(this.screenW / 2, 560, '点击选择撤离方式开始游戏 | ESC 返回菜单', {
      fontSize: '14px', color: '#666666',
    }).setOrigin(0.5);
    this.selectContainer.add(hint);
  }

  private startGame() {
    this.selectContainer.destroy();

    // 重新重置游戏状态（resetState不改extractionMode）
    this.resetState();
    this.gameState = 'playing';

    this.generateBuilding();
    this.drawMap();
    this.createPlayer();
    this.createBoxes();
    this.createShops();
    this.createExtractionZone();
    this.calculateQuota();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    // 音效
    this.smashSound = this.sound.add('boxSmash', { volume: 0.5 });

    // 模式专属初始化
    if (this.extractionMode === 'timed' || this.extractionMode === 'timed_shop') {
      this.timedRemaining = TIMED_DURATION;
      this.quotaText.setVisible(false);
      this.timerText.setVisible(true);
      if (this.extractionMode === 'timed_shop') {
        this.showMessage('⏱ 限时·商店撤离\n\n' + TIMED_DURATION + '秒倒计时开始！\n砸盒子 → 捡物品 → 商店卖货\n赚多少算多少，任意商店可撤离！\n⚠️ 倒计时结束前到不了任何商店 = 死亡！\n\nE = 商店卖货 | F = 商店撤离\n左键捡/敲 | 右键扔 | Q放下', 6000);
      } else {
        this.showMessage('⏱ 限时撤离\n\n' + TIMED_DURATION + '秒倒计时开始！\n砸盒子 → 捡物品 → 商店卖货\n赚多少算多少，随时可回入口撤离\n⚠️ 倒计时结束前回不了入口 = 死亡！\n\n左键捡/敲 | 右键扔 | Q放下 | E卖货/撤离', 6000);
      }
    } else if (this.extractionMode === 'shop_throw') {
      this.showMessage('🎯 商店投掷变现\n\n砸盒子 → 捡物品 → 右键扔进商店变现！\n物品飞进商店范围 = 直接变现\n达到配额后回入口撤离！\n\n左键捡/敲 | 右键扔 | Q放下 | E入口撤离', 6000);
    } else {
      this.showMessage('📦 砸盒惊魂 — ' + this.getModeName() + '\n\n砸盒子 → 捡物品 → 到商店卖货\n达到配额后回入口撤离！\n\n左键 = 捡起/敲击 | 右键 = 扔出 | Q = 放下\nE = 商店卖货/入口撤离 | 1234 = 切换背包\n\nShift 疾跑 | ESC 返回菜单', 6000);
    }
  }

  private getModeName(): string {
    switch (this.extractionMode) {
      case 'shop_quota': return '商店配额撤离';
      case 'timed': return '限时撤离';
      case 'timed_shop': return '限时·商店撤离';
      case 'shop_throw': return '商店投掷变现';
      case 'ghost': return '幽灵清场';
      case 'multi_point': return '多点撤离';
    }
  }

  // ─── Map generation (废弃建筑, 同赌石撤离风格) ───────────────

  private generateBuilding() {
    this.obstacles = [];

    // 外墙
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    // 网格化房间隔断
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

    // 随机散落的小障碍物（家具/碎片）
    for (let i = 0; i < 25; i++) {
      const w = Phaser.Math.Between(20, 50);
      const h = Phaser.Math.Between(20, 50);
      const x = Phaser.Math.Between(100, this.mapWidth - 100 - w);
      const y = Phaser.Math.Between(100, this.mapHeight - 100 - h);
      if (x < 200 && y < 200) continue;
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

  // ─── Player ─────────────────────────────────────────────────

  private createPlayer() {
    this.playerShadow = this.add.ellipse(80, 92, 28, 14, 0x000000, 0.3);
    this.playerShadow.setDepth(4);
    this.player = this.add.circle(80, 80, 12, 0x00ff88);
    this.player.setStrokeStyle(2, 0xffffff);
    this.player.setDepth(5);
  }

  // ─── Boxes ──────────────────────────────────────────────────

  private createBoxes() {
    const boxCount = 30;
    let placed = 0;
    let attempts = 0;

    while (placed < boxCount && attempts < 1000) {
      attempts++;
      const x = Phaser.Math.Between(100, this.mapWidth - 100);
      const y = Phaser.Math.Between(100, this.mapHeight - 100);

      // 避开起点
      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 150) continue;

      // 不能在障碍物内部
      if (this.isInsideObstacle(x, y, 20)) continue;

      // 避开已有盒子
      let tooClose = false;
      for (const b of this.boxes) {
        if (Phaser.Math.Distance.Between(x, y, b.x, b.y) < 80) { tooClose = true; break; }
      }
      if (tooClose) continue;

      // 随机稀有度
      const rarity = this.rollRarity();
      const cfg = this.getRarityConfig(rarity);

      // 预先掷出价值
      const value = Phaser.Math.Between(cfg.valueRange[0], cfg.valueRange[1]);

      this.spawnBox(x, y, rarity, value);
      placed++;
    }
  }

  private rollRarity(): BoxRarity {
    let roll = Phaser.Math.Between(1, BOX_RARITY_TOTAL_WEIGHT);
    for (let i = 0; i < BOX_RARITIES.length; i++) {
      roll -= BOX_RARITIES[i].weight;
      if (roll <= 0) {
 return i === 0 ? 'normal' : i === 1 ? 'rare' : 'super_rare';
      }
    }
    return 'normal';
  }

  private rarityName(rarity: BoxRarity): string {
    if (rarity === 'normal') return '普通';
    if (rarity === 'rare') return '稀有';
    return '超稀有';
  }

  private getRarityConfig(rarity: BoxRarity): BoxRarityConfig {
    if (rarity === 'normal') return BOX_RARITIES[0];
    if (rarity === 'rare') return BOX_RARITIES[1];
    return BOX_RARITIES[2];
  }

  private spawnBox(x: number, y: number, rarity: BoxRarity, value: number): GameBox {
    const cfg = this.getRarityConfig(rarity);

    const container = this.add.container(x, y);
    container.setDepth(5);

    // 盒子主体
    const body = this.add.rectangle(0, 0, cfg.size, cfg.size, cfg.color, 1);
    body.setStrokeStyle(2, cfg.borderColor);
    container.add(body);

    // 盒子顶盖线
    const lid = this.add.rectangle(0, -cfg.size * 0.3, cfg.size, 3, cfg.borderColor, 0.8);
    container.add(lid);

    // 稀有度发光（超稀有有脉动光晕）
    const glow = this.add.graphics();
    glow.fillStyle(cfg.glowColor, 0.15);
    glow.fillCircle(0, 0, cfg.size * 0.8);
    glow.setDepth(4.5);
    container.add(glow);

    // 裂纹图层
    const crack = this.add.graphics();
    crack.setDepth(5.5);
    container.add(crack);

    const box: GameBox = {
      x, y,
      rarity,
      hp: cfg.maxHp,
      maxHp: cfg.maxHp,
      size: cfg.size,
      isOpen: false,
      sprite: container,
      crackSprite: crack,
      glowSprite: glow,
      value,
      isHeld: false,
      isFlying: false,
    };

    this.boxes.push(box);
    return box;
  }

  private drawBoxCracks(box: GameBox) {
    box.crackSprite.clear();
    const ratio = 1 - box.hp / box.maxHp;
    if (ratio < 0.01) return;

    box.crackSprite.lineStyle(2, 0x000000, 0.8);
    const s = box.size / 2;
    const cracks = Math.floor(ratio * 6) + 1;
    for (let i = 0; i < cracks; i++) {
      const a = (i / cracks) * Math.PI * 2 + ratio * 0.5;
      box.crackSprite.beginPath();
      box.crackSprite.moveTo(0, 0);
      box.crackSprite.lineTo(Math.cos(a) * s * 0.85, Math.sin(a) * s * 0.85);
      box.crackSprite.strokePath();
    }

    // HP低于一半时加更多裂纹
    if (ratio > 0.5) {
      box.crackSprite.lineStyle(1, 0x220000, 0.6);
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = s * 0.5 * Math.random();
        box.crackSprite.beginPath();
        box.crackSprite.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        box.crackSprite.lineTo(Math.cos(a + 0.5) * s * 0.7, Math.sin(a + 0.5) * s * 0.7);
        box.crackSprite.strokePath();
      }
    }
  }

  // ─── Shops (商店) ───────────────────────────────────────────

  private createShops() {
    let placed = 0;
    let attempts = 0;

    while (placed < SHOP_COUNT && attempts < 1000) {
      attempts++;
      const x = Phaser.Math.Between(200, this.mapWidth - 200);
      const y = Phaser.Math.Between(200, this.mapHeight - 200);

      // 避开起点
      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 200) continue;

      // 不能在障碍物内部
      if (this.isInsideObstacle(x, y, 30)) continue;

      // 避开已有商店
      let tooClose = false;
      for (const s of this.shops) {
        if (Phaser.Math.Distance.Between(x, y, s.x, s.y) < 300) { tooClose = true; break; }
      }
      if (tooClose) continue;

      this.spawnShop(x, y);
      placed++;
    }
  }

  private spawnShop(x: number, y: number) {
    const container = this.add.container(x, y);
    container.setDepth(5);

    // 商店主体（柜台）
    const body = this.add.rectangle(0, 0, 40, 30, 0x2a6a2a, 1);
    body.setStrokeStyle(2, 0x44aa44);
    container.add(body);

    // 商店标记（$符号）
    const sign = this.add.text(0, 0, '$', {
      fontSize: '20px', color: '#ffdd00', fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(sign);

    // 商店光晕
    const glow = this.add.graphics();
    glow.fillStyle(0x44aa44, 0.15);
    glow.fillCircle(0, 0, 30);
    container.add(glow);
    container.sendToBack(glow);

    // 商店标签
    const label = this.add.text(x, y - 30, '商店', {
      fontSize: '12px', color: '#44ff44', backgroundColor: '#000000',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(6);

    this.shops.push({ x, y, sprite: container, label });
  }

  // ─── Extraction zone (撤离点/入口) ─────────────────────────

  private createExtractionZone() {
    // 入口在起点附近（左上角）
    const x = 80;
    const y = 80;

    const container = this.add.container(x, y);
    container.setDepth(4);

    // 撤离区光圈
    const ring = this.add.graphics();
    ring.lineStyle(3, 0x00ff88, 0.8);
    ring.strokeCircle(0, 0, EXTRACTION_RANGE);
    ring.fillStyle(0x00ff88, 0.1);
    ring.fillCircle(0, 0, EXTRACTION_RANGE);
    container.add(ring);

    this.extractionLabel = this.add.text(x, y - EXTRACTION_RANGE - 15, '入口', {
      fontSize: '14px', color: '#00ff88', backgroundColor: '#000000',
      padding: { x: 6, y: 3 },
    }).setOrigin(0.5).setDepth(6);
  }

  // ─── Quota (配额) ──────────────────────────────────────────

  private calculateQuota() {
    // 配额 = 全图所有盒子内部物品价值总和 × 0.7
    let totalBoxValue = 0;
    for (const b of this.boxes) {
      totalBoxValue += b.value;
    }
    this.quotaGoal = Math.floor(totalBoxValue * 0.7);
  }

  // ─── Selling (商店卖货) ────────────────────────────────────

  private findNearestShop(): Shop | null {
    let nearestShop: Shop | null = null;
    let best = SHOP_RANGE;
    for (const s of this.shops) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
      if (d < best) { best = d; nearestShop = s; }
    }
    return nearestShop;
  }

  // 单个物品变现（投掷进商店用）
  private cashInItem(item: GroundItem) {
    const value = item.value;
    this.quotaFulfilled += value;
    this.totalValue += value;
    item.sprite.destroy();
    item.label.destroy();
    this.createSmashEffect(item.x, item.y);
    this.updateUI();

    // 检查配额（同商店配额模式）
    if (!this.isQuotaMet && this.quotaFulfilled >= this.quotaGoal) {
      this.isQuotaMet = true;
      this.showMessage(`🎉 配额达成！\n已变现 ${this.quotaFulfilled} / ${this.quotaGoal}\n快回入口撤离！`, 4000);
      this.extractionLabel.setText('🚪 撤离！');
    } else {
      this.showMessage(`💰 扔进商店变现 +${value}\n已变现 ${this.quotaFulfilled} / ${this.quotaGoal}`, 1500);
    }
  }

  private trySellAtShop() {
    // 找到最近的商店
    const nearestShop = this.findNearestShop();
    if (!nearestShop) return;

    // 计算手上+背包所有物品价值
    let sellValue = 0;
    let sellCount = 0;

    // 手上物品
    if (this.heldItem) {
      sellValue += this.heldItem.value;
      sellCount++;
      this.heldItem.sprite.destroy();
      this.heldItem.label.destroy();
      this.heldItem = null;
    }

    // 背包物品
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const item = this.inventory[i];
      if (item) {
        sellValue += item.value;
        sellCount++;
        item.sprite.destroy();
        item.label.destroy();
        this.inventory[i] = null;
      }
    }

    if (sellCount === 0) {
      this.showMessage('没有可卖的物品！', 1500);
      return;
    }

    // 变现
    this.quotaFulfilled += sellValue;
    this.totalValue += sellValue;
    this.updateUI();
    this.drawInventoryUI();

    // 检查配额（限时模式无配额概念）
    if (this.extractionMode === 'timed' || this.extractionMode === 'timed_shop') {
      this.showMessage(`💰 卖出 ${sellCount} 件物品 +${sellValue}\n总价值 ${this.totalValue}`, 2000);
    } else if (!this.isQuotaMet && this.quotaFulfilled >= this.quotaGoal) {
      this.isQuotaMet = true;
      this.showMessage(`🎉 配额达成！\n已卖 ${this.quotaFulfilled} / ${this.quotaGoal}\n快回入口撤离！`, 4000);
      // 撤离点变绿脉动
      this.extractionLabel.setText('🚪 撤离！');
    } else {
      this.showMessage(`💰 卖出 ${sellCount} 件物品\n+${sellValue} 价值\n已卖 ${this.quotaFulfilled} / ${this.quotaGoal}`, 2500);
    }
  }

  // ─── Extraction (撤离) ─────────────────────────────────────

  // 未卖出物品（手上+背包）的总价值，撤离时一并带出
  private getUnsoldValue(): number {
    let v = 0;
    if (this.heldItem) v += this.heldItem.value;
    for (const it of this.inventory) {
      if (it) v += it.value;
    }
    return v;
  }

  private tryExtract() {
    // 限时·商店撤离：任意商店或入口都可撤离
    if (this.extractionMode === 'timed_shop') {
      const atShop = this.findNearestShop() !== null;
      const atEntrance = Phaser.Math.Distance.Between(this.player.x, this.player.y, 80, 80) < EXTRACTION_RANGE;
      if (!atShop && !atEntrance) return;
      this.isEscaped = true;
      const unsold = this.getUnsoldValue();
      const finalValue = this.totalValue + unsold;
      const timeLeft = Math.max(0, Math.ceil(this.timedRemaining));
      this.showMessage(`🎊 从${atShop ? '商店' : '入口'}成功撤离！\n卖出: ${this.totalValue} | 带出: ${unsold}\n总价值: ${finalValue}\n剩余时间: ${timeLeft}秒\n\n按ESC返回菜单`, 999999);
      return;
    }

    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, 80, 80);
    if (d > EXTRACTION_RANGE) return;

    // 限时模式：随时可撤离（赚多少算多少）
    if (this.extractionMode === 'timed') {
      this.isEscaped = true;
      this.extractionLabel.setText('✅ 已撤离');
      const unsold = this.getUnsoldValue();
      const finalValue = this.totalValue + unsold;
      const timeLeft = Math.max(0, Math.ceil(this.timedRemaining));
      this.showMessage(`🎊 成功撤离！\n卖出: ${this.totalValue} | 带出: ${unsold}\n总价值: ${finalValue}\n剩余时间: ${timeLeft}秒\n\n按ESC返回菜单`, 999999);
      return;
    }

    // 商店配额模式：必须达成配额
    if (!this.isQuotaMet) {
      this.showMessage('配额未达成，不能撤离！\n去商店卖货吧', 2000);
      return;
    }

    // 撤离成功
    this.isEscaped = true;
    this.extractionLabel.setText('✅ 已撤离');
    this.showMessage(`🎊 撤离成功！\n总价值: ${this.totalValue}\n配额: ${this.quotaFulfilled} / ${this.quotaGoal}\n\n按ESC返回菜单`, 999999);
  }

  // ─── Timed countdown (限时模式倒计时) ──────────────────────

  private updateTimedCountdown(delta: number) {
    this.timedRemaining -= delta / 1000;

    // 阶段警告
    if (!this.timedWarned60 && this.timedRemaining <= 60) {
      this.timedWarned60 = true;
      this.showMessage('⏱ 还剩 60 秒！\n准备回入口撤离！', 2500);
    }
    if (!this.timedWarned30 && this.timedRemaining <= 30) {
      this.timedWarned30 = true;
      this.showMessage('⚠️ 还剩 30 秒！\n快回入口！', 2500);
    }
    if (!this.timedWarned10 && this.timedRemaining <= 10) {
      this.timedWarned10 = true;
      this.showMessage('🚨 10秒！跑！！', 2000);
    }

    // 倒计时归零 → 死亡
    if (this.timedRemaining <= 0) {
      this.timedRemaining = 0;
      this.isDead = true;
      this.showMessage(`💀 时间耗尽！\n没能赶回入口，被困在黑暗中…\n总价值: ${this.totalValue}\n\n按ESC返回菜单`, 999999);
    }
  }

  // ─── Fog of war (同盲盒赌局风格) ────────────────────────────

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
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.fillRect(0, 0, this.screenW, this.screenH);

    // 圆形视野
    ctx.globalCompositeOperation = 'destination-out';
    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, radius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.6, 'rgba(0, 0, 0, 1)');
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
    // 返回菜单按钮
    const backBtn = this.add.text(680, 16, '← 菜单', {
      fontSize: '18px', color: '#ffffff', backgroundColor: '#333333',
      padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);
    backBtn.on('pointerdown', () => this.scene.start('MenuScene'));

    this.scoreText = this.add.text(16, 16, '💰 总价值: 0', {
      fontSize: '18px', color: '#ffdd00',
    }).setScrollFactor(0).setDepth(20);

    this.boxCountText = this.add.text(16, 40, '📦 剩余盒子: 0', {
      fontSize: '14px', color: '#aaaaaa',
    }).setScrollFactor(0).setDepth(20);

    this.quotaText = this.add.text(16, 60, '📋 配额: 0 / 0', {
      fontSize: '14px', color: '#ff8844',
    }).setScrollFactor(0).setDepth(20);

    // 限时模式计时器（顶部中央，默认隐藏）
    this.timerText = this.add.text(400, 20, '', {
      fontSize: '28px', color: '#ff4444', fontStyle: 'bold',
      backgroundColor: '#000000', padding: { x: 12, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(25).setVisible(false);

    this.heldText = this.add.text(16, 80, '', {
      fontSize: '16px', color: '#ffffff', backgroundColor: '#222244',
      padding: { x: 6, y: 3 },
    }).setScrollFactor(0).setDepth(20);

    this.staminaBar = this.add.graphics();
    this.staminaBar.setScrollFactor(0).setDepth(20);

    this.hintText = this.add.text(400, 560, '', {
      fontSize: '14px', color: '#ffffff', backgroundColor: '#000000',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 300, '', {
      fontSize: '20px', color: '#ffff00', backgroundColor: '#000000',
      padding: { x: 16, y: 8 }, align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setVisible(false);

    // 背包格子 UI
    const slotSize = 44;
    const slotGap = 4;
    const invStartX = 16;
    const invY = 110;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const sx = invStartX + i * (slotSize + slotGap);
      const container = this.add.container(sx, invY);
      container.setScrollFactor(0).setDepth(20);

      const bg = this.add.rectangle(slotSize / 2, slotSize / 2, slotSize, slotSize, 0x222244, 0.8);
      bg.setStrokeStyle(1, 0x4466aa, 0.6);
      container.add(bg);

      const numText = this.add.text(2, 0, String(i + 1), {
        fontSize: '10px', color: '#6688cc',
      });
      container.add(numText);

      const itemText = this.add.text(slotSize / 2, slotSize / 2, '', {
        fontSize: '11px', color: '#ffdd00', align: 'center',
      }).setOrigin(0.5);
      container.add(itemText);

      this.inventorySlots.push(container);
      this.inventorySlotBgs.push(bg);
      this.inventorySlotTexts.push(itemText);
    }

    this.add.text(400, 585, 'WASD 移动 | 左键捡/敲 | 右键扔 | Q 放下 | E 卖货/撤离 | 1234 切换 | Shift 疾跑 | ESC 菜单', {
      fontSize: '12px', color: '#666666',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
  }

  private messageTimer: Phaser.Time.TimerEvent | null = null;

  private showMessage(text: string, duration = 3000) {
    // 取消上一条消息的自动隐藏计时器
    if (this.messageTimer) {
      this.messageTimer.remove();
      this.messageTimer = null;
    }
    this.messageText.setText(text).setVisible(true);
    if (duration < 999999) {
      this.messageTimer = this.time.delayedCall(duration, () => this.hideMessage());
    }
  }

  private hideMessage() {
    this.messageText.setVisible(false);
  }

  private updateUI() {
    const scoreStr = `💰 总价值: ${this.totalValue}`;
    if (this.scoreText.text !== scoreStr) this.scoreText.setText(scoreStr);

    const remaining = this.boxes.filter(b => !b.isOpen).length;
    const boxStr = `📦 剩余盒子: ${remaining}`;
    if (this.boxCountText.text !== boxStr) this.boxCountText.setText(boxStr);

    const quotaStr = this.isQuotaMet
      ? `📋 配额: ${this.quotaFulfilled} / ${this.quotaGoal} ✅ 回入口撤离！`
      : `📋 配额: ${this.quotaFulfilled} / ${this.quotaGoal}`;
    if (this.quotaText.text !== quotaStr) {
      this.quotaText.setText(quotaStr);
      this.quotaText.setColor(this.isQuotaMet ? '#44ff44' : '#ff8844');
    }

    // 限时模式：计时器显示
    if (this.extractionMode === 'timed' || this.extractionMode === 'timed_shop') {
      const secs = Math.max(0, Math.ceil(this.timedRemaining));
      const mm = Math.floor(secs / 60);
      const ss = (secs % 60).toString().padStart(2, '0');
      const timerStr = `⏱ ${mm}:${ss}`;
      if (this.timerText.text !== timerStr) this.timerText.setText(timerStr);
      // 最后30秒变红警示
      this.timerText.setColor(secs <= 30 ? '#ff2222' : '#ff8844');
    }

    // 手持物品显示
    let heldStr = '';
    if (this.heldBox) {
      const cfg = this.getRarityConfig(this.heldBox.rarity);
      heldStr = `手持: [${cfg.name}]盒子 HP:${this.heldBox.hp}/${this.heldBox.maxHp}`;
    } else if (this.heldItem) {
      const cfg = this.getRarityConfig(this.heldItem.rarity);
      heldStr = `手持: [${cfg.name}]物品 价值:${this.heldItem.value}`;
    }
    if (this.heldText.text !== heldStr) this.heldText.setText(heldStr);
  }

  private drawStaminaBar() {
    const g = this.staminaBar;
    g.clear();

    const barW = 200;
    const barH = 10;
    const barX = 16;
    const barY = 88;

    // 背景
    g.fillStyle(0x333333, 1);
    g.fillRect(barX, barY, barW, barH);

    // 体力
    const ratio = this.stamina / STAMINA_MAX;
    const color = this.isSprinting ? 0xff8800 : 0x44aa44;
    g.fillStyle(color, 1);
    g.fillRect(barX, barY, barW * ratio, barH);

    // 边框
    g.lineStyle(1, 0x666666, 1);
    g.strokeRect(barX, barY, barW, barH);
  }

  private updateHint() {
    let hint = '';

    // 撤离点提示
    const dExtract = Phaser.Math.Distance.Between(this.player.x, this.player.y, 80, 80);
    if (this.extractionMode === 'timed' || this.extractionMode === 'timed_shop') {
      // 限时模式：入口随时可撤离
      if (dExtract < EXTRACTION_RANGE) {
        hint = '[E] 撤离！（赚多少算多少）';
        if (this.hintText.text !== hint) this.hintText.setText(hint);
        return;
      }
      // 限时·商店撤离：商店处可卖货/撤离
      if (this.extractionMode === 'timed_shop' && this.findNearestShop()) {
        const hasSellable = this.heldItem !== null || this.inventory.some(function(it) { return it !== null; });
        hint = hasSellable ? '[E] 卖货 | [F] 撤离' : '[F] 撤离';
        if (this.hintText.text !== hint) this.hintText.setText(hint);
        return;
      }
    } else if (this.isQuotaMet) {
      // 配额模式：达成配额后优先显示
      if (dExtract < EXTRACTION_RANGE) {
        hint = '[E] 撤离！';
        if (this.hintText.text !== hint) this.hintText.setText(hint);
        return;
      } else {
        hint = `🚪 回入口撤离！(距离${Math.round(dExtract)})`;
      }
    }

    // 商店交互
    let nearShop = false;
    for (const s of this.shops) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
      if (d < SHOP_RANGE) { nearShop = true; break; }
    }
    if (nearShop) {
      if (this.extractionMode === 'shop_throw') {
        hint = hint ? hint + ' | ' : '';
        hint += '🎯 把物品扔进商店变现！';
      } else {
        const hasSellable = this.heldItem !== null || this.inventory.some(function(it) { return it !== null; });
        if (hasSellable) {
          hint = hint ? hint + ' | ' : '';
          hint += '[E] 商店卖货';
        }
      }
    }

    // 附近有盒子可捡
    if (!this.heldBox && !this.heldItem) {
      const nearestBox = this.findNearestBox();
      if (nearestBox) {
        hint = hint ? hint + ' | ' : '';
        hint += `[左键] 捡起 ${this.rarityName(nearestBox.rarity)}盒子`;
      }
      const nearestItem = this.findNearestItem();
      if (nearestItem) {
        hint = hint ? hint + ' | ' : '';
        hint += `[左键] 捡起 价值${nearestItem.value}的物品`;
      }
    }

    // 手持盒子
    if (this.heldBox) {
      hint = `左键=敲盒子(${this.heldBox.hp}/${this.heldBox.maxHp}) | 右键=扔出 | Q=放下`;
    }

    // 手持物品
    if (this.heldItem) {
      hint = `右键=扔出物品(价值${this.heldItem.value}) | Q=放下`;
    }

    // 手上空但有背包物品
    if (!this.heldBox && !this.heldItem) {
      const hasInv = this.inventory.some(function(it) { return it !== null; });
      if (hasInv) {
        hint = hint ? hint + ' | ' : '';
        hint += '1234=切换背包物品';
      }
    }

    // 手持物品时也可切换
    if (this.heldItem) {
      hint += ' | 1234=切换';
    }

    if (this.hintText.text !== hint) this.hintText.setText(hint);
  }

  // ─── Input ──────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.fKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);

    this.input.mouse?.disableContextMenu();

    // 1234 = 切换背包物品到手上
    this.input.keyboard!.on('keydown-ONE', () => this.swapInventorySlot(0));
    this.input.keyboard!.on('keydown-TWO', () => this.swapInventorySlot(1));
    this.input.keyboard!.on('keydown-THREE', () => this.swapInventorySlot(2));
    this.input.keyboard!.on('keydown-FOUR', () => this.swapInventorySlot(3));

    // Q = 轻轻放下手持物品/盒子
    this.input.keyboard!.on('keydown-Q', () => this.dropHeld());

    // 左键 = 捡起（手上空时）/ 敲击手持盒子
    // 右键 = 扔出盒子/物品
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isDead || this.isEscaped) return;

      if (pointer.leftButtonDown()) {
        if (this.heldBox) {
          this.smashHeldBox();
        } else if (!this.heldItem) {
          this.tryPickup();
        }
      } else if (pointer.rightButtonDown()) {
        if (this.heldBox) {
          this.throwBox(pointer);
        } else if (this.heldItem) {
          this.throwItem(pointer);
        }
      }
    });
  }

  // ─── Update loop ─────────────────────────────────────────────

  update(_time: number, delta: number) {
    // 选择界面：只响应ESC
    if (this.gameState === 'select') {
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) this.scene.start('MenuScene');
      return;
    }

    if (this.isDead || this.isEscaped) {
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) this.scene.start('MenuScene');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    // E = 商店卖货 / 入口撤离
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      // 入口撤离（所有模式都支持）
      const atEntrance = Phaser.Math.Distance.Between(this.player.x, this.player.y, 80, 80) < EXTRACTION_RANGE;
      if (atEntrance) {
        this.tryExtract();
        return;
      }
      // 商店卖货（只卖不撤）—— 投掷变现模式下E不卖货，靠扔进商店
      if (this.extractionMode !== 'shop_throw') {
        this.trySellAtShop();
      }
    }

    // F = 商店撤离（仅限时·商店撤离模式）
    if (Phaser.Input.Keyboard.JustDown(this.fKey)) {
      if (this.extractionMode === 'timed_shop') {
        this.tryExtract();
      }
    }

    // 限时模式：倒计时
    if (this.extractionMode === 'timed' || this.extractionMode === 'timed_shop') {
      this.updateTimedCountdown(delta);
    }

    this.handlePlayerMovement(delta);
    this.updateFlyingObjects(delta);
    this.updateSmashEffects(delta);
    this.updateBoxGlow(delta);

    // 节流：雾30Hz，UI 10Hz
    this.fogThrottle += delta;
    if (this.fogThrottle >= 33) { this.fogThrottle = 0; this.updateFog(); }
    this.uiThrottle += delta;
    if (this.uiThrottle >= 100) {
      this.uiThrottle = 0;
      this.updateUI();
      this.updateHint();
      this.drawStaminaBar();
      this.drawInventoryUI();
    }

    // 手持物品跟随玩家
    this.updateHeldPosition();
  }

  // ─── Player movement ─────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    const dt = delta / 1000;

    let inputX = 0;
    let inputY = 0;
    if (this.cursors.left?.isDown || this.wasdKeys.A.isDown) inputX -= 1;
    if (this.cursors.right?.isDown || this.wasdKeys.D.isDown) inputX += 1;
    if (this.cursors.up?.isDown || this.wasdKeys.W.isDown) inputY -= 1;
    if (this.cursors.down?.isDown || this.wasdKeys.S.isDown) inputY += 1;

    const hasInput = inputX !== 0 || inputY !== 0;

    // 朝向跟随鼠标（模拟第一人称手电筒）
    const pointer = this.input.activePointer;
    const mouseWorldX = pointer.x + this.cam.scrollX;
    const mouseWorldY = pointer.y + this.cam.scrollY;
    this.playerFacingAngle = Math.atan2(mouseWorldY - this.player.y, mouseWorldX - this.player.x);

    // 疾跑
    const wantSprint = this.shiftKey.isDown && hasInput && this.stamina > 5;
    if (wantSprint) {
      this.isSprinting = true;
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_RATE * dt);
    } else {
      this.isSprinting = false;
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * dt);
    }

    const baseSpeed = this.isSprinting ? PLAYER_SPRINT_SPEED : PLAYER_BASE_SPEED;
    let vx = inputX * baseSpeed;
    let vy = inputY * baseSpeed;

    if (vx !== 0 && vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * baseSpeed;
      vy = (vy / len) * baseSpeed;
    }

    const halfSize = 11;

    if (vx !== 0) {
      const dx = vx * dt;
      const newX = this.player.x + dx;
      const edgeX = newX + (dx > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(edgeX, this.player.y - halfSize) &&
          !this.isObstacleAt(edgeX, this.player.y + halfSize)) {
        this.player.x = newX;
      }
    }

    if (vy !== 0) {
      const dy = vy * dt;
      const newY = this.player.y + dy;
      const edgeY = newY + (dy > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(this.player.x - halfSize, edgeY) &&
          !this.isObstacleAt(this.player.x + halfSize, edgeY)) {
        this.player.y = newY;
      }
    }

    this.player.x = Phaser.Math.Clamp(this.player.x, 16, this.mapWidth - 16);
    this.player.y = Phaser.Math.Clamp(this.player.y, 16, this.mapHeight - 16);

    // 阴影跟随
    this.playerShadow.x = this.player.x;
    this.playerShadow.y = this.player.y + 14;
  }

  // ─── Pickup ─────────────────────────────────────────────────

  private tryPickup() {
    // 优先捡盒子（盒子不进背包，直接手持）
    if (!this.heldBox && !this.heldItem) {
      const nearestBox = this.findNearestBox();
      if (nearestBox) {
        this.heldBox = nearestBox;
        nearestBox.isHeld = true;
        nearestBox.sprite.setVisible(false);
        this.showMessage(`捡起 ${this.rarityName(nearestBox.rarity)}盒子！\n左键敲 | 右键扔`, 1500);
        return;
      }
    }

    // 捡物品 → 放入背包
    const nearestItem = this.findNearestItem();
    if (nearestItem) {
      // 手上空 → 先放手上
      if (!this.heldBox && !this.heldItem) {
        this.heldItem = nearestItem;
        nearestItem.collected = true;
        nearestItem.sprite.setVisible(false);
        nearestItem.label.setVisible(false);
        this.showMessage(`捡起 价值${nearestItem.value}的物品！\n右键扔出（一次就碎）`, 1500);
        return;
      }
      // 手上有东西 → 找空格子放入背包
      const emptySlot = this.inventory.indexOf(null);
      if (emptySlot >= 0) {
        this.inventory[emptySlot] = nearestItem;
        nearestItem.collected = true;
        nearestItem.sprite.setVisible(false);
        nearestItem.label.setVisible(false);
        this.showMessage(`捡起 价值${nearestItem.value}的物品！\n放入背包格${emptySlot + 1}`, 1500);
        return;
      } else {
        this.showMessage('背包满了！', 1500);
        return;
      }
    }
  }

  // ─── Inventory swap (1234键) ────────────────────────────────

  private swapInventorySlot(slot: number) {
    if (slot < 0 || slot >= INVENTORY_SIZE) return;
    // 手上有盒子时不能切换
    if (this.heldBox) return;

    const slotItem = this.inventory[slot];
    // 背包格有东西 → 取出到手上
    if (slotItem) {
      // 手上已有物品 → 放回背包格（隐藏sprite）
      if (this.heldItem) {
        this.heldItem.sprite.setVisible(false);
        this.heldItem.label.setVisible(false);
        this.inventory[slot] = this.heldItem;
        this.heldItem = slotItem;
      } else {
        this.inventory[slot] = null;
        this.heldItem = slotItem;
      }
    } else {
      // 背包格空 → 手上物品放入背包（隐藏sprite）
      if (this.heldItem) {
        this.heldItem.sprite.setVisible(false);
        this.heldItem.label.setVisible(false);
        this.inventory[slot] = this.heldItem;
        this.heldItem = null;
      }
    }
  }

  private drawInventoryUI() {
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const item = this.inventory[i];
      const bg = this.inventorySlotBgs[i];
      const txt = this.inventorySlotTexts[i];
      if (item) {
        const cfg = this.getRarityConfig(item.rarity);
        bg.setFillStyle(cfg.color, 0.5);
        const newText = `💰${item.value}`;
        if (txt.text !== newText) txt.setText(newText);
      } else {
        bg.setFillStyle(0x222244, 0.8);
        if (txt.text !== '') txt.setText('');
      }
    }
  }

  private findNearestBox(): GameBox | null {
    let nearest: GameBox | null = null;
    let best = BOX_PICKUP_RANGE;
    for (const b of this.boxes) {
      if (b.isOpen || b.isHeld || b.isFlying) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y);
      if (d < best) { best = d; nearest = b; }
    }
    return nearest;
  }

  private findNearestItem(): GroundItem | null {
    let nearest: GroundItem | null = null;
    let best = ITEM_PICKUP_RANGE;
    for (const it of this.groundItems) {
      if (it.collected) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, it.x, it.y);
      if (d < best) { best = d; nearest = it; }
    }
    return nearest;
  }

  // ─── Smash (左键敲击手持盒子) ────────────────────────────────

  private smashHeldBox() {
    if (!this.heldBox) return;

    const box = this.heldBox;
    box.hp -= 1;
    this.drawBoxCracks(box);

    // 敲击特效
    this.createSmashEffect(this.player.x + Math.cos(this.playerFacingAngle) * 25,
                           this.player.y + Math.sin(this.playerFacingAngle) * 25);
    this.cam.shake(80, 0.003);

    if (box.hp <= 0) {
      this.breakBox(box, this.player.x, this.player.y);
      this.heldBox = null;
    }
  }

  private breakBox(box: GameBox, x: number, y: number) {
    box.isOpen = true;
    box.isHeld = false;
    box.isFlying = false;
    box.sprite.destroy();

    // 爆裂撞击音效（碎裂）
    if (this.smashSound && !this.smashSound.isPlaying) {
      this.smashSound.play();
    }

    // 掉落物品
    this.spawnGroundItem(x, y, box.rarity, box.value);

    const cfg = this.getRarityConfig(box.rarity);
    this.showMessage(`💥 ${cfg.name}盒子碎了！\n掉出价值 ${box.value} 的物品！\n左键捡起`, 2500);
    this.cam.shake(200, 0.008);
  }

  // ─── Throw (右键扔出) ───────────────────────────────────────

  // Q键：轻轻放下手持物品/盒子（不飞不碎）
  private dropHeld() {
    if (this.heldBox) {
      const box = this.heldBox;
      this.heldBox = null;
      box.isHeld = false;
      // 放在玩家前方
      const dropX = this.player.x + Math.cos(this.playerFacingAngle) * 35;
      const dropY = this.player.y + Math.sin(this.playerFacingAngle) * 35;
      box.x = Phaser.Math.Clamp(dropX, 30, this.mapWidth - 30);
      box.y = Phaser.Math.Clamp(dropY, 30, this.mapHeight - 30);
      box.sprite.setVisible(true);
      box.sprite.setPosition(box.x, box.y);
      this.showMessage(`放下 ${this.rarityName(box.rarity)}盒子`, 1000);
      return;
    }
    if (this.heldItem) {
      const item = this.heldItem;
      this.heldItem = null;
      // 放在玩家前方
      const dropX = this.player.x + Math.cos(this.playerFacingAngle) * 35;
      const dropY = this.player.y + Math.sin(this.playerFacingAngle) * 35;
      item.x = Phaser.Math.Clamp(dropX, 30, this.mapWidth - 30);
      item.y = Phaser.Math.Clamp(dropY, 30, this.mapHeight - 30);
      item.collected = false;
      item.sprite.setVisible(true);
      item.label.setVisible(true);
      item.sprite.setPosition(item.x, item.y);
      item.label.setPosition(item.x, item.y - 25);
      this.showMessage(`放下 价值${item.value}的物品`, 1000);
      return;
    }
  }

  private throwBox(pointer: Phaser.Input.Pointer) {
    if (!this.heldBox) return;

    const box = this.heldBox;
    this.heldBox = null;
    box.isHeld = false;
    box.isFlying = true;

    const cam = this.cameras.main;
    const tx = pointer.x + cam.scrollX;
    const ty = pointer.y + cam.scrollY;
    const ang = Math.atan2(ty - this.player.y, tx - this.player.x);
    const vx = Math.cos(ang) * THROW_SPEED;
    const vy = Math.sin(ang) * THROW_SPEED;

    // 重新显示盒子精灵（飞行中）
    box.sprite.setVisible(true);
    box.sprite.setPosition(this.player.x, this.player.y);

    this.flyingObjects.push({
      sprite: box.sprite,
      vx, vy,
      life: THROW_LIFETIME,
      isBox: true,
      box,
      bounces: 0,
      maxBounces: box.hp,  // 剩余HP次碰撞后碎裂
    });
  }

  private throwItem(pointer: Phaser.Input.Pointer) {
    if (!this.heldItem) return;

    const item = this.heldItem;
    this.heldItem = null;

    const cam = this.cameras.main;
    const tx = pointer.x + cam.scrollX;
    const ty = pointer.y + cam.scrollY;
    const ang = Math.atan2(ty - this.player.y, tx - this.player.x);
    const vx = Math.cos(ang) * THROW_SPEED;
    const vy = Math.sin(ang) * THROW_SPEED;

    // 重新显示物品精灵
    item.sprite.setVisible(true);
    item.label.setVisible(true);
    item.sprite.setPosition(this.player.x, this.player.y);
    item.label.setPosition(this.player.x, this.player.y - 25);
    item.collected = false;

    this.flyingObjects.push({
      sprite: item.sprite,
      vx, vy,
      life: THROW_LIFETIME,
      isBox: false,
      item,
      bounces: 0,
      maxBounces: 1,  // 物品一次碰撞就碎
    });
  }

  // ─── Flying objects update ──────────────────────────────────

  private updateFlyingObjects(delta: number) {
    const dt = delta / 1000;
    for (let i = this.flyingObjects.length - 1; i >= 0; i--) {
      const fo = this.flyingObjects[i];
      fo.sprite.x += fo.vx * dt;
      fo.sprite.y += fo.vy * dt;
      fo.life -= delta;

      // 如果是物品，标签跟随
      if (fo.item) {
        fo.item.x = fo.sprite.x;
        fo.item.y = fo.sprite.y;
        fo.item.label.setPosition(fo.sprite.x, fo.sprite.y - 25);
      }

      // 如果是盒子，更新盒子坐标
      if (fo.box) {
        fo.box.x = fo.sprite.x;
        fo.box.y = fo.sprite.y;
      }

      // 碰墙检测
      const hitWall = this.isInsideObstacle(fo.sprite.x, fo.sprite.y, 8);

      // 投掷变现模式：飞行物品飞进商店范围 → 直接变现（不碎）
      if (!fo.isBox && fo.item && this.extractionMode === 'shop_throw') {
        let soldShop: Shop | null = null;
        for (const s of this.shops) {
          const d = Phaser.Math.Distance.Between(fo.sprite.x, fo.sprite.y, s.x, s.y);
          if (d < SHOP_RANGE) { soldShop = s; break; }
        }
        if (soldShop) {
          this.cashInItem(fo.item);
          this.flyingObjects.splice(i, 1);
          continue;
        }
      }

      // 碰盒子检测（飞行物体撞到地面上的盒子）
      let hitBox = false;
      if (fo.isBox && fo.box) {
        const flyingBox = fo.box;
        // 飞行盒子撞到地面盒子 → 两者都受损
        for (const b of this.boxes) {
          if (b.isOpen || b.isHeld) continue;
          if (b === flyingBox) continue;
          const d = Phaser.Math.Distance.Between(fo.sprite.x, fo.sprite.y, b.x, b.y);
          if (d < (flyingBox.size + b.size) / 2) {
            hitBox = true;
            // 地面盒子也受损
            b.hp -= 1;
            this.drawBoxCracks(b);
            if (b.hp <= 0) {
              this.breakBox(b, b.x, b.y);
            }
            break;
          }
        }
      }

      // 碰地面物品检测（飞行盒子撞到地面物品 → 物品碎掉）
      let hitItem = false;
      if (fo.isBox) {
        for (const it of this.groundItems) {
          if (it.collected) continue;
          const d = Phaser.Math.Distance.Between(fo.sprite.x, fo.sprite.y, it.x, it.y);
          if (d < 20) {
            hitItem = true;
            this.destroyGroundItem(it);
            break;
          }
        }
      }

      if (hitWall || hitBox || hitItem) {
        // 飞行盒子碰任何东西都掉耐久
        if (fo.isBox && fo.box) {
          fo.box.hp -= 1;
          this.drawBoxCracks(fo.box);
        }

        // 碰撞后减速反弹
        if (hitWall) {
          fo.vx *= -0.4;
          fo.vy *= -0.4;
          // 推开避免卡墙
          fo.sprite.x += fo.vx * dt * 2;
          fo.sprite.y += fo.vy * dt * 2;
        } else {
          fo.vx *= 0.3;
          fo.vy *= 0.3;
        }

        // 碰撞特效
        this.createSmashEffect(fo.sprite.x, fo.sprite.y);

        // 检查是否碎裂
        if (fo.isBox && fo.box && fo.box.hp <= 0) {
          this.breakBox(fo.box, fo.sprite.x, fo.sprite.y);
          this.flyingObjects.splice(i, 1);
          continue;
        } else if (!fo.isBox && fo.item) {
          // 物品一次碰撞就碎
          this.destroyGroundItem(fo.item);
          this.showMessage(`💥 物品碎了！\n损失价值 ${fo.item.value}`, 1500);
          this.flyingObjects.splice(i, 1);
          continue;
        }
      }

      // 超时或停下
      if (fo.life <= 0) {
        // 超时落地
        if (fo.isBox && fo.box) {
          fo.box.x = fo.sprite.x;
          fo.box.y = fo.sprite.y;
          fo.box.isFlying = false;
          fo.box.sprite.setVisible(true);
        }
        if (!fo.isBox && fo.item) {
          fo.item.x = fo.sprite.x;
          fo.item.y = fo.sprite.y;
          fo.item.sprite.setVisible(true);
          fo.item.label.setVisible(true);
          fo.item.label.setPosition(fo.sprite.x, fo.sprite.y - 25);
          fo.item.collected = false;
        }
        this.flyingObjects.splice(i, 1);
      }
    }
  }

  // ─── Ground items ───────────────────────────────────────────

  private spawnGroundItem(x: number, y: number, rarity: BoxRarity, value: number) {
    const cfg = this.getRarityConfig(rarity);

    const container = this.add.container(x, y);
    container.setDepth(5);

    // 物品主体（小宝石形状）
    const gem = this.add.graphics();
    gem.fillStyle(cfg.color, 1);
    gem.beginPath();
    const r = 10;
    gem.moveTo(0, -r);
    gem.lineTo(r * 0.7, 0);
    gem.lineTo(0, r);
    gem.lineTo(-r * 0.7, 0);
    gem.closePath();
    gem.fillPath();
    gem.lineStyle(1, cfg.borderColor, 1);
    gem.strokePath();
    container.add(gem);

    // 发光
    const glow = this.add.graphics();
    glow.fillStyle(cfg.glowColor, 0.2);
    glow.fillCircle(0, 0, 16);
    container.add(glow);
    container.sendToBack(glow);

    // 价值标签
    const label = this.add.text(x, y - 25, `💰${value}`, {
      fontSize: '14px', color: '#ffdd00', backgroundColor: '#000000',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(6);

    const item: GroundItem = {
      x, y,
      value,
      rarity,
      collected: false,
      sprite: container,
      label,
    };

    this.groundItems.push(item);
  }

  private destroyGroundItem(item: GroundItem) {
    item.sprite.destroy();
    item.label.destroy();

    // 爆裂撞击音效（物品碎裂）
    if (this.smashSound && !this.smashSound.isPlaying) {
      this.smashSound.play();
    }
    item.collected = true;
    const idx = this.groundItems.indexOf(item);
    if (idx >= 0) this.groundItems.splice(idx, 1);
  }

  // ─── Smash effects ─────────────────────────────────────────

  private createSmashEffect(x: number, y: number) {
    // 爆裂撞击音效
    if (this.smashSound && !this.smashSound.isPlaying) {
      this.smashSound.play();
    }

    const g = this.add.graphics();
    g.setDepth(8);

    // 碎片粒子
    const particles = 6;
    for (let i = 0; i < particles; i++) {
      const a = (i / particles) * Math.PI * 2;
      const dist = Phaser.Math.Between(5, 15);
      const px = Math.cos(a) * dist;
      const py = Math.sin(a) * dist;
      g.fillStyle(0xddaa66, 0.8);
      g.fillRect(px - 2, py - 2, 4, 4);
    }

    g.setPosition(x, y);
    this.smashEffects.push({ sprite: g, life: 300 });
  }

  private updateSmashEffects(delta: number) {
    for (let i = this.smashEffects.length - 1; i >= 0; i--) {
      const e = this.smashEffects[i];
      e.life -= delta;
      const alpha = e.life / 300;
      e.sprite.setAlpha(alpha);
      if (e.life <= 0) {
        e.sprite.destroy();
        this.smashEffects.splice(i, 1);
      }
    }
  }

  // ─── Box glow pulse ─────────────────────────────────────────

  private updateBoxGlow(_delta: number) {
    const t = this.time.now / 1000;
    for (const b of this.boxes) {
      if (b.isOpen || b.isHeld) continue;
      const cfg = this.getRarityConfig(b.rarity);
      // 超稀有盒子脉动更强
      const pulse = b.rarity === 'super_rare' ? 0.15 + Math.sin(t * 3) * 0.1 :
                    b.rarity === 'rare' ? 0.1 + Math.sin(t * 2) * 0.05 :
                    0.05;
      b.glowSprite.clear();
      b.glowSprite.fillStyle(cfg.glowColor, pulse);
      b.glowSprite.fillCircle(0, 0, b.size * 0.8);
    }
  }

  // ─── Held position update ──────────────────────────────────

  private updateHeldPosition() {
    if (this.heldBox) {
      // 手持盒子跟随玩家头顶
      this.heldBox.sprite.setVisible(true);
      this.heldBox.sprite.setPosition(this.player.x, this.player.y - 25);
    }
    if (this.heldItem) {
      this.heldItem.sprite.setVisible(true);
      this.heldItem.sprite.setPosition(this.player.x, this.player.y - 25);
      this.heldItem.label.setVisible(false);
    }
  }

  // ─── Collision helpers ────────────────────────────────────────

  private isObstacleAt(px: number, py: number): boolean {
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
}
