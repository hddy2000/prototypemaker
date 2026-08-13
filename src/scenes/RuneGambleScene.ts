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

  // ── 近战专用石 ──
  { type: 'iron', color: 0x888899, glowColor: 0xaaaabb, name: '铁矿', minVal: 40, maxVal: 80, weight: 10, clue: '金属光泽…', isUtility: false },
  { type: 'obsidian', color: 0x1a1a3a, glowColor: 0x3344aa, name: '黑曜石', minVal: 60, maxVal: 120, weight: 8, clue: '黑色锋利…', isUtility: false },

  // ── 远程专用石 ──
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
// 0=未清洗  1=清洗中  2=已清洗(待决策)  3=已拿走  4=已做成武器  5=已放弃
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

// ─── Weapon ───────────────────────────────────────────────────
type WeaponMode = 'none' | 'melee' | 'ranged';

interface Weapon {
  mode: WeaponMode;
  weaponName: string;
  stoneType: StoneType;  // 主石种（用于武器颜色/弹幕颜色）
  durability: number;
  maxDurability: number;
  damage: number;
  range: number;
  cooldown: number;
  knockback: number;
  projectileSpeed: number;
  projectileCount: number;
  spread: number;
}

// ─── Constants（必须在 CRAFT_RECIPES 之前，配方引用了 RANGED_RANGE 等）──
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

const MELEE_RANGE = 50;
const MELEE_COOLDOWN = 400;
const RANGED_RANGE = 300;
const RANGED_PROJECTILE_SPEED = 400;
const RANGED_COOLDOWN = 300;
const BOMB_RANGE = 200;
const BOMB_STUN = 5000;

const MONSTER_HP = 25;
const MONSTER_ELITE_HP = 60;
const CORE_VALUE = 50;
const CORE_ELITE_VALUE = 200;

// ── 搓武器配方：需要多种石头组合 ──
interface CraftRecipe {
  name: string;
  mode: 'melee' | 'ranged';
  ingredients: Partial<Record<StoneType, number>>;  // 需要的石头及数量
  result: Omit<Weapon, 'mode' | 'weaponName' | 'stoneType'>;
  desc: string;
}

