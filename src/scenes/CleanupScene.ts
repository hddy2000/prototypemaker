import Phaser from 'phaser';

// ── Types ──────────────────────────────────────────────────────────────────

interface CarriageDef {
  index: number;          // 0 = 车头, 1..6 = 车厢
  x: number;              // 左边界
  width: number;
  isLocomotive: boolean;  // 车头（动能区）
}

interface DoorDef {
  x: number;              // 门的中心 x
  y: number;
  carriageIndex: number;  // 所属车厢（1..6）
  side: 'front' | 'back'; // front = 朝车头方向, back = 朝车尾方向
  sealed: boolean;        // 是否被封锁
  sealGraphic?: Phaser.GameObjects.Rectangle;
  sealTimer: number;      // 封锁后累计计时，到时自动解除
}

interface HideSpot {
  x: number; y: number; w: number; h: number;
  kind: 'toilet' | 'locker';
  occupied: boolean;      // 玩家是否正躲在里面
}

interface Monster {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;   // 鬼.png 贴图
  eye: Phaser.GameObjects.Arc;
  facing: Phaser.Math.Vector2;
  speed: number;
  wanderTimer: number;
  alive: boolean;
  pollutionDropTimer: number;
  carriageIndex: number;  // 当前所在车厢
  dying: boolean;         // 正在消散
}

/** 小道状态：安全(棕) → 预警(黄光1秒,可移动) → 危险(红光,移动即死) → 安全 */
type PathState = 'safe' | 'warning' | 'danger';

/** 规则怪谈小道（一二三木头人） */
interface SidePath {
  id: string;
  fromCar: number;          // 起点车厢编号（0=车头）
  toCar: number;            // 终点车厢编号
  // 小道由三段矩形组成：入口竖段 + 水平段 + 出口竖段
  entryRect: { x: number; y: number; w: number; h: number };
  horizRect: { x: number; y: number; w: number; h: number };
  exitRect: { x: number; y: number; w: number; h: number };
  state: PathState;          // 当前状态
  stateTimer: number;       // 当前状态剩余时间（ms）
  nextDuration: number;     // 下次状态持续时间
  playerMoveAccum: number;  // 危险期间玩家移动累计距离
  fillGraphics: Phaser.GameObjects.Graphics;  // 填充+边框
  label: Phaser.GameObjects.Text;              // 小道标识
}

// ── Constants ──────────────────────────────────────────────────────────────

const CAR_W = 520;            // 单节车厢宽
const CAR_H = 360;            // 车厢高
const CAR_GAP = 24;           // 车厢间门区宽度
const CAR_COUNT = 6;          // 6节车厢
const LOCO_W = 360;           // 车头宽

const LOCO_X = 40;
const FIRST_CAR_X = LOCO_X + LOCO_W + CAR_GAP;
const CAR_Y = 120;
const MAP_PAD = 40;

// 玩家
const PLAYER_SPEED = 175;
const PLAYER_CARRY_SPEED = 105;   // 携带残秽时减速
const PLAYER_CLEAN_SPEED = 55;    // 吸取残秽时几乎站定
const PLAYER_SIZE = 22;

// 怪物
const MONSTER_W = 64;             // 几乎占满过道
const MONSTER_H = 96;
const MONSTER_SPEED = PLAYER_SPEED * 1.08;  // 比玩家快一点点

// 残秽（红色涂抹）
const POLLUTION_MAX = 100;        // 每节车厢残秽浓度上限
const POLLUTION_SPREAD_RATE = 0.4;// 每秒向相邻车厢扩散
const POLLUTION_HIGH_THRESHOLD = 60;
const POLLUTION_NATURAL_RATE = 0.4;  // 自然生成基础速率（每秒每车厢）
const POLLUTION_SPAWN_THRESHOLD = 85; // 超过此阈值必定生成新怪物
const SEAL_AUTO_REMOVE_TIME = 10000;  // 封锁器10秒后自动解除（毫秒）
const POLLUTION_DEATH_TIME = 12000;  // 浓度爆表后宽限时间（毫秒）

// 概率刷怪：残秽浓度 ≥50% 开始有概率刷新怪物
const POLLUTION_SPAWN_MIN = 50;          // 开始概率刷怪的最低浓度
const POLLUTION_SPAWN_CHECK_INTERVAL = 5000; // 概率检定间隔（毫秒）
const POLLUTION_SPAWN_MAX_MONSTERS = 3;   // 场上最大怪物数

// 规则怪谈小道（一二三木头人）
const PATH_WIDTH = 40;               // 小道宽度（刚好容纳玩家22px）
const PATH_Y = 40;                  // 水平段的Y坐标（车厢上方）
const PATH_SAFE_MIN = 3000;         // 安全状态最短持续时间（ms）
const PATH_SAFE_MAX = 6000;         // 安全状态最长持续时间（ms）
const PATH_WARNING_TIME = 1000;    // 预警(黄光)持续时间（ms），此期间可自由移动
const PATH_DANGER_MIN = 1500;       // 危险(红光)状态最短持续时间（ms）
const PATH_DANGER_MAX = 2500;       // 危险(红光)状态最长持续时间（ms）
const PATH_MOVE_THRESHOLD = 0.5;     // 红光期间单帧移动超过此距离即死（px）——任何明显移动都触发

// 燃料 / 距离
const FUEL_MAX = 100;
const FUEL_PER_DEPOSIT = 10;      // 每次投喂转化（降低，让资源更紧张）
const DISTANCE_TOTAL = 1000;      // 总距离
const FUEL_DRAIN_RATE = 1.8;      // 每秒燃料消耗
const STALL_DEATH_TIME = 30000;   // 熄火30秒 → 失败

// 封锁器
const SEALER_TOTAL = 4;           // 全局只有4个
const SEALER_PICKUP_RANGE = 30;

// ── Scene ──────────────────────────────────────────────────────────────────

