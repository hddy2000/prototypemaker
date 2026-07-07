import Phaser from 'phaser';

// ── Types ──────────────────────────────────────────────────────────────────

interface Floor {
  floorNumber: number;
  type: 'safe' | 'monster' | 'trap' | 'event';
  cleared: boolean;
  hasRoom: boolean;
  roomType: string | null;
  roomLevel: number;
  income: number;
  monsters: FloorMonster[];
  resources: FloorResource[];
}

interface FloorMonster {
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  sprite: Phaser.GameObjects.Container;
  isAlive: boolean;
}

interface FloorResource {
  x: number;
  y: number;
  type: 'gold' | 'material' | 'worker';
  amount: number;
  sprite: Phaser.GameObjects.Container;
  collected: boolean;
}

interface Player {
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  gold: number;
  materials: number;
  workers: number;
}

interface RoomDef {
  name: string;
  cost: number;
  income: number;
  color: number;
}

// ── Scene ──────────────────────────────────────────────────────────────────

export class AbyssHotelScene extends Phaser.Scene {
  // Game state
  private gameState: 'elevator' | 'floor' | 'manage' = 'elevator';
  
  // Player
  private player: Player = {
    x: 400, y: 300,
    health: 100, maxHealth: 100,
    gold: 50, materials: 20, workers: 0
  };
  
  // Elevator
  private currentFloor = 1;
  private maxFloorReached = 1;
  private elevatorDecisionTimer = 0;
  private elevatorDecisionLimit = 10000; // 10 seconds to decide
  private stayOrDescend = '';
  
  // Floors
  private floors: Map<number, Floor> = new Map();
  private currentFloorData: Floor | null = null;
  
  // Rooms (hotel management)
  private rooms: Map<number, { type: string; level: number; income: number }> = new Map();
  private totalIncome = 0;
  private incomeTimer = 0;
  private incomeInterval = 5000; // Every 5 seconds
  
  // Monsters
  private monsters: FloorMonster[] = [];
  
  // Resources
  private resources: FloorResource[] = [];
  
  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private escKey!: Phaser.Input.Keyboard.Key;
  private qKey!: Phaser.Input.Keyboard.Key;
  private rKey!: Phaser.Input.Keyboard.Key;
  
  // UI
  private uiTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  private messageText!: Phaser.GameObjects.Text;
  
  // Graphics
  private playerSprite!: Phaser.GameObjects.Container;
  private mapGraphics!: Phaser.GameObjects.Graphics;
  
  // Map
  private mapWidth = 800;
  private mapHeight = 600;
  
  // Room definitions
  private roomDefs: Map<string, RoomDef> = new Map([
    ['guest_room', { name: '客房', cost: 15, income: 3, color: 0x4488ff }],
    ['restaurant', { name: '餐厅', cost: 25, income: 5, color: 0xff8844 }],
    ['armory', { name: '军械库', cost: 30, income: 0, color: 0xff4444 }],
    ['medbay', { name: '医疗室', cost: 20, income: 0, color: 0x44ff44 }],
    ['casino', { name: '赌场', cost: 40, income: 8, color: 0xffcc00 }],
  ]);

  constructor() {
    super({ key: 'AbyssHotelScene' });
  }

  create() {
    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
    
    // Input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.qKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.rKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    
    // Generate first floor
    this.generateFloor(1);
    this.startElevatorPhase();
  }

  // ── Floor Generation ─────────────────────────────────────────────────────

  private generateFloor(floorNum: number): Floor {
    if (this.floors.has(floorNum)) return this.floors.get(floorNum)!;
    
    // Determine floor type based on depth
    let type: Floor['type'];
    const roll = Math.random();
    
    if (floorNum <= 5) {
      // Safe zone
      type = roll < 0.6 ? 'safe' : (roll < 0.85 ? 'monster' : 'event');
    } else if (floorNum <= 15) {
      // Medium risk
      type = roll < 0.3 ? 'safe' : (roll < 0.65 ? 'monster' : (roll < 0.85 ? 'trap' : 'event'));
    } else {
      // High risk
      type = roll < 0.15 ? 'safe' : (roll < 0.5 ? 'monster' : (roll < 0.8 ? 'trap' : 'event'));
    }
    
    const floor: Floor = {
      floorNumber: floorNum,
      type,
      cleared: false,
      hasRoom: false,
      roomType: null,
      roomLevel: 0,
      income: 0,
      monsters: [],
      resources: []
    };
    
    this.floors.set(floorNum, floor);
    return floor;
  }

