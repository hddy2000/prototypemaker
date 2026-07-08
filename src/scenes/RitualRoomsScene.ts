import Phaser from 'phaser';

// ── 仪式房间 (Ritual Rooms) ──────────────────────────────────────────────
// 核心机制（复用末班地铁）：
//   - 怪物在房间中穿行留下残秽，玩家吸取残秽搬回中央祭坛投喂
//   - 被怪物碰到即死
//   - 残秽浓度过高会滋生新怪物
// 地形：中央祭坛房间 + 周围6个房间，通过走廊连接
// 每个房间有躲藏点（柜子/桌子）

// ── Types ──────────────────────────────────────────────────────────────────

interface RoomDef {
  id: number;           // 0 = 中央祭坛, 1..6 = 周围房间
  x: number;            // 左上角 x
  y: number;            // 左上角 y
  w: number;
  h: number;
  name: string;
  isHub: boolean;
}

interface CorridorDef {
  x: number; y: number; w: number; h: number;
  fromRoom: number;
  toRoom: number;
}

interface HideSpot {
  x: number; y: number; w: number; h: number;
  kind: 'locker' | 'table';
  roomId: number;
  occupied: boolean;
}

interface Monster {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  eye: Phaser.GameObjects.Arc;
  wisp: Phaser.GameObjects.Arc;
  facing: Phaser.Math.Vector2;
  speed: number;
  wanderTimer: number;
  alive: boolean;
  pollutionDropTimer: number;
  roomId: number;
  homeRoom: number;
  dying: boolean;
  aggro: boolean;          // 是否处于仇恨状态
  aggroTimer: number;      // 仇恨持续时间（脱战后倒计时）
  returnTarget: number;    // 返回目标房间ID（-1=未设定）
  returnTimer: number;     // 返回目标刷新计时
}

interface Mine {
  x: number;
  y: number;
  armed: boolean;          // 是否已武装（放置后延迟武装）
  armTimer: number;        // 武装倒计时
  sprite: Phaser.GameObjects.Container;
  exploded: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

// 房间尺寸（缩小后）
const HUB_W = 280;
const HUB_H = 240;
const ROOM_W = 220;
const ROOM_H = 180;
const CORR_W = 40;       // 走廊宽度
// const CORR_LEN = 80;     // 走廊长度

// 地图中心
const MAP_CX = 750;
const MAP_CY = 560;

// 玩家
const PLAYER_SPEED = 210;
const PLAYER_CARRY_SPEED = 168;
const PLAYER_CLEAN_SPEED = 55;
const PLAYER_SIZE = 22;

// 怪物
const MONSTER_W = 56;
const MONSTER_H = 80;
const MONSTER_SPEED = PLAYER_SPEED * 1.05;   // 仇恨时追击速度
const MONSTER_WANDER_SPEED = PLAYER_SPEED * 0.35; // 无仇恨时游荡速度
const MONSTER_AGGRO_RANGE = 420;              // 仇恨触发距离

// 残秽
const POLLUTION_MAX = 100;
const POLLUTION_NATURAL_RATE = 0.35;
const POLLUTION_SPREAD_RATE = 0.3;
const POLLUTION_HIGH_THRESHOLD = 60;
const POLLUTION_FULL_SPILL_RATE = 2.5;
const POLLUTION_DEATH_ROOMS = 4;       // 4个房间满浓度 = 死亡
const POLLUTION_SPAWN_MIN = 50;
const POLLUTION_SPAWN_THRESHOLD = 85;
const POLLUTION_SPAWN_CHECK_INTERVAL = 5000;
const POLLUTION_SPAWN_MAX_MONSTERS = 3;
const GUARANTEE_SPAWN_INTERVAL = 15000; // 场上无怪时，15秒后保底刷2只
const GUARANTEE_SPAWN_COUNT = 2;        // 保底刷怪数量

// 燃料 / 仪式进度
const FUEL_MAX = 100;
const FUEL_PER_DEPOSIT = 12;
const AUTO_CLEAN_DEPOSITS = 4;
const AUTO_CLEAN_AMOUNT = 10;
const RITUAL_TOTAL = 1000;             // 仪式总进度
const FUEL_DRAIN_RATE = 1.5;
const STALL_DEATH_TIME = 35000;

// 地雷
// const MINE_TOTAL = 5;                  // 祭坛旁库存地雷数
const MINE_PICKUP_RANGE = 35;
const MINE_RADIUS = 120;               // 爆炸半径
const MINE_ARM_TIME = 800;             // 放置后武装时间(ms)，期间不触发
const MINE_TRIGGER_DIST = 40;          // 怪物进入此距离触发

// ── Scene ──────────────────────────────────────────────────────────────────

export class RitualRoomsScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;  // E键交互
  private mineKey!: Phaser.Input.Keyboard.Key;       // Q键放置地雷

