import Phaser from 'phaser';

// ─── Data types ──────────────────────────────────────────────

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface HideSpot {
  x: number;
  y: number;
  w: number;
  h: number;
  occupied: boolean;
}

type BoxType = 'small' | 'medium' | 'large';

interface BlindBox {
  x: number;
  y: number;
  size: number;
  type: BoxType;
  maxHp: number;
  hp: number;
  isOpen: boolean;
  sprite: Phaser.GameObjects.Graphics;
  crackSprite: Phaser.GameObjects.Graphics;
  promptText: Phaser.GameObjects.Text;
}

type ItemKind = 'normal' | 'unidentified' | 'weapon';
type Condition = 10 | 7 | 4 | 0;
type WeaponKind = 'trophy' | 'dagger' | 'flare' | 'rope';
type MysteryKind = 'crystal' | 'mask' | 'scroll' | 'bone';

interface Item {
  kind: ItemKind;
  name: string;
  baseValue: number;
  condition: Condition;
  // weapon
  weaponKind?: WeaponKind;
  uses?: number;
  maxUses?: number;
  // unidentified
  mysteryKind?: MysteryKind;
  revealedValue?: number; // 卖时揭晓
}

type MonsterKind = 'ghost' | 'judge';

interface Monster {
  sprite: Phaser.GameObjects.Rectangle;
  kind: MonsterKind;
  speed: number;
  chaseSpeed: number;
  direction: Phaser.Math.Vector2;
  patrolTimer: number;
  isChasing: boolean;
  senseRange: number; // ghost:视野 judge:听觉
  homeX: number;
  homeY: number;
  giveUpTimer: number;
  giveUpDuration: number;
  stunTimer: number;
  attackCooldown: number;
  // judge patrol route
  patrolRoute: { x: number; y: number }[];
  patrolIndex: number;
  listenTimer: number; // 定期停步听
  isListening: boolean;
}

// ─── Item tables ─────────────────────────────────────────────

interface NormalItemDef { name: string; minVal: number; maxVal: number; }
const NORMAL_ITEMS: NormalItemDef[] = [
  { name: '破瓶子', minVal: 10, maxVal: 30 },
  { name: '旧报纸', minVal: 5, maxVal: 15 },
  { name: '空罐头', minVal: 8, maxVal: 20 },
  { name: '铜币', minVal: 15, maxVal: 40 },
];

interface WeaponDef { kind: WeaponKind; name: string; minVal: number; maxVal: number; uses: number; effect: string; }
const WEAPON_ITEMS: WeaponDef[] = [
  { kind: 'trophy', name: '铜奖杯', minVal: 80, maxVal: 150, uses: 3, effect: '砸晕2秒' },
  { kind: 'dagger', name: '舞台匕首', minVal: 60, maxVal: 120, uses: 2, effect: '伤害+流血' },
  { kind: 'flare', name: '烟火弹', minVal: 100, maxVal: 180, uses: 1, effect: '闪光吓退5秒' },
  { kind: 'rope', name: '绳索', minVal: 40, maxVal: 80, uses: 2, effect: '绊倒3秒' },
];

interface MysteryDef { kind: MysteryKind; name: string; junkVal: number; treasureVal: number; }
const MYSTERY_ITEMS: MysteryDef[] = [
  { kind: 'crystal', name: '???水晶球', junkVal: 20, treasureVal: 800 },
  { kind: 'mask', name: '???面具', junkVal: 30, treasureVal: 1200 },
  { kind: 'scroll', name: '???卷轴', junkVal: 10, treasureVal: 600 },
  { kind: 'bone', name: '???骨头', junkVal: 5, treasureVal: 500 },
];

// ─── Box type config ─────────────────────────────────────────

interface BoxTypeConfig {
  size: number;
  maxHp: number;
  color: number;
}
const BOX_CONFIG: Record<BoxType, BoxTypeConfig> = {
  small: { size: 22, maxHp: 2, color: 0x8a6a3a },
  medium: { size: 30, maxHp: 4, color: 0x6a4a2a },
  large: { size: 40, maxHp: 4, color: 0x4a2a1a },
};

// Drop probability per box type: [normal, unidentified, weapon]
const DROP_TABLE: Record<BoxType, [number, number, number]> = {
  small: [0.6, 0.3, 0.1],
  medium: [0.45, 0.4, 0.15],
  large: [0.25, 0.45, 0.3],
};

// ─── Constants ─────────────────────────────────────────────

const PLAYER_BASE_SPEED = 150;
const PLAYER_SPRINT_SPEED = 250;
const PLAYER_SNEAK_SPEED = 70;
const STAMINA_MAX = 100;
const STAMINA_DRAIN_RATE = 35;
const STAMINA_REGEN_RATE = 20;
const STAMINA_SPRINT_MIN = 5;

const BOX_INTERACT_RANGE = 55;
const MERCHANT_RANGE = 60;
const ITEM_PICKUP_RANGE = 45;
const THROW_SPEED = 420;
const THROW_LIFETIME = 1200;

const GOAL_MONEY = 1000;
const HIDE_SPOT_RANGE = 45;

const GHOST_VISION = 180;
const GHOST_PATROL_SPEED = 40;
const GHOST_CHASE_SPEED = 150;
const GHOST_TERRITORY = 400;
const JUDGE_HEARING = 250;
const JUDGE_PATROL_SPEED = 50;
const JUDGE_CHASE_SPEED = 170;

// ─── Scene ────────────────────────────────────────────────────

