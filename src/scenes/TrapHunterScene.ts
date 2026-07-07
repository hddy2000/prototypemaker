import Phaser from 'phaser';

// ── 陷阱猎人 (Trap Hunter) ──────────────────────────────────────────────
// 核心循环：玩家用噪音器/冲刺噪音引诱怪物 → 怪物前往声源调查途中踩中预埋陷阱
//          → 爆炸击杀掉落灵魂 → 拾取灵魂回祭坛献祭推进仪式 → 通关
// 恐怖张力：想发声引诱又怕发声暴露自己
// 复用：RitualRoomsScene 的布雷/爆炸/房间布局/祭坛 + EcholocationScene 的噪音/声源调查 AI

// ── Types ──────────────────────────────────────────────────────────────────

interface RoomDef {
  id: number;           // 0 = 中央祭坛, 1..6 = 周围房间
  x: number; y: number; w: number; h: number;
  name: string; isHub: boolean;
}

interface CorridorDef {
  x: number; y: number; w: number; h: number;
  fromRoom: number; toRoom: number;
}

interface HideSpot {
  x: number; y: number; w: number; h: number;
  kind: 'locker' | 'table'; roomId: number; occupied: boolean;
}

interface Monster {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  eye: Phaser.GameObjects.Arc;
  wisp: Phaser.GameObjects.Arc;
  facing: Phaser.Math.Vector2;
  speed: number;
  alive: boolean;
  dying: boolean;
  roomId: number;
  homeRoom: number;
  // 仇恨/追击（来自 RitualRooms）
  aggro: boolean;
  aggroTimer: number;
  // 调查声源（来自 Echolocation）
  isInvestigating: boolean;
  investigateX: number;
  investigateY: number;
  investigateTimer: number;     // 调查持续时间
  investigateArrived: boolean;  // 是否已到达声源
  investigateLinger: number;    // 到达后徘徊计时
  // 游荡
  returnTarget: number;
  returnTimer: number;
  wanderTimer: number;
}

interface Mine {
  x: number; y: number;
  armed: boolean; armTimer: number;
  sprite: Phaser.GameObjects.Container;
  exploded: boolean;
}

interface Soul {
  x: number; y: number;
  sprite: Phaser.GameObjects.Arc;
  life: number;       // 剩余存活时间(ms)
  attracted: boolean; // 是否正被吸引向玩家
}

interface NoiseMaker {
  x: number; y: number;
  vx: number; vy: number;
  sprite: Phaser.GameObjects.Container;
  landed: boolean;
  landTimer: number;  // 落地后到发声的延迟
  pulsed: boolean;
}

interface Pulse {
  x: number; y: number;
  radius: number; maxRadius: number;
  alpha: number;
  ringGraphics: Phaser.GameObjects.Graphics;
}

// ── Constants ──────────────────────────────────────────────────────────────

const HUB_W = 280; const HUB_H = 240;
const ROOM_W = 220; const ROOM_H = 180;
const CORR_W = 40; const CORR_LEN = 80;
const MAP_CX = 750; const MAP_CY = 560;

const PLAYER_SPEED = 210;
const PLAYER_SPRINT_SPEED = 320;
const PLAYER_CROUCH_SPEED = 90;  // 蹲伏速度
const PLAYER_SIZE = 22;

const MONSTER_W = 56; const MONSTER_H = 80;
const MONSTER_SPEED = 215;  // 追击速度：略高于玩家正常速度
const MONSTER_WANDER_SPEED = PLAYER_SPEED * 0.35;
const MONSTER_INVESTIGATE_SPEED = PLAYER_SPEED * 0.85;
const MONSTER_AGGRO_RANGE = 500;
const MONSTER_VISION_BASE = 250;  // 大幅增加基础视线：从 100 → 250
const MONSTER_GIVEUP_TIME = 8000;
const MONSTER_INVESTIGATE_LINGER = 4000;

// 陷阱
const MINE_TOTAL = 5;
const MINE_PICKUP_RANGE = 35;
const MINE_RADIUS = 100;  // 缩小爆炸范围：从 120 → 100
const MINE_ARM_TIME = 1200;  // 增加武装时间：从 800 → 1200ms
const MINE_TRIGGER_DIST = 35;  // 缩小触发距离：从 40 → 35

// 噪音器
const NOISEMAKER_TOTAL = 5;
const NOISEMAKER_PICKUP_RANGE = 35;
const NOISEMAKER_PULSE_RADIUS = 350;
const NOISEMAKER_LAND_DELAY = 200;    // 落地后发声延迟

// 噪音
const NOISE_DECAY = 25;  // 加快噪音衰减：从 15 → 25/s
const NOISE_SPRINT_RATE = 50;  // 冲刺噪音产生率
const NOISE_WALK_RATE = 15;  // 正常走路噪音产生率
const NOISE_CROUCH_RATE = 2;  // 蹲伏走路噪音产生率（大幅减少）
const NOISE_VISION_BONUS = 2.0;  // 噪音对视线加成

// 灵魂
const SOUL_LIFETIME = 7000;
const SOUL_PICKUP_RANGE = 35;
const SOUL_PICKUP_RANGE_MAGNET = 80;  // 磁吸范围
const SOUL_PER_DEPOSIT = 12;          // 每个灵魂的仪式进度

// 仪式
const RITUAL_TOTAL = 600;

// 刷怪
const GUARANTEE_SPAWN_INTERVAL = 15000;
const GUARANTEE_SPAWN_COUNT = 2;
const MAX_MONSTERS = 5;

// ── Scene ──────────────────────────────────────────────────────────────────

