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
}

interface Stain {
  x: number;
  y: number;
  radius: number;
  cleanliness: number; // 100 = fully dirty, 0 = fully cleaned
  cleaned: boolean;
  sprite: Phaser.GameObjects.Graphics;       // dirt / rock-skin layer
  innerSprite: Phaser.GameObjects.Graphics;  // stone interior (hidden gem)
  onWall: boolean;
  // ── 赌石字段 ──
  stoneType: StoneType;
  stoneValue: number;     // 预先掷出的真实价值（0 = 非价值石）
  revealStage: number;    // 0=未开始 1=30%线索 2=60%线索 3=完全揭晓
  cursed: boolean;        // 完全揭晓时触发负面效果
}

interface Loot {
  x: number;
  y: number;
  type: LootType;
  value: number;
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
}

type StoneType = 'trash' | 'common' | 'good' | 'rare' | 'legendary' | 'medkit' | 'shield';
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
  private exit!: Phaser.GameObjects.Rectangle;

  // Water gun
  private isSpraying = false;
  private aimAngle = 0;
  private sprayRange = 160;
  private sprayAngle = Math.PI / 6; // 30° half-angle
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
    this.obstacles = [];
    this.hideSpots = [];
    this.waterParticles = [];
    this.stamina = STAMINA_MAX;
    this.isSprinting = false;
    this.isHidden = false;
    this.hiddenSpot = null;

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateBuilding();
    this.drawMap();
    this.createPlayer();
    this.createStains();
    this.createMonsters();
    this.createExit();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('🎰 赌石撤离！\n用水枪清洗石皮，逐步揭晓内部价值\n左键喷射清洗 | 右键放弃开石(拿部分价值)\nShift疾跑 | E键躲藏\n洗到一半觉得不行？右键止损走人！');
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

      // ── 外皮（石皮/污垢）──
      const g = this.add.graphics();
      const dirtColors = [0x3a2a1a, 0x2a2a2a, 0x3a322a, 0x2a1a1a];
      const color = Phaser.Utils.Array.GetRandom(dirtColors);
      g.fillStyle(color, 0.85);
      // 不规则形状
      g.beginPath();
      const points = 8;
      for (let i = 0; i <= points; i++) {
        const a = (i / points) * Math.PI * 2;
        const r = radius * Phaser.Math.FloatBetween(0.7, 1.1);
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillPath();
      g.setPosition(x, y);
      g.setDepth(2);

      this.stains.push({
        x, y, radius,
        cleanliness: 100,
        cleaned: false,
        sprite: g,
        innerSprite: innerG,
        onWall,
        stoneType: tier.type,
        stoneValue,
        revealStage: 0,
        cursed,
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
    const monsterCount = Phaser.Math.Between(4, 6);
    let placed = 0;
    let attempts = 0;

    while (placed < monsterCount && attempts < 500) {
      const x = Phaser.Math.Between(200, this.mapWidth - 200);
      const y = Phaser.Math.Between(200, this.mapHeight - 200);

      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 400) {
        attempts++;
        continue;
      }

      if (!this.isInsideObstacle(x, y, 14)) {
        const isHunter = placed < 2;
        const sprite = this.add.rectangle(x, y, 24, 24, isHunter ? 0xff00ff : 0xff8800);
        sprite.setDepth(5);

        this.monsters.push({
          sprite,
          speed: isHunter ? 40 : 30,
          chaseSpeed: isHunter ? 185 : 170,
          direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
          patrolTimer: Phaser.Math.Between(0, 3000),
          isChasing: false,
          visionRange: isHunter ? 220 : 160,
          visionAngle: Math.PI / 3,
          territoryRadius: 9999, // 取消领地限制，追到底
          homeX: x,
          homeY: y,
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
        });
        placed++;
      }
      attempts++;
    }
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

  // ─── Input ───────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

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

    // 更新瞄准角度 — 使用 positionToCamera 确保相机偏移正确
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const mouseWorldX = pointer.x + cam.scrollX;
    const mouseWorldY = pointer.y + cam.scrollY;
    this.aimAngle = Math.atan2(mouseWorldY - this.player.y, mouseWorldX - this.player.x);

    // 躲藏时不能移动/喷射，但体力恢复和雾仍更新
    if (!this.isHidden) {
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

    // 水枪击中怪物 → 眩晕 + 击退
    for (const monster of this.monsters) {
      const dx = monster.sprite.x - px;
      const dy = monster.sprite.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > range + 16) continue;

      const monAngle = Math.atan2(dy, dx);
      let diff = Math.abs(monAngle - a);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > halfAngle) continue;

      // 在喷射锥内 → 眩晕2秒 + 击退
      monster.stunTimer = 2000;
      monster.isChasing = false;
      monster.giveUpTimer = 0;

      // 击退
      const klen = dist || 1;
      const knockback = 60 * (delta / 1000);
      const newX = monster.sprite.x + (dx / klen) * knockback;
      const newY = monster.sprite.y + (dy / klen) * knockback;
      if (!this.isObstacleAt(newX, monster.sprite.y, 0)) {
        monster.sprite.x = newX;
      }
      if (!this.isObstacleAt(monster.sprite.x, newY, 0)) {
        monster.sprite.y = newY;
      }
    }
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

    for (const stain of this.stains) {
      if (stain.cleaned) continue;

      const dx = stain.x - px;
      const dy = stain.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > range + stain.radius) continue;

      // 角度判断
      const stainAngle = Math.atan2(dy, dx);
      let diff = Math.abs(stainAngle - a);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > halfAngle) continue;

      // 在喷射范围内 → 清洁
      stain.cleanliness -= cleanPower;

      // 渐进式视觉：外皮渐淡，内部石芯渐显
      const cleanProgress = Phaser.Math.Clamp((100 - stain.cleanliness) / 100, 0, 1);
      stain.sprite.setAlpha(Math.max(0, stain.cleanliness / 100) * 0.85);
      stain.innerSprite.setAlpha(cleanProgress);

      // ── 30% 清洗 → 第一条线索 ──
      if (stain.revealStage === 0 && stain.cleanliness <= 70) {
        stain.revealStage = 1;
        const tier = STONE_TIERS.find(t => t.type === stain.stoneType)!;
        this.showClue(stain.x, stain.y, tier.clue1, '#ffdd44');
      }

      // ── 60% 清洗 → 第二条线索 ──
      if (stain.revealStage === 1 && stain.cleanliness <= 40) {
        stain.revealStage = 2;
        const tier = STONE_TIERS.find(t => t.type === stain.stoneType)!;
        this.showClue(stain.x, stain.y, tier.clue2, '#ffaa00');
      }

      // ── 100% 清洗 → 完全揭晓 ──
      if (stain.cleanliness <= 0) {
        stain.cleaned = true;
        stain.revealStage = 3;
        stain.sprite.setVisible(false);
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

  private checkLootPickup() {
    for (const loot of this.loots) {
      if (loot.collected) continue;

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, loot.x, loot.y);
      if (dist < 25) {
        loot.collected = true;
        loot.sprite.setVisible(false);
        this.tweens.killTweensOf(loot.sprite);

        const info = LOOT_INFO[loot.type];
        if (loot.type === 'medkit') {
          this.health = Math.min(100, this.health + 30);
          this.healthText.setText(`生命: ${this.health}`);
          this.showMessage(`拾取 ${info.name}！\n生命+30`);
        } else if (loot.type === 'shield') {
          this.hasShield = true;
          this.showMessage(`拾取 ${info.name}！\n获得护盾`);
        } else {
          this.score += loot.value;
          this.updateScoreUI();
          this.showMessage(`拾取 ${info.name}！\n+${loot.value} 价值`);
        }
        this.time.delayedCall(1000, () => this.hideMessage());
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
    nearest.sprite.setVisible(false);
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
        this.showMessage('⚠ 清扫触发了怪物！\n一只猎手出现了！');
        break;
      case 'alarm':
        this.alarmTimer = 5000;
        for (const m of this.monsters) {
          m.isChasing = true;
          m.giveUpTimer = 5000;
        }
        this.showMessage('🚨 警报触发！\n所有怪物进入追击状态！');
        break;
      case 'blind':
        this.blindTimer = 4000;
        this.showMessage('👁 清扫溅起刺鼻气体！\n视野暂时缩小！');
        break;
      case 'slow':
        this.slowTimer = 5000;
        this.showMessage('🐌 清扫溅出粘液！\n移动减速！');
        break;
    }
    this.time.delayedCall(1500, () => this.hideMessage());
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

          this.monsters.push({
            sprite,
            speed: isHunter ? 40 : 30,
            chaseSpeed: isHunter ? 185 : 170,
            direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
            patrolTimer: 0,
            isChasing: false,
            visionRange: isHunter ? 220 : 160,
            visionAngle: Math.PI / 3,
            territoryRadius: 9999,
            homeX: mx,
            homeY: my,
            giveUpTimer: 10000,
            giveUpDuration: 10000,
            isHunter,
            stunTimer: 0,
            attackCooldown: 0,
            returnHomeTimer: 0,
            lastSeenX: x,
            lastSeenY: y,
            hasLastSeen: true,
            searchingTimer: 0,
            spawnDelay: SPAWN_DELAY_MS,
          });
          placed = true;
          this.playSpawnJumpscare();
        }
      }
      attempts++;
    }
  }

  /** 刷怪跳脸：鬼图闪现 + 尖叫 + 震动 + 闪红（非致命） */
  private playSpawnJumpscare() {
    const cam = this.cameras.main;
    this.sound.play('scream');

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
      duration: 100,
      ease: 'Back.easeOut',
    });

    cam.shake(400, 0.03);
    cam.flash(150, 255, 0, 0, true);

    this.time.delayedCall(600, () => {
      this.tweens.add({
        targets: jumpscare,
        alpha: 0,
        duration: 200,
        onComplete: () => jumpscare.destroy(),
      });
    });
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
      // 眩晕期间不能移动也不能追击
      if (monster.stunTimer > 0) {
        monster.stunTimer -= delta;
        monster.sprite.setFillStyle(0x666666); // 眩晕时变灰
        continue;
      } else {
        monster.sprite.setFillStyle(monster.isHunter ? 0xff00ff : 0xff8800);
      }

      // 攻击停顿：打中玩家后短暂停止移动
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
        // 朝玩家移动
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

    const proximitySense = 60;

    if (monster.visionAngle > 0 && distToPlayer > proximitySense) {
      const angleToPlayer = Math.atan2(
        this.player.y - monster.sprite.y, this.player.x - monster.sprite.x
      );
      let facingAngle = Math.atan2(monster.direction.y, monster.direction.x);
      if (monster.isChasing) facingAngle = angleToPlayer;

      let diff = Math.abs(angleToPlayer - facingAngle);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > monster.visionAngle) return false;
    }

    if (distToPlayer > proximitySense &&
        this.lineBlockedByObstacle(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y)) {
      return false;
    }

    return true;
  }

  // ─── Combat ─────────────────────────────────────────────────

  private checkMonsterCollision() {
    if (this.damageCooldown > 0) return;
    if (this.isHidden) return; // 躲藏时不会受到伤害

    for (const monster of this.monsters) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y, monster.sprite.x, monster.sprite.y
      );

      if (dist < 28) {
        if (this.hasShield) {
          this.hasShield = false;
          this.showMessage('🛡 护盾抵挡了攻击！');
          this.time.delayedCall(1000, () => this.hideMessage());
          this.damageCooldown = 1000;
          monster.attackCooldown = 800; // 攻击停顿
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
          monster.attackCooldown = 800; // 攻击停顿

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
