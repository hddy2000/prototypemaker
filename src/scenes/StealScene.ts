import Phaser from 'phaser';

// ── 绕背偷 (Steal From Behind) ───────────────────────────────────────────
// 核心机制（差异化验证）：
//   - 怪物身上携带"残秽"，玩家必须绕到怪物背后盲区才能偷取
//   - 怪物有视野锥（前方），锥内远端=警觉转身，锥内近端=追击
//   - 追击时怪物比玩家慢，但不会脱战（一直追到玩家躲藏或丢视野）
//   - 偷取有概率惊动怪物（偷越多越容易惊动）
//   - 怪物攻击有前摇（0.6秒），前摇期间可躲柜子/绕背/拉开距离
//   - 偷到的残秽搬回中央祭坛投喂，完成仪式即胜
// 地形：中央祭坛房间 + 周围6个房间，通过走廊连接，每房间有躲藏点

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

interface HideSpot {
  x: number; y: number; w: number; h: number;
  kind: 'locker' | 'table';
  roomId: number;
  occupied: boolean;
}

type MonsterState = 'wander' | 'alert' | 'chase' | 'attack';

interface Monster {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  eye: Phaser.GameObjects.Arc;
  wisp: Phaser.GameObjects.Arc;
  cone: Phaser.GameObjects.Graphics;   // 视野锥可视化
  facingArrow: Phaser.GameObjects.Triangle;  // 朝向箭头
  facing: Phaser.Math.Vector2;
  speed: number;
  alive: boolean;
  roomId: number;
  homeRoom: number;
  dying: boolean;
  state: MonsterState;
  stateTimer: number;          // 当前状态计时
  wanderTimer: number;         // 游荡换向计时
  returnTarget: number;        // 返回目标房间
  returnTimer: number;
  pollution: number;           // ★ 怪物身上携带的残秽量
  pollutionMax: number;
  attackWindup: number;        // 攻击前摇倒计时
  alertTurnTimer: number;      // 警觉时转身计时
  lastSeenPlayer: number;      // 最后一次看到玩家的时间戳
}

// ── Constants ──────────────────────────────────────────────────────────────

const HUB_W = 280;
const HUB_H = 240;
const ROOM_W = 220;
const ROOM_H = 180;
const CORR_W = 40;
// const CORR_LEN = 80;
const MAP_CX = 750;
const MAP_CY = 560;

const PLAYER_SPEED = 210;
const PLAYER_CARRY_SPEED = 175;
const PLAYER_SIZE = 22;

// ★ 怪物：追击比玩家慢，游荡更慢
const MONSTER_W = 56;
const MONSTER_H = 80;
const MONSTER_CHASE_SPEED = PLAYER_SPEED * 0.88;   // ★ 追击比玩家慢（玩家能跑赢直线）
const MONSTER_ALERT_SPEED = PLAYER_SPEED * 0.5;    // 警觉转身时中速
const MONSTER_WANDER_SPEED = PLAYER_SPEED * 0.32;  // 游荡慢速

// ★ 视野锥参数
const CONE_HALF_ANGLE = 40;        // 视野半角（总 80°，窄视野更易绕背）
const CONE_VISION_RANGE = 200;     // 视野距离（缩短，不会很远就发现）
const CONE_ALERT_RANGE = 280;      // 远端警觉范围（锥内但超出 vision）
const STEAL_RANGE = 75;            // 偷取距离（加大，更容易够到）
const STEAL_BLIND_HALF_ANGLE = 80; // 盲区半角（背后 160° 可偷，更宽容）

// ★ 攻击前摇
const ATTACK_WINDUP_TIME = 600;    // 0.6秒前摇
const ATTACK_RANGE = 36;           // 攻击判定距离

// 残秽 / 仪式
const MONSTER_POLLUTION_MAX = 30;  // 每只怪物携带 30 残秽
const STEAL_RATE = 0.05;           // 每ms偷取量（约 50/秒）
const STEAL_STARTLE_BASE = 0.02;   // 每次偷取基础惊动概率
const CARRY_CAPACITY = 10;
const RITUAL_TOTAL = 200;          // 仪式总进度（偷 7 只怪左右）
// const FUEL_DRAIN_RATE = 0;         // 本原型不设燃料压力，专注偷取体验