  // ── Elevator Phase ───────────────────────────────────────────────────────

  private startElevatorPhase() {
    this.gameState = 'elevator';
    this.clearScene();
    this.elevatorDecisionTimer = this.elevatorDecisionLimit;
    
    this.drawElevator();
    this.createElevatorUI();
  }

  private drawElevator() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);
    
    // Elevator shaft
    this.mapGraphics.fillStyle(0x333355, 1);
    this.mapGraphics.fillRect(300, 100, 200, 400);
    this.mapGraphics.lineStyle(2, 0x666688, 1);
    this.mapGraphics.strokeRect(300, 100, 200, 400);
    
    // Current floor indicator
    this.mapGraphics.fillStyle(0x4488ff, 0.5);
    const floorY = 100 + (this.currentFloor / 50) * 380;
    this.mapGraphics.fillRect(310, floorY, 180, 20);
    
    // Floor numbers
    for (let i = 1; i <= 50; i += 5) {
      const y = 100 + ((i - 1) / 50) * 380;
      this.add.text(280, y, `${i}F`, {
        fontSize: '12px',
        color: '#888888',
      }).setOrigin(1, 0.5);
    }
    
    // Current floor
    this.add.text(400, 80, `当前: ${this.currentFloor}F`, {
      fontSize: '24px',
      color: '#ffcc00',
    }).setOrigin(0.5);
  }

  private createElevatorUI() {
    // Title
    this.add.text(400, 30, '深渊旅馆', {
      fontSize: '32px',
      color: '#ffcc00',
    }).setOrigin(0.5);
    
    // Stats
    const statsText = this.add.text(20, 20, 
      `金币: ${this.player.gold} | 建材: ${this.player.materials}\n员工: ${this.player.workers} | 生命: ${this.player.health}/${this.player.maxHealth}\n总收益: ${this.totalIncome}/轮`, {
      fontSize: '14px',
      color: '#88ff88',
    });
    this.uiTexts.set('stats', statsText);
    
    // Decision timer
    const timerText = this.add.text(400, 530, `决策时间: 10s`, {
      fontSize: '20px',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5);
    this.uiTexts.set('timer', timerText);
    
    // Instructions
    this.add.text(400, 570, 'Q 开门探索 | 空格 继续下坠 | E 管理已占领楼层', {
      fontSize: '14px',
      color: '#888888',
    }).setOrigin(0.5);
    
    // Floor info
    const floor = this.generateFloor(this.currentFloor);
    const typeNames: { [key: string]: string } = {
      'safe': '🟢 安全层',
      'monster': '🟡 怪物层',
      'trap': '🔴 陷阱层',
      'event': '🟣 事件层'
    };
    
    const floorInfo = this.add.text(400, 480, 
      `${this.currentFloor}F - ${typeNames[floor.type]}\n深度加成: ×${(1 + (this.currentFloor - 1) * 0.1).toFixed(1)}`, {
      fontSize: '16px',
      color: '#ffffff',
      align: 'center',
    }).setOrigin(0.5);
    this.uiTexts.set('floorInfo', floorInfo);
  }

  // ── Floor Phase ──────────────────────────────────────────────────────────

  private startFloorPhase() {
    this.gameState = 'floor';
    this.clearScene();
    
    const floor = this.generateFloor(this.currentFloor);
    this.currentFloorData = floor;
    
    // Reset player position
    this.player.x = 400;
    this.player.y = 500;
    
    // Create player sprite
    this.playerSprite = this.add.container(this.player.x, this.player.y);
    const playerBody = this.add.rectangle(0, 0, 24, 24, 0x00ff00);
    this.playerSprite.add(playerBody);
    this.playerSprite.setDepth(10);
    
    // Generate content based on floor type
    this.monsters = [];
    this.resources = [];
    
    if (floor.type === 'monster' || floor.type === 'trap') {
      const count = floor.type === 'monster' ? 
        Phaser.Math.Between(2, 4) + Math.floor(this.currentFloor / 5) :
        Phaser.Math.Between(1, 2);
      
      for (let i = 0; i < count; i++) {
        const mx = Phaser.Math.Between(100, 700);
        const my = Phaser.Math.Between(100, 400);
        const healthMult = 1 + (this.currentFloor - 1) * 0.15;
        this.monsters.push({
          x: mx, y: my,
          health: 40 * healthMult,
          maxHealth: 40 * healthMult,
          speed: 50 + this.currentFloor * 2,
          damage: 8 + this.currentFloor,
          sprite: this.createMonsterSprite(mx, my),
          isAlive: true
        });
      }
    }
    
    // Generate resources
    const goldCount = Phaser.Math.Between(3, 6) + Math.floor(this.currentFloor / 3);
    const matCount = Phaser.Math.Between(2, 4);
    
    for (let i = 0; i < goldCount; i++) {
      const rx = Phaser.Math.Between(50, 750);
      const ry = Phaser.Math.Between(50, 550);
      this.resources.push({
        x: rx, y: ry,
        type: 'gold',
        amount: 5 + Math.floor(this.currentFloor / 2),
        sprite: this.createResourceSprite(rx, ry, 0xffcc00),
        collected: false
      });
    }
    
    for (let i = 0; i < matCount; i++) {
      const rx = Phaser.Math.Between(50, 750);
      const ry = Phaser.Math.Between(50, 550);
      this.resources.push({
        x: rx, y: ry,
        type: 'material',
        amount: 3 + Math.floor(this.currentFloor / 3),
        sprite: this.createResourceSprite(rx, ry, 0x888888),
        collected: false
      });
    }
    
    // Small chance for worker
    if (Math.random() < 0.2) {
      const rx = Phaser.Math.Between(100, 700);
      const ry = Phaser.Math.Between(100, 400);
      this.resources.push({
        x: rx, y: ry,
        type: 'worker',
        amount: 1,
        sprite: this.createResourceSprite(rx, ry, 0xff88ff),
        collected: false
      });
    }
    
    this.drawFloorMap();
    this.createFloorUI();
  }

  private drawFloorMap() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);
    
    // Floor number
    const typeColors: { [key: string]: number } = {
      'safe': 0x44ff44,
      'monster': 0xffaa00,
      'trap': 0xff4444,
      'event': 0xaa44ff
    };
    
    this.add.text(400, 30, `${this.currentFloor}F`, {
      fontSize: '28px',
      color: '#ffffff',
    }).setOrigin(0.5);
    
    // Elevator (exit)
    this.mapGraphics.fillStyle(0x4488ff, 0.3);
    this.mapGraphics.fillRect(350, 520, 100, 60);
    this.add.text(400, 550, '电梯', {
      fontSize: '14px',
      color: '#4488ff',
    }).setOrigin(0.5);
    
    // Room placement zone (if cleared)
    if (this.currentFloorData!.cleared && !this.currentFloorData!.hasRoom) {
      this.mapGraphics.fillStyle(0x44ff44, 0.2);
      this.mapGraphics.fillRect(300, 200, 200, 150);
      this.mapGraphics.lineStyle(2, 0x44ff44, 0.5);
      this.mapGraphics.strokeRect(300, 200, 200, 150);
      this.add.text(400, 275, '建造区域\n按 R 建造', {
        fontSize: '16px',
        color: '#44ff44',
        align: 'center',
      }).setOrigin(0.5);
    }
    
    // Existing room
    if (this.currentFloorData!.hasRoom && this.currentFloorData!.roomType) {
      const roomDef = this.roomDefs.get(this.currentFloorData!.roomType)!;
      this.mapGraphics.fillStyle(roomDef.color, 0.3);
      this.mapGraphics.fillRect(300, 200, 200, 150);
      this.add.text(400, 260, `${roomDef.name} Lv.${this.currentFloorData!.roomLevel}`, {
        fontSize: '18px',
        color: '#ffffff',
      }).setOrigin(0.5);
      this.add.text(400, 290, `收益: ${this.currentFloorData!.income}/轮`, {
        fontSize: '14px',
        color: '#ffcc00',
      }).setOrigin(0.5);
    }
  }

  private createFloorUI() {
    // Health
    const healthText = this.add.text(20, 60, `生命: ${this.player.health}/${this.player.maxHealth}`, {
      fontSize: '16px',
      color: '#ff4444',
    });
    this.uiTexts.set('health', healthText);
    
    // Inventory
    const invText = this.add.text(20, 85, `金币: ${this.player.gold} | 建材: ${this.player.materials} | 员工: ${this.player.workers}`, {
      fontSize: '14px',
      color: '#88ff88',
    });
    this.uiTexts.set('inventory', invText);
    
    // Instructions
    this.add.text(400, 580, 'WASD 移动 | E 拾取/攻击 | 到达电梯按Q返回', {
      fontSize: '14px',
      color: '#888888',
    }).setOrigin(0.5);
  }

  private createMonsterSprite(x: number, y: number): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const body = this.add.rectangle(0, 0, 22, 22, 0xff4444);
    const eyes = this.add.rectangle(-4, -3, 4, 4, 0xffffff);
    const eyes2 = this.add.rectangle(4, -3, 4, 4, 0xffffff);
    container.add([body, eyes, eyes2]);
    container.setDepth(5);
    return container;
  }

  private createResourceSprite(x: number, y: number, color: number): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const body = this.add.rectangle(0, 0, 14, 14, color);
    container.add(body);
    container.setDepth(3);
    return container;
  }

  // ── Manage Phase ─────────────────────────────────────────────────────────

  private startManagePhase() {
    this.gameState = 'manage';
    this.clearScene();
    
    this.drawManageView();
    this.createManageUI();
  }

  private drawManageView() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);
    
    // Draw occupied floors
    let y = 80;
    this.floors.forEach((floor, num) => {
      if (floor.hasRoom && floor.roomType) {
        const roomDef = this.roomDefs.get(floor.roomType)!;
        this.mapGraphics.fillStyle(roomDef.color, 0.3);
        this.mapGraphics.fillRect(200, y, 400, 40);
        this.mapGraphics.lineStyle(1, roomDef.color, 0.5);
        this.mapGraphics.strokeRect(200, y, 400, 40);
        
        this.add.text(220, y + 12, `${num}F - ${roomDef.name} Lv.${floor.roomLevel}`, {
          fontSize: '14px',
          color: '#ffffff',
        });
        this.add.text(520, y + 12, `+${floor.income}/轮`, {
          fontSize: '14px',
          color: '#ffcc00',
        });
        
        y += 50;
      }
    });
    
    if (y === 80) {
      this.add.text(400, 300, '还没有占领任何楼层\n去探索吧！', {
        fontSize: '20px',
        color: '#888888',
        align: 'center',
      }).setOrigin(0.5);
    }
  }

  private createManageUI() {
    this.add.text(400, 30, '旅馆管理', {
      fontSize: '28px',
      color: '#ffcc00',
    }).setOrigin(0.5);
    
    // Stats
    const statsText = this.add.text(20, 20, 
      `金币: ${this.player.gold} | 建材: ${this.player.materials}\n员工: ${this.player.workers}\n总收益: ${this.totalIncome}/轮`, {
      fontSize: '14px',
      color: '#88ff88',
    });
    this.uiTexts.set('stats', statsText);
    
    // Instructions
    this.add.text(400, 570, '空格 返回电梯', {
      fontSize: '16px',
      color: '#888888',
    }).setOrigin(0.5);
  }

  // ── Update ───────────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }
    
    switch (this.gameState) {
      case 'elevator':
        this.updateElevator(delta);
        break;
      case 'floor':
        this.updateFloor(delta);
        break;
      case 'manage':
        this.updateManage(delta);
        break;
    }
    
    // Income timer (always running)
    this.incomeTimer += delta;
    if (this.incomeTimer >= this.incomeInterval) {
      this.incomeTimer = 0;
      this.player.gold += this.totalIncome;
    }
  }

  private updateElevator(delta: number) {
    // Decision timer
    this.elevatorDecisionTimer -= delta;
    const timerText = this.uiTexts.get('timer');
    if (timerText) {
      timerText.setText(`决策时间: ${Math.ceil(this.elevatorDecisionTimer / 1000)}s`);
    }
    
    if (this.elevatorDecisionTimer <= 0) {
      // Auto descend
      this.descend();
      return;
    }
    
    // Open door (explore floor)
    if (Phaser.Input.Keyboard.JustDown(this.qKey)) {
      this.startFloorPhase();
      return;
    }
    
    // Descend
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.descend();
      return;
    }
    
    // Manage
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.startManagePhase();
      return;
    }
  }

  private descend() {
    this.currentFloor++;
    if (this.currentFloor > 50) {
      this.showMessage('你到达了塔底！游戏结束！');
      this.time.delayedCall(3000, () => this.scene.start('MenuScene'));
      return;
    }
    this.maxFloorReached = Math.max(this.maxFloorReached, this.currentFloor);
    this.startElevatorPhase();
  }

  private updateFloor(delta: number) {
    // Movement
    const speed = 150;
    const dt = delta / 1000;
    let dx = 0, dy = 0;
    
    if (this.cursors.left!.isDown || this.wasdKeys.A.isDown) dx -= 1;
    if (this.cursors.right!.isDown || this.wasdKeys.D.isDown) dx += 1;
    if (this.cursors.up!.isDown || this.wasdKeys.W.isDown) dy -= 1;
    if (this.cursors.down!.isDown || this.wasdKeys.S.isDown) dy += 1;
    
    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      this.player.x += (dx / len) * speed * dt;
      this.player.y += (dy / len) * speed * dt;
      
      this.player.x = Phaser.Math.Clamp(this.player.x, 20, 780);
      this.player.y = Phaser.Math.Clamp(this.player.y, 20, 580);
      
      this.playerSprite.x = this.player.x;
      this.playerSprite.y = this.player.y;
    }
    
    // Pickup / Attack
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      // Pickup resources
      for (const res of this.resources) {
        if (res.collected) continue;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, res.x, res.y);
        if (dist < 30) {
          res.collected = true;
          res.sprite.setVisible(false);
          if (res.type === 'gold') this.player.gold += res.amount;
          else if (res.type === 'material') this.player.materials += res.amount;
          else if (res.type === 'worker') this.player.workers += res.amount;
          this.updateInventoryUI();
          break;
        }
      }
      
      // Attack monsters
      for (const mon of this.monsters) {
        if (!mon.isAlive) continue;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, mon.x, mon.y);
        if (dist < 40) {
          mon.health -= 25;
          if (mon.health <= 0) {
            mon.isAlive = false;
            mon.sprite.setVisible(false);
            // Drop gold
            this.player.gold += 5 + Math.floor(this.currentFloor / 2);
            this.updateInventoryUI();
          }
          break;
        }
      }
    }
    
    // Monster AI
    for (const mon of this.monsters) {
      if (!mon.isAlive) continue;
      
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, mon.x, mon.y);
      if (dist < 250) {
        const dir = new Phaser.Math.Vector2(this.player.x - mon.x, this.player.y - mon.y).normalize();
        mon.x += dir.x * mon.speed * dt;
        mon.y += dir.y * mon.speed * dt;
        mon.sprite.x = mon.x;
        mon.sprite.y = mon.y;
        
        if (dist < 30) {
          this.player.health -= mon.damage * dt;
          const healthText = this.uiTexts.get('health');
          if (healthText) {
            healthText.setText(`生命: ${Math.ceil(this.player.health)}/${this.player.maxHealth}`);
          }
          
          if (this.player.health <= 0) {
            this.showMessage('你被怪物击杀！');
            this.time.delayedCall(2000, () => this.scene.start('MenuScene'));
            return;
          }
        }
      }
    }
    
    // Check if floor cleared
    const allDead = this.monsters.every(m => !m.isAlive);
    if (allDead && !this.currentFloorData!.cleared) {
      this.currentFloorData!.cleared = true;
      this.showMessage('楼层已清除！可以建造房间了 (按R)');
      this.time.delayedCall(2000, () => this.hideMessage());
      if (this.mapGraphics) this.mapGraphics.destroy();
      this.drawFloorMap();
    }
    
    // Build room
    if (Phaser.Input.Keyboard.JustDown(this.rKey) && this.currentFloorData!.cleared && !this.currentFloorData!.hasRoom) {
      const inBuildZone = this.player.x > 300 && this.player.x < 500 && this.player.y > 200 && this.player.y < 350;
      if (inBuildZone) {
        this.tryBuildRoom();
      }
    }
    
    // Return to elevator
    const inElevator = this.player.x > 350 && this.player.x < 450 && this.player.y > 520 && this.player.y < 580;
    if (inElevator && Phaser.Input.Keyboard.JustDown(this.qKey)) {
      this.startElevatorPhase();
    }
  }

  private tryBuildRoom() {
    const roomTypes = ['guest_room', 'restaurant', 'armory', 'medbay', 'casino'];
    const roomKeys = ['1', '2', '3', '4', '5'];
    
    for (let i = 0; i < roomTypes.length; i++) {
      const key = this.input.keyboard!.addKey(roomKeys[i]);
      if (Phaser.Input.Keyboard.JustDown(key)) {
        const roomType = roomTypes[i];
        const roomDef = this.roomDefs.get(roomType)!;
        
        if (this.player.materials >= roomDef.cost) {
          this.player.materials -= roomDef.cost;
          this.currentFloorData!.hasRoom = true;
          this.currentFloorData!.roomType = roomType;
          this.currentFloorData!.roomLevel = 1;
          
          const depthBonus = 1 + (this.currentFloor - 1) * 0.1;
          this.currentFloorData!.income = Math.floor(roomDef.income * depthBonus);
          this.totalIncome += this.currentFloorData!.income;
          
          this.rooms.set(this.currentFloor, {
            type: roomType,
            level: 1,
            income: this.currentFloorData!.income
          });
          
          this.showMessage(`建造了 ${roomDef.name}！收益: +${this.currentFloorData!.income}/轮`);
          this.time.delayedCall(2000, () => this.hideMessage());
          
          this.updateInventoryUI();
          if (this.mapGraphics) this.mapGraphics.destroy();
          this.drawFloorMap();
        } else {
          this.showMessage('建材不足！');
          this.time.delayedCall(1500, () => this.hideMessage());
        }
        break;
      }
    }
  }

  private updateManage(_delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.startElevatorPhase();
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private clearScene() {
    this.children.removeAll(true);
    this.uiTexts.clear();
    this.monsters = [];
    this.resources = [];
  }

  private updateInventoryUI() {
    const invText = this.uiTexts.get('inventory');
    if (invText) {
      invText.setText(`金币: ${this.player.gold} | 建材: ${this.player.materials} | 员工: ${this.player.workers}`);
    }
    
    const statsText = this.uiTexts.get('stats');
    if (statsText) {
      statsText.setText(
        `金币: ${this.player.gold} | 建材: ${this.player.materials}\n员工: ${this.player.workers} | 生命: ${this.player.health}/${this.player.maxHealth}\n总收益: ${this.totalIncome}/轮`
      );
    }
  }

  private showMessage(text: string) {
    if (this.messageText) this.messageText.destroy();
    this.messageText = this.add.text(400, 300, text, {
      fontSize: '22px',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 16, y: 8 },
      align: 'center',
    }).setOrigin(0.5).setDepth(100);
  }

  private hideMessage() {
    if (this.messageText) {
      this.messageText.destroy();
      this.messageText = null!;
    }
  }
}
