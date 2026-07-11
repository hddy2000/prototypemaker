import Phaser from 'phaser';

// ── Types ──────────────────────────────────────────────────────────────────

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
  bossDamage: number;
}

type DebuffType = 'slow' | 'poison' | 'confusion' | 'darkness';

interface Debuff {
  type: DebuffType;
  remaining: number;
}

interface FloorData {
  rooms: Room[];
  obstacles: Obstacle[];
  ghosts: Ghost[];
}

interface Treasure {
  x: number; y: number;
  value: number;
  icon: string;
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
}

// ── Scene ──────────────────────────────────────────────────────────────────

export class BlindBoxHorrorScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private eKey!: Phaser.Input.Keyboard.Key;
  private fKey!: Phaser.Input.Keyboard.Key;
  private qKey!: Phaser.Input.Keyboard.Key;

  // Map - multi-floor
  private mapWidth = 900;
  private mapHeight = 700;
  private obstacles: Obstacle[] = [];
  private rooms: Room[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Floor system
  private currentFloor = 1;
  private totalFloors = 3;
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

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private ghosts: Ghost[] = [];
  private treasures: Treasure[] = [];

  // Blind box system
  private hasBlindBox = true;
  private blindBoxSprite!: Phaser.GameObjects.Container;
  private crackingTable: { x: number; y: number; floor: number; sprite: Phaser.GameObjects.Container } | null = null;
  private boxCracked = false;

  // Player stats
  private health = 100;
  private maxHealth = 100;
  private debuffs: Debuff[] = [];
  private treasureCollected = 0;
  private treasureTotal = 0;

  // Game state
  private isDead = false;
  private isWon = false;
  private damageCooldown = 0;
  private spawnImmunity = 3000;

  // UI
  private healthText!: Phaser.GameObjects.Text;
  private treasureText!: Phaser.GameObjects.Text;
  private boxStatusText!: Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  // Player facing direction
  private playerFacingAngle = 0;

  // Room light system
  private roomLightOverlays: Phaser.GameObjects.Graphics[] = [];

  // Exit
  private exit: Phaser.GameObjects.Container | null = null;
  private isEscaping = false;

  constructor() {
    super({ key: 'BlindBoxHorrorScene' });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  create() {
    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    // Initialize floor data
    for (let i = 1; i <= this.totalFloors; i++) {
      this.floorDataMap.set(i, { rooms: [], obstacles: [], ghosts: [] });
    }

    this.generateMansion();
    this.drawMap();
    this.createPlayer();
    this.createStairs();
    this.createCrackingTable();
    this.createWanderingGhosts();
    this.createBlindBoxIndicator();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);
  }

  update(time: number, delta: number) {
    if (this.isDead || this.isWon) return;

    this.handleMovement(delta);
    this.updateFog();
    this.updateGhosts(delta);
    this.updateDebuffs(delta);
    this.updateHint();

    if (this.damageCooldown > 0) {
      this.damageCooldown -= delta;
    }
    if (this.spawnImmunity > 0) {
      this.spawnImmunity -= delta;
    }

    // Check win condition - all treasures collected
    if (this.treasureTotal > 0 && this.treasureCollected >= this.treasureTotal && !this.isEscaping) {
      this.spawnExit();
      this.isEscaping = true;
      this.showMessage('收集了所有财宝！找到出口逃离！');
    }

    // Check escape
    if (this.isEscaping && this.exit && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exit.x, this.exit.y) < 40) {
      if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
        this.winGame();
      }
    }
  }

  // ── Mansion Generation ───────────────────────────────────────────────────

  private generateMansion() {
    const floorNames = [
      ['大厅', '客厅', '厨房', '餐厅'],
      ['卧室', '书房', '浴室', '走廊'],
      ['阁楼', '储藏室', '阳台', '密室'],
    ];

    for (let floor = 1; floor <= this.totalFloors; floor++) {
      const fd = this.floorDataMap.get(floor)!;
      fd.rooms = [];
      fd.obstacles = [];

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
          const hasLight = Math.random() < 0.5;

          fd.rooms.push({
            x, y, w: roomW, h: roomH,
            name: floorNames[floor - 1][idx],
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

      // Furniture obstacles
      for (const room of fd.rooms) {
        const decorCount = Phaser.Math.Between(2, 3);
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

    // Set current floor
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
        fontSize: '18px',
        color: '#555577',
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
    for (let x = 0; x < this.mapWidth; x += 60) {
      this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += 60) {
      this.mapGraphics.lineBetween(0, y, this.mapWidth, y);
    }

    this.mapGraphics.fillStyle(0x444466, 1);
    for (const obs of this.obstacles) {
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
    }

    this.mapGraphics.lineStyle(2, 0x666688, 1);
    for (const room of this.rooms) {
      this.mapGraphics.strokeRect(room.x, room.y, room.w, room.h);
    }
  }

  // ── Stairs ───────────────────────────────────────────────────────────────

  private createStairs() {
    for (let floor = 1; floor <= this.totalFloors; floor++) {
      const fd = this.floorDataMap.get(floor)!;
      const stairRoom = fd.rooms[3]; // Bottom-right room

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

    const arrowText = direction === 'up' ? '↑' : '↓';
    const arrow = this.add.text(0, -5, arrowText, {
      fontSize: '24px',
      color: '#ffcc00',
    }).setOrigin(0.5);

    const floorText = this.add.text(0, 15, `${targetFloor}F`, {
      fontSize: '14px',
      color: '#ffffff',
    }).setOrigin(0.5);

    container.add([base, arrow, floorText]);

    this.tweens.add({
      targets: container,
      alpha: 0.6,
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    return { x, y, targetFloor, floor, sprite: container };
  }

  private updateStairsVisibility() {
    for (const stair of this.stairs) {
      stair.sprite.setVisible(stair.floor === this.currentFloor);
    }
  }

  private handleStairs() {
    if (this.isTransitioning) return;
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

    // Save current floor state
    const currentFD = this.floorDataMap.get(this.currentFloor)!;
    currentFD.rooms = this.rooms;
    currentFD.obstacles = this.obstacles;
    currentFD.ghosts = this.ghosts;

    // Clear current floor objects
    this.clearFloorObjects();

    // Load target floor
    this.currentFloor = targetFloor;
    const targetFD = this.floorDataMap.get(targetFloor)!;
    this.rooms = targetFD.rooms;
    this.obstacles = targetFD.obstacles;
    this.ghosts = targetFD.ghosts;

    // Redraw map
    this.drawMap();

    // Restore ghosts
    for (const ghost of this.ghosts) {
      if (!ghost.sprite) {
        this.createGhostVisual(ghost);
      }
      ghost.sprite.setVisible(ghost.alive);
    }

    // Place player away from stairs
    const targetRoom = this.rooms[3];
    this.player.x = targetRoom.centerX;
    this.player.y = targetRoom.centerY + 60;

    this.updateStairsVisibility();
    this.updateFloorText();

    this.cam.flash(300, 255, 255, 200);
    this.showMessage(`到达 ${targetFloor}F`);

    this.time.delayedCall(500, () => { this.isTransitioning = false; });
  }

  private clearFloorObjects() {
    for (const ghost of this.ghosts) {
      if (ghost.sprite) ghost.sprite.setVisible(false);
    }
    if (this.mapGraphics) {
      this.mapGraphics.destroy();
    }
    for (const overlay of this.roomLightOverlays) {
      overlay.destroy();
    }
    this.roomLightOverlays = [];
    for (const t of this.floorTexts) {
      t.destroy();
    }
    this.floorTexts = [];
  }

  // ── Blind Box & Cracking Table ───────────────────────────────────────────

  private createBlindBoxIndicator() {
    // Show blind box following player
    this.blindBoxSprite = this.add.container(this.player.x + 20, this.player.y - 20);
    const box = this.add.rectangle(0, 0, 20, 20, 0xff6600);
    const qmark = this.add.text(0, 0, '?', {
      fontSize: '14px',
      color: '#ffffff',
    }).setOrigin(0.5);
    this.blindBoxSprite.add([box, qmark]);
    this.blindBoxSprite.setDepth(11);
  }

  private createCrackingTable() {
    // Random floor and room
    const floor = Phaser.Math.Between(1, this.totalFloors);
    const fd = this.floorDataMap.get(floor)!;
    const room = fd.rooms[Phaser.Math.Between(0, fd.rooms.length - 1)];
    const x = room.centerX;
    const y = room.centerY;

    const container = this.add.container(x, y);
    container.setDepth(7);

    // Table base
    const table = this.add.rectangle(0, 0, 60, 40, 0x8b4513);
    table.setStrokeStyle(2, 0xa0522d, 1);

    // Cracking tools
    const hammer = this.add.text(-15, -5, '🔨', { fontSize: '16px' }).setOrigin(0.5);
    const glow = this.add.text(15, -5, '✨', { fontSize: '16px' }).setOrigin(0.5);

    // Label
    const label = this.add.text(0, 25, '破解台', {
      fontSize: '12px',
      color: '#ffcc00',
    }).setOrigin(0.5);

    container.add([table, hammer, glow, label]);

    // Pulsing animation
    this.tweens.add({
      targets: container,
      scaleX: 1.1,
      scaleY: 1.1,
      duration: 1000,
      yoyo: true,
      repeat: -1,
    });

    this.crackingTable = { x, y, floor, sprite: container };

    // Only show if on current floor
    container.setVisible(floor === this.currentFloor);
  }

  private crackBlindBox() {
    if (!this.hasBlindBox || this.boxCracked) return;

    this.boxCracked = true;
    this.hasBlindBox = false;
    this.blindBoxSprite.setVisible(false);

    this.showMessage('正在破解盲盒...');

    // Animation
    this.tweens.add({
      targets: this.blindBoxSprite,
      scaleX: 2,
      scaleY: 2,
      alpha: 0,
      duration: 1000,
      onComplete: () => {
        this.blindBoxSprite.destroy();
        this.revealBlindBoxContents();
      },
    });
  }

  private revealBlindBoxContents() {
    const roll = Math.random();

    if (roll < 0.4) {
      // 40% - Treasure spawn (3-5 treasures on current floor)
      this.spawnTreasures();
      this.showMessage('盲盒结果：财宝散落各处！收集它们！');
    } else if (roll < 0.7) {
      // 30% - Monster spawn (2-4 monsters on current floor)
      this.spawnMonsters();
      this.showMessage('盲盒结果：召唤了怪物！小心！');
    } else if (roll < 0.9) {
      // 20% - Boss spawn (1 boss on random floor)
      this.spawnBoss();
      this.showMessage('盲盒结果：召唤了BOSS！它在某处游荡！');
    } else {
      // 10% - Mixed (treasures + monsters)
      this.spawnTreasures();
      this.spawnMonsters();
      this.showMessage('盲盒结果：财宝和怪物同时出现！');
    }
  }

  private spawnTreasures() {
    const count = Phaser.Math.Between(3, 5);
    const fd = this.floorDataMap.get(this.currentFloor)!;

    for (let i = 0; i < count; i++) {
      const room = fd.rooms[Phaser.Math.Between(0, fd.rooms.length - 1)];
      const x = Phaser.Math.Between(room.x + 40, room.x + room.w - 40);
      const y = Phaser.Math.Between(room.y + 40, room.y + room.h - 40);
      const value = Phaser.Math.Between(100, 500);

      const container = this.add.container(x, y);
      container.setDepth(7);

      const base = this.add.rectangle(0, 0, 24, 24, 0xffd700);
      base.setStrokeStyle(2, 0xffaa00, 1);
      const icon = this.add.text(0, 0, '💎', { fontSize: '16px' }).setOrigin(0.5);

      container.add([base, icon]);

      // Floating animation
      this.tweens.add({
        targets: container,
        y: y - 5,
        duration: 800,
        yoyo: true,
        repeat: -1,
      });

      const treasure: Treasure = {
        x, y, value, icon: '💎',
        collected: false,
        sprite: container,
      };

      this.treasures.push(treasure);
      this.treasureTotal++;
    }
  }

  private spawnMonsters() {
    const count = Phaser.Math.Between(2, 4);
    const fd = this.floorDataMap.get(this.currentFloor)!;

    for (let i = 0; i < count; i++) {
      const room = fd.rooms[Phaser.Math.Between(1, fd.rooms.length - 1)];
      const x = Phaser.Math.Between(room.x + 40, room.x + room.w - 40);
      const y = Phaser.Math.Between(room.y + 40, room.y + room.h - 40);

      this.createGhost(x, y, false);
    }
  }

  private spawnBoss() {
    const floor = Phaser.Math.Between(1, this.totalFloors);
    const fd = this.floorDataMap.get(floor)!;
    const room = fd.rooms[Phaser.Math.Between(0, fd.rooms.length - 1)];
    const x = room.centerX;
    const y = room.centerY;

    const ghost = this.createGhost(x, y, true);

    // If boss is on different floor, store it
    if (floor !== this.currentFloor) {
      const targetFD = this.floorDataMap.get(floor)!;
      targetFD.ghosts.push(ghost);
      ghost.sprite.setVisible(false);
    }

    this.showMessage(`BOSS出现在 ${floor}F！`);
  }

  // ── Player ───────────────────────────────────────────────────────────────

  private createPlayer() {
    const startRoom = this.rooms[0];
    this.player = this.add.rectangle(startRoom.centerX, startRoom.centerY, 24, 24, 0x00ff00);
    this.player.setDepth(10);
  }

  private handleMovement(delta: number) {
    const speed = this.getEffectiveSpeed() * delta / 1000;
    let dx = 0;
    let dy = 0;

    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) dx += 1;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) dy -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const dir = new Phaser.Math.Vector2(dx, dy).normalize();
      const newX = this.player.x + dir.x * speed;
      const newY = this.player.y + dir.y * speed;

      if (!this.isObstacleAt(newX, this.player.y, 12)) {
        this.player.x = newX;
      }
      if (!this.isObstacleAt(this.player.x, newY, 12)) {
        this.player.y = newY;
      }

      this.playerFacingAngle = Math.atan2(dir.y, dir.x);
    }

    this.player.x = Phaser.Math.Clamp(this.player.x, 20, this.mapWidth - 20);
    this.player.y = Phaser.Math.Clamp(this.player.y, 20, this.mapHeight - 20);

    // Update blind box position
    if (this.blindBoxSprite && this.blindBoxSprite.active) {
      this.blindBoxSprite.x = this.player.x + 20;
      this.blindBoxSprite.y = this.player.y - 20;
    }
  }

  private isObstacleAt(x: number, y: number, radius: number): boolean {
    for (const obs of this.obstacles) {
      const closestX = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
      const closestY = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
      const dist = Phaser.Math.Distance.Between(x, y, closestX, closestY);
      if (dist < radius) return true;
    }
    return false;
  }

  // ── Ghosts ───────────────────────────────────────────────────────────────

  private createWanderingGhosts() {
    this.ghosts = [];

    // 2 ghosts per floor
    for (let floor = 1; floor <= this.totalFloors; floor++) {
      const fd = this.floorDataMap.get(floor)!;
      for (let i = 0; i < 2; i++) {
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

    const ghost: Ghost = {
      sprite: container,
      body,
      speed: isBoss ? 40 : 30,
      chaseSpeed: isBoss ? 100 : 70,
      direction: new Phaser.Math.Vector2(Phaser.Math.Between(-1, 1), Phaser.Math.Between(-1, 1)).normalize(),
      isChasing: false,
      giveUpTimer: 0,
      giveUpDuration: isBoss ? 5000 : 3000,
      homeX: x,
      homeY: y,
      visionRange: isBoss ? 300 : 200,
      patrolTimer: 0,
      alive: true,
      isBoss,
      bossDamage: isBoss ? 40 : 15,
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
        if (ghost.giveUpTimer <= 0 || distToPlayer > ghost.visionRange * 1.5) {
          ghost.isChasing = false;
        }

        if (distToPlayer < 30 && this.damageCooldown <= 0 && this.spawnImmunity <= 0) {
          this.takeDamage(ghost.bossDamage);
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
          const dir = new Phaser.Math.Vector2(ghost.homeX - ghost.sprite.x, ghost.homeY - ghost.sprite.y).normalize();
          ghost.direction = dir;
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

    if (this.textures.exists(this.fogTextureKey)) {
      this.textures.remove(this.fogTextureKey);
    }
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

    // Check if player is in dark room
    const inDarkRoom = this.isPlayerInDarkRoom();
    const coneRadius = inDarkRoom ? this.viewRadius * 1.2 : this.viewRadius * 4;
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

    // Manual WebGL texture upload
    const gl = this.game.gl;
    if (gl) {
      const texture = this.textures.get(this.fogTextureKey);
      const glTexture = texture.source[0].glTexture;
      gl.bindTexture(gl.TEXTURE_2D, glTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fogCanvas);
    }
  }

  private isPlayerInDarkRoom(): boolean {
    for (const room of this.rooms) {
      if (this.player.x >= room.x && this.player.x <= room.x + room.w &&
          this.player.y >= room.y && this.player.y <= room.y + room.h) {
        return !room.lightOn;
      }
    }
    return false;
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  private createUI() {
    this.healthText = this.add.text(10, 10, `生命: ${this.health}/${this.maxHealth}`, {
      fontSize: '16px',
      color: '#ff0000',
    }).setScrollFactor(0).setDepth(200);

    this.treasureText = this.add.text(10, 35, `财宝: ${this.treasureCollected}/${this.treasureTotal}`, {
      fontSize: '16px',
      color: '#ffd700',
    }).setScrollFactor(0).setDepth(200);

    this.boxStatusText = this.add.text(10, 60, '盲盒: 未破解', {
      fontSize: '16px',
      color: '#ff6600',
    }).setScrollFactor(0).setDepth(200);

    this.floorText = this.add.text(10, 85, `楼层: ${this.currentFloor}F`, {
      fontSize: '16px',
      color: '#00ffff',
    }).setScrollFactor(0).setDepth(200);

    this.hintText = this.add.text(400, 550, '', {
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(200);

    this.messageText = this.add.text(400, 500, '', {
      fontSize: '18px',
      color: '#ffff00',
      backgroundColor: '#000000',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(200);

    this.add.text(400, 580, 'WASD 移动 | E 破解盲盒/交互 | F 上下楼 | 收集财宝逃离', {
      fontSize: '14px',
      color: '#888888',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(200);
  }

  private updateHint() {
    let hint = '';

    // Check cracking table
    if (this.crackingTable && this.crackingTable.floor === this.currentFloor && !this.boxCracked) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.crackingTable.x, this.crackingTable.y);
      if (dist < 60) {
        hint = '按E破解盲盒';
      }
    }

    // Check stairs
    if (!hint) {
      for (const stair of this.stairs) {
        if (stair.floor !== this.currentFloor) continue;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, stair.x, stair.y);
        if (dist < 50) {
          hint = `按F上楼到 ${stair.targetFloor}F`;
          break;
        }
      }
    }

    // Check exit
    if (this.isEscaping && this.exit) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exit.x, this.exit.y);
      if (dist < 40) {
        hint = '按E逃离！';
      }
    }

    // Check treasure pickup
    for (const treasure of this.treasures) {
      if (treasure.collected) continue;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, treasure.x, treasure.y);
      if (dist < 30) {
        hint = '按E拾取财宝';
        break;
      }
    }

    // Check light switch
    if (!hint) {
      for (const room of this.rooms) {
        if (room.hasLight) {
          const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, room.switchX, room.switchY);
          if (dist < 40) {
            hint = '按E开关灯';
            break;
          }
        }
      }
    }

    this.hintText.setText(hint);
    this.hintText.setVisible(hint.length > 0);

    // Update UI texts
    this.healthText.setText(`生命: ${Math.ceil(this.health)}/${this.maxHealth}`);
    this.treasureText.setText(`财宝: ${this.treasureCollected}/${this.treasureTotal}`);
    this.boxStatusText.setText(this.boxCracked ? '盲盒: 已破解' : '盲盒: 携带中');
    this.floorText.setText(`楼层: ${this.currentFloor}F`);
  }

  // ── Debuffs ──────────────────────────────────────────────────────────────

  private updateDebuffs(delta: number) {
    const toRemove: number[] = [];
    for (let i = 0; i < this.debuffs.length; i++) {
      this.debuffs[i].remaining -= delta;
      if (this.debuffs[i].remaining <= 0) {
        toRemove.push(i);
      }
    }
    for (let i = toRemove.length - 1; i >= 0; i--) {
      this.debuffs.splice(toRemove[i], 1);
    }
  }

  private getEffectiveSpeed(): number {
    let speed = 150;
    for (const debuff of this.debuffs) {
      if (debuff.type === 'slow') {
        speed *= 0.5;
      }
    }
    return speed;
  }

  // ── Damage & Death ───────────────────────────────────────────────────────

  private takeDamage(amount: number) {
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.die();
    }
  }

  private die() {
    this.isDead = true;
    this.showMessage('你死了...');
    this.player.setFillStyle(0x880000);
    this.time.delayedCall(3000, () => {
      this.scene.restart();
    });
  }

  // ── Exit & Win ───────────────────────────────────────────────────────────

  private spawnExit() {
    const room = this.rooms[this.rooms.length - 1];
    this.exit = this.add.container(room.centerX, room.centerY);
    const exitBase = this.add.rectangle(0, 0, 50, 50, 0x00ff00, 0.5);
    const exitText = this.add.text(0, 0, '出口', {
      fontSize: '14px',
      color: '#ffffff',
    }).setOrigin(0.5);
    this.exit.add([exitBase, exitText]);
    this.exit.setDepth(8);
  }

  private winGame() {
    this.isWon = true;
    const totalValue = this.treasures.reduce((sum, t) => sum + t.value, 0);
    this.showMessage(`逃离成功！\n财宝价值: ${totalValue}`);
    this.player.setFillStyle(0x00ff00);
    this.time.delayedCall(5000, () => {
      this.scene.restart();
    });
  }

  // ── Input ────────────────────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
    }) as any;

    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.fKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.qKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q);

    this.input.keyboard!.on('keydown-E', () => {
      this.handleInteraction();
    });

    this.input.keyboard!.on('keydown-F', () => {
      this.handleStairs();
    });
  }

  private handleInteraction() {
    // Crack blind box at table
    if (this.crackingTable && this.crackingTable.floor === this.currentFloor && !this.boxCracked) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.crackingTable.x, this.crackingTable.y);
      if (dist < 60) {
        this.crackBlindBox();
        return;
      }
    }

    // Pickup treasure
    for (const treasure of this.treasures) {
      if (treasure.collected) continue;
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, treasure.x, treasure.y);
      if (dist < 30) {
        this.collectTreasure(treasure);
        return;
      }
    }

    // Toggle light switch
    for (const room of this.rooms) {
      if (room.hasLight) {
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, room.switchX, room.switchY);
        if (dist < 40) {
          room.lightOn = !room.lightOn;
          this.updateRoomLight(room);
          return;
        }
      }
    }

    // Exit
    if (this.isEscaping && this.exit) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exit.x, this.exit.y);
      if (dist < 40) {
        this.winGame();
      }
    }
  }

  private collectTreasure(treasure: Treasure) {
    treasure.collected = true;
    this.treasureCollected++;
    this.showMessage(`获得财宝！价值 ${treasure.value}`);

    this.tweens.add({
      targets: treasure.sprite,
      alpha: 0,
      scale: 0,
      duration: 500,
      onComplete: () => treasure.sprite.destroy(),
    });
  }

  private updateRoomLight(room: Room) {
    for (const overlay of this.roomLightOverlays) {
      overlay.destroy();
    }
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
      targets: this.messageText,
      alpha: 0,
      duration: 3000,
      onComplete: () => {
        this.messageText.setText('');
        this.messageText.setAlpha(1);
      },
    });
  }

  private updateFloorText() {
    this.floorText.setText(`楼层: ${this.currentFloor}F`);
  }
}
