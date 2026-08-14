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
  homeX: number;
  homeY: number;
  giveUpTimer: number;
  giveUpDuration: number;
  stunTimer: number;
  attackCooldown: number;
  hp: number;
  maxHp: number;
  isElite: boolean;
}

interface CoreDrop {
  x: number;
  y: number;
  value: number;
  isElite: boolean;
  sprite: Phaser.GameObjects.Arc;
}

type StoneType =
  | 'trash' | 'common' | 'good' | 'rare' | 'legendary'
  | 'iron' | 'crystal' | 'obsidian' | 'amber'
  | 'medkit' | 'shield' | 'bomb';

interface StoneTier {
  type: StoneType;
  color: number;
  glowColor: number;
  name: string;
  minVal: number;
  maxVal: number;
  weight: number;
  clue: string;
  isUtility: boolean;
}

const STONE_TIERS: StoneTier[] = [
  // ── 基础石 ──
  { type: 'trash', color: 0x555555, glowColor: 0x666666, name: '废料', minVal: 5, maxVal: 15, weight: 35, clue: '灰色…', isUtility: false },
  { type: 'common', color: 0xddccaa, glowColor: 0xddccaa, name: '普通石', minVal: 20, maxVal: 50, weight: 20, clue: '白色…', isUtility: false },

  // ── 陷阱专用石 ──
  { type: 'iron', color: 0x888899, glowColor: 0xaaaabb, name: '铁矿', minVal: 40, maxVal: 80, weight: 10, clue: '金属光泽…', isUtility: false },
  { type: 'obsidian', color: 0x1a1a3a, glowColor: 0x3344aa, name: '黑曜石', minVal: 60, maxVal: 120, weight: 8, clue: '黑色锋利…', isUtility: false },
  { type: 'crystal', color: 0x66ccff, glowColor: 0x88ddff, name: '水晶', minVal: 50, maxVal: 100, weight: 8, clue: '透明折射…', isUtility: false },
  { type: 'amber', color: 0xffaa00, glowColor: 0xffcc44, name: '琥珀', minVal: 40, maxVal: 90, weight: 7, clue: '金色温润…', isUtility: false },

  // ── 高级石 ──
  { type: 'good', color: 0x44dd44, glowColor: 0x44ff44, name: '好玉', minVal: 80, maxVal: 150, weight: 6, clue: '淡绿色！', isUtility: false },
  { type: 'rare', color: 0x00cc44, glowColor: 0x00ff44, name: '极品玉', minVal: 200, maxVal: 500, weight: 4, clue: '翠绿色！！', isUtility: false },
  { type: 'legendary', color: 0x00ff44, glowColor: 0x00ff88, name: '帝王绿', minVal: 800, maxVal: 1200, weight: 2, clue: '帝王绿！！！', isUtility: false },

  // ── 功能石 ──
  { type: 'medkit', color: 0xff4444, glowColor: 0xff6666, name: '药石', minVal: 0, maxVal: 0, weight: 5, clue: '红色…', isUtility: true },
  { type: 'shield', color: 0x44aaff, glowColor: 0x66ccff, name: '盾石', minVal: 0, maxVal: 0, weight: 3, clue: '蓝色…', isUtility: true },
  { type: 'bomb', color: 0xff8800, glowColor: 0xffaa00, name: '雷石', minVal: 0, maxVal: 0, weight: 2, clue: '橙色…', isUtility: true },
];

const STONE_TIERS_TOTAL_WEIGHT = STONE_TIERS.reduce((s, t) => s + t.weight, 0);

// ─── Stone state machine ─────────────────────────────────────
// 0=未清洗  1=清洗中  2=已清洗(待决策)  3=已拿走  4=已做成陷阱  5=已放弃
type StoneState = 0 | 1 | 2 | 3 | 4 | 5;

interface Stone {
  x: number;
  y: number;
  radius: number;
  stoneType: StoneType;
  stoneValue: number;
  state: StoneState;
  cleanProgress: number;
  shellSprite: Phaser.GameObjects.Graphics;
  innerSprite: Phaser.GameObjects.Graphics;
  promptText: Phaser.GameObjects.Text;
}

// ─── Trap system ─────────────────────────────────────────────

// 陷阱攻击范围形状
type TrapShape = 'circle' | 'cross' | 'cone' | 'line' | 'square' | 'ring';

interface TrapRecipe {
  name: string;
  shape: TrapShape;
  ingredients: Partial<Record<StoneType, number>>;
  damage: number;
  range: number;        // 主范围（半径或长度）
  stunDuration: number; // 命中后眩晕时间(ms)
  cooldown: number;     // 触发冷却(ms)
  charges: number;      // 可触发次数
  desc: string;
}