  // 地图
  private rooms: RoomDef[] = [];
  private corridors: CorridorDef[] = [];
  private hideSpots: HideSpot[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // 残秽
  private pollutionGraphics: Phaser.GameObjects.Container[] = [];
  private pollutionLevels: number[] = [];
  private pollutionSpawnCooldown: number[] = [];
  private guaranteeSpawnTimer = 0;     // 保底刷怪计时器

  // 怪物
  private monsters: Monster[] = [];

  // 玩家状态
  private carrying = 0;
  private carryCapacity = 3;
  private depositCount = 0;
  private isCleaning = false;
  private isHidden = false;
  private hiddenSpot: HideSpot | null = null;

  // 地雷
  private mines: Mine[] = [];
  private hasMine = false;
  private minePickup!: Phaser.GameObjects.Container;

  // 祭坛（中央）
  private depositZone!: Phaser.GameObjects.Container;

  // 仪式进度 / 燃料
  private fuel = FUEL_MAX;
  private ritualProgress = 0;
  private stallTimer = 0;

  // 状态
  private isDead = false;
  private isWon = false;

  // 音频
  private cryingSound!: Phaser.Sound.BaseSound;
  private screamSound!: Phaser.Sound.BaseSound;

  // 视野遮蔽
  private visionOverlay!: Phaser.GameObjects.Image;

  // UI
  private fuelText!: Phaser.GameObjects.Text;
  private ritualText!: Phaser.GameObjects.Text;
  private carryText!: Phaser.GameObjects.Text;
  private mineText!: Phaser.GameObjects.Text;
  private pollutionText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private messageTimer: number | null = null;

  constructor() {
    super({ key: 'RitualRoomsScene' });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  create() {
    // Reset all state (scene restart reuses same object)
    this.rooms = [];
    this.corridors = [];
    this.hideSpots = [];
    this.monsters = [];
    this.pollutionGraphics = [];
    this.pollutionLevels = [];
    this.pollutionSpawnCooldown = [];
    this.guaranteeSpawnTimer = 0;
    this.carrying = 0;
    this.depositCount = 0;
    this.isCleaning = false;
    this.isHidden = false;
    this.hiddenSpot = null;
    this.mines = [];
    this.hasMine = false;
    this.fuel = FUEL_MAX;
    this.ritualProgress = 0;
    this.stallTimer = 0;
    this.isDead = false;
    this.isWon = false;

    this.buildRooms();
    this.drawMap();
    this.createDepositZone();
    this.createMinePickup();
    this.createPlayer();
    this.createUI();
    this.setupInput();

    // 初始两只怪物在不同房间
    this.spawnMonster(2);
    this.spawnMonster(5);

    // 音频
    this.cryingSound = this.sound.add('crying', { loop: true, volume: 0 });
    this.cryingSound.play();
    this.screamSound = this.sound.add('scream', { volume: 1 });

    // 视野遮蔽
    this.createVisionOverlay();

    // 相机
    const totalW = this.getMapWidth();
    const totalH = this.getMapHeight();
    this.cameras.main.setBounds(0, 0, totalW, totalH);
    this.cameras.main.setBackgroundColor('#08080e');
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
  }

  // ── Map Building ─────────────────────────────────────────────────────────

  private getMapWidth(): number { return 2400; }
  private getMapHeight(): number { return 1800; }

  private buildRooms() {
    // 中央祭坛房间
    const hubX = MAP_CX - HUB_W / 2;
    const hubY = MAP_CY - HUB_H / 2;
    this.rooms.push({ id: 0, x: hubX, y: hubY, w: HUB_W, h: HUB_H, name: '祭坛', isHub: true });

    // 6个周围房间，围绕中央分布
    // 布局：上左、上右、右、下右、下左、左
    const outerRooms: { name: string; angle: number }[] = [
      { name: '图书室', angle: -90 },    // 上
      { name: '实验室', angle: -30 },    // 右上
      { name: '储藏间', angle: 30 },     // 右下
      { name: '祈祷室', angle: 90 },     // 下
      { name: '卧室', angle: 150 },      // 左下
      { name: '厨房', angle: 210 },      // 左上
    ];

    const orbitRadius = 500; // 房间中心到地图中心的距离（增大避免重叠）

    for (let i = 0; i < outerRooms.length; i++) {
      const angle = Phaser.Math.DegToRad(outerRooms[i].angle);
      const cx = MAP_CX + Math.cos(angle) * orbitRadius;
      const cy = MAP_CY + Math.sin(angle) * orbitRadius;
      const rx = cx - ROOM_W / 2;
      const ry = cy - ROOM_H / 2;
      this.rooms.push({ id: i + 1, x: rx, y: ry, w: ROOM_W, h: ROOM_H, name: outerRooms[i].name, isHub: false });
    }

    // 走廊：每个外围房间到中央祭坛（L形：先水平后垂直）
    for (let i = 1; i <= 6; i++) {
      const room = this.rooms[i];
      const hub = this.rooms[0];
      const roomCX = room.x + room.w / 2;
      const roomCY = room.y + room.h / 2;
      const hubCX = hub.x + hub.w / 2;
      const hubCY = hub.y + hub.h / 2;

      // 走廊起点：房间朝向祭坛的边缘中点
      const dx = hubCX - roomCX;
      const dy = hubCY - roomCY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / dist;
      const ny = dy / dist;
      const startX = roomCX + nx * (room.w / 2);
      const startY = roomCY + ny * (room.h / 2);
      // 走廊终点：祭坛房间朝向房间的边缘中点
      const endX = hubCX - nx * (hub.w / 2);
      const endY = hubCY - ny * (hub.h / 2);

      // L形走廊：水平段（从起点X到终点X，Y=起点Y）+ 垂直段（X=终点X，从起点Y到终点Y）
      // 水平段
      const hMinX = Math.min(startX, endX) - CORR_W / 2;
      const hMaxX = Math.max(startX, endX) + CORR_W / 2;
      this.corridors.push({
        x: hMinX, y: startY - CORR_W / 2,
        w: hMaxX - hMinX, h: CORR_W,
        fromRoom: i, toRoom: 0,
      });
      // 垂直段
      const vMinY = Math.min(startY, endY) - CORR_W / 2;
      const vMaxY = Math.max(startY, endY) + CORR_W / 2;
      this.corridors.push({
        x: endX - CORR_W / 2, y: vMinY,
        w: CORR_W, h: vMaxY - vMinY,
        fromRoom: i, toRoom: 0,
      });
    }

    // 躲藏点：每个外围房间4个（2个柜子 + 2个桌子）
    for (let i = 1; i <= 6; i++) {
      const room = this.rooms[i];
      const rx = room.x;
      const ry = room.y;
      // 左上柜子
      this.hideSpots.push({ x: rx + 20, y: ry + 20, w: 60, h: 60, kind: 'locker', roomId: i, occupied: false });
      // 右上柜子
      this.hideSpots.push({ x: rx + room.w - 80, y: ry + 20, w: 60, h: 60, kind: 'locker', roomId: i, occupied: false });
      // 左下桌子
      this.hideSpots.push({ x: rx + 20, y: ry + room.h - 80, w: 70, h: 50, kind: 'table', roomId: i, occupied: false });
      // 右下桌子
      this.hideSpots.push({ x: rx + room.w - 90, y: ry + room.h - 80, w: 70, h: 50, kind: 'table', roomId: i, occupied: false });
    }

    // 残秽初始化
    for (let i = 0; i <= 6; i++) {
      const initPollution = i === 0 ? 0 : Math.max(0, 25 - i * 3);
      this.pollutionLevels.push(initPollution);
      this.pollutionSpawnCooldown.push(0);
    }
  }

  private drawMap() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.setDepth(0);

    // 绘制走廊
    for (const corr of this.corridors) {
      this.mapGraphics.fillStyle(0x14141c, 1);
      this.mapGraphics.fillRect(corr.x, corr.y, corr.w, corr.h);
      this.mapGraphics.lineStyle(2, 0x2a2a3a, 0.8);
      this.mapGraphics.strokeRect(corr.x, corr.y, corr.w, corr.h);
    }

    // 绘制中央祭坛房间
    const hub = this.rooms[0];
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(hub.x, hub.y, hub.w, hub.h);
    this.mapGraphics.lineStyle(3, 0x6a4a8a, 1);
    this.mapGraphics.strokeRect(hub.x, hub.y, hub.w, hub.h);

    // 祭坛房间地板装饰：魔法阵
    const hubCX = hub.x + hub.w / 2;
    const hubCY = hub.y + hub.h / 2;
    this.mapGraphics.lineStyle(2, 0x4a2a6a, 0.4);
    this.mapGraphics.strokeCircle(hubCX, hubCY, 80);
    this.mapGraphics.strokeCircle(hubCX, hubCY, 50);
    // 五芒星装饰线
    for (let i = 0; i < 5; i++) {
      const a1 = Phaser.Math.DegToRad(i * 72 - 90);
      const a2 = Phaser.Math.DegToRad(((i + 2) % 5) * 72 - 90);
      this.mapGraphics.beginPath();
      this.mapGraphics.moveTo(hubCX + Math.cos(a1) * 50, hubCY + Math.sin(a1) * 50);
      this.mapGraphics.lineTo(hubCX + Math.cos(a2) * 50, hubCY + Math.sin(a2) * 50);
      this.mapGraphics.strokePath();
    }

    // 绘制周围房间
    for (let i = 1; i <= 6; i++) {
      const room = this.rooms[i];
      this.mapGraphics.fillStyle(0x1c1c22, 1);
      this.mapGraphics.fillRect(room.x, room.y, room.w, room.h);
      this.mapGraphics.lineStyle(3, 0x3a3a44, 1);
      this.mapGraphics.strokeRect(room.x, room.y, room.w, room.h);

      // 房间名称
      this.add.text(room.x + room.w / 2, room.y + 14, room.name, {
        fontSize: '16px', color: '#5a5a6a', fontStyle: 'bold',
      }).setOrigin(0.5, 0).setDepth(0.5);

      // 房间编号（地板大字）
      this.add.text(room.x + room.w / 2, room.y + room.h / 2, String(i), {
        fontSize: '64px', color: '#2a2a34', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(0);

      // 家具装饰（中间长桌）
      this.mapGraphics.fillStyle(0x2a2a30, 1);
      this.mapGraphics.fillRect(room.x + room.w / 2 - 60, room.y + room.h / 2 - 15, 120, 30);
    }

    // 躲藏点
    for (const spot of this.hideSpots) {
      const color = spot.kind === 'locker' ? 0x3a3a4a : 0x4a3a2a;
      this.mapGraphics.fillStyle(color, 1);
      this.mapGraphics.lineStyle(2, 0x6a6a7a, 1);
      this.mapGraphics.fillRect(spot.x, spot.y, spot.w, spot.h);
      this.mapGraphics.strokeRect(spot.x, spot.y, spot.w, spot.h);
      // 标识
      const label = spot.kind === 'locker' ? '柜' : '桌';
      this.add.text(spot.x + spot.w / 2, spot.y + spot.h / 2, label, {
        fontSize: '10px', color: '#888888',
      }).setOrigin(0.5).setDepth(0.5);
    }

    // 残秽 Container
    for (let i = 1; i <= 6; i++) {
      const c = this.add.container(0, 0);
      c.setDepth(1);
      this.pollutionGraphics.push(c);
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
    const sub = this.add.text(0, 12, '投喂残秽', { fontSize: '11px', color: '#8855aa' }).setOrigin(0.5);
    container.add([pad, ring, label, sub]);

    this.tweens.add({
      targets: ring, scale: { from: 0.85, to: 1.15 },
      duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
    this.depositZone = container;
  }

  // ── Mine Pickup (祭坛旁地雷存放处) ─────────────────────────────────────

  private createMinePickup() {
    const hub = this.rooms[0];
    const cx = hub.x + hub.w / 2 - 80;
    const cy = hub.y + hub.h / 2 + 70;
    const container = this.add.container(cx, cy);
    container.setDepth(3);
    const box = this.add.rectangle(0, 0, 36, 36, 0x552200, 0.8);
    box.setStrokeStyle(2, 0xff6633, 1);
    const label = this.add.text(0, 0, '💣\n地雷', { fontSize: '9px', color: '#ffaa66', align: 'center' }).setOrigin(0.5);
    container.add([box, label]);
    this.minePickup = container;
  }

  // ── Player ───────────────────────────────────────────────────────────────

  private createPlayer() {
    const hub = this.rooms[0];
    this.player = this.add.rectangle(
      hub.x + hub.w / 2, hub.y + hub.h / 2 + 60,
      PLAYER_SIZE, PLAYER_SIZE, 0x44ddff
    );
    this.player.setDepth(5);
  }

  // ── Input ────────────────────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.mineKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
  }

  // ── Monsters ─────────────────────────────────────────────────────────────

  private spawnMonster(roomId: number) {
    const room = this.rooms[roomId];
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;
    const container = this.add.container(cx, cy);
    container.setDepth(6);

    const body = this.add.image(0, 0, 'ghost');
    const scale = MONSTER_H / body.height;
    body.setScale(scale);
    body.setAlpha(0.92);

    const eye = this.add.circle(0, -8, 7, 0xff0000);
    const wisp = this.add.circle(0, 0, MONSTER_W * 0.8, 0x9933ff, 0.12);
    container.add([wisp, body, eye]);

    this.tweens.add({
      targets: [body, eye],
      scaleX: { from: scale, to: scale * 1.06 }, scaleY: { from: scale, to: scale * 0.96 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
    container.setScale(0);
    this.tweens.add({ targets: container, scale: { from: 0, to: 1 }, duration: 400, ease: 'Back.easeOut' });

    this.monsters.push({
      container, body, eye, wisp,
      facing: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), 0).normalize(),
      speed: MONSTER_WANDER_SPEED, wanderTimer: 0, alive: true,
      pollutionDropTimer: 0, roomId,
      homeRoom: roomId,
      dying: false,
      aggro: false, aggroTimer: 0,
      returnTarget: -1, returnTimer: 0,
    });
  }

  private updateMonsters(delta: number) {
    const dt = delta / 1000;
    for (const m of this.monsters) {
      if (!m.alive || m.dying) continue;

      const target = this.isHidden ? null : this.player;
      if (target) {
        const toPlayer = new Phaser.Math.Vector2(target.x - m.container.x, target.y - m.container.y);
        const dist = toPlayer.length();
        // 追击范围：同房间或相邻走廊
        const playerRoom = this.getRoomAt(this.player.x, this.player.y);
        const inRange = playerRoom === m.homeRoom || playerRoom === 0;

        // 仇恨触发：在范围内且距离够近
        if (inRange && dist < MONSTER_AGGRO_RANGE) {
          m.aggro = true;
          m.aggroTimer = 3000; // 脱战后保持仇恨3秒
        }

        // 仇恨倒计时
        if (m.aggro) {
          m.aggroTimer -= delta;
          if (m.aggroTimer <= 0) {
            m.aggro = false;
          }
        }

        if (m.aggro && inRange && dist < 500) {
          // 仇恨追击：朝玩家方向加速
          m.speed = MONSTER_SPEED;
          if (dist > 1) { toPlayer.normalize(); m.facing.lerp(toPlayer, 0.08).normalize(); }
          m.returnTarget = -1; // 追击时清除返回目标
        } else {
          // 无仇恨或脱战：慢速返回随机房间
          m.speed = MONSTER_WANDER_SPEED;
          this.steerMonsterToRoom(m, delta);
        }
      } else {
        // 玩家躲藏：失去仇恨，慢速返回随机房间
        m.aggro = false;
        m.speed = MONSTER_WANDER_SPEED;
        this.steerMonsterToRoom(m, delta);
      }

      // 视觉反馈：仇恨时眼睛和光晕变红、变大
      if (m.aggro) {
        m.eye.setFillStyle(0xff2222);
        m.eye.setRadius(9);
        m.wisp.setFillStyle(0xff3333, 0.2);
      } else {
        m.eye.setFillStyle(0xaa0000);
        m.eye.setRadius(7);
        m.wisp.setFillStyle(0x9933ff, 0.12);
      }

      let newX = m.container.x + m.facing.x * m.speed * dt;
      let newY = m.container.y + m.facing.y * m.speed * dt;

      const moved = this.moveMonsterWithBounds(m, newX, newY);
      if (!moved.x) m.facing.x *= -1;
      if (!moved.y) m.facing.y *= -1;

      m.eye.x = m.facing.x * 10;
      m.eye.y = m.facing.y * 10 - 4;

      // 留下残秽
      m.pollutionDropTimer += delta;
      if (m.pollutionDropTimer > 1200) {
        m.pollutionDropTimer = 0;
        m.roomId = this.getRoomAt(m.container.x, m.container.y);
        if (m.roomId >= 1) {
          this.addPollution(m.roomId, 1.5);
        }
      }

      // 碰触即死
      if (!this.isHidden) {
        const killDist = Phaser.Math.Distance.Between(m.container.x, m.container.y, this.player.x, this.player.y);
        if (killDist < (MONSTER_W + PLAYER_SIZE) / 2) {
          this.die('被怪物触碰——瞬间死亡！');
          return;
        }
      }
    }
    this.monsters = this.monsters.filter(m => {
      if (!m.alive) { m.container.destroy(); return false; }
      return true;
    });
  }

  /** 无仇恨时：怪物朝随机目标房间移动，到达后换一个 */
  private steerMonsterToRoom(m: Monster, delta: number) {
    // 没有目标或到达目标房间 → 选新目标
    if (m.returnTarget < 0 || this.getRoomAt(m.container.x, m.container.y) === m.returnTarget) {
      // 随机选一个房间（优先出生房间，偶尔去别的房间）
      const choices = [1, 2, 3, 4, 5, 6].filter(r => r !== m.returnTarget);
      m.returnTarget = Phaser.Utils.Array.GetRandom(choices);
      m.returnTimer = 0;
    }

    // 超时保护：8秒没到就换目标（防止卡走廊）
    m.returnTimer += delta;
    if (m.returnTimer > 8000) {
      m.returnTarget = -1;
      return;
    }

    // 朝目标房间中心移动
    const room = this.rooms[m.returnTarget];
    if (!room) { m.returnTarget = -1; return; }
    const tx = room.x + room.w / 2;
    const ty = room.y + room.h / 2;
    const dx = tx - m.container.x;
    const dy = ty - m.container.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      const toTarget = new Phaser.Math.Vector2(dx / dist, dy / dist);
      m.facing.lerp(toTarget, 0.05).normalize();
    }
  }

  private moveMonsterWithBounds(m: Monster, newX: number, newY: number): { x: boolean; y: boolean } {
    const halfW = MONSTER_W / 2;
    const halfH = MONSTER_H / 2;
    let movedX = false, movedY = false;

    if (!this.isBlockedForMonster(newX, m.container.y, halfW, halfH, m)) {
      m.container.x = newX; movedX = true;
    }
    if (!this.isBlockedForMonster(m.container.x, newY, halfW, halfH, m)) {
      m.container.y = newY; movedY = true;
    }
    return { x: movedX, y: movedY };
  }

  private isBlockedForMonster(x: number, y: number, halfW: number, halfH: number, m?: Monster): boolean {
    // 怪物只能在出生房间、中央祭坛、以及连接两者的走廊内移动
    const home = this.rooms[m?.homeRoom ?? -1];
    const hub = this.rooms[0];
    if (home && this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, home.x, home.y, home.w, home.h)) return false;
    if (hub && this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, hub.x, hub.y, hub.w, hub.h)) return false;
    // 只允许怪物自己房间的走廊
    for (const corr of this.corridors) {
      if (m && corr.fromRoom !== m.homeRoom) continue;
      if (this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, corr.x, corr.y, corr.w, corr.h)) return false;
    }
    return true;
  }

  // ── Pollution ────────────────────────────────────────────────────────────

  private addPollution(roomId: number, amount: number) {
    if (roomId < 1 || roomId > 6) return;
    this.pollutionLevels[roomId] = Math.min(POLLUTION_MAX, this.pollutionLevels[roomId] + amount);
    this.redrawPollution(roomId);
  }

  private autoCleanPollution() {
    for (let i = 1; i <= 6; i++) {
      this.pollutionLevels[i] = Math.max(0, this.pollutionLevels[i] - AUTO_CLEAN_AMOUNT);
      this.redrawPollution(i);
    }
    this.cameras.main.flash(400, 150, 100, 255);
    this.showMessage('祭坛净化启动！全部房间残秽 -10%', 2500);
  }

  private redrawPollution(roomId: number) {
    const c = this.pollutionGraphics[roomId - 1];
    if (!c) return;
    c.removeAll(true);

    const level = this.pollutionLevels[roomId];
    if (level <= 0) return;

    const room = this.rooms[roomId];
    const rng = this.makeRng(roomId * 9173 + Math.floor(level));
    const blobCount = Math.floor(level / 8) + 2;

    for (let i = 0; i < blobCount; i++) {
      const bx = room.x + rng() * room.w;
      const by = room.y + rng() * room.h;
      const baseScale = (20 + rng() * 50 + level * 0.3) / 100;
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

  private cleanAtPlayer(delta: number) {
    if (this.carrying >= this.carryCapacity) return;
    const room = this.getRoomAt(this.player.x, this.player.y);
    if (room < 1 || room > 6) return;
    if (this.pollutionLevels[room] <= 0) return;

    const cleanRate = 0.36 * delta;
    this.pollutionLevels[room] = Math.max(0, this.pollutionLevels[room] - cleanRate);
    this.redrawPollution(room);
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
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) vy += 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * speed; vy = (vy / len) * speed;
    }
    const half = PLAYER_SIZE / 2;

    if (vx !== 0) {
      const newX = this.player.x + vx * dt;
      if (!this.isBlockedForPlayer(newX, this.player.y, half)) this.player.x = newX;
    }
    if (vy !== 0) {
      const newY = this.player.y + vy * dt;
      if (!this.isBlockedForPlayer(this.player.x, newY, half)) this.player.y = newY;
    }
  }

  private isBlockedForPlayer(x: number, y: number, half: number): boolean {
    if (this.isInAnyRoom(x, y, half, half)) return false;
    if (this.isInAnyCorridor(x, y, half, half)) return false;
    return true;
  }

  // ── Geometry Helpers ─────────────────────────────────────────────────────

  private isInAnyRoom(x: number, y: number, halfW: number, halfH: number): boolean {
    for (const room of this.rooms) {
      if (x - halfW < room.x + room.w && x + halfW > room.x &&
          y - halfH < room.y + room.h && y + halfH > room.y) {
        return true;
      }
    }
    return false;
  }

  private isInAnyCorridor(x: number, y: number, halfW: number, halfH: number): boolean {
    for (const corr of this.corridors) {
      if (x - halfW < corr.x + corr.w && x + halfW > corr.x &&
          y - halfH < corr.y + corr.h && y + halfH > corr.y) {
        return true;
      }
    }
    return false;
  }

  private getRoomAt(x: number, y: number): number {
    for (const room of this.rooms) {
      if (x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h) {
        return room.id;
      }
    }
    return -1; // 在走廊或外面
  }

  private rectOverlap(x1: number, y1: number, w1: number, h1: number, x2: number, y2: number, w2: number, h2: number): boolean {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  // ── Actions ──────────────────────────────────────────────────────────────

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
    if (Phaser.Input.Keyboard.JustDown(this.mineKey)) {
      this.placeMine();
    }
  }

  private tryInteract() {
    // 1. 拾取地雷
    if (!this.hasMine) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.minePickup.x, this.minePickup.y);
      if (d < MINE_PICKUP_RANGE) {
        this.hasMine = true;
        this.showMessage('拾取了地雷！按 Q 放置', 1500);
        return;
      }
    }
    // 2. 投喂残秽到祭坛
    if (this.carrying > 0) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.depositZone.x, this.depositZone.y);
      if (d < 55) {
        this.fuel = Math.min(FUEL_MAX, this.fuel + FUEL_PER_DEPOSIT * this.carrying);
        this.ritualProgress += FUEL_PER_DEPOSIT * this.carrying;
        this.carrying = 0;
        this.depositCount++;
        this.cameras.main.flash(200, 100, 50, 255);
        this.showMessage('残秽已献祭给祭坛！仪式进度+', 1000);
        if (this.ritualProgress >= RITUAL_TOTAL) { this.win(); return; }
        if (this.depositCount >= AUTO_CLEAN_DEPOSITS) {
          this.depositCount = 0;
          this.autoCleanPollution();
        }
        return;
      }
    }
    // 2. 躲藏
    const spot = this.findNearestHideSpot(this.player.x, this.player.y, 35);
    if (spot) {
      if (!this.isHidden) this.enterHide(spot);
      else this.exitHide();
      return;
    }
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

  // ── Mines ────────────────────────────────────────────────────────────────

  private placeMine() {
    if (!this.hasMine) {
      this.showMessage('没有地雷！去祭坛旁按 E 拾取', 1500);
      return;
    }
    if (this.isHidden) return;

    const container = this.add.container(this.player.x, this.player.y);
    container.setDepth(4);
    const body = this.add.circle(0, 0, 12, 0xff4400, 0.8);
    body.setStrokeStyle(2, 0xffaa00, 1);
    const blink = this.add.circle(0, 0, 4, 0xffff00, 1);
    container.add([body, blink]);

    // 闪烁动画
    this.tweens.add({
      targets: blink, alpha: { from: 1, to: 0.2 },
      duration: 300, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });

    this.mines.push({
      x: this.player.x, y: this.player.y,
      armed: false, armTimer: MINE_ARM_TIME,
      sprite: container, exploded: false,
    });
    this.hasMine = false;
    this.showMessage('地雷已放置！0.8秒后武装', 1200);
  }

  private updateMines(delta: number) {
    for (const mine of this.mines) {
      if (mine.exploded) continue;

      // 武装倒计时
      if (!mine.armed) {
        mine.armTimer -= delta;
        if (mine.armTimer <= 0) {
          mine.armed = true;
        }
        continue;
      }

      // 检测怪物是否进入触发范围
      for (const m of this.monsters) {
        if (!m.alive || m.dying) continue;
        const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, mine.x, mine.y);
        if (d < MINE_TRIGGER_DIST) {
          this.detonateMine(mine);
          break;
        }
      }
    }
    // 清理已爆炸的地雷
    this.mines = this.mines.filter(m => {
      if (m.exploded) { m.sprite.destroy(); return false; }
      return true;
    });
  }

  private detonateMine(mine: Mine) {
    mine.exploded = true;

    // 爆炸特效
    const blast = this.add.circle(mine.x, mine.y, MINE_RADIUS, 0xff6600, 0.4);
    blast.setStrokeStyle(4, 0xffaa00, 0.8);
    blast.setDepth(8);
    this.tweens.add({
      targets: blast,
      scale: { from: 0.2, to: 1 },
      alpha: { from: 0.6, to: 0 },
      duration: 400,
      ease: 'Power2',
      onComplete: () => blast.destroy(),
    });
    this.cameras.main.shake(200, 0.01);
    this.cameras.main.flash(100, 255, 150, 0);

    // 范围内怪物全部消灭
    let killed = 0;
    for (const m of this.monsters) {
      if (!m.alive || m.dying) continue;
      const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, mine.x, mine.y);
      if (d < MINE_RADIUS) {
        this.killMonster(m);
        killed++;
      }
    }
    if (killed > 0) {
      this.showMessage(`💣 地雷爆炸！消灭了 ${killed} 只怪物！`, 2000);
    }
  }

  private killMonster(m: Monster) {
    m.dying = true;
    this.tweens.add({
      targets: m.container,
      alpha: 0, scale: 0.3,
      duration: 800,
      onComplete: () => { m.alive = false; },
    });
  }

  // ── Pollution Spread & Natural Generation ───────────────────────────────

  private updatePollutionSpread(delta: number) {
    const dt = delta / 1000;
    const speedFactor = this.fuel <= 0 ? 2.5 : (this.fuel < 25 ? 1.6 : (this.fuel < 50 ? 1.2 : 1.0));

    // 1. 自然生成
    for (let i = 1; i <= 6; i++) {
      this.pollutionLevels[i] = Math.min(POLLUTION_MAX, this.pollutionLevels[i] + POLLUTION_NATURAL_RATE * dt * speedFactor);
    }

    // 2. 高浓度扩散到相邻房间（通过走廊）
    // 简化：每个房间与祭坛相邻，高浓度房间会向祭坛扩散，祭坛不积累
    for (let i = 1; i <= 6; i++) {
      if (this.pollutionLevels[i] > POLLUTION_HIGH_THRESHOLD) {
        // 向相邻房间扩散（编号相邻的房间）
        const neighbors = this.getNeighborRooms(i);
        for (const n of neighbors) {
          this.pollutionLevels[n] = Math.min(POLLUTION_MAX, this.pollutionLevels[n] + POLLUTION_SPREAD_RATE * dt * speedFactor);
        }
      }
    }

    // 3. 重绘
    for (let i = 1; i <= 6; i++) {
      this.redrawPollution(i);
    }

    // 4. 满浓度加速扩散 + 死亡判定
    let fullCount = 0;
    for (let i = 1; i <= 6; i++) {
      if (this.pollutionLevels[i] >= POLLUTION_MAX) {
        fullCount++;
        const neighbors = this.getNeighborRooms(i);
        for (const n of neighbors) {
          this.pollutionLevels[n] = Math.min(POLLUTION_MAX, this.pollutionLevels[n] + POLLUTION_FULL_SPILL_RATE * dt);
        }
      }
    }
    if (fullCount >= POLLUTION_DEATH_ROOMS) {
      this.die(`${fullCount}个房间残秽浓度全部爆表，仪式被吞没！`); return;
    }

    // 5. 保底刷怪：场上无怪时倒计时，到时间直接刷2只
    const aliveCount = this.monsters.filter(m => m.alive && !m.dying).length;
    if (aliveCount === 0) {
      this.guaranteeSpawnTimer += delta;
      if (this.guaranteeSpawnTimer >= GUARANTEE_SPAWN_INTERVAL) {
        this.guaranteeSpawnTimer = 0;
        // 随机选2个不同房间刷怪
        const roomIds = [1, 2, 3, 4, 5, 6];
        Phaser.Utils.Array.Shuffle(roomIds);
        for (let j = 0; j < GUARANTEE_SPAWN_COUNT; j++) {
          this.spawnMonster(roomIds[j]);
        }
        this.showMessage('黑暗中传来脚步声……新的怪物出现了！', 2000);
      }
    } else {
      this.guaranteeSpawnTimer = 0;
    }

    // 6. 概率刷怪
    for (let i = 1; i <= 6; i++) {
      const level = this.pollutionLevels[i];
      if (level < POLLUTION_SPAWN_MIN) {
        this.pollutionSpawnCooldown[i] = 0;
        continue;
      }

      this.pollutionSpawnCooldown[i] -= delta;
      if (this.pollutionSpawnCooldown[i] > 0) continue;

      let spawnChance: number;
      if (level >= POLLUTION_SPAWN_THRESHOLD) {
        spawnChance = 1.0;
      } else {
        const t = (level - POLLUTION_SPAWN_MIN) / (POLLUTION_SPAWN_THRESHOLD - POLLUTION_SPAWN_MIN);
        spawnChance = 0.05 + t * 0.95;
      }

      if (Math.random() < spawnChance) {
        const hasMonster = this.monsters.some(m => m.alive && !m.dying && m.roomId === i);
        const aliveCount = this.monsters.filter(m => m.alive && !m.dying).length;
        if (!hasMonster && aliveCount < POLLUTION_SPAWN_MAX_MONSTERS) {
          this.spawnMonster(i);
          this.pollutionSpawnCooldown[i] = POLLUTION_SPAWN_CHECK_INTERVAL;
          this.showMessage(`${this.rooms[i].name}的残秽滋生了新的怪物！`, 2000);
        } else {
          this.pollutionSpawnCooldown[i] = POLLUTION_SPAWN_CHECK_INTERVAL;
        }
      } else {
        this.pollutionSpawnCooldown[i] = POLLUTION_SPAWN_CHECK_INTERVAL;
      }
    }
  }

  /** 获取相邻房间（通过走廊连接） */
  private getNeighborRooms(roomId: number): number[] {
    const neighbors: number[] = [];
    for (const corr of this.corridors) {
      if (corr.fromRoom === roomId) neighbors.push(corr.toRoom);
      if (corr.toRoom === roomId) neighbors.push(corr.fromRoom);
    }
    // 所有外围房间都连接到祭坛(0)，但祭坛不积累残秽
    // 额外：相邻编号的外围房间也视为邻居（模拟物理相邻）
    if (roomId >= 1 && roomId <= 6) {
      const prev = roomId === 1 ? 6 : roomId - 1;
      const next = roomId === 6 ? 1 : roomId + 1;
      if (!neighbors.includes(prev)) neighbors.push(prev);
      if (!neighbors.includes(next)) neighbors.push(next);
    }
    return neighbors.filter(n => n >= 1 && n <= 6); // 排除祭坛
  }

  // ── Fuel / Ritual Progress ──────────────────────────────────────────────

  private updateFuelRitual(delta: number) {
    const dt = delta / 1000;
    this.fuel -= FUEL_DRAIN_RATE * dt;
    if (this.fuel < 0) this.fuel = 0;

    if (this.fuel > 0) {
      const speedRatio = this.fuel > 70 ? 1.0 : (this.fuel > 25 ? 0.6 : 0.3);
      this.ritualProgress += 3 * speedRatio * dt;
      this.stallTimer = 0;
      if (this.ritualProgress >= RITUAL_TOTAL) { this.win(); return; }
    } else {
      this.stallTimer += delta;
      if (this.stallTimer >= STALL_DEATH_TIME) { this.die('祭坛熄灭过久，残秽吞没一切！'); return; }
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  private createUI() {
    this.fuelText = this.add.text(16, 16, '祭坛之火: 100%', { fontSize: '18px', color: '#cc88ff' }).setScrollFactor(0).setDepth(20);
    this.ritualText = this.add.text(16, 40, '仪式进度: 0/1000', { fontSize: '18px', color: '#44ddff' }).setScrollFactor(0).setDepth(20);
    this.carryText = this.add.text(16, 64, '携带残秽: 0/3', { fontSize: '18px', color: '#ff6666' }).setScrollFactor(0).setDepth(20);
    this.mineText = this.add.text(16, 88, '地雷: 未携带 (库存5)', { fontSize: '16px', color: '#ffaa66' }).setScrollFactor(0).setDepth(20);
    this.pollutionText = this.add.text(16, 110, '残秽: ', { fontSize: '14px', color: '#ff4444' }).setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 540, '', {
      fontSize: '20px', color: '#ffffff', align: 'center',
      backgroundColor: '#000000', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);

    const backBtn = this.add.text(680, 16, '← 菜单', {
      fontSize: '18px', color: '#ffffff', backgroundColor: '#333333', padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);
    backBtn.on('pointerdown', () => {
      if (this.cryingSound) this.cryingSound.stop();
      this.scene.start('MenuScene');
    });

    this.add.text(400, 575, 'WASD/方向键移动 • 空格吸取残秽 • E交互(拾取地雷/投喂/躲藏) • Q放置地雷 • 被怪物碰到即死', {
      fontSize: '12px', color: '#666666',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
  }

  private updateUI() {
    this.fuelText.setText(`祭坛之火: ${Math.ceil(this.fuel)}%`);
    this.fuelText.setColor(this.fuel < 25 ? '#ff4444' : (this.fuel < 50 ? '#ffaa44' : '#cc88ff'));
    this.ritualText.setText(`仪式进度: ${Math.ceil(this.ritualProgress)}/${RITUAL_TOTAL}`);
    this.carryText.setText(`携带残秽: ${this.carrying.toFixed(1)}/${this.carryCapacity}`);
    this.mineText.setText(this.hasMine ? '地雷: 携带中' : '地雷: 未携带 (无限)');

    let pStr = '残秽: ';
    for (let i = 1; i <= 6; i++) {
      pStr += `${this.rooms[i].name}:${Math.ceil(this.pollutionLevels[i])}% `;
    }
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
    this.updateMines(delta);
    this.updatePollutionSpread(delta);
    this.updateFuelRitual(delta);
    this.updateUI();
    this.updateCryingVolume();
    this.updateVisionOverlay();
  }

  private updateCryingVolume() {
    if (!this.cryingSound || !this.cryingSound.isPlaying) return;
    let minDist = Infinity;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, this.player.x, this.player.y);
      if (d < minDist) minDist = d;
    }
    const maxRange = 800;
    const vol = minDist < maxRange ? (1 - minDist / maxRange) * 0.8 : 0;
    (this.cryingSound as any).setVolume(vol);
  }

  // ── Vision Overlay ───────────────────────────────────────────────────────

  private createVisionOverlay() {
    const overlaySize = 1000;
    const texKey = 'ritualVisionOverlay';
    if (!this.textures.exists(texKey)) {
      const vc = this.textures.createCanvas(texKey, overlaySize, overlaySize);
      if (vc) {
        const ctx = vc.getContext();
        const c = overlaySize / 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
        ctx.fillRect(0, 0, overlaySize, overlaySize);
        ctx.globalCompositeOperation = 'destination-out';
        const grad = ctx.createRadialGradient(c, c, 0, c, c, 400);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(0.4, 'rgba(0,0,0,1)');
        grad.addColorStop(0.72, 'rgba(0,0,0,0.5)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, overlaySize, overlaySize);
        ctx.globalCompositeOperation = 'source-over';
        vc.refresh();

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

    this.visionOverlay = this.add.image(400, 300, texKey);
    this.visionOverlay.setScrollFactor(0);
    this.visionOverlay.setDepth(15);
  }

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
    this.showMessage('🎉 仪式完成！封印成功！\n\n按ESC返回菜单', 999999);
  }

  private die(cause: string) {
    if (this.isDead) return;
    this.isDead = true;
    this.player.setFillStyle(0x666666);

    if (this.cryingSound) this.cryingSound.stop();
    if (this.screamSound) this.screamSound.play();

    const cam = this.cameras.main;
    const jumpscare = this.add.image(cam.centerX, cam.centerY, 'ghost');
    jumpscare.setScrollFactor(0);
    jumpscare.setDepth(9999);
    const scaleX = cam.width / jumpscare.width;
    const scaleY = cam.height / jumpscare.height;
    const coverScale = Math.max(scaleX, scaleY) * 1.1;
    jumpscare.setScale(0);
    jumpscare.setAlpha(1);

    this.tweens.add({
      targets: jumpscare,
      scale: coverScale,
      duration: 120,
      ease: 'Back.easeOut',
    });
    cam.shake(500, 0.04);
    cam.flash(150, 255, 0, 0, true);

    this.time.delayedCall(1200, () => {
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
