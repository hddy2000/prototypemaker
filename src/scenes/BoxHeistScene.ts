import Phaser from 'phaser';

// ─── Data types ──────────────────────────────────────────────

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

type BoxSize = 'small' | 'large';

interface BoxSizeConfig {
  name: string;
  color: number;
  borderColor: number;
  size: number;
  maxHp: number;
  glowColor: number;
}

const BOX_SIZE_CONFIG: Record<BoxSize, BoxSizeConfig> = {
  small: { name: '小盒子', color: 0x8a6a3a, borderColor: 0xaa8a5a, size: 26, maxHp: 3, glowColor: 0x665533 },
  large: { name: '大盒子', color: 0x4a2a1a, borderColor: 0x6a4a2a, size: 40, maxHp: 6, glowColor: 0x884422 },
};

interface GameBox {
  x: number;
  y: number;
  size: BoxSize;
  hp: number;
  maxHp: number;
  pixelSize: number;
  isOpen: boolean;
  sprite: Phaser.GameObjects.Container;
  crackSprite: Phaser.GameObjects.Graphics;
  glowSprite: Phaser.GameObjects.Graphics;
  isHeld: boolean;
  isFlying: boolean;
  // 掉落表（预先掷出）
  dropType: DropType;
  dropValue: number;       // 钱/未鉴定物的价值
}

// ─── Drop types ──────────────────────────────────────────────

type DropType = 'money' | 'grenade' | 'unidentified' | 'medkit';

// 小盒子掉落概率: [钱, 手雷, 未鉴定, 急救包]
const SMALL_DROP_TABLE: [number, number, number, number] = [0.45, 0.25, 0.15, 0.15];
// 大盒子只掉未鉴定物
const LARGE_DROP_TABLE: [number, number, number, number] = [0, 0, 1, 0];

const MEDKIT_HEAL = 40;
const MEDKIT_RADIUS = 70;
const MEDKIT_ZONE_LIFE = 3500;

// ─── Ground item (掉落在地上的东西) ──────────────────────────

interface GroundItem {
  x: number;
  y: number;
  dropType: DropType;
  value: number;          // 钱 / 未鉴定物真实价值
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
}

// ─── Flying object (投掷的盒子/手雷/钱币) ────────────────────

interface FlyingObject {
  sprite: Phaser.GameObjects.Container;
  vx: number;
  vy: number;
  life: number;
  isBox: boolean;
  box?: GameBox;
  isGrenade?: boolean;
  isMoney?: boolean;       // 投掷的钱币
  isMedkit?: boolean;
  item?: GroundItem;       // 投出的普通道具
  bounces: number;
  maxBounces: number;
}

// ─── Monster (冲撞怪) ───────────────────────────────────────

interface Monster {
  sprite: Phaser.GameObjects.Rectangle;
  homeX: number;
  homeY: number;
  patrolTimer: number;
  patrolDir: Phaser.Math.Vector2;
  isChasing: boolean;
  giveUpTimer: number;
  // 冲撞状态机
  state: 'patrol' | 'alert' | 'charge' | 'stunned' | 'recovery';
  stateTimer: number;     // 当前状态剩余计时(ms)
  chargeDir: Phaser.Math.Vector2;
  hitPlayerThisCharge: boolean;
  hp: number;
  alive: boolean;
}

// ─── Appraisal machine (鉴定机) ──────────────────────────────

interface AppraisalMachine {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
}

// ─── Constants ───────────────────────────────────────────────

const PLAYER_BASE_SPEED = 160;
const PLAYER_SPRINT_SPEED = 260;
const STAMINA_MAX = 100;
const STAMINA_DRAIN_RATE = 35;
const STAMINA_REGEN_RATE = 20;

const BOX_PICKUP_RANGE = 50;
const ITEM_PICKUP_RANGE = 40;
const THROW_SPEED = 450;
const THROW_LIFETIME = 2000;
const INVENTORY_SIZE = 3;
const APPRAISAL_RANGE = 60;
const EXTRACTION_RANGE = 50;
const MONSTER_COUNT = 4;
const APPRAISAL_MACHINE_COUNT = 4;
const GOAL_MONEY = 1000;

const MONSTER_SPEED = 160;       // 巡逻=玩家走路速度
const MONSTER_VISION = 200;
const MONSTER_ALERT_TIME = 1000;  // 前摇1秒
const MONSTER_CHARGE_SPEED = 320; // 冲撞速度（快于玩家走路）
const MONSTER_CHARGE_TIME = 600;  // 冲撞持续600ms
const MONSTER_STUN_TIME = 1500;   // 冲撞后眩晕
const MONSTER_RECOVERY_TIME = 800;// 恢复
const MONSTER_HP = 3;

const PLAYER_MAX_HP = 100;
const MONSTER_CHARGE_DAMAGE = 50;
const MONEY_THROW_COST = 1;      // 每次扔钱消耗
const MONEY_THROW_DAMAGE = 1;    // 钱币伤害
const MONEY_THROW_SPEED = 500;
const MONEY_THROW_LIFE = 1200;
const GRENADE_LIFE = 1000;
const GRENADE_RADIUS = 80;
const GRENADE_DAMAGE = 6;

// ─── Scene ────────────────────────────────────────────────────