// 地雷（保留作为工具）
// const MINE_TOTAL = 99;
const MINE_PICKUP_RANGE = 35;
const MINE_RADIUS = 120;
const MINE_ARM_TIME = 800;
const MINE_TRIGGER_DIST = 40;

// ── Scene ──────────────────────────────────────────────────────────────────

export class StealScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private mineKey!: Phaser.Input.Keyboard.Key;

  private rooms: RoomDef[] = [];
  private corridors: CorridorDef[] = [];
  private hideSpots: HideSpot[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  private monsters: Monster[] = [];

  private carrying = 0;
  private isHidden = false;
  private hiddenSpot: HideSpot | null = null;
  private stealTarget: Monster | null = null;   // 当前正在偷的怪物
  private stealFlash: Phaser.GameObjects.Arc | null = null;

  private mines: any[] = [];
  private hasMine = false;
  private minePickup!: Phaser.GameObjects.Container;

  private depositZone!: Phaser.GameObjects.Container;

  private ritualProgress = 0;
  private isDead = false;
  private isWon = false;

  private cryingSound!: Phaser.Sound.BaseSound;
  private screamSound!: Phaser.Sound.BaseSound;

  private visionOverlay!: Phaser.GameObjects.Image;

  private ritualText!: Phaser.GameObjects.Text;
  private carryText!: Phaser.GameObjects.Text;
  private stateText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private messageTimer: number | null = null;
  private hintBar!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'StealScene' });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  create() {
    // Reset
    this.rooms = []; this.corridors = []; this.hideSpots = []; this.monsters = [];
    this.carrying = 0; this.isHidden = false; this.hiddenSpot = null;
    this.stealTarget = null; this.mines = []; this.hasMine = false;
    this.ritualProgress = 0;
    this.isDead = false; this.isWon = false;

    this.buildRooms();
    this.drawMap();
    this.createDepositZone();
    this.createMinePickup();
    this.createPlayer();
    this.createUI();
    this.setupInput();

    // 初始 3 只怪物
    this.spawnMonster(1);
    this.spawnMonster(3);
    this.spawnMonster(5);

    this.cryingSound = this.sound.add('crying', { loop: true, volume: 0 });
    this.cryingSound.play();
    this.screamSound = this.sound.add('scream', { volume: 1 });

    this.createVisionOverlay();

    const totalW = this.getMapWidth();
    const totalH = this.getMapHeight();
    this.cameras.main.setBounds(0, 0, totalW, totalH);
    this.cameras.main.setBackgroundColor('#08080e');
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('绕到怪物背后按住空格偷取残秽！偷完搬回祭坛！', 4000);
  }

  // ── Map Building ─────────────────────────────────────────────────────────

  private getMapWidth(): number { return 2400; }
  private getMapHeight(): number { return 1800; }

  private buildRooms() {
    const hubX = MAP_CX - HUB_W / 2;
    const hubY = MAP_CY - HUB_H / 2;
    this.rooms.push({ id: 0, x: hubX, y: hubY, w: HUB_W, h: HUB_H, name: '祭坛', isHub: true });

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
      this.rooms.push({ id: i + 1, x: cx - ROOM_W / 2, y: cy - ROOM_H / 2, w: ROOM_W, h: ROOM_H, name: outerRooms[i].name, isHub: false });
    }

    for (let i = 1; i <= 6; i++) {
      const room = this.rooms[i];
      const hub = this.rooms[0];
      const roomCX = room.x + room.w / 2;
      const roomCY = room.y + room.h / 2;
      const hubCX = hub.x + hub.w / 2;
      const hubCY = hub.y + hub.h / 2;
      const dx = hubCX - roomCX; const dy = hubCY - roomCY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / dist; const ny = dy / dist;
      const startX = roomCX + nx * (room.w / 2);
      const startY = roomCY + ny * (room.h / 2);
      const endX = hubCX - nx * (hub.w / 2);
      const endY = hubCY - ny * (hub.h / 2);
      const hMinX = Math.min(startX, endX) - CORR_W / 2;
      const hMaxX = Math.max(startX, endX) + CORR_W / 2;
      this.corridors.push({ x: hMinX, y: startY - CORR_W / 2, w: hMaxX - hMinX, h: CORR_W, fromRoom: i, toRoom: 0 });
      const vMinY = Math.min(startY, endY) - CORR_W / 2;
      const vMaxY = Math.max(startY, endY) + CORR_W / 2;
      this.corridors.push({ x: endX - CORR_W / 2, y: vMinY, w: CORR_W, h: vMaxY - vMinY, fromRoom: i, toRoom: 0 });
    }

    for (let i = 1; i <= 6; i++) {
      const room = this.rooms[i];
      const rx = room.x; const ry = room.y;
      this.hideSpots.push({ x: rx + 20, y: ry + 20, w: 60, h: 60, kind: 'locker', roomId: i, occupied: false });
      this.hideSpots.push({ x: rx + room.w - 80, y: ry + 20, w: 60, h: 60, kind: 'locker', roomId: i, occupied: false });
      this.hideSpots.push({ x: rx + 20, y: ry + room.h - 80, w: 70, h: 50, kind: 'table', roomId: i, occupied: false });
      this.hideSpots.push({ x: rx + room.w - 90, y: ry + room.h - 80, w: 70, h: 50, kind: 'table', roomId: i, occupied: false });
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
    const hubCX = hub.x + hub.w / 2;
    const hubCY = hub.y + hub.h / 2;
    this.mapGraphics.lineStyle(2, 0x4a2a6a, 0.4);
    this.mapGraphics.strokeCircle(hubCX, hubCY, 80);
    this.mapGraphics.strokeCircle(hubCX, hubCY, 50);
    for (let i = 0; i < 5; i++) {
      const a1 = Phaser.Math.DegToRad(i * 72 - 90);
      const a2 = Phaser.Math.DegToRad(((i + 2) % 5) * 72 - 90);
      this.mapGraphics.beginPath();
      this.mapGraphics.moveTo(hubCX + Math.cos(a1) * 50, hubCY + Math.sin(a1) * 50);
      this.mapGraphics.lineTo(hubCX + Math.cos(a2) * 50, hubCY + Math.sin(a2) * 50);
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

  // ── Deposit Zone ─────────────────────────────────────────────────────────

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
    this.tweens.add({ targets: ring, scale: { from: 0.85, to: 1.15 }, duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.depositZone = container;
  }

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

    const eye = this.add.circle(0, -8, 7, 0xffaa00);
    const wisp = this.add.circle(0, 0, MONSTER_W * 0.8, 0x9933ff, 0.12);
    const cone = this.add.graphics();
    cone.setDepth(5);
    // 朝向箭头（怪物前方醒目三角形）
    const facingArrow = this.add.triangle(0, 0, -8, -6, -8, 6, 12, 0, 0xff4444);
    facingArrow.setAlpha(0.85);
    container.add([wisp, cone, body, eye, facingArrow]);

    this.tweens.add({
      targets: [body, eye],
      scaleX: { from: scale, to: scale * 1.06 }, scaleY: { from: scale, to: scale * 0.96 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });
    container.setScale(0);
    this.tweens.add({ targets: container, scale: { from: 0, to: 1 }, duration: 400, ease: 'Back.easeOut' });

    this.monsters.push({
      container, body, eye, wisp, cone, facingArrow,
      facing: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), 0).normalize(),
      speed: MONSTER_WANDER_SPEED, alive: true,
      roomId, homeRoom: roomId, dying: false,
      state: 'wander', stateTimer: 0, wanderTimer: 0,
      returnTarget: -1, returnTimer: 0,
      pollution: MONSTER_POLLUTION_MAX, pollutionMax: MONSTER_POLLUTION_MAX,
      attackWindup: 0, alertTurnTimer: 0, lastSeenPlayer: 0,
    });
  }

  // ★ 核心：视野锥检测
  private isInCone(m: Monster, targetX: number, targetY: number, range: number): boolean {
    const dx = targetX - m.container.x;
    const dy = targetY - m.container.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > range) return false;
    if (dist < 1) return true;
    const toTarget = new Phaser.Math.Vector2(dx / dist, dy / dist);
    const dot = m.facing.dot(toTarget);
    const angle = Math.acos(Phaser.Math.Clamp(dot, -1, 1)) * 180 / Math.PI;
    return angle < CONE_HALF_ANGLE;
  }

  // ★ 是否在盲区（背后）
  private isInBlindSpot(m: Monster, targetX: number, targetY: number): boolean {
    const dx = targetX - m.container.x;
    const dy = targetY - m.container.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > STEAL_RANGE) return false;
    if (dist < 1) return true;
    const toTarget = new Phaser.Math.Vector2(dx / dist, dy / dist);
    const dot = m.facing.dot(toTarget);
    const angle = Math.acos(Phaser.Math.Clamp(dot, -1, 1)) * 180 / Math.PI;
    // 背后 140°
    return angle > (180 - STEAL_BLIND_HALF_ANGLE);
  }

  private updateMonsters(delta: number) {
    const dt = delta / 1000;
    const now = this.time.now;

    for (const m of this.monsters) {
      if (!m.alive || m.dying) continue;

      const px = this.player.x;
      const py = this.player.y;
      const distToPlayer = Phaser.Math.Distance.Between(m.container.x, m.container.y, px, py);

      // ── 状态机 ──────────────────────────────────────
      if (this.isHidden) {
        // 玩家躲藏：怪物失去目标，回到游荡
        if (m.state === 'chase' || m.state === 'alert' || m.state === 'attack') {
          m.state = 'wander';
          m.stateTimer = 0;
        }
      } else {
        const inVision = this.isInCone(m, px, py, CONE_VISION_RANGE);
        const inAlert = this.isInCone(m, px, py, CONE_ALERT_RANGE);

        if (m.state === 'attack') {
          // 攻击前摇中，不切换
          m.attackWindup -= delta;
          if (m.attackWindup <= 0) {
            // 判定
            const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, px, py);
            if (d < ATTACK_RANGE) {
              this.die('被怪物抓住——撕成碎片！');
              return;
            }
            // 没抓到，回到追击
            m.state = 'chase';
            m.stateTimer = 0;
          }
        } else if (inVision && distToPlayer < CONE_VISION_RANGE) {
          // 视野内近端 → 追击
          m.lastSeenPlayer = now;
          if (m.state !== 'chase') {
            m.state = 'chase';
            m.stateTimer = 0;
          }
          // 近身 → 攻击前摇
          if (distToPlayer < ATTACK_RANGE + 10) {
            m.state = 'attack';
            m.attackWindup = ATTACK_WINDUP_TIME;
          }
        } else if (inAlert && distToPlayer < CONE_ALERT_RANGE) {
          // 视野锥远端 → 警觉转身
          if (m.state !== 'alert') {
            m.state = 'alert';
            m.stateTimer = 0;
            m.alertTurnTimer = 1500; // 警觉 1.5 秒
          }
        } else {
          // 不在视野内
          if (m.state === 'chase') {
            // 追击中丢失视野：再追 2 秒（记忆）
            if (now - m.lastSeenPlayer > 2000) {
              m.state = 'wander';
              m.stateTimer = 0;
            }
          } else if (m.state === 'alert') {
            m.alertTurnTimer -= delta;
            if (m.alertTurnTimer <= 0) {
              m.state = 'wander';
              m.stateTimer = 0;
            }
          }
        }
      }

      m.stateTimer += delta;

      // ── 行为 ──────────────────────────────────────
      const toPlayer = new Phaser.Math.Vector2(px - m.container.x, py - m.container.y);
      const dist = toPlayer.length();

      switch (m.state) {
        case 'chase': {
          m.speed = MONSTER_CHASE_SPEED;
          if (dist > 1) { toPlayer.normalize(); m.facing.lerp(toPlayer, 0.12).normalize(); }
          m.returnTarget = -1;
          break;
        }
        case 'attack': {
          m.speed = 0;
          // 攻击前摇时面向玩家
          if (dist > 1) { toPlayer.normalize(); m.facing.lerp(toPlayer, 0.2).normalize(); }
          break;
        }
        case 'alert': {
          m.speed = MONSTER_ALERT_SPEED;
          // 警觉时缓慢转向玩家方向
          if (dist > 1) { toPlayer.normalize(); m.facing.lerp(toPlayer, 0.04).normalize(); }
          break;
        }
        case 'wander':
        default: {
          m.speed = MONSTER_WANDER_SPEED;
          this.steerMonsterToRoom(m, delta);
          break;
        }
      }

      // 移动
      if (m.speed > 0) {
        let newX = m.container.x + m.facing.x * m.speed * dt;
        let newY = m.container.y + m.facing.y * m.speed * dt;
        const moved = this.moveMonsterWithBounds(m, newX, newY);
        if (!moved.x) m.facing.x *= -1;
        if (!moved.y) m.facing.y *= -1;
      }

      m.eye.x = m.facing.x * 10;
      m.eye.y = m.facing.y * 10 - 4;
      // 朝向箭头：放在怪物前方边缘，旋转到 facing 方向
      const faceAngle = Math.atan2(m.facing.y, m.facing.x);
      m.facingArrow.setRotation(faceAngle);
      m.facingArrow.setPosition(m.facing.x * (MONSTER_W * 0.55), m.facing.y * (MONSTER_W * 0.55));
      // 状态颜色
      const arrowColor = m.state === 'chase' ? 0xff0000 :
                         m.state === 'attack' ? 0xff0000 :
                         m.state === 'alert' ? 0xffaa00 : 0xff4444;
      m.facingArrow.setFillStyle(arrowColor, 0.85);
      m.roomId = this.getRoomAt(m.container.x, m.container.y);

      // 视觉反馈
      this.updateMonsterVisual(m);

      // 绘制视野锥
      this.drawCone(m);
    }

    this.monsters = this.monsters.filter(m => {
      if (!m.alive) { m.container.destroy(); return false; }
      return true;
    });
  }

  private updateMonsterVisual(m: Monster) {
    switch (m.state) {
      case 'chase':
        m.eye.setFillStyle(0xff2222);
        m.eye.setRadius(9);
        m.wisp.setFillStyle(0xff3333, 0.25);
        break;
      case 'attack':
        m.eye.setFillStyle(0xffffff);
        m.eye.setRadius(11);
        m.wisp.setFillStyle(0xff0000, 0.4);
        break;
      case 'alert':
        m.eye.setFillStyle(0xffaa00);
        m.eye.setRadius(8);
        m.wisp.setFillStyle(0xffaa00, 0.2);
        break;
      case 'wander':
      default:
        m.eye.setFillStyle(0xffaa00);
        m.eye.setRadius(7);
        m.wisp.setFillStyle(0x9933ff, 0.12);
        break;
    }
  }

  // ★ 绘制视野锥
  private drawCone(m: Monster) {
    m.cone.clear();
    const angle = Math.atan2(m.facing.y, m.facing.x);
    const color = m.state === 'chase' ? 0xff3333 :
                  m.state === 'attack' ? 0xff0000 :
                  m.state === 'alert' ? 0xffaa00 : 0x6a6a8a;
    const alpha = m.state === 'wander' ? 0.06 :
                  m.state === 'alert' ? 0.12 :
                  m.state === 'chase' ? 0.15 : 0.25;

    // 近端视野（实心）
    m.cone.fillStyle(color, alpha);
    m.cone.beginPath();
    m.cone.moveTo(m.container.x, m.container.y);
    m.cone.arc(m.container.x, m.container.y, CONE_VISION_RANGE, angle - Phaser.Math.DegToRad(CONE_HALF_ANGLE), angle + Phaser.Math.DegToRad(CONE_HALF_ANGLE), false);
    m.cone.lineTo(m.container.x, m.container.y);
    m.cone.fillPath();

    // 远端警觉区（更淡）
    m.cone.fillStyle(color, alpha * 0.4);
    m.cone.beginPath();
    m.cone.moveTo(m.container.x, m.container.y);
    m.cone.arc(m.container.x, m.container.y, CONE_ALERT_RANGE, angle - Phaser.Math.DegToRad(CONE_HALF_ANGLE), angle + Phaser.Math.DegToRad(CONE_HALF_ANGLE), false);
    m.cone.arc(m.container.x, m.container.y, CONE_VISION_RANGE, angle + Phaser.Math.DegToRad(CONE_HALF_ANGLE), angle - Phaser.Math.DegToRad(CONE_HALF_ANGLE), true);
    m.cone.fillPath();

    // 盲区提示（背后扇形填充 + 边线）
    m.cone.fillStyle(0x44ff44, 0.08);
    m.cone.beginPath();
    m.cone.moveTo(m.container.x, m.container.y);
    m.cone.arc(m.container.x, m.container.y, STEAL_RANGE,
      angle + Math.PI - Phaser.Math.DegToRad(STEAL_BLIND_HALF_ANGLE),
      angle + Math.PI + Phaser.Math.DegToRad(STEAL_BLIND_HALF_ANGLE), false);
    m.cone.lineTo(m.container.x, m.container.y);
    m.cone.fillPath();
    m.cone.lineStyle(2, 0x44ff44, 0.35);
    m.cone.beginPath();
    m.cone.moveTo(m.container.x, m.container.y);
    m.cone.lineTo(m.container.x + Math.cos(angle + Math.PI - Phaser.Math.DegToRad(STEAL_BLIND_HALF_ANGLE)) * STEAL_RANGE,
                  m.container.y + Math.sin(angle + Math.PI - Phaser.Math.DegToRad(STEAL_BLIND_HALF_ANGLE)) * STEAL_RANGE);
    m.cone.moveTo(m.container.x, m.container.y);
    m.cone.lineTo(m.container.x + Math.cos(angle + Math.PI + Phaser.Math.DegToRad(STEAL_BLIND_HALF_ANGLE)) * STEAL_RANGE,
                  m.container.y + Math.sin(angle + Math.PI + Phaser.Math.DegToRad(STEAL_BLIND_HALF_ANGLE)) * STEAL_RANGE);
    m.cone.strokePath();
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
    const tx = room.x + room.w / 2;
    const ty = room.y + room.h / 2;
    const dx = tx - m.container.x;
    const dy = ty - m.container.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      const toTarget = new Phaser.Math.Vector2(dx / dist, dy / dist);
      m.facing.lerp(toTarget, 0.02).normalize();
    }
  }

  private moveMonsterWithBounds(m: Monster, newX: number, newY: number): { x: boolean; y: boolean } {
    const halfW = MONSTER_W / 2;
    const halfH = MONSTER_H / 2;
    let movedX = false, movedY = false;
    if (!this.isBlockedForMonster(newX, m.container.y, halfW, halfH, m)) { m.container.x = newX; movedX = true; }
    if (!this.isBlockedForMonster(m.container.x, newY, halfW, halfH, m)) { m.container.y = newY; movedY = true; }
    return { x: movedX, y: movedY };
  }

  private isBlockedForMonster(x: number, y: number, halfW: number, halfH: number, m?: Monster): boolean {
    const home = this.rooms[m?.homeRoom ?? -1];
    const hub = this.rooms[0];
    if (home && this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, home.x, home.y, home.w, home.h)) return false;
    if (hub && this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, hub.x, hub.y, hub.w, hub.h)) return false;
    for (const corr of this.corridors) {
      if (m && corr.fromRoom !== m.homeRoom) continue;
      if (this.rectOverlap(x - halfW, y - halfH, halfW * 2, halfH * 2, corr.x, corr.y, corr.w, corr.h)) return false;
    }
    return true;
  }

  // ── Steal (核心) ─────────────────────────────────────────────────────────

  private trySteal(delta: number) {
    if (this.isHidden) { this.stealTarget = null; return; }
    if (this.carrying >= CARRY_CAPACITY) {
      this.stealTarget = null;
      return;
    }

    // 找最近的可偷怪物（在盲区 + 在偷取距离内）
    let target: Monster | null = null;
    let minD = STEAL_RANGE;
    for (const m of this.monsters) {
      if (!m.alive || m.dying) continue;
      if (m.pollution <= 0) continue;
      if (!this.isInBlindSpot(m, this.player.x, this.player.y)) continue;
      const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, this.player.x, this.player.y);
      if (d < minD) { minD = d; target = m; }
    }

    if (target) {
      this.stealTarget = target;
      const stealAmt = Math.min(STEAL_RATE * delta, target.pollution);
      target.pollution -= stealAmt;
      this.carrying = Math.min(CARRY_CAPACITY, this.carrying + stealAmt);

      // 偷取特效
      if (!this.stealFlash) {
        this.stealFlash = this.add.circle(this.player.x, this.player.y, 20, 0x44ff88, 0.4);
        this.stealFlash.setDepth(7);
      }
      this.stealFlash.setPosition(this.player.x, this.player.y);
      this.stealFlash.setVisible(true);
      this.stealFlash.setAlpha(0.4 + Math.sin(this.time.now / 80) * 0.2);

      // ★ 偷取惊动概率：偷得越多越容易惊动
      const stealRatio = 1 - (target.pollution / target.pollutionMax);
      const startleChance = STEAL_STARTLE_BASE * (1 + stealRatio * 4) * (delta / 1000);
      if (Math.random() < startleChance) {
        // 惊动！怪物进入警觉
        target.state = 'alert';
        target.stateTimer = 0;
        target.alertTurnTimer = 2000;
        this.showMessage('！怪物似乎察觉到了什么……', 1200);
      }

      // 偷光了
      if (target.pollution <= 0) {
        this.showMessage('这只怪物的残秽被偷光了！换一只吧', 1500);
        this.stealTarget = null;
      }
    } else {
      this.stealTarget = null;
      if (this.stealFlash) this.stealFlash.setVisible(false);
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  private handleActions(delta: number) {
    if (this.spaceKey.isDown && !this.isHidden) {
      this.trySteal(delta);
    } else {
      this.stealTarget = null;
      if (this.stealFlash) this.stealFlash.setVisible(false);
    }
    if (Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.tryInteract();
    }
    if (Phaser.Input.Keyboard.JustDown(this.mineKey)) {
      this.placeMine();
    }
  }

  private tryInteract() {
    // 拾取地雷
    if (!this.hasMine) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.minePickup.x, this.minePickup.y);
      if (d < MINE_PICKUP_RANGE) {
        this.hasMine = true;
        this.showMessage('拾取了地雷！按 Q 放置', 1500);
        return;
      }
    }
    // 投喂
    if (this.carrying > 0) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.depositZone.x, this.depositZone.y);
      if (d < 55) {
        this.ritualProgress += this.carrying * 10;
        this.carrying = 0;
        this.cameras.main.flash(200, 100, 50, 255);
        this.showMessage('残秽已献祭！仪式进度+', 1000);
        if (this.ritualProgress >= RITUAL_TOTAL) { this.win(); return; }
        return;
      }
    }
    // 躲藏
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
    this.showMessage('躲藏中！怪物失去你的踪迹。再按 E 离开', 2000);
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
    if (!this.hasMine) { this.showMessage('没有地雷！去祭坛旁按 E 拾取', 1500); return; }
    if (this.isHidden) return;
    const container = this.add.container(this.player.x, this.player.y);
    container.setDepth(4);
    const body = this.add.circle(0, 0, 12, 0xff4400, 0.8);
    body.setStrokeStyle(2, 0xffaa00, 1);
    const blink = this.add.circle(0, 0, 4, 0xffff00, 1);
    container.add([body, blink]);
    this.tweens.add({ targets: blink, alpha: { from: 1, to: 0.2 }, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.mines.push({ x: this.player.x, y: this.player.y, armed: false, armTimer: MINE_ARM_TIME, sprite: container, exploded: false });
    this.hasMine = false;
    this.showMessage('地雷已放置！0.8秒后武装', 1200);
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
    this.mines = this.mines.filter(m => { if (m.exploded) { m.sprite.destroy(); return false; } return true; });
  }

  private detonateMine(mine: any) {
    mine.exploded = true;
    const blast = this.add.circle(mine.x, mine.y, MINE_RADIUS, 0xff6600, 0.4);
    blast.setStrokeStyle(4, 0xffaa00, 0.8);
    blast.setDepth(8);
    this.tweens.add({ targets: blast, scale: { from: 0.2, to: 1 }, alpha: { from: 0.6, to: 0 }, duration: 400, ease: 'Power2', onComplete: () => blast.destroy() });
    this.cameras.main.shake(200, 0.01);
    this.cameras.main.flash(100, 255, 150, 0);
    let killed = 0;
    for (const m of this.monsters) {
      if (!m.alive || m.dying) continue;
      const d = Phaser.Math.Distance.Between(m.container.x, m.container.y, mine.x, mine.y);
      if (d < MINE_RADIUS) { this.killMonster(m); killed++; }
    }
    if (killed > 0) this.showMessage(`💣 地雷爆炸！消灭了 ${killed} 只怪物！`, 2000);
  }

  private killMonster(m: Monster) {
    m.dying = true;
    this.tweens.add({ targets: m.container, alpha: 0, scale: 0.3, duration: 800, onComplete: () => { m.alive = false; } });
  }

  // ── Player Movement ──────────────────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    if (this.isHidden) return;
    let speed = PLAYER_SPEED;
    if (this.carrying > 0) speed = PLAYER_CARRY_SPEED;
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
    for (const room of this.rooms) {
      if (this.rectOverlap(x - half, y - half, half * 2, half * 2, room.x, room.y, room.w, room.h)) return false;
    }
    for (const corr of this.corridors) {
      if (this.rectOverlap(x - half, y - half, half * 2, half * 2, corr.x, corr.y, corr.w, corr.h)) return false;
    }
    return true;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private getRoomAt(x: number, y: number): number {
    for (const room of this.rooms) {
      if (x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h) return room.id;
    }
    for (const corr of this.corridors) {
      if (x >= corr.x && x <= corr.x + corr.w && y >= corr.y && y <= corr.y + corr.h) {
        return corr.fromRoom;
      }
    }
    return -1;
  }

  private rectOverlap(x1: number, y1: number, w1: number, h1: number, x2: number, y2: number, w2: number, h2: number): boolean {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  private createUI() {
    this.ritualText = this.add.text(16, 16, '仪式进度: 0/200', { fontSize: '18px', color: '#44ddff' }).setScrollFactor(0).setDepth(20);
    this.carryText = this.add.text(16, 40, '携带残秽: 0/5', { fontSize: '18px', color: '#ff6666' }).setScrollFactor(0).setDepth(20);
    this.stateText = this.add.text(16, 64, '', { fontSize: '14px', color: '#ffaa44' }).setScrollFactor(0).setDepth(20);

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

    this.hintBar = this.add.text(400, 575, 'WASD移动 • 空格偷取(绕到背后!) • E投喂/躲藏/拾雷 • Q地雷 • ESC菜单', {
      fontSize: '12px', color: '#666666',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
  }

  private updateUI() {
    this.ritualText.setText(`仪式进度: ${Math.ceil(this.ritualProgress)}/${RITUAL_TOTAL}`);
    this.carryText.setText(`携带残秽: ${this.carrying.toFixed(1)}/${CARRY_CAPACITY}`);

    // 怪物状态摘要
    let s = '怪物: ';
    for (const m of this.monsters) {
      if (!m.alive || m.dying) continue;
      const stateLabel = m.state === 'wander' ? '游' : m.state === 'alert' ? '警' : m.state === 'chase' ? '追' : '攻';
      s += `[${stateLabel}${Math.ceil(m.pollution)}] `;
    }
    this.stateText.setText(s);

    // 偷取提示
    if (this.stealTarget) {
      this.hintBar.setText(`⚡ 正在偷取！残秽: ${this.stealTarget.pollution.toFixed(0)}/${this.stealTarget.pollutionMax}  (保持背后位置!)`);
      this.hintBar.setColor('#44ff88');
    } else if (this.carrying >= CARRY_CAPACITY) {
      this.hintBar.setText('携带已满！回祭坛按 E 投喂');
      this.hintBar.setColor('#ffaa44');
    } else {
      // 检测是否在某只怪物的盲区内（可偷但没按空格）
      let canSteal = false;
      for (const m of this.monsters) {
        if (!m.alive || m.dying || m.pollution <= 0) continue;
        if (this.isInBlindSpot(m, this.player.x, this.player.y)) { canSteal = true; break; }
      }
      if (canSteal) {
        this.hintBar.setText('★ 在盲区内！按住空格偷取残秽！');
        this.hintBar.setColor('#44ff88');
      } else {
        this.hintBar.setText('WASD移动 • 空格偷取(绕到怪物背后绿区!) • E投喂/躲藏/拾雷 • Q地雷 • ESC菜单');
        this.hintBar.setColor('#666666');
      }
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
    this.updateMonsters(delta);
    this.updateMines(delta);
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
    const texKey = 'stealVisionOverlay';
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
    this.showMessage('🎉 仪式完成！偷取成功！\n\n按ESC返回菜单', 999999);
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

  private showMessage(text: string, duration: number = 2000) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
    if (this.messageTimer) clearTimeout(this.messageTimer);
    if (duration < 999999) {
      this.messageTimer = window.setTimeout(() => { this.messageText.setVisible(false); }, duration);
    }
  }
}