export class CleanupScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;  // E键交互

  // 地图
  private carriages: CarriageDef[] = [];
  private doors: DoorDef[] = [];
  private hideSpots: HideSpot[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // 残秽：每节车厢一个 Container，内含多个血迹贴图
  private pollutionGraphics: Phaser.GameObjects.Container[] = [];
  private pollutionLevels: number[] = [];   // 每节车厢浓度 0..100
  private pollutionHighTimer: number[] = []; // 浓度满持续计时
  private pollutionSpawnCooldown: number[] = []; // 新怪物生成冷却

  // 怪物
  private monsters: Monster[] = [];

  // 规则怪谈小道
  private sidePaths: SidePath[] = [];

  // 玩家状态
  private carrying = 0;          // 携带的残秽量
  private carryCapacity = 3;     // 一次可搬多份
  private isCleaning = false;    // 是否正在吸取
  private isHidden = false;      // 是否躲藏中
  private hiddenSpot: HideSpot | null = null;
  private hasSealer = false;     // 是否携带封锁器

  // 封锁器存放处（车头）
  private sealerPickup!: Phaser.GameObjects.Container;
  private sealersRemaining = SEALER_TOTAL;

  // 动能区（车头）
  private depositZone!: Phaser.GameObjects.Container;

  // 燃料 / 距离
  private fuel = FUEL_MAX;
  private distanceLeft = DISTANCE_TOTAL;
  private stallTimer = 0;        // 熄火累计时间

  // 状态
  private isDead = false;
  private isWon = false;

  // 音频
  private cryingSound!: Phaser.Sound.BaseSound;   // 怪物哭泣声（持续循环，根据距离调音量）
  private screamSound!: Phaser.Sound.BaseSound;   // 死亡跳脸尖叫
  private pathLaughSound!: Phaser.Sound.BaseSound; // 小道瞬杀鬼笑声

  // 视野遮蔽
  private visionOverlay!: Phaser.GameObjects.Image;

  // UI
  private fuelText!: Phaser.GameObjects.Text;
  private distText!: Phaser.GameObjects.Text;
  private carryText!: Phaser.GameObjects.Text;
  private sealerText!: Phaser.GameObjects.Text;
  private pollutionText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private messageTimer: number | null = null;

  constructor() {
    super({ key: 'CleanupScene' });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  create() {
    this.cameras.main.setBounds(0, 0, this.getTotalWidth(), CAR_H + CAR_Y + MAP_PAD);
    this.cameras.main.setBackgroundColor('#0a0a0f');
    // 扩大上边界以容纳小道
    this.cameras.main.setBounds(0, -20, this.getTotalWidth(), CAR_H + CAR_Y + MAP_PAD + 20);

    this.buildCarriages();
    this.drawMap();
    this.createDepositZone();
    this.createSealerPickup();
    this.createPlayer();
    this.createUI();
    this.setupInput();

    // 初始一只怪物在尾车
    this.spawnMonster(CAR_COUNT);

    // ── 音频初始化 ──
    this.cryingSound = this.sound.add('crying', { loop: true, volume: 0 });
    this.cryingSound.play();
    this.screamSound = this.sound.add('scream', { volume: 1 });
    this.pathLaughSound = this.sound.add('pathlaugh', { volume: 1 });

    // ── 视野遮蔽：模拟车厢内昏暗环境 ──
    this.createVisionOverlay();

    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
  }

  // ── Map Building ─────────────────────────────────────────────────────────

  private getTotalWidth(): number {
    return LOCO_X + LOCO_W + CAR_GAP + CAR_COUNT * CAR_W + (CAR_COUNT - 1) * CAR_GAP + MAP_PAD;
  }

  private carLeftX(index: number): number {
    return FIRST_CAR_X + (index - 1) * (CAR_W + CAR_GAP);
  }

  private carRightX(index: number): number {
    return this.carLeftX(index) + CAR_W;
  }

  private carCenterX(index: number): number {
    return this.carLeftX(index) + CAR_W / 2;
  }

  private buildCarriages() {
    this.carriages.push({ index: 0, x: LOCO_X, width: LOCO_W, isLocomotive: true });
    for (let i = 1; i <= CAR_COUNT; i++) {
      this.carriages.push({ index: i, x: this.carLeftX(i), width: CAR_W, isLocomotive: false });
    }

    // 车厢门：每节车厢前后各一扇
    for (let i = 1; i <= CAR_COUNT; i++) {
      const leftX = this.carLeftX(i);
      const rightX = this.carRightX(i);
      const doorY = CAR_Y + CAR_H / 2;
      this.doors.push({ x: rightX + CAR_GAP / 2, y: doorY, carriageIndex: i, side: 'back', sealed: false, sealTimer: 0 });
      this.doors.push({ x: leftX - CAR_GAP / 2, y: doorY, carriageIndex: i, side: 'front', sealed: false, sealTimer: 0 });
    }

    // 每节车厢：前后各一个厕所隔间，中间两个柜子
    for (let i = 1; i <= CAR_COUNT; i++) {
      const lx = this.carLeftX(i);
      this.hideSpots.push({ x: lx + 30, y: CAR_Y + 24, w: 70, h: 80, kind: 'toilet', occupied: false });
      this.hideSpots.push({ x: lx + CAR_W - 100, y: CAR_Y + 24, w: 70, h: 80, kind: 'toilet', occupied: false });
      this.hideSpots.push({ x: lx + 120, y: CAR_Y + CAR_H - 90, w: 60, h: 60, kind: 'locker', occupied: false });
      this.hideSpots.push({ x: lx + CAR_W - 180, y: CAR_Y + CAR_H - 90, w: 60, h: 60, kind: 'locker', occupied: false });
    }

    for (let i = 0; i <= CAR_COUNT; i++) {
      // 初始残秽：尾车略高往前递减，但都低于50%刷怪阈值给玩家喘息空间
      const initPollution = i === 0 ? 0 : Math.max(0, 30 - i * 4);
      this.pollutionLevels.push(initPollution);
      this.pollutionHighTimer.push(0);
      this.pollutionSpawnCooldown.push(0);
    }

    // 构建三条规则怪谈小道
    this.buildSidePaths();
  }

  /** 构建规则怪谈小道：车头→2号, 3号→5号, 6号→4号 */
  private buildSidePaths() {
    const defs: { id: string; fromCar: number; toCar: number }[] = [
      { id: 'A', fromCar: 0, toCar: 2 },   // 车头 → 2号
      { id: 'B', fromCar: 3, toCar: 5 },   // 3号 → 5号
      { id: 'C', fromCar: 6, toCar: 4 },   // 6号 → 4号
    ];

    for (const def of defs) {
      // 起点和终点的X中心
      const fromX = def.fromCar === 0
        ? LOCO_X + LOCO_W / 2
        : this.carCenterX(def.fromCar);
      const toX = def.toCar === 0
        ? LOCO_X + LOCO_W / 2
        : this.carCenterX(def.toCar);

      const leftX = Math.min(fromX, toX);
      const rightX = Math.max(fromX, toX);

      // 入口竖段：从车厢内部延伸到水平段（延伸到车厢内 PLAYER_SIZE 深度，确保玩家能进入）
      const entryRect = {
        x: fromX - PATH_WIDTH / 2,
        y: PATH_Y,
        w: PATH_WIDTH,
        h: CAR_Y + PLAYER_SIZE - PATH_Y,
      };
      // 水平段：覆盖入口和出口的宽度
      const horizRect = {
        x: leftX - PATH_WIDTH / 2,
        y: PATH_Y - PATH_WIDTH / 2,
        w: rightX - leftX + PATH_WIDTH,
        h: PATH_WIDTH,
      };
      // 出口竖段：同入口
      const exitRect = {
        x: toX - PATH_WIDTH / 2,
        y: PATH_Y,
        w: PATH_WIDTH,
        h: CAR_Y + PLAYER_SIZE - PATH_Y,
      };

      // 用单个 Graphics 绘制连续的小道形状（填充+轮廓）
      const fillGraphics = this.add.graphics();
      fillGraphics.setDepth(0.5);

      // 小道标识文字
      const midX = (leftX + rightX) / 2;
      const label = this.add.text(midX, PATH_Y - PATH_WIDTH / 2 - 12, `小道${def.id}`, {
        fontSize: '11px', color: '#6a6a3a',
      }).setOrigin(0.5).setDepth(1);

      const initialSafe = Phaser.Math.Between(PATH_SAFE_MIN, PATH_SAFE_MAX);
      const path: SidePath = {
        id: def.id,
        fromCar: def.fromCar,
        toCar: def.toCar,
        entryRect, horizRect, exitRect,
        state: 'safe',
        stateTimer: initialSafe,
        nextDuration: 0,
        playerMoveAccum: 0,
        fillGraphics,
        label,
      };
      this.drawSidePath(path);
      this.sidePaths.push(path);
    }
  }

  /** 绘制单条小道（填充+Π形轮廓+门口高亮，安全/预警/危险三套配色） */
  private drawSidePath(path: SidePath) {
    // 安全=暖棕色，预警=琥珀黄，危险=血红
    let fillColor: number, strokeColor: number, strokeWidth: number, strokeAlpha: number, doorColor: number, labelColor: string;
    if (path.state === 'danger') {
      fillColor = 0x660000; strokeColor = 0xff0000; strokeWidth = 3; strokeAlpha = 1; doorColor = 0xff4444; labelColor = '#ff0000';
    } else if (path.state === 'warning') {
      fillColor = 0x665500; strokeColor = 0xffaa00; strokeWidth = 3; strokeAlpha = 1; doorColor = 0xffcc44; labelColor = '#ffaa00';
    } else {
      fillColor = 0x382e1c; strokeColor = 0x8a7a3a; strokeWidth = 2; strokeAlpha = 0.9; doorColor = 0xaa9a5a; labelColor = '#8a7a3a';
    }

    const g = path.fillGraphics;
    const e = path.entryRect, h = path.horizRect, x = path.exitRect;

    g.clear();

    // 填充三个矩形（重叠部分自然融合）
    g.fillStyle(fillColor, 1);
    g.fillRect(e.x, e.y, e.w, e.h);
    g.fillRect(h.x, h.y, h.w, h.h);
    g.fillRect(x.x, x.y, x.w, x.h);

    // Π形轮廓：正确描绘外边界+内边界
    g.lineStyle(strokeWidth, strokeColor, strokeAlpha);
    const leftRect = e.x <= x.x ? e : x;       // 较左的竖段
    const rightRect = e.x <= x.x ? x : e;      // 较右的竖段
    const topY = h.y;
    const innerTopY = h.y + h.h;
    const bottomY = e.y + e.h;
    const leftOuter = leftRect.x;
    const leftInner = leftRect.x + leftRect.w;
    const rightInner = rightRect.x;
    const rightOuter = rightRect.x + rightRect.w;

    g.beginPath();
    // 外边界（顺时针）：左下→左上→右上→右下
    g.moveTo(leftOuter, bottomY);
    g.lineTo(leftOuter, topY);
    g.lineTo(rightOuter, topY);
    g.lineTo(rightOuter, bottomY);
    // 内边界（顺时针）：右下→右上→左上→左下
    g.moveTo(rightInner, bottomY);
    g.lineTo(rightInner, innerTopY);
    g.lineTo(leftInner, innerTopY);
    g.lineTo(leftInner, bottomY);
    g.strokePath();

    // 门口高亮：在车厢顶部(CAR_Y)处绘制亮色矩形，标示入口/出口
    g.fillStyle(doorColor, 0.35);
    g.fillRect(e.x, CAR_Y - 2, e.w, 4);
    g.fillRect(x.x, CAR_Y - 2, x.w, 4);

    // 方向箭头：在门口绘制小三角形↑↓
    g.fillStyle(strokeColor, strokeAlpha);
    for (const rect of [e, x]) {
      const cx = rect.x + rect.w / 2;
      const ay = CAR_Y + 8;
      // 向上箭头（指向小道）
      g.beginPath();
      g.moveTo(cx, ay - 5);
      g.lineTo(cx - 5, ay + 3);
      g.lineTo(cx + 5, ay + 3);
      g.closePath();
      g.fillPath();
    }

    path.label.setColor(labelColor);
  }

  /** 获取指定X范围内小道入口/出口造成的顶部间隙 */
  private getTopGapsForRange(x: number, w: number): { start: number; end: number }[] {
    const gaps: { start: number; end: number }[] = [];
    for (const path of this.sidePaths) {
      for (const rect of [path.entryRect, path.exitRect]) {
        if (rect.x < x + w && rect.x + rect.w > x) {
          gaps.push({ start: Math.max(x, rect.x), end: Math.min(x + w, rect.x + rect.w) });
        }
      }
    }
    return gaps;
  }

  /** 绘制带顶部间隙的矩形边框（左、底、右边框正常，顶边框在gap处断开） */
  private strokeRectWithTopGaps(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, gaps: { start: number; end: number }[]) {
    g.beginPath();
    // 左边框
    g.moveTo(x, y);
    g.lineTo(x, y + h);
    // 底边框
    g.lineTo(x + w, y + h);
    // 右边框
    g.lineTo(x + w, y);
    // 顶边框（带间隙）
    const sorted = [...gaps].sort((a, b) => a.start - b.start);
    let cur = x;
    for (const gap of sorted) {
      if (gap.start > cur) {
        g.moveTo(cur, y);
        g.lineTo(gap.start, y);
      }
      cur = Math.max(cur, gap.end);
    }
    if (cur < x + w) {
      g.moveTo(cur, y);
      g.lineTo(x + w, y);
    }
    g.strokePath();
  }

  private drawMap() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.setDepth(0);

    // 车头
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(LOCO_X, CAR_Y, LOCO_W, CAR_H);
    this.mapGraphics.lineStyle(3, 0x4a4a6a, 1);
    this.strokeRectWithTopGaps(this.mapGraphics, LOCO_X, CAR_Y, LOCO_W, CAR_H, this.getTopGapsForRange(LOCO_X, LOCO_W));

    // 6节车厢
    for (let i = 1; i <= CAR_COUNT; i++) {
      const lx = this.carLeftX(i);
      this.mapGraphics.fillStyle(0x1c1c22, 1);
      this.mapGraphics.fillRect(lx, CAR_Y, CAR_W, CAR_H);
      this.mapGraphics.lineStyle(3, 0x3a3a44, 1);
      this.strokeRectWithTopGaps(this.mapGraphics, lx, CAR_Y, CAR_W, CAR_H, this.getTopGapsForRange(lx, CAR_W));
      // 座椅区装饰
      this.mapGraphics.fillStyle(0x2a2a30, 1);
      this.mapGraphics.fillRect(lx + 10, CAR_Y + 110, CAR_W - 20, 30);
      this.mapGraphics.fillRect(lx + 10, CAR_Y + CAR_H - 80, CAR_W - 20, 30);
    }

    // 车厢编号：每节车厢地板中央写大号阿拉伯数字 1~6
    for (let i = 1; i <= CAR_COUNT; i++) {
      const cx = this.carCenterX(i);
      const cy = CAR_Y + CAR_H / 2;
      this.add.text(cx, cy, String(i), {
        fontSize: '72px',
        color: '#3a3a44',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(0);
    }

    // 躇所隔间 & 柜子
    for (const spot of this.hideSpots) {
      const color = spot.kind === 'toilet' ? 0x3a3a4a : 0x4a3a2a;
      this.mapGraphics.fillStyle(color, 1);
      this.mapGraphics.lineStyle(2, 0x6a6a7a, 1);
      this.mapGraphics.fillRect(spot.x, spot.y, spot.w, spot.h);
      this.mapGraphics.strokeRect(spot.x, spot.y, spot.w, spot.h);
      this.mapGraphics.fillStyle(0x1a1a1a, 1);
      this.mapGraphics.fillRect(spot.x + spot.w / 2 - 8, spot.y + spot.h - 6, 16, 6);
    }

    // 车厢门框
    for (const door of this.doors) {
      this.mapGraphics.fillStyle(0x111118, 1);
      this.mapGraphics.fillRect(door.x - CAR_GAP / 2 + 2, CAR_Y + 4, CAR_GAP - 4, CAR_H - 8);
      this.mapGraphics.lineStyle(2, 0x5a5a6a, 0.6);
      this.mapGraphics.strokeRect(door.x - CAR_GAP / 2 + 2, CAR_Y + 4, CAR_GAP - 4, CAR_H - 8);
    }

    // 每节车厢的残秽 Container（内含血迹贴图）
    for (let i = 1; i <= CAR_COUNT; i++) {
      const c = this.add.container(0, 0);
      c.setDepth(1);
      this.pollutionGraphics.push(c);
    }
  }

  // ── Deposit Zone (动能区) ────────────────────────────────────────────────

  private createDepositZone() {
    const cx = LOCO_X + LOCO_W / 2;
    const cy = CAR_Y + CAR_H / 2;
    const container = this.add.container(cx, cy);
    container.setDepth(3);

    const pad = this.add.rectangle(0, 0, 120, 120, 0x004422, 0.4);
    const ring = this.add.circle(0, 0, 55, 0x00ff66, 0.12);
    ring.setStrokeStyle(3, 0x00ff66, 0.8);
    const label = this.add.text(0, -10, '转化炉', { fontSize: '14px', color: '#00ff66' }).setOrigin(0.5);
    const sub = this.add.text(0, 12, '投喂残秽', { fontSize: '11px', color: '#00aa44' }).setOrigin(0.5);
    container.add([pad, ring, label, sub]);

    this.tweens.add({
      targets: ring, scale: { from: 0.85, to: 1.15 },
      duration: 800, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
    this.depositZone = container;
  }

  // ── Sealer Pickup (车头存放处) ───────────────────────────────────────────

  private createSealerPickup() {
    const cx = LOCO_X + 60;
    const cy = CAR_Y + CAR_H - 50;
    const container = this.add.container(cx, cy);
    container.setDepth(3);
    const box = this.add.rectangle(0, 0, 40, 40, 0x553300, 0.8);
    box.setStrokeStyle(2, 0xaa7733, 1);
    const label = this.add.text(0, 0, '🔒\n封锁器', { fontSize: '10px', color: '#ffcc66', align: 'center' }).setOrigin(0.5);
    container.add([box, label]);
    this.sealerPickup = container;
  }

  // ── Player ───────────────────────────────────────────────────────────────

  private createPlayer() {
    this.player = this.add.rectangle(
      LOCO_X + LOCO_W / 2, CAR_Y + CAR_H / 2,
      PLAYER_SIZE, PLAYER_SIZE, 0x44ddff
    );
    this.player.setDepth(5);
  }

  // ── Input ────────────────────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
  }

  // ── Monsters ─────────────────────────────────────────────────────────────

  private spawnMonster(carriageIndex: number) {
    const cx = this.carCenterX(carriageIndex);
    const cy = CAR_Y + CAR_H / 2;
    const container = this.add.container(cx, cy);
    container.setDepth(6);

    // 用鬼.png 贴图作为怪物主体，缩放到合适尺寸
    const body = this.add.image(0, 0, 'ghost');
    const scale = MONSTER_H / body.height;  // 按高度缩放
    body.setScale(scale);
    body.setAlpha(0.92);

    // 红色眼睛跟随移动方向
    const eye = this.add.circle(0, -8, 7, 0xff0000);
    // 雾气光晕
    const wisp = this.add.circle(0, 0, MONSTER_W * 0.8, 0x9933ff, 0.12);
    container.add([wisp, body, eye]);

    // 飘动呼吸动画
    this.tweens.add({
      targets: [body, eye],
      scaleX: { from: scale, to: scale * 1.06 }, scaleY: { from: scale, to: scale * 0.96 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
    container.setScale(0);
    this.tweens.add({ targets: container, scale: { from: 0, to: 1 }, duration: 400, ease: 'Back.easeOut' });

    this.monsters.push({
      container, body, eye,
      facing: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), 0).normalize(),
      speed: MONSTER_SPEED, wanderTimer: 0, alive: true,
      pollutionDropTimer: 0, carriageIndex,
      dying: false,
    });
  }

  private updateMonsters(delta: number) {
    const dt = delta / 1000;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      if (m.dying) continue;

      const target = this.isHidden ? null : this.player;
      if (target) {
        const toPlayer = new Phaser.Math.Vector2(target.x - m.container.x, target.y - m.container.y);
        const dist = toPlayer.length();
        if (dist > 1) { toPlayer.normalize(); m.facing.lerp(toPlayer, 0.08).normalize(); }
      } else {
        m.wanderTimer += delta;
        if (m.wanderTimer > 1200) {
          m.wanderTimer = 0;
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          m.facing.set(Math.cos(angle), Math.sin(angle));
        }
      }

      const newX = m.container.x + m.facing.x * m.speed * dt;
      const newY = m.container.y + m.facing.y * m.speed * dt;

      // 检查移动方向是否撞到封锁墙——撞到立刻消失
      const newCar = this.getCarriageAt(newX);
      if (newCar !== m.carriageIndex && this.isDoorSealedBetween(m.carriageIndex, newCar)) {
        // 撞到封锁墙，立刻消散
        this.killMonster(m);
        continue;
      }

      const moved = this.moveMonsterWithDoors(m, newX, newY);
      if (!moved.x) m.facing.x *= -1;
      if (!moved.y) m.facing.y *= -1;

      m.eye.x = m.facing.x * 10;
      m.eye.y = m.facing.y * 10 - 4;

      m.pollutionDropTimer += delta;
      if (m.pollutionDropTimer > 1200) {
        m.pollutionDropTimer = 0;
        this.addPollution(m.carriageIndex, 1.5);
      }

      if (!this.isHidden) {
        const killDist = Phaser.Math.Distance.Between(m.container.x, m.container.y, this.player.x, this.player.y);
        if (killDist < (MONSTER_W + PLAYER_SIZE) / 2) {
          this.die('被怪物触碰——瞬间死亡！');
          return;
        }
      }
    }
    this.monsters = this.monsters.filter(m => { if (!m.alive) { m.container.destroy(); return false; } return true; });
  }

  /** 怪物消散：留下残秽（不解封门，门由计时器自动解除） */
  private killMonster(m: Monster) {
    m.dying = true;
    // 留下残秽（封锁杀怪代价增加：15→25）
    this.addPollution(m.carriageIndex, 25);

    // 消散动画
    this.tweens.add({
      targets: m.container,
      alpha: 0, scale: 0.3,
      duration: 800,
      onComplete: () => { m.alive = false; },
    });
    this.showMessage(`${m.carriageIndex}号车厢的怪物撞上封锁墙消散了！`, 2000);
  }

  private moveMonsterWithDoors(m: Monster, newX: number, newY: number): { x: boolean; y: boolean } {
    const halfW = MONSTER_W / 2;
    const halfH = MONSTER_H / 2;
    let movedX = false, movedY = false;

    if (!this.isBlockedForMonster(newX, m.container.y, halfW, halfH, m.carriageIndex)) {
      m.container.x = newX; movedX = true;
      m.carriageIndex = this.getCarriageAt(m.container.x);
    }
    if (!this.isBlockedForMonster(m.container.x, newY, halfW, halfH, m.carriageIndex)) {
      m.container.y = newY; movedY = true;
    }
    const minY = CAR_Y + halfH + 4;
    const maxY = CAR_Y + CAR_H - halfH - 4;
    if (m.container.y < minY) { m.container.y = minY; movedY = false; }
    if (m.container.y > maxY) { m.container.y = maxY; movedY = false; }
    return { x: movedX, y: movedY };
  }

  private isBlockedForMonster(x: number, y: number, halfW: number, halfH: number, currentCar: number): boolean {
    if (y - halfH < CAR_Y + 4 || y + halfH > CAR_Y + CAR_H - 4) return true;
    // 怪物无法进入小道区域
    for (const path of this.sidePaths) {
      for (const rect of [path.entryRect, path.horizRect, path.exitRect]) {
        if (this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, rect.x, rect.y, rect.w, rect.h)) return true;
      }
    }
    for (const spot of this.hideSpots) {
      if (this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, spot.x, spot.y, spot.w, spot.h)) return true;
    }
    const carAtX = this.getCarriageAt(x);
    if (carAtX !== currentCar) {
      if (this.isDoorSealedBetween(currentCar, carAtX)) return true;
    }
    return false;
  }

  /** 检查两节相邻车厢之间的连接处是否有任一扇门被封锁 */
  private isDoorSealedBetween(carA: number, carB: number): boolean {
    const lo = Math.min(carA, carB);
    const hi = Math.max(carA, carB);
    if (hi - lo !== 1) return false;
    return this.doors.some(d =>
      (d.carriageIndex === lo && d.side === 'back' && d.sealed) ||
      (d.carriageIndex === hi && d.side === 'front' && d.sealed)
    );
  }

  private getCarriageAt(x: number): number {
    for (let i = 1; i <= CAR_COUNT; i++) {
      if (x >= this.carLeftX(i) && x <= this.carRightX(i)) return i;
    }
    // 在车厢间隙（门区）中：返回左侧车厢编号，避免 fallback 到 CAR_COUNT
    if (x < FIRST_CAR_X) return 0;
    for (let i = 1; i < CAR_COUNT; i++) {
      if (x > this.carRightX(i) && x < this.carLeftX(i + 1)) return i;
    }
    return CAR_COUNT;
  }

  // ── Pollution (红色涂抹) ─────────────────────────────────────────────────

  private addPollution(carriageIndex: number, amount: number) {
    if (carriageIndex < 1 || carriageIndex > CAR_COUNT) return;
    this.pollutionLevels[carriageIndex] = Math.min(POLLUTION_MAX, this.pollutionLevels[carriageIndex] + amount);
    this.redrawPollution(carriageIndex);
  }

  // 重绘某节车厢的血迹泼洒（用 blood.png 贴图随机分布）
  private redrawPollution(carriageIndex: number) {
    const c = this.pollutionGraphics[carriageIndex - 1];
    if (!c) return;
    // 清除旧的血迹
    c.removeAll(true);

    const level = this.pollutionLevels[carriageIndex];
    if (level <= 0) return;

    const lx = this.carLeftX(carriageIndex);
    const rng = this.makeRng(carriageIndex * 9173 + Math.floor(level));
    const blobCount = Math.floor(level / 8) + 2;

    for (let i = 0; i < blobCount; i++) {
      const bx = lx + rng() * CAR_W;
      const by = CAR_Y + rng() * CAR_H;
      const baseScale = (20 + rng() * 50 + level * 0.3) / 100;  // 血迹大小随浓度增长
      const alpha = Math.min(0.85, level / POLLUTION_MAX * 0.9);

      const splat = this.add.image(bx, by, 'blood');
      splat.setAlpha(alpha);
      splat.setRotation(rng() * Math.PI * 2);
      splat.setScale(baseScale * (0.6 + rng() * 0.8));
      splat.setTint(level > POLLUTION_HIGH_THRESHOLD ? 0x5a0a14 : 0x8c141e);
      c.add(splat);
    }
  }

  private makeRng(seed: number): () => number {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  }

  // 玩家吸取残秽：降低浓度后重绘（Graphics 不支持局部擦除，整体重绘即可）
  private cleanAtPlayer(delta: number) {
    if (this.carrying >= this.carryCapacity) return;
    const car = this.getCarriageAt(this.player.x);
    if (car < 1 || car > CAR_COUNT) return;
    if (this.pollutionLevels[car] <= 0) return;

    // 玩家附近范围内吸取，降低浓度
    const cleanRate = 0.12 * delta;
    this.pollutionLevels[car] = Math.max(0, this.pollutionLevels[car] - cleanRate);
    this.redrawPollution(car);
    this.carrying = Math.min(this.carryCapacity, this.carrying + 0.06 * delta);
  }

  // ── Player Movement ──────────────────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    if (this.isHidden) return;

    let speed = PLAYER_SPEED;
    if (this.carrying > 0) speed = PLAYER_CARRY_SPEED;
    if (this.isCleaning) speed = PLAYER_CLEAN_SPEED;

    const dt = delta / 1000;
    let vx = 0, vy = 0;
    if (this.cursors.left.isDown) vx -= 1;
    if (this.cursors.right.isDown) vx += 1;
    if (this.cursors.up.isDown) vy -= 1;
    if (this.cursors.down.isDown) vy += 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * speed; vy = (vy / len) * speed;
    }
    const half = PLAYER_SIZE / 2;

    // 记录移动前的位置（用于小道木头人判定）
    const prevX = this.player.x;
    const prevY = this.player.y;

    if (vx !== 0) {
      const newX = this.player.x + vx * dt;
      if (!this.isBlockedForPlayer(newX, this.player.y, half)) this.player.x = newX;
    }
    if (vy !== 0) {
      const newY = this.player.y + vy * dt;
      if (!this.isBlockedForPlayer(this.player.x, newY, half)) this.player.y = newY;
    }

    // 检查是否在小道中
    const inPath = this.getSidePathAt(this.player.x, this.player.y);
    if (inPath) {
      // 在小道中：不限制Y轴到车厢范围，而是限制到小道范围
      // Y轴不做Clamp，由isBlockedForPlayer的碰撞检测限制
      // 木头人判定：只有危险(红光)状态移动才触发秒杀，预警(黄光)可自由移动
      if (inPath.state === 'danger') {
        const moveDist = Math.sqrt(
          (this.player.x - prevX) * (this.player.x - prevX) +
          (this.player.y - prevY) * (this.player.y - prevY)
        );
        if (moveDist > PATH_MOVE_THRESHOLD) {
          this.dieFromPath('小道红光时违规移动，被规则吞噬！');
          return;
        }
      }
    } else {
      // 不在小道中：限制在车厢范围内
      // 但如果玩家X对齐某条小道入口/出口，允许向上穿过车厢顶板（不限制Y下限）
      const alignedWithPath = this.sidePaths.some(path =>
        [path.entryRect, path.exitRect].some(rect =>
          this.player.x >= rect.x - 2 && this.player.x <= rect.x + rect.w + 2
        )
      );
      if (alignedWithPath) {
        // 只限制Y上限（车厢底部），不限制Y下限（允许向上进入小道）
        this.player.y = Math.min(this.player.y, CAR_Y + CAR_H - half - 2);
      } else {
        this.player.y = Phaser.Math.Clamp(this.player.y, CAR_Y + half + 2, CAR_Y + CAR_H - half - 2);
      }
    }
  }

  private isBlockedForPlayer(x: number, y: number, half: number): boolean {
    // 检查新位置是否在小道中
    const inPath = this.getSidePathAt(x, y);
    if (inPath) {
      // 在小道中：允许通行（小道内部不阻挡）
      return false;
    }

    // 不在小道中：检查是否从车厢进入小道入口区域（车厢顶部开口）
    // 如果当前位置在小道内，新位置不在小道内但在车厢顶部边界附近，允许过渡
    const currentInPath = this.getSidePathAt(this.player.x, this.player.y);
    if (currentInPath) {
      // 从小道出来到车厢：检查新位置是否在车厢范围内
      if (y >= CAR_Y - half && y <= CAR_Y + CAR_H - half) {
        // 在车厢Y范围内，允许出来
        return false;
      }
      // 从小道出来到车厢外：阻挡
      return true;
    }

    // 检查是否在车厢顶部边界附近且X对齐某条小道入口/出口
    // 这种情况允许向上穿过车厢顶板进入小道
    if (y - half < CAR_Y + 2) {
      for (const path of this.sidePaths) {
        for (const rect of [path.entryRect, path.exitRect]) {
          if (x >= rect.x - 2 && x <= rect.x + rect.w + 2) {
            return false;  // X对齐小道入口/出口，允许穿过车厢顶板
          }
        }
      }
      return true;  // 顶部边界且不对齐任何小道，阻挡
    }

    if (y + half > CAR_Y + CAR_H - 2) return true;
    for (const spot of this.hideSpots) {
      if (this.rectOverlap(x - half, y - half, half * 2, half * 2, spot.x, spot.y, spot.w, spot.h)) return true;
    }
    const car = this.getCarriageAt(x);
    const currentCar = this.getCarriageAt(this.player.x);
    if (car !== currentCar) {
      if (this.isDoorSealedBetween(currentCar, car)) return true;
    }
    return false;
  }

  private rectOverlap(x1: number, y1: number, w1: number, h1: number, x2: number, y2: number, w2: number, h2: number): boolean {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  /** 检查坐标是否在任意小道区域内 */
  private getSidePathAt(x: number, y: number): SidePath | null {
    for (const path of this.sidePaths) {
      for (const rect of [path.entryRect, path.horizRect, path.exitRect]) {
        if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
          return path;
        }
      }
    }
    return null;
  }

  /** 更新小道状态：安全(棕) → 预警(黄光1秒) → 危险(红光) → 安全 */
  private updateSidePaths(delta: number) {
    for (const path of this.sidePaths) {
      path.stateTimer -= delta;
      if (path.stateTimer <= 0) {
        if (path.state === 'safe') {
          // 安全 → 预警（黄光1秒，可自由移动）
          path.state = 'warning';
          path.stateTimer = PATH_WARNING_TIME;
        } else if (path.state === 'warning') {
          // 预警 → 危险（红光，移动即死）
          path.state = 'danger';
          path.stateTimer = Phaser.Math.Between(PATH_DANGER_MIN, PATH_DANGER_MAX);
          path.playerMoveAccum = 0;
        } else {
          // 危险 → 安全
          path.state = 'safe';
          path.stateTimer = Phaser.Math.Between(PATH_SAFE_MIN, PATH_SAFE_MAX);
        }
        this.drawSidePath(path);
      }
    }
  }

  // ── Actions: Clean / Deposit / Seal / Hide ───────────────────────────────

  private handleActions(delta: number) {
    if (this.spaceKey.isDown && !this.isHidden) {
      this.isCleaning = true;
      this.cleanAtPlayer(delta);
    } else {
      this.isCleaning = false;
    }
    if (Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.tryInteract();
    }
  }

  private tryInteract() {
    // 1. 拾取封锁器
    if (!this.hasSealer && this.sealersRemaining > 0) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.sealerPickup.x, this.sealerPickup.y);
      if (d < SEALER_PICKUP_RANGE) {
        this.hasSealer = true;
        this.sealersRemaining--;
        this.showMessage('拾取了封锁器！走到门前按 E 封锁', 1500);
        return;
      }
    }
    // 2. 封锁门
    if (this.hasSealer) {
      const door = this.findNearestDoor(this.player.x, this.player.y, 40);
      if (door && !door.sealed) { this.sealDoor(door); return; }
    }
    // 3. 投喂残秽
    if (this.carrying > 0) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.depositZone.x, this.depositZone.y);
      if (d < 55) {
        this.fuel = Math.min(FUEL_MAX, this.fuel + FUEL_PER_DEPOSIT * this.carrying);
        this.carrying = 0;
        this.cameras.main.flash(200, 0, 255, 100);
        this.showMessage('残秽已转化为燃料！', 1000);
        return;
      }
    }
    // 4. 躲藏
    const spot = this.findNearestHideSpot(this.player.x, this.player.y, 35);
    if (spot) {
      if (!this.isHidden) this.enterHide(spot);
      else this.exitHide();
      return;
    }
  }

  private findNearestDoor(x: number, y: number, range: number): DoorDef | null {
    let nearest: DoorDef | null = null; let minD = range;
    for (const door of this.doors) {
      const d = Phaser.Math.Distance.Between(x, y, door.x, door.y);
      if (d < minD) { minD = d; nearest = door; }
    }
    return nearest;
  }

  private findNearestHideSpot(x: number, y: number, range: number): HideSpot | null {
    let nearest: HideSpot | null = null; let minD = range;
    for (const spot of this.hideSpots) {
      const cx = spot.x + spot.w / 2; const cy = spot.y + spot.h / 2;
      const d = Phaser.Math.Distance.Between(x, y, cx, cy);
      if (d < minD) { minD = d; nearest = spot; }
    }
    return nearest;
  }

  // 封锁一扇门，连带封锁同一连接处的对侧门
  private sealDoor(door: DoorDef) {
    door.sealed = true;
    door.sealTimer = 0;
    this.hasSealer = false;
    const seal = this.add.rectangle(door.x, door.y, CAR_GAP - 6, CAR_H - 12, 0xff6644, 0.7);
    seal.setStrokeStyle(2, 0xffaa66, 1); seal.setDepth(4);
    door.sealGraphic = seal;

    // 找同一连接处的对侧门
    let other: DoorDef | undefined;
    if (door.side === 'front' && door.carriageIndex > 1) {
      other = this.doors.find(d => d.carriageIndex === door.carriageIndex - 1 && d.side === 'back');
    } else if (door.side === 'back' && door.carriageIndex < CAR_COUNT) {
      other = this.doors.find(d => d.carriageIndex === door.carriageIndex + 1 && d.side === 'front');
    }
    if (other && !other.sealed) {
      other.sealed = true;
      other.sealTimer = 0;
      const seal2 = this.add.rectangle(other.x, other.y, CAR_GAP - 6, CAR_H - 12, 0xff6644, 0.7);
      seal2.setStrokeStyle(2, 0xffaa66, 1); seal2.setDepth(4);
      other.sealGraphic = seal2;
      this.showMessage(`封锁了 ${door.carriageIndex} 号门，连带封锁对侧！10秒后自动解除`, 2000);
    } else {
      this.showMessage(`封锁了 ${door.carriageIndex} 号门！10秒后自动解除`, 1800);
    }
  }

  private enterHide(spot: HideSpot) {
    this.isHidden = true; this.hiddenSpot = spot; spot.occupied = true;
    this.player.x = spot.x + spot.w / 2; this.player.y = spot.y + spot.h / 2;
    this.player.setFillStyle(0x226688);
    this.showMessage('躲藏中！怪物无法发现你。再按 E 离开', 2000);
  }

  private exitHide() {
    this.isHidden = false;
    if (this.hiddenSpot) {
      this.player.x = this.hiddenSpot.x + this.hiddenSpot.w / 2;
      this.player.y = this.hiddenSpot.y + this.hiddenSpot.h + 15;
      this.hiddenSpot.occupied = false; this.hiddenSpot = null;
    }
    this.player.setFillStyle(0x44ddff);
  }

  // ── Pollution Spread & Natural Generation ───────────────────────────────

  private updatePollutionSpread(delta: number) {
    const dt = delta / 1000;
    // 燃料越低，残秽自然生成越快
    const speedFactor = this.fuel <= 0 ? 2.5 : (this.fuel < 25 ? 1.6 : (this.fuel < 50 ? 1.2 : 1.0));

    // 1. 自然生成：每节车厢按速率增长
    for (let i = 1; i <= CAR_COUNT; i++) {
      this.pollutionLevels[i] = Math.min(POLLUTION_MAX, this.pollutionLevels[i] + POLLUTION_NATURAL_RATE * dt * speedFactor);
    }

    // 2. 高浓度扩散到相邻车厢
    for (let i = 1; i <= CAR_COUNT; i++) {
      if (this.pollutionLevels[i] > POLLUTION_HIGH_THRESHOLD) {
        if (i > 1) {
          this.pollutionLevels[i - 1] = Math.min(POLLUTION_MAX, this.pollutionLevels[i - 1] + POLLUTION_SPREAD_RATE * dt * speedFactor);
        }
        if (i < CAR_COUNT) {
          this.pollutionLevels[i + 1] = Math.min(POLLUTION_MAX, this.pollutionLevels[i + 1] + POLLUTION_SPREAD_RATE * dt * speedFactor);
        }
      }
    }

    // 3. 重绘所有有残秽的车厢
    for (let i = 1; i <= CAR_COUNT; i++) {
      this.redrawPollution(i);
    }

    // 4. 浓度爆表判定
    for (let i = 1; i <= CAR_COUNT; i++) {
      if (this.pollutionLevels[i] >= POLLUTION_MAX) {
        this.pollutionHighTimer[i] += delta;
        if (this.pollutionHighTimer[i] > POLLUTION_DEATH_TIME) { this.die(`${i}号车厢残秽浓度爆表，列车被吞没！`); return; }
      } else { this.pollutionHighTimer[i] = 0; }
    }

    // 5. 概率刷怪：残秽浓度 ≥50% 开始有概率刷新，浓度越高概率越大
    for (let i = 1; i <= CAR_COUNT; i++) {
      const level = this.pollutionLevels[i];
      if (level < POLLUTION_SPAWN_MIN) {
        this.pollutionSpawnCooldown[i] = 0;
        continue;
      }

      this.pollutionSpawnCooldown[i] -= delta;
      if (this.pollutionSpawnCooldown[i] > 0) continue;

      // 计算刷怪概率：50%→5%, 65%→20%, 75%→50%, 85%+→100%
      let spawnChance: number;
      if (level >= POLLUTION_SPAWN_THRESHOLD) {
        spawnChance = 1.0;  // 85%+ 必定刷
      } else {
        // 线性插值：50%→0.05, 85%→1.0
        const t = (level - POLLUTION_SPAWN_MIN) / (POLLUTION_SPAWN_THRESHOLD - POLLUTION_SPAWN_MIN);
        spawnChance = 0.05 + t * 0.95;
      }

      if (Math.random() < spawnChance) {
        const hasMonster = this.monsters.some(m => m.alive && !m.dying && m.carriageIndex === i);
        const aliveCount = this.monsters.filter(m => m.alive && !m.dying).length;
        if (!hasMonster && aliveCount < POLLUTION_SPAWN_MAX_MONSTERS) {
          this.spawnMonster(i);
          this.pollutionSpawnCooldown[i] = POLLUTION_SPAWN_CHECK_INTERVAL;
          this.showMessage(`${i}号车厢残秽滋生了新的怪物！`, 2000);
        } else {
          this.pollutionSpawnCooldown[i] = POLLUTION_SPAWN_CHECK_INTERVAL;
        }
      } else {
        // 未触发，等待下次检定
        this.pollutionSpawnCooldown[i] = POLLUTION_SPAWN_CHECK_INTERVAL;
      }
    }
  }
  // ── Seal Timer (封锁器自动解除) ─────────────────────────────────────────

  private updateSealTimers(delta: number) {
    for (const door of this.doors) {
      if (door.sealed) {
        door.sealTimer += delta;
        if (door.sealTimer >= SEAL_AUTO_REMOVE_TIME) {
          door.sealed = false;
          door.sealTimer = 0;
          if (door.sealGraphic) { door.sealGraphic.destroy(); door.sealGraphic = undefined; }
        }
      }
    }
  }
  // ── Fuel / Distance ──────────────────────────────────────────────────────

  private updateFuelDistance(delta: number) {
    const dt = delta / 1000;
    this.fuel -= FUEL_DRAIN_RATE * dt;
    if (this.fuel < 0) this.fuel = 0;

    if (this.fuel > 0) {
      const speedRatio = this.fuel > 70 ? 1.0 : (this.fuel > 25 ? 0.6 : 0.3);
      this.distanceLeft -= 8 * speedRatio * dt;
      this.stallTimer = 0;
      if (this.distanceLeft <= 0) { this.distanceLeft = 0; this.win(); return; }
    } else {
      this.stallTimer += delta;
      if (this.stallTimer >= STALL_DEATH_TIME) { this.die('列车熄火过久，残秽吞没全车！'); return; }
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  private createUI() {
    this.fuelText = this.add.text(16, 16, '燃料: 100%', { fontSize: '18px', color: '#ffaa44' }).setScrollFactor(0).setDepth(20);
    this.distText = this.add.text(16, 40, '距下一站: 1000m', { fontSize: '18px', color: '#44ddff' }).setScrollFactor(0).setDepth(20);
    this.carryText = this.add.text(16, 64, '携带残秽: 0/3', { fontSize: '18px', color: '#ff6666' }).setScrollFactor(0).setDepth(20);
    this.sealerText = this.add.text(16, 88, '封锁器: 未携带 (库存4)', { fontSize: '16px', color: '#ffcc66' }).setScrollFactor(0).setDepth(20);
    this.pollutionText = this.add.text(16, 110, '残秽: ', { fontSize: '14px', color: '#ff4444' }).setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 540, '', {
      fontSize: '20px', color: '#ffffff', align: 'center',
      backgroundColor: '#000000', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);

    const backBtn = this.add.text(680, 16, '← 菜单', {
      fontSize: '18px', color: '#ffffff', backgroundColor: '#333333', padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);
    backBtn.on('pointerdown', () => this.scene.start('MenuScene'));

    this.add.text(400, 575, '方向键移动 • 空格吸取残秽 • E交互(拾取/封锁/投喂/躲藏) • 被怪物碰到即死 • 小道黄光时停下！', {
      fontSize: '12px', color: '#666666',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
  }

  private updateUI() {
    this.fuelText.setText(`燃料: ${Math.ceil(this.fuel)}%`);
    this.fuelText.setColor(this.fuel < 25 ? '#ff4444' : (this.fuel < 50 ? '#ffaa44' : '#44ff44'));
    this.distText.setText(`距下一站: ${Math.ceil(this.distanceLeft)}m`);
    this.carryText.setText(`携带残秽: ${this.carrying.toFixed(1)}/${this.carryCapacity}`);
    this.sealerText.setText(this.hasSealer ? '封锁器: 携带中' : `封锁器: 未携带 (库存${this.sealersRemaining})`);

    let pStr = '残秽: ';
    for (let i = 1; i <= CAR_COUNT; i++) { pStr += `${i}号:${Math.ceil(this.pollutionLevels[i])}% `; }
    this.pollutionText.setText(pStr);
  }

  // ── Update Loop ──────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.isDead || this.isWon) return;
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      if (this.cryingSound) this.cryingSound.stop();
      this.scene.start('MenuScene'); return;
    }
    this.handlePlayerMovement(delta);
    this.handleActions(delta);
    this.updateMonsters(delta);
    this.updatePollutionSpread(delta);
    this.updateSealTimers(delta);
    this.updateFuelDistance(delta);
    this.updateUI();
    this.updateCryingVolume();
    this.updateVisionOverlay();
    this.updateSidePaths(delta);
  }

  /** 根据最近怪物距离调整哭泣声音量 */
  private updateCryingVolume() {
    if (!this.cryingSound || !this.cryingSound.isPlaying) return;
    let minDist = Infinity;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, this.player.x, this.player.y);
      if (d < minDist) minDist = d;
    }
    // 距离 0 → 音量 0.8（最大）；距离 800+ → 音量 0（静音）
    const maxRange = 800;
    const vol = minDist < maxRange ? (1 - minDist / maxRange) * 0.8 : 0;
    (this.cryingSound as any).setVolume(vol);
  }

  /** 创建视野遮蔽（径向渐变：中心透明，边缘暗化） */
  private createVisionOverlay() {
    const overlaySize = 1000;
    // 仅创建一次（场景重启时纹理缓存中可能已存在）
    if (!this.textures.exists('visionOverlay')) {
      const vc = this.textures.createCanvas('visionOverlay', overlaySize, overlaySize);
      if (vc) {
        const ctx = vc.getContext();
        const c = overlaySize / 2;
        // 填充暗色
        ctx.fillStyle = 'rgba(0, 0, 0, 0.90)';
        ctx.fillRect(0, 0, overlaySize, overlaySize);
        // 用径向渐变挖出中心透明区域（destination-out = 擦除）
        ctx.globalCompositeOperation = 'destination-out';
        const grad = ctx.createRadialGradient(c, c, 0, c, c, 380);
        grad.addColorStop(0, 'rgba(0,0,0,1)');       // 中心：完全擦除（清晰）
        grad.addColorStop(0.42, 'rgba(0,0,0,1)');    // 0-160px：完全清晰
        grad.addColorStop(0.74, 'rgba(0,0,0,0.5)');  // 160-281px：渐暗
        grad.addColorStop(1, 'rgba(0,0,0,0)');        // 380px+：不擦除（保持暗）
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, overlaySize, overlaySize);
        ctx.globalCompositeOperation = 'source-over';
        vc.refresh();

        // WebGL 手动上传纹理（Phaser canvas texture 在 WebGL 下需手动上传）
        const renderer = this.sys.game.renderer as any;
        if (renderer && renderer.gl) {
          const src = vc.source[0] as any;
          if (src && src.glTexture && src.canvas) {
            const gl = renderer.gl;
            gl.bindTexture(gl.TEXTURE_2D, src.glTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.canvas);
          }
        }
      }
    }

    this.visionOverlay = this.add.image(400, 300, 'visionOverlay');
    this.visionOverlay.setScrollFactor(0);
    this.visionOverlay.setDepth(15);  // 在游戏对象(0-6)之上，UI(20)之下
  }

  /** 更新视野遮蔽位置（跟随玩家屏幕坐标） */
  private updateVisionOverlay() {
    if (!this.visionOverlay) return;
    const cam = this.cameras.main;
    this.visionOverlay.x = this.player.x - cam.scrollX;
    this.visionOverlay.y = this.player.y - cam.scrollY;
  }

  // ── Win / Lose ───────────────────────────────────────────────────────────

  private win() {
    this.isWon = true;
    if (this.cryingSound) this.cryingSound.stop();
    this.showMessage('🎉 到站！列车安全抵达下一站！\n\n按ESC返回菜单', 999999);
  }

  private die(cause: string) {
    if (this.isDead) return;
    this.isDead = true;
    this.player.setFillStyle(0x666666);

    // ── 音频：停止哭泣，播放尖叫 ──
    if (this.cryingSound) this.cryingSound.stop();
    if (this.screamSound) this.screamSound.play();

    // ── 跳脸：鬼.png 瞬间占据整个画面 ──
    const cam = this.cameras.main;
    const jumpscare = this.add.image(cam.centerX, cam.centerY, 'ghost');
    jumpscare.setScrollFactor(0);          // 固定在屏幕中央，不随相机移动
    jumpscare.setDepth(9999);              // 最顶层
    // 缩放到刚好覆盖整个画面（按宽高取较大比例）
    const scaleX = cam.width / jumpscare.width;
    const scaleY = cam.height / jumpscare.height;
    const coverScale = Math.max(scaleX, scaleY) * 1.1;  // 略大确保铺满
    jumpscare.setScale(0);                 // 从0开始
    jumpscare.setAlpha(1);

    // 瞬间放大（120ms 极快 Back.easeOut 制造冲击感）
    this.tweens.add({
      targets: jumpscare,
      scale: coverScale,
      duration: 120,
      ease: 'Back.easeOut',
    });
    // 同时屏幕剧烈震动 + 闪红
    cam.shake(500, 0.04);
    cam.flash(150, 255, 0, 0, true);

    // 1.2秒后显示死亡文字（让跳脸画面停留一会儿）
    this.time.delayedCall(1200, () => {
      this.showMessage(`💀 ${cause}\n\n按ESC返回菜单`, 999999);
    });
  }

  /** 小道瞬杀专用死亡：使用小道鬼.png + 小道鬼笑.mp3 */
  private dieFromPath(cause: string) {
    if (this.isDead) return;
    this.isDead = true;
    this.player.setFillStyle(0x666666);

    // ── 音频：停止哭泣，播放小道鬼笑 ──
    if (this.cryingSound) this.cryingSound.stop();
    if (this.pathLaughSound) this.pathLaughSound.play();

    // ── 跳脸：小道鬼.png 瞬间占据整个画面 ──
    const cam = this.cameras.main;
    const jumpscare = this.add.image(cam.centerX, cam.centerY, 'pathghost');
    jumpscare.setScrollFactor(0);          // 固定在屏幕中央，不随相机移动
    jumpscare.setDepth(9999);              // 最顶层
    // 缩放到刚好覆盖整个画面（按宽高取较大比例）
    const scaleX = cam.width / jumpscare.width;
    const scaleY = cam.height / jumpscare.height;
    const coverScale = Math.max(scaleX, scaleY) * 1.1;  // 略大确保铺满
    jumpscare.setScale(0);                 // 从0开始
    jumpscare.setAlpha(1);

    // 瞬间放大（100ms 极快 Back.easeOut 制造冲击感）
    this.tweens.add({
      targets: jumpscare,
      scale: coverScale,
      duration: 100,
      ease: 'Back.easeOut',
    });
    // 同时屏幕剧烈震动 + 闪黄
    cam.shake(600, 0.05);
    cam.flash(200, 255, 200, 0, true);

    // 1.5秒后显示死亡文字（让跳脸画面+笑声停留更久）
    this.time.delayedCall(1500, () => {
      this.showMessage(`💀 ${cause}\n\n按ESC返回菜单`, 999999);
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private showMessage(text: string, duration: number = 2000) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
    if (this.messageTimer) clearTimeout(this.messageTimer);
    if (duration < 999999) {
      this.messageTimer = window.setTimeout(() => { this.messageText.setVisible(false); }, duration);
    }
  }
}