export class BoxHeistScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;

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
  private fogTextureKey = 'boxHeistFog';
  private viewRadius = 200;
  private screenW = 800;
  private screenH = 600;

  // Game objects
  private boxes: GameBox[] = [];
  private groundItems: GroundItem[] = [];
  private flyingObjects: FlyingObject[] = [];
  private monsters: Monster[] = [];
  private appraisalMachines: AppraisalMachine[] = [];
  private smashEffects: { sprite: Phaser.GameObjects.Graphics; life: number }[] = [];
  private explosions: { sprite: Phaser.GameObjects.Graphics; life: number; maxLife: number }[] = [];
  private healingZones: { x: number; y: number; sprite: Phaser.GameObjects.Graphics; life: number }[] = [];

  // Player state
  private heldBox: GameBox | null = null;
  private inventory: (GroundItem | null)[] = [null, null, null];
  private selectedSlot: number | null = null;
  private money = 0;
  private stamina = STAMINA_MAX;
  private playerHp = PLAYER_MAX_HP;
  private isSprinting = false;
  private playerFacingAngle = 0;

  // Extraction
  private isEscaped = false;
  private isDead = false;
  private extractionLabel!: Phaser.GameObjects.Text;

  // UI
  private moneyText!: Phaser.GameObjects.Text;
  private boxCountText!: Phaser.GameObjects.Text;
  private staminaBar!: Phaser.GameObjects.Graphics;
  private hpBar!: Phaser.GameObjects.Graphics;
  private heldText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private inventorySlots: Phaser.GameObjects.Container[] = [];
  private inventorySlotBgs: Phaser.GameObjects.Rectangle[] = [];
  private inventorySlotTexts: Phaser.GameObjects.Text[] = [];

  // Throttle
  private fogThrottle = 0;
  private uiThrottle = 0;

  // Sound
  private smashSound!: Phaser.Sound.BaseSound;

  // Message timer
  private messageTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super({ key: 'BoxHeistScene' });
  }

  create() {
    // ⚠️ 重置所有状态
    this.resetState();

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateBuilding();
    this.drawMap();
    this.createPlayer();
    this.createBoxes();
    this.createMonsters();
    this.createAppraisalMachines();
    this.createExtractionZone();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    // 音效
    this.smashSound = this.sound.add('boxSmash', { volume: 0.5 });

    this.showMessage(
      '📦 砸盒劫案\n\n' +
      '砸小盒子 → 捡钱/手雷/急救包/未鉴定物\n' +
      '大盒子蛮力打不开！扔钱币或手雷炸开！\n' +
      '空手右键 = 扔钱币(¥20) 打怪/砸大盒\n' +
      '急救包放入道具栏，拿在手上左键砸开或右键扔出生成回血区\n' +
      `攒够 ¥${GOAL_MONEY} → 回入口撤离！\n\n` +
      '左键 = 捡起/敲盒 | 右键 = 扔手持物品/钱币\n' +
      'Q = 放下 | E = 鉴定/撤离\n' +
      '123 = 切换道具栏 | Shift 疾跑 | ESC 菜单',
      8000
    );
  }

  private resetState() {
    this.obstacles = [];
    this.boxes = [];
    this.groundItems = [];
    this.flyingObjects = [];
    this.monsters = [];
    this.appraisalMachines = [];
    this.smashEffects = [];
    this.explosions = [];
    this.healingZones = [];
    this.heldBox = null;
    this.inventory = [null, null, null];
    this.selectedSlot = null;
    this.money = 0;
    this.stamina = STAMINA_MAX;
    this.playerHp = PLAYER_MAX_HP;
    this.isSprinting = false;
    this.playerFacingAngle = 0;
    this.isEscaped = false;
    this.isDead = false;
    this.inventorySlots = [];
    this.inventorySlotBgs = [];
    this.inventorySlotTexts = [];
    this.fogThrottle = 0;
    this.uiThrottle = 0;
    this.messageTimer = null;
    this.weaponIcon = null;
  }

  // ─── Map generation ─────────────────────────────────────────

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

    // 随机散落的小障碍物
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
    const smallCount = 25;
    const largeCount = 8;
    let placed = 0;
    let attempts = 0;

    while (placed < smallCount + largeCount && attempts < 2000) {
      attempts++;
      const isLarge = placed >= smallCount;
      const remaining = isLarge ? largeCount - (placed - smallCount) : smallCount - placed;
      if (remaining <= 0) { placed++; continue; }

      const x = Phaser.Math.Between(100, this.mapWidth - 100);
      const y = Phaser.Math.Between(100, this.mapHeight - 100);

      // 避开起点
      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 150) continue;

      // 不能在障碍物内部
      if (this.isInsideObstacle(x, y, 25)) continue;

      // 避开已有盒子
      let tooClose = false;
      for (const b of this.boxes) {
        if (Phaser.Math.Distance.Between(x, y, b.x, b.y) < 80) { tooClose = true; break; }
      }
      if (tooClose) continue;

      const size: BoxSize = isLarge ? 'large' : 'small';
      this.spawnBox(x, y, size);
      placed++;
    }
  }

  private spawnBox(x: number, y: number, size: BoxSize) {
    const cfg = BOX_SIZE_CONFIG[size];

    const container = this.add.container(x, y);
    container.setDepth(5);

    // 盒子主体
    const body = this.add.rectangle(0, 0, cfg.size, cfg.size, cfg.color, 1);
    body.setStrokeStyle(2, cfg.borderColor);
    container.add(body);

    // 盒子顶盖线
    const lid = this.add.rectangle(0, -cfg.size * 0.3, cfg.size, 3, cfg.borderColor, 0.8);
    container.add(lid);

    // 大盒子上锁标记
    if (size === 'large') {
      const lock = this.add.text(0, 0, '🔒', { fontSize: '14px' }).setOrigin(0.5);
      container.add(lock);
    }

    // 发光
    const glow = this.add.graphics();
    glow.fillStyle(cfg.glowColor, 0.1);
    glow.fillCircle(0, 0, cfg.size * 0.8);
    glow.setDepth(4.5);
    container.add(glow);

    // 裂纹图层
    const crack = this.add.graphics();
    crack.setDepth(5.5);
    container.add(crack);

    // 预先掷出掉落
    const dropType = this.rollDropType(size);
    let dropValue = 0;

    if (dropType === 'money') {
      dropValue = Phaser.Math.Between(20, 80);
    } else if (dropType === 'unidentified') {
      // 真实价值：可能是宝贝也可能是垃圾
      // 大盒子50%是宝贝，小盒子30%是宝贝
      const isTreasure = Math.random() < (size === 'large' ? 0.5 : 0.3);
      dropValue = isTreasure
        ? Phaser.Math.Between(size === 'large' ? 300 : 150, size === 'large' ? 800 : 500)
        : Phaser.Math.Between(5, 30);
    }

    const box: GameBox = {
      x, y,
      size,
      hp: cfg.maxHp,
      maxHp: cfg.maxHp,
      pixelSize: cfg.size,
      isOpen: false,
      sprite: container,
      crackSprite: crack,
      glowSprite: glow,
      isHeld: false,
      isFlying: false,
      dropType,
      dropValue,
    };

    this.boxes.push(box);
  }

  private rollDropType(size: BoxSize): DropType {
    const table = size === 'large' ? LARGE_DROP_TABLE : SMALL_DROP_TABLE;
    const roll = Math.random();
    let acc = 0;
    const types: DropType[] = ['money', 'grenade', 'unidentified', 'medkit'];
    for (let i = 0; i < 4; i++) {
      acc += table[i];
      if (roll < acc) return types[i];
    }
    return 'money';
  }

  private drawBoxCracks(box: GameBox) {
    box.crackSprite.clear();
    const ratio = 1 - box.hp / box.maxHp;
    if (ratio < 0.01) return;

    box.crackSprite.lineStyle(2, 0x000000, 0.8);
    const s = box.pixelSize / 2;
    const cracks = Math.floor(ratio * 6) + 1;
    for (let i = 0; i < cracks; i++) {
      const a = (i / cracks) * Math.PI * 2 + ratio * 0.5;
      box.crackSprite.beginPath();
      box.crackSprite.moveTo(0, 0);
      box.crackSprite.lineTo(Math.cos(a) * s * 0.85, Math.sin(a) * s * 0.85);
      box.crackSprite.strokePath();
    }

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

  // ─── Monsters ───────────────────────────────────────────────

  private createMonsters() {
    let placed = 0;
    let attempts = 0;

    while (placed < MONSTER_COUNT && attempts < 1000) {
      attempts++;
      const x = Phaser.Math.Between(200, this.mapWidth - 200);
      const y = Phaser.Math.Between(200, this.mapHeight - 200);

      // 避开起点
      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 400) continue;

      // 不能在障碍物内部
      if (this.isInsideObstacle(x, y, 20)) continue;

      // 避开已有怪物
      let tooClose = false;
      for (const m of this.monsters) {
        if (Phaser.Math.Distance.Between(x, y, m.homeX, m.homeY) < 400) { tooClose = true; break; }
      }
      if (tooClose) continue;

      this.spawnMonster(x, y);
      placed++;
    }
  }

  private spawnMonster(x: number, y: number) {
    const sprite = this.add.rectangle(x, y, 28, 28, 0xaa3333);
    sprite.setStrokeStyle(2, 0xff6666);
    sprite.setDepth(5);

    const monster: Monster = {
      sprite,
      homeX: x,
      homeY: y,
      patrolTimer: Phaser.Math.Between(1000, 3000),
      patrolDir: new Phaser.Math.Vector2(0, 0),
      isChasing: false,
      giveUpTimer: 0,
      state: 'patrol',
      stateTimer: 0,
      chargeDir: new Phaser.Math.Vector2(0, 0),
      hitPlayerThisCharge: false,
      hp: MONSTER_HP,
      alive: true,
    };

    this.monsters.push(monster);
  }

  // ─── Appraisal machines ─────────────────────────────────────

  private createAppraisalMachines() {
    let placed = 0;
    let attempts = 0;

    while (placed < APPRAISAL_MACHINE_COUNT && attempts < 1000) {
      attempts++;
      const x = Phaser.Math.Between(200, this.mapWidth - 200);
      const y = Phaser.Math.Between(200, this.mapHeight - 200);

      // 避开起点
      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 200) continue;

      // 不能在障碍物内部
      if (this.isInsideObstacle(x, y, 25)) continue;

      // 避开已有鉴定机
      let tooClose = false;
      for (const a of this.appraisalMachines) {
        if (Phaser.Math.Distance.Between(x, y, a.x, a.y) < 400) { tooClose = true; break; }
      }
      if (tooClose) continue;

      this.spawnAppraisalMachine(x, y);
      placed++;
    }
  }

  private spawnAppraisalMachine(x: number, y: number) {
    const container = this.add.container(x, y);
    container.setDepth(5);

    // 机器主体
    const body = this.add.rectangle(0, 0, 36, 36, 0x2a4a6a, 1);
    body.setStrokeStyle(2, 0x44aaff);
    container.add(body);

    // 屏幕
    const screen = this.add.rectangle(0, 0, 24, 18, 0x113355, 1);
    container.add(screen);

    // 标记
    const icon = this.add.text(0, 0, '🔍', { fontSize: '14px' }).setOrigin(0.5);
    container.add(icon);

    // 光晕
    const glow = this.add.graphics();
    glow.fillStyle(0x44aaff, 0.12);
    glow.fillCircle(0, 0, 30);
    container.add(glow);
    container.sendToBack(glow);

    const label = this.add.text(x, y - 30, '鉴定机', {
      fontSize: '12px', color: '#44aaff', backgroundColor: '#000000',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(6);

    this.appraisalMachines.push({ x, y, sprite: container, label });
  }

  // ─── Extraction zone ───────────────────────────────────────

  private createExtractionZone() {
    const x = 80;
    const y = 80;

    const container = this.add.container(x, y);
    container.setDepth(4);

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

  // ─── Fog of war ─────────────────────────────────────────────

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

    this.moneyText = this.add.text(16, 16, '💰 ¥0', {
      fontSize: '18px', color: '#ffdd00',
    }).setScrollFactor(0).setDepth(20);

    this.boxCountText = this.add.text(16, 40, '📦 剩余盒子: 0', {
      fontSize: '14px', color: '#aaaaaa',
    }).setScrollFactor(0).setDepth(20);

    this.add.text(16, 60, `🎯 目标: ¥${GOAL_MONEY}`, {
      fontSize: '14px', color: '#ff8844',
    }).setScrollFactor(0).setDepth(20);

    this.heldText = this.add.text(16, 80, '', {
      fontSize: '16px', color: '#ffffff', backgroundColor: '#222244',
      padding: { x: 6, y: 3 },
    }).setScrollFactor(0).setDepth(20);

    this.staminaBar = this.add.graphics();
    this.staminaBar.setScrollFactor(0).setDepth(20);

    this.hpBar = this.add.graphics();
    this.hpBar.setScrollFactor(0).setDepth(20);

    this.hintText = this.add.text(400, 560, '', {
      fontSize: '14px', color: '#ffffff', backgroundColor: '#000000',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 300, '', {
      fontSize: '20px', color: '#ffff00', backgroundColor: '#000000',
      padding: { x: 16, y: 8 }, align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setVisible(false);

    // 道具栏 UI (3格)
    const slotSize = 48;
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

    this.add.text(400, 585, 'WASD 移动 | 左键捡/敲/砸急救包 | 右键扔手持物 | Q 放下 | E 鉴定/撤离 | 123 切换 | Shift 疾跑 | ESC 菜单', {
      fontSize: '12px', color: '#666666',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
  }

  private showMessage(text: string, duration = 3000) {
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
    const moneyStr = `💰 ¥${this.money}`;
    if (this.moneyText.text !== moneyStr) this.moneyText.setText(moneyStr);

    const remaining = this.boxes.filter(b => !b.isOpen).length;
    const boxStr = `📦 剩余盒子: ${remaining}`;
    if (this.boxCountText.text !== boxStr) this.boxCountText.setText(boxStr);

    // 手持显示
    let heldStr = '';
    if (this.heldBox) {
      const cfg = BOX_SIZE_CONFIG[this.heldBox.size];
      heldStr = `手持: ${cfg.name} HP:${this.heldBox.hp}/${this.heldBox.maxHp}`;
    } else if (this.selectedSlot !== null && this.inventory[this.selectedSlot]) {
      heldStr = `手持: ${this.itemShortName(this.inventory[this.selectedSlot]!)} (右键扔出)`;
    } else {
      heldStr = this.money >= MONEY_THROW_COST ? `空手 (右键扔钱币 ¥${MONEY_THROW_COST})` : '空手';
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

    g.fillStyle(0x333333, 1);
    g.fillRect(barX, barY, barW, barH);

    const ratio = this.stamina / STAMINA_MAX;
    const color = this.isSprinting ? 0xff8800 : 0x44aa44;
    g.fillStyle(color, 1);
    g.fillRect(barX, barY, barW * ratio, barH);

    g.lineStyle(1, 0x666666, 1);
    g.strokeRect(barX, barY, barW, barH);
  }

  private drawHpBar() {
    const g = this.hpBar;
    g.clear();

    const barW = 200;
    const barH = 12;
    const barX = 16;
    const barY = 100;

    g.fillStyle(0x330000, 1);
    g.fillRect(barX, barY, barW, barH);

    const ratio = this.playerHp / PLAYER_MAX_HP;
    const color = ratio > 0.5 ? 0x44aa44 : ratio > 0.25 ? 0xffaa00 : 0xff2222;
    g.fillStyle(color, 1);
    g.fillRect(barX, barY, barW * ratio, barH);

    g.lineStyle(1, 0x666666, 1);
    g.strokeRect(barX, barY, barW, barH);
  }

  private drawInventoryUI() {
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const item = this.inventory[i];
      const bg = this.inventorySlotBgs[i];
      const txt = this.inventorySlotTexts[i];
      bg.setStrokeStyle(i === this.selectedSlot ? 3 : 1, i === this.selectedSlot ? 0xffdd00 : 0x4466aa);
      if (item) {
        let label = '';
        let color = 0x222244;
        if (item.dropType === 'grenade') {
          label = '💣';
          color = 0x2a4a2a;
        } else if (item.dropType === 'medkit') {
          label = '🏥';
          color = 0x4a2a2a;
        } else if (item.dropType === 'unidentified') {
          label = '❓???';
          color = 0x2a2a4a;
        }
        bg.setFillStyle(color, 0.7);
        if (txt.text !== label) txt.setText(label);
      } else {
        bg.setFillStyle(0x222244, 0.8);
        if (txt.text !== '') txt.setText('');
      }
    }
  }

  private updateHint() {
    let hint = '';

    // 撤离点
    const dExtract = Phaser.Math.Distance.Between(this.player.x, this.player.y, 80, 80);
    if (this.money >= GOAL_MONEY && dExtract < EXTRACTION_RANGE) {
      hint = '[E] 撤离！';
      if (this.hintText.text !== hint) this.hintText.setText(hint);
      return;
    } else if (this.money >= GOAL_MONEY) {
      hint = `🚪 回入口撤离！(距离${Math.round(dExtract)})`;
    }

    // 鉴定机
    for (const a of this.appraisalMachines) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y);
      if (d < APPRAISAL_RANGE) {
        const unidCount = this.countUnidentified();
        if (unidCount > 0) {
          hint = hint ? hint + ' | ' : '';
          hint += `[E] 鉴定${unidCount}个未鉴定物`;
        }
        break;
      }
    }

    // 附近有盒子可捡
    if (!this.heldBox) {
      const nearestBox = this.findNearestBox();
      if (nearestBox) {
        hint = hint ? hint + ' | ' : '';
        const cfg = BOX_SIZE_CONFIG[nearestBox.size];
        hint += `[左键] 捡起 ${cfg.name}`;
      }
      const nearestItem = this.findNearestItem();
      if (nearestItem) {
        hint = hint ? hint + ' | ' : '';
        hint += `[左键] 捡起 ${this.itemShortName(nearestItem)}`;
      }
    }

    // 手持盒子
    if (this.heldBox) {
      hint = `左键=敲盒子(${this.heldBox.hp}/${this.heldBox.maxHp}) | 右键=扔出 | Q=放下`;
    } else if (this.selectedSlot !== null && this.inventory[this.selectedSlot]) {
      hint = hint ? hint + ' | ' : '';
      const item = this.inventory[this.selectedSlot]!;
      hint += item.dropType === 'medkit' ? '左键=砸开急救包 | 右键=扔出急救包' : `右键=扔出${this.itemShortName(item)}`;
    } else if (this.money >= MONEY_THROW_COST) {
      hint = hint ? hint + ' | ' : '';
      hint += `右键=扔钱币(¥${MONEY_THROW_COST})`;
    }

    // 背包有东西
    if (!this.heldBox) {
      const hasInv = this.inventory.some(it => it !== null);
      if (hasInv) {
        hint = hint ? hint + ' | ' : '';
        hint += '123=切换道具/再按空手';
      }
    }

    if (this.hintText.text !== hint) this.hintText.setText(hint);
  }

  private itemShortName(item: GroundItem): string {
    if (item.dropType === 'money') return `¥${item.value}`;
    if (item.dropType === 'grenade') return '💣手雷';
    if (item.dropType === 'medkit') return '🏥急救包';
    return '❓未鉴定';
  }

  private countUnidentified(): number {
    let count = 0;
    for (const it of this.inventory) {
      if (it && it.dropType === 'unidentified') count++;
    }
    return count;
  }

  // ─── Input ──────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    this.input.mouse?.disableContextMenu();

    // 123 = 切换道具栏
    this.input.keyboard!.on('keydown-ONE', () => this.swapInventorySlot(0));
    this.input.keyboard!.on('keydown-TWO', () => this.swapInventorySlot(1));
    this.input.keyboard!.on('keydown-THREE', () => this.swapInventorySlot(2));

    // Q = 放下
    this.input.keyboard!.on('keydown-Q', () => this.dropHeld());

    // 鼠标
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isDead || this.isEscaped) return;

      if (pointer.leftButtonDown()) {
        if (this.heldBox) {
          this.smashHeldBox();
        } else if (this.selectedSlot !== null && this.inventory[this.selectedSlot]?.dropType === 'medkit') {
          this.smashMedkit();
        } else {
          this.tryPickup();
        }
      } else if (pointer.rightButtonDown()) {
        if (this.heldBox) {
          this.throwBox(pointer);
        } else if (this.selectedSlot !== null && this.inventory[this.selectedSlot]) {
          this.throwSelectedItem(pointer);
        } else {
          this.tryThrowMoney(pointer);
        }
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

    // E = 鉴定 / 撤离
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      // 撤离优先
      const atEntrance = Phaser.Math.Distance.Between(this.player.x, this.player.y, 80, 80) < EXTRACTION_RANGE;
      if (atEntrance && this.money >= GOAL_MONEY) {
        this.tryExtract();
        return;
      }
      // 鉴定
      this.tryAppraisal();
    }

    this.handlePlayerMovement(delta);
    this.updateMonsters(delta);
    this.updateFlyingObjects(delta);
    this.updateSmashEffects(delta);
    this.updateExplosions(delta);
    this.updateHealingZones(delta);
    this.updateBoxGlow(delta);

    // 节流
    this.fogThrottle += delta;
    if (this.fogThrottle >= 33) { this.fogThrottle = 0; this.updateFog(); }
    this.uiThrottle += delta;
    if (this.uiThrottle >= 100) {
      this.uiThrottle = 0;
      this.updateUI();
      this.updateHint();
      this.drawStaminaBar();
      this.drawHpBar();
      this.drawInventoryUI();
    }

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

    // 朝向跟随鼠标
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

    this.playerShadow.x = this.player.x;
    this.playerShadow.y = this.player.y + 14;
  }

  // ─── Pickup ─────────────────────────────────────────────────

  private tryPickup() {
    // 优先捡盒子
    if (!this.heldBox) {
      const nearestBox = this.findNearestBox();
      if (nearestBox) {
        this.heldBox = nearestBox;
        nearestBox.isHeld = true;
        nearestBox.sprite.setVisible(false);
        const cfg = BOX_SIZE_CONFIG[nearestBox.size];
        this.showMessage(`捡起 ${cfg.name}！\n左键敲 | 右键扔`, 1500);
        return;
      }
    }

    // 捡物品
    const nearestItem = this.findNearestItem();
    if (nearestItem) {
      // 钱 → 直接加钱，不进道具栏
      if (nearestItem.dropType === 'money') {
        this.money += nearestItem.value;
        nearestItem.collected = true;
        nearestItem.sprite.destroy();
        nearestItem.label.destroy();
        const idx = this.groundItems.indexOf(nearestItem);
        if (idx >= 0) this.groundItems.splice(idx, 1);
        this.showMessage(`💰 捡起 ¥${nearestItem.value}！\n总计: ¥${this.money}`, 1200);
        return;
      }

      // 手雷/急救包/未鉴定物 → 放入道具栏
      const emptySlot = this.inventory.indexOf(null);
      if (emptySlot >= 0) {
        this.inventory[emptySlot] = nearestItem;
        nearestItem.collected = true;
        nearestItem.sprite.setVisible(false);
        nearestItem.label.setVisible(false);
        const name = nearestItem.dropType === 'grenade' ? '💣手雷' : nearestItem.dropType === 'medkit' ? '🏥急救包' : '❓未鉴定物';
        this.showMessage(`捡起 ${name}！\n放入道具栏${emptySlot + 1}`, 1500);
        return;
      } else {
        this.showMessage('道具栏满了！', 1500);
        return;
      }
    }
  }

  // ─── Inventory swap ─────────────────────────────────────────

  private swapInventorySlot(slot: number) {
    if (slot < 0 || slot >= INVENTORY_SIZE) return;
    if (this.heldBox) return; // 手持盒子时不能切换
    if (!this.inventory[slot]) return;
    this.selectedSlot = this.selectedSlot === slot ? null : slot;
  }

  // ─── Smash (左键敲击手持盒子) ────────────────────────────────

  private smashHeldBox() {
    if (!this.heldBox) return;

    const box = this.heldBox;

    // 大盒子蛮力打不开
    if (box.size === 'large') {
      this.createSmashEffect(
        this.player.x + Math.cos(this.playerFacingAngle) * 25,
        this.player.y + Math.sin(this.playerFacingAngle) * 25
      );
      this.cam.shake(80, 0.003);
      this.showMessage('🔒 大盒子蛮力打不开！\n需要枪或手雷！', 1500);
      return;
    }

    // 小盒子：正常敲
    box.hp -= 1;
    this.drawBoxCracks(box);

    this.createSmashEffect(
      this.player.x + Math.cos(this.playerFacingAngle) * 25,
      this.player.y + Math.sin(this.playerFacingAngle) * 25
    );
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

    if (this.smashSound && !this.smashSound.isPlaying) {
      this.smashSound.play();
    }

    // 掉落物品
    this.spawnGroundItem(x, y, box.dropType, box.dropValue);

    const cfg = BOX_SIZE_CONFIG[box.size];
    let dropMsg = '';
    if (box.dropType === 'money') dropMsg = `掉出 ¥${box.dropValue}！`;
    else if (box.dropType === 'grenade') dropMsg = '掉出 💣手雷！';
    else if (box.dropType === 'medkit') dropMsg = '掉出 🏥急救包！';
    else dropMsg = '掉出 ❓未鉴定物！';

    this.showMessage(`💥 ${cfg.name}碎了！\n${dropMsg}\n左键捡起`, 2500);
    this.cam.shake(200, 0.008);
  }

  // ─── Throw (右键扔出) ───────────────────────────────────────

  private dropHeld() {
    if (this.heldBox) {
      const box = this.heldBox;
      this.heldBox = null;
      box.isHeld = false;
      const dropX = this.player.x + Math.cos(this.playerFacingAngle) * 35;
      const dropY = this.player.y + Math.sin(this.playerFacingAngle) * 35;
      box.x = Phaser.Math.Clamp(dropX, 30, this.mapWidth - 30);
      box.y = Phaser.Math.Clamp(dropY, 30, this.mapHeight - 30);
      box.sprite.setVisible(true);
      box.sprite.setPosition(box.x, box.y);
      this.showMessage(`放下 ${BOX_SIZE_CONFIG[box.size].name}`, 1000);
      return;
    }
    if (this.selectedSlot !== null) {
      const item = this.inventory[this.selectedSlot];
      if (!item) return;
      this.inventory[this.selectedSlot] = null;
      this.selectedSlot = null;
      this.dropGroundItem(item);
      this.showMessage(`放下 ${this.itemShortName(item)}`, 1000);
    }
  }

  private throwSelectedItem(pointer: Phaser.Input.Pointer) {
    if (this.selectedSlot === null) return;
    const item = this.inventory[this.selectedSlot];
    if (!item) return;
    this.inventory[this.selectedSlot] = null;
    this.selectedSlot = null;

    if (item.dropType === 'grenade') {
      this.throwGrenade(pointer);
      item.sprite.destroy();
      item.label.destroy();
      const idx = this.groundItems.indexOf(item);
      if (idx >= 0) this.groundItems.splice(idx, 1);
      return;
    }

    const cam = this.cameras.main;
    const ang = Math.atan2(pointer.y + cam.scrollY - this.player.y, pointer.x + cam.scrollX - this.player.x);
    item.sprite.setVisible(true).setPosition(this.player.x, this.player.y);
    item.label.setVisible(false);
    this.flyingObjects.push({
      sprite: item.sprite,
      vx: Math.cos(ang) * THROW_SPEED,
      vy: Math.sin(ang) * THROW_SPEED,
      life: item.dropType === 'medkit' ? 900 : THROW_LIFETIME,
      isBox: false,
      isMedkit: item.dropType === 'medkit',
      item,
      bounces: 0,
      maxBounces: 0,
    });
  }

  private smashMedkit() {
    if (this.selectedSlot === null) return;
    const item = this.inventory[this.selectedSlot];
    if (!item || item.dropType !== 'medkit') return;
    this.inventory[this.selectedSlot] = null;
    this.selectedSlot = null;
    this.openMedkit(item, this.player.x, this.player.y);
  }

  private openMedkit(item: GroundItem, x: number, y: number) {
    item.sprite.destroy();
    item.label.destroy();
    const idx = this.groundItems.indexOf(item);
    if (idx >= 0) this.groundItems.splice(idx, 1);

    const sprite = this.add.graphics().setDepth(4);
    sprite.fillStyle(0x44ff88, 0.25);
    sprite.fillCircle(0, 0, MEDKIT_RADIUS);
    sprite.lineStyle(3, 0x88ffbb, 0.9);
    sprite.strokeCircle(0, 0, MEDKIT_RADIUS);
    sprite.setPosition(x, y);
    this.healingZones.push({ x, y, sprite, life: MEDKIT_ZONE_LIFE });
  }

  private updateHealingZones(delta: number) {
    for (let i = this.healingZones.length - 1; i >= 0; i--) {
      const zone = this.healingZones[i];
      zone.life -= delta;
      zone.sprite.setAlpha(Math.max(0, zone.life / MEDKIT_ZONE_LIFE));
      if (this.playerHp < PLAYER_MAX_HP &&
          Phaser.Math.Distance.Between(this.player.x, this.player.y, zone.x, zone.y) <= MEDKIT_RADIUS) {
        const healed = Math.min(MEDKIT_HEAL, PLAYER_MAX_HP - this.playerHp);
        this.playerHp += healed;
        this.showMessage(`🏥 回血 +${healed}！HP: ${this.playerHp}/${PLAYER_MAX_HP}`, 1500);
        zone.sprite.destroy();
        this.healingZones.splice(i, 1);
      } else if (zone.life <= 0) {
        zone.sprite.destroy();
        this.healingZones.splice(i, 1);
      }
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

    box.sprite.setVisible(true);
    box.sprite.setPosition(this.player.x, this.player.y);

    this.flyingObjects.push({
      sprite: box.sprite,
      vx, vy,
      life: THROW_LIFETIME,
      isBox: true,
      box,
      bounces: 0,
      maxBounces: box.hp,
    });
  }

  // ─── Throw money (右键扔钱币) ──────────────────────────────

  private tryThrowMoney(pointer: Phaser.Input.Pointer) {
    if (this.money < MONEY_THROW_COST) {
      this.showMessage(`钱不够！需要 ¥${MONEY_THROW_COST}`, 1000);
      return;
    }

    this.money -= MONEY_THROW_COST;

    const cam = this.cameras.main;
    const tx = pointer.x + cam.scrollX;
    const ty = pointer.y + cam.scrollY;
    const ang = Math.atan2(ty - this.player.y, tx - this.player.x);
    const vx = Math.cos(ang) * MONEY_THROW_SPEED;
    const vy = Math.sin(ang) * MONEY_THROW_SPEED;

    // 创建钱币精灵
    const coinContainer = this.add.container(this.player.x, this.player.y);
    coinContainer.setDepth(6);
    const coinBody = this.add.circle(0, 0, 6, 0xffdd00);
    coinBody.setStrokeStyle(1, 0xffaa00);
    coinContainer.add(coinBody);

    this.flyingObjects.push({
      sprite: coinContainer,
      vx, vy,
      life: MONEY_THROW_LIFE,
      isBox: false,
      isMoney: true,
      bounces: 0,
      maxBounces: 0,
    });
  }

  // ─── Throw grenade (从道具栏扔手雷) ────────────────────────

  private throwGrenade(pointer: Phaser.Input.Pointer) {
    const cam = this.cameras.main;
    const tx = pointer.x + cam.scrollX;
    const ty = pointer.y + cam.scrollY;
    const ang = Math.atan2(ty - this.player.y, tx - this.player.x);
    const vx = Math.cos(ang) * THROW_SPEED;
    const vy = Math.sin(ang) * THROW_SPEED;

    // 创建手雷精灵
    const grenadeContainer = this.add.container(this.player.x, this.player.y);
    grenadeContainer.setDepth(6);
    const grenadeBody = this.add.circle(0, 0, 8, 0x44aa44);
    grenadeBody.setStrokeStyle(1, 0x88ff88);
    grenadeContainer.add(grenadeBody);

    this.flyingObjects.push({
      sprite: grenadeContainer,
      vx, vy,
      life: GRENADE_LIFE,
      isBox: false,
      isGrenade: true,
      bounces: 0,
      maxBounces: 0,
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

      // 更新盒子坐标
      if (fo.box) {
        fo.box.x = fo.sprite.x;
        fo.box.y = fo.sprite.y;
      }

      // 碰墙检测
      const hitWall = this.isInsideObstacle(fo.sprite.x, fo.sprite.y, 8);
      const hitBox = (fo.isGrenade || fo.isMedkit) && this.boxes.some(box =>
        !box.isOpen && !box.isHeld && !box.isFlying &&
        Phaser.Math.Distance.Between(fo.sprite.x, fo.sprite.y, box.x, box.y) < box.pixelSize / 2 + 8
      );

      if (fo.isMedkit && fo.item && (hitWall || hitBox || fo.life <= 0)) {
        const x = hitWall ? fo.sprite.x - fo.vx * dt : fo.sprite.x;
        const y = hitWall ? fo.sprite.y - fo.vy * dt : fo.sprite.y;
        this.openMedkit(fo.item, x, y);
        this.flyingObjects.splice(i, 1);
        continue;
      }

      if (fo.item && (hitWall || fo.life <= 0)) {
        const x = hitWall ? fo.sprite.x - fo.vx * dt : fo.sprite.x;
        const y = hitWall ? fo.sprite.y - fo.vy * dt : fo.sprite.y;
        fo.item.x = Phaser.Math.Clamp(x, 30, this.mapWidth - 30);
        fo.item.y = Phaser.Math.Clamp(y, 30, this.mapHeight - 30);
        fo.item.collected = false;
        fo.item.sprite.setPosition(fo.item.x, fo.item.y);
        fo.item.label.setPosition(fo.item.x, fo.item.y - 25).setVisible(true);
        this.flyingObjects.splice(i, 1);
        continue;
      }

      // 手雷碰盒子/墙或引信到期 → 爆炸
      if (fo.isGrenade && (hitWall || hitBox || fo.life <= 0)) {
        const x = hitWall ? fo.sprite.x - fo.vx * dt : fo.sprite.x;
        const y = hitWall ? fo.sprite.y - fo.vy * dt : fo.sprite.y;
        this.explodeGrenade(x, y);
        fo.sprite.destroy();
        this.flyingObjects.splice(i, 1);
        continue;
      }

      // 钱币到期 → 消失
      if (fo.isMoney && fo.life <= 0) {
        fo.sprite.destroy();
        this.flyingObjects.splice(i, 1);
        continue;
      }

      // 钱币碰墙 → 消失
      if (fo.isMoney && hitWall) {
        this.createSmashEffect(fo.sprite.x, fo.sprite.y);
        fo.sprite.destroy();
        this.flyingObjects.splice(i, 1);
        continue;
      }

      // 钱币碰怪物 → 伤害+眩晕
      if (fo.isMoney) {
        let hitM = false;
        for (const m of this.monsters) {
          if (!m.alive) continue;
          const d = Phaser.Math.Distance.Between(fo.sprite.x, fo.sprite.y, m.sprite.x, m.sprite.y);
          if (d < 20) {
            m.hp -= MONEY_THROW_DAMAGE;
            hitM = true;
            if (m.state !== 'stunned') {
              m.state = 'stunned';
              m.stateTimer = 500;
              m.sprite.setFillStyle(0x884444);
            }
            if (m.hp <= 0) {
              this.killMonster(m);
            }
            break;
          }
        }
        if (hitM) {
          this.createSmashEffect(fo.sprite.x, fo.sprite.y);
          fo.sprite.destroy();
          this.flyingObjects.splice(i, 1);
          continue;
        }

        // 钱币碰大盒子 → 伤害
        for (const box of this.boxes) {
          if (box.isOpen || box.isHeld || box.isFlying) continue;
          const d = Phaser.Math.Distance.Between(fo.sprite.x, fo.sprite.y, box.x, box.y);
          if (d < box.pixelSize / 2 + 6) {
            box.hp -= MONEY_THROW_DAMAGE;
            this.drawBoxCracks(box);
            this.createSmashEffect(fo.sprite.x, fo.sprite.y);
            if (box.hp <= 0) {
              this.breakBox(box, box.x, box.y);
            }
            fo.sprite.destroy();
            this.flyingObjects.splice(i, 1);
            break;
          }
        }
        continue;
      }

      // 飞行盒子碰盒子
      let flyingBoxHit = false;
      if (fo.isBox && fo.box) {
        const flyingBox = fo.box;
        for (const b of this.boxes) {
          if (b.isOpen || b.isHeld) continue;
          if (b === flyingBox) continue;
          const d = Phaser.Math.Distance.Between(fo.sprite.x, fo.sprite.y, b.x, b.y);
          if (d < (flyingBox.pixelSize + b.pixelSize) / 2) {
            flyingBoxHit = true;
            // 大盒子被飞行盒子撞也受损（但飞行的大盒子撞小盒子，小盒子受损）
            b.hp -= 1;
            this.drawBoxCracks(b);
            if (b.hp <= 0) {
              this.breakBox(b, b.x, b.y);
            }
            break;
          }
        }
      }

      // 飞行盒子碰怪物
      let hitMonster = false;
      if (fo.isBox && fo.box) {
        for (const m of this.monsters) {
          if (!m.alive) continue;
          const d = Phaser.Math.Distance.Between(fo.sprite.x, fo.sprite.y, m.sprite.x, m.sprite.y);
          if (d < 25) {
            hitMonster = true;
            // 砸中怪物：眩晕
            if (m.state !== 'stunned') {
              m.state = 'stunned';
              m.stateTimer = MONSTER_STUN_TIME;
              m.sprite.setFillStyle(0x884444);
            }
            break;
          }
        }
      }

      if (hitWall || flyingBoxHit || hitMonster) {
        // 飞行盒子掉耐久
        if (fo.isBox && fo.box) {
          fo.box.hp -= 1;
          this.drawBoxCracks(fo.box);
        }

        if (hitWall) {
          fo.vx *= -0.4;
          fo.vy *= -0.4;
          fo.sprite.x += fo.vx * dt * 2;
          fo.sprite.y += fo.vy * dt * 2;
        } else {
          fo.vx *= 0.3;
          fo.vy *= 0.3;
        }

        this.createSmashEffect(fo.sprite.x, fo.sprite.y);

        // 飞行盒子碎裂
        if (fo.isBox && fo.box && fo.box.hp <= 0) {
          this.breakBox(fo.box, fo.sprite.x, fo.sprite.y);
          this.flyingObjects.splice(i, 1);
          continue;
        }
      }

      // 超时落地
      if (fo.life <= 0) {
        if (fo.isBox && fo.box) {
          fo.box.x = fo.sprite.x;
          fo.box.y = fo.sprite.y;
          fo.box.isFlying = false;
          fo.box.sprite.setVisible(true);
        }
        this.flyingObjects.splice(i, 1);
      }
    }
  }

  // ─── Grenade explosion ─────────────────────────────────────

  private explodeGrenade(x: number, y: number) {
    // 爆炸特效
    const g = this.add.graphics();
    g.setDepth(8);
    g.fillStyle(0xff8800, 0.8);
    g.fillCircle(0, 0, GRENADE_RADIUS);
    g.setPosition(x, y);
    this.explosions.push({ sprite: g, life: 300, maxLife: 300 });

    this.cam.shake(300, 0.01);

    if (this.smashSound && !this.smashSound.isPlaying) {
      this.smashSound.play();
    }

    // 范围伤害怪物
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = Phaser.Math.Distance.Between(x, y, m.sprite.x, m.sprite.y);
      if (d < GRENADE_RADIUS) {
        m.hp -= GRENADE_DAMAGE;
        if (m.state !== 'stunned') {
          m.state = 'stunned';
          m.stateTimer = MONSTER_STUN_TIME;
          m.sprite.setFillStyle(0x884444);
        }
        if (m.hp <= 0) {
          this.killMonster(m);
        }
      }
    }

    // 范围伤害盒子
    for (const box of this.boxes) {
      if (box.isOpen || box.isHeld || box.isFlying) continue;
      const d = Phaser.Math.Distance.Between(x, y, box.x, box.y);
      if (d < GRENADE_RADIUS) {
        box.hp -= GRENADE_DAMAGE;
        this.drawBoxCracks(box);
        if (box.hp <= 0) {
          this.breakBox(box, box.x, box.y);
        }
      }
    }
  }

  private updateExplosions(delta: number) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life -= delta;
      const alpha = e.life / e.maxLife;
      e.sprite.setAlpha(alpha);
      e.sprite.setScale(1 + (1 - alpha) * 0.5);
      if (e.life <= 0) {
        e.sprite.destroy();
        this.explosions.splice(i, 1);
      }
    }
  }

  // ─── Monster AI ─────────────────────────────────────────────

  private updateMonsters(delta: number) {
    const dt = delta / 1000;

    for (const m of this.monsters) {
      if (!m.alive) continue;

      const distToPlayer = Phaser.Math.Distance.Between(m.sprite.x, m.sprite.y, this.player.x, this.player.y);

      switch (m.state) {
        case 'patrol': {
          // 巡逻：随机方向移动
          m.patrolTimer -= delta;
          if (m.patrolTimer <= 0) {
            const angle = Math.random() * Math.PI * 2;
            m.patrolDir.set(Math.cos(angle), Math.sin(angle));
            m.patrolTimer = Phaser.Math.Between(1500, 3500);
          }

          // 看到玩家 → 警觉前摇
          if (distToPlayer < MONSTER_VISION) {
            m.state = 'alert';
            m.stateTimer = MONSTER_ALERT_TIME;
            m.sprite.setFillStyle(0xff8800); // 橙色=警觉
            m.chargeDir.set(
              this.player.x - m.sprite.x,
              this.player.y - m.sprite.y
            ).normalize();
            break;
          }

          // 巡逻移动
          this.moveMonster(m, m.patrolDir.x * MONSTER_SPEED * dt, m.patrolDir.y * MONSTER_SPEED * dt);
          break;
        }

        case 'alert': {
          // 前摇1秒，原地不动，朝向玩家
          m.stateTimer -= delta;
          // 持续更新方向
          m.chargeDir.set(
            this.player.x - m.sprite.x,
            this.player.y - m.sprite.y
          ).normalize();

          // 闪烁效果
          const blink = Math.floor(m.stateTimer / 100) % 2 === 0;
          m.sprite.setFillStyle(blink ? 0xff8800 : 0xff4444);

          if (m.stateTimer <= 0) {
            m.state = 'charge';
            m.stateTimer = MONSTER_CHARGE_TIME;
            m.hitPlayerThisCharge = false;
            m.sprite.setFillStyle(0xff2222); // 红色=冲撞
          }

          // 如果玩家跑远了超出视野2倍，放弃
          if (distToPlayer > MONSTER_VISION * 2) {
            m.state = 'patrol';
            m.patrolTimer = 1000;
            m.sprite.setFillStyle(0xaa3333);
          }
          break;
        }

        case 'charge': {
          // 冲撞！快速直线冲向玩家
          m.stateTimer -= delta;
          this.moveMonster(m, m.chargeDir.x * MONSTER_CHARGE_SPEED * dt, m.chargeDir.y * MONSTER_CHARGE_SPEED * dt);

          // 命中后继续冲撞，但同一次冲撞只扣一次血
          if (m.state === 'charge' && !m.hitPlayerThisCharge &&
              Phaser.Math.Distance.Between(m.sprite.x, m.sprite.y, this.player.x, this.player.y) < 20) {
            m.hitPlayerThisCharge = true;
            this.playerHitByMonster();
          }

          if (m.stateTimer <= 0) {
            // 冲撞结束 → 眩晕
            m.state = 'stunned';
            m.stateTimer = MONSTER_STUN_TIME;
            m.sprite.setFillStyle(0x884444); // 暗红=眩晕
          }
          break;
        }

        case 'stunned': {
          // 眩晕不动
          m.stateTimer -= delta;
          if (m.stateTimer <= 0) {
            m.state = 'recovery';
            m.stateTimer = MONSTER_RECOVERY_TIME;
            m.sprite.setFillStyle(0xaa6633); // 棕黄=恢复
          }
          break;
        }

        case 'recovery': {
          // 恢复中不动
          m.stateTimer -= delta;
          if (m.stateTimer <= 0) {
            m.state = 'patrol';
            m.patrolTimer = 1000;
            m.sprite.setFillStyle(0xaa3333); // 恢复正常
          }
          break;
        }
      }

      // 回家逻辑（离出生点太远且不在追击/冲撞中）
      if (m.state === 'patrol') {
        const distHome = Phaser.Math.Distance.Between(m.sprite.x, m.sprite.y, m.homeX, m.homeY);
        if (distHome > 300) {
          const angle = Math.atan2(m.homeY - m.sprite.y, m.homeX - m.sprite.x);
          m.patrolDir.set(Math.cos(angle), Math.sin(angle));
        }
      }
    }
  }

  private moveMonster(m: Monster, dx: number, dy: number) {
    const halfSize = 14;

    if (dx !== 0) {
      const newX = m.sprite.x + dx;
      const edgeX = newX + (dx > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(edgeX, m.sprite.y - halfSize) &&
          !this.isObstacleAt(edgeX, m.sprite.y + halfSize)) {
        m.sprite.x = newX;
      } else {
        // 碰墙，触发状态变化
        if (m.state === 'charge') {
          m.state = 'stunned';
          m.stateTimer = MONSTER_STUN_TIME;
          m.sprite.setFillStyle(0x884444);
        }
      }
    }

    if (dy !== 0) {
      const newY = m.sprite.y + dy;
      const edgeY = newY + (dy > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(m.sprite.x - halfSize, edgeY) &&
          !this.isObstacleAt(m.sprite.x + halfSize, edgeY)) {
        m.sprite.y = newY;
      } else {
        if (m.state === 'charge') {
          m.state = 'stunned';
          m.stateTimer = MONSTER_STUN_TIME;
          m.sprite.setFillStyle(0x884444);
        }
      }
    }

    m.sprite.x = Phaser.Math.Clamp(m.sprite.x, 16, this.mapWidth - 16);
    m.sprite.y = Phaser.Math.Clamp(m.sprite.y, 16, this.mapHeight - 16);
  }

  private killMonster(m: Monster) {
    m.alive = false;
    m.sprite.setVisible(false);
    // 死亡特效
    this.createSmashEffect(m.sprite.x, m.sprite.y);
    this.cam.shake(200, 0.008);
    this.showMessage(`💀 击杀冲撞怪！\n剩余 ${this.monsters.filter(mo => mo.alive).length} 只`, 1500);
  }

  private playerHitByMonster() {
    if (this.isDead) return;
    this.playerHp -= MONSTER_CHARGE_DAMAGE;
    this.cam.shake(200, 0.008);
    if (this.playerHp <= 0) {
      this.playerHp = 0;
      this.isDead = true;
      this.cam.shake(500, 0.015);
      this.showMessage(`💀 被冲撞怪撞死！\n\n按ESC返回菜单`, 999999);
    } else {
      this.showMessage(`💥 被撞伤！HP -${MONSTER_CHARGE_DAMAGE}\n剩余 HP: ${this.playerHp}/${PLAYER_MAX_HP}`, 1500);
    }
  }

  // ─── Appraisal ─────────────────────────────────────────────

  private tryAppraisal() {
    for (const a of this.appraisalMachines) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y);
      if (d < APPRAISAL_RANGE) {
        // 鉴定所有未鉴定物品
        const msgs: string[] = [];
        let totalGain = 0;

        for (let i = 0; i < INVENTORY_SIZE; i++) {
          const item = this.inventory[i];
          if (item && item.dropType === 'unidentified') {
            // 揭晓价值
            if (item.value >= 100) {
              msgs.push(`✨ 宝贝！+¥${item.value}`);
            } else {
              msgs.push(`💩 废品... +¥${item.value}`);
            }
            totalGain += item.value;
            this.money += item.value;
            // 从背包移除
            this.inventory[i] = null;
            if (this.selectedSlot === i) this.selectedSlot = null;
            item.sprite.destroy();
            item.label.destroy();
            const idx = this.groundItems.indexOf(item);
            if (idx >= 0) this.groundItems.splice(idx, 1);
          }
        }

        if (msgs.length === 0) {
          this.showMessage('没有未鉴定的物品！', 1500);
          return;
        }

        this.showMessage(`🔍 鉴定 ${msgs.length} 件！\n${msgs.join('\n')}\n+¥${totalGain}`, 4000);

        // 检查是否达成目标
        if (this.money >= GOAL_MONEY) {
          this.showMessage(`🎉 目标达成！¥${this.money} / ${GOAL_MONEY}\n回入口撤离！`, 3000);
        }
        return;
      }
    }
  }

  // ─── Extraction ─────────────────────────────────────────────

  private tryExtract() {
    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, 80, 80);
    if (d > EXTRACTION_RANGE) return;

    if (this.money < GOAL_MONEY) {
      this.showMessage(`还差 ¥${GOAL_MONEY - this.money} 才能撤离！`, 2000);
      return;
    }

    this.isEscaped = true;
    this.extractionLabel.setText('✅ 已撤离');
    this.showMessage(`🎊 撤离成功！\n总计: ¥${this.money}\n\n按ESC返回菜单`, 999999);
  }

  // ─── Ground items ───────────────────────────────────────────

  private spawnGroundItem(x: number, y: number, dropType: DropType, value: number) {
    const container = this.add.container(x, y);
    container.setDepth(5);

    let color = 0xffdd00;
    let borderColor = 0xffaa00;
    let iconText = '';

    if (dropType === 'money') {
      color = 0xffdd00;
      borderColor = 0xffaa00;
      iconText = `💰${value}`;
    } else if (dropType === 'grenade') {
      color = 0x44aa44;
      borderColor = 0x88ff88;
      iconText = '💣';
    } else if (dropType === 'medkit') {
      color = 0xff4444;
      borderColor = 0xff8888;
      iconText = '🏥';
    } else if (dropType === 'unidentified') {
      color = 0x8844ff;
      borderColor = 0xaa66ff;
      iconText = '❓';
    }

    // 物品主体
    const gem = this.add.graphics();
    gem.fillStyle(color, 1);
    gem.beginPath();
    const r = 10;
    gem.moveTo(0, -r);
    gem.lineTo(r * 0.7, 0);
    gem.lineTo(0, r);
    gem.lineTo(-r * 0.7, 0);
    gem.closePath();
    gem.fillPath();
    gem.lineStyle(1, borderColor, 1);
    gem.strokePath();
    container.add(gem);

    // 发光
    const glow = this.add.graphics();
    glow.fillStyle(color, 0.2);
    glow.fillCircle(0, 0, 16);
    container.add(glow);
    container.sendToBack(glow);

    // 标签
    const label = this.add.text(x, y - 25, iconText, {
      fontSize: '14px', color: '#ffdd00', backgroundColor: '#000000',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(6);

    const item: GroundItem = {
      x, y,
      dropType,
      value,
      collected: false,
      sprite: container,
      label,
    };

    this.groundItems.push(item);
  }

  private dropGroundItem(item: GroundItem) {
    const dropX = this.player.x + Math.cos(this.playerFacingAngle) * 35;
    const dropY = this.player.y + Math.sin(this.playerFacingAngle) * 35;
    item.x = Phaser.Math.Clamp(dropX, 30, this.mapWidth - 30);
    item.y = Phaser.Math.Clamp(dropY, 30, this.mapHeight - 30);
    item.collected = false;
    item.sprite.setVisible(true);
    item.label.setVisible(true);
    item.sprite.setPosition(item.x, item.y);
    item.label.setPosition(item.x, item.y - 25);
  }

  // ─── Smash effects ─────────────────────────────────────────

  private createSmashEffect(x: number, y: number) {
    if (this.smashSound && !this.smashSound.isPlaying) {
      this.smashSound.play();
    }

    const g = this.add.graphics();
    g.setDepth(8);

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
      const cfg = BOX_SIZE_CONFIG[b.size];
      const pulse = b.size === 'large' ? 0.12 + Math.sin(t * 2) * 0.08 : 0.05 + Math.sin(t * 3) * 0.03;
      b.glowSprite.clear();
      b.glowSprite.fillStyle(cfg.glowColor, pulse);
      b.glowSprite.fillCircle(0, 0, b.pixelSize * 0.8);
    }
  }

  // ─── Held position update ──────────────────────────────────

  private weaponIcon: Phaser.GameObjects.Text | null = null;

  private updateHeldPosition() {
    if (this.heldBox) {
      this.heldBox.sprite.setVisible(true);
      this.heldBox.sprite.setPosition(this.player.x, this.player.y - 25);
    }
    // 手持道具或空手时的钱币图标跟随玩家头顶
    const selectedItem = this.selectedSlot !== null ? this.inventory[this.selectedSlot] : null;
    if (!this.heldBox && (selectedItem || this.money >= MONEY_THROW_COST)) {
      if (!this.weaponIcon) {
        this.weaponIcon = this.add.text(0, 0, '', {
          fontSize: '16px',
        }).setOrigin(0.5).setDepth(6);
      }
      this.weaponIcon.setText(selectedItem ? (selectedItem.dropType === 'grenade' ? '💣' : selectedItem.dropType === 'medkit' ? '🏥' : '❓') : '💰');
      this.weaponIcon.setVisible(true);
      this.weaponIcon.setPosition(this.player.x, this.player.y - 25);
    } else if (this.weaponIcon) {
      this.weaponIcon.setVisible(false);
    }
  }

  // ─── Finders ───────────────────────────────────────────────

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