const TRAP_RECIPES: TrapRecipe[] = [
  // ── 圆形范围 ──
  { name: '尖刺地刺', shape: 'circle', desc: '圆形范围·低伤',
    ingredients: { trash: 2 },
    damage: 15, range: 60, stunDuration: 800, cooldown: 1500, charges: 3 },

  { name: '铁刺阵', shape: 'circle', desc: '圆形范围·中伤',
    ingredients: { iron: 1, common: 1 },
    damage: 30, range: 70, stunDuration: 1200, cooldown: 1500, charges: 3 },

  { name: '玉刺阵', shape: 'circle', desc: '圆形范围·高伤',
    ingredients: { good: 1, common: 1 },
    damage: 45, range: 80, stunDuration: 1500, cooldown: 1500, charges: 4 },

  // ── 十字形范围 ──
  { name: '十字刀刃', shape: 'cross', desc: '十字范围·中伤',
    ingredients: { iron: 1, trash: 1 },
    damage: 25, range: 90, stunDuration: 1000, cooldown: 1800, charges: 3 },

  { name: '黑曜十字', shape: 'cross', desc: '十字范围·高伤远',
    ingredients: { obsidian: 1, iron: 1 },
    damage: 50, range: 110, stunDuration: 1800, cooldown: 1800, charges: 3 },

  // ── 锥形范围 ──
  { name: '水晶锥刺', shape: 'cone', desc: '锥形范围·中伤',
    ingredients: { crystal: 1, common: 1 },
    damage: 30, range: 100, stunDuration: 1200, cooldown: 2000, charges: 3 },

  { name: '琥珀火锥', shape: 'cone', desc: '锥形范围·范围大',
    ingredients: { amber: 1, common: 1 },
    damage: 25, range: 120, stunDuration: 1500, cooldown: 2000, charges: 4 },

  // ── 直线范围 ──
  { name: '直线刀墙', shape: 'line', desc: '直线范围·远距离',
    ingredients: { obsidian: 1, trash: 1 },
    damage: 35, range: 160, stunDuration: 1000, cooldown: 2000, charges: 3 },

  { name: '翠玉射线', shape: 'line', desc: '直线范围·超高伤',
    ingredients: { rare: 1, good: 1 },
    damage: 60, range: 200, stunDuration: 1500, cooldown: 2000, charges: 3 },

  // ── 方形范围 ──
  { name: '铁笼陷阱', shape: 'square', desc: '方形范围·中伤',
    ingredients: { iron: 2 },
    damage: 35, range: 80, stunDuration: 2000, cooldown: 2500, charges: 2 },

  { name: '玉笼陷阱', shape: 'square', desc: '方形范围·高伤长晕',
    ingredients: { good: 1, iron: 1 },
    damage: 50, range: 90, stunDuration: 3000, cooldown: 2500, charges: 2 },

  // ── 环形范围（外圈命中，中心安全）──
  { name: '雷石冲击波', shape: 'ring', desc: '环形范围·范围大',
    ingredients: { bomb: 1, common: 1 },
    damage: 40, range: 100, stunDuration: 2000, cooldown: 2500, charges: 2 },

  { name: '帝王冲击波', shape: 'ring', desc: '环形范围·超高伤',
    ingredients: { legendary: 1, rare: 1 },
    damage: 80, range: 140, stunDuration: 3000, cooldown: 2500, charges: 2 },
];

// ─── Constants ─────────────────────────────────────────────
const PLAYER_BASE_SPEED = 160;
const PLAYER_SPRINT_SPEED = 260;
const STAMINA_MAX = 100;
const STAMINA_DRAIN_RATE = 35;
const STAMINA_REGEN_RATE = 20;
const STAMINA_SPRINT_MIN = 5;

const CLEAN_DURATION = 1500;
const INTERACT_RANGE = 60;
const SPRAY_RANGE = 160;
const SPRAY_ANGLE = Math.PI / 12;
const MONSTER_STUN_DURATION = 2000;

const HIDE_SPOT_RANGE = 40;

const BOMB_RANGE = 200;
const BOMB_STUN = 5000;

const MONSTER_HP = 25;
const MONSTER_ELITE_HP = 60;
const CORE_VALUE = 50;
const CORE_ELITE_VALUE = 200;

// ─── Scene ────────────────────────────────────────────────────

