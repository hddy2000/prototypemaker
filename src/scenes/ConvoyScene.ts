import Phaser from 'phaser';

type ResourceType = 'fuel' | 'scrap' | 'ammo' | 'cargo' | 'compass';
type EnemyType = 'mutant' | 'raider';

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ResourceNode {
  type: ResourceType;
  amount: number;
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
}

interface Enemy {
  type: EnemyType;
  sprite: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Rectangle;
  speed: number;
  hp: number;
  maxHp: number;
  targetTruck: boolean;
  attackCooldown: number;
  wanderTimer: number;
  direction: Phaser.Math.Vector2;
  fleeing: boolean;
  stolenCargo: boolean;
  alive: boolean;
}

export class ConvoyScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private truck!: Phaser.GameObjects.Container;
  private truckBody!: Phaser.GameObjects.Rectangle;
  private truckCab!: Phaser.GameObjects.Rectangle;
  private truckTurret!: Phaser.GameObjects.Rectangle;
  private goalMarker!: Phaser.GameObjects.Container;
  private compassArrow!: Phaser.GameObjects.Container;
  private drivingIndicator!: Phaser.GameObjects.Text;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private attackKey!: Phaser.Input.Keyboard.Key;

  // Map 4x larger: 4800 x 2800
  private mapWidth = 4800;
  private mapHeight = 2800;
  private roadY = 1400;
  private roadH = 260;
  private roadStartX = 120;
  private roadEndX = 4600;
  private goalX = 0;
  private goalY = 0;
  private obstacles: Obstacle[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  private resources: ResourceNode[] = [];
  private enemies: Enemy[] = [];
  private carrying: ResourceType | null = null;
  private carryingIcon!: Phaser.GameObjects.Container;
  private truckHealth = 100;
  private truckMaxHealth = 100;
  private fuel = 80;
  private fuelMax = 120;
  private ammo = 30;
  private cargo = 3;
  private cargoGoal = 2;
  private cargoMax = 5;
  private playerHealth = 100;
  private playerMaxHealth = 100;
  private stallTimer = 0;
  private stallLimit = 30000;
  private truckFireCooldown = 0;
  private enemySpawnTimer = 0;
  private raiderSpawnTimer = 0;
  private resourceRespawnTimer = 0;
  private compassRespawnTimer = 0;
  private playerDamageCooldown = 0;
  private attackCooldown = 0;
  private attackFlash = 0;
  private isWon = false;
  private isDead = false;
  private isDriving = false;
  private hasCompass = false;
  private truckAngle = 0;

  private healthText!: Phaser.GameObjects.Text;
  private truckText!: Phaser.GameObjects.Text;
  private fuelText!: Phaser.GameObjects.Text;
  private ammoText!: Phaser.GameObjects.Text;
  private cargoText!: Phaser.GameObjects.Text;
  private carryText!: Phaser.GameObjects.Text;
  private distText!: Phaser.GameObjects.Text;
  private modeText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'ConvoyScene' });
  }

  create() {
    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateMap();
    this.drawMap();
    this.createGoal();
    this.createTruck();
    this.createPlayer();
    this.createResources();
    this.createCompassArrow();
    this.createUI();
    this.setupInput();

    this.cameras.main.startFollow(this.truck, true, 0.08, 0.08);

    this.showMessage('荒原车队\n上车(E)驾驶卡车探索荒原，下车(E)搜集物资。\n货箱(货)可补回被抢货物。找到撤离门突围。');
    this.time.delayedCall(4000, () => this.hideMessage());
  }

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

    if (this.isDriving) {
      this.handleDriving(delta);
    } else {
      this.handlePlayerMovement(delta);
      this.handleAttack();
    }
    this.handleInteract();
    this.updateTruck(delta);
    this.updateEnemies(delta);
    this.updateTurret();
    this.updateSpawns(delta);
    this.updateCarryIcon();
    this.updateCompassArrow();
    this.checkWinLose(delta);
    this.updateUI();

    if (this.playerDamageCooldown > 0) this.playerDamageCooldown -= delta;
    if (this.attackCooldown > 0) this.attackCooldown -= delta;
    if (this.truckFireCooldown > 0) this.truckFireCooldown -= delta;
    if (this.attackFlash > 0) this.attackFlash -= delta;
  }

  // ─── Map Generation ────────────────────────────────────────────

  private generateMap() {
    this.obstacles = [];

    // Boundary walls (thick, visible)
    const wallT = 50;
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: wallT });
    this.obstacles.push({ x: 0, y: this.mapHeight - wallT, w: this.mapWidth, h: wallT });
    this.obstacles.push({ x: 0, y: 0, w: wallT, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - wallT, y: 0, w: wallT, h: this.mapHeight });

    // Depots spread across the larger map
    const depots = [
      { x: 600, y: 500 },
      { x: 1200, y: 2100 },
      { x: 1800, y: 500 },
      { x: 2400, y: 2100 },
      { x: 3000, y: 500 },
      { x: 3600, y: 2100 },
      { x: 4200, y: 500 },
    ];

    for (const depot of depots) {
      for (let i = 0; i < 6; i++) {
        const w = Phaser.Math.Between(50, 100);
        const h = Phaser.Math.Between(50, 100);
        const x = depot.x + Phaser.Math.Between(-140, 140);
        const y = depot.y + Phaser.Math.Between(-140, 140);
        this.obstacles.push({ x, y, w, h });
      }
    }

    // Scattered obstacles in upper and lower bands
    for (let i = 0; i < 50; i++) {
      const w = Phaser.Math.Between(50, 120);
      const h = Phaser.Math.Between(50, 120);
      const x = Phaser.Math.Between(80, this.mapWidth - 200);
      const yBandTop = Phaser.Math.Between(80, 950);
      const yBandBottom = Phaser.Math.Between(1850, 2650);
      const y = Math.random() > 0.5 ? yBandTop : yBandBottom;
      this.obstacles.push({ x, y, w, h });
    }

    // Randomize goal position — not on the road, somewhere in the map
    this.goalX = Phaser.Math.Between(3800, 4600);
    this.goalY = Phaser.Math.Between(400, 2400);
    // Make sure goal isn't inside an obstacle
    let attempts = 0;
    while (this.isInsideObstacle(this.goalX, this.goalY, 60) && attempts < 20) {
      this.goalX = Phaser.Math.Between(3800, 4600);
      this.goalY = Phaser.Math.Between(400, 2400);
      attempts++;
    }
  }

  private drawMap() {
    this.mapGraphics = this.add.graphics();

    // Ground
    this.mapGraphics.fillStyle(0x201c16, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

    // Road
    this.mapGraphics.fillStyle(0x2c261d, 1);
    this.mapGraphics.fillRect(this.roadStartX, this.roadY - this.roadH / 2, this.roadEndX - this.roadStartX, this.roadH);
    this.mapGraphics.lineStyle(4, 0xb89d61, 0.8);
    this.mapGraphics.lineBetween(this.roadStartX, this.roadY, this.roadEndX, this.roadY);

    // Grid
    this.mapGraphics.lineStyle(1, 0x3a3126, 0.4);
    for (let x = 0; x < this.mapWidth; x += 160) {
      this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += 160) {
      this.mapGraphics.lineBetween(0, y, this.mapWidth, y);
    }

    // Depots
    const depots = [
      { x: 600, y: 500, name: '废站 A' },
      { x: 1200, y: 2100, name: '废站 B' },
      { x: 1800, y: 500, name: '补给场 C' },
      { x: 2400, y: 2100, name: '维修坑 D' },
      { x: 3000, y: 500, name: '废墟 E' },
      { x: 3600, y: 2100, name: '军库 F' },
      { x: 4200, y: 500, name: '终点站 G' },
    ];
    for (const depot of depots) {
      this.mapGraphics.fillStyle(0x332f28, 1);
      this.mapGraphics.fillRoundedRect(depot.x - 160, depot.y - 160, 320, 320, 20);
      this.mapGraphics.lineStyle(2, 0x716650, 1);
      this.mapGraphics.strokeRoundedRect(depot.x - 160, depot.y - 160, 320, 320, 20);
      this.add.text(depot.x, depot.y - 175, depot.name, {
        fontSize: '18px',
        color: '#b8ab8b',
      }).setOrigin(0.5);
    }

    // Boundary walls (visible)
    this.mapGraphics.fillStyle(0x5a4a3a, 1);
    this.mapGraphics.lineStyle(4, 0x9a8a6a, 1);
    for (const obs of this.obstacles) {
      if (obs.w >= this.mapWidth || obs.h >= this.mapHeight) {
        this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
        this.mapGraphics.strokeRect(obs.x, obs.y, obs.w, obs.h);
      }
    }

    // Interior obstacles
    this.mapGraphics.fillStyle(0x4b4130, 1);
    this.mapGraphics.lineStyle(2, 0x7f7257, 1);
    for (const obs of this.obstacles) {
      if (obs.w >= this.mapWidth || obs.h >= this.mapHeight) continue;
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
      this.mapGraphics.strokeRect(obs.x, obs.y, obs.w, obs.h);
    }
  }

  // ─── Entity Creation ───────────────────────────────────────────

  private createGoal() {
    this.goalMarker = this.add.container(this.goalX, this.goalY);
    const gate = this.add.rectangle(0, 0, 50, 260, 0x22aa55, 0.25);
    const ring = this.add.rectangle(0, 0, 90, 280, 0x55ff99, 0.08);
    ring.setStrokeStyle(4, 0x55ff99, 0.9);
    const text = this.add.text(0, -160, '撤离门', {
      fontSize: '22px',
      color: '#88ffbb',
    }).setOrigin(0.5);
    this.goalMarker.add([ring, gate, text]);
    this.goalMarker.setDepth(3);
    this.tweens.add({
      targets: ring,
      scaleX: { from: 0.92, to: 1.08 },
      duration: 700,
      yoyo: true,
      repeat: -1,
    });
  }

  private createTruck() {
    this.truckBody = this.add.rectangle(0, 0, 140, 70, 0x4c96d7);
    this.truckBody.setStrokeStyle(3, 0xeaf3ff, 0.8);
    this.truckCab = this.add.rectangle(52, -4, 50, 58, 0xf0c04e);
    this.truckCab.setStrokeStyle(3, 0x272727, 0.6);
    this.truckTurret = this.add.rectangle(-8, -44, 20, 20, 0xdddddd);
    const gun = this.add.rectangle(14, -44, 32, 7, 0x666666);
    const cargo = this.add.rectangle(-38, 0, 48, 38, 0x8b5a31);
    cargo.setStrokeStyle(2, 0xd2b48c, 0.7);
    this.truck = this.add.container(this.roadStartX + 80, this.roadY, [this.truckBody, cargo, this.truckCab, this.truckTurret, gun]);
    this.truck.setDepth(5);
  }

  private createPlayer() {
    this.player = this.add.rectangle(this.truck.x - 100, this.truck.y + 20, 22, 22, 0x66ffcc);
    this.player.setDepth(6);

    this.carryingIcon = this.add.container(this.player.x, this.player.y - 28);
    this.carryingIcon.setDepth(7);
  }

  private createResources() {
    const defs: Array<{ x: number; y: number; type: ResourceType }> = [
      // Depot resources
      { x: 540, y: 420, type: 'fuel' },
      { x: 680, y: 560, type: 'ammo' },
      { x: 1140, y: 2020, type: 'scrap' },
      { x: 1280, y: 2180, type: 'fuel' },
      { x: 1740, y: 420, type: 'ammo' },
      { x: 1880, y: 560, type: 'scrap' },
      { x: 2340, y: 2020, type: 'fuel' },
      { x: 2480, y: 2180, type: 'ammo' },
      { x: 2940, y: 420, type: 'scrap' },
      { x: 3080, y: 560, type: 'fuel' },
      { x: 3540, y: 2020, type: 'ammo' },
      { x: 3680, y: 2180, type: 'scrap' },
      { x: 4140, y: 420, type: 'fuel' },
      { x: 4280, y: 560, type: 'ammo' },
      // Road-side resources
      { x: 400, y: 1180, type: 'fuel' },
      { x: 600, y: 1620, type: 'ammo' },
      { x: 800, y: 1180, type: 'fuel' },
      { x: 1000, y: 1620, type: 'ammo' },
      { x: 1200, y: 1180, type: 'scrap' },
      { x: 1400, y: 1620, type: 'fuel' },
      { x: 1600, y: 1180, type: 'ammo' },
      { x: 1800, y: 1620, type: 'fuel' },
      { x: 2000, y: 1180, type: 'scrap' },
      { x: 2200, y: 1620, type: 'ammo' },
      { x: 2400, y: 1180, type: 'fuel' },
      { x: 2600, y: 1620, type: 'ammo' },
      { x: 2800, y: 1180, type: 'scrap' },
      { x: 3000, y: 1620, type: 'fuel' },
      { x: 3200, y: 1180, type: 'ammo' },
      { x: 3400, y: 1620, type: 'fuel' },
      { x: 3600, y: 1180, type: 'scrap' },
      { x: 3800, y: 1620, type: 'ammo' },
      { x: 4000, y: 1180, type: 'fuel' },
      { x: 4200, y: 1620, type: 'ammo' },
      { x: 4400, y: 1180, type: 'fuel' },
      // Cargo pickups — restore stolen cargo
      { x: 700, y: 1400, type: 'cargo' },
      { x: 1900, y: 1400, type: 'cargo' },
      { x: 3100, y: 1400, type: 'cargo' },
      { x: 4300, y: 1400, type: 'cargo' },
      // Compass pickups — a few scattered around
      { x: 900, y: 700, type: 'compass' },
      { x: 2200, y: 1900, type: 'compass' },
      { x: 3500, y: 700, type: 'compass' },
    ];

    for (const def of defs) {
      this.createResourceSprite(def.x, def.y, def.type);
    }
  }

  private createResourceSprite(x: number, y: number, type: ResourceType) {
    const color = type === 'fuel' ? 0xffc34d : type === 'scrap' ? 0xb8b8b8 : type === 'ammo' ? 0xff6666 : type === 'cargo' ? 0xc08040 : 0x44ddff;
    const label = type === 'fuel' ? '油' : type === 'scrap' ? '修' : type === 'ammo' ? '弹' : type === 'cargo' ? '货' : '南';
    const box = this.add.rectangle(0, 0, 24, 24, color);
    box.setStrokeStyle(2, 0xffffff, 0.8);
    const txt = this.add.text(0, 0, label, {
      fontSize: '14px',
      color: '#111111',
    }).setOrigin(0.5);
    const container = this.add.container(x, y, [box, txt]);
    container.setDepth(4);
    this.resources.push({ type, amount: 1, collected: false, sprite: container });
    this.tweens.add({
      targets: container,
      y: { from: y - 4, to: y + 4 },
      duration: 700 + Phaser.Math.Between(0, 300),
      yoyo: true,
      repeat: -1,
    });
  }

  private createCompassArrow() {
    // On-screen arrow pointing toward the goal (only visible after picking up compass)
    this.compassArrow = this.add.container(400, 80);
    this.compassArrow.setDepth(21);
    this.compassArrow.setScrollFactor(0);
    const arrow = this.add.polygon(0, 0, [0, -18, 12, 10, -12, 10], 0x44ddff, 0.9);
    arrow.setStrokeStyle(2, 0xffffff, 0.8);
    const label = this.add.text(0, 20, '撤离门', {
      fontSize: '12px',
      color: '#44ddff',
    }).setOrigin(0.5);
    this.compassArrow.add([arrow, label]);
    this.compassArrow.setVisible(false);
  }

  private createUI() {
    this.healthText = this.add.text(16, 14, '', { fontSize: '18px', color: '#ffffff' }).setScrollFactor(0).setDepth(20);
    this.truckText = this.add.text(16, 38, '', { fontSize: '18px', color: '#7fd0ff' }).setScrollFactor(0).setDepth(20);
    this.fuelText = this.add.text(16, 62, '', { fontSize: '18px', color: '#ffd26a' }).setScrollFactor(0).setDepth(20);
    this.ammoText = this.add.text(16, 86, '', { fontSize: '18px', color: '#ff8a8a' }).setScrollFactor(0).setDepth(20);
    this.cargoText = this.add.text(16, 110, '', { fontSize: '18px', color: '#d7c7a0' }).setScrollFactor(0).setDepth(20);
    this.carryText = this.add.text(16, 134, '', { fontSize: '18px', color: '#88ffcc' }).setScrollFactor(0).setDepth(20);
    this.distText = this.add.text(16, 158, '', { fontSize: '18px', color: '#88ff88' }).setScrollFactor(0).setDepth(20);
    this.modeText = this.add.text(16, 182, '', { fontSize: '18px', color: '#ffdd44' }).setScrollFactor(0).setDepth(20);
    this.add.text(400, 560, 'WASD/方向键 移动/驾驶  •  E 上车/下车/拾取/上交  •  空格近战(下车时)  •  找罗盘指路', {
      fontSize: '14px',
      color: '#8f8f8f',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
    this.messageText = this.add.text(400, 480, '', {
      fontSize: '22px',
      color: '#ffffff',
      align: 'center',
      backgroundColor: '#000000',
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);

    this.drivingIndicator = this.add.text(400, 40, '', {
      fontSize: '20px',
      color: '#ffdd44',
      backgroundColor: '#222222',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);

    const backBtn = this.add.text(680, 16, '← 菜单', {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);
    backBtn.on('pointerdown', () => this.scene.start('MenuScene'));
  }

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.attackKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  }

  // ─── Player Movement (on foot) ─────────────────────────────────

  private handlePlayerMovement(delta: number) {
    let speed = 200;
    if (this.carrying) speed = 160;
    const dt = delta / 1000;

    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) vx -= speed;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) vx += speed;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) vy -= speed;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) vy += speed;

    if (vx !== 0 && vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * speed;
      vy = (vy / len) * speed;
    }

    const half = 11;
    if (vx !== 0) {
      const dx = vx * dt;
      const newX = this.player.x + dx;
      const edgeX = newX + (dx > 0 ? half : -half);
      if (!this.isObstacleAt(edgeX, this.player.y - half) && !this.isObstacleAt(edgeX, this.player.y + half)) {
        this.player.x = Phaser.Math.Clamp(newX, 60, this.mapWidth - 60);
      }
    }
    if (vy !== 0) {
      const dy = vy * dt;
      const newY = this.player.y + dy;
      const edgeY = newY + (dy > 0 ? half : -half);
      if (!this.isObstacleAt(this.player.x - half, edgeY) && !this.isObstacleAt(this.player.x + half, edgeY)) {
        this.player.y = Phaser.Math.Clamp(newY, 60, this.mapHeight - 60);
      }
    }

    // Hard clamp
    this.player.x = Phaser.Math.Clamp(this.player.x, 60, this.mapWidth - 60);
    this.player.y = Phaser.Math.Clamp(this.player.y, 60, this.mapHeight - 60);
  }

  // ─── Driving (player in truck) ─────────────────────────────────

  private handleDriving(delta: number) {
    const dt = delta / 1000;
    let speed = 0;
    if (this.fuel > 0 && this.truckHealth > 0) {
      speed = this.truckHealth < 35 ? 100 : 160;
    }

    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) vy += 1;

    if (vx === 0 && vy === 0) {
      // Not moving — truck stays still, but still burns idle fuel
      this.fuel -= 1.5 * dt;
      if (this.fuel < 0) this.fuel = 0;
      this.stallTimer = 0; // driving mode doesn't use stall timer
      return;
    }

    // Normalize diagonal
    if (vx !== 0 && vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx /= len;
      vy /= len;
    }

    const moveX = vx * speed * dt;
    const moveY = vy * speed * dt;

    // Move truck with obstacle collision (check corners)
    const halfW = 70;
    const halfH = 35;
    const newX = this.truck.x + moveX;
    const edgeX = newX + (moveX > 0 ? halfW : -halfW);
    if (!this.isObstacleAt(edgeX, this.truck.y - halfH) && !this.isObstacleAt(edgeX, this.truck.y + halfH)) {
      this.truck.x = Phaser.Math.Clamp(newX, 80, this.mapWidth - 80);
    }
    const newY = this.truck.y + moveY;
    const edgeY = newY + (moveY > 0 ? halfH : -halfH);
    if (!this.isObstacleAt(this.truck.x - halfW, edgeY) && !this.isObstacleAt(this.truck.x + halfW, edgeY)) {
      this.truck.y = Phaser.Math.Clamp(newY, 80, this.mapHeight - 80);
    }

    // Hard clamp
    this.truck.x = Phaser.Math.Clamp(this.truck.x, 80, this.mapWidth - 80);
    this.truck.y = Phaser.Math.Clamp(this.truck.y, 80, this.mapHeight - 80);

    // Rotate truck to face movement direction
    this.truckAngle = Math.atan2(vy, vx);
    this.truckBody.rotation = this.truckAngle;
    this.truckCab.rotation = this.truckAngle;
    // Turret stays independent

    // Burn fuel while driving
    this.fuel -= 3.5 * dt;
    if (this.fuel < 0) this.fuel = 0;
    this.stallTimer = 0;

    // Player follows truck position
    this.player.x = this.truck.x;
    this.player.y = this.truck.y;
  }

  // ─── Interact (enter/exit truck, pick up, deposit) ─────────────

  private handleInteract() {
    if (!Phaser.Input.Keyboard.JustDown(this.interactKey)) return;

    const distToTruck = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.truck.x, this.truck.y);

    // Exit truck (only when already driving)
    if (this.isDriving) {
      this.isDriving = false;
      this.player.setVisible(true);
      // Place player beside the truck
      this.player.x = this.truck.x - 90;
      this.player.y = this.truck.y + 30;
      this.drivingIndicator.setVisible(false);
      this.showMessage('下车了。卡车炮塔仍会自动防御。');
      this.time.delayedCall(1200, () => this.hideMessage());
      return;
    }

    // Deposit resource at truck — priority over entering truck
    if (this.carrying && distToTruck < 100) {
      if (this.carrying === 'fuel') {
        this.fuel = Math.min(this.fuelMax, this.fuel + 35);
      } else if (this.carrying === 'scrap') {
        this.truckHealth = Math.min(this.truckMaxHealth, this.truckHealth + 28);
      } else if (this.carrying === 'ammo') {
        this.ammo = Math.min(80, this.ammo + 16);
      } else if (this.carrying === 'cargo') {
        this.cargo = Math.min(this.cargoMax, this.cargo + 1);
      }
      this.showMessage(`${this.resourceName(this.carrying)}已装入卡车。`);
      this.time.delayedCall(900, () => this.hideMessage());
      this.carrying = null;
      return;
    }

    // Pick up resource
    if (!this.carrying) {
      for (const resource of this.resources) {
        if (resource.collected) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, resource.sprite.x, resource.sprite.y);
        if (d < 36) {
          // Compass is consumed immediately
          if (resource.type === 'compass') {
            resource.collected = true;
            resource.sprite.setVisible(false);
            this.hasCompass = true;
            this.compassArrow.setVisible(true);
            this.showMessage('拾取了罗盘！屏幕上方箭头指向撤离门。');
            this.time.delayedCall(1500, () => this.hideMessage());
            return;
          }
          resource.collected = true;
          resource.sprite.setVisible(false);
          this.carrying = resource.type;
          this.showMessage(`拿起了${this.resourceName(resource.type)}，回车旁按 E 装入。`);
          this.time.delayedCall(1000, () => this.hideMessage());
          return;
        }
      }
    }

    // Enter truck — only if not carrying anything
    if (!this.carrying && distToTruck < 90) {
      this.isDriving = true;
      this.player.setVisible(false);
      this.drivingIndicator.setVisible(true).setText('🚛 驾驶中 — WASD移动  E下车');
      this.showMessage('上车了！WASD驾驶卡车。');
      this.time.delayedCall(1000, () => this.hideMessage());
      return;
    }
  }

  // ─── Attack (melee, on foot only) ──────────────────────────────

  private handleAttack() {
    if (this.attackCooldown > 0) return;
    if (!Phaser.Input.Keyboard.JustDown(this.attackKey)) return;

    this.attackCooldown = 480;
    this.attackFlash = 120;

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.sprite.x, enemy.sprite.y);
      if (d < 82) {
        enemy.hp -= 30;
        enemy.body.setFillStyle(0xffeeee);
        this.time.delayedCall(90, () => {
          if (enemy.alive) enemy.body.setFillStyle(enemy.type === 'raider' ? 0xffb366 : 0xbb44aa);
        });
        if (enemy.hp <= 0) {
          this.killEnemy(enemy);
        }
      }
    }
  }

  // ─── Truck Update (idle fuel burn, stall) ──────────────────────

  private updateTruck(delta: number) {
    const dt = delta / 1000;

    // If not driving and fuel is 0, start stall timer
    if (!this.isDriving && this.fuel <= 0) {
      this.stallTimer += delta;
    } else if (!this.isDriving && this.fuel > 0) {
      // Idle fuel burn when parked
      this.fuel -= 0.8 * dt;
      if (this.fuel < 0) this.fuel = 0;
      this.stallTimer = 0;
    }

    // If driving, fuel is burned in handleDriving
    if (this.isDriving) {
      this.stallTimer = 0;
    }

    // Keep player synced to truck when driving
    if (this.isDriving) {
      this.player.x = this.truck.x;
      this.player.y = this.truck.y;
    }
  }

  // ─── Enemies ───────────────────────────────────────────────────

  private updateEnemies(delta: number) {
    const dt = delta / 1000;

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;

      enemy.attackCooldown -= delta;
      enemy.wanderTimer += delta;

      let targetX = enemy.sprite.x;
      let targetY = enemy.sprite.y;

      if (enemy.fleeing) {
        targetX = enemy.sprite.x + enemy.direction.x * 120;
        targetY = enemy.sprite.y + enemy.direction.y * 120;
      } else if (enemy.type === 'raider') {
        targetX = this.truck.x - 20;
        targetY = this.truck.y;
      } else {
        const dPlayer = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, this.player.x, this.player.y);
        const dTruck = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, this.truck.x, this.truck.y);
        enemy.targetTruck = dTruck < dPlayer * 0.9;
        targetX = enemy.targetTruck ? this.truck.x : this.player.x;
        targetY = enemy.targetTruck ? this.truck.y : this.player.y;
      }

      const dir = new Phaser.Math.Vector2(targetX - enemy.sprite.x, targetY - enemy.sprite.y);
      if (!enemy.fleeing && enemy.wanderTimer > 1800 && dir.length() < 90) {
        enemy.wanderTimer = 0;
        enemy.direction.set(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize();
      }

      let move = dir;
      if (enemy.fleeing && enemy.direction.lengthSq() > 0) {
        move = enemy.direction.clone();
      }
      if (move.lengthSq() > 0) move.normalize();
      const speed = enemy.fleeing ? enemy.speed * 1.25 : enemy.speed;

      const newX = enemy.sprite.x + move.x * speed * dt;
      const newY = enemy.sprite.y + move.y * speed * dt;
      if (!this.isObstacleAt(newX, enemy.sprite.y)) enemy.sprite.x = Phaser.Math.Clamp(newX, 60, this.mapWidth - 60);
      if (!this.isObstacleAt(enemy.sprite.x, newY)) enemy.sprite.y = Phaser.Math.Clamp(newY, 60, this.mapHeight - 60);

      if (!enemy.fleeing && enemy.attackCooldown <= 0) {
        const dPlayer = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, this.player.x, this.player.y);
        const dTruck = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, this.truck.x, this.truck.y);
        if (dPlayer < 34 && !this.isDriving && this.playerDamageCooldown <= 0) {
          this.playerHealth -= enemy.type === 'raider' ? 10 : 18;
          this.playerDamageCooldown = 700;
          enemy.attackCooldown = 950;
          this.cameras.main.shake(90, 0.006);
        } else if (dTruck < 80) {
          enemy.attackCooldown = 1200;
          if (enemy.type === 'raider') {
            if (this.cargo > 0 && !enemy.stolenCargo) {
              this.cargo--;
              enemy.stolenCargo = true;
              enemy.fleeing = true;
              enemy.direction.set(Phaser.Math.Between(0, 1) === 0 ? -1 : 1, Phaser.Math.Between(0, 1) === 0 ? -1 : 1).normalize();
              this.showMessage('掠夺者抢走了一箱货！');
              this.time.delayedCall(1100, () => this.hideMessage());
            }
          } else {
            this.truckHealth -= 8;
          }
        }
      }

      if (enemy.fleeing && (enemy.sprite.x < 60 || enemy.sprite.x > this.mapWidth - 60 || enemy.sprite.y < 60 || enemy.sprite.y > this.mapHeight - 60)) {
        enemy.alive = false;
      }
    }

    this.enemies = this.enemies.filter(enemy => {
      if (!enemy.alive) {
        enemy.sprite.destroy();
        return false;
      }
      return true;
    });
  }

  // ─── Turret (auto-fires whether driving or not) ────────────────

  private updateTurret() {
    if (this.truckFireCooldown > 0 || this.ammo <= 0) return;

    let nearest: Enemy | null = null;
    let nearestDist = Infinity;
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.fleeing) continue;
      const d = Phaser.Math.Distance.Between(this.truck.x, this.truck.y, enemy.sprite.x, enemy.sprite.y);
      if (d < 220 && d < nearestDist) {
        nearest = enemy;
        nearestDist = d;
      }
    }

    if (!nearest) return;

    this.truckFireCooldown = 850;
    this.ammo -= 1;
    nearest.hp -= nearest.type === 'raider' ? 28 : 20;
    this.truckTurret.rotation = Phaser.Math.Angle.Between(this.truck.x, this.truck.y, nearest.sprite.x, nearest.sprite.y);
    const flash = this.add.circle(this.truck.x + 20, this.truck.y - 44, 7, 0xffee99, 0.8).setDepth(8);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 2,
      duration: 120,
      onComplete: () => flash.destroy(),
    });
    if (nearest.hp <= 0) {
      this.killEnemy(nearest);
    }
  }

  // ─── Spawning ──────────────────────────────────────────────────

  private updateSpawns(delta: number) {
    // Clean up collected resources
    this.resources = this.resources.filter(r => {
      if (r.collected) {
        r.sprite.destroy();
        return false;
      }
      return true;
    });

    this.enemySpawnTimer += delta;
    this.raiderSpawnTimer += delta;
    this.resourceRespawnTimer += delta;
    this.compassRespawnTimer += delta;

    const activeMutants = this.enemies.filter(e => e.alive && e.type === 'mutant').length;
    const activeRaiders = this.enemies.filter(e => e.alive && e.type === 'raider').length;

    // Mutants: slower spawn (6s) to match exploration pace, cap 6
    if (this.enemySpawnTimer > 6000 && activeMutants < 6) {
      this.enemySpawnTimer = 0;
      this.spawnEnemy('mutant');
    }

    // Raiders: slower spawn (14s), cap 2
    if (this.raiderSpawnTimer > 14000 && activeRaiders < 2) {
      this.raiderSpawnTimer = 0;
      this.spawnEnemy('raider');
    }

    // Resources: spawn near truck every 5s
    if (this.resourceRespawnTimer > 5000) {
      this.resourceRespawnTimer = 0;
      this.spawnRoadResource();
    }

    // Compass: respawn every 20s if player doesn't have one
    if (this.compassRespawnTimer > 20000 && !this.hasCompass) {
      this.compassRespawnTimer = 0;
      this.spawnCompass();
    }
  }

  private spawnEnemy(type: EnemyType) {
    // Spawn near the truck but off-screen
    const angle = Math.random() * Math.PI * 2;
    const dist = Phaser.Math.Between(350, 600);
    const x = Phaser.Math.Clamp(this.truck.x + Math.cos(angle) * dist, 80, this.mapWidth - 80);
    const y = Phaser.Math.Clamp(this.truck.y + Math.sin(angle) * dist, 80, this.mapHeight - 80);
    if (this.isInsideObstacle(x, y, 24)) return;

    const bodyColor = type === 'raider' ? 0xffb366 : 0xbb44aa;
    const body = this.add.rectangle(0, 0, type === 'raider' ? 22 : 26, type === 'raider' ? 30 : 34, bodyColor);
    body.setStrokeStyle(2, 0x111111, 0.8);
    const head = this.add.circle(0, -20, 10, type === 'raider' ? 0xf3cf9b : 0xffd4ff);
    const tag = this.add.text(0, -42, type === 'raider' ? '掠' : '异', {
      fontSize: '12px',
      color: '#ffffff',
    }).setOrigin(0.5);
    const container = this.add.container(x, y, [body, head, tag]);
    container.setDepth(6);
    container.setScale(0);
    this.tweens.add({
      targets: container,
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut',
    });

    this.enemies.push({
      type,
      sprite: container,
      body,
      speed: type === 'raider' ? 110 : 92,
      hp: type === 'raider' ? 52 : 64,
      maxHp: type === 'raider' ? 52 : 64,
      targetTruck: true,
      attackCooldown: 400,
      wanderTimer: 0,
      direction: new Phaser.Math.Vector2(1, 0),
      fleeing: false,
      stolenCargo: false,
      alive: true,
    });
  }

  private killEnemy(enemy: Enemy) {
    if (!enemy.alive) return;
    enemy.alive = false;
    this.tweens.add({
      targets: enemy.sprite,
      alpha: 0,
      scale: 0.3,
      duration: 180,
      ease: 'Quad.in',
    });
  }

  private spawnRoadResource() {
    const types: ResourceType[] = ['fuel', 'fuel', 'fuel', 'ammo', 'ammo', 'ammo', 'scrap', 'cargo'];
    const type = Phaser.Utils.Array.GetRandom(types);
    const angle = Math.random() * Math.PI * 2;
    const dist = Phaser.Math.Between(150, 500);
    const x = Phaser.Math.Clamp(this.truck.x + Math.cos(angle) * dist, 80, this.mapWidth - 80);
    const y = Phaser.Math.Clamp(this.truck.y + Math.sin(angle) * dist, 80, this.mapHeight - 80);
    if (this.isInsideObstacle(x, y, 20)) return;

    this.createResourceSprite(x, y, type);
    // Fade in
    const container = this.resources[this.resources.length - 1].sprite;
    container.setAlpha(0);
    this.tweens.add({
      targets: container,
      alpha: 1,
      duration: 300,
      ease: 'Quad.out',
    });
  }

  private spawnCompass() {
    const angle = Math.random() * Math.PI * 2;
    const dist = Phaser.Math.Between(300, 700);
    const x = Phaser.Math.Clamp(this.truck.x + Math.cos(angle) * dist, 80, this.mapWidth - 80);
    const y = Phaser.Math.Clamp(this.truck.y + Math.sin(angle) * dist, 80, this.mapHeight - 80);
    if (this.isInsideObstacle(x, y, 20)) return;

    this.createResourceSprite(x, y, 'compass');
    const container = this.resources[this.resources.length - 1].sprite;
    container.setAlpha(0);
    this.tweens.add({
      targets: container,
      alpha: 1,
      duration: 400,
      ease: 'Quad.out',
    });
  }

  // ─── Carry Icon & Compass Arrow ────────────────────────────────

  private updateCarryIcon() {
    this.carryingIcon.removeAll(true);
    if (this.isDriving) return;
    this.carryingIcon.setPosition(this.player.x, this.player.y - 28);
    if (!this.carrying) return;
    const color = this.carrying === 'fuel' ? 0xffc34d : this.carrying === 'scrap' ? 0xb8b8b8 : this.carrying === 'ammo' ? 0xff6666 : 0xc08040;
    const box = this.add.rectangle(0, 0, 16, 16, color);
    box.setStrokeStyle(2, 0xffffff, 0.8);
    const label = this.add.text(0, 0, this.carrying === 'fuel' ? '油' : this.carrying === 'scrap' ? '修' : this.carrying === 'ammo' ? '弹' : '货', {
      fontSize: '12px',
      color: '#111111',
    }).setOrigin(0.5);
    this.carryingIcon.add([box, label]);
  }

  private updateCompassArrow() {
    if (!this.hasCompass) return;
    const angle = Phaser.Math.Angle.Between(this.truck.x, this.truck.y, this.goalX, this.goalY);
    // Rotate the arrow polygon (first child) to point toward goal
    const arrow = this.compassArrow.getAt(0) as Phaser.GameObjects.Polygon;
    arrow.rotation = angle + Math.PI / 2; // offset because arrow points up by default
  }

  // ─── Win / Lose ────────────────────────────────────────────────

  private checkWinLose(_delta: number) {
    if (this.playerHealth <= 0) {
      this.playerHealth = 0;
      this.die('你被围杀了。');
      return;
    }
    if (this.truckHealth <= 0) {
      this.truckHealth = 0;
      this.die('卡车被拆成了废铁。');
      return;
    }
    if (this.cargo <= 0) {
      this.cargo = 0;
      this.die('货物被抢空了。');
      return;
    }
    if (this.stallTimer >= this.stallLimit) {
      this.die('卡车没油太久，整支车队被淹没。');
      return;
    }
    // Win: truck reaches the goal marker
    const distToGoal = Phaser.Math.Distance.Between(this.truck.x, this.truck.y, this.goalX, this.goalY);
    if (distToGoal < 80) {
      if (this.cargo >= this.cargoGoal) {
        this.win();
      } else {
        this.die('虽然到了撤离门，但货损太严重。');
      }
    }
  }

  // ─── UI ────────────────────────────────────────────────────────

  private updateUI() {
    this.healthText.setText(`生命: ${Math.ceil(this.playerHealth)}/${this.playerMaxHealth}`);
    this.truckText.setText(`车体: ${Math.ceil(this.truckHealth)}/${this.truckMaxHealth}`);
    this.fuelText.setText(`燃料: ${Math.ceil(this.fuel)}/${this.fuelMax}` + (this.fuel <= 0 && !this.isDriving ? `  熄火倒计时 ${Math.ceil((this.stallLimit - this.stallTimer) / 1000)}s` : ''));
    this.ammoText.setText(`弹药: ${this.ammo}`);
    this.cargoText.setText(`货物: ${this.cargo}/${this.cargoMax} (目标${this.cargoGoal})`);
    this.carryText.setText(`手持: ${this.carrying ? this.resourceName(this.carrying) : '无'}`);
    const distToGoal = Phaser.Math.Distance.Between(this.truck.x, this.truck.y, this.goalX, this.goalY);
    this.distText.setText(`距撤离门: ${Math.ceil(distToGoal)}m` + (this.hasCompass ? '  (有罗盘)' : '  (未知方向)'));
    this.modeText.setText(this.isDriving ? '模式: 驾驶中' : '模式: 步行');
    this.fuelText.setColor(this.fuel < 20 ? '#ff6666' : '#ffd26a');
    this.truckText.setColor(this.truckHealth < 35 ? '#ff8888' : '#7fd0ff');
    this.cargoText.setColor(this.cargo < this.cargoGoal ? '#ff6666' : this.cargo <= this.cargoGoal ? '#ffbb66' : '#d7c7a0');
    this.player.setFillStyle(this.attackFlash > 0 ? 0xffffff : 0x66ffcc);
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private resourceName(type: ResourceType): string {
    if (type === 'fuel') return '燃料罐';
    if (type === 'scrap') return '维修废料';
    if (type === 'ammo') return '弹药箱';
    if (type === 'cargo') return '货箱补给';
    return '罗盘';
  }

  private win() {
    this.isWon = true;
    this.showMessage('成功突围！\n车队把至少两箱货送到了撤离门。\n\n按 ESC 返回菜单');
  }

  private die(reason: string) {
    this.isDead = true;
    this.player.setFillStyle(0x666666);
    this.showMessage(`任务失败\n${reason}\n\n按 ESC 返回菜单`);
  }

  private showMessage(text: string) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
  }

  private hideMessage() {
    if (!this.isDead && !this.isWon) {
      this.messageText.setVisible(false);
    }
  }

  private isObstacleAt(px: number, py: number): boolean {
    for (const obs of this.obstacles) {
      if (px >= obs.x && px <= obs.x + obs.w && py >= obs.y && py <= obs.y + obs.h) return true;
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
}