export class TrapHunterScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private mineKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private crouchKey!: Phaser.Input.Keyboard.Key;

  // 地图
  private rooms: RoomDef[] = [];
  private corridors: CorridorDef[] = [];
  private hideSpots: HideSpot[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // 怪物
  private monsters: Monster[] = [];

  // 玩家状态
  private carrying = 0;
  private isHidden = false;
  private hiddenSpot: HideSpot | null = null;
  private lastMoveDir = new Phaser.Math.Vector2(0, 1);

  // 陷阱
  private mines: Mine[] = [];
  private hasMine = false;
  private minesRemaining = MINE_TOTAL;
  private minePickup!: Phaser.GameObjects.Container;

  // 噪音器
  private noiseMakers: NoiseMaker[] = [];
  private hasNoiseMaker = false;
  private noiseMakersRemaining = NOISEMAKER_TOTAL;
  private noiseMakerPickup!: Phaser.GameObjects.Container;

  // 声波脉冲
  private pulses: Pulse[] = [];

  // 灵魂
  private souls: Soul[] = [];

  // 噪音
  private noiseLevel = 0;

  // 祭坛
  private depositZone!: Phaser.GameObjects.Container;

  // 仪式进度
  private ritualProgress = 0;

  // 状态
  private isDead = false;
  private isWon = false;
  private guaranteeSpawnTimer = 0;

  // 音频
  private cryingSound!: Phaser.Sound.BaseSound;
  private screamSound!: Phaser.Sound.BaseSound;

  // 视野遮蔽
  private visionOverlay!: Phaser.GameObjects.Image;
  private visionRadius = 400;   // 动态视野半径

  // UI
  private ritualText!: Phaser.GameObjects.Text;
  private carryText!: Phaser.GameObjects.Text;
  private mineText!: Phaser.GameObjects.Text;
  private noiseMakerText!: Phaser.GameObjects.Text;
  private noiseText!: Phaser.GameObjects.Text;
  private crouchText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private messageTimer: number | null = null;
  private comboText!: Phaser.GameObjects.Text;

  constructor() { super({ key: 'TrapHunterScene' }); }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  create() {
    // Reset all state (scene.restart reuses same object)
    this.rooms = []; this.corridors = []; this.hideSpots = []; this.monsters = [];
    this.carrying = 0; this.isHidden = false; this.hiddenSpot = null;
    this.lastMoveDir = new Phaser.Math.Vector2(0, 1);
    this.mines = []; this.hasMine = false; this.minesRemaining = MINE_TOTAL;
    this.noiseMakers = []; this.hasNoiseMaker = false; this.noiseMakersRemaining = NOISEMAKER_TOTAL;
    this.pulses = []; this.souls = [];
    this.noiseLevel = 0;
    this.ritualProgress = 0;
    this.isDead = false; this.isWon = false;
    this.guaranteeSpawnTimer = 0;
    this.visionRadius = 400;

    this.buildRooms();
    this.drawMap();
    this.createDepositZone();
    this.createMinePickup();
    this.createNoiseMakerPickup();
    this.createPlayer();
    this.createUI();
    this.setupInput();
    this.createVisionOverlay();

    // 相机跟随玩家
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
    this.cameras.main.setLerp(0.1, 0.1);

    // 音频
    if (this.sound.get('crying') && !this.cryingSound) {
      this.cryingSound = this.sound.add('crying', { loop: true, volume: 0 });
      this.cryingSound.play();
    }
    if (this.sound.get('scream') && !this.screamSound) {
      this.screamSound = this.sound.add('scream', { volume: 0.7 });
    }

    // 初始两只怪物
    this.spawnMonster(2);
    this.spawnMonster(5);

    this.showMessage('陷阱猎人\n[Q]放陷阱 [鼠标左键]投噪音器引诱\n[Shift]冲刺(大噪音) [C]蹲伏(小噪音) [E]拾取/献祭/躲藏\n杀怪掉灵魂→献祭祭坛→完成仪式', 5000);
  }

  // ── Map (复用 RitualRoomsScene) ──────────────────────────────────────────

  private buildRooms() {
    const hubX = MAP_CX - HUB_W / 2;
    const hubY = MAP_CY - HUB_H / 2;
    this.rooms.push({ id: 0, x: hubX, y: hubY, w: HUB_W, h: HUB_H, name: '祭坛', isHub: true });

    const outerRooms = [
      { name: '图书室', angle: -90 }, { name: '实验室', angle: -30 },
      { name: '储藏间', angle: 30 }, { name: '祈祷室', angle: 90 },
      { name: '卧室', angle: 150 }, { name: '厨房', angle: 210 },
    ];
    const orbitRadius = 500;
    for (let i = 0; i < outerRooms.length; i++) {
      const a = Phaser.Math.DegToRad(outerRooms[i].angle);
      const cx = MAP_CX + Math.cos(a) * orbitRadius;
      const cy = MAP_CY + Math.sin(a) * orbitRadius;
      this.rooms.push({ id: i + 1, x: cx - ROOM_W / 2, y: cy - ROOM_H / 2, w: ROOM_W, h: ROOM_H, name: outerRooms[i].name, isHub: false });
    }

    for (let i = 1; i <= 6; i++) {
      const room = this.rooms[i]; const hub = this.rooms[0];
      const rcx = room.x + room.w / 2; const rcy = room.y + room.h / 2;
      const hcx = hub.x + hub.w / 2; const hcy = hub.y + hub.h / 2;
      const dx = hcx - rcx; const dy = hcy - rcy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / dist; const ny = dy / dist;
      const sx = rcx + nx * (room.w / 2); const sy = rcy + ny * (room.h / 2);
      const ex = hcx - nx * (hub.w / 2); const ey = hcy - ny * (hub.h / 2);
      const hMinX = Math.min(sx, ex) - CORR_W / 2; const hMaxX = Math.max(sx, ex) + CORR_W / 2;
      this.corridors.push({ x: hMinX, y: sy - CORR_W / 2, w: hMaxX - hMinX, h: CORR_W, fromRoom: i, toRoom: 0 });
      const vMinY = Math.min(sy, ey) - CORR_W / 2; const vMaxY = Math.max(sy, ey) + CORR_W / 2;
      this.corridors.push({ x: ex - CORR_W / 2, y: vMinY, w: CORR_W, h: vMaxY - vMinY, fromRoom: i, toRoom: 0 });
    }

    for (let i = 1; i <= 6; i++) {
      const r = this.rooms[i];
      this.hideSpots.push({ x: r.x + 20, y: r.y + 20, w: 60, h: 60, kind: 'locker', roomId: i, occupied: false });
      this.hideSpots.push({ x: r.x + r.w - 80, y: r.y + 20, w: 60, h: 60, kind: 'locker', roomId: i, occupied: false });
      this.hideSpots.push({ x: r.x + 20, y: r.y + r.h - 80, w: 70, h: 50, kind: 'table', roomId: i, occupied: false });
      this.hideSpots.push({ x: r.x + r.w - 90, y: r.y + r.h - 80, w: 70, h: 50, kind: 'table', roomId: i, occupied: false });
    }
  }

  private drawMap() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.setDepth(0);

    for (const corr of this.corridors) {
      this.mapGraphics.fillStyle(0x14141c, 1);
      this.mapGraphics.fillRect(corr.x, corr.y, corr.w, corr.h);
      this.mapGraphics.lineStyle(2, 0x2a2a3a, 0.8);
      this.mapGraphics.strokeRect(corr.x, corr.y, corr.w, corr.h);
    }

    const hub = this.rooms[0];
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(hub.x, hub.y, hub.w, hub.h);
    this.mapGraphics.lineStyle(3, 0x6a4a8a, 1);
    this.mapGraphics.strokeRect(hub.x, hub.y, hub.w, hub.h);

    const hcx = hub.x + hub.w / 2; const hcy = hub.y + hub.h / 2;
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

    for (let i = 1; i <= 6; i++) {
      const room = this.rooms[i];
      this.mapGraphics.fillStyle(0x1c1c22, 1);
      this.mapGraphics.fillRect(room.x, room.y, room.w, room.h);
      this.mapGraphics.lineStyle(3, 0x3a3a44, 1);
      this.mapGraphics.strokeRect(room.x, room.y, room.w, room.h);
      this.add.text(room.x + room.w / 2, room.y + 14, room.name, { fontSize: '16px', color: '#5a5a6a', fontStyle: 'bold' }).setOrigin(0.5, 0).setDepth(0.5);
      this.add.text(room.x + room.w / 2, room.y + room.h / 2, String(i), { fontSize: '64px', color: '#2a2a34', fontStyle: 'bold' }).setOrigin(0.5).setDepth(0);
      this.mapGraphics.fillStyle(0x2a2a30, 1);
      this.mapGraphics.fillRect(room.x + room.w / 2 - 60, room.y + room.h / 2 - 15, 120, 30);
    }

    for (const spot of this.hideSpots) {
      const color = spot.kind === 'locker' ? 0x3a3a4a : 0x4a3a2a;
      this.mapGraphics.fillStyle(color, 1);
      this.mapGraphics.lineStyle(2, 0x6a6a7a, 1);
      this.mapGraphics.fillRect(spot.x, spot.y, spot.w, spot.h);
      this.mapGraphics.strokeRect(spot.x, spot.y, spot.w, spot.h);
      const label = spot.kind === 'locker' ? '柜' : '桌';
      this.add.text(spot.x + spot.w / 2, spot.y + spot.h / 2, label, { fontSize: '10px', color: '#888888' }).setOrigin(0.5).setDepth(0.5);
    }
  }

  // ── Deposit Zone / Pickups ───────────────────────────────────────────────

  private createDepositZone() {
    const hub = this.rooms[0];
    const cx = hub.x + hub.w / 2; const cy = hub.y + hub.h / 2;
    const container = this.add.container(cx, cy);
    container.setDepth(3);
    const pad = this.add.rectangle(0, 0, 100, 100, 0x220044, 0.5);
    const ring = this.add.circle(0, 0, 45, 0x9933ff, 0.15);
    ring.setStrokeStyle(3, 0x9933ff, 0.8);
    const label = this.add.text(0, -10, '祭坛', { fontSize: '16px', color: '#cc88ff' }).setOrigin(0.5);
    const sub = this.add.text(0, 12, '献祭灵魂', { fontSize: '11px', color: '#8855aa' }).setOrigin(0.5);
    container.add([pad, ring, label, sub]);
    this.tweens.add({ targets: ring, scale: { from: 0.85, to: 1.15 }, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.depositZone = container;
  }

  private createMinePickup() {
    const hub = this.rooms[0];
    const cx = hub.x + hub.w / 2 - 80; const cy = hub.y + hub.h / 2 + 70;
    const container = this.add.container(cx, cy);
    container.setDepth(3);
    const box = this.add.rectangle(0, 0, 36, 36, 0x552200, 0.8);
    box.setStrokeStyle(2, 0xff6633, 1);
    const label = this.add.text(0, 0, '💣\n陷阱', { fontSize: '9px', color: '#ffaa66', align: 'center' }).setOrigin(0.5);
    container.add([box, label]);
    this.minePickup = container;
  }

  private createNoiseMakerPickup() {
    const hub = this.rooms[0];
    const cx = hub.x + hub.w / 2 + 80; const cy = hub.y + hub.h / 2 + 70;
    const container = this.add.container(cx, cy);
    container.setDepth(3);
    const box = this.add.rectangle(0, 0, 36, 36, 0x224488, 0.8);
    box.setStrokeStyle(2, 0x66aaff, 1);
    const label = this.add.text(0, 0, '🔔\n噪音器', { fontSize: '9px', color: '#aaccff', align: 'center' }).setOrigin(0.5);
    container.add([box, label]);
    this.noiseMakerPickup = container;
  }

  private createPlayer() {
    const hub = this.rooms[0];
    this.player = this.add.rectangle(hub.x + hub.w / 2, hub.y + hub.h / 2 + 60, PLAYER_SIZE, PLAYER_SIZE, 0x44ddff);
    this.player.setDepth(5);
  }

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
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.crouchKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.C);

    // 鼠标左键投掷噪音器
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) this.throwNoiseMaker(pointer);
    });
  }

  // ── Monsters ─────────────────────────────────────────────────────────────

  private spawnMonster(roomId: number) {
    const room = this.rooms[roomId];
    const cx = room.x + room.w / 2; const cy = room.y + room.h / 2;
    const container = this.add.container(cx, cy);
    container.setDepth(6);
    const body = this.add.image(0, 0, 'ghost');
    const scale = MONSTER_H / body.height;
    body.setScale(scale); body.setAlpha(0.92);
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
      speed: MONSTER_WANDER_SPEED, alive: true, roomId, homeRoom: roomId, dying: false,
      aggro: false, aggroTimer: 0,
      isInvestigating: false, investigateX: 0, investigateY: 0, investigateTimer: 0,
      investigateArrived: false, investigateLinger: 0,
      returnTarget: -1, returnTimer: 0, wanderTimer: 0,
    });
  }

  private updateMonsters(delta: number) {
    const dt = delta / 1000;
    for (const m of this.monsters) {
      if (!m.alive || m.dying) continue;

      const distToPlayer = Phaser.Math.Distance.Between(m.container.x, m.container.y, this.player.x, this.player.y);

      // ── 状态判定优先级：追击 > 调查 > 游荡 ──

      // 1. 视线检测（追击触发）：基础视线 + 噪音加成
      const noiseBonus = this.noiseLevel * NOISE_VISION_BONUS;
      const effectiveVision = MONSTER_VISION_BASE + noiseBonus;
      const canSee = !this.isHidden && distToPlayer < effectiveVision &&
        !this.lineBlockedByWall(m.container.x, m.container.y, this.player.x, this.player.y);

      if (canSee) {
        m.aggro = true;
        m.aggroTimer = MONSTER_GIVEUP_TIME;
        m.isInvestigating = false; // 追击覆盖调查
      } else if (m.aggro) {
        m.aggroTimer -= delta;
        if (m.aggroTimer <= 0) m.aggro = false;
      }

      // 2. 调查计时
      if (m.isInvestigating) {
        m.investigateTimer -= delta;
        if (m.investigateTimer <= 0) {
          m.isInvestigating = false;
          m.investigateArrived = false;
        }
      }

      // ── 按状态移动 ──
      if (m.aggro) {
        // 追击玩家
        m.speed = MONSTER_SPEED;  // 215
        const toPlayer = new Phaser.Math.Vector2(this.player.x - m.container.x, this.player.y - m.container.y);
        if (toPlayer.length() > 1) { toPlayer.normalize(); m.facing.lerp(toPlayer, 0.15).normalize(); }  // 转向更快：0.08 → 0.15
        m.returnTarget = -1;
      } else if (m.isInvestigating) {
        // 前往声源调查：速度也大幅提升
        m.speed = PLAYER_SPEED * 0.95;  // 199.5，接近玩家正常速度
        const dir = new Phaser.Math.Vector2(m.investigateX - m.container.x, m.investigateY - m.container.y);
        const dist = dir.length();
        if (dist < 20) {
          // 到达声源：原地徘徊
          m.investigateArrived = true;
          m.investigateLinger += delta;
          if (m.investigateLinger >= MONSTER_INVESTIGATE_LINGER) {
            m.isInvestigating = false;
            m.investigateArrived = false;
            m.investigateLinger = 0;
          }
          // 原地小幅徘徊
          m.facing.lerp(new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(), 0.05);
        } else {
          m.investigateArrived = false;
          dir.normalize();
          m.facing.lerp(dir, 0.1).normalize();  // 转向更快：0.06 → 0.1
        }
        m.returnTarget = -1;
      } else {
        // 游荡：返回随机房间
        m.speed = MONSTER_WANDER_SPEED;
        this.steerMonsterToRoom(m, delta);
      }

      // 视觉反馈
      if (m.aggro) {
        m.eye.setFillStyle(0xff2222); m.eye.setRadius(9);
        m.wisp.setFillStyle(0xff3333, 0.2);
      } else if (m.isInvestigating) {
        m.eye.setFillStyle(0xffaa22); m.eye.setRadius(8);
        m.wisp.setFillStyle(0xffaa44, 0.16);
      } else {
        m.eye.setFillStyle(0xaa0000); m.eye.setRadius(7);
        m.wisp.setFillStyle(0x9933ff, 0.12);
      }

      // 移动
      const newX = m.container.x + m.facing.x * m.speed * dt;
      const newY = m.container.y + m.facing.y * m.speed * dt;
      const moved = this.moveMonsterWithBounds(m, newX, newY);
      if (!moved.x) m.facing.x *= -1;
      if (!moved.y) m.facing.y *= -1;
      m.eye.x = m.facing.x * 10; m.eye.y = m.facing.y * 10 - 4;

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

  private steerMonsterToRoom(m: Monster, delta: number) {
    if (m.returnTarget < 0 || this.getRoomAt(m.container.x, m.container.y) === m.returnTarget) {
      const choices = [1, 2, 3, 4, 5, 6].filter(r => r !== m.returnTarget);
      m.returnTarget = Phaser.Utils.Array.GetRandom(choices);
      m.returnTimer = 0;
    }
    m.returnTimer += delta;
    if (m.returnTimer > 8000) { m.returnTarget = -1; return; }
    const room = this.rooms[m.returnTarget];
    if (!room) { m.returnTarget = -1; return; }
    const tx = room.x + room.w / 2; const ty = room.y + room.h / 2;
    const dx = tx - m.container.x; const dy = ty - m.container.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      const toTarget = new Phaser.Math.Vector2(dx / dist, dy / dist);
      m.facing.lerp(toTarget, 0.05).normalize();
    }
  }

  private moveMonsterWithBounds(m: Monster, newX: number, newY: number): { x: boolean; y: boolean } {
    const halfW = MONSTER_W / 2; const halfH = MONSTER_H / 2;
    let movedX = false, movedY = false;
    if (!this.isBlockedForMonster(newX, m.container.y, halfW, halfH, m)) { m.container.x = newX; movedX = true; }
    if (!this.isBlockedForMonster(m.container.x, newY, halfW, halfH, m)) { m.container.y = newY; movedY = true; }
    return { x: movedX, y: movedY };
  }

  private isBlockedForMonster(x: number, y: number, halfW: number, halfH: number, m?: Monster): boolean {
    const home = this.rooms[m?.homeRoom ?? -1]; const hub = this.rooms[0];
    if (home && this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, home.x, home.y, home.w, home.h)) return false;
    if (hub && this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, hub.x, hub.y, hub.w, hub.h)) return false;
    for (const corr of this.corridors) {
      if (m && corr.fromRoom !== m.homeRoom) continue;
      if (this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, corr.x, corr.y, corr.w, corr.h)) return false;
    }
    return true;
  }

  /** 视线是否被墙壁阻挡（简化：检查中点是否在房间/走廊外） */
  private lineBlockedByWall(x1: number, y1: number, x2: number, y2: number): boolean {
    const steps = 8;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const y = y1 + (y2 - y1) * t;
      if (!this.isInAnyRoom(x, y, 0, 0) && !this.isInAnyCorridor(x, y, 0, 0)) return true;
    }
    return false;
  }

  // ── Player Movement ──────────────────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    if (this.isHidden) return;
    const dt = delta / 1000;
    const sprinting = this.shiftKey.isDown;
    const crouching = this.crouchKey.isDown;
    const speed = sprinting ? PLAYER_SPRINT_SPEED : (crouching ? PLAYER_CROUCH_SPEED : PLAYER_SPEED);

    let vx = 0, vy = 0;
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) vy += 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * speed; vy = (vy / len) * speed;
      this.lastMoveDir = new Phaser.Math.Vector2(vx, vy).normalize();
    }

    // 移动产生噪音
    if (vx !== 0 || vy !== 0) {
      if (sprinting) {
        this.noiseLevel = Math.min(100, this.noiseLevel + NOISE_SPRINT_RATE * dt);
      } else if (crouching) {
        this.noiseLevel = Math.min(100, this.noiseLevel + NOISE_CROUCH_RATE * dt);
      } else {
        this.noiseLevel = Math.min(100, this.noiseLevel + NOISE_WALK_RATE * dt);
      }
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

  // ── Actions ──────────────────────────────────────────────────────────────

  private handleActions(delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.interactKey)) this.tryInteract();
    if (Phaser.Input.Keyboard.JustDown(this.mineKey)) this.placeMine();
  }

  private tryInteract() {
    // 1. 拾取陷阱
    if (!this.hasMine) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.minePickup.x, this.minePickup.y);
      if (d < MINE_PICKUP_RANGE && this.minesRemaining > 0) {
        this.hasMine = true; this.minesRemaining--;
        this.showMessage('拾取了陷阱！按 Q 放置', 1500);
        return;
      }
    }
    // 2. 拾取噪音器
    if (!this.hasNoiseMaker) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.noiseMakerPickup.x, this.noiseMakerPickup.y);
      if (d < NOISEMAKER_PICKUP_RANGE && this.noiseMakersRemaining > 0) {
        this.hasNoiseMaker = true; this.noiseMakersRemaining--;
        this.showMessage('拾取了噪音器！鼠标左键投掷', 1500);
        return;
      }
    }
    // 3. 献祭灵魂
    if (this.carrying > 0) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.depositZone.x, this.depositZone.y);
      if (d < 55) {
        this.ritualProgress += this.carrying * SOUL_PER_DEPOSIT;
        this.carrying = 0;
        this.cameras.main.flash(200, 100, 50, 255);
        this.showMessage('灵魂已献祭！仪式进度+', 1000);
        if (this.ritualProgress >= RITUAL_TOTAL) { this.win(); return; }
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

  // ── Mines (复用 RitualRoomsScene) ───────────────────────────────────────

  private placeMine() {
    if (this.isHidden) return;

    // 检查场上未爆炸的陷阱数量
    const activeMines = this.mines.filter(m => !m.exploded).length;
    if (activeMines >= 5) {
      this.showMessage(`场上陷阱已达上限 (${activeMines}/5)，等爆炸后才能放置新的`, 1500);
      return;
    }

    const container = this.add.container(this.player.x, this.player.y);
    container.setDepth(4);
    const body = this.add.circle(0, 0, 12, 0xff4400, 0.8);
    body.setStrokeStyle(2, 0xffaa00, 1);
    const blink = this.add.circle(0, 0, 4, 0xffff00, 1);
    container.add([body, blink]);
    this.tweens.add({ targets: blink, alpha: { from: 1, to: 0.2 }, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    this.mines.push({ x: this.player.x, y: this.player.y, armed: false, armTimer: MINE_ARM_TIME, sprite: container, exploded: false });
    this.showMessage(`陷阱已放置！(${activeMines + 1}/5) 0.8秒后武装`, 1200);
  }

  private updateMines(delta: number) {
    for (const mine of this.mines) {
      if (mine.exploded) continue;
      if (!mine.armed) {
        mine.armTimer -= delta;
        if (mine.armTimer <= 0) mine.armed = true;
        continue;
      }
      for (const m of this.monsters) {
        if (!m.alive || m.dying) continue;
        const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, mine.x, mine.y);
        if (d < MINE_TRIGGER_DIST) { this.detonateMine(mine); break; }
      }
    }
    this.mines = this.mines.filter(m => {
      if (m.exploded) { m.sprite.destroy(); return false; }
      return true;
    });
  }

  private detonateMine(mine: Mine) {
    mine.exploded = true;
    const blast = this.add.circle(mine.x, mine.y, MINE_RADIUS, 0xff6600, 0.4);
    blast.setStrokeStyle(4, 0xffaa00, 0.8);
    blast.setDepth(8);
    this.tweens.add({
      targets: blast, scale: { from: 0.2, to: 1 }, alpha: { from: 0.6, to: 0 },
      duration: 400, ease: 'Power2', onComplete: () => blast.destroy(),
    });
    this.cameras.main.shake(200, 0.01);
    this.cameras.main.flash(100, 255, 150, 0);

    let killed = 0;
    for (const m of this.monsters) {
      if (!m.alive || m.dying) continue;
      const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, mine.x, mine.y);
      if (d < MINE_RADIUS) { this.killMonster(m); killed++; }
    }
    if (killed > 0) {
      this.showMessage(`💣 陷阱爆炸！消灭了 ${killed} 只怪物！`, 2000);
      if (killed >= 2) this.showCombo(killed);
    }
  }

  private killMonster(m: Monster) {
    m.dying = true;
    // 掉落灵魂
    this.spawnSoul(m.container.x, m.container.y);
    this.tweens.add({
      targets: m.container, alpha: 0, scale: 0.3,
      duration: 800, onComplete: () => { m.alive = false; },
    });
  }

  // ── Noise Makers (核心新机制) ───────────────────────────────────────────

  private throwNoiseMaker(pointer: Phaser.Input.Pointer) {
    if (this.isHidden) return;

    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const dx = worldPoint.x - this.player.x;
    const dy = worldPoint.y - this.player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 30) return; // 太近不投
    const nx = dx / dist; const ny = dy / dist;
    const throwDist = Math.min(dist, 400); // 最大投掷距离
    const targetX = this.player.x + nx * throwDist;
    const targetY = this.player.y + ny * throwDist;

    const container = this.add.container(this.player.x, this.player.y);
    container.setDepth(7);
    const bell = this.add.circle(0, 0, 8, 0x66aaff, 1);
    bell.setStrokeStyle(2, 0xaaccff, 1);
    container.add(bell);

    this.noiseMakers.push({
      x: this.player.x, y: this.player.y,
      vx: nx * 600, vy: ny * 600,
      sprite: container, landed: false, landTimer: 0, pulsed: false,
    });
  }

  private updateNoiseMakers(delta: number) {
    const dt = delta / 1000;
    for (const nm of this.noiseMakers) {
      if (!nm.landed) {
        // 飞行
        nm.x += nm.vx * dt;
        nm.y += nm.vy * dt;
        nm.sprite.x = nm.x; nm.sprite.y = nm.y;
        // 减速
        nm.vx *= 0.92; nm.vy *= 0.92;
        if (Math.abs(nm.vx) < 10 && Math.abs(nm.vy) < 10) {
          nm.landed = true;
          nm.landTimer = NOISEMAKER_LAND_DELAY;
        }
        // 飞行中撞墙立即落地
        if (this.isBlockedForPlayer(nm.x, nm.y, 4)) {
          nm.landed = true;
          nm.landTimer = NOISEMAKER_LAND_DELAY;
        }
      } else if (!nm.pulsed) {
        nm.landTimer -= delta;
        if (nm.landTimer <= 0) {
          nm.pulsed = true;
          this.emitPulse(nm.x, nm.y);
          // 噪音器发声后消失
          this.tweens.add({
            targets: nm.sprite, alpha: 0, scale: 0.3,
            duration: 300, onComplete: () => nm.sprite.destroy(),
          });
        }
      }
    }
    this.noiseMakers = this.noiseMakers.filter(nm => !nm.pulsed || nm.sprite.active);
  }

  // ── Pulses (复用 EcholocationScene) ──────────────────────────────────────

  private emitPulse(x: number, y: number) {
    const ringGraphics = this.add.graphics();
    ringGraphics.setDepth(11);
    this.pulses.push({ x, y, radius: 0, maxRadius: NOISEMAKER_PULSE_RADIUS, alpha: 1, ringGraphics });

    // 惊动范围内怪物前往声源调查
    for (const m of this.monsters) {
      if (!m.alive || m.dying) continue;
      const d = Phaser.Math.Distance.Between(x, y, m.container.x, m.container.y);
      if (d < NOISEMAKER_PULSE_RADIUS) {
        m.isInvestigating = true;
        m.investigateX = x; m.investigateY = y;
        m.investigateTimer = 5000;
        m.investigateArrived = false;
        m.investigateLinger = 0;
        m.aggro = false; // 调查覆盖追击（除非再次看到玩家）
      }
    }
  }

  private updatePulses(delta: number) {
    const dt = delta / 1000;
    const expandSpeed = 600;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.radius += expandSpeed * dt;
      p.alpha = Math.max(0, 1 - p.radius / p.maxRadius);
      p.ringGraphics.clear();
      p.ringGraphics.lineStyle(4, 0x00ffcc, p.alpha);
      p.ringGraphics.strokeCircle(p.x, p.y, p.radius);
      p.ringGraphics.fillStyle(0x00ffcc, p.alpha * 0.08);
      p.ringGraphics.fillCircle(p.x, p.y, p.radius);
      if (p.alpha <= 0) {
        p.ringGraphics.destroy();
        this.pulses.splice(i, 1);
      }
    }
  }

  // ── Noise (复用 EcholocationScene) ───────────────────────────────────────

  private updateNoise(delta: number) {
    this.noiseLevel = Math.max(0, this.noiseLevel - NOISE_DECAY * (delta / 1000));
  }

  // ── Souls (战利品) ───────────────────────────────────────────────────────

  private spawnSoul(x: number, y: number) {
    const sprite = this.add.circle(x, y, 8, 0x66ffcc, 1);
    sprite.setStrokeStyle(2, 0xccffff, 0.8);
    sprite.setDepth(7);
    this.tweens.add({
      targets: sprite, scale: { from: 0.3, to: 1.2 },
      duration: 300, ease: 'Back.easeOut',
    });
    // 持续闪烁
    this.tweens.add({
      targets: sprite, alpha: { from: 1, to: 0.5 },
      duration: 500, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
    this.souls.push({ x, y, sprite, life: SOUL_LIFETIME, attracted: false });
  }

  private updateSouls(delta: number) {
    const dt = delta / 1000;
    for (const soul of this.souls) {
      soul.life -= delta;
      // 磁吸：玩家靠近时被吸引
      const d = Phaser.Math.Distance.Between(soul.x, soul.y, this.player.x, this.player.y);
      if (d < SOUL_PICKUP_RANGE_MAGNET) {
        soul.attracted = true;
      }
      if (soul.attracted && !this.isHidden) {
        const dir = new Phaser.Math.Vector2(this.player.x - soul.x, this.player.y - soul.y);
        const dist = dir.length();
        if (dist > 1) {
          dir.normalize();
          const pullSpeed = 200 + (1 - dist / SOUL_PICKUP_RANGE_MAGNET) * 200;
          soul.x += dir.x * pullSpeed * dt;
          soul.y += dir.y * pullSpeed * dt;
          soul.sprite.x = soul.x; soul.sprite.y = soul.y;
        }
      }
      // 自动拾取
      if (d < SOUL_PICKUP_RANGE) {
        soul.life = 0;
        this.carrying++;
        this.cameras.main.flash(80, 100, 255, 200);
      }
      // 衰减消失
      if (soul.life <= 0) {
        soul.sprite.destroy();
      }
    }
    this.souls = this.souls.filter(s => s.life > 0);
  }

  // ── Combo ────────────────────────────────────────────────────────────────

  private showCombo(count: number) {
    this.comboText.setText(`×${count} COMBO!`);
    this.comboText.setVisible(true);
    this.comboText.setScale(0);
    this.tweens.add({
      targets: this.comboText,
      scale: { from: 0, to: 1.3 }, duration: 200, ease: 'Back.easeOut',
      yoyo: true, hold: 400,
      onComplete: () => this.comboText.setVisible(false),
    });
  }

  // ── Spawning ─────────────────────────────────────────────────────────────

  private updateSpawning(delta: number) {
    const aliveCount = this.monsters.filter(m => m.alive && !m.dying).length;
    if (aliveCount === 0) {
      this.guaranteeSpawnTimer += delta;
      if (this.guaranteeSpawnTimer >= GUARANTEE_SPAWN_INTERVAL) {
        this.guaranteeSpawnTimer = 0;
        const roomIds = [1, 2, 3, 4, 5, 6];
        Phaser.Utils.Array.Shuffle(roomIds);
        const count = Math.min(GUARANTEE_SPAWN_COUNT, MAX_MONSTERS);
        for (let j = 0; j < count; j++) this.spawnMonster(roomIds[j]);
        this.showMessage('黑暗中传来脚步声……新的怪物出现了！', 2000);
      }
    } else {
      this.guaranteeSpawnTimer = 0;
    }

    // 仪式进度越高，偶尔补刷（最多 MAX_MONSTERS）
    if (aliveCount < MAX_MONSTERS && Math.random() < 0.0008 * (1 + this.ritualProgress / RITUAL_TOTAL * 2)) {
      const roomIds = [1, 2, 3, 4, 5, 6];
      const pick = Phaser.Utils.Array.GetRandom(roomIds);
      if (!this.monsters.some(m => m.alive && !m.dying && m.homeRoom === pick)) {
        this.spawnMonster(pick);
      }
    }
  }

  // ── Vision Overlay (复用 RitualRoomsScene) ───────────────────────────────

  private createVisionOverlay() {
    const overlaySize = 1000;
    const texKey = 'trapHunterVisionOverlay';
    if (!this.textures.exists(texKey)) {
      const vc = this.textures.createCanvas(texKey, overlaySize, overlaySize);
      if (vc) {
        const ctx = vc.getContext();
        const c = overlaySize / 2;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
        ctx.fillRect(0, 0, overlaySize, overlaySize);
        ctx.globalCompositeOperation = 'destination-out';
        const grad = ctx.createRadialGradient(c, c, 0, c, c, this.visionRadius);
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

    // 动态视野：附近有怪物时收缩
    let minDist = Infinity;
    for (const m of this.monsters) {
      if (!m.alive || m.dying) continue;
      const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, this.player.x, this.player.y);
      if (d < minDist) minDist = d;
    }
    const targetRadius = minDist < 300 ? Math.max(150, minDist * 0.8) : 400;
    this.visionRadius = Phaser.Math.Linear(this.visionRadius, targetRadius, 0.05);
  }

  // ── Audio ────────────────────────────────────────────────────────────────

  private updateCryingVolume() {
    if (!this.cryingSound || !this.cryingSound.isPlaying) return;
    let minDist = Infinity;
    let anyAggro = false;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, this.player.x, this.player.y);
      if (d < minDist) minDist = d;
      if (m.aggro) anyAggro = true;
    }
    const maxRange = 800;
    const vol = minDist < maxRange ? (1 - minDist / maxRange) * (anyAggro ? 0.9 : 0.4) : 0;
    (this.cryingSound as any).setVolume(vol);
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  private createUI() {
    this.ritualText = this.add.text(16, 16, '仪式进度: 0/' + RITUAL_TOTAL, { fontSize: '18px', color: '#44ddff' }).setScrollFactor(0).setDepth(20);
    this.carryText = this.add.text(16, 40, '携带灵魂: 0', { fontSize: '18px', color: '#66ffcc' }).setScrollFactor(0).setDepth(20);
    this.mineText = this.add.text(16, 64, '陷阱: 未携带', { fontSize: '16px', color: '#ffaa66' }).setScrollFactor(0).setDepth(20);
    this.noiseMakerText = this.add.text(16, 84, '噪音器: 未携带', { fontSize: '16px', color: '#aaccff' }).setScrollFactor(0).setDepth(20);
    this.noiseText = this.add.text(16, 104, '噪音: 0', { fontSize: '14px', color: '#888888' }).setScrollFactor(0).setDepth(20);
    this.crouchText = this.add.text(16, 124, '', { fontSize: '14px', color: '#88ff88' }).setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 540, '', {
      fontSize: '20px', color: '#ffffff', align: 'center',
      backgroundColor: '#000000', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);

    this.comboText = this.add.text(400, 250, '', {
      fontSize: '48px', color: '#ffcc00', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21).setVisible(false);

    const backBtn = this.add.text(680, 16, '← 菜单', {
      fontSize: '18px', color: '#ffffff', backgroundColor: '#333333', padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);
    backBtn.on('pointerdown', () => {
      if (this.cryingSound) this.cryingSound.stop();
      this.scene.start('MenuScene');
    });

    this.add.text(400, 575, 'WASD移动 Shift冲刺(大噪音) C蹲伏(小噪音) Q放陷阱 鼠标投噪音器 E拾取/献祭/躲藏', {
      fontSize: '12px', color: '#666666',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
  }

  private updateUI() {
    this.ritualText.setText(`仪式进度: ${Math.ceil(this.ritualProgress)}/${RITUAL_TOTAL}`);
    this.carryText.setText(`携带灵魂: ${this.carrying}`);
    const activeMines = this.mines.filter(m => !m.exploded).length;
    this.mineText.setText(`陷阱: ${activeMines}/5`);
    this.noiseMakerText.setText('噪音器: 无限');
    const noisePct = Math.ceil(this.noiseLevel);
    this.noiseText.setText(`噪音: ${noisePct}`);
    this.noiseText.setColor(noisePct > 60 ? '#ff4444' : (noisePct > 30 ? '#ffff44' : '#888888'));
    
    // 显示蹲伏状态
    if (this.crouchKey.isDown) {
      this.crouchText.setText('蹲伏中');
      this.crouchText.setColor('#88ff88');
    } else {
      this.crouchText.setText('');
    }
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
    this.updateNoiseMakers(delta);
    this.updatePulses(delta);
    this.updateNoise(delta);
    this.updateMonsters(delta);
    this.updateMines(delta);
    this.updateSouls(delta);
    this.updateSpawning(delta);
    this.updateUI();
    this.updateCryingVolume();
    this.updateVisionOverlay();
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
    this.tweens.add({ targets: jumpscare, scale: coverScale, duration: 120, ease: 'Back.easeOut' });
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

  private isInAnyRoom(x: number, y: number, halfW: number, halfH: number): boolean {
    for (const room of this.rooms) {
      if (x - halfW < room.x + room.w && x + halfW > room.x &&
          y - halfH < room.y + room.h && y + halfH > room.y) return true;
    }
    return false;
  }

  private isInAnyCorridor(x: number, y: number, halfW: number, halfH: number): boolean {
    for (const corr of this.corridors) {
      if (x - halfW < corr.x + corr.w && x + halfW > corr.x &&
          y - halfH < corr.y + corr.h && y + halfH > corr.y) return true;
    }
    return false;
  }

  private getRoomAt(x: number, y: number): number {
    for (const room of this.rooms) {
      if (x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h) return room.id;
    }
    return -1;
  }

  private rectOverlap(x1: number, y1: number, w1: number, h1: number, x2: number, y2: number, w2: number, h2: number): boolean {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }
}