const CRAFT_RECIPES: CraftRecipe[] = [
  // ── 近战 ──
  { name: '石棍', mode: 'melee', desc: '低伤高耐久',
    ingredients: { trash: 2 },
    result: { durability: 6, maxDurability: 6, damage: 15, range: 45, cooldown: 400, knockback: 15, projectileSpeed: 0, projectileCount: 1, spread: 0 } },

  { name: '石刀', mode: 'melee', desc: '中伤中耐久',
    ingredients: { common: 1, trash: 1 },
    result: { durability: 8, maxDurability: 8, damage: 25, range: 50, cooldown: 400, knockback: 12, projectileSpeed: 0, projectileCount: 1, spread: 0 } },

  { name: '铁锤', mode: 'melee', desc: '中伤+强击退',
    ingredients: { iron: 2, common: 1 },
    result: { durability: 12, maxDurability: 12, damage: 35, range: 55, cooldown: 500, knockback: 30, projectileSpeed: 0, projectileCount: 1, spread: 0 } },

  { name: '黑曜刃', mode: 'melee', desc: '高伤低耐久',
    ingredients: { obsidian: 1, iron: 1 },
    result: { durability: 6, maxDurability: 6, damage: 55, range: 50, cooldown: 350, knockback: 10, projectileSpeed: 0, projectileCount: 1, spread: 0 } },

  { name: '玉刃', mode: 'melee', desc: '高伤高耐久',
    ingredients: { good: 1, common: 1 },
    result: { durability: 10, maxDurability: 10, damage: 40, range: 55, cooldown: 350, knockback: 15, projectileSpeed: 0, projectileCount: 1, spread: 0 } },

  { name: '翠玉矛', mode: 'melee', desc: '远距离高伤',
    ingredients: { rare: 1, good: 1 },
    result: { durability: 14, maxDurability: 14, damage: 60, range: 70, cooldown: 350, knockback: 20, projectileSpeed: 0, projectileCount: 1, spread: 0 } },

  { name: '帝王爪', mode: 'melee', desc: '超高伤快攻速',
    ingredients: { legendary: 1, rare: 1 },
    result: { durability: 20, maxDurability: 20, damage: 100, range: 60, cooldown: 250, knockback: 25, projectileSpeed: 0, projectileCount: 1, spread: 0 } },

  // ── 远程 ──
  { name: '弹弓', mode: 'ranged', desc: '弱远程',
    ingredients: { trash: 2 },
    result: { durability: 5, maxDurability: 5, damage: 12, range: RANGED_RANGE, cooldown: RANGED_COOLDOWN, knockback: 0, projectileSpeed: 300, projectileCount: 1, spread: 0 } },

  { name: '手枪', mode: 'ranged', desc: '中伤中弹药',
    ingredients: { common: 2 },
    result: { durability: 6, maxDurability: 6, damage: 20, range: RANGED_RANGE, cooldown: RANGED_COOLDOWN, knockback: 0, projectileSpeed: 400, projectileCount: 1, spread: 0 } },

  { name: '水晶步枪', mode: 'ranged', desc: '远程高伤',
    ingredients: { crystal: 1, common: 1 },
    result: { durability: 8, maxDurability: 8, damage: 30, range: RANGED_RANGE, cooldown: RANGED_COOLDOWN, knockback: 0, projectileSpeed: 500, projectileCount: 1, spread: 0 } },

  { name: '琥珀散弹', mode: 'ranged', desc: '5发散射',
    ingredients: { amber: 1, common: 1 },
    result: { durability: 4, maxDurability: 4, damage: 12, range: RANGED_RANGE, cooldown: RANGED_COOLDOWN, knockback: 0, projectileSpeed: 350, projectileCount: 5, spread: Math.PI / 6 } },

  { name: '玉弓', mode: 'ranged', desc: '低伤多弹药',
    ingredients: { good: 1, common: 1 },
    result: { durability: 8, maxDurability: 8, damage: 28, range: RANGED_RANGE, cooldown: RANGED_COOLDOWN, knockback: 0, projectileSpeed: 450, projectileCount: 1, spread: 0 } },

  { name: '翠玉步枪', mode: 'ranged', desc: '远程高伤',
    ingredients: { rare: 1, good: 1 },
    result: { durability: 10, maxDurability: 10, damage: 45, range: RANGED_RANGE, cooldown: RANGED_COOLDOWN, knockback: 0, projectileSpeed: 550, projectileCount: 1, spread: 0 } },

  { name: '帝王炮', mode: 'ranged', desc: '3发散射超高伤',
    ingredients: { legendary: 1, rare: 1 },
    result: { durability: 8, maxDurability: 8, damage: 80, range: RANGED_RANGE, cooldown: RANGED_COOLDOWN, knockback: 0, projectileSpeed: 600, projectileCount: 3, spread: Math.PI / 8 } },
];

// ─── Scene ────────────────────────────────────────────────────

