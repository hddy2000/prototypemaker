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
  kind: 'closet' | 'stall' | 'locker';
  occupied: boolean;
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
  attackCooldown: number; // 攻击后的停顿计时
  returnHomeTimer: number; // 失去目标后强制回家的计时
  lastSeenX: number; // 最后看到玩家的位置
  lastSeenY: number;
  hasLastSeen: boolean; // 是否有最后已知位置
  searchingTimer: number; // 到达最后已知位置后的搜索时间
  spawnDelay: number; // 刷出后原地停留时间（jumpscare 期间），>0 时不移动不追击
  // ── 陷阱型怪物字段 ──
  isTrap: boolean;       // 是否为陷阱型怪物（贴墙、隐身、走近现身突袭）
  trapState: 'hidden' | 'revealing'; // 陷阱状态机（只有一次机会，攻击后消失）
  trapTimer: number;     // 当前状态的剩余计时(ms)
  wallAngle: number;    // 贴墙朝向（弧度），用于绘制朝向
  // ── 特殊怪字段 ──
  isSpawner: boolean;    // 挖石头召唤出的特殊怪，快速追击
  alertTimer: number;    // 发现玩家时的警觉闪烁计时，>0 时原地闪红不移动
  // ── 炮塔型怪物字段 ──
  isTurret: boolean;     // 是否为炮塔型怪物（大范围巡逻，发现玩家后原地吐子弹远程攻击，不追击）
  turretState: 'patrol' | 'alert' | 'shooting' | 'cooldown'; // 炮塔状态机
  turretTimer: number;   // 当前状态的剩余计时(ms)
  turretShootTimer: number; // 射击间隔计时
  turretPatrolRadius: number; // 巡逻范围（很大）
  // ── 抓捕型怪物字段 ──
  isGrabbler: boolean;   // 是否为抓捕型怪物（大体形，抓住玩家拖到随机地点扔下掉血，然后长CD）
  grabblerState: 'patrol' | 'grabbing' | 'dragging' | 'dropping' | 'recovery'; // 抓捕状态机
  grabblerTimer: number; // 当前状态的剩余计时(ms)
  grabblerTargetX: number; // 拖拽目标点X
  grabblerTargetY: number; // 拖拽目标点Y
  grabblerDragSpeed: number; // 拖拽速度
}

interface Bullet {
  sprite: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
  life: number;     // 剩余存活时间(ms)
  damage: number;
  active: boolean;
}

interface Stain {
  x: number;
  y: number;
  radius: number;
  faces: { cleanliness: number; cleaned: boolean }[]; // 3面，每面 100=脏 0=净
  cleaned: boolean;        // 三面全清
  faceSprites: Phaser.GameObjects.Graphics[];  // 3面石皮弧形
  innerSprite: Phaser.GameObjects.Graphics;  // 石芯（隐藏宝石）
  onWall: boolean;
  // ── 赌石字段 ──
  stoneType: StoneType;
  stoneValue: number;     // 预先掷出的真实价值（0 = 非价值石）
  revealStage: number;    // 0=未开始 1=第一面线索 2=第二面线索 3=完全揭晓
  cursed: boolean;        // 完全揭晓时触发负面效果
  faceOffset: number;     // 随机旋转偏移，让每块石头3面朝向不同
}

interface Loot {
  x: number;
  y: number;
  type: LootType;
  value: number;
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
}

type StoneType = 'trash' | 'common' | 'good' | 'rare' | 'legendary' | 'medkit' | 'shield' | 'bomb';
type LootType = StoneType;

interface StoneTier {
  type: StoneType;
  color: number;       // 内部颜色
  glowColor: number;   // 发光色
  name: string;
  minVal: number;
  maxVal: number;
  weight: number;
  clue1: string;       // 30% 清洗时的线索
  clue2: string;       // 60% 清洗时的线索
  isUtility: boolean;  // medkit/shield = true（无价值，有功能效果）
}

const STONE_TIERS: StoneTier[] = [
  { type: 'trash',     color: 0x555555, glowColor: 0x666666, name: '废料',   minVal: 5,   maxVal: 15,   weight: 40, clue1: '只看到暗灰色的石质…',           clue2: '灰色偏暗，裂纹很多…',           isUtility: false },
  { type: 'common',    color: 0xddccaa, glowColor: 0xddccaa, name: '普通石', minVal: 20,  maxVal: 50,   weight: 25, clue1: '隐约有些米白色的光泽…',         clue2: '白色石质，看起来一般…',         isUtility: false },
  { type: 'good',      color: 0x44dd44, glowColor: 0x44ff44, name: '好玉',   minVal: 80,  maxVal: 150,  weight: 15, clue1: '透出一丝淡绿色！有戏！',         clue2: '绿色清晰，品质不错！',         isUtility: false },
  { type: 'rare',      color: 0x00cc44, glowColor: 0x00ff44, name: '极品玉', minVal: 200, maxVal: 500,  weight: 8,  clue1: '绿色越来越明显！感觉不错！',     clue2: '鲜艳的绿色！很可能值钱！',     isUtility: false },
  { type: 'legendary', color: 0x00ff44, glowColor: 0x00ff88, name: '帝王绿', minVal: 800, maxVal: 1200, weight: 4,  clue1: '浓郁的翠绿色光泽！可能是极品！', clue2: '帝王绿色！这是极品中的极品！', isUtility: false },
  { type: 'medkit',    color: 0xff4444, glowColor: 0xff6666, name: '药石',   minVal: 0,   maxVal: 0,    weight: 5,  clue1: '隐约有些米白色的光泽…',         clue2: '白色石质，看起来一般…',         isUtility: true },
  { type: 'shield',    color: 0x44aaff, glowColor: 0x66ccff, name: '盾石',   minVal: 0,   maxVal: 0,    weight: 3,  clue1: '隐约有些米白色的光泽…',         clue2: '白色石质，看起来一般…',         isUtility: true },
  { type: 'bomb',      color: 0xff8800, glowColor: 0xffaa00, name: '雷石',   minVal: 0,   maxVal: 0,    weight: 4,  clue1: '隐约有些米白色的光泽…',         clue2: '白色石质，看起来一般…',         isUtility: true },
];

const STONE_TIERS_TOTAL_WEIGHT = STONE_TIERS.reduce((s, t) => s + t.weight, 0);
const CURSED_CHANCE = 0.15; // 15% 的价值石是诅咒石

const LOOT_INFO: Record<LootType, { color: number; name: string; label: string }> = {
  trash:     { color: 0x555555, name: '废料',   label: '🪨' },
  common:    { color: 0xddccaa, name: '普通石', label: '⚪' },
  good:      { color: 0x44dd44, name: '好玉',   label: '🟢' },
  rare:      { color: 0x00cc44, name: '极品玉', label: '💎' },
  legendary: { color: 0x00ff44, name: '帝王绿', label: '👑' },
  medkit:    { color: 0xff4444, name: '药石',   label: '🔴' },
  shield:    { color: 0x44aaff, name: '盾石',   label: '🛡' },
  bomb:      { color: 0xff8800, name: '雷石',   label: '💥' },
};

// 负面效果表（诅咒石触发）
type NegativeType = 'spawn_monster' | 'alarm' | 'blind' | 'slow';
const NEGATIVE_TABLE: { type: NegativeType; weight: number }[] = [
  { type: 'spawn_monster', weight: 60 },
  { type: 'alarm',         weight: 20 },
  { type: 'blind',         weight: 15 },
  { type: 'slow',          weight: 5 },
];

// ─── Constants: sprint & stamina ─────────────────────────────
const PLAYER_BASE_SPEED = 160;
const PLAYER_SPRINT_SPEED = 260;
const STAMINA_MAX = 100;
const STAMINA_DRAIN_RATE = 35; // per second
const STAMINA_REGEN_RATE = 20; // per second
const STAMINA_SPRINT_MIN = 5;  // 低于此值不能起跑

// ─── Constants: hide & aggro ────────────────────────────────
const HIDE_LOSE_AGGRO_TIME = 3000; // 躲藏后3秒才脱仇恨
const HIDE_SPOT_RANGE = 40;       // 进入躲藏点的判定距离
const SPAWN_DELAY_MS = 3000;      // 刷出的怪原地停留时间（jumpscare 后再追玩家）

// ─── Constants: trap monsters ───────────────────────────────
const TRAP_REVEAL_RANGE = 50;    // 玩家进入攻击范围时陷阱才现身
const TRAP_REVEAL_DELAY = 1000;  // 现身后1秒突袭（无论距离）
const TRAP_STRIKE_RANGE = 50;    // 突袭命中范围
const TRAP_STRIKE_DAMAGE = 20;  // 突袭伤害

// ─── Constants: turret monsters (炮塔怪) ────────────────────
const TURRET_COLOR = 0x00cccc;       // 青色
const TURRET_ALERT_DURATION = 600;   // 发现玩家后闪光警觉时间(ms)
const TURRET_SHOOT_INTERVAL = 800;   // 每次射击间隔(ms)
const TURRET_SHOOT_DURATION = 4000;  // 射击阶段总时长(ms)，结束后进入冷却
const TURRET_COOLDOWN_DURATION = 3000; // 射击后冷却时间(ms)，原地不动
const TURRET_BULLET_SPEED = 200;     // 子弹速度
const TURRET_BULLET_DAMAGE = 10;     // 子弹伤害
const TURRET_BULLET_LIFE = 3000;     // 子弹存活时间(ms)
const TURRET_BULLET_RADIUS = 6;      // 子弹半径
const TURRET_PATROL_RADIUS = 600;    // 巡逻范围（很大）
const TURRET_VISION_RANGE = 250;     // 视野范围

