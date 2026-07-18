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

interface Switch {
  x: number;
  y: number;
  activated: boolean;
  activateProgress: number; // 0~1
  sprite: Phaser.GameObjects.Rectangle;
  glowSprite: Phaser.GameObjects.Arc;
  promptText: Phaser.GameObjects.Text;
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
  stunTimer: number;
  attackCooldown: number;
}

type StoneType = 'trash' | 'common' | 'good' | 'rare' | 'legendary' | 'medkit' | 'shield';

interface StoneTier {
  type: StoneType;
  color: number;
  glowColor: number;
  name: string;
  minVal: number;
  maxVal: number;
  weight: number;
  clue: string;       // 清洗后显示的颜色线索
  isUtility: boolean;
}

const STONE_TIERS: StoneTier[] = [
  { type: 'trash',     color: 0x555555, glowColor: 0x666666, name: '废料',   minVal: 5,   maxVal: 15,   weight: 40, clue: '灰色…',           isUtility: false },
  { type: 'common',    color: 0xddccaa, glowColor: 0xddccaa, name: '普通石', minVal: 20,  maxVal: 50,   weight: 25, clue: '白色…',           isUtility: false },
  { type: 'good',      color: 0x44dd44, glowColor: 0x44ff44, name: '好玉',   minVal: 80,  maxVal: 150,  weight: 15, clue: '淡绿色！',         isUtility: false },
  { type: 'rare',      color: 0x00cc44, glowColor: 0x00ff44, name: '极品玉', minVal: 200, maxVal: 500,  weight: 8,  clue: '翠绿色！！',       isUtility: false },
  { type: 'legendary', color: 0x00ff44, glowColor: 0x00ff88, name: '帝王绿', minVal: 800, maxVal: 1200, weight: 4,  clue: '帝王绿！！！',     isUtility: false },
  { type: 'medkit',    color: 0xff4444, glowColor: 0xff6666, name: '药石',   minVal: 0,   maxVal: 0,    weight: 5,  clue: '红色…',           isUtility: true },
  { type: 'shield',    color: 0x44aaff, glowColor: 0x66ccff, name: '盾石',   minVal: 0,   maxVal: 0,    weight: 3,  clue: '蓝色…',           isUtility: true },
];

const STONE_TIERS_TOTAL_WEIGHT = STONE_TIERS.reduce((s, t) => s + t.weight, 0);
const CURSED_CHANCE = 0.15;

// ─── Stone state machine ─────────────────────────────────────
// 0=未清洗  1=清洗中  2=已清洗(待决策)  3=已拿走  4=已锤  5=已放弃
type StoneState = 0 | 1 | 2 | 3 | 4 | 5;

interface Stone {
  x: number;
  y: number;
  radius: number;
  stoneType: StoneType;
  stoneValue: number;
  cursed: boolean;
  state: StoneState;
  cleanProgress: number;     // 0~1 清洗进度
  shellSprite: Phaser.GameObjects.Graphics;   // 外皮
  innerSprite: Phaser.GameObjects.Graphics;   // 内部颜色
  promptText: Phaser.GameObjects.Text;         // 浮动提示
}

// ─── Constants ─────────────────────────────────────────────
const PLAYER_BASE_SPEED = 160;
const PLAYER_SPRINT_SPEED = 260;
const STAMINA_MAX = 100;
const STAMINA_DRAIN_RATE = 35;
const STAMINA_REGEN_RATE = 20;
const STAMINA_SPRINT_MIN = 5;

const CLEAN_DURATION = 1500;   // 清洗1.5秒
// const HAMMER_REVEAL_DELAY = 1500; // 锤下后1.5秒揭晓 (unused)
const INTERACT_RANGE = 60;    // 交互距离（拿走/锤）
const SPRAY_RANGE = 160;     // 水枪射程
const SPRAY_ANGLE = Math.PI / 12; // 水枪半锥角(15°)
const MONSTER_STUN_DURATION = 2000; // 水枪喷怪物眩晕2秒

// ─── Constants: hide & aggro ────────────────────────────────
// const HIDE_LOSE_AGGRO_TIME = 3000; // 躲藏后3秒才脱仇恨 (unused)
const HIDE_SPOT_RANGE = 40;       // 进入躲藏点的判定距离

// ─── Constants: switches & key ──────────────────────────────
const SWITCH_COUNT = 3;
const SWITCH_ACTIVATE_DURATION = 2000; // 拉闸需要按住2秒
const SWITCH_INTERACT_RANGE = 50;
const KEY_PICKUP_RANGE = 40;
const SWITCH_ALERT_RANGE = 350;        // 拉闸引怪范围

// ─── Scene ────────────────────────────────────────────────────