export class RuneGambleScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Arc;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private tabKey!: Phaser.Input.Keyboard.Key;

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
  private fogTextureKey = 'runeGambleFog';
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

  // Weapon
  private weapon: Weapon = { mode: 'none', weaponName: '', stoneType: 'trash', durability: 0, maxDurability: 0, damage: 0, range: 0, cooldown: 0, knockback: 0, projectileSpeed: 0, projectileCount: 1, spread: 0 };
  private meleeCooldown = 0;
  private rangedCooldown = 0;
  private projectiles: { sprite: Phaser.GameObjects.Arc; damage: number; vx: number; vy: number }[] = [];
  private weaponGraphics!: Phaser.GameObjects.Graphics;

  // Inventory: collected stones (type → count)
  private inventory: Map<StoneType, number> = new Map();
  private coreCount = 0;  // 灵核数量
  private coreScore = 0;  // 灵核总分（精英=200，普通=50）

  // Craft menu
  private craftMenuOpen = false;
  private craftMenuBg!: Phaser.GameObjects.Rectangle;
  private craftMenuTexts: Phaser.GameObjects.Text[] = [];
  private craftMenuBgRects: Phaser.GameObjects.Rectangle[] = [];
  private craftMenuTitle!: Phaser.GameObjects.Text;
  private craftMenuSelected = 0;

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
  private stoneRespawnInterval = 15000;  // 每15秒补充石头
  private monsterRespawnInterval = 20000; // 每20秒补充怪物
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
  private weaponText!: Phaser.GameObjects.Text;
  private inventoryText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'RuneGambleScene' });
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
    this.projectiles = [];
    this.weapon = { mode: 'none', weaponName: '', stoneType: 'trash', durability: 0, maxDurability: 0, damage: 0, range: 0, cooldown: 0, knockback: 0, projectileSpeed: 0, projectileCount: 1, spread: 0 };
    this.meleeCooldown = 0;
    this.rangedCooldown = 0;
    this.stamina = STAMINA_MAX;
    this.isSprinting = false;
    this.isHidden = false;
    this.hiddenSpot = null;
    this.stoneRespawnTimer = 0;
    this.monsterRespawnTimer = 0;
    this.inventory = new Map();
    this.coreCount = 0;
    this.coreScore = 0;
    this.craftMenuOpen = false;
    this.craftMenuSelected = 0;

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

    this.weaponGraphics = this.add.graphics();
    this.weaponGraphics.setDepth(7);

    this.showMessage('🎰 赌石猎核！\n\n左键 = 水枪（清洗石头 / 喷晕怪物）\n空格 = 攻击（近战/远程自动）\n\n铁矿/黑曜石 → 只能做近战\n水晶/琥珀 → 只能做远程\n好玉/极品玉/帝王绿 → 近战远程都能做\n药石回血 | 盾石护盾 | 雷石范围眩晕\n\n打怪掉灵核 → 灵核加分！\nShift疾跑 | E键躲藏 | Tab搓武器\n\n价值达' + this.goalScore + ' → 到撤离点撤离！', 9000);
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

      this.stones.push({
        x, y, radius,
        stoneType: tier.type,
        stoneValue,
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

  // ── 补充石头：当石头数量不足时刷新 ──
  private spawnStone() {
    let attempts = 0;
    while (attempts < 200) {
      const x = Phaser.Math.Between(60, this.mapWidth - 60);
      const y = Phaser.Math.Between(60, this.mapHeight - 60);

      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 150) { attempts++; continue; }
      if (this.isInsideObstacle(x, y, 18)) { attempts++; continue; }

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

      this.stones.push({
        x, y, radius,
        stoneType: tier.type,
        stoneValue,
        state: 0,
        cleanProgress: 0,
        shellSprite: shellG,
        innerSprite: innerG,
        promptText: prompt,
      });
      return;
    }
  }

  // ── 补充怪物：当怪物数量不足时刷新 ──
  private spawnMonster() {
    let attempts = 0;
    while (attempts < 200) {
      const x = Phaser.Math.Between(120, this.mapWidth - 120);
      const y = Phaser.Math.Between(120, this.mapHeight - 120);

      if (Phaser.Math.Distance.Between(x, y, 80, 80) < 400) { attempts++; continue; }
      if (this.isInsideObstacle(x, y, 14)) { attempts++; continue; }

      const isElite = Math.random() < 0.25; // 25%概率精英
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
    // 统计可用石头（未拿走/未做成武器的）
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

      const isElite = placed < 1; // 前1只为精英怪
      const hp = isElite ? MONSTER_ELITE_HP : MONSTER_HP;
      const color = isElite ? 0xff4444 : 0xff00ff;
      const size = isElite ? 32 : 24;

      const sprite = this.add.rectangle(x, y, size, size, color);
      sprite.setDepth(5);
      if (isElite) sprite.setStrokeStyle(2, 0xffff00);

      // HP bar
      const hpBar = this.add.graphics();
      hpBar.setDepth(5.5);

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

    this.weaponText = this.add.text(16, 64, '武器: 无', {
      fontSize: '16px', color: '#88ccff',
    }).setScrollFactor(0).setDepth(20);

    this.statusText = this.add.text(16, 88, '', {
      fontSize: '14px', color: '#ff8844',
    }).setScrollFactor(0).setDepth(20);

    // Inventory text (right side)
    this.inventoryText = this.add.text(580, 16, '', {
      fontSize: '13px', color: '#aaffaa', align: 'left',
      backgroundColor: '#00000088', padding: { x: 6, y: 4 },
    }).setScrollFactor(0).setDepth(20);

    // Craft menu (hidden by default)
    this.craftMenuBg = this.add.rectangle(400, 300, 500, 420, 0x000000, 0.92)
      .setScrollFactor(0).setDepth(40).setVisible(false);
    this.craftMenuBg.setStrokeStyle(2, 0x888888);
    this.craftMenuTitle = this.add.text(400, 110, '搓武器 [W/S选 | 空格搓 | Esc关]', {
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

  private updateWeaponUI() {
    if (this.weapon.mode === 'none') {
      const newText = '武器: 无';
      if (this.weaponText.text !== newText) this.weaponText.setText(newText);
    } else {
      const modeStr = this.weapon.mode === 'melee' ? '⚔️' : '🏹';
      const durStr = this.weapon.mode === 'melee'
        ? `耐久 ${this.weapon.durability}/${this.weapon.maxDurability}`
        : `弹药 ${this.weapon.durability}/${this.weapon.maxDurability}`;
      const newText = `${modeStr}${this.weapon.weaponName} ${durStr} 伤${this.weapon.damage}`;
      if (this.weaponText.text !== newText) this.weaponText.setText(newText);
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

    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isDead || this.isWon || this.craftMenuOpen) return;

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

    // Craft menu open: handle menu navigation
    if (this.craftMenuOpen) {
      if (Phaser.Input.Keyboard.JustDown(this.escKey) || Phaser.Input.Keyboard.JustDown(this.tabKey)) {
        this.closeCraftMenu();
        return;
      }
      // W = prev, S = next, Space = craft
      if (Phaser.Input.Keyboard.JustDown(this.wasdKeys.W)) {
        this.craftMenuSelected = (this.craftMenuSelected - 1 + CRAFT_RECIPES.length) % CRAFT_RECIPES.length;
        this.refreshCraftMenu();
      }
      if (Phaser.Input.Keyboard.JustDown(this.wasdKeys.S)) {
        this.craftMenuSelected = (this.craftMenuSelected + 1) % CRAFT_RECIPES.length;
        this.refreshCraftMenu();
      }
      if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
        this.tryCraft(this.craftMenuSelected);
      }
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    // Tab = open craft menu
    if (Phaser.Input.Keyboard.JustDown(this.tabKey)) {
      this.openCraftMenu();
      return;
    }

    // E 键躲藏/离开
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.tryHide();
    }

    // 空格：攻击（近战/远程自动判断）
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      if (this.weapon.mode === 'melee') {
        this.doMeleeAttack();
      } else if (this.weapon.mode === 'ranged') {
        this.doRangedAttack();
      }
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
    this.updateProjectiles(delta);
    this.checkMonsterCollision();
    this.checkCorePickup();
    this.updateRespawn(delta);
    this.checkEvacuation(delta);
    this.updateFog();
    this.updateStatusUI();
    this.updateWeaponUI();
    this.updateInventoryUI();
    this.updateScoreUI();
    this.drawStaminaBar();
    this.drawWeaponVisual();

    if (this.meleeCooldown > 0) this.meleeCooldown -= delta;
    if (this.rangedCooldown > 0) this.rangedCooldown -= delta;
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
      this.showMessage(`📦 捡起 ${tier.name}！\nTab搓武器 | 空格攻击`, 1500);
    }

    stone.promptText.setText('');
    stone.shellSprite.setVisible(false);
    stone.innerSprite.setVisible(false);
    this.spawnResultTag(stone, `${tier.name}`);
  }

  // ── 打开搓武器菜单 ──
  private openCraftMenu() {
    this.craftMenuOpen = true;
    this.craftMenuBg.setVisible(true);
    this.craftMenuTitle.setVisible(true);
    this.craftMenuSelected = 0;
    this.refreshCraftMenu();
  }

  // ── 关闭搓武器菜单 ──
  private closeCraftMenu() {
    this.craftMenuOpen = false;
    this.craftMenuBg.setVisible(false);
    this.craftMenuTitle.setVisible(false);
    for (const t of this.craftMenuTexts) t.destroy();
    for (const r of this.craftMenuBgRects) r.destroy();
    this.craftMenuTexts = [];
    this.craftMenuBgRects = [];
  }

  // ── 刷新搓武器菜单显示 ──
  private refreshCraftMenu() {
    for (const t of this.craftMenuTexts) t.destroy();
    for (const r of this.craftMenuBgRects) r.destroy();
    this.craftMenuTexts = [];
    this.craftMenuBgRects = [];

    const startY = 150;
    const lineH = 26;

    for (let i = 0; i < CRAFT_RECIPES.length; i++) {
      const recipe = CRAFT_RECIPES[i];
      const canCraft = this.canCraft(recipe);
      const selected = i === this.craftMenuSelected;

      const y = startY + i * lineH;
      const bgRect = this.add.rectangle(400, y, 480, lineH - 2, selected ? 0x444466 : 0x222233, 0.9)
        .setScrollFactor(0).setDepth(41);
      if (selected) bgRect.setStrokeStyle(2, 0xffff00);
      this.craftMenuBgRects.push(bgRect);

      // 配方材料
      const ingreStrs: string[] = [];
      for (const [type, count] of Object.entries(recipe.ingredients)) {
        const tier = STONE_TIERS.find(t => t.type === type)!;
        const have = this.inventory.get(type as StoneType) ?? 0;
        const ok = have >= count;
        ingreStrs.push(`${ok ? '✓' : '✗'}${tier.name} ${have}/${count}`);
      }

      const modeIcon = recipe.mode === 'melee' ? '⚔️' : '🏹';
      const text = `${selected ? '▶' : ' '} ${modeIcon}${recipe.name} ${recipe.desc} | ${ingreStrs.join(' + ')}`;
      const txt = this.add.text(170, y - 10, text, {
        fontSize: '13px', color: canCraft ? '#ffffff' : '#666666',
      }).setScrollFactor(0).setDepth(42);
      this.craftMenuTexts.push(txt);
    }
  }

  // ── 检查能否搓某配方 ──
  private canCraft(recipe: CraftRecipe): boolean {
    for (const [type, count] of Object.entries(recipe.ingredients)) {
      const have = this.inventory.get(type as StoneType) ?? 0;
      if (have < count) return false;
    }
    return true;
  }

  // ── 取配方中价值最高的石头作为主石种（决定武器/弹幕颜色）──
  private getPrimaryStoneType(recipe: CraftRecipe): StoneType {
    let best: StoneType = 'trash';
    let bestVal = -1;
    for (const type of Object.keys(recipe.ingredients) as StoneType[]) {
      const tier = STONE_TIERS.find(t => t.type === type)!;
      const val = tier.isUtility ? 0 : (tier.minVal + tier.maxVal) / 2;
      if (val > bestVal) {
        bestVal = val;
        best = type;
      }
    }
    return best;
  }

  // ── 搓武器 ──
  private tryCraft(index: number) {
    const recipe = CRAFT_RECIPES[index];
    if (!recipe) return;

    if (!this.canCraft(recipe)) {
      this.showMessage('材料不足！', 1500);
      return;
    }

    // 消耗材料
    for (const [type, count] of Object.entries(recipe.ingredients)) {
      const have = this.inventory.get(type as StoneType) ?? 0;
      this.inventory.set(type as StoneType, have - count);
    }

    // 生成武器 — 主石种取配方中价值最高的材料
    const primaryType = this.getPrimaryStoneType(recipe);
    this.weapon = {
      mode: recipe.mode,
      weaponName: recipe.name,
      stoneType: primaryType,
      ...recipe.result,
    };

    const modeStr = recipe.mode === 'melee' ? '⚔️' : '🏹';
    const durStr = recipe.mode === 'melee' ? `耐久${recipe.result.durability}` : `弹药${recipe.result.durability}`;
    this.showMessage(`${modeStr} 搓出 ${recipe.name}！\n${durStr} 伤害${recipe.result.damage}\n空格键攻击`, 2500);

    this.closeCraftMenu();
  }

  // ── 近战攻击 ──
  private doMeleeAttack() {
    if (this.meleeCooldown > 0) return;
    this.meleeCooldown = this.weapon.cooldown || MELEE_COOLDOWN;

    const range = this.weapon.range || MELEE_RANGE;
    const knockback = this.weapon.knockback || 15;

    // 找攻击范围内的怪物
    for (const monster of this.monsters) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, monster.sprite.x, monster.sprite.y);
      if (dist > range) continue;

      // 检查角度（朝鼠标方向）
      const angleToMonster = Math.atan2(monster.sprite.y - this.player.y, monster.sprite.x - this.player.x);
      let angleDiff = Math.abs(angleToMonster - this.aimAngle);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      if (angleDiff > Math.PI / 3) continue; // 60度锥形

      // 命中！
      monster.hp -= this.weapon.damage;
      monster.stunTimer = 500;
      monster.isChasing = true;
      monster.giveUpTimer = monster.giveUpDuration;

      // 击退
      const dx = monster.sprite.x - this.player.x;
      const dy = monster.sprite.y - this.player.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        monster.sprite.x += (dx / len) * knockback;
        monster.sprite.y += (dy / len) * knockback;
      }

      this.cam.shake(100, 0.004);

      if (monster.hp <= 0) {
        this.killMonster(monster);
      }

      break; // 只打一只
    }

    // 消耗耐久
    this.weapon.durability--;
    if (this.weapon.durability <= 0) {
      this.showMessage(`💔 ${this.weapon.weaponName}碎了！`, 2000);
      this.weapon = { mode: 'none', stoneType: 'trash', weaponName: '', durability: 0, maxDurability: 0, damage: 0, range: 0, cooldown: 0, knockback: 0, projectileSpeed: 0, projectileCount: 1, spread: 0 };
    }
  }

  // ── 远程攻击 ──
  private doRangedAttack() {
    if (this.rangedCooldown > 0) return;
    this.rangedCooldown = this.weapon.cooldown || RANGED_COOLDOWN;

    const tier = STONE_TIERS.find(t => t.type === this.weapon.stoneType)!;
    const speed = this.weapon.projectileSpeed || RANGED_PROJECTILE_SPEED;
    const count = this.weapon.projectileCount || 1;
    const spread = this.weapon.spread || 0;

    for (let i = 0; i < count; i++) {
      // 散弹角度分配
      let angle = this.aimAngle;
      if (count > 1) {
        angle = this.aimAngle - spread / 2 + (spread * i) / (count - 1);
      }

      const projSprite = this.add.circle(this.player.x, this.player.y, 6, tier.glowColor);
      projSprite.setDepth(6);
      projSprite.setStrokeStyle(1, 0xffffff);

      this.projectiles.push({
        sprite: projSprite,
        damage: this.weapon.damage,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      });
    }

    // 消耗弹药
    this.weapon.durability--;
    if (this.weapon.durability <= 0) {
      this.showMessage(`💔 ${this.weapon.weaponName}弹药耗尽！`, 2000);
      this.weapon = { mode: 'none', stoneType: 'trash', weaponName: '', durability: 0, maxDurability: 0, damage: 0, range: 0, cooldown: 0, knockback: 0, projectileSpeed: 0, projectileCount: 1, spread: 0 };
    }
  }

  // ── 更新弹幕 ──
  private updateProjectiles(delta: number) {
    const dt = delta / 1000;
    const toRemove: number[] = [];

    for (let i = 0; i < this.projectiles.length; i++) {
      const proj = this.projectiles[i];
      proj.sprite.x += proj.vx * dt;
      proj.sprite.y += proj.vy * dt;

      // 撞墙
      if (this.collidesWithObstacle(proj.sprite.x, proj.sprite.y, 6)) {
        toRemove.push(i);
        continue;
      }

      // 超出地图
      if (proj.sprite.x < 0 || proj.sprite.x > this.mapWidth || proj.sprite.y < 0 || proj.sprite.y > this.mapHeight) {
        toRemove.push(i);
        continue;
      }

      // 命中怪物
      let hit = false;
      for (const monster of this.monsters) {
        const dist = Phaser.Math.Distance.Between(proj.sprite.x, proj.sprite.y, monster.sprite.x, monster.sprite.y);
        if (dist < 18) {
          monster.hp -= proj.damage;
          monster.isChasing = true;
          monster.giveUpTimer = monster.giveUpDuration;
          hit = true;

          if (monster.hp <= 0) {
            this.killMonster(monster);
          }
          break;
        }
      }

      if (hit) toRemove.push(i);
    }

    // 移除
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.projectiles[toRemove[i]].sprite.destroy();
      this.projectiles.splice(toRemove[i], 1);
    }
  }

  // ── 武器视觉 ──
  private drawWeaponVisual() {
    this.weaponGraphics.clear();

    if (this.weapon.mode === 'none') return;

    const tier = STONE_TIERS.find(t => t.type === this.weapon.stoneType)!;

    if (this.weapon.mode === 'melee') {
      // 近战：画一条短线表示武器
      const len = (this.weapon.range || MELEE_RANGE) * 0.6;
      const swingAngle = this.aimAngle;
      this.weaponGraphics.lineStyle(3, tier.glowColor, 0.8);
      this.weaponGraphics.beginPath();
      this.weaponGraphics.moveTo(this.player.x, this.player.y);
      this.weaponGraphics.lineTo(
        this.player.x + Math.cos(swingAngle) * len,
        this.player.y + Math.sin(swingAngle) * len
      );
      this.weaponGraphics.strokePath();
    } else if (this.weapon.mode === 'ranged') {
      // 远程：画一个瞄准线
      this.weaponGraphics.lineStyle(1, tier.glowColor, 0.3);
      this.weaponGraphics.beginPath();
      this.weaponGraphics.moveTo(this.player.x, this.player.y);
      this.weaponGraphics.lineTo(
        this.player.x + Math.cos(this.aimAngle) * (this.weapon.range || RANGED_RANGE),
        this.player.y + Math.sin(this.aimAngle) * (this.weapon.range || RANGED_RANGE)
      );
      this.weaponGraphics.strokePath();
    }
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

    // 死亡效果
    this.cam.flash(100, 255, 255, 255);
    this.cam.shake(150, 0.005);

    // 移除怪物
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