// ─── Constants: grabbler monsters (抓捕怪) ──────────────────
const GRABBLER_COLOR = 0x8b4513;      // 棕色（大体形）
const GRABBLER_SIZE = 40;             // 大体形尺寸
const GRABBLER_VISION_RANGE = 200;    // 视野范围
const GRABBLER_CHASE_SPEED = 140;     // 追击速度（比玩家步行慢，疾跑可甩掉）
const GRABBLER_DRAG_SPEED = 180;       // 拖拽玩家速度
const GRABBLER_DROP_DAMAGE = 25;      // 扔下掉血
const GRABBLER_DROP_DISTANCE = 300;   // 拖拽目标距离
const GRABBLER_RECOVERY_DURATION = 5000; // 扔下后长CD(ms)
const GRABBLER_GRAB_RANGE = 35;       // 抓住玩家判定范围

// ─── Scene ────────────────────────────────────────────────────

export class CleanupEvacScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;

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
  private bullets: Bullet[] = [];
  private exit!: Phaser.GameObjects.Rectangle;

  // Water gun
  private isSpraying = false;
  private aimAngle = 0;
  private sprayRange = 160;
  private sprayAngle = Math.PI / 12; // 15° half-angle — 精准喷射，一次只清一面
  private sprayGraphics!: Phaser.GameObjects.Graphics;
  private waterParticles: Phaser.GameObjects.Arc[] = [];

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

  // Hide
  private isHidden = false;
  private hiddenSpot: HideSpot | null = null;

  // Grabbed by grabbler monster
  private isGrabbed = false;

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
  private hidePromptText!: Phaser.GameObjects.Text;

  // Equipment slots (3个装备槽，可携带药石/盾石)
  private equipmentSlots: (StoneType | null)[] = [null, null, null];
  private equipmentSlotBgs: Phaser.GameObjects.Rectangle[] = [];
  private equipmentSlotTexts: Phaser.GameObjects.Text[] = [];
  private slotKey1!: Phaser.Input.Keyboard.Key;
  private slotKey2!: Phaser.Input.Keyboard.Key;
  private slotKey3!: Phaser.Input.Keyboard.Key;

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
    this.bullets = [];
    this.obstacles = [];
    this.hideSpots = [];
    this.waterParticles = [];
    this.stamina = STAMINA_MAX;
    this.isSprinting = false;
    this.isHidden = false;
    this.hiddenSpot = null;
    this.isGrabbed = false;
    this.equipmentSlots = [null, null, null];
    this.equipmentSlotBgs = [];
    this.equipmentSlotTexts = [];

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateBuilding();
    this.ensureExitAccessible();
    this.drawMap();
    this.createPlayer();
    this.createStains();
    this.createMonsters();
    this.createExit();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('🎰 赌石撤离！\n每块石头有3面石皮，逐面清洗揭晓线索\n左键精准喷射（一次只清一面）| 右键放弃开石\nShift疾跑 | E键躲藏 | 1/2/3键使用装备\n药石🔴+血 | 盾石🛡护盾 | 雷石💥范围定住怪物\n洗到一半觉得不行？右键止损走人！');
    this.time.delayedCall(5000, () => this.hideMessage());
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

    // 生成躲藏小房间
    this.generateHideRooms();
  }

  // ─── Ensure exit reachable (保证撤离点可达) ─────────────────

  private ensureExitAccessible() {
    const exitX = this.mapWidth - 80;
    const exitY = this.mapHeight - 80;
    const corridorHalf = 50;  // 走廊半宽
    const corridorLen = 420;  // 走廊长度

    this.obstacles = this.obstacles.filter(obs => {
      // 保留外墙
      if (obs.w >= this.mapWidth - 100 || obs.h >= this.mapHeight - 100) return true;

      // L形走廊：水平段（从撤离点向左）+ 垂直段（从撤离点向上）
      const inH = obs.x < exitX + corridorHalf && obs.x + obs.w > exitX - corridorLen &&
                  obs.y < exitY + corridorHalf && obs.y + obs.h > exitY - corridorHalf;
      const inV = obs.x < exitX + corridorHalf && obs.x + obs.w > exitX - corridorHalf &&
                  obs.y < exitY + corridorHalf && obs.y + obs.h > exitY - corridorLen;
      return !(inH || inV);
    });
  }

  // ─── Hide rooms (躲藏小房间) ────────────────────────────────

  private generateHideRooms() {
    this.hideSpots = [];
    const roomCount = 7;
    const roomSize = 90;
    const wallT = 12;       // 墙厚度
    const doorGap = 36;     // 门缺口宽度
    let placed = 0;
    let attempts = 0;

    while (placed < roomCount && attempts < 500) {
      attempts++;
      const x = Phaser.Math.Between(120, this.mapWidth - 120 - roomSize);
      const y = Phaser.Math.Between(120, this.mapHeight - 120 - roomSize);

      // 避开起点和撤离点
      if (Phaser.Math.Distance.Between(x + roomSize / 2, y + roomSize / 2, 80, 80) < 200) continue;
      if (Phaser.Math.Distance.Between(x + roomSize / 2, y + roomSize / 2, this.mapWidth - 80, this.mapHeight - 80) < 200) continue;

      // 避开已有 hideSpot
      let tooClose = false;
      for (const hs of this.hideSpots) {
        if (Phaser.Math.Distance.Between(x + roomSize / 2, y + roomSize / 2, hs.x + hs.w / 2, hs.y + hs.h / 2) < 250) {
          tooClose = true; break;
        }
      }
      if (tooClose) continue;

      // 避开已有障碍物重叠
      let overlaps = false;
      for (const obs of this.obstacles) {
        if (x < obs.x + obs.w + 20 && x + roomSize + 20 > obs.x &&
            y < obs.y + obs.h + 20 && y + roomSize + 20 > obs.y) {
          overlaps = true; break;
        }
      }
      if (overlaps) continue;

      // 生成四面墙，每面留一个门缺口
      // 上墙
      this.obstacles.push({ x: x - wallT, y: y - wallT, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: x + (roomSize + doorGap) / 2, y: y - wallT, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      // 下墙
      this.obstacles.push({ x: x - wallT, y: y + roomSize, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: x + (roomSize + doorGap) / 2, y: y + roomSize, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      // 左墙
      this.obstacles.push({ x: x - wallT, y: y, w: wallT, h: (roomSize - doorGap) / 2 });
      this.obstacles.push({ x: x - wallT, y: y + (roomSize + doorGap) / 2, w: wallT, h: (roomSize - doorGap) / 2 });
      // 右墙
      this.obstacles.push({ x: x + roomSize, y: y, w: wallT, h: (roomSize - doorGap) / 2 });
      this.obstacles.push({ x: x + roomSize, y: y + (roomSize + doorGap) / 2, w: wallT, h: (roomSize - doorGap) / 2 });

      const kinds: HideSpot['kind'][] = ['closet', 'stall', 'locker'];
      this.hideSpots.push({
        x, y, w: roomSize, h: roomSize,
        kind: Phaser.Utils.Array.GetRandom(kinds),
        occupied: false,
      });
      placed++;
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

    // 躲藏小房间地板（暗蓝色区分）
    this.mapGraphics.fillStyle(0x1a2a4e, 0.6);
    for (const hs of this.hideSpots) {
      this.mapGraphics.fillRect(hs.x, hs.y, hs.w, hs.h);
      // 房间边框
      this.mapGraphics.lineStyle(2, 0x4466aa, 0.4);
      this.mapGraphics.strokeRect(hs.x, hs.y, hs.w, hs.h);
    }

    // 躲藏点标签
    for (const hs of this.hideSpots) {
      this.add.text(hs.x + hs.w / 2, hs.y + hs.h / 2, '躲避点\n按E', {
        fontSize: '14px', color: '#6688cc', align: 'center',
      }).setOrigin(0.5).setDepth(2.5);
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

      const radius = Phaser.Math.Between(14, 24);

      // ── 掷石型 ──
      const tier = this.rollStoneType();
      const stoneValue = tier.isUtility ? 0 : Phaser.Math.Between(tier.minVal, tier.maxVal);
      const cursed = !tier.isUtility && Math.random() < CURSED_CHANCE;

      // ── 内部石芯（隐藏的宝石）──
      const innerG = this.add.graphics();
      innerG.setPosition(x, y);
      innerG.setDepth(1.5);
      innerG.fillStyle(tier.color, 1);
      innerG.fillCircle(0, 0, radius * 0.7);
      // 高品质石加发光
      if (tier.type === 'rare' || tier.type === 'legendary') {
        innerG.fillStyle(tier.glowColor, 0.3);
        innerG.fillCircle(0, 0, radius * 1.0);
      }
      innerG.setAlpha(0); // 初始不可见

      // ── 外皮（3面石皮/污垢，每面独立清洗）──
      const dirtColors = [0x3a2a1a, 0x2a2a2a, 0x3a322a, 0x2a1a1a];
      const dirtColor = Phaser.Utils.Array.GetRandom(dirtColors);
      const faceOffset = Math.random() * Math.PI * 2;
      const faceSprites: Phaser.GameObjects.Graphics[] = [];
      const sectorHalf = (Math.PI / 3) * 0.92; // ~55°，留间隙区分3面
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

      this.stains.push({
        x, y, radius,
        faces: [
          { cleanliness: 100, cleaned: false },
          { cleanliness: 100, cleaned: false },
          { cleanliness: 100, cleaned: false },
        ],
        cleaned: false,
        faceSprites,
        innerSprite: innerG,
        onWall,
        stoneType: tier.type,
        stoneValue,
        revealStage: 0,
        cursed,
        faceOffset,
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
    // 用网格分布法让每种怪物均匀散布在地图上
    // 地图 2400×1600，每种类型按数量划分网格，每格放一只

    const margin = 120; // 离地图边缘的最小距离
    const spawnSafeDist = 500; // 离玩家出生点(80,80)的最小距离

    // ── 猎手 4只 → 2×2 网格 ──
    this.placeMonstersInGrid(4, 2, 2, margin, spawnSafeDist, (x, y) => {
      this.spawnMonster(x, y, true, false);
    });

    // ── 陷阱怪 7只 → 3×3 网格（9格用7格） ──
    this.placeMonstersInGrid(7, 3, 3, margin, spawnSafeDist, (x, y) => {
      this.spawnMonster(x, y, false, true);
    });

    // ── 炮塔怪 2只 → 2×1 网格 ──
    this.placeMonstersInGrid(2, 2, 1, margin, spawnSafeDist, (x, y) => {
      this.spawnTurretMonster(x, y);
    });

    // ── 抓捕怪 1只 → 1×1 网格 ──
    this.placeMonstersInGrid(1, 1, 1, margin, spawnSafeDist, (x, y) => {
      this.spawnGrabblerMonster(x, y);
    });
  }

  /** 网格分布法放置怪物：将地图划分为 cols×rows 个格子，在每格内随机选一个合法位置放一只怪物 */
  private placeMonstersInGrid(
    count: number, cols: number, rows: number,
    margin: number, spawnSafeDist: number,
    spawnFn: (x: number, y: number) => void,
  ) {
    const cellW = (this.mapWidth - margin * 2) / cols;
    const cellH = (this.mapHeight - margin * 2) / rows;

    // 生成所有格子索引并打乱顺序，取前 count 个
    const cellIndices: number[] = [];
    for (let i = 0; i < cols * rows; i++) cellIndices.push(i);
    Phaser.Utils.Array.Shuffle(cellIndices);

    let placed = 0;
    for (const idx of cellIndices) {
      if (placed >= count) break;

      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cellLeft = margin + col * cellW;
      const cellTop = margin + row * cellH;

      // 在当前格子内随机尝试放置
      let cellPlaced = false;
      for (let attempt = 0; attempt < 80; attempt++) {
        const x = Phaser.Math.Between(cellLeft + 20, cellLeft + cellW - 20);
        const y = Phaser.Math.Between(cellTop + 20, cellTop + cellH - 20);

        // 远离玩家出生点
        if (Phaser.Math.Distance.Between(x, y, 80, 80) < spawnSafeDist) continue;
        // 不在障碍物内
        if (this.isInsideObstacle(x, y, 14)) continue;

        spawnFn(x, y);
        cellPlaced = true;
        placed++;
        break;
      }

      // 如果当前格子实在放不下，跳过（不重试其他格子）
      if (!cellPlaced) {
        // 最后兜底：放宽条件再试一次
        for (let attempt = 0; attempt < 40; attempt++) {
          const x = Phaser.Math.Between(cellLeft, cellLeft + cellW);
          const y = Phaser.Math.Between(cellTop, cellTop + cellH);
          if (Phaser.Math.Distance.Between(x, y, 80, 80) < 300) continue;
          if (this.isInsideObstacle(x, y, 14)) continue;
          spawnFn(x, y);
          placed++;
          break;
        }
      }
    }
  }

  /** 创建单个怪物并加入数组 */
  private spawnMonster(x: number, y: number, isHunter: boolean, isTrap: boolean) {
    const sprite = this.add.rectangle(x, y, 24, 24, isHunter ? 0xff00ff : 0xff8800);
    sprite.setDepth(5);

    // 陷阱型怪物：找最近的墙壁贴上去，初始隐身
    let wallAngle = 0;
    if (isTrap) {
      const wall = this.findNearestWall(x, y);
      if (wall) {
        sprite.x = wall.x;
        sprite.y = wall.y;
        wallAngle = wall.angle;
      }
      sprite.setAlpha(0); // 初始隐身
      sprite.setFillStyle(0xff4400); // 陷阱怪用橙红色
    }

    this.monsters.push({
      sprite,
      speed: isHunter ? 40 : 30,
      chaseSpeed: isHunter ? 165 : 170, // 猎手追击速度略快于主角步行(160)，疾跑(260)可甩掉
      direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
      patrolTimer: Phaser.Math.Between(0, 3000),
      isChasing: false,
      visionRange: 180, // 与玩家视野圈一致
      visionAngle: Math.PI / 3,
      territoryRadius: 9999, // 取消领地限制，追到底
      homeX: sprite.x,
      homeY: sprite.y,
      giveUpTimer: 0,
      giveUpDuration: isHunter ? 10000 : 8000,
      isHunter,
      stunTimer: 0,
      attackCooldown: 0,
      returnHomeTimer: 0,
      lastSeenX: 0,
      lastSeenY: 0,
      hasLastSeen: false,
      searchingTimer: 0,
      spawnDelay: 0,
      isTrap,
      trapState: 'hidden',
      trapTimer: 0,
      wallAngle,
      isSpawner: false,
      alertTimer: 0,
      // 炮塔字段（默认值）
      isTurret: false,
      turretState: 'patrol',
      turretTimer: 0,
      turretShootTimer: 0,
      turretPatrolRadius: 0,
      // 抓捕字段（默认值）
      isGrabbler: false,
      grabblerState: 'patrol',
      grabblerTimer: 0,
      grabblerTargetX: 0,
      grabblerTargetY: 0,
      grabblerDragSpeed: 0,
    });
  }

  /** 创建炮塔型怪物（青色，大范围巡逻，发现玩家后原地吐子弹远程攻击，不追击） */
  private spawnTurretMonster(x: number, y: number) {
    const sprite = this.add.rectangle(x, y, 28, 28, TURRET_COLOR);
    sprite.setDepth(5);
    // 描边效果让炮塔怪更醒目
    sprite.setStrokeStyle(2, 0x00ffff, 0.8);

    this.monsters.push({
      sprite,
      speed: 50,             // 巡逻速度
      chaseSpeed: 0,         // 不追击
      direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
      patrolTimer: Phaser.Math.Between(0, 3000),
      isChasing: false,
      visionRange: TURRET_VISION_RANGE,
      visionAngle: Math.PI * 2, // 360°视野（远程怪）
      territoryRadius: 9999,
      homeX: x,
      homeY: y,
      giveUpTimer: 0,
      giveUpDuration: 5000,
      isHunter: false,
      stunTimer: 0,
      attackCooldown: 0,
      returnHomeTimer: 0,
      lastSeenX: 0,
      lastSeenY: 0,
      hasLastSeen: false,
      searchingTimer: 0,
      spawnDelay: 0,
      isTrap: false,
      trapState: 'hidden',
      trapTimer: 0,
      wallAngle: 0,
      isSpawner: false,
      alertTimer: 0,
      // 炮塔字段
      isTurret: true,
      turretState: 'patrol',
      turretTimer: 0,
      turretShootTimer: 0,
      turretPatrolRadius: TURRET_PATROL_RADIUS,
      // 抓捕字段（默认值）
      isGrabbler: false,
      grabblerState: 'patrol',
      grabblerTimer: 0,
      grabblerTargetX: 0,
      grabblerTargetY: 0,
      grabblerDragSpeed: 0,
    });
  }

  /** 创建抓捕型怪物（棕色，大体形，抓住玩家拖到随机地点扔下掉血，然后长CD） */
  private spawnGrabblerMonster(x: number, y: number) {
    const sprite = this.add.rectangle(x, y, GRABBLER_SIZE, GRABBLER_SIZE, GRABBLER_COLOR);
    sprite.setDepth(5);
    sprite.setStrokeStyle(3, 0xd2691e, 0.9); // 描边更粗

    this.monsters.push({
      sprite,
      speed: 35,             // 巡逻速度（慢）
      chaseSpeed: GRABBLER_CHASE_SPEED,
      direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
      patrolTimer: Phaser.Math.Between(0, 3000),
      isChasing: false,
      visionRange: GRABBLER_VISION_RANGE,
      visionAngle: Math.PI / 2, // 90°视野
      territoryRadius: 9999,
      homeX: x,
      homeY: y,
      giveUpTimer: 0,
      giveUpDuration: 8000,
      isHunter: false,
      stunTimer: 0,
      attackCooldown: 0,
      returnHomeTimer: 0,
      lastSeenX: 0,
      lastSeenY: 0,
      hasLastSeen: false,
      searchingTimer: 0,
      spawnDelay: 0,
      isTrap: false,
      trapState: 'hidden',
      trapTimer: 0,
      wallAngle: 0,
      isSpawner: false,
      alertTimer: 0,
      // 炮塔字段（默认值）
      isTurret: false,
      turretState: 'patrol',
      turretTimer: 0,
      turretShootTimer: 0,
      turretPatrolRadius: 0,
      // 抓捕字段
      isGrabbler: true,
      grabblerState: 'patrol',
      grabblerTimer: 0,
      grabblerTargetX: 0,
      grabblerTargetY: 0,
      grabblerDragSpeed: GRABBLER_DRAG_SPEED,
    });
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

    this.hidePromptText = this.add.text(400, 560, '', {
      fontSize: '18px', color: '#66ccff', align: 'center',
      backgroundColor: '#00000088',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    this.messageText = this.add.text(400, 500, '', {
      fontSize: '20px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    // 体力条
    this.staminaBar = this.add.graphics();
    this.staminaBar.setScrollFactor(0).setDepth(20);

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

    // 装备槽 (3个) — 右上角，菜单按钮下方
    this.add.text(700, 52, '装备', {
      fontSize: '12px', color: '#aaaaaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(29);
    for (let i = 0; i < 3; i++) {
      const sx = 660 + i * 44;
      const sy = 78;
      const bg = this.add.rectangle(sx, sy, 38, 38, 0x222222, 0.85)
        .setScrollFactor(0).setDepth(29);
      bg.setStrokeStyle(2, 0x666666);
      const numLabel = this.add.text(sx - 14, sy - 12, String(i + 1), {
        fontSize: '10px', color: '#888888',
      }).setScrollFactor(0).setDepth(30);
      const txt = this.add.text(sx, sy + 2, '', {
        fontSize: '20px', align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(30);
      this.equipmentSlotBgs.push(bg);
      this.equipmentSlotTexts.push(txt);
    }
    this.updateEquipmentUI();

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

  private updateEquipmentUI() {
    for (let i = 0; i < 3; i++) {
      const item = this.equipmentSlots[i];
      if (item) {
        this.equipmentSlotTexts[i].setText(LOOT_INFO[item].label);
        this.equipmentSlotBgs[i].setFillStyle(0x443322, 0.9);
      } else {
        this.equipmentSlotTexts[i].setText('·');
        this.equipmentSlotBgs[i].setFillStyle(0x222222, 0.85);
      }
    }
  }

  // ─── Input ───────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.slotKey1 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
    this.slotKey2 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
    this.slotKey3 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);

    // 禁用右键菜单
    this.input.mouse?.disableContextMenu();

    // 鼠标：左键喷射 | 右键放弃开石
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

    // E键躲藏
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.tryHide();
    }

    // 1/2/3 键使用装备槽
    if (Phaser.Input.Keyboard.JustDown(this.slotKey1)) this.useEquipment(0);
    if (Phaser.Input.Keyboard.JustDown(this.slotKey2)) this.useEquipment(1);
    if (Phaser.Input.Keyboard.JustDown(this.slotKey3)) this.useEquipment(2);

    // 躲避点提示
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
    this.hidePromptText.setText(nearHide ? '按 E 躲避' : '');

    // 更新瞄准角度 — 使用 positionToCamera 确保相机偏移正确
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const mouseWorldX = pointer.x + cam.scrollX;
    const mouseWorldY = pointer.y + cam.scrollY;
    this.aimAngle = Math.atan2(mouseWorldY - this.player.y, mouseWorldX - this.player.x);

    // 躲藏或被抓时不能移动/喷射，但体力恢复和雾仍更新
    if (!this.isHidden && !this.isGrabbed) {
      this.handlePlayerMovement(delta);
      this.updateSpray(delta);
      this.updateStains(delta);
    } else {
      this.sprayGraphics.clear();
      this.isSpraying = false;
      // 体力恢复
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * (delta / 1000));
    }
    this.updateMonsters(delta);
    this.updateBullets(delta);
    this.checkLootPickup();
    this.checkMonsterCollision();
    this.updateNegativeEffects(delta);
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

    // 检测是否有移动输入
    let inputX = 0, inputY = 0;
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) inputX -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) inputX += 1;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) inputY -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) inputY += 1;
    const hasInput = inputX !== 0 || inputY !== 0;

    // 疾跑判定：Shift + 有移动输入 + 体力足够
    const wantSprint = this.shiftKey.isDown && hasInput && this.stamina > 0;
    if (wantSprint) {
      this.isSprinting = true;
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_RATE * dt);
    } else {
      this.isSprinting = false;
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * dt);
    }

    const slowFactor = this.slowTimer > 0 ? 0.5 : 1;
    const baseSpeed = this.isSprinting ? PLAYER_SPRINT_SPEED : PLAYER_BASE_SPEED;
    const speed = baseSpeed * slowFactor;

    let vx = inputX * speed;
    let vy = inputY * speed;

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

  // ─── Stamina bar ────────────────────────────────────────────

  private drawStaminaBar() {
    const g = this.staminaBar;
    g.clear();

    const barW = 200;
    const barH = 12;
    const barX = 16;
    const barY = 96;

    // 背景
    g.fillStyle(0x222222, 0.8);
    g.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

    // 体力填充
    const pct = this.stamina / STAMINA_MAX;
    const fillW = barW * pct;
    if (this.isSprinting) {
      // 疾跑时黄色
      g.fillStyle(0xffcc00, 0.9);
    } else if (this.stamina < STAMINA_SPRINT_MIN) {
      // 体力不足时红色
      g.fillStyle(0xff4444, 0.9);
    } else {
      // 正常恢复时绿色
      g.fillStyle(0x44ff44, 0.9);
    }
    g.fillRect(barX, barY, fillW, barH);

    // 边框
    g.lineStyle(1, 0x888888, 0.6);
    g.strokeRect(barX, barY, barW, barH);
  }

  // ─── Hide system ────────────────────────────────────────────

  private tryHide() {
    if (this.isHidden) {
      this.exitHide();
      return;
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
    }
  }

  private enterHide(spot: HideSpot) {
    this.isHidden = true;
    this.hiddenSpot = spot;
    spot.occupied = true;
    this.player.x = spot.x + spot.w / 2;
    this.player.y = spot.y + spot.h / 2;
    this.player.setFillStyle(0x226688);
    this.player.setAlpha(0.5);
    // 躲藏后立即清除所有怪物的追击状态，防止追进房间
    // 并强制怪物回家，不要蹲在躲藏点门口
    for (const m of this.monsters) {
      m.isChasing = false;
      m.hasLastSeen = false;
      m.searchingTimer = 0;
      m.returnHomeTimer = 5000; // 强制回家5秒
      // 陷阱型怪物：正在现身的回到隐身状态
      if (m.isTrap && m.trapState === 'revealing') {
        m.trapState = 'hidden';
        m.trapTimer = 0;
        m.sprite.setAlpha(0);
      }
    }
    this.showMessage('躲藏中！怪物无法发现你。\n再按 E 离开');
    this.time.delayedCall(2500, () => this.hideMessage());
  }

  private exitHide() {
    this.isHidden = false;
    if (this.hiddenSpot) {
      // 离开时从下方门出去
      this.player.x = this.hiddenSpot.x + this.hiddenSpot.w / 2;
      this.player.y = this.hiddenSpot.y + this.hiddenSpot.h + 20;
      this.hiddenSpot.occupied = false;
      this.hiddenSpot = null;
    }
    this.player.setFillStyle(0x00ff00);
    this.player.setAlpha(1);
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

    // 水枪不再眩晕怪物（已移除），仅清洗石皮
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

    // 找到最佳清洗目标：最接近喷射中心线的石头+面
    let bestTarget: { stain: Stain; faceIdx: number } | null = null;
    let bestScore = Infinity;

    for (const stain of this.stains) {
      if (stain.cleaned) continue;

      const dx = stain.x - px;
      const dy = stain.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > range + stain.radius) continue;

      // 角度判断：石头是否在喷射锥内
      const stainAngle = Math.atan2(dy, dx);
      let diff = Math.abs(stainAngle - a);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > halfAngle) continue;

      // 确定哪个面被喷射（从石头看向玩家的方向）
      const playerAngleFromStain = Math.atan2(py - stain.y, px - stain.x);

      let closestFace = -1;
      let closestDiff = Infinity;
      for (let f = 0; f < 3; f++) {
        if (stain.faces[f].cleaned) continue;
        const faceAngle = stain.faceOffset + (f * Math.PI * 2 / 3);
        let faceDiff = Math.abs(faceAngle - playerAngleFromStain);
        while (faceDiff > Math.PI) faceDiff = Math.abs(faceDiff - Math.PI * 2);
        if (faceDiff < closestDiff) {
          closestDiff = faceDiff;
          closestFace = f;
        }
      }
      if (closestFace === -1) continue;

      // 评分：距离 + 角度偏差（角度权重更大）
      const score = dist + diff * 100;
      if (score < bestScore) {
        bestScore = score;
        bestTarget = { stain, faceIdx: closestFace };
      }
    }

    if (!bestTarget) return;

    // 只清洗最佳目标的一个面
    const { stain, faceIdx } = bestTarget;
    const face = stain.faces[faceIdx];
    face.cleanliness -= cleanPower;

    // 更新该面的视觉
    stain.faceSprites[faceIdx].setAlpha(Math.max(0, face.cleanliness / 100) * 0.85);

    // 更新内部石芯透明度（基于整体进度）
    const totalProgress = stain.faces.reduce((s, f) => s + (100 - f.cleanliness), 0) / 300;
    stain.innerSprite.setAlpha(totalProgress);

    // 一面完全清洗 → 线索
    if (face.cleanliness <= 0) {
      face.cleaned = true;
      face.cleanliness = 0;
      stain.faceSprites[faceIdx].setAlpha(0);
      stain.revealStage++;

      const tier = STONE_TIERS.find(t => t.type === stain.stoneType)!;
      if (stain.revealStage === 1) {
        this.showClue(stain.x, stain.y, tier.clue1, '#ffdd44');
      } else if (stain.revealStage === 2) {
        this.showClue(stain.x, stain.y, tier.clue2, '#ffaa00');
      } else if (stain.revealStage === 3) {
        // 三面全清 → 完全揭晓
        stain.cleaned = true;
        for (const fs of stain.faceSprites) fs.setVisible(false);
        stain.innerSprite.setAlpha(1);
        this.onStainCleaned(stain);
      }
    }
  }

  private showClue(x: number, y: number, text: string, color: string) {
    const clueText = this.add.text(x, y - 20, text, {
      fontSize: '13px',
      color: color,
      stroke: '#000000',
      strokeThickness: 3,
      wordWrap: { width: 200 },
      align: 'center',
    }).setOrigin(0.5).setDepth(8);

    this.tweens.add({
      targets: clueText,
      y: y - 55,
      alpha: { from: 1, to: 0 },
      duration: 2200,
      onComplete: () => clueText.destroy(),
    });
  }

  private onStainCleaned(stain: Stain) {
    const tier = STONE_TIERS.find(t => t.type === stain.stoneType)!;

    // 掉落拾取物
    this.spawnStoneLoot(stain.x, stain.y, stain.stoneType, stain.stoneValue);

    // 诅咒石 → 额外触发负面效果
    if (stain.cursed) {
      this.triggerNegativeEffect(stain.x, stain.y);
    }

    // 揭晓飘字
    if (tier.isUtility) {
      this.showClue(stain.x, stain.y, `揭晓：${tier.name}！`, '#ff4444');
    } else {
      const valText = stain.stoneValue >= 800 ? `👑 ${tier.name}！价值 ${stain.stoneValue}！`
                   : stain.stoneValue >= 200 ? `💎 ${tier.name}！价值 ${stain.stoneValue}！`
                   : stain.stoneValue >= 80  ? `🟢 ${tier.name}！价值 ${stain.stoneValue}！`
                   : `🪨 ${tier.name}，价值 ${stain.stoneValue}`;
      const color = stain.stoneValue >= 800 ? '#00ff44'
                  : stain.stoneValue >= 200 ? '#00cc44'
                  : stain.stoneValue >= 80  ? '#44dd44'
                  : '#aaaaaa';
      this.showClue(stain.x, stain.y, valText, color);
    }
  }

  // ─── Loot ───────────────────────────────────────────────────

  private spawnStoneLoot(x: number, y: number, type: LootType, value: number) {
    const info = LOOT_INFO[type];
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
      type,
      value,
      collected: false,
      sprite: container,
    });
  }

  /** 使用装备槽中的物品 */
  private useEquipment(slot: number) {
    const item = this.equipmentSlots[slot];
    if (!item) return;

    if (item === 'medkit') {
      this.health = Math.min(100, this.health + 30);
      this.healthText.setText(`生命: ${this.health}`);
      this.showMessage(`使用 药石！\n生命+30`);
    } else if (item === 'shield') {
      this.hasShield = true;
      this.showMessage(`使用 盾石！\n获得护盾`);
    } else if (item === 'bomb') {
      this.useBomb();
    }
    this.equipmentSlots[slot] = null;
    this.updateEquipmentUI();
    this.time.delayedCall(1000, () => this.hideMessage());
  }

  /** 炸弹石：在玩家位置释放冲击波，定住范围内所有怪物 */
  private useBomb() {
    const px = this.player.x;
    const py = this.player.y;
    const bombRange = 250;
    const stunDuration = 5000;

    this.showMessage(`💥 引爆 雷石！\n周围怪物定住 5 秒！`);

    // 冲击波视觉特效
    const shockwave = this.add.circle(px, py, 10, 0xff8800, 0.5);
    shockwave.setStrokeStyle(4, 0xffaa00, 0.8);
    shockwave.setDepth(8);
    this.tweens.add({
      targets: shockwave,
      radius: bombRange,
      alpha: 0,
      duration: 400,
      ease: 'Cubic.easeOut',
      onComplete: () => shockwave.destroy(),
    });

    // 闪光 + 震动
    this.cam.shake(300, 0.02);
    this.cam.flash(150, 255, 180, 0, true);

    // 定住范围内所有怪物
    for (const monster of this.monsters) {
      const dist = Phaser.Math.Distance.Between(px, py, monster.sprite.x, monster.sprite.y);
      if (dist <= bombRange) {
        monster.stunTimer = stunDuration;
        monster.isChasing = false;
        monster.giveUpTimer = 0;
        // 陷阱型怪物：被眩晕后直接消失
        if (monster.isTrap) {
          monster.sprite.destroy();
          const idx = this.monsters.indexOf(monster);
          if (idx >= 0) this.monsters.splice(idx, 1);
        }
      }
    }
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
        if (loot.type === 'medkit' || loot.type === 'shield' || loot.type === 'bomb') {
          // 药石/盾石 → 存入装备槽（有空位时），满了则立即使用
          const emptySlot = this.equipmentSlots.findIndex(s => s === null);
          if (emptySlot >= 0) {
            this.equipmentSlots[emptySlot] = loot.type;
            this.updateEquipmentUI();
            this.showMessage(`拾取 ${info.name}！\n存入装备槽 ${emptySlot + 1}\n按 ${emptySlot + 1} 键使用`);
          } else {
            // 装备槽已满，立即使用
            if (loot.type === 'medkit') {
              this.health = Math.min(100, this.health + 30);
              this.healthText.setText(`生命: ${this.health}`);
              this.showMessage(`装备槽已满！\n立即使用 ${info.name}，生命+30`);
            } else if (loot.type === 'shield') {
              this.hasShield = true;
              this.showMessage(`装备槽已满！\n立即使用 ${info.name}，获得护盾`);
            } else {
              // bomb — 满了立即引爆
              this.useBomb();
            }
          }
        } else {
          this.score += loot.value;
          this.updateScoreUI();
          this.showMessage(`拾取 ${info.name}！\n+${loot.value} 价值`);
        }
        this.time.delayedCall(1200, () => this.hideMessage());
      }
    }
  }

  // ─── Abandon stone (止损) ──────────────────────────────────

  private tryAbandonStone() {
    let nearest: Stain | null = null;
    let nearestDist = 80;

    for (const stain of this.stains) {
      if (stain.cleaned) continue;
      if (stain.revealStage === 0 || stain.revealStage === 3) continue;

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, stain.x, stain.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = stain;
      }
    }

    if (!nearest) return;

    const tier = STONE_TIERS.find(t => t.type === nearest.stoneType)!;

    if (tier.isUtility) {
      // 药石/盾石 → 放弃得0价值
      this.showClue(nearest.x, nearest.y, '放弃了…看不出是什么', '#888888');
    } else {
      const fraction = nearest.revealStage === 2 ? 0.5 : 0.2;
      const partial = Math.round(nearest.stoneValue * fraction);
      this.score += partial;
      this.updateScoreUI();
      this.showClue(nearest.x, nearest.y, `止损！+${partial}`, '#ffdd00');
    }

    nearest.cleaned = true;
    for (const fs of nearest.faceSprites) fs.setVisible(false);
    nearest.innerSprite.setVisible(false);
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
        this.showMessage('⚠ 怪物刷出来了！\n小心猎手追击！');
        this.time.delayedCall(2500, () => this.hideMessage());
        break;
      case 'alarm':
        this.alarmTimer = 5000;
        for (const m of this.monsters) {
          m.isChasing = true;
          m.giveUpTimer = 5000;
        }
        this.showMessage('🚨 警报触发！\n所有怪物进入追击状态！');
        this.time.delayedCall(1500, () => this.hideMessage());
        break;
      case 'blind':
        this.blindTimer = 4000;
        this.showMessage('👁 清扫溅起刺鼻气体！\n视野暂时缩小！');
        this.time.delayedCall(1500, () => this.hideMessage());
        break;
      case 'slow':
        this.slowTimer = 5000;
        this.showMessage('🐌 清扫溅出粘液！\n移动减速！');
        this.time.delayedCall(1500, () => this.hideMessage());
        break;
    }
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

          // 挖石头召唤的特殊怪：亮红色，快速追击
          sprite.setFillStyle(0xff0044);
          this.monsters.push({
            sprite,
            speed: 50,
            chaseSpeed: 240, // 特殊怪快速追击
            direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
            patrolTimer: 0,
            isChasing: false,
            visionRange: 180, // 与玩家视野圈一致
            visionAngle: Math.PI / 3,
            territoryRadius: 9999,
            homeX: mx,
            homeY: my,
            giveUpTimer: 10000,
            giveUpDuration: 10000,
            isHunter: true, // 走猎手逻辑
            stunTimer: 0,
            attackCooldown: 0,
            returnHomeTimer: 0,
            lastSeenX: x,
            lastSeenY: y,
            hasLastSeen: true,
            searchingTimer: 0,
            spawnDelay: SPAWN_DELAY_MS,
            isTrap: false,
            trapState: 'hidden',
            trapTimer: 0,
            wallAngle: 0,
            isSpawner: true,
            alertTimer: 0,
            // 炮塔字段（默认值）
            isTurret: false,
            turretState: 'patrol',
            turretTimer: 0,
            turretShootTimer: 0,
            turretPatrolRadius: 0,
            // 抓捕字段（默认值）
            isGrabbler: false,
            grabblerState: 'patrol',
            grabblerTimer: 0,
            grabblerTargetX: 0,
            grabblerTargetY: 0,
            grabblerDragSpeed: 0,
          });
          placed = true;
          this.playSpawnJumpscare();
        }
      }
      attempts++;
    }
  }

  /** 刷怪提示：只播放尖叫音效（无跳脸鬼图），UI 警告由调用方处理 */
  private playSpawnJumpscare() {
    this.sound.play('scream');
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
      // ── 陷阱型怪物：独立状态机，不走巡逻/追击逻辑 ──
      if (monster.isTrap) {
        this.updateTrapMonster(monster, delta);
        continue;
      }

      // ── 炮塔型怪物：独立状态机，大范围巡逻+远程吐子弹 ──
      if (monster.isTurret) {
        this.updateTurretMonster(monster, delta);
        continue;
      }

      // ── 抓捕型怪物：独立状态机，抓住玩家拖走 ──
      if (monster.isGrabbler) {
        this.updateGrabblerMonster(monster, delta);
        continue;
      }

      // 眩晕期间不能移动也不能追击
      if (monster.stunTimer > 0) {
        monster.stunTimer -= delta;
        monster.sprite.setFillStyle(0x666666); // 眩晕时变灰
        continue;
      } else {
        monster.sprite.setFillStyle(monster.isSpawner ? 0xff0044 : (monster.isHunter ? 0xff00ff : 0xff8800));
      }

      // 警觉闪烁：刚发现玩家时原地闪红+吼叫，不移动
      if (monster.alertTimer > 0) {
        monster.alertTimer -= delta;
        const blink = Math.floor(monster.alertTimer / 100) % 2 === 0;
        monster.sprite.setFillStyle(blink ? 0xff0000 : 0x880000);
        continue;
      }

      // 攻击停顿：打中玩家后短暂停止移动（后摇翻倍）
      if (monster.attackCooldown > 0) {
        monster.attackCooldown -= delta;
        monster.sprite.setFillStyle(0xff4444); // 攻击停顿时变红
        continue;
      }

      // 刷出延迟：原地停留 SPAWN_DELAY_MS（jumpscare 期间），结束后才开始追玩家
      if (monster.spawnDelay > 0) {
        monster.spawnDelay -= delta;
        const blink = Math.floor(monster.spawnDelay / 200) % 2 === 0;
        monster.sprite.setFillStyle(blink ? 0xffff00 : (monster.isHunter ? 0xff00ff : 0xff8800));
        if (monster.spawnDelay <= 0) {
          monster.spawnDelay = 0;
          monster.isChasing = true; // 延迟结束，开始追击
        } else {
          continue;
        }
      }

      const distToPlayer = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y, this.player.x, this.player.y
      );

      const canSee = this.monsterCanSeePlayer(monster, distToPlayer);

      if (canSee) {
        // 首次发现玩家 → 闪红警觉 + 吼叫音效，原地停顿
        if (!monster.isChasing && monster.alertTimer <= 0) {
          monster.alertTimer = 600;
          this.sound.play('crying');
          // 相机轻微震动
          this.cam.shake(150, 0.005);
        }
        monster.isChasing = true;
        monster.giveUpTimer = monster.giveUpDuration;
        monster.lastSeenX = this.player.x;
        monster.lastSeenY = this.player.y;
        monster.hasLastSeen = true;
        monster.searchingTimer = 0;
      } else if (monster.isChasing) {
        // 看不到玩家但有最后已知位置 → 朝那里走
        if (monster.hasLastSeen) {
          const distToLastSeen = Phaser.Math.Distance.Between(
            monster.sprite.x, monster.sprite.y, monster.lastSeenX, monster.lastSeenY
          );

          if (distToLastSeen > 25) {
            // 还没到达最后已知位置，继续前往
            const dir = new Phaser.Math.Vector2(
              monster.lastSeenX - monster.sprite.x,
              monster.lastSeenY - monster.sprite.y
            ).normalize();

            const newX = monster.sprite.x + dir.x * monster.chaseSpeed * dt;
            const newY = monster.sprite.y + dir.y * monster.chaseSpeed * dt;

            if (!this.isObstacleAt(newX, monster.sprite.y, 0)) {
              monster.sprite.x = newX;
            }
            if (!this.isObstacleAt(monster.sprite.x, newY, 0)) {
              monster.sprite.y = newY;
            }
            continue;
          } else {
            // 到达最后已知位置，开始搜索计时
            monster.searchingTimer += delta;
            // 搜索期间原地转圈
            monster.patrolTimer += delta;
            if (monster.patrolTimer > 800) {
              monster.patrolTimer = 0;
              const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
              monster.direction.set(Math.cos(angle), Math.sin(angle));
            }
            const newX = monster.sprite.x + monster.direction.x * monster.speed * 1.5 * dt;
            const newY = monster.sprite.y + monster.direction.y * monster.speed * 1.5 * dt;
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

            // 搜索超时 → 放弃
            if (monster.searchingTimer > HIDE_LOSE_AGGRO_TIME) {
              monster.hasLastSeen = false;
              monster.giveUpTimer -= delta;
              if (monster.giveUpTimer <= 0) {
                monster.isChasing = false;
                monster.searchingTimer = 0;
              }
            }
            continue;
          }
        } else {
          // 没有最后已知位置，正常 giveUp 倒计时
          monster.giveUpTimer -= delta;
          if (monster.giveUpTimer <= 0) {
            monster.isChasing = false;
          }
        }
      }

      // 取消领地限制（territoryRadius = 9999，不会触发）

      if (monster.isChasing) {
        // 朝玩家移动（特殊怪用更快的追击速度）
        const chaseSpd = monster.isSpawner ? 240 : monster.chaseSpeed;
        const dir = new Phaser.Math.Vector2(
          this.player.x - monster.sprite.x,
          this.player.y - monster.sprite.y
        ).normalize();

        const newX = monster.sprite.x + dir.x * chaseSpd * dt;
        const newY = monster.sprite.y + dir.y * chaseSpd * dt;

        if (!this.isObstacleAt(newX, monster.sprite.y, 0)) {
          monster.sprite.x = newX;
        }
        if (!this.isObstacleAt(monster.sprite.x, newY, 0)) {
          monster.sprite.y = newY;
        }
      } else {
        // 巡逻
        monster.patrolTimer += delta;
        if (monster.patrolTimer > 3000) {
          monster.patrolTimer = 0;
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          monster.direction.set(Math.cos(angle), Math.sin(angle));
        }

        // 失去目标后强制回家一段时间，不要蹲在躲藏点门口
        let returnHome = false;
        if (monster.returnHomeTimer > 0) {
          monster.returnHomeTimer -= delta;
          returnHome = true;
        }

        // 巡逻时回到出生点附近
        const distFromHome = Phaser.Math.Distance.Between(
          monster.sprite.x, monster.sprite.y, monster.homeX, monster.homeY
        );
        if (returnHome || distFromHome > 400) {
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
    // 躲藏时怪物看不到玩家
    if (this.isHidden) return false;

    if (distToPlayer > monster.visionRange) return false;

    if (monster.visionAngle > 0) {
      const angleToPlayer = Math.atan2(
        this.player.y - monster.sprite.y, this.player.x - monster.sprite.x
      );
      let facingAngle = Math.atan2(monster.direction.y, monster.direction.x);
      if (monster.isChasing) facingAngle = angleToPlayer;

      let diff = Math.abs(angleToPlayer - facingAngle);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > monster.visionAngle) return false;
    }

    // 隔墙看不见
    if (this.lineBlockedByObstacle(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y)) {
      return false;
    }

    return true;
  }

  // ─── Trap monster state machine ─────────────────────────────

  private updateTrapMonster(monster: Monster, delta: number) {
    const distToPlayer = Phaser.Math.Distance.Between(
      monster.sprite.x, monster.sprite.y, this.player.x, this.player.y
    );

    // 被水枪眩晕期间，陷阱也暂停
    if (monster.stunTimer > 0) {
      monster.stunTimer -= delta;
      monster.sprite.setFillStyle(0x666666);
      return;
    }

    switch (monster.trapState) {
      case 'hidden': {
        // 隐身等待，玩家进入攻击范围时现身
        monster.sprite.setAlpha(0);
        if (distToPlayer < TRAP_REVEAL_RANGE && !this.isHidden) {
          monster.trapState = 'revealing';
          monster.trapTimer = TRAP_REVEAL_DELAY;
          monster.sprite.setAlpha(1);
          monster.sprite.setFillStyle(0xff8800); // 现身时橙色
        }
        break;
      }
      case 'revealing': {
        // 已现身，倒计时后爆炸（无论距离）
        monster.trapTimer -= delta;
        // 闪烁警告 + 膨胀
        const blink = Math.floor(monster.trapTimer / 250) % 2 === 0;
        monster.sprite.setFillStyle(blink ? 0xffff00 : 0xff4400);
        monster.sprite.setAlpha(1);
        const growScale = 1 + (1 - monster.trapTimer / TRAP_REVEAL_DELAY) * 0.8;
        monster.sprite.setScale(growScale);

        if (monster.trapTimer <= 0) {
          // 爆炸：范围内造成伤害
          this.dealTrapExplosionDamage(monster);
          // 爆炸特效
          this.playTrapExplosionEffect(monster.sprite.x, monster.sprite.y);
          // 爆炸后消失
          monster.sprite.destroy();
          const idx = this.monsters.indexOf(monster);
          if (idx >= 0) this.monsters.splice(idx, 1);
        }
        break;
      }
    }
  }

  // ─── Turret monster state machine (炮塔怪) ─────────────────
  // 巡逻范围很大，发现玩家后闪一下光（警觉），然后原地吐子弹远程攻击，不追击

  private updateTurretMonster(monster: Monster, delta: number) {
    const dt = delta / 1000;
    const distToPlayer = Phaser.Math.Distance.Between(
      monster.sprite.x, monster.sprite.y, this.player.x, this.player.y
    );

    // 被水枪眩晕期间暂停
    if (monster.stunTimer > 0) {
      monster.stunTimer -= delta;
      monster.sprite.setFillStyle(0x666666);
      return;
    }

    switch (monster.turretState) {
      // ── 巡逻：大范围随机移动 ──
      case 'patrol': {
        monster.sprite.setFillStyle(TURRET_COLOR);

        // 检测玩家
        if (distToPlayer < monster.visionRange && !this.isHidden &&
          !this.lineBlockedByObstacle(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y)) {
          // 发现玩家 → 进入警觉闪光
          monster.turretState = 'alert';
          monster.turretTimer = TURRET_ALERT_DURATION;
          this.sound.play('crying');
          this.cam.shake(150, 0.005);
          break;
        }

        // 巡逻移动（大范围）
        monster.patrolTimer += delta;
        if (monster.patrolTimer > 2500) {
          monster.patrolTimer = 0;
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          monster.direction.set(Math.cos(angle), Math.sin(angle));
        }

        // 离家太远时往回走
        const distFromHome = Phaser.Math.Distance.Between(
          monster.sprite.x, monster.sprite.y, monster.homeX, monster.homeY
        );
        if (distFromHome > monster.turretPatrolRadius) {
          const toHome = new Phaser.Math.Vector2(
            monster.homeX - monster.sprite.x, monster.homeY - monster.sprite.y
          ).normalize();
          monster.direction.lerp(toHome, 0.05).normalize();
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
        break;
      }

      // ── 警觉闪光：原地闪烁，准备射击 ──
      case 'alert': {
        monster.turretTimer -= delta;
        const blink = Math.floor(monster.turretTimer / 100) % 2 === 0;
        monster.sprite.setFillStyle(blink ? 0xffffff : TURRET_COLOR);

        if (monster.turretTimer <= 0) {
          monster.turretState = 'shooting';
          monster.turretTimer = TURRET_SHOOT_DURATION;
          monster.turretShootTimer = 0; // 立即射第一发
        }
        break;
      }

      // ── 射击：原地吐子弹 ──
      case 'shooting': {
        monster.sprite.setFillStyle(0x00ffff);
        monster.turretTimer -= delta;
        monster.turretShootTimer -= delta;

        // 朝玩家方向射击
        if (monster.turretShootTimer <= 0) {
          monster.turretShootTimer = TURRET_SHOOT_INTERVAL;
          this.fireTurretBullet(monster);
        }

        if (monster.turretTimer <= 0) {
          monster.turretState = 'cooldown';
          monster.turretTimer = TURRET_COOLDOWN_DURATION;
        }
        break;
      }

      // ── 冷却：原地不动，恢复巡逻 ──
      case 'cooldown': {
        monster.turretTimer -= delta;
        monster.sprite.setFillStyle(0x448888); // 暗青色

        if (monster.turretTimer <= 0) {
          monster.turretState = 'patrol';
        }
        break;
      }
    }
  }

  /** 炮塔怪发射子弹 */
  private fireTurretBullet(monster: Monster) {
    const angle = Math.atan2(
      this.player.y - monster.sprite.y,
      this.player.x - monster.sprite.x
    );
    // 加一点随机偏移，让子弹不那么精准
    const spread = Phaser.Math.FloatBetween(-0.15, 0.15);
    const finalAngle = angle + spread;

    const bulletSprite = this.add.circle(
      monster.sprite.x, monster.sprite.y, TURRET_BULLET_RADIUS, 0xff6600, 1
    );
    bulletSprite.setDepth(6);
    bulletSprite.setStrokeStyle(1, 0xffff00, 0.8);

    this.bullets.push({
      sprite: bulletSprite,
      vx: Math.cos(finalAngle) * TURRET_BULLET_SPEED,
      vy: Math.sin(finalAngle) * TURRET_BULLET_SPEED,
      life: TURRET_BULLET_LIFE,
      damage: TURRET_BULLET_DAMAGE,
      active: true,
    });
  }

  // ─── Grabbler monster state machine (抓捕怪) ────────────────
  // 大体形，抓住玩家拖到随机地点扔下掉血，然后长CD

  private updateGrabblerMonster(monster: Monster, delta: number) {
    const dt = delta / 1000;
    const distToPlayer = Phaser.Math.Distance.Between(
      monster.sprite.x, monster.sprite.y, this.player.x, this.player.y
    );

    // 被水枪眩晕期间暂停
    if (monster.stunTimer > 0) {
      monster.stunTimer -= delta;
      monster.sprite.setFillStyle(0x666666);
      return;
    }

    switch (monster.grabblerState) {
      // ── 巡逻 + 追击：发现玩家后追上去抓 ──
      case 'patrol': {
        monster.sprite.setFillStyle(GRABBLER_COLOR);

        const canSee = distToPlayer < monster.visionRange && !this.isHidden &&
          !this.lineBlockedByObstacle(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y);

        if (canSee) {
          // 发现玩家 → 追击
          monster.isChasing = true;
          monster.giveUpTimer = monster.giveUpDuration;
        } else if (monster.isChasing) {
          monster.giveUpTimer -= delta;
          if (monster.giveUpTimer <= 0) {
            monster.isChasing = false;
          }
        }

        if (monster.isChasing) {
          // 追击玩家
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

          // 靠近玩家 → 抓住
          if (distToPlayer < GRABBLER_GRAB_RANGE && !this.isHidden) {
            monster.grabblerState = 'grabbing';
            monster.grabblerTimer = 300; // 抓住0.3秒后开始拖
            this.isGrabbed = true;
            // 选一个随机目标点
            const targetAngle = Math.random() * Math.PI * 2;
            const targetDist = GRABBLER_DROP_DISTANCE + Phaser.Math.Between(-50, 100);
            monster.grabblerTargetX = Phaser.Math.Clamp(
              monster.sprite.x + Math.cos(targetAngle) * targetDist,
              60, this.mapWidth - 60
            );
            monster.grabblerTargetY = Phaser.Math.Clamp(
              monster.sprite.y + Math.sin(targetAngle) * targetDist,
              60, this.mapHeight - 60
            );
          }
        } else {
          // 巡逻
          monster.patrolTimer += delta;
          if (monster.patrolTimer > 3000) {
            monster.patrolTimer = 0;
            const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
            monster.direction.set(Math.cos(angle), Math.sin(angle));
          }
          const distFromHome = Phaser.Math.Distance.Between(
            monster.sprite.x, monster.sprite.y, monster.homeX, monster.homeY
          );
          if (distFromHome > 400) {
            const toHome = new Phaser.Math.Vector2(
              monster.homeX - monster.sprite.x, monster.homeY - monster.sprite.y
            ).normalize();
            monster.direction.lerp(toHome, 0.05).normalize();
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
        break;
      }

      // ── 抓住：短暂停顿，玩家被定住 ──
      case 'grabbing': {
        monster.grabblerTimer -= delta;
        monster.sprite.setFillStyle(0xff8800); // 抓住时变橙
        // 玩家被抓住，不能移动（强制拉到怪物位置）
        this.player.x = monster.sprite.x;
        this.player.y = monster.sprite.y;

        if (monster.grabblerTimer <= 0) {
          monster.grabblerState = 'dragging';
        }
        break;
      }

      // ── 拖拽：拉着玩家跑到目标点 ──
      case 'dragging': {
        monster.sprite.setFillStyle(0xff4400);
        const distToTarget = Phaser.Math.Distance.Between(
          monster.sprite.x, monster.sprite.y,
          monster.grabblerTargetX, monster.grabblerTargetY
        );

        if (distToTarget > 20) {
          const dir = new Phaser.Math.Vector2(
            monster.grabblerTargetX - monster.sprite.x,
            monster.grabblerTargetY - monster.sprite.y
          ).normalize();
          const newX = monster.sprite.x + dir.x * monster.grabblerDragSpeed * dt;
          const newY = monster.sprite.y + dir.y * monster.grabblerDragSpeed * dt;
          if (!this.isObstacleAt(newX, monster.sprite.y, 0)) {
            monster.sprite.x = newX;
          } else {
            // 撞墙了，重新选目标
            const targetAngle = Math.random() * Math.PI * 2;
            monster.grabblerTargetX = Phaser.Math.Clamp(
              monster.sprite.x + Math.cos(targetAngle) * GRABBLER_DROP_DISTANCE,
              60, this.mapWidth - 60
            );
            monster.grabblerTargetY = Phaser.Math.Clamp(
              monster.sprite.y + Math.sin(targetAngle) * GRABBLER_DROP_DISTANCE,
              60, this.mapHeight - 60
            );
          }
          if (!this.isObstacleAt(monster.sprite.x, newY, 0)) {
            monster.sprite.y = newY;
          } else {
            const targetAngle = Math.random() * Math.PI * 2;
            monster.grabblerTargetX = Phaser.Math.Clamp(
              monster.sprite.x + Math.cos(targetAngle) * GRABBLER_DROP_DISTANCE,
              60, this.mapWidth - 60
            );
            monster.grabblerTargetY = Phaser.Math.Clamp(
              monster.sprite.y + Math.sin(targetAngle) * GRABBLER_DROP_DISTANCE,
              60, this.mapHeight - 60
            );
          }
          // 玩家被拖着走
          this.player.x = monster.sprite.x;
          this.player.y = monster.sprite.y;
        } else {
          // 到达目标点 → 扔下
          monster.grabblerState = 'dropping';
          monster.grabblerTimer = 200;
        }
        break;
      }

      // ── 扔下：玩家掉血 + 击退 ──
      case 'dropping': {
        monster.grabblerTimer -= delta;
        monster.sprite.setFillStyle(0xff0000);

        if (monster.grabblerTimer <= 0) {
          // 造成伤害
          if (this.hasShield) {
            this.hasShield = false;
            this.showMessage('🛡 护盾抵挡了抓捕怪的摔投！');
            this.time.delayedCall(1000, () => this.hideMessage());
          } else {
            this.health -= GRABBLER_DROP_DAMAGE;
            this.healthText.setText(`生命: ${this.health}`);
            // 击退玩家
            const kx = this.player.x - monster.sprite.x;
            const ky = this.player.y - monster.sprite.y;
            const klen = Math.sqrt(kx * kx + ky * ky) || 1;
            this.player.x += (kx / klen) * 40;
            this.player.y += (ky / klen) * 40;
            // 闪烁
            this.player.setFillStyle(0xff0000);
            this.time.delayedCall(300, () => {
              if (!this.isDead) this.player.setFillStyle(0x00ff00);
            });
            this.cam.shake(200, 0.015);
            if (this.health <= 0) {
              this.die();
            }
          }
          this.damageCooldown = 800;
          monster.grabblerState = 'recovery';
          monster.grabblerTimer = GRABBLER_RECOVERY_DURATION;
          monster.isChasing = false;
          this.isGrabbed = false; // 释放玩家
        }
        break;
      }

      // ── 恢复CD：原地不动，较长时间 ──
      case 'recovery': {
        monster.grabblerTimer -= delta;
        // CD期间变暗，闪烁
        const blink = Math.floor(monster.grabblerTimer / 500) % 2 === 0;
        monster.sprite.setFillStyle(blink ? 0x553311 : 0x332208);

        if (monster.grabblerTimer <= 0) {
          monster.grabblerState = 'patrol';
        }
        break;
      }
    }
  }

  // ─── Bullets (炮塔怪子弹) ───────────────────────────────────

  private updateBullets(delta: number) {
    const dt = delta / 1000;

    for (const bullet of this.bullets) {
      if (!bullet.active) continue;

      // 移动
      const newX = bullet.sprite.x + bullet.vx * dt;
      const newY = bullet.sprite.y + bullet.vy * dt;

      // 撞墙 → 消失
      if (this.isObstacleAt(newX, newY, 0)) {
        bullet.sprite.destroy();
        bullet.active = false;
        continue;
      }

      bullet.sprite.x = newX;
      bullet.sprite.y = newY;

      // 寿命到期 → 消失
      bullet.life -= delta;
      if (bullet.life <= 0) {
        bullet.sprite.destroy();
        bullet.active = false;
        continue;
      }

      // 命中玩家
      const dist = Phaser.Math.Distance.Between(
        bullet.sprite.x, bullet.sprite.y, this.player.x, this.player.y
      );
      if (dist < 14 + TURRET_BULLET_RADIUS && !this.isHidden && this.damageCooldown <= 0) {
        if (this.hasShield) {
          this.hasShield = false;
          this.showMessage('🛡 护盾抵挡了子弹！');
          this.time.delayedCall(1000, () => this.hideMessage());
          this.damageCooldown = 1000;
        } else {
          this.health -= bullet.damage;
          this.healthText.setText(`生命: ${this.health}`);
          this.damageCooldown = 600;
          this.player.setFillStyle(0xff0000);
          this.time.delayedCall(200, () => {
            if (!this.isDead) this.player.setFillStyle(0x00ff00);
          });
          if (this.health <= 0) {
            this.die();
          }
        }
        bullet.sprite.destroy();
        bullet.active = false;
      }
    }

    // 清理已销毁的子弹
    this.bullets = this.bullets.filter(b => b.active);
  }

  /** 陷阱爆炸：范围内造成伤害 */
  private dealTrapExplosionDamage(monster: Monster) {
    const dist = Phaser.Math.Distance.Between(
      monster.sprite.x, monster.sprite.y, this.player.x, this.player.y
    );
    if (dist > TRAP_STRIKE_RANGE || this.isHidden) return;

    if (this.damageCooldown > 0) return;

    if (this.hasShield) {
      this.hasShield = false;
      this.showMessage('🛡 护盾抵挡了陷阱爆炸！');
      this.time.delayedCall(1000, () => this.hideMessage());
      this.damageCooldown = 1000;
    } else {
      this.health -= TRAP_STRIKE_DAMAGE;
      this.healthText.setText(`生命: ${this.health}`);
      this.damageCooldown = 800;

      // 击退玩家
      const kx = this.player.x - monster.sprite.x;
      const ky = this.player.y - monster.sprite.y;
      const klen = Math.sqrt(kx * kx + ky * ky) || 1;
      this.player.x += (kx / klen) * 30;
      this.player.y += (ky / klen) * 30;

      // 闪烁
      this.player.setFillStyle(0xff0000);
      this.time.delayedCall(200, () => {
        if (!this.isDead) this.player.setFillStyle(0x00ff00);
      });

      if (this.health <= 0) {
        this.die();
      }
    }
  }

  /** 陷阱爆炸特效 */
  private playTrapExplosionEffect(x: number, y: number) {
    const cam = this.cameras.main;
    cam.shake(200, 0.02);

    // 爆炸圆圈
    const fx = this.add.circle(x, y, 4, 0xff6600, 0.8);
    fx.setDepth(6);
    this.tweens.add({
      targets: fx,
      radius: TRAP_STRIKE_RANGE,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => fx.destroy(),
    });

    // 闪光
    const flash = this.add.circle(x, y, TRAP_STRIKE_RANGE, 0xffff00, 0.5);
    flash.setDepth(7);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 200,
      onComplete: () => flash.destroy(),
    });
  }

  /** 找离 (x,y) 最近的墙壁，返回贴墙坐标和朝向角度 */
  private findNearestWall(x: number, y: number): { x: number; y: number; angle: number } | null {
    let best: { x: number; y: number; angle: number } | null = null;
    let minDist = Infinity;

    for (const obs of this.obstacles) {
      // 计算到障碍物矩形最近点
      const cx = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
      const cy = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDist && dist > 0 && dist < 200) {
        // 贴墙位置 = 墙壁表面点 + 少量偏移
        const offset = 14;
        const len = dist || 1;
        const px = cx + (dx / len) * offset;
        const py = cy + (dy / len) * offset;
        // 朝向：从墙指向外侧
        const angle = Math.atan2(dy, dx);
        minDist = dist;
        best = { x: px, y: py, angle };
      }
    }
    return best;
  }

  // ─── Combat ─────────────────────────────────────────────────

  private checkMonsterCollision() {
    if (this.damageCooldown > 0) return;
    if (this.isHidden) return; // 躲藏时不会受到伤害

    for (const monster of this.monsters) {
      // 陷阱型怪物有自己的攻击逻辑（updateTrapMonster 中处理），跳过碰撞检测
      if (monster.isTrap) continue;
      // 炮塔型怪物远程攻击，不靠碰撞造成伤害
      if (monster.isTurret) continue;
      // 抓捕型怪物有自己的摔投伤害逻辑，跳过碰撞检测
      if (monster.isGrabbler) continue;

      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, monster.sprite.x, monster.sprite.y
      );

      if (dist < 28) {
        if (this.hasShield) {
          this.hasShield = false;
          this.showMessage('🛡 护盾抵挡了攻击！');
          this.time.delayedCall(1000, () => this.hideMessage());
          this.damageCooldown = 1000;
          monster.attackCooldown = 1600; // 后摇翻倍（原800→1600）
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
          monster.attackCooldown = 1600; // 后摇翻倍（原800→1600）

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
