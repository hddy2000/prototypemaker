import Phaser from 'phaser';

// ── 祭坛清扫 (Altar Cleanup) ──────────────────────────────────────────────
// 核心循环：中央祭坛 + 周围6个房间（格子间+走廊连接）
//   玩家用水枪清洗各房间污渍 → 污渍清完掉落宝物 → 拾取宝物运回中央祭坛 →
//   祭坛累计价值达1000 → 通关
// 怪物：猎手(巡逻+追击) + 陷阱怪(贴墙隐身+现身突袭)，仿赌石撤离的 hunter/trap
// 死亡：生命归零

// ── Types ──────────────────────────────────────────────────────────────────

interface RoomDef {
  id: number;           // 0 = 中央祭坛, 1..6 = 周围房间
  x: number; y: number; w: number; h: number;
  name: string;
  isHub: boolean;
}

interface CorridorDef {
  x: number; y: number; w: number; h: number;
  fromRoom: number; toRoom: number;
}

interface Obstacle {
  x: number; y: number; w: number; h: number;
}

interface HideSpot {
  x: number; y: number; w: number; h: number;
  kind: 'locker' | 'table';
  roomId: number;
  occupied: boolean;
}

interface Stain {
  x: number;
  y: number;
  radius: number;
  faces: { cleanliness: number; cleaned: boolean }[];
  cleaned: boolean;
  faceSprites: Phaser.GameObjects.Graphics[];
  innerSprite: Phaser.GameObjects.Graphics;
  roomId: number;
  stoneType: StoneType;
  stoneValue: number;
  revealStage: number;
  cursed: boolean;
  faceOffset: number;
}

interface Loot {
  x: number;
  y: number;
  type: LootType;
  value: number;
  collected: boolean;
  deposited: boolean;
  sprite: Phaser.GameObjects.Container;
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
  homeX: number;
  homeY: number;
  giveUpTimer: number;
  giveUpDuration: number;
  isHunter: boolean;
  stunTimer: number;
  attackCooldown: number;
  returnHomeTimer: number;
  lastSeenX: number;
  lastSeenY: number;
  hasLastSeen: boolean;
  searchingTimer: number;
  spawnDelay: number;
  isTrap: boolean;
  trapState: 'hidden' | 'revealing';
  trapTimer: number;
  wallAngle: number;
  isSpawner: boolean;
  alertTimer: number;
}

type StoneType = 'trash' | 'common' | 'good' | 'rare' | 'legendary' | 'medkit' | 'shield' | 'bomb';
type LootType = StoneType;

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
const CURSED_CHANCE = 0.15;

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

type NegativeType = 'spawn_monster' | 'alarm' | 'blind' | 'slow';
const NEGATIVE_TABLE: { type: NegativeType; weight: number }[] = [
  { type: 'spawn_monster', weight: 60 },
  { type: 'alarm',         weight: 20 },
  { type: 'blind',         weight: 15 },
  { type: 'slow',          weight: 5 },
];

// ── Constants ──────────────────────────────────────────────────────────────

// 房间尺寸
const HUB_W = 280;
const HUB_H = 240;
const ROOM_W = 220;
const ROOM_H = 180;
const CORR_W = 40;

const MAP_CX = 750;
const MAP_CY = 560;

// 玩家
const PLAYER_BASE_SPEED = 160;
const PLAYER_SPRINT_SPEED = 260;
// PLAYER_SIZE unused — player radius is hardcoded as 12
const STAMINA_MAX = 100;
const STAMINA_DRAIN_RATE = 35;
const STAMINA_REGEN_RATE = 20;
const STAMINA_SPRINT_MIN = 5;

// 水枪
const SPRAY_RANGE = 160;
const SPRAY_HALF_ANGLE = Math.PI / 12; // 15°
const CLEAN_POWER = 80; // per second

// 怪物
const MONSTER_W = 24;
const MONSTER_HUNT_VISION = 180;
const MONSTER_HUNT_CHASE = 165;
const MONSTER_HUNT_PATROL = 40;
const MONSTER_HUNT_GIVEUP = 10000;
const TRAP_REVEAL_RANGE = 50;
const TRAP_REVEAL_DELAY = 1000;
const TRAP_STRIKE_RANGE = 50;
const TRAP_STRIKE_DAMAGE = 20;
const SPAWN_DELAY_MS = 3000;
const HIDE_LOSE_AGGRO_TIME = 3000;
const HIDE_SPOT_RANGE = 40;

// 诅咒石负面效果
const BOMB_RANGE = 250;
const BOMB_STUN = 5000;

// 通关
const GOAL_VALUE = 1000;

// ── Scene ──────────────────────────────────────────────────────────────────

