import Phaser from 'phaser';

// ── Enums ─────────────────────────────────────────────────────────────────

enum BlindBoxType { Small = 1, Medium = 2, Large = 3 }
enum RewardQuality { Normal = 0, Rare = 1, Epic = 2, Legendary = 3 }
enum EvacuationTaskType { CollectItems, KeyPuzzle, TimedEscape, MultiActivate, BossSeal }

// ── Types ─────────────────────────────────────────────────────────────────

interface Room {
  x: number; y: number; w: number; h: number;
  name: string;
  centerX: number; centerY: number;
  hasLight: boolean;
  lightOn: boolean;
  switchX: number;
  switchY: number;
}

interface Obstacle {
  x: number; y: number; w: number; h: number;
}

interface Ghost {
  sprite: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  speed: number;
  chaseSpeed: number;
  direction: Phaser.Math.Vector2;
  isChasing: boolean;
  giveUpTimer: number;
  giveUpDuration: number;
  homeX: number;
  homeY: number;
  visionRange: number;
  patrolTimer: number;
  alive: boolean;
  isBoss: boolean;
  damage: number;
}

interface FloorData {
  rooms: Room[];
  obstacles: Obstacle[];
  ghosts: Ghost[];
  crackingTable: { x: number; y: number; sprite: Phaser.GameObjects.Container } | null;
  isCracked: boolean;
  evacTask: EvacuationTaskState;
  exit: Phaser.GameObjects.Container | null;
  exitActive: boolean;
}

interface Treasure {
  x: number; y: number;
  value: number;
  quality: RewardQuality;
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
}

interface FloorConfig {
  floor: number;
  name: string;
  ghostSpeed: number;
  ghostChaseSpeed: number;
  ghostDamage: number;
  ghostVision: number;
  bossDamage: number;
  decorCount: [number, number];
  darkRoomChance: number;
  evacTaskType: EvacuationTaskType;
  evacTarget: number;
  evacRewardMult: number;
}

interface EvacuationTaskState {
  type: EvacuationTaskType;
  target: number;
  current: number;
  completed: boolean;
  rewardMult: number;
  timer: number;
  timerActive: boolean;
}

interface Collectible {
  x: number; y: number;
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
  name: string;
}

// ── Floor Configs ─────────────────────────────────────────────────────────

const FLOOR_CONFIGS: FloorConfig[] = [
  { floor: 1, name: '大厅层', ghostSpeed: 30, ghostChaseSpeed: 70, ghostDamage: 10, ghostVision: 180, bossDamage: 30, decorCount: [2, 3], darkRoomChance: 0.3, evacTaskType: EvacuationTaskType.CollectItems, evacTarget: 3, evacRewardMult: 1.1 },
  { floor: 2, name: '居住层', ghostSpeed: 40, ghostChaseSpeed: 90, ghostDamage: 15, ghostVision: 200, bossDamage: 40, decorCount: [3, 4], darkRoomChance: 0.5, evacTaskType: EvacuationTaskType.KeyPuzzle, evacTarget: 1, evacRewardMult: 1.2 },
  { floor: 3, name: '储藏层', ghostSpeed: 50, ghostChaseSpeed: 110, ghostDamage: 20, ghostVision: 220, bossDamage: 50, decorCount: [3, 5], darkRoomChance: 0.6, evacTaskType: EvacuationTaskType.TimedEscape, evacTarget: 30, evacRewardMult: 1.3 },
  { floor: 4, name: '禁区层', ghostSpeed: 60, ghostChaseSpeed: 130, ghostDamage: 25, ghostVision: 250, bossDamage: 60, decorCount: [4, 6], darkRoomChance: 0.7, evacTaskType: EvacuationTaskType.MultiActivate, evacTarget: 3, evacRewardMult: 1.5 },
  { floor: 5, name: 'BOSS层', ghostSpeed: 70, ghostChaseSpeed: 150, ghostDamage: 30, ghostVision: 280, bossDamage: 80, decorCount: [4, 6], darkRoomChance: 0.8, evacTaskType: EvacuationTaskType.BossSeal, evacTarget: 1, evacRewardMult: 2.0 },
];

const FLOOR_NAMES = [
  ['大厅', '客厅', '厨房', '餐厅'],
  ['卧室', '书房', '浴室', '走廊'],
  ['阁楼', '储藏室', '阳台', '密室'],
  ['禁室', '实验室', '档案室', '暗廊'],
  ['祭坛', '王座', '囚室', '深渊'],
];

const QUALITY_COLORS = [0xffffff, 0x4488ff, 0xaa44ff, 0xffaa00];
const QUALITY_NAMES = ['普通', '稀有', '史诗', '传说'];
const QUALITY_VALUE_RANGES: [[number, number], [number, number], [number, number], [number, number]] = [
  [50, 100], [200, 300], [500, 800], [1000, 2000],
];

// ── Scene ─────────────────────────────────────────────────────────────────