export class BlindBoxCasinoScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private qKey!: Phaser.Input.Keyboard.Key;
  private ctrlKey!: Phaser.Input.Keyboard.Key;

  // Map
  private mapWidth = 2400;
  private mapHeight = 1600;
  private obstacles: Obstacle[] = [];
  private hideSpots: HideSpot[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Fog of war
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'blindBoxCasinoFog';
  private viewRadius = 180;
  private screenW = 800;
  private screenH = 600;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private boxes: BlindBox[] = [];
  private monsters: Monster[] = [];
  private merchant!: Phaser.GameObjects.Rectangle;
  private merchantX = 100;
  private merchantY = 100;

  // Thrown items (flying)
  private flyingItems: { item: Item; sprite: Phaser.GameObjects.Rectangle; vx: number; vy: number; life: number }[] = [];
  // Ground items (on floor after box opens — E to pick up into inventory)
  private groundItems: { item: Item; x: number; y: number; sprite: Phaser.GameObjects.Rectangle; prompt: Phaser.GameObjects.Text }[] = [];

  // Inventory (4 slots, scroll to switch held)
  private inventory: (Item | null)[] = [null, null, null, null];
  private heldIndex = 0;

  // Player stats
  private health = 100;
  private money = 0;
  private damageCooldown = 0;

  // Sprint & sneak
  private stamina = STAMINA_MAX;
  private isSprinting = false;
  private isSneaking = false;
  private staminaBar!: Phaser.GameObjects.Graphics;

  // Hide
  private isHidden = false;
  private hiddenSpot: HideSpot | null = null;
  private hidePromptText!: Phaser.GameObjects.Text;

  // Opening box
  private currentBox: BlindBox | null = null;

  // Game state
  private isDead = false;
  private isEscaped = false;

  // UI
  private healthText!: Phaser.GameObjects.Text;
  private moneyText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private invGraphics!: Phaser.GameObjects.Graphics;
  private invTexts: Phaser.GameObjects.Text[] = [];
  private promptText!: Phaser.GameObjects.Text;
  private merchantPromptText!: Phaser.GameObjects.Text;

  // Throttle timers
  private uiThrottle = 0;
  private fogThrottle = 0;

  constructor() {
    super({ key: 'BlindBoxCasinoScene' });
  }

  create() {
    // ── 重置所有实例状态 ──
    this.isDead = false;
    this.isEscaped = false;
    this.health = 100;
    this.money = 0;
    this.damageCooldown = 0;
    this.boxes = [];
    this.monsters = [];
    this.obstacles = [];
    this.hideSpots = [];
    this.flyingItems = [];
    this.groundItems = [];
    this.inventory = [null, null, null, null];
    this.heldIndex = 0;
    this.stamina = STAMINA_MAX;
    this.isSprinting = false;
    this.isSneaking = false;
    this.isHidden = false;
    this.hiddenSpot = null;
    this.currentBox = null;
    this.uiThrottle = 0;
    this.fogThrottle = 0;

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateBuilding();
    this.generateHideRooms();
    this.drawMap();
    this.createPlayer();
    this.createMerchant();
    this.createBoxes();
    this.createMonsters();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('🎁 盲盒赌场\n\n按住空格敲盲盒 → 物品掉地上 → E捡进背包\nQ = 卖掉手持物品（已知价值的直接卖）\n未鉴定物品 → 去商人鉴定后才能卖\n左键 = 扔手持物品砸怪眩晕\nE = 躲进躲避点断视线脱仇恨！\n攒够 ¥1000 → 商人处按E撤离！\n\nShift疾跑(有声) | Ctrl蹲走(无声) | 滚轮切换手持', 9000);
  }

  // ─── Map generation ─────────────────────────────────────────

  private generateBuilding() {
    this.obstacles = [];

    // 外墙
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    // 房间隔断：浅层(上)→中层→深层(下)
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

    // 散落小障碍物（箱子/柱子）
    for (let i = 0; i < 22; i++) {
      const w = Phaser.Math.Between(20, 50);
      const h = Phaser.Math.Between(20, 50);
      const x = Phaser.Math.Between(100, this.mapWidth - 100 - w);
      const y = Phaser.Math.Between(100, this.mapHeight - 100 - h);
      if (x < 200 && y < 200) continue; // 避开入口
      this.obstacles.push({ x, y, w, h });
    }
  }

  private generateHideRooms() {
    this.hideSpots = [];
    const roomCount = 4;
    const roomSize = 90;
    const wallT = 12;
    const doorGap = 36;
    let placed = 0;
    let attempts = 0;

    while (placed < roomCount && attempts < 500) {
      attempts++;
      const x = Phaser.Math.Between(120, this.mapWidth - 120 - roomSize);
      const y = Phaser.Math.Between(120, this.mapHeight - 120 - roomSize);

      if (Phaser.Math.Distance.Between(x + roomSize / 2, y + roomSize / 2, this.merchantX, this.merchantY) < 200) continue;

      let tooClose = false;
      for (const hs of this.hideSpots) {
        if (Phaser.Math.Distance.Between(x + roomSize / 2, y + roomSize / 2, hs.x + hs.w / 2, hs.y + hs.h / 2) < 300) {
          tooClose = true; break;
        }
      }
      if (tooClose) continue;

      let overlaps = false;
      for (const obs of this.obstacles) {
        if (x < obs.x + obs.w + 20 && x + roomSize + 20 > obs.x &&
            y < obs.y + obs.h + 20 && y + roomSize + 20 > obs.y) {
          overlaps = true; break;
        }
      }
      if (overlaps) continue;

      // 四面墙留门缺口
      this.obstacles.push({ x: x - wallT, y: y - wallT, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: x + (roomSize + doorGap) / 2, y: y - wallT, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: x - wallT, y: y + roomSize, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: x + (roomSize + doorGap) / 2, y: y + roomSize, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: x - wallT, y: y, w: wallT, h: (roomSize - doorGap) / 2 });
      this.obstacles.push({ x: x - wallT, y: y + (roomSize + doorGap) / 2, w: wallT, h: (roomSize - doorGap) / 2 });
      this.obstacles.push({ x: x + roomSize, y: y, w: wallT, h: (roomSize - doorGap) / 2 });
      this.obstacles.push({ x: x + roomSize, y: y + (roomSize + doorGap) / 2, w: wallT, h: (roomSize - doorGap) / 2 });

      this.hideSpots.push({ x, y, w: roomSize, h: roomSize, occupied: false });
      placed++;
    }
  }

  private drawMap() {
    this.mapGraphics = this.add.graphics();

    // 地板（剧院暗红木地板色调）
    this.mapGraphics.fillStyle(0x2a1a1a, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

    // 地板网格
    this.mapGraphics.lineStyle(1, 0x3a2222, 0.3);
    for (let x = 0; x < this.mapWidth; x += 80) {
      this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += 80) {
      this.mapGraphics.lineBetween(0, y, this.mapWidth, y);
    }

    // 浅/中/深层分区底色
    this.mapGraphics.fillStyle(0x332020, 0.25);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight / 3); // 浅层
    this.mapGraphics.fillStyle(0x2a1010, 0.25);
    this.mapGraphics.fillRect(0, this.mapHeight / 3, this.mapWidth, this.mapHeight / 3); // 中层
    this.mapGraphics.fillStyle(0x1a0808, 0.3);
    this.mapGraphics.fillRect(0, (this.mapHeight * 2) / 3, this.mapWidth, this.mapHeight / 3); // 深层

    // 墙壁
    this.mapGraphics.fillStyle(0x4a3a3a, 1);
    for (const obs of this.obstacles) {
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
      this.mapGraphics.lineStyle(1, 0x6a5555, 0.5);
      this.mapGraphics.strokeRect(obs.x, obs.y, obs.w, obs.h);
    }

    // 躲藏小房间
    this.mapGraphics.fillStyle(0x1a2a4e, 0.6);
    for (const hs of this.hideSpots) {
      this.mapGraphics.fillRect(hs.x, hs.y, hs.w, hs.h);
      this.mapGraphics.lineStyle(2, 0x4466aa, 0.4);
      this.mapGraphics.strokeRect(hs.x, hs.y, hs.w, hs.h);
      this.add.text(hs.x + hs.w / 2, hs.y + hs.h / 2, '躲避点\n按E', {
        fontSize: '14px', color: '#6688cc', align: 'center',
      }).setOrigin(0.5).setDepth(2.5);
    }
  }

  // ─── Player ──────────────────────────────────────────────────

  private createPlayer() {
    this.player = this.add.circle(this.merchantX + 40, this.merchantY + 40, 12, 0x00ff00);
    this.player.setStrokeStyle(2, 0xffffff);
    this.player.setDepth(5);
  }

  // ─── Merchant ────────────────────────────────────────────────

  private createMerchant() {
    this.merchant = this.add.rectangle(this.merchantX, this.merchantY, 36, 36, 0xffcc00);
    this.merchant.setStrokeStyle(2, 0xffaa00);
    this.merchant.setDepth(4);
    this.add.text(this.merchantX, this.merchantY - 30, '鉴宝商人', {
      fontSize: '14px', color: '#ffcc00', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(4.5);
  }

  // ─── Blind boxes ─────────────────────────────────────────────

  private createBoxes() {
    // 浅层：8-10小盒  中层：5-6中盒  深层：3-4大盒
    this.placeBoxes('small', Phaser.Math.Between(8, 10), 0, this.mapHeight / 3);
    this.placeBoxes('medium', Phaser.Math.Between(5, 6), this.mapHeight / 3, (this.mapHeight * 2) / 3);
    this.placeBoxes('large', Phaser.Math.Between(3, 4), (this.mapHeight * 2) / 3, this.mapHeight);
  }

  private placeBoxes(type: BoxType, count: number, yMin: number, yMax: number) {
    const cfg = BOX_CONFIG[type];
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 500) {
      attempts++;
      const x = Phaser.Math.Between(60, this.mapWidth - 60);
      const y = Phaser.Math.Between(Math.floor(yMin) + 40, Math.floor(yMax) - 40);
      if (Phaser.Math.Distance.Between(x, y, this.merchantX, this.merchantY) < 200) continue;
      if (this.isInsideObstacle(x, y, cfg.size)) continue;

      const sprite = this.add.graphics();
      sprite.fillStyle(cfg.color, 1);
      sprite.fillRect(-cfg.size / 2, -cfg.size / 2, cfg.size, cfg.size);
      sprite.lineStyle(2, 0xaa8855, 0.6);
      sprite.strokeRect(-cfg.size / 2, -cfg.size / 2, cfg.size, cfg.size);
      // 盒盖
      sprite.fillStyle(0x5a3a1a, 1);
      sprite.fillRect(-cfg.size / 2, -cfg.size / 2, cfg.size, 6);
      sprite.setPosition(x, y);
      sprite.setDepth(2);

      const crackSprite = this.add.graphics();
      crackSprite.setPosition(x, y);
      crackSprite.setDepth(2.5);

      const prompt = this.add.text(x, y - cfg.size / 2 - 12, '', {
        fontSize: '12px', color: '#ffff00',
      }).setOrigin(0.5).setDepth(6);

      this.boxes.push({
        x, y, size: cfg.size, type, maxHp: cfg.maxHp, hp: cfg.maxHp,
        isOpen: false, sprite, crackSprite, promptText: prompt,
      });
      placed++;
    }
  }

  // ─── Monsters ───────────────────────────────────────────────

  private createMonsters() {
    // 开局3只群演幽灵，散布中层和深层
    this.spawnGhost(this.randomPointInBand(this.mapHeight / 3, this.mapHeight));
    this.spawnGhost(this.randomPointInBand(this.mapHeight / 3, this.mapHeight));
    this.spawnGhost(this.randomPointInBand(this.mapHeight / 3, this.mapHeight));
  }

  private randomPointInBand(yMin: number, yMax: number): { x: number; y: number } {
    for (let i = 0; i < 100; i++) {
      const x = Phaser.Math.Between(60, this.mapWidth - 60);
      const y = Phaser.Math.Between(Math.floor(yMin) + 30, Math.floor(yMax) - 30);
      if (Phaser.Math.Distance.Between(x, y, this.merchantX, this.merchantY) < 300) continue;
      if (this.isInsideObstacle(x, y, 14)) continue;
      return { x, y };
    }
    return { x: this.mapWidth / 2, y: this.mapHeight / 2 };
  }

  private spawnGhost(pos: { x: number; y: number }) {
    const sprite = this.add.rectangle(pos.x, pos.y, 24, 24, 0xaa44ff);
    sprite.setDepth(5);
    this.monsters.push({
      sprite, kind: 'ghost',
      speed: GHOST_PATROL_SPEED, chaseSpeed: GHOST_CHASE_SPEED,
      direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
      patrolTimer: Phaser.Math.Between(0, 3000),
      isChasing: false, senseRange: GHOST_VISION,
      homeX: pos.x, homeY: pos.y,
      giveUpTimer: 0, giveUpDuration: 5000,
      stunTimer: 0, attackCooldown: 0,
      patrolRoute: [], patrolIndex: 0, listenTimer: 0, isListening: false,
    });
  }

  private spawnJudge(pos: { x: number; y: number }) {
    const sprite = this.add.rectangle(pos.x, pos.y, 26, 26, 0xff4400);
    sprite.setDepth(5);
    sprite.setStrokeStyle(2, 0xffaa00);
    // 巡逻路线：围绕出生点几个点
    const route: { x: number; y: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      route.push({ x: pos.x + Math.cos(a) * 200, y: pos.y + Math.sin(a) * 200 });
    }
    this.monsters.push({
      sprite, kind: 'judge',
      speed: JUDGE_PATROL_SPEED, chaseSpeed: JUDGE_CHASE_SPEED,
      direction: new Phaser.Math.Vector2(1, 0),
      patrolTimer: 0,
      isChasing: false, senseRange: JUDGE_HEARING,
      homeX: pos.x, homeY: pos.y,
      giveUpTimer: 0, giveUpDuration: 5000,
      stunTimer: 0, attackCooldown: 0,
      patrolRoute: route, patrolIndex: 0, listenTimer: 0, isListening: false,
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
    this.healthText = this.add.text(16, 16, '❤️ 100', {
      fontSize: '18px', color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.moneyText = this.add.text(16, 40, '💰 ¥0 / 1000', {
      fontSize: '18px', color: '#ffdd00',
    }).setScrollFactor(0).setDepth(20);

    this.staminaBar = this.add.graphics();
    this.staminaBar.setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 460, '', {
      fontSize: '20px', color: '#ffffff', align: 'center',
      backgroundColor: '#000000aa', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);

    // 背包4格 UI
    this.invGraphics = this.add.graphics();
    this.invGraphics.setScrollFactor(0).setDepth(20);
    for (let i = 0; i < 4; i++) {
      const t = this.add.text(170 + i * 70, 555, '', {
        fontSize: '11px', color: '#ffffff', align: 'center',
        backgroundColor: '#00000088', padding: { x: 4, y: 2 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(21);
      this.invTexts.push(t);
    }

    this.promptText = this.add.text(400, 530, '', {
      fontSize: '14px', color: '#ffff00', align: 'center',
      backgroundColor: '#000000aa', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    this.merchantPromptText = this.add.text(400, 510, '', {
      fontSize: '14px', color: '#ffcc00', align: 'center',
      backgroundColor: '#000000aa', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    this.hidePromptText = this.add.text(400, 490, '', {
      fontSize: '14px', color: '#6688cc', align: 'center',
      backgroundColor: '#000000aa', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    // 返回菜单按钮
    const backBg = this.add.rectangle(730, 30, 110, 30, 0x333333, 0.85)
      .setScrollFactor(0).setDepth(29);
    backBg.setStrokeStyle(2, 0x888888);
    const backBtn = this.add.text(730, 30, '← 菜单', {
      fontSize: '16px', color: '#ffffff',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(30);
    backBtn.on('pointerdown', () => this.scene.start('MenuScene'));

    this.drawInventoryUI();
    this.updateMoneyUI();
  }

  private drawInventoryUI() {
    this.invGraphics.clear();
    for (let i = 0; i < 4; i++) {
      const x = 170 + i * 70 - 30;
      const y = 540;
      const isHeld = i === this.heldIndex;
      this.invGraphics.fillStyle(0x000000, 0.6);
      this.invGraphics.fillRect(x, y, 60, 30);
      this.invGraphics.lineStyle(2, isHeld ? 0xffff00 : 0x666666, 1);
      this.invGraphics.strokeRect(x, y, 60, 30);

      const it = this.inventory[i];
      const t = this.invTexts[i];
      if (it) {
        let label = '';
        if (it.kind === 'normal') {
          label = `${it.name}\n¥${it.baseValue} ${it.condition}成`;
        } else if (it.kind === 'unidentified') {
          label = `${it.name}\n??? ${it.condition}成`;
        } else if (it.kind === 'weapon') {
          label = `${it.name}\n¥${it.baseValue} ${it.condition}成`;
        }
        if (t.text !== label) t.setText(label);
      } else {
        if (t.text !== '') t.setText('');
      }
    }
  }

  private updateMoneyUI() {
    const newText = `💰 ¥${this.money} / ${GOAL_MONEY}`;
    if (this.moneyText.text !== newText) {
      this.moneyText.setText(newText);
      this.moneyText.setColor(this.money >= GOAL_MONEY ? '#00ff00' : '#ffdd00');
    }
  }

  private updateHealthUI() {
    const newText = `❤️ ${this.health}`;
    if (this.healthText.text !== newText) {
      this.healthText.setText(newText);
      this.healthText.setColor(this.health <= 30 ? '#ff4444' : this.health <= 60 ? '#ffaa44' : '#ffffff');
    }
  }

  private messageTimer: Phaser.Time.TimerEvent | null = null;
  private showMessage(text: string, duration = 3000) {
    if (this.messageTimer) { this.messageTimer.remove(false); this.messageTimer = null; }
    this.messageText.setText(text).setVisible(true);
    if (duration < 999999) {
      this.messageTimer = this.time.delayedCall(duration, () => {
        this.messageTimer = null;
        this.hideMessage();
      });
    }
  }
  private hideMessage() { this.messageText.setVisible(false); }

  // ─── Input ───────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.qKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.ctrlKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);

    this.input.mouse?.disableContextMenu();

    // 滚轮切换手持
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _currentlyOver: any, _deltaX: number, deltaY: number) => {
      if (deltaY > 0) this.heldIndex = (this.heldIndex + 1) % 4;
      else if (deltaY < 0) this.heldIndex = (this.heldIndex + 3) % 4;
      this.drawInventoryUI();
    });

    // 左键 = 扔手持物品砸怪
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isDead || this.isEscaped) return;
      if (pointer.leftButtonDown()) {
        this.throwHeldItem(pointer);
      }
    });
  }

  // ─── Update loop ─────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.isDead || this.isEscaped) {
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) this.scene.start('MenuScene');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    // E 交互（躲藏优先）
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      if (this.tryHide()) return;
      this.tryInteract();
    }
    // Q 卖掉手持物品
    if (Phaser.Input.Keyboard.JustDown(this.qKey)) {
      this.sellHeldItem();
    }

    // 躲藏时不能移动/敲盒
    if (this.isHidden) {
      this.updateMonsters(delta);
      this.checkMonsterCollision();
      this.updatePrompts();
      this.updateFog();
      this.updateHealthUI();
      this.drawStaminaBar();
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * (delta / 1000));
      if (this.damageCooldown > 0) this.damageCooldown -= delta;
      return;
    }

    this.handlePlayerMovement(delta);
    this.updateBoxOpening(delta);
    this.updateFlyingItems(delta);
    this.updateMonsters(delta);
    this.checkMonsterCollision();
    this.updatePrompts();
    this.checkMerchantEscape();

    // 节流：雾30Hz，UI 10Hz
    this.fogThrottle += delta;
    if (this.fogThrottle >= 33) { this.fogThrottle = 0; this.updateFog(); }
    this.uiThrottle += delta;
    if (this.uiThrottle >= 100) { this.uiThrottle = 0; this.updateHealthUI(); this.drawStaminaBar(); }

    if (this.damageCooldown > 0) this.damageCooldown -= delta;
  }

  // ─── Player movement ─────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    const dt = delta / 1000;
    let dx = 0, dy = 0;
    if (this.cursors.left?.isDown || this.wasdKeys.A.isDown) dx -= 1;
    if (this.cursors.right?.isDown || this.wasdKeys.D.isDown) dx += 1;
    if (this.cursors.up?.isDown || this.wasdKeys.W.isDown) dy -= 1;
    if (this.cursors.down?.isDown || this.wasdKeys.S.isDown) dy += 1;

    const isMoving = dx !== 0 || dy !== 0;
    this.isSneaking = this.ctrlKey.isDown;
    this.isSprinting = isMoving && this.shiftKey.isDown && !this.isSneaking && this.stamina > STAMINA_SPRINT_MIN;

    if (isMoving) {
      const len = Math.sqrt(dx * dx + dy * dy);
      dx /= len; dy /= len;
      let speed = PLAYER_BASE_SPEED;
      if (this.isSprinting) speed = PLAYER_SPRINT_SPEED;
      else if (this.isSneaking) speed = PLAYER_SNEAK_SPEED;
      const newX = this.player.x + dx * speed * dt;
      const newY = this.player.y + dy * speed * dt;
      if (!this.collidesWithObstacle(newX, this.player.y, 12)) this.player.x = newX;
      if (!this.collidesWithObstacle(this.player.x, newY, 12)) this.player.y = newY;
      this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.mapWidth - 20);
      this.player.y = Phaser.Math.Clamp(this.player.y, 20, this.mapHeight - 20);
    }

    if (this.isSprinting) this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_RATE * dt);
    else this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * dt);
  }

  private collidesWithObstacle(x: number, y: number, radius: number): boolean {
    for (const obs of this.obstacles) {
      const closestX = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
      const closestY = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
      if (Phaser.Math.Distance.Between(x, y, closestX, closestY) < radius) return true;
    }
    return false;
  }
  private isInsideObstacle(x: number, y: number, radius: number): boolean {
    return this.collidesWithObstacle(x, y, radius);
  }

  private lineBlockedByObstacle(x1: number, y1: number, x2: number, y2: number): boolean {
    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const steps = Math.ceil(dist / 10);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.collidesWithObstacle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0)) return true;
    }
    return false;
  }

  private drawStaminaBar() {
    this.staminaBar.clear();
    const barX = 16, barY = 64, barW = 150, barH = 10;
    this.staminaBar.fillStyle(0x000000, 0.5);
    this.staminaBar.fillRect(barX, barY, barW, barH);
    const ratio = this.stamina / STAMINA_MAX;
    const color = ratio > 0.5 ? 0x00ff00 : ratio > 0.25 ? 0xffff00 : 0xff0000;
    this.staminaBar.fillStyle(color, 0.8);
    this.staminaBar.fillRect(barX, barY, barW * ratio, barH);
    this.staminaBar.lineStyle(1, 0xffffff, 0.5);
    this.staminaBar.strokeRect(barX, barY, barW, barH);
  }

  // ─── Hide system ────────────────────────────────────────────

  private tryHide(): boolean {
    // 已经在躲藏 → 按E离开
    if (this.isHidden) {
      this.exitHide();
      return true;
    }
    // 查找最近的躲藏点
    let nearest: HideSpot | null = null;
    let minD = HIDE_SPOT_RANGE;
    for (const hs of this.hideSpots) {
      const cx = hs.x + hs.w / 2;
      const cy = hs.y + hs.h / 2;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, cx, cy);
      if (d < minD) { minD = d; nearest = hs; }
    }
    if (nearest) {
      this.enterHide(nearest);
      return true;
    }
    return false;
  }

  private enterHide(spot: HideSpot) {
    this.isHidden = true;
    this.hiddenSpot = spot;
    spot.occupied = true;
    this.player.x = spot.x + spot.w / 2;
    this.player.y = spot.y + spot.h / 2;
    this.player.setFillStyle(0x226688);
    this.player.setAlpha(0.5);
    // 躲藏后立即清除所有怪物的追击状态
    for (const m of this.monsters) {
      m.isChasing = false;
      m.giveUpTimer = 0;
    }
    this.showMessage('躲藏中！怪物无法发现你。\n再按 E 离开', 2500);
  }

  private exitHide() {
    this.isHidden = false;
    if (this.hiddenSpot) {
      this.player.x = this.hiddenSpot.x + this.hiddenSpot.w / 2;
      this.player.y = this.hiddenSpot.y + this.hiddenSpot.h + 20;
      this.hiddenSpot.occupied = false;
      this.hiddenSpot = null;
    }
    this.player.setFillStyle(0x00ff00);
    this.player.setAlpha(1);
  }

  // ─── Box opening ────────────────────────────────────────────

  private findNearestBox(): BlindBox | null {
    let nearest: BlindBox | null = null;
    let best = BOX_INTERACT_RANGE;
    for (const b of this.boxes) {
      if (b.isOpen) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y);
      if (d < best) { best = d; nearest = b; }
    }
    return nearest;
  }

  private updateBoxOpening(delta: number) {
    const nearest = this.findNearestBox();
    // 按住空格敲
    if (nearest && this.spaceKey.isDown) {
      if (this.currentBox !== nearest) this.currentBox = nearest;
      nearest.hp -= delta / 1000; // 每秒1击
      this.drawBoxCracks(nearest);
      // 敲盲盒=巨响，吸引听觉怪
      this.alertHearingMonsters(nearest.x, nearest.y, 400);
      if (nearest.hp <= 0) {
        this.openBox(nearest);
      }
    } else {
      // 松手停止
      if (this.currentBox) this.currentBox = null;
    }
  }

  private drawBoxCracks(box: BlindBox) {
    box.crackSprite.clear();
    const ratio = 1 - box.hp / box.maxHp;
    if (ratio < 0.1) return;
    box.crackSprite.lineStyle(2, 0x000000, 0.7);
    const s = box.size / 2;
    // 随HP降低画越来越多裂纹
    const cracks = Math.floor(ratio * 5) + 1;
    for (let i = 0; i < cracks; i++) {
      const a = (i / cracks) * Math.PI * 2;
      box.crackSprite.beginPath();
      box.crackSprite.moveTo(0, 0);
      box.crackSprite.lineTo(Math.cos(a) * s * 0.8, Math.sin(a) * s * 0.8);
      box.crackSprite.strokePath();
    }
  }

  private openBox(box: BlindBox) {
    box.isOpen = true;
    box.sprite.setVisible(false);
    box.crackSprite.clear();
    box.promptText.setText('');
    this.cam.shake(150, 0.005);

    // 掉落物品
    const item = this.rollItem(box.type);
    // 放到地上让玩家捡
    this.spawnGroundItem(item, box.x, box.y);
    this.showMessage(`📦 盲盒开了！\n${this.itemDisplayName(item)}`, 2000);
    this.currentBox = null;

    // 怪物刷新（钱就是倒计时）
    this.checkMonsterSpawns();
  }

  private rollItem(type: BoxType): Item {
    const [pNormal, pUnid] = DROP_TABLE[type];
    const roll = Math.random();
    let kind: ItemKind;
    if (roll < pNormal) kind = 'normal';
    else if (roll < pNormal + pUnid) kind = 'unidentified';
    else kind = 'weapon';

    const condition = this.rollCondition();

    if (kind === 'normal') {
      const def = Phaser.Utils.Array.GetRandom(NORMAL_ITEMS);
      return { kind, name: def.name, baseValue: Phaser.Math.Between(def.minVal, def.maxVal), condition };
    } else if (kind === 'weapon') {
      const def = Phaser.Utils.Array.GetRandom(WEAPON_ITEMS);
      return { kind, name: def.name, baseValue: Phaser.Math.Between(def.minVal, def.maxVal), condition, weaponKind: def.kind, uses: def.uses, maxUses: def.uses };
    } else {
      const def = Phaser.Utils.Array.GetRandom(MYSTERY_ITEMS);
      // 揭晓时才决定垃圾/宝贝
      const isTreasure = Math.random() < 0.5;
      const revealedValue = isTreasure ? def.treasureVal : def.junkVal;
      return { kind, name: def.name, baseValue: 0, condition, mysteryKind: def.kind, revealedValue };
    }
  }

  private rollCondition(): Condition {
    const r = Math.random();
    if (r < 0.5) return 10;
    if (r < 0.8) return 7;
    return 4;
  }

  private itemDisplayName(item: Item): string {
    if (item.kind === 'unidentified') return `${item.name} (???)`;
    if (item.kind === 'weapon') return `${item.name} ¥${item.baseValue}`;
    return `${item.name} ¥${item.baseValue}`;
  }

  // ─── Ground items ───────────────────────────────────────────

  private spawnGroundItem(item: Item, x: number, y: number) {
    const colors: Record<ItemKind, number> = { normal: 0x88aa88, unidentified: 0xaa44ff, weapon: 0xff8800 };
    const sprite = this.add.rectangle(x, y, 16, 16, colors[item.kind]);
    sprite.setStrokeStyle(1, 0xffffff);
    sprite.setDepth(3.5);
    const prompt = this.add.text(x, y - 18, '', {
      fontSize: '11px', color: '#ffff00',
    }).setOrigin(0.5).setDepth(6);
    this.groundItems.push({ item, x, y, sprite, prompt });
  }

  private updatePrompts() {
    // 躲藏点提示
    let nearHide = false;
    if (!this.isHidden) {
      for (const hs of this.hideSpots) {
        const cx = hs.x + hs.w / 2;
        const cy = hs.y + hs.h / 2;
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, cx, cy) < HIDE_SPOT_RANGE + 20) {
          nearHide = true;
          break;
        }
      }
    }
    this.hidePromptText.setText(nearHide ? '按 E 躲避' : (this.isHidden ? '躲藏中 (按E离开)' : ''));

    // 地上物品提示
    for (const gi of this.groundItems) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, gi.x, gi.y);
      if (d < ITEM_PICKUP_RANGE) {
        gi.prompt.setText(`[E] ${this.itemDisplayName(gi.item)}`);
      } else {
        gi.prompt.setText('');
      }
    }
    // 盲盒提示
    const nearest = this.findNearestBox();
    for (const b of this.boxes) {
      if (b.isOpen) { b.promptText.setText(''); continue; }
      if (b === nearest) {
        b.promptText.setText(`[空格] 敲 ${b.hp.toFixed(0)}/${b.maxHp}`);
      } else {
        b.promptText.setText('');
      }
    }
    // 撤离点提示
    const distM = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.merchantX, this.merchantY);
    if (distM < MERCHANT_RANGE) {
      const unidCount = this.inventory.filter(s => s && s.kind === 'unidentified').length;
      if (unidCount > 0) {
        this.merchantPromptText.setText(`[E] 鉴定${unidCount}个未鉴定物品`);
      } else if (this.money >= GOAL_MONEY) {
        this.merchantPromptText.setText('[E] 撤离！');
      } else {
        this.merchantPromptText.setText(`还需 ¥${GOAL_MONEY - this.money} 才能撤离`);
      }
    } else {
      this.merchantPromptText.setText('');
    }
    // 底部操作提示
    const held = this.inventory[this.heldIndex];
    let ptxt = '滚轮切换手持';
    if (held) {
      ptxt += ` | Q卖${held.name} | 左键扔`;
    }
    if (this.promptText.text !== ptxt) this.promptText.setText(ptxt);
  }

  // ─── Interaction ────────────────────────────────────────────

  private tryInteract() {
    // 优先：撤离点
    const distM = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.merchantX, this.merchantY);
    if (distM < MERCHANT_RANGE) {
      // 先鉴定所有未鉴定物品
      const unidCount = this.inventory.filter(s => s && s.kind === 'unidentified').length;
      if (unidCount > 0) {
        this.appraiseAllUnidentified();
        return;
      }
      if (this.money >= GOAL_MONEY) {
        this.escape();
      } else {
        this.showMessage(`还需 ¥${GOAL_MONEY - this.money} 才能撤离！\nQ卖掉背包里的东西赚钱`, 2000);
      }
      return;
    }
    // 捡地上物品 → 放进背包
    for (let i = 0; i < this.groundItems.length; i++) {
      const gi = this.groundItems[i];
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, gi.x, gi.y);
      if (d < ITEM_PICKUP_RANGE) {
        const slot = this.inventory.findIndex(s => s === null);
        if (slot === -1) {
          this.showMessage('背包满了！Q卖掉点东西 or 左键扔', 1500);
          return;
        }
        this.inventory[slot] = gi.item;
        gi.sprite.destroy();
        gi.prompt.destroy();
        this.groundItems.splice(i, 1);
        this.drawInventoryUI();
        this.showMessage(`捡起 ${this.itemDisplayName(gi.item)}`, 1200);
        return;
      }
    }
  }

  private sellHeldItem() {
    const it = this.inventory[this.heldIndex];
    if (!it) {
      this.showMessage('手持槽是空的', 1000);
      return;
    }
    if (it.kind === 'unidentified') {
      this.showMessage(`${it.name} 未鉴定！\n去撤离点找商人鉴定`, 1500);
      return;
    }
    const val = Math.floor(it.baseValue * (it.condition / 10));
    this.money += val;
    this.updateMoneyUI();
    this.inventory[this.heldIndex] = null;
    this.drawInventoryUI();
    this.showMessage(`💰 ${it.name} +¥${val}`, 1500);
    this.checkMonsterSpawns();
  }

  private appraiseAllUnidentified() {
    let totalVal = 0;
    let msgs: string[] = [];
    for (let i = 0; i < this.inventory.length; i++) {
      const it = this.inventory[i];
      if (!it || it.kind !== 'unidentified') continue;
      const val = Math.floor((it.revealedValue ?? 0) * (it.condition / 10));
      const isTreasure = (it.revealedValue ?? 0) >= 100;
      totalVal += val;
      if (isTreasure) {
        msgs.push(`✨ ${it.name} → ¥${val} 宝贝！`);
      } else {
        msgs.push(`💩 ${it.name} → ¥${val} 垃圾…`);
      }
      this.inventory[i] = null;
    }
    this.money += totalVal;
    this.updateMoneyUI();
    this.drawInventoryUI();
    if (msgs.length > 0) {
      this.cam.flash(300, 255, 215, 0);
      this.showMessage(`鉴定 ${msgs.length} 件！+¥${totalVal}\n${msgs.join('\n')}`, 4000);
    }
    this.checkMonsterSpawns();
  }

  private checkMonsterSpawns() {
    // ¥300 +2幽灵, ¥600 +1判定者, ¥800 +1幽灵堵回程
    const ghostCount = this.monsters.filter(m => m.kind === 'ghost').length;
    const judgeCount = this.monsters.filter(m => m.kind === 'judge').length;
    if (this.money >= 300 && ghostCount < 5) {
      // 只补到5只
      const need = Math.min(2, 5 - ghostCount);
      for (let i = 0; i < need; i++) this.spawnGhost(this.randomPointInBand((this.mapHeight * 2) / 3, this.mapHeight));
    }
    if (this.money >= 600 && judgeCount < 1) {
      this.spawnJudge(this.randomPointInBand((this.mapHeight * 2) / 3, this.mapHeight));
    }
    if (this.money >= 800 && ghostCount < 6) {
      // 浅层堵回程
      this.spawnGhost(this.randomPointInBand(0, this.mapHeight / 3));
    }
  }

  // ─── Throw / drop ───────────────────────────────────────────

  private throwHeldItem(pointer: Phaser.Input.Pointer) {
    const it = this.inventory[this.heldIndex];
    if (!it) return;
    this.inventory[this.heldIndex] = null;
    this.drawInventoryUI();

    const cam = this.cameras.main;
    const tx = pointer.x + cam.scrollX;
    const ty = pointer.y + cam.scrollY;
    const ang = Math.atan2(ty - this.player.y, tx - this.player.x);
    const vx = Math.cos(ang) * THROW_SPEED;
    const vy = Math.sin(ang) * THROW_SPEED;

    const colors: Record<ItemKind, number> = { normal: 0x88aa88, unidentified: 0xaa44ff, weapon: 0xff8800 };
    const sprite = this.add.rectangle(this.player.x, this.player.y, 14, 14, colors[it.kind]);
    sprite.setStrokeStyle(1, 0xffffff);
    sprite.setDepth(6);
    this.flyingItems.push({ item: it, sprite, vx, vy, life: THROW_LIFETIME });
  }

  private updateFlyingItems(delta: number) {
    const dt = delta / 1000;
    for (let i = this.flyingItems.length - 1; i >= 0; i--) {
      const fi = this.flyingItems[i];
      fi.sprite.x += fi.vx * dt;
      fi.sprite.y += fi.vy * dt;
      fi.life -= delta;

      // 碰墙停下
      if (this.collidesWithObstacle(fi.sprite.x, fi.sprite.y, 7)) {
        fi.vx = 0; fi.vy = 0;
      }

      // 碰怪物 → 效果
      let hit = false;
      for (const m of this.monsters) {
        if (m.stunTimer > 0) continue;
        const d = Phaser.Math.Distance.Between(fi.sprite.x, fi.sprite.y, m.sprite.x, m.sprite.y);
        if (d < 22) {
          this.applyThrowEffect(fi.item, m);
          hit = true;
          break;
        }
      }

      if (hit || fi.life <= 0) {
        // 没砸中→掉3成，砸中→碎了
        if (!hit) {
          const dropped = { ...fi.item };
          if (dropped.condition === 10) dropped.condition = 7;
          else if (dropped.condition === 7) dropped.condition = 4;
          else if (dropped.condition === 4) dropped.condition = 0;
          if (dropped.condition > 0) {
            // 未鉴定物品落地后仍然是未鉴定，不揭晓
            this.spawnGroundItem(dropped, fi.sprite.x, fi.sprite.y);
          }
        }
        fi.sprite.destroy();
        this.flyingItems.splice(i, 1);
      }
    }
  }

  private applyThrowEffect(item: Item, monster: Monster) {
    // 砸中→眩晕
    let stun = 2000;
    if (item.kind === 'weapon' && item.weaponKind) {
      switch (item.weaponKind) {
        case 'trophy': stun = 2000; break;
        case 'dagger': stun = 2000; break;
        case 'flare': stun = 5000; monster.isChasing = false; break; // 吓退
        case 'rope': stun = 3000; break;
      }
    }
    monster.stunTimer = stun;
    monster.isChasing = true;
    monster.giveUpTimer = monster.giveUpDuration;
    this.showMessage(`💥 ${item.name} 砸中！眩晕${(stun / 1000).toFixed(0)}秒`, 1500);
  }

  // ─── Monsters ───────────────────────────────────────────────

  private alertHearingMonsters(x: number, y: number, range: number) {
    for (const m of this.monsters) {
      if (m.kind !== 'judge') continue;
      const d = Phaser.Math.Distance.Between(x, y, m.sprite.x, m.sprite.y);
      if (d < range) {
        m.isChasing = true;
        m.giveUpTimer = m.giveUpDuration;
      }
    }
  }

  private updateMonsters(delta: number) {
    const dt = delta / 1000;
    for (const m of this.monsters) {
      if (m.stunTimer > 0) { m.stunTimer -= delta; continue; }
      if (m.attackCooldown > 0) m.attackCooldown -= delta;

      const distToPlayer = Phaser.Math.Distance.Between(m.sprite.x, m.sprite.y, this.player.x, this.player.y);

      // 感知
      let canSense = false;
      if (m.kind === 'ghost') {
        // 视线（躲藏时看不到）
        if (!this.isHidden && distToPlayer < m.senseRange && !this.lineBlockedByObstacle(m.sprite.x, m.sprite.y, this.player.x, this.player.y)) {
          canSense = true;
        }
      } else {
        // 听觉：跑/走/敲盒有声，蹲走无声
        if (distToPlayer < m.senseRange) {
          if (this.isSprinting || this.spaceKey.isDown) canSense = true;
          else if (!this.isSneaking && (this.cursors.left?.isDown || this.cursors.right?.isDown || this.cursors.up?.isDown || this.cursors.down?.isDown
            || this.wasdKeys.W.isDown || this.wasdKeys.A.isDown || this.wasdKeys.S.isDown || this.wasdKeys.D.isDown)) {
            // 走动声较小，近距离才听到
            if (distToPlayer < m.senseRange * 0.5) canSense = true;
          }
        }
      }

      if (canSense) {
        m.isChasing = true;
        m.giveUpTimer = m.giveUpDuration;
      } else if (m.isChasing) {
        m.giveUpTimer -= delta;
        // 超出领地也放弃
        const distFromHome = Phaser.Math.Distance.Between(m.sprite.x, m.sprite.y, m.homeX, m.homeY);
        if (m.giveUpTimer <= 0 || (m.kind === 'ghost' && distFromHome > GHOST_TERRITORY)) {
          m.isChasing = false;
          if (m.kind === 'judge') m.isListening = false;
        }
      }

      // 移动
      if (m.isChasing) {
        const dx = this.player.x - m.sprite.x;
        const dy = this.player.y - m.sprite.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const sp = m.kind === 'judge' ? (this.isSneaking ? m.chaseSpeed * 0.5 : m.chaseSpeed) : m.chaseSpeed;
          const newX = m.sprite.x + (dx / len) * sp * dt;
          const newY = m.sprite.y + (dy / len) * sp * dt;
          if (!this.collidesWithObstacle(newX, m.sprite.y, 12)) m.sprite.x = newX;
          if (!this.collidesWithObstacle(m.sprite.x, newY, 12)) m.sprite.y = newY;
        }
      } else if (m.kind === 'ghost') {
        // 巡逻
        m.patrolTimer -= delta;
        if (m.patrolTimer <= 0) {
          m.direction = new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize();
          m.patrolTimer = Phaser.Math.Between(2000, 4000);
        }
        const newX = m.sprite.x + m.direction.x * m.speed * dt;
        const newY = m.sprite.y + m.direction.y * m.speed * dt;
        const distHome = Phaser.Math.Distance.Between(newX, newY, m.homeX, m.homeY);
        if (distHome < 350 && !this.collidesWithObstacle(newX, newY, 12)) {
          m.sprite.x = newX; m.sprite.y = newY;
        } else {
          m.direction.negate();
        }
      } else {
        // judge 巡逻路线
        if (m.patrolRoute.length === 0) continue;
        const target = m.patrolRoute[m.patrolIndex];
        const dx = target.x - m.sprite.x;
        const dy = target.y - m.sprite.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 20) {
          m.patrolIndex = (m.patrolIndex + 1) % m.patrolRoute.length;
          // 到点停步听2秒
          m.isListening = true;
          m.listenTimer = 2000;
        } else if (!m.isListening) {
          const newX = m.sprite.x + (dx / d) * m.speed * dt;
          const newY = m.sprite.y + (dy / d) * m.speed * dt;
          if (!this.collidesWithObstacle(newX, m.sprite.y, 12)) m.sprite.x = newX;
          if (!this.collidesWithObstacle(m.sprite.x, newY, 12)) m.sprite.y = newY;
        }
        if (m.isListening) {
          m.listenTimer -= delta;
          if (m.listenTimer <= 0) m.isListening = false;
        }
      }
    }
  }

  private checkMonsterCollision() {
    if (this.damageCooldown > 0) return;
    if (this.isHidden) return; // 躲藏时不会受到伤害
    for (const m of this.monsters) {
      if (m.stunTimer > 0) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, m.sprite.x, m.sprite.y);
      if (d < 28) {
        const dmg = m.kind === 'judge' ? 25 : 15;
        this.health -= dmg;
        this.damageCooldown = 1000;
        m.attackCooldown = m.kind === 'judge' ? 1500 : 1000;
        this.showMessage(`💥 被${m.kind === 'judge' ? '掌声判定者' : '群演幽灵'}攻击！-${dmg}生命`, 1500);
        this.updateHealthUI();
        if (this.health <= 0) this.die(`被${m.kind === 'judge' ? '掌声判定者' : '群演幽灵'}咬死`);
        break;
      }
    }
  }

  // ─── Escape ─────────────────────────────────────────────────

  private checkMerchantEscape() {
    // 在商人旁且钱够 → 提示已显示在updatePrompts，撤离靠E键
  }

  private escape() {
    this.isEscaped = true;
    this.showMessage(`🎉 撤离成功！\n\n总计: ¥${this.money}\n目标: ¥${GOAL_MONEY} ✅\n\n按ESC返回菜单`, 999999);
  }

  private die(cause: string) {
    this.isDead = true;
    this.showMessage(`💀 ${cause}\n\n最终: ¥${this.money}\n\n按ESC返回菜单`, 999999);
  }
}