export class AltarCleanupScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private slotKey1!: Phaser.Input.Keyboard.Key;
  private slotKey2!: Phaser.Input.Keyboard.Key;
  private slotKey3!: Phaser.Input.Keyboard.Key;

  // 地图
  private rooms: RoomDef[] = [];
  private corridors: CorridorDef[] = [];
  private obstacles: Obstacle[] = [];
  private hideSpots: HideSpot[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // 迷雾
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'altarCleanupFog';
  private viewRadius = 180;
  private screenW = 800;
  private screenH = 600;

  // 相机
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // 游戏对象
  private stains: Stain[] = [];
  private monsters: Monster[] = [];
  private loots: Loot[] = [];
  private depositZone!: Phaser.GameObjects.Container;

  // 水枪
  private isSpraying = false;
  private aimAngle = 0;
  private sprayGraphics!: Phaser.GameObjects.Graphics;
  private waterParticles: Phaser.GameObjects.Arc[] = [];

  // 玩家状态
  private health = 100;
  private score = 0;
  private damageCooldown = 0;
  private hasShield = false;
  private carrying = 0;          // 携带宝物数量
  private carryCapacity = 5;    // 最大携带量

  // 体力
  private stamina = STAMINA_MAX;
  private isSprinting = false;
  private staminaBar!: Phaser.GameObjects.Graphics;

  // 躲藏
  private isHidden = false;
  private hiddenSpot: HideSpot | null = null;

  // 负面效果
  private blindTimer = 0;
  private slowTimer = 0;
  private alarmTimer = 0;

  // 装备槽
  private equipmentSlots: (StoneType | null)[] = [null, null, null];
  private equipmentSlotBgs: Phaser.GameObjects.Rectangle[] = [];
  private equipmentSlotTexts: Phaser.GameObjects.Text[] = [];

  // 状态
  private isDead = false;
  private isWon = false;

  // UI
  private healthText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private carryText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private hidePromptText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'AltarCleanupScene' });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  create() {
    // 重置所有状态
    this.rooms = [];
    this.corridors = [];
    this.obstacles = [];
    this.hideSpots = [];
    this.stains = [];
    this.monsters = [];
    this.loots = [];
    this.waterParticles = [];
    this.health = 100;
    this.score = 0;
    this.damageCooldown = 0;
    this.hasShield = false;
    this.carrying = 0;
    this.stamina = STAMINA_MAX;
    this.isSprinting = false;
    this.isHidden = false;
    this.hiddenSpot = null;
    this.blindTimer = 0;
    this.slowTimer = 0;
    this.alarmTimer = 0;
    this.equipmentSlots = [null, null, null];
    this.equipmentSlotBgs = [];
    this.equipmentSlotTexts = [];
    this.isDead = false;
    this.isWon = false;
    this.isSpraying = false;
    this.aimAngle = 0;

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.getMapWidth(), this.getMapHeight());
    this.cam.setBackgroundColor('#08080e');

    this.buildRooms();
    this.buildObstacles();
    this.drawMap();
    this.createDepositZone();
    this.createPlayer();
    this.createStains();
    this.createMonsters();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('🏛 祭坛清扫\n清洗各房间污渍→拾取宝物→运回中央祭坛\n左键喷射清洗 | 右键止损 | Shift疾跑 | E躲藏/献祭\n1/2/3键使用装备  价值达' + GOAL_VALUE + '通关！');
    this.time.delayedCall(5000, () => this.hideMessage());
  }

  // ── Map Building ─────────────────────────────────────────────────────────

  private getMapWidth(): number { return 2400; }
  private getMapHeight(): number { return 1800; }

  private buildRooms() {
    // 中央祭坛房间
    const hubX = MAP_CX - HUB_W / 2;
    const hubY = MAP_CY - HUB_H / 2;
    this.rooms.push({ id: 0, x: hubX, y: hubY, w: HUB_W, h: HUB_H, name: '祭坛', isHub: true });

    // 6个周围房间
    const outerRooms: { name: string; angle: number }[] = [
      { name: '图书室', angle: -90 },
      { name: '实验室', angle: -30 },
      { name: '储藏间', angle: 30 },
      { name: '祈祷室', angle: 90 },
      { name: '卧室', angle: 150 },
      { name: '厨房', angle: 210 },
    ];

    const orbitRadius = 500;
    for (let i = 0; i < outerRooms.length; i++) {
      const angle = Phaser.Math.DegToRad(outerRooms[i].angle);
      const cx = MAP_CX + Math.cos(angle) * orbitRadius;
      const cy = MAP_CY + Math.sin(angle) * orbitRadius;
      this.rooms.push({
        id: i + 1, x: cx - ROOM_W / 2, y: cy - ROOM_H / 2,
        w: ROOM_W, h: ROOM_H, name: outerRooms[i].name, isHub: false,
      });
    }

    // 走廊：每个外围房间到中央祭坛（L形）
    for (let i = 1; i <= 6; i++) {
      const room = this.rooms[i];
      const hub = this.rooms[0];
      const rcx = room.x + room.w / 2;
      const rcy = room.y + room.h / 2;
      const hcx = hub.x + hub.w / 2;
      const hcy = hub.y + hub.h / 2;
      const dx = hcx - rcx;
      const dy = hcy - rcy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / dist;
      const ny = dy / dist;
      const sx = rcx + nx * (room.w / 2);
      const sy = rcy + ny * (room.h / 2);
      const ex = hcx - nx * (hub.w / 2);
      const ey = hcy - ny * (hub.h / 2);

      const hMinX = Math.min(sx, ex) - CORR_W / 2;
      const hMaxX = Math.max(sx, ex) + CORR_W / 2;
      this.corridors.push({ x: hMinX, y: sy - CORR_W / 2, w: hMaxX - hMinX, h: CORR_W, fromRoom: i, toRoom: 0 });

      const vMinY = Math.min(sy, ey) - CORR_W / 2;
      const vMaxY = Math.max(sy, ey) + CORR_W / 2;
      this.corridors.push({ x: ex - CORR_W / 2, y: vMinY, w: CORR_W, h: vMaxY - vMinY, fromRoom: i, toRoom: 0 });
    }

    // 躲藏点：每个外围房间4个
    for (let i = 1; i <= 6; i++) {
      const room = this.rooms[i];
      this.hideSpots.push({ x: room.x + 20, y: room.y + 20, w: 60, h: 60, kind: 'locker', roomId: i, occupied: false });
      this.hideSpots.push({ x: room.x + room.w - 80, y: room.y + 20, w: 60, h: 60, kind: 'locker', roomId: i, occupied: false });
      this.hideSpots.push({ x: room.x + 20, y: room.y + room.h - 80, w: 70, h: 50, kind: 'table', roomId: i, occupied: false });
      this.hideSpots.push({ x: room.x + room.w - 90, y: room.y + room.h - 80, w: 70, h: 50, kind: 'table', roomId: i, occupied: false });
    }
    // 祭坛房间2个柜子
    {
      const hub = this.rooms[0];
      this.hideSpots.push({ x: hub.x + 20, y: hub.y + 20, w: 60, h: 60, kind: 'locker', roomId: 0, occupied: false });
      this.hideSpots.push({ x: hub.x + hub.w - 80, y: hub.y + 20, w: 60, h: 60, kind: 'locker', roomId: 0, occupied: false });
    }
  }

  /** 构建障碍物：房间和走廊的墙壁（用于碰撞检测） */
  private buildObstacles() {
    this.obstacles = [];

    // 每个房间生成四面墙，每面留一个门缺口
    for (const room of this.rooms) {
      const wallT = 16;
      const doorGap = 50;

      // 上墙
      this.obstacles.push({ x: room.x - wallT, y: room.y - wallT, w: (room.w - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: room.x + (room.w + doorGap) / 2, y: room.y - wallT, w: (room.w - doorGap) / 2 + wallT, h: wallT });
      // 下墙
      this.obstacles.push({ x: room.x - wallT, y: room.y + room.h, w: (room.w - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: room.x + (room.w + doorGap) / 2, y: room.y + room.h, w: (room.w - doorGap) / 2 + wallT, h: wallT });
      // 左墙
      this.obstacles.push({ x: room.x - wallT, y: room.y, w: wallT, h: (room.h - doorGap) / 2 });
      this.obstacles.push({ x: room.x - wallT, y: room.y + (room.h + doorGap) / 2, w: wallT, h: (room.h - doorGap) / 2 });
      // 右墙
      this.obstacles.push({ x: room.x + room.w, y: room.y, w: wallT, h: (room.h - doorGap) / 2 });
      this.obstacles.push({ x: room.x + room.w, y: room.y + (room.h + doorGap) / 2, w: wallT, h: (room.h - doorGap) / 2 });
    }

    // 走廊墙壁
    for (const corr of this.corridors) {
      const wallT = 16;
      if (corr.w > corr.h) {
        // 水平走廊：上下墙
        this.obstacles.push({ x: corr.x, y: corr.y - wallT, w: corr.w, h: wallT });
        this.obstacles.push({ x: corr.x, y: corr.y + corr.h, w: corr.w, h: wallT });
      } else {
        // 垂直走廊：左右墙
        this.obstacles.push({ x: corr.x - wallT, y: corr.y, w: wallT, h: corr.h });
        this.obstacles.push({ x: corr.x + corr.w, y: corr.y, w: wallT, h: corr.h });
      }
    }
  }

  private drawMap() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.setDepth(0);

    // 走廊地板
    for (const corr of this.corridors) {
      this.mapGraphics.fillStyle(0x14141c, 1);
      this.mapGraphics.fillRect(corr.x, corr.y, corr.w, corr.h);
    }

    // 中央祭坛房间
    const hub = this.rooms[0];
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(hub.x, hub.y, hub.w, hub.h);

    // 祭坛魔法阵
    const hcx = hub.x + hub.w / 2;
    const hcy = hub.y + hub.h / 2;
    this.mapGraphics.lineStyle(2, 0x4a2a6a, 0.4);
    this.mapGraphics.strokeCircle(hcx, hcy, 80);
    this.mapGraphics.strokeCircle(hcx, hcy, 50);
    for (let i = 0; i < 5; i++) {
      const a1 = Phaser.Math.DegToRad(i * 72 - 90);
      const a2 = Phaser.Math.DegToRad(((i + 2) % 5) * 72 - 90);
      this.mapGraphics.beginPath();
      this.mapGraphics.moveTo(hcx + Math.cos(a1) * 50, hcy + Math.sin(a1) * 50);
      this.mapGraphics.lineTo(hcx + Math.cos(a2) * 50, hcy + Math.sin(a2) * 50);
      this.mapGraphics.strokePath();
    }

    // 周围房间
    for (let i = 1; i <= 6; i++) {
      const room = this.rooms[i];
      this.mapGraphics.fillStyle(0x1c1c22, 1);
      this.mapGraphics.fillRect(room.x, room.y, room.w, room.h);

      // 房间名称
      this.add.text(room.x + room.w / 2, room.y + 14, room.name, {
        fontSize: '16px', color: '#5a5a6a', fontStyle: 'bold',
      }).setOrigin(0.5, 0).setDepth(0.5);

      // 房间编号
      this.add.text(room.x + room.w / 2, room.y + room.h / 2, String(i), {
        fontSize: '64px', color: '#2a2a34', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(0);

      // 中间长桌装饰
      this.mapGraphics.fillStyle(0x2a2a30, 1);
      this.mapGraphics.fillRect(room.x + room.w / 2 - 60, room.y + room.h / 2 - 15, 120, 30);
    }

    // 墙壁
    this.mapGraphics.fillStyle(0x3a3a55, 1);
    for (const obs of this.obstacles) {
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
    }
    this.mapGraphics.lineStyle(1, 0x555577, 0.5);
    for (const obs of this.obstacles) {
      this.mapGraphics.strokeRect(obs.x, obs.y, obs.w, obs.h);
    }

    // 躲藏点
    for (const spot of this.hideSpots) {
      const color = spot.kind === 'locker' ? 0x3a3a4a : 0x4a3a2a;
      this.mapGraphics.fillStyle(color, 1);
      this.mapGraphics.lineStyle(2, 0x6a6a7a, 1);
      this.mapGraphics.fillRect(spot.x, spot.y, spot.w, spot.h);
      this.mapGraphics.strokeRect(spot.x, spot.y, spot.w, spot.h);
      const label = spot.kind === 'locker' ? '柜' : '桌';
      this.add.text(spot.x + spot.w / 2, spot.y + spot.h / 2, label, {
        fontSize: '10px', color: '#888888',
      }).setOrigin(0.5).setDepth(0.5);
    }
  }

  // ── Deposit Zone (祭坛) ─────────────────────────────────────────────────

  private createDepositZone() {
    const hub = this.rooms[0];
    const cx = hub.x + hub.w / 2;
    const cy = hub.y + hub.h / 2;
    const container = this.add.container(cx, cy);
    container.setDepth(3);

    const pad = this.add.rectangle(0, 0, 100, 100, 0x220044, 0.5);
    const ring = this.add.circle(0, 0, 45, 0x9933ff, 0.15);
    ring.setStrokeStyle(3, 0x9933ff, 0.8);
    const label = this.add.text(0, -10, '祭坛', { fontSize: '16px', color: '#cc88ff' }).setOrigin(0.5);
    const sub = this.add.text(0, 12, '投喂宝物', { fontSize: '11px', color: '#8855aa' }).setOrigin(0.5);
    container.add([pad, ring, label, sub]);

    this.tweens.add({
      targets: ring, scale: { from: 0.85, to: 1.15 },
      duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
    this.depositZone = container;
  }

  // ── Player ───────────────────────────────────────────────────────────────

  private createPlayer() {
    const hub = this.rooms[0];
    this.player = this.add.circle(hub.x + hub.w / 2, hub.y + hub.h / 2 + 60, 12, 0x00ff00);
    this.player.setStrokeStyle(2, 0xffffff);
    this.player.setDepth(5);
  }

  // ── Stains (污渍) ───────────────────────────────────────────────────────

  private createStains() {
    // 每个外围房间放5-6个污渍
    for (let roomId = 1; roomId <= 6; roomId++) {
      const room = this.rooms[roomId];
      const count = Phaser.Math.Between(5, 6);
      let placed = 0;
      let attempts = 0;

      while (placed < count && attempts < 200) {
        const x = Phaser.Math.Between(room.x + 25, room.x + room.w - 25);
        const y = Phaser.Math.Between(room.y + 25, room.y + room.h - 25);

        // 避开躲藏点
        let overlap = false;
        for (const spot of this.hideSpots) {
          if (Phaser.Math.Distance.Between(x, y, spot.x + spot.w / 2, spot.y + spot.h / 2) < 40) {
            overlap = true; break;
          }
        }
        if (overlap) { attempts++; continue; }

        // 避开已有污渍
        for (const s of this.stains) {
          if (Phaser.Math.Distance.Between(x, y, s.x, s.y) < 50) { overlap = true; break; }
        }
        if (overlap) { attempts++; continue; }

        this.createSingleStain(x, y, roomId);
        placed++;
        attempts++;
      }
    }
  }

  private createSingleStain(x: number, y: number, roomId: number) {
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

    // 外皮3面
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
      roomId,
      stoneType: tier.type,
      stoneValue,
      revealStage: 0,
      cursed,
      faceOffset,
    });
  }

  private rollStoneType(): StoneTier {
    let roll = Math.random() * STONE_TIERS_TOTAL_WEIGHT;
    for (const tier of STONE_TIERS) {
      roll -= tier.weight;
      if (roll <= 0) return tier;
    }
    return STONE_TIERS[0];
  }

  // ── Monsters ─────────────────────────────────────────────────────────────

  private createMonsters() {
    // 猎手4只：随机分布在4个不同外围房间
    const hunterRooms = [1, 2, 3, 4, 5, 6];
    Phaser.Utils.Array.Shuffle(hunterRooms);
    for (let i = 0; i < 4; i++) {
      const roomId = hunterRooms[i];
      const room = this.rooms[roomId];
      const x = Phaser.Math.Between(room.x + 30, room.x + room.w - 30);
      const y = Phaser.Math.Between(room.y + 30, room.y + room.h - 30);
      this.spawnHunter(x, y);
    }

    // 陷阱怪5只：随机分布在5个不同外围房间
    const trapRooms = [1, 2, 3, 4, 5, 6];
    Phaser.Utils.Array.Shuffle(trapRooms);
    for (let i = 0; i < 5; i++) {
      const roomId = trapRooms[i];
      const room = this.rooms[roomId];
      const x = Phaser.Math.Between(room.x + 30, room.x + room.w - 30);
      const y = Phaser.Math.Between(room.y + 30, room.y + room.h - 30);
      this.spawnTrap(x, y);
    }
  }

  private spawnHunter(x: number, y: number) {
    const sprite = this.add.rectangle(x, y, MONSTER_W, MONSTER_W, 0xff00ff);
    sprite.setDepth(5);
    this.monsters.push({
      sprite,
      speed: MONSTER_HUNT_PATROL,
      chaseSpeed: MONSTER_HUNT_CHASE,
      direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
      patrolTimer: Phaser.Math.Between(0, 3000),
      isChasing: false,
      visionRange: MONSTER_HUNT_VISION,
      visionAngle: Math.PI / 3,
      homeX: x,
      homeY: y,
      giveUpTimer: 0,
      giveUpDuration: MONSTER_HUNT_GIVEUP,
      isHunter: true,
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
    });
  }

  private spawnTrap(x: number, y: number) {
    const sprite = this.add.rectangle(x, y, MONSTER_W, MONSTER_W, 0xff4400);
    sprite.setDepth(5);
    sprite.setAlpha(0); // 初始隐身

    // 贴最近的墙
    const wall = this.findNearestWall(x, y);
    if (wall) {
      sprite.x = wall.x;
      sprite.y = wall.y;
    }

    this.monsters.push({
      sprite,
      speed: 0,
      chaseSpeed: 0,
      direction: new Phaser.Math.Vector2(0, 0),
      patrolTimer: 0,
      isChasing: false,
      visionRange: TRAP_REVEAL_RANGE,
      visionAngle: Math.PI * 2,
      homeX: sprite.x,
      homeY: sprite.y,
      giveUpTimer: 0,
      giveUpDuration: 0,
      isHunter: false,
      stunTimer: 0,
      attackCooldown: 0,
      returnHomeTimer: 0,
      lastSeenX: 0,
      lastSeenY: 0,
      hasLastSeen: false,
      searchingTimer: 0,
      spawnDelay: 0,
      isTrap: true,
      trapState: 'hidden',
      trapTimer: 0,
      wallAngle: wall?.angle ?? 0,
      isSpawner: false,
      alertTimer: 0,
    });
  }

  /** 找离 (x,y) 最近的墙壁 */
  private findNearestWall(x: number, y: number): { x: number; y: number; angle: number } | null {
    let best: { x: number; y: number; angle: number } | null = null;
    let minDist = Infinity;
    for (const obs of this.obstacles) {
      const cx = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
      const cy = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist && dist > 0 && dist < 100) {
        const offset = 14;
        const len = dist || 1;
        const px = cx + (dx / len) * offset;
        const py = cy + (dy / len) * offset;
        const angle = Math.atan2(dy, dx);
        minDist = dist;
        best = { x: px, y: py, angle };
      }
    }
    return best;
  }

  // ── Fog of war ────────────────────────────────────────────────────────────

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

  // ── UI ───────────────────────────────────────────────────────────────────

  private createUI() {
    this.healthText = this.add.text(16, 16, '生命: 100', {
      fontSize: '18px', color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.scoreText = this.add.text(16, 40, `价值: 0 / ${GOAL_VALUE}`, {
      fontSize: '18px', color: '#ffdd00',
    }).setScrollFactor(0).setDepth(20);

    this.carryText = this.add.text(16, 64, '携带: 0/' + this.carryCapacity, {
      fontSize: '16px', color: '#66ffcc',
    }).setScrollFactor(0).setDepth(20);

    this.statusText = this.add.text(16, 86, '', {
      fontSize: '14px', color: '#ff8844',
    }).setScrollFactor(0).setDepth(20);

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

    // 返回菜单按钮
    const backBg = this.add.rectangle(730, 30, 110, 30, 0x333333, 0.85)
      .setScrollFactor(0).setDepth(29);
    backBg.setStrokeStyle(2, 0x888888);
    const backBtn = this.add.text(730, 30, '← 菜单', {
      fontSize: '16px', color: '#ffffff',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(30);
    backBtn.on('pointerdown', () => this.scene.start('MenuScene'));

    // 装备槽
    this.add.text(700, 52, '装备', {
      fontSize: '12px', color: '#aaaaaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(29);
    for (let i = 0; i < 3; i++) {
      const sx = 660 + i * 44;
      const sy = 78;
      const bg = this.add.rectangle(sx, sy, 38, 38, 0x222222, 0.85)
        .setScrollFactor(0).setDepth(29);
      bg.setStrokeStyle(2, 0x666666);
      this.add.text(sx - 14, sy - 12, String(i + 1), {
        fontSize: '10px', color: '#888888',
      }).setScrollFactor(0).setDepth(30);
      const txt = this.add.text(sx, sy + 2, '', {
        fontSize: '20px', align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(30);
      this.equipmentSlotBgs.push(bg);
      this.equipmentSlotTexts.push(txt);
    }
    this.updateEquipmentUI();

    // 底部操作提示
    this.add.text(400, 585, 'WASD移动 Shift疾跑 左键喷射 右键止损 E躲藏/献祭 1/2/3装备', {
      fontSize: '12px', color: '#666666',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
  }

  private updateScoreUI() {
    const newText = `价值: ${this.score} / ${GOAL_VALUE}`;
    if (this.scoreText.text !== newText) this.scoreText.setText(newText);
    this.scoreText.setColor(this.score >= GOAL_VALUE ? '#00ff00' : '#ffdd00');
  }

  private updateStatusUI() {
    const effects: string[] = [];
    if (this.hasShield) effects.push('🛡护盾');
    if (this.blindTimer > 0) effects.push('👁致盲');
    if (this.slowTimer > 0) effects.push('🐌减速');
    if (this.alarmTimer > 0) effects.push('🚨警报');
    const newText = effects.join(' ');
    if (this.statusText.text !== newText) this.statusText.setText(newText);
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

  // ── Input ────────────────────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.slotKey1 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
    this.slotKey2 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
    this.slotKey3 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);

    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) this.isSpraying = true;
      if (pointer.rightButtonDown()) this.tryAbandonStone();
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) this.isSpraying = false;
    });

    this.sprayGraphics = this.add.graphics();
    this.sprayGraphics.setDepth(7);
  }

  // ── Update Loop ──────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.isDead || this.isWon) {
      if (Phaser.Input.Keyboard.JustDown(this.escKey)) this.scene.start('MenuScene');
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    // E键：躲藏 / 献祭
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.tryInteract();
    }

    // 1/2/3 键使用装备
    if (Phaser.Input.Keyboard.JustDown(this.slotKey1)) this.useEquipment(0);
    if (Phaser.Input.Keyboard.JustDown(this.slotKey2)) this.useEquipment(1);
    if (Phaser.Input.Keyboard.JustDown(this.slotKey3)) this.useEquipment(2);

    // 躲藏点提示
    let nearHide = false;
    if (!this.isHidden) {
      for (const hs of this.hideSpots) {
        const cx = hs.x + hs.w / 2;
        const cy = hs.y + hs.h / 2;
        if (Phaser.Math.Distance.Between(this.player.x, this.player.y, cx, cy) < HIDE_SPOT_RANGE + 20) {
          nearHide = true; break;
        }
      }
    }
    const hidePrompt = nearHide ? '按 E 躲避' : '';
    if (this.hidePromptText.text !== hidePrompt) this.hidePromptText.setText(hidePrompt);

    // 瞄准角度
    const pointer = this.input.activePointer;
    const mouseWorldX = pointer.x + this.cam.scrollX;
    const mouseWorldY = pointer.y + this.cam.scrollY;
    this.aimAngle = Math.atan2(mouseWorldY - this.player.y, mouseWorldX - this.player.x);

    if (!this.isHidden) {
      this.handlePlayerMovement(delta);
      this.updateSpray(delta);
      this.updateStains(delta);
    } else {
      this.sprayGraphics.clear();
      this.isSpraying = false;
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * (delta / 1000));
    }

    this.updateMonsters(delta);
    this.checkLootPickup();
    this.checkMonsterCollision();
    this.updateNegativeEffects(delta);
    this.updateFog();
    this.updateStatusUI();
    this.drawStaminaBar();
    this.updateScoreUI();

    // 携带量UI
    const carryStr = `携带: ${this.carrying}/${this.carryCapacity}`;
    if (this.carryText.text !== carryStr) this.carryText.setText(carryStr);

    // 生命UI
    const hpStr = `生命: ${this.health}`;
    if (this.healthText.text !== hpStr) this.healthText.setText(hpStr);

    if (this.damageCooldown > 0) this.damageCooldown -= delta;
  }

  // ── Player Movement ──────────────────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    const dt = delta / 1000;

    let inputX = 0, inputY = 0;
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) inputX -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) inputX += 1;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) inputY -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) inputY += 1;
    const hasInput = inputX !== 0 || inputY !== 0;

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

    this.player.x = Phaser.Math.Clamp(this.player.x, 16, this.getMapWidth() - 16);
    this.player.y = Phaser.Math.Clamp(this.player.y, 16, this.getMapHeight() - 16);
  }

  // ── Stamina Bar ─────────────────────────────────────────────────────────

  private drawStaminaBar() {
    const g = this.staminaBar;
    g.clear();
    const barW = 200, barH = 12, barX = 16, barY = 110;

    g.fillStyle(0x222222, 0.8);
    g.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

    const pct = this.stamina / STAMINA_MAX;
    const fillW = barW * pct;
    if (this.isSprinting) g.fillStyle(0xffcc00, 0.9);
    else if (this.stamina < STAMINA_SPRINT_MIN) g.fillStyle(0xff4444, 0.9);
    else g.fillStyle(0x44ff44, 0.9);
    g.fillRect(barX, barY, fillW, barH);

    g.lineStyle(1, 0x888888, 0.6);
    g.strokeRect(barX, barY, barW, barH);
  }

  // ── Hide System ──────────────────────────────────────────────────────────

  private tryInteract() {
    // 1. 在祭坛旁 → 献祭所有宝物
    const distToAltar = Phaser.Math.Distance.Between(
      this.player.x, this.player.y, this.depositZone.x, this.depositZone.y
    );
    if (distToAltar < 55 && this.carrying > 0) {
      // 献祭所有已拾取且未献祭的宝物
      let totalValue = 0;
      let deposited = 0;
      for (const loot of this.loots) {
        if (loot.collected && !loot.deposited) {
          this.score += loot.value;
          totalValue += loot.value;
          deposited++;
          loot.deposited = true;
          loot.collected = false;
          loot.sprite.setVisible(false);
          this.tweens.killTweensOf(loot.sprite);
        }
      }
      this.carrying = 0;
      this.cameras.main.flash(200, 100, 50, 255);
      this.showMessage(`祭坛已接收 ${deposited} 件宝物！\n价值 +${totalValue}`, 1500);
      this.updateScoreUI();
      if (this.score >= GOAL_VALUE) {
        this.win();
      }
      return;
    }

    // 2. 躲藏
    let nearest: HideSpot | null = null;
    let minD = HIDE_SPOT_RANGE;
    for (const hs of this.hideSpots) {
      const cx = hs.x + hs.w / 2;
      const cy = hs.y + hs.h / 2;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, cx, cy);
      if (d < minD) { minD = d; nearest = hs; }
    }
    if (nearest) {
      if (!this.isHidden) this.enterHide(nearest);
      else this.exitHide();
      return;
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
    for (const m of this.monsters) {
      m.isChasing = false;
      m.hasLastSeen = false;
      m.searchingTimer = 0;
      m.returnHomeTimer = 5000;
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
      this.player.x = this.hiddenSpot.x + this.hiddenSpot.w / 2;
      this.player.y = this.hiddenSpot.y + this.hiddenSpot.h + 15;
      this.hiddenSpot.occupied = false;
      this.hiddenSpot = null;
    }
    this.player.setFillStyle(0x00ff00);
    this.player.setAlpha(1);
  }

  // ── Water Gun Spray ──────────────────────────────────────────────────────

  private updateSpray(_delta: number) {
    const g = this.sprayGraphics;
    g.clear();
    if (!this.isSpraying) return;

    const px = this.player.x;
    const py = this.player.y;
    const a = this.aimAngle;
    const halfAngle = SPRAY_HALF_ANGLE;
    const range = SPRAY_RANGE;

    g.fillStyle(0x44aaff, 0.2);
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + Math.cos(a - halfAngle) * range, py + Math.sin(a - halfAngle) * range);
    g.lineTo(px + Math.cos(a + halfAngle) * range, py + Math.sin(a + halfAngle) * range);
    g.closePath();
    g.fillPath();

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
        targets: drop, alpha: 0, scale: 0.3,
        duration: 300, onComplete: () => drop.destroy(),
      });
    }
    this.waterParticles = this.waterParticles.filter(p => p.active);
  }

  // ── Stain Cleaning ───────────────────────────────────────────────────────

  private updateStains(delta: number) {
    if (!this.isSpraying) return;

    const px = this.player.x;
    const py = this.player.y;
    const a = this.aimAngle;
    const halfAngle = SPRAY_HALF_ANGLE;
    const range = SPRAY_RANGE;
    const cleanPower = CLEAN_POWER * (delta / 1000);

    let bestTarget: { stain: Stain; faceIdx: number } | null = null;
    let bestScore = Infinity;

    for (const stain of this.stains) {
      if (stain.cleaned) continue;

      const dx = stain.x - px;
      const dy = stain.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > range + stain.radius) continue;

      const stainAngle = Math.atan2(dy, dx);
      let diff = Math.abs(stainAngle - a);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > halfAngle) continue;

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

      const score = dist + diff * 100;
      if (score < bestScore) {
        bestScore = score;
        bestTarget = { stain, faceIdx: closestFace };
      }
    }

    if (!bestTarget) return;

    const { stain, faceIdx } = bestTarget;
    const face = stain.faces[faceIdx];
    face.cleanliness -= cleanPower;
    stain.faceSprites[faceIdx].setAlpha(Math.max(0, face.cleanliness / 100) * 0.85);

    const totalProgress = stain.faces.reduce((s, f) => s + (100 - f.cleanliness), 0) / 300;
    stain.innerSprite.setAlpha(totalProgress);

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
        stain.cleaned = true;
        for (const fs of stain.faceSprites) fs.setVisible(false);
        stain.innerSprite.setAlpha(1);
        this.onStainCleaned(stain);
      }
    }
  }

  private showClue(x: number, y: number, text: string, color: string) {
    const clueText = this.add.text(x, y - 20, text, {
      fontSize: '13px', color: color,
      stroke: '#000000', strokeThickness: 3,
      wordWrap: { width: 200 }, align: 'center',
    }).setOrigin(0.5).setDepth(8);

    this.tweens.add({
      targets: clueText, y: y - 55, alpha: { from: 1, to: 0 },
      duration: 2200, onComplete: () => clueText.destroy(),
    });
  }

  private onStainCleaned(stain: Stain) {
    const tier = STONE_TIERS.find(t => t.type === stain.stoneType)!;
    this.spawnStoneLoot(stain.x, stain.y, stain.stoneType, stain.stoneValue);

    if (stain.cursed) {
      this.triggerNegativeEffect(stain.x, stain.y);
    }

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

  // ── Loot ─────────────────────────────────────────────────────────────────

  private spawnStoneLoot(x: number, y: number, type: LootType, value: number) {
    const info = LOOT_INFO[type];
    const circle = this.add.circle(0, 0, 10, info.color);
    circle.setStrokeStyle(2, 0xffffff);
    const container = this.add.container(x, y, [circle]);
    container.setDepth(4);

    this.tweens.add({
      targets: circle, scale: { from: 0.8, to: 1.3 },
      duration: 600, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });

    this.loots.push({ x, y, type, value, collected: false, deposited: false, sprite: container });
  }

  private checkLootPickup() {
    for (const loot of this.loots) {
      if (loot.collected || loot.deposited) continue;

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, loot.x, loot.y);
      if (dist < 25) {
        const isUtility = loot.type === 'medkit' || loot.type === 'shield' || loot.type === 'bomb';

        // 非装备类检查携带容量
        if (!isUtility && this.carrying >= this.carryCapacity) {
          continue;
        }

        loot.collected = true;
        loot.sprite.setVisible(false);
        this.tweens.killTweensOf(loot.sprite);

        const info = LOOT_INFO[loot.type];
        if (isUtility) {
          // 装备类：存入装备槽
          const emptySlot = this.equipmentSlots.findIndex(s => s === null);
          if (emptySlot >= 0) {
            this.equipmentSlots[emptySlot] = loot.type;
            this.updateEquipmentUI();
            this.showMessage(`拾取 ${info.name}！\n存入装备槽 ${emptySlot + 1}`);
          } else {
            // 装备槽满，立即使用
            if (loot.type === 'medkit') {
              this.health = Math.min(100, this.health + 30);
              this.showMessage(`装备槽满！立即使用 ${info.name}，生命+30`);
            } else if (loot.type === 'shield') {
              this.hasShield = true;
              this.showMessage(`装备槽满！立即使用 ${info.name}，获得护盾`);
            } else {
              this.useBomb();
            }
          }
        } else {
          this.carrying++;
          this.showMessage(`拾取 ${info.name}！\n+${loot.value} 价值（需运回祭坛）`);
        }
        this.time.delayedCall(1200, () => this.hideMessage());
      }
    }
  }

  // ── Abandon Stone (止损) ─────────────────────────────────────────────────

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

  // ── Equipment ────────────────────────────────────────────────────────────

  private useEquipment(slot: number) {
    const item = this.equipmentSlots[slot];
    if (!item) return;

    if (item === 'medkit') {
      this.health = Math.min(100, this.health + 30);
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

  private useBomb() {
    const px = this.player.x;
    const py = this.player.y;
    this.showMessage(`💥 引爆 雷石！\n周围怪物定住 5 秒！`);

    const shockwave = this.add.circle(px, py, 10, 0xff8800, 0.5);
    shockwave.setStrokeStyle(4, 0xffaa00, 0.8);
    shockwave.setDepth(8);
    this.tweens.add({
      targets: shockwave, radius: BOMB_RANGE, alpha: 0,
      duration: 400, ease: 'Cubic.easeOut', onComplete: () => shockwave.destroy(),
    });

    this.cam.shake(300, 0.02);
    this.cam.flash(150, 255, 180, 0, true);

    for (const monster of this.monsters) {
      const dist = Phaser.Math.Distance.Between(px, py, monster.sprite.x, monster.sprite.y);
      if (dist <= BOMB_RANGE) {
        monster.stunTimer = BOMB_STUN;
        monster.isChasing = false;
        monster.giveUpTimer = 0;
        if (monster.isTrap) {
          monster.sprite.destroy();
          const idx = this.monsters.indexOf(monster);
          if (idx >= 0) this.monsters.splice(idx, 1);
        }
      }
    }
  }

  // ── Negative Effects ─────────────────────────────────────────────────────

  private triggerNegativeEffect(x: number, y: number) {
    const totalWeight = NEGATIVE_TABLE.reduce((s, e) => s + e.weight, 0);
    let roll = Math.random() * totalWeight;
    let chosen: NegativeType = 'spawn_monster';
    for (const entry of NEGATIVE_TABLE) {
      roll -= entry.weight;
      if (roll <= 0) { chosen = entry.type; break; }
    }

    switch (chosen) {
      case 'spawn_monster':
        this.spawnMonsterNear(x, y);
        this.showMessage('⚠ 怪物刷出来了！\n小心猎手追击！');
        this.time.delayedCall(2500, () => this.hideMessage());
        break;
      case 'alarm':
        this.alarmTimer = 5000;
        for (const m of this.monsters) {
          if (!m.isTrap) {
            m.isChasing = true;
            m.giveUpTimer = 5000;
          }
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

  private spawnMonsterNear(x: number, y: number) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 100) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Phaser.Math.Between(80, 200);
      const mx = x + Math.cos(angle) * dist;
      const my = y + Math.sin(angle) * dist;

      if (mx > 30 && mx < this.getMapWidth() - 30 && my > 30 && my < this.getMapHeight() - 30) {
        if (!this.isObstacleAt(mx, my, 0)) {
          const sprite = this.add.rectangle(mx, my, MONSTER_W, MONSTER_W, 0xff0044);
          sprite.setDepth(5);
          sprite.setAlpha(0);
          this.tweens.add({ targets: sprite, alpha: 1, duration: 500 });

          this.monsters.push({
            sprite,
            speed: 50,
            chaseSpeed: 240,
            direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
            patrolTimer: 0,
            isChasing: false,
            visionRange: MONSTER_HUNT_VISION,
            visionAngle: Math.PI / 3,
            homeX: mx, homeY: my,
            giveUpTimer: 10000,
            giveUpDuration: 10000,
            isHunter: true,
            stunTimer: 0,
            attackCooldown: 0,
            returnHomeTimer: 0,
            lastSeenX: x, lastSeenY: y,
            hasLastSeen: true,
            searchingTimer: 0,
            spawnDelay: SPAWN_DELAY_MS,
            isTrap: false,
            trapState: 'hidden',
            trapTimer: 0,
            wallAngle: 0,
            isSpawner: true,
            alertTimer: 0,
          });
          placed = true;
          this.sound.play('scream');
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

  // ── Monster AI ────────────────────────────────────────────────────────────

  private updateMonsters(delta: number) {
    const dt = delta / 1000;

    for (const monster of this.monsters) {
      // 陷阱型怪物：独立状态机
      if (monster.isTrap) {
        this.updateTrapMonster(monster, delta);
        continue;
      }

      // 眩晕
      if (monster.stunTimer > 0) {
        monster.stunTimer -= delta;
        monster.sprite.setFillStyle(0x666666);
        continue;
      } else {
        monster.sprite.setFillStyle(monster.isSpawner ? 0xff0044 : 0xff00ff);
      }

      // 警觉闪烁
      if (monster.alertTimer > 0) {
        monster.alertTimer -= delta;
        const blink = Math.floor(monster.alertTimer / 100) % 2 === 0;
        monster.sprite.setFillStyle(blink ? 0xff0000 : 0x880000);
        continue;
      }

      // 攻击停顿
      if (monster.attackCooldown > 0) {
        monster.attackCooldown -= delta;
        monster.sprite.setFillStyle(0xff4444);
        continue;
      }

      // 刷出延迟
      if (monster.spawnDelay > 0) {
        monster.spawnDelay -= delta;
        const blink = Math.floor(monster.spawnDelay / 200) % 2 === 0;
        monster.sprite.setFillStyle(blink ? 0xffff00 : 0xff00ff);
        if (monster.spawnDelay <= 0) {
          monster.spawnDelay = 0;
          monster.isChasing = true;
        } else {
          continue;
        }
      }

      const distToPlayer = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y, this.player.x, this.player.y
      );
      const canSee = this.monsterCanSeePlayer(monster, distToPlayer);

      if (canSee) {
        if (!monster.isChasing && monster.alertTimer <= 0) {
          monster.alertTimer = 600;
          this.sound.play('crying');
          this.cam.shake(150, 0.005);
        }
        monster.isChasing = true;
        monster.giveUpTimer = monster.giveUpDuration;
        monster.lastSeenX = this.player.x;
        monster.lastSeenY = this.player.y;
        monster.hasLastSeen = true;
        monster.searchingTimer = 0;
      } else if (monster.isChasing) {
        if (monster.hasLastSeen) {
          const distToLastSeen = Phaser.Math.Distance.Between(
            monster.sprite.x, monster.sprite.y, monster.lastSeenX, monster.lastSeenY
          );
          if (distToLastSeen > 25) {
            const dir = new Phaser.Math.Vector2(
              monster.lastSeenX - monster.sprite.x,
              monster.lastSeenY - monster.sprite.y
            ).normalize();
            const newX = monster.sprite.x + dir.x * monster.chaseSpeed * dt;
            const newY = monster.sprite.y + dir.y * monster.chaseSpeed * dt;
            if (!this.isObstacleAt(newX, monster.sprite.y, 0)) monster.sprite.x = newX;
            if (!this.isObstacleAt(monster.sprite.x, newY, 0)) monster.sprite.y = newY;
            continue;
          } else {
            monster.searchingTimer += delta;
            monster.patrolTimer += delta;
            if (monster.patrolTimer > 800) {
              monster.patrolTimer = 0;
              const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
              monster.direction.set(Math.cos(angle), Math.sin(angle));
            }
            const newX = monster.sprite.x + monster.direction.x * monster.speed * 1.5 * dt;
            const newY = monster.sprite.y + monster.direction.y * monster.speed * 1.5 * dt;
            if (!this.isObstacleAt(newX, monster.sprite.y, 0)) monster.sprite.x = newX;
            else monster.direction.x *= -1;
            if (!this.isObstacleAt(monster.sprite.x, newY, 0)) monster.sprite.y = newY;
            else monster.direction.y *= -1;

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
          monster.giveUpTimer -= delta;
          if (monster.giveUpTimer <= 0) monster.isChasing = false;
        }
      }

      if (monster.isChasing) {
        const chaseSpd = monster.isSpawner ? 240 : monster.chaseSpeed;
        const dir = new Phaser.Math.Vector2(
          this.player.x - monster.sprite.x,
          this.player.y - monster.sprite.y
        ).normalize();
        const newX = monster.sprite.x + dir.x * chaseSpd * dt;
        const newY = monster.sprite.y + dir.y * chaseSpd * dt;
        if (!this.isObstacleAt(newX, monster.sprite.y, 0)) monster.sprite.x = newX;
        if (!this.isObstacleAt(monster.sprite.x, newY, 0)) monster.sprite.y = newY;
      } else {
        // 巡逻
        monster.patrolTimer += delta;
        if (monster.patrolTimer > 3000) {
          monster.patrolTimer = 0;
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          monster.direction.set(Math.cos(angle), Math.sin(angle));
        }

        let returnHome = false;
        if (monster.returnHomeTimer > 0) {
          monster.returnHomeTimer -= delta;
          returnHome = true;
        }

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
        if (!this.isObstacleAt(newX, monster.sprite.y, 0)) monster.sprite.x = newX;
        else monster.direction.x *= -1;
        if (!this.isObstacleAt(monster.sprite.x, newY, 0)) monster.sprite.y = newY;
        else monster.direction.y *= -1;
      }
    }

    // Clamp all monsters to map bounds
    for (const monster of this.monsters) {
      monster.sprite.x = Phaser.Math.Clamp(monster.sprite.x, 16, this.getMapWidth() - 16);
      monster.sprite.y = Phaser.Math.Clamp(monster.sprite.y, 16, this.getMapHeight() - 16);
    }
  }

  private monsterCanSeePlayer(monster: Monster, distToPlayer: number): boolean {
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

    if (this.lineBlockedByObstacle(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y)) {
      return false;
    }
    return true;
  }

  // ── Trap Monster State Machine ────────────────────────────────────────────

  private updateTrapMonster(monster: Monster, delta: number) {
    const distToPlayer = Phaser.Math.Distance.Between(
      monster.sprite.x, monster.sprite.y, this.player.x, this.player.y
    );

    if (monster.stunTimer > 0) {
      monster.stunTimer -= delta;
      monster.sprite.setFillStyle(0x666666);
      return;
    }

    switch (monster.trapState) {
      case 'hidden': {
        monster.sprite.setAlpha(0);
        if (distToPlayer < TRAP_REVEAL_RANGE && !this.isHidden) {
          monster.trapState = 'revealing';
          monster.trapTimer = TRAP_REVEAL_DELAY;
          monster.sprite.setAlpha(1);
          monster.sprite.setFillStyle(0xff8800);
        }
        break;
      }
      case 'revealing': {
        monster.trapTimer -= delta;
        const blink = Math.floor(monster.trapTimer / 250) % 2 === 0;
        monster.sprite.setFillStyle(blink ? 0xffff00 : 0xff4400);
        monster.sprite.setAlpha(1);
        const growScale = 1 + (1 - monster.trapTimer / TRAP_REVEAL_DELAY) * 0.8;
        monster.sprite.setScale(growScale);

        if (monster.trapTimer <= 0) {
          this.dealTrapExplosionDamage(monster);
          this.playTrapExplosionEffect(monster.sprite.x, monster.sprite.y);
          monster.sprite.destroy();
          const idx = this.monsters.indexOf(monster);
          if (idx >= 0) this.monsters.splice(idx, 1);
        }
        break;
      }
    }
  }

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
      this.damageCooldown = 800;
      const kx = this.player.x - monster.sprite.x;
      const ky = this.player.y - monster.sprite.y;
      const klen = Math.sqrt(kx * kx + ky * ky) || 1;
      this.player.x += (kx / klen) * 30;
      this.player.y += (ky / klen) * 30;
      this.player.setFillStyle(0xff0000);
      this.time.delayedCall(200, () => {
        if (!this.isDead) this.player.setFillStyle(0x00ff00);
      });
      if (this.health <= 0) this.die();
    }
  }

  private playTrapExplosionEffect(x: number, y: number) {
    this.cam.shake(200, 0.02);
    const fx = this.add.circle(x, y, 4, 0xff6600, 0.8);
    fx.setDepth(6);
    this.tweens.add({
      targets: fx, radius: TRAP_STRIKE_RANGE, alpha: 0,
      duration: 300, ease: 'Quad.easeOut', onComplete: () => fx.destroy(),
    });
    const flash = this.add.circle(x, y, TRAP_STRIKE_RANGE, 0xffff00, 0.5);
    flash.setDepth(7);
    this.tweens.add({
      targets: flash, alpha: 0, duration: 200, onComplete: () => flash.destroy(),
    });
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  private checkMonsterCollision() {
    if (this.damageCooldown > 0) return;
    if (this.isHidden) return;

    for (const monster of this.monsters) {
      if (monster.isTrap) continue;

      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, monster.sprite.x, monster.sprite.y
      );

      if (dist < 28) {
        if (this.hasShield) {
          this.hasShield = false;
          this.showMessage('🛡 护盾抵挡了攻击！');
          this.time.delayedCall(1000, () => this.hideMessage());
          this.damageCooldown = 1000;
          monster.attackCooldown = 1600;
          const kx = monster.sprite.x - this.player.x;
          const ky = monster.sprite.y - this.player.y;
          const klen = Math.sqrt(kx * kx + ky * ky) || 1;
          monster.sprite.x += (kx / klen) * 40;
          monster.sprite.y += (ky / klen) * 40;
        } else {
          this.health -= 15;
          this.damageCooldown = 800;
          monster.attackCooldown = 1600;
          const kx = this.player.x - monster.sprite.x;
          const ky = this.player.y - monster.sprite.y;
          const klen = Math.sqrt(kx * kx + ky * ky) || 1;
          this.player.x += (kx / klen) * 20;
          this.player.y += (ky / klen) * 20;
          this.player.setFillStyle(0xff0000);
          this.time.delayedCall(200, () => {
            if (!this.isDead) this.player.setFillStyle(0x00ff00);
          });
          if (this.health <= 0) this.die();
        }
        break;
      }
    }
  }

  // ── Collision Helpers ────────────────────────────────────────────────────

  private isObstacleAt(px: number, py: number, _halfSize: number): boolean {
    for (const obs of this.obstacles) {
      if (px >= obs.x && px <= obs.x + obs.w && py >= obs.y && py <= obs.y + obs.h) {
        return true;
      }
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

  // ── End States ────────────────────────────────────────────────────────────

  private die() {
    this.isDead = true;
    this.player.setFillStyle(0x666666);
    this.isSpraying = false;
    this.sprayGraphics.clear();
    this.showMessage(`💀 你死了！\n最终价值: ${this.score}\n\n按ESC返回菜单`, 999999);
  }

  private win() {
    this.isWon = true;
    this.showMessage(`🎉 祭坛完成！\n最终价值: ${this.score}\n\n按ESC返回菜单`, 999999);
  }

  // ── Message ───────────────────────────────────────────────────────────────

  private showMessage(text: string, duration: number = 3000) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
    if (duration < 999999) {
      this.time.delayedCall(duration, () => this.hideMessage());
    }
  }

  private hideMessage() {
    this.messageText.setVisible(false);
  }
}