export class BlindBoxHorrorScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };

  // Map
  private mapWidth = 900;
  private mapHeight = 700;
  private obstacles: Obstacle[] = [];
  private rooms: Room[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Floor system
  private currentFloor = 1;
  private totalFloors = 5;
  private floorDataMap: Map<number, FloorData> = new Map();
  private stairs: { x: number; y: number; targetFloor: number; floor: number; sprite: Phaser.GameObjects.Container }[] = [];
  private isTransitioning = false;
  private floorTexts: Phaser.GameObjects.Text[] = [];

  // Fog of war
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'blindBoxFog';
  private viewRadius = 180;
  private screenW = 800;
  private screenH = 600;
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private ghosts: Ghost[] = [];
  private treasures: Treasure[] = [];
  private collectibles: Collectible[] = [];
  private multiSwitches: { x: number; y: number; activated: boolean; sprite: Phaser.GameObjects.Container }[] = [];

  // Blind box system
  private boxType: BlindBoxType = BlindBoxType.Small;
  private cracksRemaining = 1;
  private totalCracks = 1;
  private crackCount = 0;
  private blindBoxSprite!: Phaser.GameObjects.Container;
  private hasBlindBox = true;

  // Player stats
  private health = 100;
  private maxHealth = 100;
  private treasureScore = 0;

  // Game state
  private gameState: 'select' | 'playing' | 'dead' | 'won' = 'select';
  private damageCooldown = 0;
  private spawnImmunity = 3000;

  // UI
  private healthText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private boxStatusText!: Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;
  private taskText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;

  // Selection UI
  private selectContainer!: Phaser.GameObjects.Container;
  private selectButtons: Phaser.GameObjects.Container[] = [];

  // Player facing
  private playerFacingAngle = 0;

  // Room light
  private roomLightOverlays: Phaser.GameObjects.Graphics[] = [];

  // Special effects
  private timeWarpTimer = 0;

  constructor() {
    super({ key: 'BlindBoxHorrorScene' });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  create() {
    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.showBoxSelection();
  }

  update(_time: number, delta: number) {
    if (this.gameState !== 'playing') return;

    this.handleMovement(delta);
    this.updateFog();
    this.updateGhosts(delta);
    this.updateHint();
    this.updateEvacTimer(delta);

    if (this.damageCooldown > 0) this.damageCooldown -= delta;
    if (this.spawnImmunity > 0) this.spawnImmunity -= delta;
    if (this.timeWarpTimer > 0) this.timeWarpTimer -= delta;

    this.checkEvacuationComplete();
  }

  // ── Box Selection ────────────────────────────────────────────────────────

  private showBoxSelection() {
    this.gameState = 'select';
    this.cam.setScroll(0, 0);

    this.selectContainer = this.add.container(0, 0);
    this.selectContainer.setDepth(500);
    this.selectContainer.setScrollFactor(0);

    const bg = this.add.rectangle(0, 0, this.screenW, this.screenH, 0x000000, 0.9);
    bg.setOrigin(0, 0);
    this.selectContainer.add(bg);

    const title = this.add.text(this.screenW / 2, 60, '选择盲盒', {
      fontSize: '32px', color: '#ff6600', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.selectContainer.add(title);

    const subtitle = this.add.text(this.screenW / 2, 100, '盲盒越大，破解次数越多，但风险也越高', {
      fontSize: '16px', color: '#aaaaaa',
    }).setOrigin(0.5);
    this.selectContainer.add(subtitle);

    const boxTypes = [
      { type: BlindBoxType.Small, name: '小盲盒', cracks: 1, price: 100, color: 0x44aa44, desc: '1次破解\n探索1层\n风险低' },
      { type: BlindBoxType.Medium, name: '中盲盒', cracks: 2, price: 250, color: 0x4488ff, desc: '2次破解\n探索2层\n风险中' },
      { type: BlindBoxType.Large, name: '大盲盒', cracks: 3, price: 500, color: 0xaa44ff, desc: '3次破解\n探索3层\n风险高' },
    ];

    this.selectButtons = [];

    boxTypes.forEach((bt, i) => {
      const x = 150 + i * 250;
      const y = 300;

      const container = this.add.container(x, y);
      container.setDepth(501);
      container.setScrollFactor(0);

      const card = this.add.rectangle(0, 0, 200, 250, 0x222244, 0.9);
      card.setStrokeStyle(3, bt.color, 1);
      container.add(card);

      const nameText = this.add.text(0, -90, bt.name, {
        fontSize: '24px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5);
      container.add(nameText);

      const boxIcon = this.add.text(0, -50, '📦', { fontSize: '40px' }).setOrigin(0.5);
      container.add(boxIcon);

      const descText = this.add.text(0, 20, bt.desc, {
        fontSize: '14px', color: '#cccccc', align: 'center',
      }).setOrigin(0.5);
      container.add(descText);

      const priceText = this.add.text(0, 90, `${bt.price}金币`, {
        fontSize: '16px', color: '#ffd700',
      }).setOrigin(0.5);
      container.add(priceText);

      const selectBtn = this.add.text(0, 115, '[ 选择 ]', {
        fontSize: '16px', color: '#ffff00',
      }).setOrigin(0.5);
      container.add(selectBtn);

      card.setInteractive({ useHandCursor: true });
      card.on('pointerover', () => { card.setFillStyle(0x333366, 0.95); });
      card.on('pointerout', () => { card.setFillStyle(0x222244, 0.9); });
      card.on('pointerdown', () => {
        this.boxType = bt.type;
        this.cracksRemaining = bt.cracks;
        this.totalCracks = bt.cracks;
        this.startGame();
      });

      this.selectButtons.push(container);
      this.selectContainer.add(container);
    });

    const hint = this.add.text(this.screenW / 2, 550, '点击选择盲盒类型开始游戏', {
      fontSize: '14px', color: '#666666',
    }).setOrigin(0.5);
    this.selectContainer.add(hint);
  }

  private startGame() {
    this.selectContainer.destroy();
    this.gameState = 'playing';

    // Reset all state for a fresh game (scene.restart reuses the same instance)
    this.currentFloor = 1;
    this.health = 100;
    this.treasureScore = 0;
    this.crackCount = 0;
    this.hasBlindBox = true;
    this.isTransitioning = false;
    this.timeWarpTimer = 0;
    this.spawnImmunity = 3000;
    this.damageCooldown = 0;
    this.rooms = [];
    this.obstacles = [];
    this.ghosts = [];
    this.stairs = [];
    this.collectibles = [];
    this.treasures = [];
    this.multiSwitches = [];
    this.floorTexts = [];
    this.roomLightOverlays = [];

    for (let i = 1; i <= this.totalFloors; i++) {
      this.floorDataMap.set(i, {
        rooms: [], obstacles: [], ghosts: [],
        crackingTable: null, isCracked: false,
        evacTask: {
          type: FLOOR_CONFIGS[i - 1].evacTaskType,
          target: FLOOR_CONFIGS[i - 1].evacTarget,
          current: 0,
          completed: false,
          rewardMult: FLOOR_CONFIGS[i - 1].evacRewardMult,
          timer: 0,
          timerActive: false,
        },
        exit: null,
        exitActive: false,
      });
    }

    this.generateMansion();
    this.drawMap();
    this.createPlayer();
    this.createStairs();
    this.createCrackingTables();
    this.createWanderingGhosts();
    this.createBlindBoxIndicator();
    this.createFog();
    this.createUI();
    this.setupInput();
    this.initEvacuationTasks();

    this.cam.startFollow(this.player, true, 0.1, 0.1);
    this.showMessage(`选择了${this.boxType === BlindBoxType.Small ? '小' : this.boxType === BlindBoxType.Medium ? '中' : '大'}盲盒！${this.cracksRemaining}次破解机会`);
  }

  // ── Mansion Generation ───────────────────────────────────────────────────

  private generateMansion() {
    for (let floor = 1; floor <= this.totalFloors; floor++) {
      const fd = this.floorDataMap.get(floor)!;
      fd.rooms = [];
      fd.obstacles = [];
      const cfg = FLOOR_CONFIGS[floor - 1];

      const cols = 2;
      const rows = 2;
      const roomGap = 40;
      const border = 20;
      const usableW = this.mapWidth - border * 2;
      const usableH = this.mapHeight - border * 2;
      const roomW = Math.floor((usableW - roomGap * (cols - 1)) / cols);
      const roomH = Math.floor((usableH - roomGap * (rows - 1)) / rows);

      let idx = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = border + c * (roomW + roomGap);
          const y = border + r * (roomH + roomGap);
          const hasLight = Math.random() < cfg.darkRoomChance ? false : Math.random() < 0.5;

          fd.rooms.push({
            x, y, w: roomW, h: roomH,
            name: FLOOR_NAMES[floor - 1][idx],
            centerX: x + roomW / 2,
            centerY: y + roomH / 2,
            hasLight,
            lightOn: hasLight,
            switchX: x + roomW - 40,
            switchY: y + 40,
          });
          idx++;
        }
      }

      // Border walls
      fd.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: border });
      fd.obstacles.push({ x: 0, y: this.mapHeight - border, w: this.mapWidth, h: border });
      fd.obstacles.push({ x: 0, y: 0, w: border, h: this.mapHeight });
      fd.obstacles.push({ x: this.mapWidth - border, y: 0, w: border, h: this.mapHeight });

      // Room walls with doorways
      const doorWidth = 60;
      for (const room of fd.rooms) {
        if (room.y > border) {
          const doorX = room.x + room.w / 2 - doorWidth / 2;
          fd.obstacles.push({ x: room.x, y: room.y - roomGap, w: doorX - room.x, h: roomGap });
          fd.obstacles.push({ x: doorX + doorWidth, y: room.y - roomGap, w: room.x + room.w - (doorX + doorWidth), h: roomGap });
        }
        if (room.x > border) {
          const doorY = room.y + room.h / 2 - doorWidth / 2;
          fd.obstacles.push({ x: room.x - roomGap, y: room.y, w: roomGap, h: doorY - room.y });
          fd.obstacles.push({ x: room.x - roomGap, y: doorY + doorWidth, w: roomGap, h: room.y + room.h - (doorY + doorWidth) });
        }
        const isBottomRow = room.y + room.h >= this.mapHeight - border;
        if (!isBottomRow) {
          const doorX = room.x + room.w / 2 - doorWidth / 2;
          fd.obstacles.push({ x: room.x, y: room.y + room.h, w: doorX - room.x, h: roomGap });
          fd.obstacles.push({ x: doorX + doorWidth, y: room.y + room.h, w: room.x + room.w - (doorX + doorWidth), h: roomGap });
        }
        const isRightmost = room.x + room.w >= this.mapWidth - border;
        if (!isRightmost) {
          const doorY = room.y + room.h / 2 - doorWidth / 2;
          fd.obstacles.push({ x: room.x + room.w, y: room.y, w: roomGap, h: doorY - room.y });
          fd.obstacles.push({ x: room.x + room.w, y: doorY + doorWidth, w: roomGap, h: room.y + room.h - (doorY + doorWidth) });
        }
      }

      // Furniture obstacles - more on higher floors
      for (const room of fd.rooms) {
        const decorCount = Phaser.Math.Between(cfg.decorCount[0], cfg.decorCount[1]);
        for (let i = 0; i < decorCount; i++) {
          const dw = Phaser.Math.Between(25, 60);
          const dh = Phaser.Math.Between(25, 60);
          const dx = Phaser.Math.Between(room.x + 30, room.x + room.w - 30 - dw);
          const dy = Phaser.Math.Between(room.y + 30, room.y + room.h - 30 - dh);
          const distToCenter = Phaser.Math.Distance.Between(dx, dy, room.centerX, room.centerY);
          if (distToCenter < 80) continue;
          fd.obstacles.push({ x: dx, y: dy, w: dw, h: dh });
        }
      }
    }

    this.rooms = this.floorDataMap.get(this.currentFloor)!.rooms;
    this.obstacles = this.floorDataMap.get(this.currentFloor)!.obstacles;
  }

  private drawMap() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

    const shades = [0x1e1e3a, 0x222238, 0x1a2a2e, 0x2a1e2e];
    this.rooms.forEach((room, i) => {
      this.mapGraphics.fillStyle(shades[i % shades.length], 1);
      this.mapGraphics.fillRect(room.x, room.y, room.w, room.h);

      const roomLabel = this.add.text(room.centerX, room.y + 20, room.name, {
        fontSize: '18px', color: '#555577',
      }).setOrigin(0.5).setDepth(1);
      this.floorTexts.push(roomLabel);

      const switchColor = room.lightOn ? 0xffff00 : 0x888888;
      this.mapGraphics.fillStyle(switchColor, 0.8);
      this.mapGraphics.fillRect(room.switchX - 8, room.switchY - 8, 16, 16);
      this.mapGraphics.lineStyle(2, 0xffffff, 0.6);
      this.mapGraphics.strokeRect(room.switchX - 8, room.switchY - 8, 16, 16);

      if (!room.lightOn) {
        const overlay = this.add.graphics();
        overlay.fillStyle(0x000000, 0.7);
        overlay.fillRect(room.x, room.y, room.w, room.h);
        overlay.setDepth(2);
        this.roomLightOverlays.push(overlay);
      }
    });

    this.mapGraphics.lineStyle(1, 0x222244, 0.2);
    for (let x = 0; x < this.mapWidth; x += 60) this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    for (let y = 0; y < this.mapHeight; y += 60) this.mapGraphics.lineBetween(0, y, this.mapWidth, y);

    this.mapGraphics.fillStyle(0x444466, 1);
    for (const obs of this.obstacles) this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);

    this.mapGraphics.lineStyle(2, 0x666688, 1);
    for (const room of this.rooms) this.mapGraphics.strokeRect(room.x, room.y, room.w, room.h);
  }

  // ── Stairs ───────────────────────────────────────────────────────────────

  private createStairs() {
    for (let floor = 1; floor <= this.totalFloors; floor++) {
      const fd = this.floorDataMap.get(floor)!;
      const stairRoom = fd.rooms[3];

      if (floor < this.totalFloors) {
        const upStair = this.createStairSprite(stairRoom.centerX - 40, stairRoom.centerY, floor + 1, 'up', floor);
        this.stairs.push(upStair);
      }
      if (floor > 1) {
        const downStair = this.createStairSprite(stairRoom.centerX + 40, stairRoom.centerY, floor - 1, 'down', floor);
        this.stairs.push(downStair);
      }
    }
    this.updateStairsVisibility();
  }

  private createStairSprite(x: number, y: number, targetFloor: number, direction: 'up' | 'down', floor: number) {
    const container = this.add.container(x, y);
    container.setDepth(3);
    const base = this.add.rectangle(0, 0, 50, 50, 0x8b4513, 0.8);
    base.setStrokeStyle(2, 0xa0522d, 1);
    const arrow = this.add.text(0, -5, direction === 'up' ? '↑' : '↓', { fontSize: '24px', color: '#ffcc00' }).setOrigin(0.5);
    const ft = this.add.text(0, 15, `${targetFloor}F`, { fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    container.add([base, arrow, ft]);
    this.tweens.add({ targets: container, alpha: 0.6, duration: 800, yoyo: true, repeat: -1 });
    return { x, y, targetFloor, floor, sprite: container };
  }

  private updateStairsVisibility() {
    for (const stair of this.stairs) stair.sprite.setVisible(stair.floor === this.currentFloor);
  }

  private handleStairs() {
    if (this.isTransitioning) return;
    const fd = this.floorDataMap.get(this.currentFloor)!;
    if (!fd.evacTask.completed) {
      this.showMessage('完成当前层撤离任务才能上楼！');
      return;
    }
    if (this.cracksRemaining <= 0) {
      this.showMessage('没有破解次数了！请前往出口撤离！');
      return;
    }
    for (const stair of this.stairs) {
      if (stair.floor !== this.currentFloor) continue;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, stair.x, stair.y);
      if (dist < 50) {
        this.transitionToFloor(stair.targetFloor);
        return;
      }
    }
    this.showMessage('附近没有楼梯');
  }

  private transitionToFloor(targetFloor: number) {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    const currentFD = this.floorDataMap.get(this.currentFloor)!;
    currentFD.rooms = this.rooms;
    currentFD.obstacles = this.obstacles;
    currentFD.ghosts = this.ghosts;

    this.clearFloorObjects();

    this.currentFloor = targetFloor;
    const targetFD = this.floorDataMap.get(targetFloor)!;
    this.rooms = targetFD.rooms;
    this.obstacles = targetFD.obstacles;
    this.ghosts = targetFD.ghosts;

    this.drawMap();

    for (const ghost of this.ghosts) {
      if (!ghost.sprite) this.createGhostVisual(ghost);
      ghost.sprite.setVisible(ghost.alive);
    }

    // Show cracking table if not yet cracked
    if (targetFD.crackingTable && !targetFD.isCracked) {
      targetFD.crackingTable.sprite.setVisible(true);
    }

    // Show exit if task completed
    if (targetFD.exitActive && targetFD.exit) {
      targetFD.exit.setVisible(true);
    }

    const targetRoom = this.rooms[3];
    this.player.x = targetRoom.centerX;
    this.player.y = targetRoom.centerY + 60;

    this.updateStairsVisibility();
    this.updateFloorText();

    this.cam.flash(300, 255, 255, 200);
    this.showMessage(`到达 ${targetFloor}F - ${FLOOR_CONFIGS[targetFloor - 1].name}`);

    // Grant immunity after floor transition to protect against ghost attacks
    this.spawnImmunity = 3000;

    this.time.delayedCall(500, () => { this.isTransitioning = false; });
  }

  private clearFloorObjects() {
    for (const ghost of this.ghosts) if (ghost.sprite) ghost.sprite.setVisible(false);
    if (this.mapGraphics) this.mapGraphics.destroy();
    for (const overlay of this.roomLightOverlays) overlay.destroy();
    this.roomLightOverlays = [];
    for (const t of this.floorTexts) t.destroy();
    this.floorTexts = [];
  }

  // ── Cracking Tables ──────────────────────────────────────────────────────

  private createCrackingTables() {
    for (let floor = 1; floor <= this.totalFloors; floor++) {
      const fd = this.floorDataMap.get(floor)!;
      const room = fd.rooms[Phaser.Math.Between(0, fd.rooms.length - 1)];
      const x = room.centerX;
      const y = room.centerY;

      const container = this.add.container(x, y);
      container.setDepth(7);
      const table = this.add.rectangle(0, 0, 60, 40, 0x8b4513);
      table.setStrokeStyle(2, 0xa0522d, 1);
      const hammer = this.add.text(-15, -5, '🔨', { fontSize: '16px' }).setOrigin(0.5);
      const glow = this.add.text(15, -5, '✨', { fontSize: '16px' }).setOrigin(0.5);
      const label = this.add.text(0, 25, '破解台', { fontSize: '12px', color: '#ffcc00' }).setOrigin(0.5);
      container.add([table, hammer, glow, label]);

      this.tweens.add({ targets: container, scaleX: 1.1, scaleY: 1.1, duration: 1000, yoyo: true, repeat: -1 });

      fd.crackingTable = { x, y, sprite: container };
      container.setVisible(floor === this.currentFloor);
    }
  }

  private createBlindBoxIndicator() {
    this.blindBoxSprite = this.add.container(this.player.x + 20, this.player.y - 20);
    const box = this.add.rectangle(0, 0, 20, 20, 0xff6600);
    const qmark = this.add.text(0, 0, '?', { fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    this.blindBoxSprite.add([box, qmark]);
    this.blindBoxSprite.setDepth(11);
  }

  private crackBlindBox() {
    if (this.cracksRemaining <= 0 || !this.hasBlindBox) return;
    const fd = this.floorDataMap.get(this.currentFloor)!;
    if (fd.isCracked) {
      this.showMessage('本层已破解过！');
      return;
    }

    this.cracksRemaining--;
    this.crackCount++;
    fd.isCracked = true;
    if (fd.crackingTable) fd.crackingTable.sprite.setVisible(false);

    // Grant immunity during cracking animation and reveal
    this.spawnImmunity = 4000;

    this.showMessage(`正在破解盲盒... (第${this.crackCount}次)`);

    this.tweens.add({
      targets: this.blindBoxSprite,
      scaleX: 2, scaleY: 2, alpha: 0,
      duration: 1000,
      onComplete: () => {
        if (this.cracksRemaining <= 0) {
          this.blindBoxSprite.setVisible(false);
          this.hasBlindBox = false;
        } else {
          this.blindBoxSprite.setScale(1).setAlpha(1).setVisible(true);
        }
        // Grant immunity after cracking to protect during reveal
        this.spawnImmunity = 3000;
        this.revealBlindBoxContents();
      },
    });
  }

  private revealBlindBoxContents() {
    const roll = Math.random();
    const crackBonus = this.crackCount; // 1st=0 bonus, 2nd=+1 tier, 3rd=+2 tier

    // Result probabilities shift by floor
    const treasureChance = Math.max(0.1, 0.5 - (this.currentFloor - 1) * 0.1);
    const treasureMonsterChance = Math.max(0.15, 0.3 - (this.currentFloor - 1) * 0.05);
    const monsterChance = 0.15 + (this.currentFloor - 1) * 0.05;
    const bossChance = 0.05 + (this.currentFloor - 1) * 0.075;

    if (roll < treasureChance) {
      this.spawnTreasures(Phaser.Math.Between(3, 5), crackBonus);
      this.showMessage('盲盒结果：财宝散落各处！收集它们！');
    } else if (roll < treasureChance + treasureMonsterChance) {
      this.spawnTreasures(Phaser.Math.Between(2, 3), crackBonus);
      this.spawnMonsters(Phaser.Math.Between(1, 2));
      this.showMessage('盲盒结果：财宝和少量怪物！');
    } else if (roll < treasureChance + treasureMonsterChance + monsterChance) {
      this.spawnTreasures(Phaser.Math.Between(2, 3), crackBonus);
      this.spawnMonsters(Phaser.Math.Between(2, 4));
      this.showMessage('盲盒结果：大量怪物出现！小心！');
    } else if (roll < treasureChance + treasureMonsterChance + monsterChance + bossChance) {
      this.spawnTreasures(1, crackBonus + 1);
      this.spawnBoss();
      this.showMessage('盲盒结果：BOSS出现！击败或躲避后收集财宝！');
    } else {
      this.triggerSpecialEvent();
    }

    // Activate evacuation task after cracking
    this.activateEvacuationTask();

    // KeyPuzzle: cracking gives the key directly
    const fd = this.floorDataMap.get(this.currentFloor)!;
    if (FLOOR_CONFIGS[this.currentFloor - 1].evacTaskType === EvacuationTaskType.KeyPuzzle) {
      fd.evacTask.current = 1;
      this.showMessage('获得钥匙！可以撤离了！');
    }
  }

  // ── Treasure Spawning ────────────────────────────────────────────────────

  private rollQuality(crackBonus: number): RewardQuality {
    const floor = this.currentFloor;
    const roll = Math.random();

    // Quality chances by floor
    let normalChance: number, rareChance: number, epicChance: number, legendaryChance: number;
    switch (floor) {
      case 1: normalChance = 0.70; rareChance = 0.25; epicChance = 0.05; legendaryChance = 0; break;
      case 2: normalChance = 0.50; rareChance = 0.35; epicChance = 0.13; legendaryChance = 0.02; break;
      case 3: normalChance = 0.30; rareChance = 0.40; epicChance = 0.25; legendaryChance = 0.05; break;
      case 4: normalChance = 0.10; rareChance = 0.30; epicChance = 0.35; legendaryChance = 0.25; break;
      default: normalChance = 0; rareChance = 0.15; epicChance = 0.35; legendaryChance = 0.50; break;
    }

    // Apply crack bonus (shift quality up)
    for (let i = 0; i < crackBonus; i++) {
      if (legendaryChance < 0.4) { legendaryChance += 0.15; epicChance += 0.05; rareChance -= 0.10; normalChance -= 0.10; }
    }

    if (roll < legendaryChance) return RewardQuality.Legendary;
    if (roll < legendaryChance + epicChance) return RewardQuality.Epic;
    if (roll < legendaryChance + epicChance + rareChance) return RewardQuality.Rare;
    return RewardQuality.Normal;
  }

  private spawnTreasures(count: number, crackBonus: number) {
    const fd = this.floorDataMap.get(this.currentFloor)!;
    for (let i = 0; i < count; i++) {
      const room = fd.rooms[Phaser.Math.Between(0, fd.rooms.length - 1)];
      const x = Phaser.Math.Between(room.x + 40, room.x + room.w - 40);
      const y = Phaser.Math.Between(room.y + 40, room.y + room.h - 40);
      const quality = this.rollQuality(crackBonus);
      const valRange = QUALITY_VALUE_RANGES[quality];
      const value = Phaser.Math.Between(valRange[0], valRange[1]);

      const container = this.add.container(x, y);
      container.setDepth(7);
      const color = QUALITY_COLORS[quality];
      const base = this.add.rectangle(0, 0, 24, 24, color);
      base.setStrokeStyle(2, 0xffffff, 0.5);
      const icon = this.add.text(0, 0, '💎', { fontSize: '16px' }).setOrigin(0.5);
      container.add([base, icon]);

      this.tweens.add({ targets: container, y: y - 5, duration: 800, yoyo: true, repeat: -1 });

      this.treasures.push({ x, y, value, quality, collected: false, sprite: container });
    }
  }

  // ── Monster Spawning ─────────────────────────────────────────────────────

  private spawnMonsters(count: number) {
    const fd = this.floorDataMap.get(this.currentFloor)!;
    for (let i = 0; i < count; i++) {
      const room = fd.rooms[Phaser.Math.Between(1, fd.rooms.length - 1)];
      const x = Phaser.Math.Between(room.x + 40, room.x + room.w - 40);
      const y = Phaser.Math.Between(room.y + 40, room.y + room.h - 40);
      this.createGhost(x, y, false);
    }
  }

  private spawnBoss() {
    const fd = this.floorDataMap.get(this.currentFloor)!;
    const room = fd.rooms[Phaser.Math.Between(0, fd.rooms.length - 1)];
    this.createGhost(room.centerX, room.centerY, true);
    this.showMessage(`BOSS出现在本层！`);
  }

  // ── Special Events ──────────────────────────────────────────────────────

  private triggerSpecialEvent() {
    const roll = Math.random();
    if (roll < 0.30) {
      // Hidden room
      this.spawnTreasures(3, 2);
      this.showMessage('特殊事件：隐藏房间开启！高价值财宝出现！');
    } else if (roll < 0.55) {
      // Ghost seal - freeze all ghosts
      for (const ghost of this.ghosts) {
        if (ghost.alive) {
          ghost.speed = 0;
          ghost.chaseSpeed = 0;
        }
      }
      this.time.delayedCall(60000, () => {
        const cfg = FLOOR_CONFIGS[this.currentFloor - 1];
        for (const ghost of this.ghosts) {
          if (ghost.alive) {
            ghost.speed = cfg.ghostSpeed;
            ghost.chaseSpeed = cfg.ghostChaseSpeed;
          }
        }
      });
      this.showMessage('特殊事件：鬼魂封印！所有鬼冻结60秒！');
    } else if (roll < 0.75) {
      // Time warp
      this.timeWarpTimer = 30000;
      this.showMessage('特殊事件：时间扭曲！鬼速度降低50%，持续30秒！');
    } else if (roll < 0.90) {
      // Treasure map - reveal all treasures with glow
      for (const treasure of this.treasures) {
        if (!treasure.collected) {
          const glow = this.add.text(treasure.x, treasure.y - 20, '⬇', { fontSize: '20px', color: '#ffff00' }).setOrigin(0.5).setDepth(8);
          this.tweens.add({ targets: glow, alpha: 0, duration: 500, yoyo: true, repeat: 6, onComplete: () => glow.destroy() });
        }
      }
      this.showMessage('特殊事件：宝藏地图！财宝位置已标记！');
    } else {
      // Curse removal
      this.health = this.maxHealth;
      this.showMessage('特殊事件：诅咒解除！生命恢复满值！');
    }
  }

  // ── Evacuation Tasks ─────────────────────────────────────────────────────

  private initEvacuationTasks() {
    for (let floor = 1; floor <= this.totalFloors; floor++) {
      const fd = this.floorDataMap.get(floor)!;
      const cfg = FLOOR_CONFIGS[floor - 1];

      if (cfg.evacTaskType === EvacuationTaskType.CollectItems) {
        // Spawn collectible items
        for (let i = 0; i < cfg.evacTarget; i++) {
          const room = fd.rooms[Phaser.Math.Between(0, fd.rooms.length - 1)];
          const x = Phaser.Math.Between(room.x + 40, room.x + room.w - 40);
          const y = Phaser.Math.Between(room.y + 40, room.y + room.h - 40);
          const container = this.add.container(x, y);
          container.setDepth(6);
          const base = this.add.rectangle(0, 0, 20, 20, 0xcc8800);
          const icon = this.add.text(0, 0, '🪙', { fontSize: '14px' }).setOrigin(0.5);
          container.add([base, icon]);
          this.tweens.add({ targets: container, y: y - 4, duration: 600, yoyo: true, repeat: -1 });
          container.setVisible(floor === this.currentFloor);
          this.collectibles.push({ x, y, collected: false, sprite: container, name: '古老硬币' });
        }
      } else if (cfg.evacTaskType === EvacuationTaskType.MultiActivate) {
        // Spawn 3 switches
        for (let i = 0; i < 3; i++) {
          const room = fd.rooms[i % fd.rooms.length];
          const x = room.centerX + (i - 1) * 30;
          const y = room.centerY;
          const container = this.add.container(x, y);
          container.setDepth(6);
          const base = this.add.rectangle(0, 0, 30, 30, 0x444444);
          base.setStrokeStyle(2, 0x888888);
          const icon = this.add.text(0, 0, '🔘', { fontSize: '16px' }).setOrigin(0.5);
          container.add([base, icon]);
          container.setVisible(floor === this.currentFloor);
          this.multiSwitches.push({ x, y, activated: false, sprite: container });
        }
      }
    }
  }

  private activateEvacuationTask() {
    const fd = this.floorDataMap.get(this.currentFloor)!;
    const cfg = FLOOR_CONFIGS[this.currentFloor - 1];

    if (cfg.evacTaskType === EvacuationTaskType.TimedEscape) {
      fd.evacTask.timer = cfg.evacTarget * 1000;
      fd.evacTask.timerActive = true;
      this.showMessage('警报触发！限时逃脱开始！');
    } else if (cfg.evacTaskType === EvacuationTaskType.BossSeal) {
      // Boss already spawned via crack result, just need to survive
      this.showMessage('击败BOSS或存活即可撤离！');
    }
  }

  private updateEvacTimer(delta: number) {
    const fd = this.floorDataMap.get(this.currentFloor)!;
    if (fd.evacTask.timerActive && fd.evacTask.timer > 0) {
      fd.evacTask.timer -= delta;
      if (fd.evacTask.timer <= 0) {
        fd.evacTask.timer = 0;
        fd.evacTask.timerActive = false;
        this.showMessage('时间到！撤离点已开启！');
        this.completeEvacTask();
      }
      this.timerText.setText(`撤离倒计时: ${Math.ceil(fd.evacTask.timer / 1000)}s`);
      this.timerText.setVisible(true);
    } else {
      this.timerText.setVisible(false);
    }
  }

  private checkEvacuationComplete() {
    const fd = this.floorDataMap.get(this.currentFloor)!;
    if (fd.evacTask.completed) return;
    const cfg = FLOOR_CONFIGS[this.currentFloor - 1];

    switch (cfg.evacTaskType) {
      case EvacuationTaskType.CollectItems:
        if (fd.evacTask.current >= fd.evacTask.target) {
          this.completeEvacTask();
        }
        break;
      case EvacuationTaskType.KeyPuzzle:
        // Key is obtained from cracking, check if player has key
        if (fd.evacTask.current >= 1) {
          this.completeEvacTask();
        }
        break;
      case EvacuationTaskType.MultiActivate:
        if (this.multiSwitches.every(s => s.activated)) {
          this.completeEvacTask();
        }
        break;
      case EvacuationTaskType.BossSeal:
        // Check if boss is dead
        if (!this.ghosts.some(g => g.isBoss && g.alive)) {
          this.completeEvacTask();
        }
        break;
    }
  }

  private completeEvacTask() {
    const fd = this.floorDataMap.get(this.currentFloor)!;
    fd.evacTask.completed = true;
    fd.evacTask.timerActive = false;
    this.activateExit();
    const cfg = FLOOR_CONFIGS[this.currentFloor - 1];
    const taskNames: Record<number, string> = {
      [EvacuationTaskType.CollectItems]: '物资收集',
      [EvacuationTaskType.KeyPuzzle]: '钥匙解谜',
      [EvacuationTaskType.TimedEscape]: '限时逃脱',
      [EvacuationTaskType.MultiActivate]: '多点激活',
      [EvacuationTaskType.BossSeal]: 'BOSS封印',
    };
    this.showMessage(`撤离任务完成：${taskNames[cfg.evacTaskType] || ''}！前往出口撤离！`);
  }

  private activateExit() {
    const fd = this.floorDataMap.get(this.currentFloor)!;
    if (fd.exitActive) return;
    fd.exitActive = true;

    // Place exit in a room different from the cracking table
    let exitRoom = this.rooms[0];
    if (fd.crackingTable) {
      const ctRoom = this.rooms.find(r => fd.crackingTable!.x >= r.x && fd.crackingTable!.x <= r.x + r.w && fd.crackingTable!.y >= r.y && fd.crackingTable!.y <= r.y + r.h);
      if (ctRoom) {
        const otherRooms = this.rooms.filter(r => r !== ctRoom);
        exitRoom = otherRooms[0] || this.rooms[0];
      }
    }
    const container = this.add.container(exitRoom.centerX, exitRoom.centerY);
    const base = this.add.rectangle(0, 0, 50, 50, 0x00ff00, 0.5);
    const text = this.add.text(0, 0, '出口', { fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    container.add([base, text]);
    container.setDepth(8);
    this.tweens.add({ targets: container, alpha: 0.5, duration: 500, yoyo: true, repeat: -1 });
    fd.exit = container;
  }

  // ── Player ───────────────────────────────────────────────────────────────

  private createPlayer() {
    const startRoom = this.rooms[0];
    this.player = this.add.rectangle(startRoom.centerX, startRoom.centerY, 24, 24, 0x00ff00);
    this.player.setDepth(10);
  }

  private handleMovement(delta: number) {
    const speed = this.getEffectiveSpeed() * delta / 1000;
    let dx = 0, dy = 0;
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) dx += 1;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) dy -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const dir = new Phaser.Math.Vector2(dx, dy).normalize();
      const newX = this.player.x + dir.x * speed;
      const newY = this.player.y + dir.y * speed;
      if (!this.isObstacleAt(newX, this.player.y, 12)) this.player.x = newX;
      if (!this.isObstacleAt(this.player.x, newY, 12)) this.player.y = newY;
      this.playerFacingAngle = Math.atan2(dir.y, dir.x);
    }

    this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.mapWidth - 20);
    this.player.y = Phaser.Math.Clamp(this.player.y, 20, this.mapHeight - 20);

    if (this.blindBoxSprite && this.blindBoxSprite.active) {
      this.blindBoxSprite.x = this.player.x + 20;
      this.blindBoxSprite.y = this.player.y - 20;
    }
  }

  private isObstacleAt(x: number, y: number, radius: number): boolean {
    for (const obs of this.obstacles) {
      const closestX = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
      const closestY = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
      if (Phaser.Math.Distance.Between(x, y, closestX, closestY) < radius) return true;
    }
    return false;
  }

  // ── Ghosts ───────────────────────────────────────────────────────────────

  private createWanderingGhosts() {
    this.ghosts = [];
    for (let floor = 1; floor <= this.totalFloors; floor++) {
      const fd = this.floorDataMap.get(floor)!;
      const ghostCount = 1 + floor; // 2 on 1F, 3 on 2F, etc.
      for (let i = 0; i < ghostCount; i++) {
        const room = fd.rooms[Phaser.Math.Between(1, fd.rooms.length - 1)];
        const ghost = this.createGhost(room.centerX, room.centerY, false);
        if (floor !== this.currentFloor) {
          ghost.sprite.setVisible(false);
          fd.ghosts.push(ghost);
        }
      }
    }
  }

  private createGhost(x: number, y: number, isBoss: boolean): Ghost {
    const cfg = FLOOR_CONFIGS[this.currentFloor - 1];
    const container = this.add.container(x, y);
    container.setDepth(9);
    const size = isBoss ? 24 : 14;
    const color = isBoss ? 0xff00ff : 0xff0000;
    const alpha = isBoss ? 0.9 : 0.7;
    const body = this.add.arc(0, 0, size, 0, 360, false, color, alpha);
    container.add(body);
    if (isBoss) {
      const crown = this.add.text(0, -size - 5, '👑', { fontSize: '16px' }).setOrigin(0.5);
      container.add(crown);
    }

    let speed = cfg.ghostSpeed;
    let chaseSpeed = cfg.ghostChaseSpeed;
    if (this.timeWarpTimer > 0) { speed *= 0.5; chaseSpeed *= 0.5; }

    const ghost: Ghost = {
      sprite: container, body,
      speed, chaseSpeed,
      direction: new Phaser.Math.Vector2(Phaser.Math.Between(-1, 1), Phaser.Math.Between(-1, 1)).normalize(),
      isChasing: false, giveUpTimer: 0,
      giveUpDuration: isBoss ? 5000 : 3000,
      homeX: x, homeY: y,
      visionRange: cfg.ghostVision,
      patrolTimer: 0, alive: true, isBoss,
      damage: isBoss ? cfg.bossDamage : cfg.ghostDamage,
    };
    this.ghosts.push(ghost);
    return ghost;
  }

  private createGhostVisual(ghost: Ghost) {
    const container = this.add.container(ghost.homeX, ghost.homeY);
    container.setDepth(9);
    const size = ghost.isBoss ? 24 : 14;
    const color = ghost.isBoss ? 0xff00ff : 0xff0000;
    const alpha = ghost.isBoss ? 0.9 : 0.7;
    const body = this.add.arc(0, 0, size, 0, 360, false, color, alpha);
    container.add(body);
    if (ghost.isBoss) {
      const crown = this.add.text(0, -size - 5, '👑', { fontSize: '16px' }).setOrigin(0.5);
      container.add(crown);
    }
    ghost.sprite = container;
    ghost.body = body;
  }

  private updateGhosts(delta: number) {
    for (const ghost of this.ghosts) {
      if (!ghost.alive || !ghost.sprite.visible) continue;
      const distToPlayer = Phaser.Math.Distance.Between(this.player.x, this.player.y, ghost.sprite.x, ghost.sprite.y);

      if (distToPlayer < ghost.visionRange && !ghost.isChasing) {
        ghost.isChasing = true;
        ghost.giveUpTimer = ghost.giveUpDuration;
      }

      if (ghost.isChasing) {
        const dir = new Phaser.Math.Vector2(this.player.x - ghost.sprite.x, this.player.y - ghost.sprite.y).normalize();
        ghost.sprite.x += dir.x * ghost.chaseSpeed * delta / 1000;
        ghost.sprite.y += dir.y * ghost.chaseSpeed * delta / 1000;
        ghost.giveUpTimer -= delta;
        if (ghost.giveUpTimer <= 0 || distToPlayer > ghost.visionRange * 1.5) ghost.isChasing = false;
        if (distToPlayer < 30 && this.damageCooldown <= 0 && this.spawnImmunity <= 0) {
          this.takeDamage(ghost.damage);
          this.damageCooldown = 1000;
        }
      } else {
        ghost.sprite.x += ghost.direction.x * ghost.speed * delta / 1000;
        ghost.sprite.y += ghost.direction.y * ghost.speed * delta / 1000;
        ghost.patrolTimer -= delta;
        if (ghost.patrolTimer <= 0) {
          ghost.direction = new Phaser.Math.Vector2(Phaser.Math.Between(-1, 1), Phaser.Math.Between(-1, 1)).normalize();
          ghost.patrolTimer = Phaser.Math.Between(2000, 5000);
        }
        const distToHome = Phaser.Math.Distance.Between(ghost.homeX, ghost.homeY, ghost.sprite.x, ghost.sprite.y);
        if (distToHome > 300) {
          ghost.direction = new Phaser.Math.Vector2(ghost.homeX - ghost.sprite.x, ghost.homeY - ghost.sprite.y).normalize();
        }
      }

      if (this.isObstacleAt(ghost.sprite.x, ghost.sprite.y, ghost.isBoss ? 24 : 14)) {
        ghost.direction = new Phaser.Math.Vector2(-ghost.direction.x, -ghost.direction.y);
        ghost.sprite.x -= ghost.direction.x * 10;
        ghost.sprite.y -= ghost.direction.y * 10;
      }
    }
  }

  // ── Fog of War ───────────────────────────────────────────────────────────

  private createFog() {
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.screenW;
    this.fogCanvas.height = this.screenH;
    this.fogCtx = this.fogCanvas.getContext('2d')!;
    if (this.textures.exists(this.fogTextureKey)) this.textures.remove(this.fogTextureKey);
    this.textures.addCanvas(this.fogTextureKey, this.fogCanvas);
    this.fogImage = this.add.image(0, 0, this.fogTextureKey);
    this.fogImage.setOrigin(0, 0);
    this.fogImage.setScrollFactor(0);
    this.fogImage.setDepth(100);
  }

  private updateFog() {
    const ctx = this.fogCtx;
    ctx.clearRect(0, 0, this.screenW, this.screenH);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    ctx.fillRect(0, 0, this.screenW, this.screenH);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';

    const screenX = this.player.x - this.cam.scrollX;
    const screenY = this.player.y - this.cam.scrollY;
    const inDarkRoom = this.isPlayerInDarkRoom();
    // Higher floors = smaller vision
    const floorPenalty = 1 - (this.currentFloor - 1) * 0.05;
    const coneRadius = (inDarkRoom ? this.viewRadius * 1.2 : this.viewRadius * 4) * floorPenalty;
    const coneAngle = Math.PI / 2;
    const startAngle = this.playerFacingAngle - coneAngle / 2;
    const endAngle = this.playerFacingAngle + coneAngle / 2;

    ctx.beginPath();
    ctx.moveTo(screenX, screenY);
    ctx.arc(screenX, screenY, coneRadius, startAngle, endAngle);
    ctx.closePath();

    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, coneRadius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

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

  private isPlayerInDarkRoom(): boolean {
    for (const room of this.rooms) {
      if (this.player.x >= room.x && this.player.x <= room.x + room.w &&
          this.player.y >= room.y && this.player.y <= room.y + room.h) return !room.lightOn;
    }
    return false;
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  private createUI() {
    this.healthText = this.add.text(10, 10, `生命: ${this.health}/${this.maxHealth}`, { fontSize: '16px', color: '#ff0000' }).setScrollFactor(0).setDepth(200);
    this.scoreText = this.add.text(10, 35, `分数: ${this.treasureScore}`, { fontSize: '16px', color: '#ffd700' }).setScrollFactor(0).setDepth(200);
    this.boxStatusText = this.add.text(10, 60, `破解: ${this.cracksRemaining}/${this.totalCracks}`, { fontSize: '16px', color: '#ff6600' }).setScrollFactor(0).setDepth(200);
    this.floorText = this.add.text(10, 85, `${this.currentFloor}F - ${FLOOR_CONFIGS[0].name}`, { fontSize: '16px', color: '#00ffff' }).setScrollFactor(0).setDepth(200);
    this.taskText = this.add.text(10, 110, '', { fontSize: '14px', color: '#88ff88' }).setScrollFactor(0).setDepth(200);
    this.timerText = this.add.text(400, 130, '', { fontSize: '20px', color: '#ff4444', fontStyle: 'bold' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);

    this.hintText = this.add.text(400, 550, '', { fontSize: '14px', color: '#ffffff', backgroundColor: '#000000', padding: { x: 8, y: 4 } }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
    this.messageText = this.add.text(400, 500, '', { fontSize: '18px', color: '#ffff00', backgroundColor: '#000000', padding: { x: 12, y: 6 } }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
    this.add.text(400, 580, 'WASD 移动 | E 破解/交互 | F 上下楼', { fontSize: '14px', color: '#888888' }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
  }

  private updateHint() {
    let hint = '';
    const fd = this.floorDataMap.get(this.currentFloor)!;

    // Cracking table
    if (fd.crackingTable && !fd.isCracked && this.cracksRemaining > 0) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, fd.crackingTable.x, fd.crackingTable.y);
      if (dist < 60) hint = '按E破解盲盒';
    }

    // Stairs
    if (!hint && fd.evacTask.completed && this.cracksRemaining > 0) {
      for (const stair of this.stairs) {
        if (stair.floor !== this.currentFloor) continue;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, stair.x, stair.y);
        if (dist < 50) { hint = `按F前往 ${stair.targetFloor}F`; break; }
      }
    }

    // Exit
    if (!hint && fd.exitActive && fd.exit) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, fd.exit.x, fd.exit.y);
      if (dist < 40) hint = '按E撤离！';
    }

    // Treasure pickup
    if (!hint) {
      for (const treasure of this.treasures) {
        if (treasure.collected) continue;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, treasure.x, treasure.y);
        if (dist < 30) { hint = `按E拾取${QUALITY_NAMES[treasure.quality]}财宝`; break; }
      }
    }

    // Collectibles
    if (!hint) {
      for (const col of this.collectibles) {
        if (col.collected) continue;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, col.x, col.y);
        if (dist < 30) { hint = `按E拾取${col.name}`; break; }
      }
    }

    // Multi switches
    if (!hint) {
      for (const sw of this.multiSwitches) {
        if (sw.activated) continue;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, sw.x, sw.y);
        if (dist < 40) { hint = '按E激活机关'; break; }
      }
    }

    // Light switch
    if (!hint) {
      for (const room of this.rooms) {
        if (room.hasLight) {
          const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, room.switchX, room.switchY);
          if (dist < 40) { hint = '按E开关灯'; break; }
        }
      }
    }

    this.hintText.setText(hint);
    this.hintText.setVisible(hint.length > 0);

    // Update UI
    this.healthText.setText(`生命: ${Math.ceil(this.health)}/${this.maxHealth}`);
    this.scoreText.setText(`分数: ${this.treasureScore}`);
    this.boxStatusText.setText(`破解: ${this.cracksRemaining}/${this.totalCracks}`);
    this.floorText.setText(`${this.currentFloor}F - ${FLOOR_CONFIGS[this.currentFloor - 1].name}`);

    // Task text
    const cfg = FLOOR_CONFIGS[this.currentFloor - 1];
    const taskNames: Record<number, string> = {
      [EvacuationTaskType.CollectItems]: '收集物资',
      [EvacuationTaskType.KeyPuzzle]: '钥匙解谜',
      [EvacuationTaskType.TimedEscape]: '限时逃脱',
      [EvacuationTaskType.MultiActivate]: '多点激活',
      [EvacuationTaskType.BossSeal]: 'BOSS封印',
    };
    if (fd.evacTask.completed) {
      this.taskText.setText(`任务: ${taskNames[cfg.evacTaskType]} ✓ 已完成`);
    } else if (fd.isCracked) {
      this.taskText.setText(`任务: ${taskNames[cfg.evacTaskType]} (${fd.evacTask.current}/${fd.evacTask.target})`);
    } else {
      this.taskText.setText(`任务: 待破解`);
    }
  }

  // ── Damage & Death ───────────────────────────────────────────────────────

  private takeDamage(amount: number) {
    this.health -= amount;
    if (this.health <= 0) { this.health = 0; this.die(); }
  }

  private die() {
    this.gameState = 'dead';
    this.showMessage('你死了...所有未撤离的奖励已丢失');
    this.player.setFillStyle(0x880000);
    this.time.delayedCall(3000, () => this.scene.restart());
  }

  // ── Win ──────────────────────────────────────────────────────────────────

  private winGame() {
    this.gameState = 'won';
    const fd = this.floorDataMap.get(this.currentFloor)!;
    const finalScore = Math.floor(this.treasureScore * fd.evacTask.rewardMult);
    this.showMessage(`撤离成功！\n财宝分数: ${this.treasureScore}\n楼层加成: x${fd.evacTask.rewardMult}\n最终分数: ${finalScore}`);
    this.player.setFillStyle(0x00ff00);
    this.time.delayedCall(5000, () => this.scene.restart());
  }

  // ── Input ────────────────────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W, A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S, D: Phaser.Input.Keyboard.KeyCodes.D,
    }) as any;
    this.input.keyboard!.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W, A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S, D: Phaser.Input.Keyboard.KeyCodes.D,
    }) as any;

    this.input.keyboard!.on('keydown-E', () => this.handleInteraction());
    this.input.keyboard!.on('keydown-F', () => this.handleStairs());
  }

  private handleInteraction() {
    const fd = this.floorDataMap.get(this.currentFloor)!;

    // Crack blind box
    if (fd.crackingTable && !fd.isCracked && this.cracksRemaining > 0) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, fd.crackingTable.x, fd.crackingTable.y);
      if (dist < 60) { this.crackBlindBox(); return; }
    }

    // Pickup treasure
    for (const treasure of this.treasures) {
      if (treasure.collected) continue;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, treasure.x, treasure.y);
      if (dist < 30) { this.collectTreasure(treasure); return; }
    }

    // Pickup collectible
    for (const col of this.collectibles) {
      if (col.collected || !col.sprite.visible) continue;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, col.x, col.y);
      if (dist < 30) {
        col.collected = true;
        fd.evacTask.current++;
        this.showMessage(`拾取了${col.name}！(${fd.evacTask.current}/${fd.evacTask.target})`);
        this.tweens.add({ targets: col.sprite, alpha: 0, scale: 0, duration: 300, onComplete: () => col.sprite.destroy() });
        return;
      }
    }

    // Multi switch
    for (const sw of this.multiSwitches) {
      if (sw.activated || !sw.sprite.visible) continue;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, sw.x, sw.y);
      if (dist < 40) {
        sw.activated = true;
        const base = sw.sprite.getAt(0) as Phaser.GameObjects.Rectangle;
        base.setFillStyle(0x00ff00);
        this.showMessage(`机关激活！(${this.multiSwitches.filter(s => s.activated).length}/${this.multiSwitches.length})`);
        return;
      }
    }

    // Light switch
    for (const room of this.rooms) {
      if (room.hasLight) {
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, room.switchX, room.switchY);
        if (dist < 40) { room.lightOn = !room.lightOn; this.updateRoomLight(); return; }
      }
    }

    // Exit
    if (fd.exitActive && fd.exit) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, fd.exit.x, fd.exit.y);
      if (dist < 40) this.winGame();
    }
  }

  private collectTreasure(treasure: Treasure) {
    treasure.collected = true;
    this.treasureScore += treasure.value;
    this.showMessage(`获得${QUALITY_NAMES[treasure.quality]}财宝！价值 ${treasure.value}`);
    this.tweens.add({ targets: treasure.sprite, alpha: 0, scale: 0, duration: 500, onComplete: () => treasure.sprite.destroy() });
  }

  private updateRoomLight() {
    for (const overlay of this.roomLightOverlays) overlay.destroy();
    this.roomLightOverlays = [];
    for (const r of this.rooms) {
      if (!r.lightOn) {
        const overlay = this.add.graphics();
        overlay.fillStyle(0x000000, 0.7);
        overlay.fillRect(r.x, r.y, r.w, r.h);
        overlay.setDepth(2);
        this.roomLightOverlays.push(overlay);
      }
    }
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  private showMessage(msg: string) {
    this.messageText.setText(msg);
    this.messageText.setAlpha(1);
    this.tweens.add({
      targets: this.messageText, alpha: 0, duration: 3000,
      onComplete: () => { this.messageText.setText(''); this.messageText.setAlpha(1); },
    });
  }

  private updateFloorText() {
    this.floorText.setText(`${this.currentFloor}F - ${FLOOR_CONFIGS[this.currentFloor - 1].name}`);
  }

  private getEffectiveSpeed(): number {
    return 150;
  }
}