export class StoneGambleScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
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
  private fogTextureKey = 'stoneGambleFog';
  private viewRadius = 180;
  private screenW = 800;
  private screenH = 600;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private stones: Stone[] = [];
  private monsters: Monster[] = [];
  private exit!: Phaser.GameObjects.Rectangle;

  // Interaction
  private currentTarget: Stone | null = null;  // 当前水枪瞄准的石头
  private isSpraying = false;                    // 正在喷射水枪
  private isHammering = false;                   // 锤子动画中
  private aimAngle = 0;                           // 水枪瞄准角度
  private sprayGraphics!: Phaser.GameObjects.Graphics;

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
  private eKey!: Phaser.Input.Keyboard.Key;

  // Switches & Key
  private switches: Switch[] = [];
  private hasKey = false;
  private keySprite!: Phaser.GameObjects.Arc;       // 钥匙图标（跟随玩家或在地上）
  private keyGroundX = 0;
  private keyGroundY = 0;
  private keyOnGround = true;
  private gKey!: Phaser.Input.Keyboard.Key;
  private fKey!: Phaser.Input.Keyboard.Key;
  private activatedCount = 0;
  private switchUIText!: Phaser.GameObjects.Text;
  private keyUIText!: Phaser.GameObjects.Text;

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

  constructor() {
    super({ key: 'StoneGambleScene' });
  }

  create() {
    // ── 重置所有实例状态 ──
    this.isDead = false;
    this.isWon = false;
    this.health = 100;
    this.score = 0;
    this.damageCooldown = 0;
    this.hasShield = false;
    this.isEvacuating = false;
    this.evacTimer = 0;
    this.isSpraying = false;
    this.isHammering = false;
    this.currentTarget = null;
    this.aimAngle = 0;
    this.stones = [];
    this.monsters = [];
    this.obstacles = [];
    this.hideSpots = [];
    this.switches = [];
    this.hasKey = false;
    this.keyOnGround = true;
    this.activatedCount = 0;
    this.stamina = STAMINA_MAX;
    this.isSprinting = false;
    this.isHidden = false;
    this.hiddenSpot = null;

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateBuilding();
    this.generateHideRooms();
    this.drawMap();
    this.createPlayer();
    this.createStones();
    this.createMonsters();
    this.createExit();
    this.createSwitches();
    this.createKeyItem();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.sprayGraphics = this.add.graphics();
    this.sprayGraphics.setDepth(7);

    this.showMessage('🎰 赌石撤离！\n\n左键 = 水枪（清洗石头 / 喷晕怪物）\n右键 = 锤子（清洗后才能锤）\n\n清洗石头看颜色 → 左键稳拿 / 右键锤赌一把！\nShift疾跑 | E键躲藏 | G键拾取/放下钥匙\n\n找到钥匙 → 拉3个电闸 → 撤离点开启！', 7000);
  }

  // ─── Map generation ─────────────────────────────────────────

  private generateBuilding() {
    this.obstacles = [];

    // 外墙
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    // 生成房间隔断
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
    for (let i = 0; i < 20; i++) {
      const w = Phaser.Math.Between(20, 50);
      const h = Phaser.Math.Between(20, 50);
      const x = Phaser.Math.Between(100, this.mapWidth - 100 - w);
      const y = Phaser.Math.Between(100, this.mapHeight - 100 - h);
      if (x < 200 && y < 200) continue;
      if (x + w > this.mapWidth - 200 && y + h > this.mapHeight - 200) continue;
      this.obstacles.push({ x, y, w, h });
    }
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

  // ─── Stones ──────────────────────────────────────────────────

  private createStones() {
    const stoneCount = 30;
    let placed = 0;
    let attempts = 0;

    while (placed < stoneCount && attempts < 1000) {
      const x = Phaser.Math.Between(60, this.mapWidth - 60);
      const y = Phaser.Math.Between(60, this.mapHeight - 60);

      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 150) {
        attempts++;
        continue;
      }

      if (this.isInsideObstacle(x, y, 18)) {
        attempts++;
        continue;
      }

      const radius = Phaser.Math.Between(14, 24);
      const tier = this.rollStoneType();
      const stoneValue = tier.isUtility ? 0 : Phaser.Math.Between(tier.minVal, tier.maxVal);
      const cursed = !tier.isUtility && Math.random() < CURSED_CHANCE;

      // 内部颜色（清洗后显示）
      const innerG = this.add.graphics();
      innerG.setPosition(x, y);
      innerG.setDepth(1.5);
      innerG.fillStyle(tier.color, 1);
      innerG.fillCircle(0, 0, radius * 0.7);
      if (tier.type === 'rare' || tier.type === 'legendary') {
        innerG.fillStyle(tier.glowColor, 0.3);
        innerG.fillCircle(0, 0, radius * 1.0);
      }
      innerG.setAlpha(0); // 初始隐藏

      // 外皮（完整覆盖）
      const dirtColors = [0x3a2a1a, 0x2a2a2a, 0x3a322a, 0x2a1a1a];
      const dirtColor = Phaser.Utils.Array.GetRandom(dirtColors);
      const shellG = this.add.graphics();
      shellG.fillStyle(dirtColor, 0.9);
      shellG.fillCircle(0, 0, radius * 1.1);
      shellG.setPosition(x, y);
      shellG.setDepth(2);

      // 浮动提示文字
      const prompt = this.add.text(x, y - radius - 12, '', {
        fontSize: '12px', color: '#ffff00',
      }).setOrigin(0.5).setDepth(6);

      this.stones.push({
        x, y, radius,
        stoneType: tier.type,
        stoneValue,
        cursed,
        state: 0,
        cleanProgress: 0,
        shellSprite: shellG,
        innerSprite: innerG,
        promptText: prompt,
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
    const monsterCount = 8;
    let placed = 0;
    let attempts = 0;

    while (placed < monsterCount && attempts < 500) {
      const x = Phaser.Math.Between(120, this.mapWidth - 120);
      const y = Phaser.Math.Between(120, this.mapHeight - 120);

      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 400) {
        attempts++;
        continue;
      }

      if (this.isInsideObstacle(x, y, 14)) {
        attempts++;
        continue;
      }

      const sprite = this.add.rectangle(x, y, 24, 24, 0xff00ff);
      sprite.setDepth(5);

      this.monsters.push({
        sprite,
        speed: 40,
        chaseSpeed: 165,
        direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
        patrolTimer: Phaser.Math.Between(0, 3000),
        isChasing: false,
        visionRange: 180,
        visionAngle: Math.PI / 3,
        territoryRadius: 9999,
        homeX: x,
        homeY: y,
        giveUpTimer: 0,
        giveUpDuration: 10000,
        stunTimer: 0,
        attackCooldown: 0,
      });
      placed++;
      attempts++;
    }
  }

  // ─── Exit ────────────────────────────────────────────────────

  private createExit() {
    this.exit = this.add.rectangle(this.mapWidth - 80, this.mapHeight - 80, 50, 50, 0x00ffff);
    this.exit.setAlpha(0.3);
    this.exit.setDepth(3);
  }

  // ─── Switches (电闸) ─────────────────────────────────────────

  private createSwitches() {
    let placed = 0;
    let attempts = 0;

    while (placed < SWITCH_COUNT && attempts < 500) {
      attempts++;
      const x = Phaser.Math.Between(300, this.mapWidth - 300);
      const y = Phaser.Math.Between(300, this.mapHeight - 300);

      // 避开起点和撤离点
      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 400) continue;
      if (Phaser.Math.Distance.Between(x, y, this.mapWidth - 80, this.mapHeight - 80) < 300) continue;

      // 避开障碍物
      if (this.isInsideObstacle(x, y, 30)) continue;

      // 避开其他电闸
      let tooClose = false;
      for (const sw of this.switches) {
        if (Phaser.Math.Distance.Between(x, y, sw.x, sw.y) < 400) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      // 电闸本体
      const sprite = this.add.rectangle(x, y, 30, 40, 0xff4400);
      sprite.setDepth(3);
      sprite.setStrokeStyle(2, 0xffaa00);

      // 发光圈
      const glow = this.add.circle(x, y, 35, 0xffaa00, 0.3);
      glow.setDepth(2.5);

      // 提示文字
      const prompt = this.add.text(x, y - 30, '', {
        fontSize: '14px', color: '#ffaa00',
        stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(6);

      this.switches.push({
        x, y,
        activated: false,
        activateProgress: 0,
        sprite,
        glowSprite: glow,
        promptText: prompt,
      });
      placed++;
    }
  }

  // ─── Key item (钥匙) ─────────────────────────────────────────

  private createKeyItem() {
    // 钥匙在起点附近
    this.keyGroundX = 120;
    this.keyGroundY = 120;
    this.keyOnGround = true;
    this.hasKey = false;

    this.keySprite = this.add.circle(this.keyGroundX, this.keyGroundY, 10, 0xffff00);
    this.keySprite.setStrokeStyle(2, 0xffaa00);
    this.keySprite.setDepth(4);
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
    this.healthText = this.add.text(16, 16, '生命: 100', {
      fontSize: '18px', color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.scoreText = this.add.text(16, 40, '价值: 0 / 1000', {
      fontSize: '18px', color: '#ffdd00',
    }).setScrollFactor(0).setDepth(20);

    this.switchUIText = this.add.text(16, 64, '电闸: 0/3', {
      fontSize: '18px', color: '#ffaa00',
    }).setScrollFactor(0).setDepth(20);

    this.keyUIText = this.add.text(16, 88, '', {
      fontSize: '16px', color: '#ffff00',
    }).setScrollFactor(0).setDepth(20);

    this.statusText = this.add.text(16, 112, '', {
      fontSize: '14px', color: '#ff8844',
    }).setScrollFactor(0).setDepth(20);

    this.evacText = this.add.text(400, 300, '', {
      fontSize: '32px', color: '#00ff00', align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    this.add.text(400, 540, '', {
      fontSize: '16px', color: '#ffffff', align: 'center',
      backgroundColor: '#000000aa',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    this.messageText = this.add.text(400, 500, '', {
      fontSize: '20px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    this.staminaBar = this.add.graphics();
    this.staminaBar.setScrollFactor(0).setDepth(20);

    this.hidePromptText = this.add.text(400, 560, '', {
      fontSize: '18px', color: '#6688cc', align: 'center',
      backgroundColor: '#000000aa',
      padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

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

  private updateHealthUI() {
    const newText = `生命: ${this.health}`;
    if (this.healthText.text !== newText) {
      this.healthText.setText(newText);
      if (this.health <= 30) {
        this.healthText.setColor('#ff4444');
      } else if (this.health <= 60) {
        this.healthText.setColor('#ffaa44');
      } else {
        this.healthText.setColor('#ffffff');
      }
    }
  }

  private updateScoreUI() {
    const newText = `价值: ${this.score} / ${this.goalScore}`;
    if (this.scoreText.text !== newText) {
      this.scoreText.setText(newText);
      if (this.score >= this.goalScore) {
        this.scoreText.setColor('#00ff00');
      } else {
        this.scoreText.setColor('#ffdd00');
      }
    }
  }

  private updateStatusUI() {
    const effects: string[] = [];
    if (this.hasShield) effects.push('🛡护盾');
    const newText = effects.join(' ');
    if (this.statusText.text !== newText) {
      this.statusText.setText(newText);
    }

    // 更新电闸UI
    const switchText = `电闸: ${this.activatedCount}/${SWITCH_COUNT}`;
    if (this.switchUIText.text !== switchText) {
      this.switchUIText.setText(switchText);
      if (this.activatedCount >= SWITCH_COUNT) {
        this.switchUIText.setColor('#00ff00');
      }
    }

    // 更新钥匙UI
    const keyText = this.hasKey ? '🔑 持有钥匙' : (this.keyOnGround ? '' : '');
    if (this.keyUIText.text !== keyText) {
      this.keyUIText.setText(keyText);
    }
  }

  private messageTimer: Phaser.Time.TimerEvent | null = null;

  private showMessage(text: string, duration = 3000) {
    if (this.messageTimer) {
      this.messageTimer.remove(false);
      this.messageTimer = null;
    }
    this.messageText.setText(text).setVisible(true);
    if (duration < 999999) {
      this.messageTimer = this.time.delayedCall(duration, () => {
        this.messageTimer = null;
        this.hideMessage();
      });
    }
  }

  private hideMessage() {
    this.messageText.setVisible(false);
  }

  // ─── Input ───────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.gKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.G);
    this.fKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);

    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isDead || this.isWon || this.isHammering) return;

      if (pointer.leftButtonDown()) {
        // ── 左键：水枪（清洗石头 / 喷晕怪物）──
        // 拿着钥匙时不能用水枪
        if (!this.hasKey) {
          this.isSpraying = true;
          // 如果近处有已清洗的石头，左键也直接拿走
          const target = this.findNearestStone();
          if (target && target.state === 2) {
            this.takeStone(target);
          }
        }
      }

      if (pointer.rightButtonDown()) {
        // ── 右键：锤子 ──
        // 拿着钥匙时不能用锤子
        if (!this.hasKey) {
          const target = this.findNearestStone();
          if (target && target.state === 2) {
            this.hammerStone(target);
          }
        }
      }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) {
        this.isSpraying = false;
      }
    });
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

    // E 键躲藏/离开
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.tryHide();
    }

    // G 键拾取/放下钥匙
    if (Phaser.Input.Keyboard.JustDown(this.gKey)) {
      this.toggleKey();
    }

    // F 键拉闸（按住）
    this.updateSwitchActivation(delta);

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

    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    const mouseWorldX = pointer.x + cam.scrollX;
    const mouseWorldY = pointer.y + cam.scrollY;
    this.aimAngle = Math.atan2(mouseWorldY - this.player.y, mouseWorldX - this.player.x);

    // 躲藏时不能移动/喷射，但体力恢复和雾仍更新
    if (!this.isHidden) {
      this.handlePlayerMovement(delta);
      // 拿着钥匙时不能喷射
      if (!this.hasKey) {
        this.updateSpray(delta);
      } else {
        this.sprayGraphics.clear();
        this.isSpraying = false;
      }
    } else {
      this.sprayGraphics.clear();
      this.isSpraying = false;
      // 体力恢复
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * (delta / 1000));
    }
    this.updateMonsters(delta);
    this.checkMonsterCollision();
    this.updateKeyPosition();
    this.updateSwitchPrompts();
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

    let dx = 0;
    let dy = 0;
    if (this.cursors.left?.isDown || this.wasdKeys.A.isDown) dx -= 1;
    if (this.cursors.right?.isDown || this.wasdKeys.D.isDown) dx += 1;
    if (this.cursors.up?.isDown || this.wasdKeys.W.isDown) dy -= 1;
    if (this.cursors.down?.isDown || this.wasdKeys.S.isDown) dy += 1;

    const isMoving = dx !== 0 || dy !== 0;
    this.isSprinting = isMoving && this.shiftKey.isDown && this.stamina > STAMINA_SPRINT_MIN;

    if (isMoving) {
      const len = Math.sqrt(dx * dx + dy * dy);
      dx /= len;
      dy /= len;

      const speed = this.isSprinting ? PLAYER_SPRINT_SPEED : PLAYER_BASE_SPEED;
      const newX = this.player.x + dx * speed * dt;
      const newY = this.player.y + dy * speed * dt;

      if (!this.collidesWithObstacle(newX, this.player.y, 12)) {
        this.player.x = newX;
      }
      if (!this.collidesWithObstacle(this.player.x, newY, 12)) {
        this.player.y = newY;
      }

      this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.mapWidth - 20);
      this.player.y = Phaser.Math.Clamp(this.player.y, 20, this.mapHeight - 20);
    }

    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_RATE * dt);
    } else {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * dt);
    }
  }

  private collidesWithObstacle(x: number, y: number, radius: number): boolean {
    for (const obs of this.obstacles) {
      const closestX = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
      const closestY = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
      const dist = Phaser.Math.Distance.Between(x, y, closestX, closestY);
      if (dist < radius) return true;
    }
    return false;
  }

  private isInsideObstacle(x: number, y: number, radius: number): boolean {
    return this.collidesWithObstacle(x, y, radius);
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

  private lineBlockedByObstacle(x1: number, y1: number, x2: number, y2: number): boolean {
    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const steps = Math.ceil(dist / 10);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      if (this.collidesWithObstacle(px, py, 0)) return true;
    }
    return false;
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
    // 躲藏后立即清除所有怪物的追击状态
    for (const m of this.monsters) {
      m.isChasing = false;
      m.giveUpTimer = 0;
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

  private drawStaminaBar() {
    this.staminaBar.clear();
    const barX = 16;
    const barY = 136;
    const barW = 150;
    const barH = 12;

    this.staminaBar.fillStyle(0x000000, 0.5);
    this.staminaBar.fillRect(barX, barY, barW, barH);

    const staminaRatio = this.stamina / STAMINA_MAX;
    const color = staminaRatio > 0.5 ? 0x00ff00 : staminaRatio > 0.25 ? 0xffff00 : 0xff0000;
    this.staminaBar.fillStyle(color, 0.8);
    this.staminaBar.fillRect(barX, barY, barW * staminaRatio, barH);

    this.staminaBar.lineStyle(1, 0xffffff, 0.5);
    this.staminaBar.strokeRect(barX, barY, barW, barH);
  }

  // ─── Key & Switch interaction ────────────────────────────────

  private toggleKey() {
    if (this.hasKey) {
      // 放下钥匙
      this.hasKey = false;
      this.keyOnGround = true;
      this.keyGroundX = this.player.x;
      this.keyGroundY = this.player.y;
      this.keySprite.setPosition(this.keyGroundX, this.keyGroundY);
      this.keySprite.setVisible(true);
      this.showMessage('🔑 放下钥匙', 1500);
    } else {
      // 拾取钥匙
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.keyGroundX, this.keyGroundY);
      if (dist < KEY_PICKUP_RANGE && this.keyOnGround) {
        this.hasKey = true;
        this.keyOnGround = false;
        this.keySprite.setVisible(false);
        this.showMessage('🔑 拾取钥匙！\n拿着钥匙时不能用水枪/锤子', 2500);
      }
    }
  }

  private updateKeyPosition() {
    if (this.hasKey) {
      // 钥匙跟随玩家
      this.keySprite.setPosition(this.player.x, this.player.y - 20);
      this.keySprite.setVisible(true);
    }
  }

  private updateSwitchActivation(delta: number) {
    if (!this.hasKey) {
      // 没有钥匙，重置所有进度
      for (const sw of this.switches) {
        if (!sw.activated && sw.activateProgress > 0) {
          sw.activateProgress = Math.max(0, sw.activateProgress - delta / 500);
        }
      }
      return;
    }

    // 查找最近的未激活电闸
    let nearest: Switch | null = null;
    let bestDist = SWITCH_INTERACT_RANGE;
    for (const sw of this.switches) {
      if (sw.activated) continue;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, sw.x, sw.y);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = sw;
      }
    }

    if (!nearest) {
      return;
    }

    // 按住 F 键拉闸
    if (this.fKey.isDown) {
      nearest.activateProgress += delta / SWITCH_ACTIVATE_DURATION;

      if (nearest.activateProgress >= 1) {
        // 拉闸成功！
        nearest.activated = true;
        nearest.activateProgress = 0;
        this.activatedCount++;

        // 视觉效果
        nearest.sprite.setFillStyle(0x00ff00);
        nearest.glowSprite.setFillStyle(0x00ff00, 0.5);
        this.cam.flash(400, 0, 255, 0);
        this.showMessage(`⚡ 电闸 ${this.activatedCount}/${SWITCH_COUNT} 已激活！`, 2500);

        // 吸引怪物
        this.alertMonstersInRange(nearest.x, nearest.y, SWITCH_ALERT_RANGE);

        // 全部激活 → 撤离点开启
        if (this.activatedCount >= SWITCH_COUNT) {
          this.showMessage('⚡ 所有电闸已激活！\n撤离点已开启！', 4000);
          this.exit.setAlpha(0.8);
          this.tweens.add({
            targets: this.exit,
            alpha: { from: 0.5, to: 1.0 },
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.inOut',
          });
        }
      }
    } else {
      // 松开 F 键，进度回退
      if (nearest.activateProgress > 0) {
        nearest.activateProgress = Math.max(0, nearest.activateProgress - delta / 500);
      }
    }
  }

  private updateSwitchPrompts() {
    for (const sw of this.switches) {
      if (sw.activated) {
        sw.promptText.setText('✓ 已激活');
        continue;
      }

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, sw.x, sw.y);
      if (dist < SWITCH_INTERACT_RANGE + 20) {
        if (this.hasKey) {
          const pct = Math.floor(sw.activateProgress * 100);
          sw.promptText.setText(`[按住F] 拉闸 ${pct}%`);
        } else {
          sw.promptText.setText('需要钥匙');
        }
      } else {
        sw.promptText.setText('');
      }
    }
  }

  // ─── Stone interaction ──────────────────────────────────────

  private findNearestStone(): Stone | null {
    let nearest: Stone | null = null;
    let bestDist = INTERACT_RANGE;

    for (const stone of this.stones) {
      if (stone.state === 3 || stone.state === 4 || stone.state === 5) continue;

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, stone.x, stone.y);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = stone;
      }
    }

    return nearest;
  }

  // ── 水枪：清洗石头 + 喷晕怪物 ──
  private updateSpray(delta: number) {
    this.sprayGraphics.clear();

    if (!this.isSpraying) {
      // 不喷射时，清除清洗目标
      this.currentTarget = null;
      this.updateStonePrompts();
      return;
    }

    // 绘制喷射锥形
    this.sprayGraphics.fillStyle(0x4488ff, 0.3);
    this.sprayGraphics.beginPath();
    this.sprayGraphics.moveTo(this.player.x, this.player.y);
    const leftAngle = this.aimAngle - SPRAY_ANGLE;
    const rightAngle = this.aimAngle + SPRAY_ANGLE;
    this.sprayGraphics.lineTo(
      this.player.x + Math.cos(leftAngle) * SPRAY_RANGE,
      this.player.y + Math.sin(leftAngle) * SPRAY_RANGE
    );
    this.sprayGraphics.lineTo(
      this.player.x + Math.cos(rightAngle) * SPRAY_RANGE,
      this.player.y + Math.sin(rightAngle) * SPRAY_RANGE
    );
    this.sprayGraphics.closePath();
    this.sprayGraphics.fillPath();

    // ── 找到锥形内的石头 ──
    let targetStone: Stone | null = null;
    let bestDist = Infinity;

    for (const stone of this.stones) {
      if (stone.state !== 0) continue; // 只清洗未清洗的

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, stone.x, stone.y);
      if (dist > SPRAY_RANGE + stone.radius) continue;

      const angleToStone = Math.atan2(stone.y - this.player.y, stone.x - this.player.x);
      let angleDiff = Math.abs(angleToStone - this.aimAngle);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      if (angleDiff > SPRAY_ANGLE) continue;

      if (dist < bestDist) {
        bestDist = dist;
        targetStone = stone;
      }
    }

    // ── 清洗进度 ──
    if (targetStone) {
      if (this.currentTarget !== targetStone) {
        this.currentTarget = targetStone;
      }

      targetStone.cleanProgress += delta / CLEAN_DURATION;
      targetStone.shellSprite.setAlpha(0.9 * (1 - targetStone.cleanProgress));

      const pct = Math.floor(targetStone.cleanProgress * 100);
      targetStone.promptText.setText(`清洗中... ${pct}%`);

      if (targetStone.cleanProgress >= 1) {
        targetStone.state = 2;
        targetStone.shellSprite.setAlpha(0.1);
        targetStone.innerSprite.setAlpha(1);
        this.currentTarget = null;

        const tier = STONE_TIERS.find(t => t.type === targetStone.stoneType)!;
        targetStone.promptText.setText(`${tier.clue}`);

        // 清洗声吸引怪物
        this.alertMonstersInRange(targetStone.x, targetStone.y, 180);
      }
    } else {
      this.currentTarget = null;
    }

    // ── 水枪喷怪物：眩晕 ──
    for (const monster of this.monsters) {
      if (monster.stunTimer > 0) continue;

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, monster.sprite.x, monster.sprite.y);
      if (dist > SPRAY_RANGE) continue;

      const angleToMonster = Math.atan2(monster.sprite.y - this.player.y, monster.sprite.x - this.player.x);
      let angleDiff = Math.abs(angleToMonster - this.aimAngle);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      if (angleDiff > SPRAY_ANGLE) continue;

      // 喷中了！眩晕
      monster.stunTimer = MONSTER_STUN_DURATION;
      monster.isChasing = true; // 眩晕后会追击
      monster.giveUpTimer = monster.giveUpDuration;
    }

    this.updateStonePrompts();
  }

  // ── 更新石头浮动提示 ──
  private updateStonePrompts() {
    const nearest = this.findNearestStone();
    for (const stone of this.stones) {
      if (stone === nearest) {
        if (stone.state === 0 && !this.isSpraying) {
          stone.promptText.setText('[左键] 水枪清洗');
        } else if (stone.state === 2) {
          const tier = STONE_TIERS.find(t => t.type === stone.stoneType)!;
          if (!tier.isUtility) {
            const safeVal = Math.floor(stone.stoneValue * 0.5);
            stone.promptText.setText(`${tier.clue}\n[左键]稳拿${safeVal} | [右键]锤！`);
          } else {
            stone.promptText.setText(`${tier.clue}\n[左键]拿走 | [右键]锤！`);
          }
        }
      } else {
        if (stone.state === 0 && !this.isSpraying) {
          stone.promptText.setText('');
        }
      }
    }
  }

  // ── 稳拿底价 ──
  private takeStone(stone: Stone) {
    const tier = STONE_TIERS.find(t => t.type === stone.stoneType)!;
    stone.state = 3;

    if (tier.isUtility) {
      if (tier.type === 'medkit') {
        this.health = Math.min(100, this.health + 30);
        this.showMessage('💊 药石！恢复30生命', 2000);
        this.updateHealthUI();
      } else if (tier.type === 'shield') {
        this.hasShield = true;
        this.showMessage('🛡 盾石！获得护盾', 2000);
      }
    } else {
      const safeVal = Math.floor(stone.stoneValue * 0.5);
      this.score += safeVal;
      this.showMessage(`💰 稳拿！${tier.name} +${safeVal}金`, 2000);
      this.updateScoreUI();
    }

    stone.promptText.setText('');
    stone.shellSprite.setVisible(false);
    // 浮动结果标记
    this.spawnResultTag(stone, `💰+${Math.floor(stone.stoneValue * 0.5)}`);
  }

  // ── 锤子！赌一把 ──
  private hammerStone(stone: Stone) {
    stone.state = 4;
    this.isHammering = true;
    stone.promptText.setText('🔨 锤！');

    // 锤击动画：震动
    this.cam.shake(200, 0.008);

    // 立即揭晓
    this.revealHammerResult(stone);
  }

  private revealHammerResult(stone: Stone) {
    this.isHammering = false;
    const tier = STONE_TIERS.find(t => t.type === stone.stoneType)!;

    if (stone.cursed) {
      // ── 诅咒石！炸裂 ──
      this.cam.flash(300, 255, 0, 0);
      this.cam.shake(500, 0.015);
      this.showMessage('💀 诅咒石！！炸裂了！！', 2500);
      this.spawnCursedMonster(stone.x, stone.y);
      this.spawnCursedMonster(stone.x + 30, stone.y - 20);
      this.alertMonstersInRange(stone.x, stone.y, 500);
    } else if (tier.isUtility) {
      // ── 功能石锤了也是功能效果 ──
      if (tier.type === 'medkit') {
        this.health = Math.min(100, this.health + 30);
        this.showMessage('💊 药石！恢复30生命', 2000);
        this.updateHealthUI();
      } else if (tier.type === 'shield') {
        this.hasShield = true;
        this.showMessage('🛡 盾石！获得护盾', 2000);
      }
    } else {
      // ── 正常石头：55%溢价 / 45%贬值 ──
      const roll = Math.random();
      if (roll < 0.55) {
        // 溢价 1.5~3.0倍
        const mult = Phaser.Math.FloatBetween(1.5, 3.0);
        const finalVal = Math.floor(stone.stoneValue * mult);
        this.score += finalVal;
        this.cam.flash(300, 255, 215, 0);
        this.showMessage(`💎 溢价！${tier.name} ×${mult.toFixed(1)} = +${finalVal}金！！`, 2500);
        this.updateScoreUI();
      } else {
        // 贬值 0.3~0.6倍（保底1金）
        const mult = Phaser.Math.FloatBetween(0.3, 0.6);
        const finalVal = Math.max(1, Math.floor(stone.stoneValue * mult));
        this.score += finalVal;
        this.showMessage(`📉 贬值…${tier.name} ×${mult.toFixed(1)} = +${finalVal}金`, 2500);
        this.updateScoreUI();
      }
    }

    stone.promptText.setText('');
    stone.shellSprite.setVisible(false);
    stone.innerSprite.setAlpha(1);

    // 浮动结果标记
    if (stone.cursed) {
      this.spawnResultTag(stone, '💀诅咒!');
    } else if (tier.isUtility) {
      this.spawnResultTag(stone, tier.type === 'medkit' ? '💊+30HP' : '🛡护盾');
    } else {
      // 从 showMessage 的文本中提取结果
      const msgText = this.messageText.text;
      const match = msgText.match(/\+(\d+)金/);
      if (match) {
        this.spawnResultTag(stone, `+${match[1]}金`);
      }
    }
  }

  // ── 浮动结果标记（从石头位置飘上去消失）──
  private spawnResultTag(stone: Stone, text: string) {
    const tag = this.add.text(stone.x, stone.y - stone.radius - 20, text, {
      fontSize: '16px', color: '#ffff00',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(8);

    this.tweens.add({
      targets: tag,
      y: tag.y - 40,
      alpha: 0,
      duration: 1500,
      ease: 'Power2',
      onComplete: () => tag.destroy(),
    });
  }

  // ─── Monster helpers ─────────────────────────────────────────

  private alertMonstersInRange(x: number, y: number, range: number) {
    for (const monster of this.monsters) {
      const dist = Phaser.Math.Distance.Between(x, y, monster.sprite.x, monster.sprite.y);
      if (dist < range) {
        monster.isChasing = true;
        monster.giveUpTimer = monster.giveUpDuration;
      }
    }
  }

  private spawnCursedMonster(x: number, y: number) {
    const sprite = this.add.rectangle(x, y, 28, 28, 0xff0000);
    sprite.setDepth(5);
    sprite.setStrokeStyle(2, 0xffff00);

    this.monsters.push({
      sprite,
      speed: 60,
      chaseSpeed: 180,
      direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
      patrolTimer: 0,
      isChasing: true,
      visionRange: 300,
      visionAngle: Math.PI * 2,
      territoryRadius: 9999,
      homeX: x,
      homeY: y,
      giveUpTimer: 15000,
      giveUpDuration: 15000,
      stunTimer: 0,
      attackCooldown: 0,
    });
  }

  // ─── Monsters ───────────────────────────────────────────────

  private updateMonsters(delta: number) {
    const dt = delta / 1000;

    for (const monster of this.monsters) {
      if (monster.stunTimer > 0) {
        monster.stunTimer -= delta;
        continue;
      }

      if (monster.attackCooldown > 0) {
        monster.attackCooldown -= delta;
        continue;
      }

      const distToPlayer = Phaser.Math.Distance.Between(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y);

      // 检测玩家（锥形视野 + 视线遮挡）
      const canSee = this.monsterCanSeePlayer(monster, distToPlayer);
      if (canSee) {
        monster.isChasing = true;
        monster.giveUpTimer = monster.giveUpDuration;
      } else if (monster.isChasing) {
        monster.giveUpTimer -= delta;
        if (monster.giveUpTimer <= 0) {
          monster.isChasing = false;
        }
      }

      // 移动
      if (monster.isChasing) {
        const dx = this.player.x - monster.sprite.x;
        const dy = this.player.y - monster.sprite.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const newX = monster.sprite.x + (dx / len) * monster.chaseSpeed * dt;
          const newY = monster.sprite.y + (dy / len) * monster.chaseSpeed * dt;
          if (!this.collidesWithObstacle(newX, monster.sprite.y, 12)) {
            monster.sprite.x = newX;
          }
          if (!this.collidesWithObstacle(monster.sprite.x, newY, 12)) {
            monster.sprite.y = newY;
          }
        }
      } else {
        // 巡逻
        monster.patrolTimer -= delta;
        if (monster.patrolTimer <= 0) {
          monster.direction = new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize();
          monster.patrolTimer = Phaser.Math.Between(2000, 4000);
        }

        const newX = monster.sprite.x + monster.direction.x * monster.speed * dt;
        const newY = monster.sprite.y + monster.direction.y * monster.speed * dt;

        const distFromHome = Phaser.Math.Distance.Between(newX, newY, monster.homeX, monster.homeY);
        if (distFromHome < 300 && !this.collidesWithObstacle(newX, newY, 12)) {
          monster.sprite.x = newX;
          monster.sprite.y = newY;
        } else {
          monster.direction.negate();
        }
      }
    }
  }

  private checkMonsterCollision() {
    if (this.damageCooldown > 0) return;
    if (this.isHidden) return; // 躲藏时不会受到伤害

    for (const monster of this.monsters) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, monster.sprite.x, monster.sprite.y);
      if (dist < 30) {
        if (this.hasShield) {
          this.hasShield = false;
          this.damageCooldown = 1000;
          this.showMessage('🛡 护盾抵挡！', 1500);
          monster.stunTimer = 2000;
        } else {
          this.health -= 20;
          this.damageCooldown = 1000;
          this.showMessage('💥 被怪物攻击！-20生命', 1500);
          monster.attackCooldown = 1500;
          this.updateHealthUI();

          if (this.health <= 0) {
            this.die('被怪物杀死');
          }
        }
        break;
      }
    }
  }

  // ─── Evacuation ──────────────────────────────────────────────

  private checkEvacuation(delta: number) {
    // 必须满足：分数达标 + 3个电闸全部激活
    if (this.score < this.goalScore || this.activatedCount < SWITCH_COUNT) {
      this.isEvacuating = false;
      this.evacTimer = 0;
      this.evacText.setText('');
      return;
    }

    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exit.x, this.exit.y);
    if (dist < 40) {
      if (!this.isEvacuating) {
        this.isEvacuating = true;
        this.evacTimer = 0;
      }

      this.evacTimer += delta;
      const remaining = Math.ceil((this.evacDuration - this.evacTimer) / 1000);
      const newText = `撤离中... ${remaining}s`;
      if (this.evacText.text !== newText) {
        this.evacText.setText(newText);
      }

      if (this.evacTimer >= this.evacDuration) {
        this.win();
      }
    } else {
      this.isEvacuating = false;
      this.evacTimer = 0;
      this.evacText.setText('');
    }
  }

  // ─── Game end ────────────────────────────────────────────────

  private die(cause: string) {
    this.isDead = true;
    this.showMessage(`💀 ${cause}\n\n最终价值: ${this.score}\n\n按ESC返回菜单`, 999999);
  }

  private win() {
    this.isWon = true;
    this.showMessage(`🎉 成功撤离！\n\n总价值: ${this.score}\n\n按ESC返回菜单`, 999999);
  }
}