export class TrapGambleScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private tabKey!: Phaser.Input.Keyboard.Key;
  private numberKeys!: Phaser.Input.Keyboard.Key[];

  // Quickbar (数字键即时搓)
  private quickbarText!: Phaser.GameObjects.Text;
  private quickbarRecipes: TrapRecipe[] = [];

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
  private fogTextureKey = 'trapGambleFog';
  private viewRadius = 180;
  private screenW = 800;
  private screenH = 600;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private stones: Stone[] = [];
  private monsters: Monster[] = [];
  private cores: CoreDrop[] = [];
  private exit!: Phaser.GameObjects.Rectangle;

  // Interaction
  private currentTarget: Stone | null = null;
  private isSpraying = false;
  private aimAngle = 0;
  private sprayGraphics!: Phaser.GameObjects.Graphics;

  // Inventory: collected stones (type → count)
  private inventory: Map<StoneType, number> = new Map();
  private coreCount = 0;
  private coreScore = 0;

  // Recipe codex (Tab 查看全部配方，只读)
  private codexOpen = false;
  private codexBg!: Phaser.GameObjects.Rectangle;
  private codexTitle!: Phaser.GameObjects.Text;
  private codexTexts: Phaser.GameObjects.Text[] = [];
  private codexBgRects: Phaser.GameObjects.Rectangle[] = [];

  // Placed traps
  private traps: PlacedTrap[] = [];

  // Player stats
  private health = 100;
  private goalScore = 1500;
  private damageCooldown = 0;
  private hasShield = false;

  // Sprint & stamina
  private stamina = STAMINA_MAX;
  private isSprinting = false;
  private staminaBar!: Phaser.GameObjects.Graphics;

  // Hide
  private isHidden = false;
  private hiddenSpot: HideSpot | null = null;

  // Evacuation
  private isEvacuating = false;
  private evacTimer = 0;
  private evacDuration = 3000;

  // Respawn timers
  private stoneRespawnTimer = 0;
  private monsterRespawnTimer = 0;
  private stoneRespawnInterval = 15000;
  private monsterRespawnInterval = 20000;
  private maxStones = 30;
  private maxMonsters = 5;

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
  private trapText!: Phaser.GameObjects.Text;
  private inventoryText!: Phaser.GameObjects.Text;

  // Trap placement preview
  private trapPreviewGraphics!: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: 'TrapGambleScene' });
  }

  create() {
    // ── 重置所有实例状态 ──
    this.isDead = false;
    this.isWon = false;
    this.health = 100;
    this.damageCooldown = 0;
    this.hasShield = false;
    this.isEvacuating = false;
    this.evacTimer = 0;
    this.isSpraying = false;
    this.currentTarget = null;
    this.aimAngle = 0;
    this.stones = [];
    this.monsters = [];
    this.cores = [];
    this.obstacles = [];
    this.hideSpots = [];
    this.traps = [];
    this.stamina = STAMINA_MAX;
    this.isSprinting = false;
    this.isHidden = false;
    this.hiddenSpot = null;
    this.stoneRespawnTimer = 0;
    this.monsterRespawnTimer = 0;
    this.inventory = new Map();
    this.coreCount = 0;
    this.coreScore = 0;
    this.codexOpen = false;
    this.quickbarRecipes = [];

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateBuilding();
    this.generateHideRooms();
    this.drawMap();
    this.createPlayer();
    this.createStones();
    this.createMonsters();
    this.createExit();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.sprayGraphics = this.add.graphics();
    this.sprayGraphics.setDepth(7);

    this.trapPreviewGraphics = this.add.graphics();
    this.trapPreviewGraphics.setDepth(6.5);

    this.showMessage('🎰 赌石猎核·陷阱版！\n\n左键 = 水枪（清洗石头 / 喷晕怪物）\n空格 = 放置陷阱（需先搓出陷阱）\n数字键1~9 = 即时搓陷阱（材料够才显示）\nTab = 查看全部配方\n\n玩家无直接攻击！只能靠陷阱打怪！\n陷阱形状各异：圆形/十字/锥形/直线/方形/环形\n\n铁矿→刺阵 | 黑曜石→十字/直线\n水晶→锥刺 | 琥珀→火锥\n帝王绿→帝王冲击波\n药石回血 | 盾石护盾 | 雷石→冲击波\n\n打怪掉灵核 → 灵核加分！\nShift疾跑 | E键躲藏\n\n价值达' + this.goalScore + ' → 到撤离点撤离！', 9000);
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

  // ─── Hide rooms ─────────────────────────────────────────────

  private generateHideRooms() {
    this.hideSpots = [];
    const roomCount = 7;
    const roomSize = 90;
    const wallT = 12;
    const doorGap = 36;
    let placed = 0;
    let attempts = 0;

    while (placed < roomCount && attempts < 500) {
      attempts++;
      const x = Phaser.Math.Between(120, this.mapWidth - 120 - roomSize);
      const y = Phaser.Math.Between(120, this.mapHeight - 120 - roomSize);

      if (Phaser.Math.Distance.Between(x + roomSize / 2, y + roomSize / 2, 80, 80) < 200) continue;
      if (Phaser.Math.Distance.Between(x + roomSize / 2, y + roomSize / 2, this.mapWidth - 80, this.mapHeight - 80) < 200) continue;

      let tooClose = false;
      for (const hs of this.hideSpots) {
        if (Phaser.Math.Distance.Between(x + roomSize / 2, y + roomSize / 2, hs.x + hs.w / 2, hs.y + hs.h / 2) < 250) {
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

    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

    this.mapGraphics.lineStyle(1, 0x222244, 0.3);
    for (let x = 0; x < this.mapWidth; x += 80) {
      this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += 80) {
      this.mapGraphics.lineBetween(0, y, this.mapWidth, y);
    }

    this.mapGraphics.fillStyle(0x3a3a55, 1);
    for (const obs of this.obstacles) {
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
      this.mapGraphics.lineStyle(1, 0x555577, 0.5);
      this.mapGraphics.strokeRect(obs.x, obs.y, obs.w, obs.h);
    }

    this.mapGraphics.fillStyle(0x1a2a4e, 0.6);
    for (const hs of this.hideSpots) {
      this.mapGraphics.fillRect(hs.x, hs.y, hs.w, hs.h);
      this.mapGraphics.lineStyle(2, 0x4466aa, 0.4);
      this.mapGraphics.strokeRect(hs.x, hs.y, hs.w, hs.h);
    }

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

      this.stones.push(this.makeStone(x, y));
      placed++;
      attempts++;
    }
  }

  private makeStone(x: number, y: number): Stone {
    const radius = Phaser.Math.Between(14, 24);
    const tier = this.rollStoneType();
    const stoneValue = tier.isUtility ? 0 : Phaser.Math.Between(tier.minVal, tier.maxVal);

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

    const dirtColors = [0x3a2a1a, 0x2a2a2a, 0x3a322a, 0x2a1a1a];
    const dirtColor = Phaser.Utils.Array.GetRandom(dirtColors);
    const shellG = this.add.graphics();
    shellG.fillStyle(dirtColor, 0.9);
    shellG.fillCircle(0, 0, radius * 1.1);
    shellG.setPosition(x, y);
    shellG.setDepth(2);

    const prompt = this.add.text(x, y - radius - 12, '', {
      fontSize: '12px', color: '#ffff00',
    }).setOrigin(0.5).setDepth(6);

    return {
      x, y, radius,
      stoneType: tier.type,
      stoneValue,
      state: 0,
      cleanProgress: 0,
      shellSprite: shellG,
      innerSprite: innerG,
      promptText: prompt,
    };
  }

  private rollStoneType(): StoneTier {
    let roll = Math.random() * STONE_TIERS_TOTAL_WEIGHT;
    for (const tier of STONE_TIERS) {
      roll -= tier.weight;
      if (roll <= 0) return tier;
    }
    return STONE_TIERS[0];
  }

  // ── 补充石头 ──
  private spawnStone() {
    let attempts = 0;
    while (attempts < 200) {
      const x = Phaser.Math.Between(60, this.mapWidth - 60);
      const y = Phaser.Math.Between(60, this.mapHeight - 60);

      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 150) { attempts++; continue; }
      if (this.isInsideObstacle(x, y, 18)) { attempts++; continue; }

      this.stones.push(this.makeStone(x, y));
      return;
    }
  }

  // ── 补充怪物 ──
  private spawnMonster() {
    let attempts = 0;
    while (attempts < 200) {
      const x = Phaser.Math.Between(120, this.mapWidth - 120);
      const y = Phaser.Math.Between(120, this.mapHeight - 120);

      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 400) { attempts++; continue; }
      if (this.isInsideObstacle(x, y, 14)) { attempts++; continue; }

      const isElite = Math.random() < 0.25;
      const hp = isElite ? MONSTER_ELITE_HP : MONSTER_HP;
      const color = isElite ? 0xff4444 : 0xff00ff;
      const size = isElite ? 32 : 24;

      const sprite = this.add.rectangle(x, y, size, size, color);
      sprite.setDepth(5);
      if (isElite) sprite.setStrokeStyle(2, 0xffff00);

      this.monsters.push({
        sprite,
        speed: isElite ? 30 : 25,
        chaseSpeed: isElite ? 110 : 100,
        direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
        patrolTimer: Phaser.Math.Between(0, 3000),
        isChasing: false,
        visionRange: isElite ? 220 : 180,
        visionAngle: Math.PI / 3,
        homeX: x,
        homeY: y,
        giveUpTimer: 0,
        giveUpDuration: 10000,
        stunTimer: 0,
        attackCooldown: 0,
        hp,
        maxHp: hp,
        isElite,
      });
      return;
    }
  }

  // ── 定时补充石头和怪物 ──
  private updateRespawn(delta: number) {
    const availableStones = this.stones.filter(s => s.state === 0 || s.state === 1 || s.state === 2).length;

    this.stoneRespawnTimer += delta;
    if (this.stoneRespawnTimer >= this.stoneRespawnInterval && availableStones < this.maxStones) {
      this.stoneRespawnTimer = 0;
      const toSpawn = Math.min(3, this.maxStones - availableStones);
      for (let i = 0; i < toSpawn; i++) {
        this.spawnStone();
      }
    }

    this.monsterRespawnTimer += delta;
    if (this.monsterRespawnTimer >= this.monsterRespawnInterval && this.monsters.length < this.maxMonsters) {
      this.monsterRespawnTimer = 0;
      this.spawnMonster();
    }
  }

  // ─── Monsters ───────────────────────────────────────────────

  private createMonsters() {
    const monsterCount = 5;
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

      const isElite = placed < 1;
      const hp = isElite ? MONSTER_ELITE_HP : MONSTER_HP;
      const color = isElite ? 0xff4444 : 0xff00ff;
      const size = isElite ? 32 : 24;

      const sprite = this.add.rectangle(x, y, size, size, color);
      sprite.setDepth(5);
      if (isElite) sprite.setStrokeStyle(2, 0xffff00);

      this.monsters.push({
        sprite,
        speed: isElite ? 30 : 25,
        chaseSpeed: isElite ? 110 : 100,
        direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
        patrolTimer: Phaser.Math.Between(0, 3000),
        isChasing: false,
        visionRange: isElite ? 220 : 180,
        visionAngle: Math.PI / 3,
        homeX: x,
        homeY: y,
        giveUpTimer: 0,
        giveUpDuration: 10000,
        stunTimer: 0,
        attackCooldown: 0,
        hp,
        maxHp: hp,
        isElite,
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

    this.scoreText = this.add.text(16, 40, '价值: 0 / ' + this.goalScore, {
      fontSize: '18px', color: '#ffdd00',
    }).setScrollFactor(0).setDepth(20);

    this.trapText = this.add.text(16, 64, '陷阱: 无', {
      fontSize: '16px', color: '#ff88ff',
    }).setScrollFactor(0).setDepth(20);

    this.statusText = this.add.text(16, 88, '', {
      fontSize: '14px', color: '#ff8844',
    }).setScrollFactor(0).setDepth(20);

    // Inventory text (right side)
    this.inventoryText = this.add.text(580, 16, '', {
      fontSize: '13px', color: '#aaffaa', align: 'left',
      backgroundColor: '#00000088', padding: { x: 6, y: 4 },
    }).setScrollFactor(0).setDepth(20);

    // Quickbar (bottom center, shows craftable traps with number keys)
    this.quickbarText = this.add.text(400, 575, '', {
      fontSize: '13px', color: '#ffffff', align: 'center',
      backgroundColor: '#000000aa', padding: { x: 8, y: 3 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    // Recipe codex (Tab to view all, read-only)
    this.codexBg = this.add.rectangle(400, 300, 500, 420, 0x000000, 0.92)
      .setScrollFactor(0).setDepth(40).setVisible(false);
    this.codexBg.setStrokeStyle(2, 0x888888);
    this.codexTitle = this.add.text(400, 110, '配方图鉴 [Tab/Esc关]', {
      fontSize: '18px', color: '#ffff00',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(41).setVisible(false);

    this.evacText = this.add.text(400, 300, '', {
      fontSize: '32px', color: '#00ff00', align: 'center',
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

  // ── 预估价值 = 灵核分 + 背包石头预估分 ──
  private getEstimatedScore(): number {
    let estimated = this.coreScore;
    for (const [type, count] of this.inventory) {
      const tier = STONE_TIERS.find(t => t.type === type)!;
      if (!tier.isUtility) {
        estimated += Math.floor((tier.minVal + tier.maxVal) / 2 * 0.5) * count;
      }
    }
    return estimated;
  }

  private updateScoreUI() {
    const estimated = this.getEstimatedScore();
    const newText = `价值: ${estimated} / ${this.goalScore}`;
    if (this.scoreText.text !== newText) {
      this.scoreText.setText(newText);
      if (estimated >= this.goalScore) {
        this.scoreText.setColor('#00ff00');
      } else {
        this.scoreText.setColor('#ffdd00');
      }
    }
  }

  private updateInventoryUI() {
    const lines: string[] = [];
    for (const [type, count] of this.inventory) {
      if (count <= 0) continue;
      const tier = STONE_TIERS.find(t => t.type === type)!;
      lines.push(`${tier.name}×${count}`);
    }
    if (this.coreCount > 0) {
      lines.push(`灵核×${this.coreCount}`);
    }
    const newText = lines.length > 0 ? '背包:\n' + lines.join('\n') : '背包: 空';
    if (this.inventoryText.text !== newText) {
      this.inventoryText.setText(newText);
    }
  }

  private updateTrapUI() {
    const readyTraps = this.traps.filter(t => t.charges > 0);
    if (readyTraps.length === 0) {
      const newText = '陷阱: 无';
      if (this.trapText.text !== newText) this.trapText.setText(newText);
    } else {
      const t = readyTraps[0];
      const shapeIcon = this.getShapeIcon(t.recipe.shape);
      const newText = `${shapeIcon}${t.recipe.name} 剩${t.charges}次 伤${t.recipe.damage}`;
      if (this.trapText.text !== newText) this.trapText.setText(newText);
    }
  }

  private getShapeIcon(shape: TrapShape): string {
    switch (shape) {
      case 'circle': return '⭕';
      case 'cross': return '✛';
      case 'cone': return '◢';
      case 'line': return '▬';
      case 'square': return '⬛';
      case 'ring': return '◯';
    }
  }

  private updateStatusUI() {
    const effects: string[] = [];
    if (this.hasShield) effects.push('🛡护盾');
    const newText = effects.join(' ');
    if (this.statusText.text !== newText) {
      this.statusText.setText(newText);
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
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.tabKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
    this.numberKeys = [
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.FIVE),
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SIX),
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SEVEN),
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.EIGHT),
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.NINE),
    ];

    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isDead || this.isWon || this.codexOpen) return;

      if (pointer.leftButtonDown()) {
        // ── 左键：水枪（清洗石头 / 喷晕怪物）──
        this.isSpraying = true;
        // 如果近处有已清洗的石头，左键捡入背包
        const target = this.findNearestStone();
        if (target && target.state === 2) {
          this.collectStone(target);
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

    // Recipe codex open: Tab/Esc to close
    if (this.codexOpen) {
      if (Phaser.Input.Keyboard.JustDown(this.escKey) || Phaser.Input.Keyboard.JustDown(this.tabKey)) {
        this.closeCodex();
        return;
      }
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    // Tab = open recipe codex (read-only)
    if (Phaser.Input.Keyboard.JustDown(this.tabKey)) {
      this.openCodex();
      return;
    }

    // E 键躲藏/离开
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.tryHide();
    }

    // 数字键即时搓陷阱
    for (let i = 0; i < this.numberKeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(this.numberKeys[i])) {
        if (i < this.quickbarRecipes.length) {
          this.tryCraft(this.quickbarRecipes[i]);
        }
        break;
      }
    }

    // 空格：放置陷阱（在玩家当前位置放置最近的可用陷阱）
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.placeTrap();
    }

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

    if (!this.isHidden) {
      this.handlePlayerMovement(delta);
      this.updateSpray(delta);
    } else {
      this.sprayGraphics.clear();
      this.isSpraying = false;
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_RATE * (delta / 1000));
    }

    this.updateMonsters(delta);
    this.updateTraps(delta);
    this.checkMonsterCollision();
    this.checkCorePickup();
    this.updateRespawn(delta);
    this.checkEvacuation(delta);
    this.updateFog();
    this.updateStatusUI();
    this.updateTrapUI();
    this.updateInventoryUI();
    this.updateQuickbar();
    this.updateScoreUI();
    this.drawStaminaBar();
    this.drawTrapPreview();

    if (this.damageCooldown > 0) this.damageCooldown -= delta;
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
    const barY = 112;
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
      if (stone.state !== 0) continue;

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

      monster.stunTimer = MONSTER_STUN_DURATION;
      monster.isChasing = true;
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
          if (tier.isUtility) {
            stone.promptText.setText(`${tier.clue}\n[左键]使用`);
          } else {
            stone.promptText.setText(`${tier.clue}\n[左键]捡入背包`);
          }
        }
      } else {
        if (stone.state === 0 && !this.isSpraying) {
          stone.promptText.setText('');
        }
      }
    }
  }

  // ── 捡石头入背包 ──
  private collectStone(stone: Stone) {
    const tier = STONE_TIERS.find(t => t.type === stone.stoneType)!;
    stone.state = 3;

    if (tier.isUtility) {
      // 功能石直接使用
      if (tier.type === 'medkit') {
        this.health = Math.min(100, this.health + 30);
        this.showMessage('💊 药石！恢复30生命', 2000);
        this.updateHealthUI();
      } else if (tier.type === 'shield') {
        this.hasShield = true;
        this.showMessage('🛡 盾石！获得护盾', 2000);
      } else if (tier.type === 'bomb') {
        this.cam.flash(200, 255, 136, 0);
        this.cam.shake(300, 0.01);
        for (const m of this.monsters) {
          const d = Phaser.Math.Distance.Between(stone.x, stone.y, m.sprite.x, m.sprite.y);
          if (d < BOMB_RANGE) {
            m.stunTimer = BOMB_STUN;
            m.isChasing = true;
            m.giveUpTimer = m.giveUpDuration;
          }
        }
        this.showMessage('💥 雷石爆炸！范围内怪物眩晕5秒', 2500);
      }
    } else {
      // 普通石头入背包
      const count = this.inventory.get(tier.type) ?? 0;
      this.inventory.set(tier.type, count + 1);
      this.showMessage(`📦 捡起 ${tier.name}！\n数字键搓陷阱 | 空格放置`, 1500);
    }

    stone.promptText.setText('');
    stone.shellSprite.setVisible(false);
    stone.innerSprite.setVisible(false);
    this.spawnResultTag(stone, `${tier.name}`);
  }

  // ── 更新快捷栏（显示当前可搓的配方 + 数字键）──
  private updateQuickbar() {
    this.quickbarRecipes = TRAP_RECIPES.filter(r => this.canCraft(r)).slice(0, 9);

    if (this.quickbarRecipes.length === 0) {
      const newText = '背包材料不足，继续捡石头';
      if (this.quickbarText.text !== newText) this.quickbarText.setText(newText);
      return;
    }

    const parts: string[] = [];
    for (let i = 0; i < this.quickbarRecipes.length; i++) {
      const r = this.quickbarRecipes[i];
      const icon = this.getShapeIcon(r.shape);
      parts.push(`${i + 1}${icon}${r.name}`);
    }
    const newText = parts.join('  ');
    if (this.quickbarText.text !== newText) this.quickbarText.setText(newText);
  }

  // ── 打开配方图鉴（只读）──
  private openCodex() {
    this.codexOpen = true;
    this.codexBg.setVisible(true);
    this.codexTitle.setVisible(true);
    this.refreshCodex();
  }

  // ── 关闭配方图鉴 ──
  private closeCodex() {
    this.codexOpen = false;
    this.codexBg.setVisible(false);
    this.codexTitle.setVisible(false);
    for (const t of this.codexTexts) t.destroy();
    for (const r of this.codexBgRects) r.destroy();
    this.codexTexts = [];
    this.codexBgRects = [];
  }

  // ── 刷新配方图鉴 ──
  private refreshCodex() {
    for (const t of this.codexTexts) t.destroy();
    for (const r of this.codexBgRects) r.destroy();
    this.codexTexts = [];
    this.codexBgRects = [];

    const startY = 150;
    const lineH = 26;

    for (let i = 0; i < TRAP_RECIPES.length; i++) {
      const recipe = TRAP_RECIPES[i];
      const canCraft = this.canCraft(recipe);

      const y = startY + i * lineH;
      const bgRect = this.add.rectangle(400, y, 480, lineH - 2, canCraft ? 0x223322 : 0x222233, 0.9)
        .setScrollFactor(0).setDepth(41);
      this.codexBgRects.push(bgRect);

      // 配方材料
      const ingreStrs: string[] = [];
      for (const [type, count] of Object.entries(recipe.ingredients)) {
        const tier = STONE_TIERS.find(t => t.type === type)!;
        const have = this.inventory.get(type as StoneType) ?? 0;
        const ok = have >= count;
        ingreStrs.push(`${ok ? '✓' : '✗'}${tier.name} ${have}/${count}`);
      }

      const shapeIcon = this.getShapeIcon(recipe.shape);
      const text = ` ${shapeIcon}${recipe.name} ${recipe.desc} | ${ingreStrs.join(' + ')}`;
      const txt = this.add.text(170, y - 10, text, {
        fontSize: '13px', color: canCraft ? '#ffffff' : '#666666',
      }).setScrollFactor(0).setDepth(42);
      this.codexTexts.push(txt);
    }
  }

  // ── 检查能否搓某配方 ──
  private canCraft(recipe: TrapRecipe): boolean {
    for (const [type, count] of Object.entries(recipe.ingredients)) {
      const have = this.inventory.get(type as StoneType) ?? 0;
      if (have < count) return false;
    }
    return true;
  }

  // ── 搓陷阱（数字键即时搓）──
  private tryCraft(recipe: TrapRecipe) {
    if (!this.canCraft(recipe)) {
      this.showMessage('材料不足！', 1000);
      return;
    }

    // 消耗材料
    for (const [type, count] of Object.entries(recipe.ingredients)) {
      const have = this.inventory.get(type as StoneType) ?? 0;
      this.inventory.set(type as StoneType, have - count);
    }

    // 生成陷阱（放入待放置列表）
    const trap: PlacedTrap = {
      recipe,
      x: 0,
      y: 0,
      angle: 0,
      charges: recipe.charges,
      cooldown: 0,
      placed: false,
      sprite: null,
      rangeSprite: null,
    };
    this.traps.push(trap);

    const shapeIcon = this.getShapeIcon(recipe.shape);
    this.showMessage(`${shapeIcon} 搓出 ${recipe.name}！伤${recipe.damage} 晕${(recipe.stunDuration / 1000).toFixed(1)}s ${recipe.charges}次`, 1500);
  }

  // ── 放置陷阱（空格键）──
  private placeTrap() {
    // 找第一个未放置的陷阱
    const trap = this.traps.find(t => !t.placed);
    if (!trap) {
      this.showMessage('没有可放置的陷阱！\n数字键先搓陷阱', 1500);
      return;
    }

    // 不能放在障碍物里
    if (this.collidesWithObstacle(this.player.x, this.player.y, 12)) {
      this.showMessage('不能在墙里放陷阱！', 1500);
      return;
    }

    trap.x = this.player.x;
    trap.y = this.player.y;
    trap.angle = this.aimAngle;
    trap.placed = true;

    // 陷阱本体
    const sprite = this.add.circle(trap.x, trap.y, 10, 0xff44ff, 0.8);
    sprite.setDepth(4);
    sprite.setStrokeStyle(2, 0xffffff);
    trap.sprite = sprite;

    // 范围预览（半透明）
    const rangeSprite = this.add.graphics();
    rangeSprite.setDepth(3.5);
    this.drawTrapRange(rangeSprite, trap, 0x884488, 0.15);
    trap.rangeSprite = rangeSprite;

    const shapeIcon = this.getShapeIcon(trap.recipe.shape);
    this.showMessage(`${shapeIcon} ${trap.recipe.name} 已放置！\n怪物进入范围时触发`, 1500);
  }

  // ── 绘制陷阱攻击范围 ──
  private drawTrapRange(g: Phaser.GameObjects.Graphics, trap: PlacedTrap, color: number, alpha: number) {
    g.clear();
    const r = trap.recipe.range;

    g.fillStyle(color, alpha);
    g.lineStyle(2, color, alpha + 0.2);

    switch (trap.recipe.shape) {
      case 'circle': {
        g.fillCircle(trap.x, trap.y, r);
        g.strokeCircle(trap.x, trap.y, r);
        break;
      }
      case 'cross': {
        // 十字形：4个方向的长条
        const armW = 24;
        g.fillRect(trap.x - armW / 2, trap.y - r, armW, r * 2);
        g.fillRect(trap.x - r, trap.y - armW / 2, r * 2, armW);
        g.strokeRect(trap.x - armW / 2, trap.y - r, armW, r * 2);
        g.strokeRect(trap.x - r, trap.y - armW / 2, r * 2, armW);
        break;
      }
      case 'cone': {
        // 锥形：朝陷阱朝向方向
        const halfAngle = Math.PI / 4; // 90度锥
        g.beginPath();
        g.moveTo(trap.x, trap.y);
        g.lineTo(
          trap.x + Math.cos(trap.angle - halfAngle) * r,
          trap.y + Math.sin(trap.angle - halfAngle) * r
        );
        g.lineTo(
          trap.x + Math.cos(trap.angle + halfAngle) * r,
          trap.y + Math.sin(trap.angle + halfAngle) * r
        );
        g.closePath();
        g.fillPath();
        g.strokePath();
        break;
      }
      case 'line': {
        // 直线：朝陷阱朝向方向的窄长条
        const halfW = 16;
        const perpX = -Math.sin(trap.angle);
        const perpY = Math.cos(trap.angle);
        g.beginPath();
        g.moveTo(
          trap.x + perpX * halfW,
          trap.y + perpY * halfW
        );
        g.lineTo(
          trap.x - perpX * halfW,
          trap.y - perpY * halfW
        );
        g.lineTo(
          trap.x - perpX * halfW + Math.cos(trap.angle) * r,
          trap.y - perpY * halfW + Math.sin(trap.angle) * r
        );
        g.lineTo(
          trap.x + perpX * halfW + Math.cos(trap.angle) * r,
          trap.y + perpY * halfW + Math.sin(trap.angle) * r
        );
        g.closePath();
        g.fillPath();
        g.strokePath();
        break;
      }
      case 'square': {
        // 方形：以陷阱为中心的正方形
        const half = r;
        g.fillRect(trap.x - half, trap.y - half, half * 2, half * 2);
        g.strokeRect(trap.x - half, trap.y - half, half * 2, half * 2);
        break;
      }
      case 'ring': {
        // 环形：外圈命中，内圈安全
        g.beginPath();
        g.arc(trap.x, trap.y, r, 0, Math.PI * 2);
        g.fillPath();
        // 挖空内圈（用不同颜色模拟）
        g.fillStyle(0x1a1a2e, 0.9);
        g.fillCircle(trap.x, trap.y, r * 0.4);
        g.lineStyle(2, color, alpha + 0.3);
        g.strokeCircle(trap.x, trap.y, r);
        g.strokeCircle(trap.x, trap.y, r * 0.4);
        break;
      }
    }
  }

  // ── 更新陷阱（检测怪物进入范围 → 触发）──
  private updateTraps(delta: number) {
    for (const trap of this.traps) {
      if (!trap.placed) continue;
      if (trap.charges <= 0) continue;
      if (trap.cooldown > 0) {
        trap.cooldown -= delta;
        continue;
      }

      // 检测怪物是否在攻击范围内
      for (const monster of this.monsters) {
        if (this.isMonsterInTrapRange(trap, monster)) {
          this.triggerTrap(trap, monster);
          break; // 一次只触发一个
        }
      }
    }

    // 清理已耗尽的陷阱
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const trap = this.traps[i];
      if (trap.placed && trap.charges <= 0) {
        if (trap.sprite) trap.sprite.destroy();
        if (trap.rangeSprite) trap.rangeSprite.destroy();
        this.traps.splice(i, 1);
      }
    }
  }

  // ── 判断怪物是否在陷阱攻击范围内 ──
  private isMonsterInTrapRange(trap: PlacedTrap, monster: Monster): boolean {
    const mx = monster.sprite.x;
    const my = monster.sprite.y;
    const r = trap.recipe.range;

    switch (trap.recipe.shape) {
      case 'circle': {
        return Phaser.Math.Distance.Between(trap.x, trap.y, mx, my) < r;
      }
      case 'cross': {
        // 十字形：4个方向的长条
        const armW = 12; // 命中宽度（比显示窄）
        const dx = Math.abs(mx - trap.x);
        const dy = Math.abs(my - trap.y);
        // 垂直臂
        if (dx < armW && dy < r) return true;
        // 水平臂
        if (dy < armW && dx < r) return true;
        return false;
      }
      case 'cone': {
        const dist = Phaser.Math.Distance.Between(trap.x, trap.y, mx, my);
        if (dist > r) return false;
        const angleToMonster = Math.atan2(my - trap.y, mx - trap.x);
        let angleDiff = Math.abs(angleToMonster - trap.angle);
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
        return angleDiff < Math.PI / 4; // 90度锥
      }
      case 'line': {
        // 直线：朝向方向的窄长条
        const dist = Phaser.Math.Distance.Between(trap.x, trap.y, mx, my);
        if (dist > r) return false;
        const angleToMonster = Math.atan2(my - trap.y, mx - trap.x);
        let angleDiff = Math.abs(angleToMonster - trap.angle);
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
        // 窄角度
        return angleDiff < Math.PI / 16; // ~11度
      }
      case 'square': {
        const half = r;
        return mx > trap.x - half && mx < trap.x + half &&
               my > trap.y - half && my < trap.y + half;
      }
      case 'ring': {
        const dist = Phaser.Math.Distance.Between(trap.x, trap.y, mx, my);
        return dist < r && dist > r * 0.4;
      }
    }
  }

  // ── 触发陷阱 ──
  private triggerTrap(trap: PlacedTrap, monster: Monster) {
    monster.hp -= trap.recipe.damage;
    monster.stunTimer = trap.recipe.stunDuration;
    monster.isChasing = true;
    monster.giveUpTimer = monster.giveUpDuration;

    trap.charges--;
    trap.cooldown = trap.recipe.cooldown;

    // 视觉效果
    this.cam.shake(100, 0.004);
    this.cam.flash(80, 255, 100, 255);

    // 闪烁陷阱范围
    if (trap.rangeSprite) {
      this.drawTrapRange(trap.rangeSprite, trap, 0xffff00, 0.5);
      this.time.delayedCall(200, () => {
        if (trap.rangeSprite && trap.charges > 0) {
          this.drawTrapRange(trap.rangeSprite, trap, 0x884488, 0.15);
        }
      });
    }

    const shapeIcon = this.getShapeIcon(trap.recipe.shape);
    this.showMessage(`${shapeIcon} ${trap.recipe.name} 触发！\n-${trap.recipe.damage}伤 眩晕${(trap.recipe.stunDuration / 1000).toFixed(1)}s\n剩余${trap.charges}次`, 1200);

    if (monster.hp <= 0) {
      this.killMonster(monster);
    }
  }

  // ── 陷阱放置预览（跟随玩家）──
  private drawTrapPreview() {
    this.trapPreviewGraphics.clear();

    const unplaced = this.traps.find(t => !t.placed);
    if (!unplaced) return;

    // 在玩家位置预览范围
    const previewTrap: PlacedTrap = {
      recipe: unplaced.recipe,
      x: this.player.x,
      y: this.player.y,
      angle: this.aimAngle,
      charges: unplaced.charges,
      cooldown: 0,
      placed: false,
      sprite: null,
      rangeSprite: null,
    };
    this.drawTrapRange(this.trapPreviewGraphics, previewTrap, 0x44ff44, 0.1);
  }

  // ── 击杀怪物 ──
  private killMonster(monster: Monster) {
    const coreValue = monster.isElite ? CORE_ELITE_VALUE : CORE_VALUE;
    const coreColor = monster.isElite ? 0xff44ff : 0x44ffff;

    const coreSprite = this.add.circle(monster.sprite.x, monster.sprite.y, 8, coreColor);
    coreSprite.setDepth(4);
    coreSprite.setStrokeStyle(2, 0xffffff);

    this.cores.push({
      x: monster.sprite.x,
      y: monster.sprite.y,
      value: coreValue,
      isElite: monster.isElite,
      sprite: coreSprite,
    });

    this.cam.flash(100, 255, 255, 255);
    this.cam.shake(150, 0.005);

    monster.sprite.destroy();
    const idx = this.monsters.indexOf(monster);
    if (idx >= 0) this.monsters.splice(idx, 1);
  }

  // ── 拾取灵核 ──
  private checkCorePickup() {
    const toRemove: number[] = [];

    for (let i = 0; i < this.cores.length; i++) {
      const core = this.cores[i];
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, core.x, core.y);
      if (dist < 30) {
        this.coreCount++;
        this.coreScore += core.value;
        this.showMessage(`💎 灵核 +${core.value}分！${core.isElite ? '（精英！）' : ''}`, 2000);
        core.sprite.destroy();
        toRemove.push(i);
      }
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.cores.splice(toRemove[i], 1);
    }
  }

  // ── 浮动结果标记 ──
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
    if (this.isHidden) return;

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
    const estimated = this.getEstimatedScore();

    if (estimated < this.goalScore) {
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
    this.showMessage(`💀 ${cause}\n\n最终价值: ${this.getEstimatedScore()}\n\n按ESC返回菜单`, 999999);
  }

  private win() {
    this.isWon = true;
    this.showMessage(`🎉 成功撤离！\n\n灵核×${this.coreCount}  石头估值\n总价值: ${this.getEstimatedScore()}\n\n按ESC返回菜单`, 999999);
  }
}

// ─── Placed trap ─────────────────────────────────────────────

interface PlacedTrap {
  recipe: TrapRecipe;
  x: number;
  y: number;
  angle: number;
  charges: number;
  cooldown: number;
  placed: boolean;
  sprite: Phaser.GameObjects.Arc | null;
  rangeSprite: Phaser.GameObjects.Graphics | null;
}
