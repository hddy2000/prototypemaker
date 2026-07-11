import Phaser from 'phaser';

// ── Types ──────────────────────────────────────────────────────────────────

interface Location {
  name: string;
  icon: string;
  resources: { medical: number; ammo: number; material: number; food: number };
  monsterType: string;
  monsterCount: number;
  dangerLevel: number;
}

interface Player {
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  carrying: { medical: number; ammo: number; material: number; food: number };
  curse: string | null;
  isAlive: boolean;
}

interface Monster {
  x: number;
  y: number;
  type: string;
  health: number;
  speed: number;
  damage: number;
  sprite: Phaser.GameObjects.Container;
  isAlive: boolean;
}

interface Resource {
  x: number;
  y: number;
  type: 'medical' | 'ammo' | 'material' | 'food';
  amount: number;
  sprite: Phaser.GameObjects.Container;
  collected: boolean;
}

interface Shelter {
  medicalStation: number;
  armory: number;
  defense: number;
  intel: number;
  kitchen: number;
}

// ── Scene ──────────────────────────────────────────────────────────────────

export class MidnightGambleScene extends Phaser.Scene {
  // Game state
  private gameState: 'roulette' | 'mission' | 'shelter' = 'roulette';
  
  // Roulette
  private rouletteSlots: Location[] = [];
  private selectedSlot = 0;
  private isSpinning = false;
  private spinResult = -1;
  
  // Mission
  private player: Player = {
    x: 400, y: 300, health: 100, maxHealth: 100,
    carrying: { medical: 0, ammo: 0, material: 0, food: 0 },
    curse: null, isAlive: true
  };
  private monsters: Monster[] = [];
  private resources: Resource[] = [];
  private currentLocation: Location | null = null;
  private missionTimer = 0;
  private missionTimeLimit = 60000; // 60 seconds
  private isExtracting = false;
  private extractTimer = 0;
  
  // Shelter
  private shelter: Shelter = {
    medicalStation: 0, armory: 0, defense: 0, intel: 0, kitchen: 0
  };
  private shelterResources = { medical: 20, ammo: 20, material: 20, food: 20 };
  private shelterLevel = 1;
  
  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private escKey!: Phaser.Input.Keyboard.Key;
  private qKey!: Phaser.Input.Keyboard.Key;
  
  // UI
  private uiTexts: Map<string, Phaser.GameObjects.Text> = new Map();
  private messageText!: Phaser.GameObjects.Text;
  
  // Graphics
  private playerSprite!: Phaser.GameObjects.Container;
  private mapGraphics!: Phaser.GameObjects.Graphics;
  
  // Map
  private mapWidth = 800;
  private mapHeight = 600;
  
  // Room system (like HauntedMansion)
  private rooms: Array<{ x: number; y: number; w: number; h: number; name: string; centerX: number; centerY: number; hasLight: boolean; lightOn: boolean; switchX: number; switchY: number }> = [];
  private obstacles: Array<{ x: number; y: number; w: number; h: number }> = [];
  private roomLightOverlays: Phaser.GameObjects.Graphics[] = [];
  private roomNameTexts: Phaser.GameObjects.Text[] = [];
  
  // Fog of war (cone vision like HauntedMansion)
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'gambleFog';
  private viewRadius = 180;
  private screenW = 800;
  private screenH = 600;
  private cam!: Phaser.Cameras.Scene2D.Camera;
  private playerFacingAngle = 0;
  private buildMode = false; // R key build mode

  constructor() {
    super({ key: 'MidnightGambleScene' });
  }

  // Generate room layout (2x2 grid like HauntedMansion)
  private generateRooms() {
    this.rooms = [];
    this.obstacles = [];
    
    const cols = 2;
    const rows = 2;
    const roomGap = 40;
    const border = 20;
    const usableW = this.mapWidth - border * 2;
    const usableH = this.mapHeight - border * 2;
    const roomW = Math.floor((usableW - roomGap * (cols - 1)) / cols);
    const roomH = Math.floor((usableH - roomGap * (rows - 1)) / rows);
    
    const roomNames = ['入口大厅', '储藏室', '走廊', '密室'];
    
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = border + c * (roomW + roomGap);
        const y = border + r * (roomH + roomGap);
        const hasLight = Math.random() < 0.5;
        
        this.rooms.push({
          x, y, w: roomW, h: roomH,
          name: roomNames[idx],
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
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: border });
    this.obstacles.push({ x: 0, y: this.mapHeight - border, w: this.mapWidth, h: border });
    this.obstacles.push({ x: 0, y: 0, w: border, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - border, y: 0, w: border, h: this.mapHeight });
    
    // Room walls with doorways
    const doorWidth = 60;
    for (const room of this.rooms) {
      // Top wall
      if (room.y > border) {
        const doorX = room.x + room.w / 2 - doorWidth / 2;
        this.obstacles.push({ x: room.x, y: room.y - roomGap, w: doorX - room.x, h: roomGap });
        this.obstacles.push({ x: doorX + doorWidth, y: room.y - roomGap, w: room.x + room.w - (doorX + doorWidth), h: roomGap });
      }
      // Left wall
      if (room.x > border) {
        const doorY = room.y + room.h / 2 - doorWidth / 2;
        this.obstacles.push({ x: room.x - roomGap, y: room.y, w: roomGap, h: doorY - room.y });
        this.obstacles.push({ x: room.x - roomGap, y: doorY + doorWidth, w: roomGap, h: room.y + room.h - (doorY + doorWidth) });
      }
      // Bottom wall
      const isBottomRow = room.y + room.h >= this.mapHeight - border;
      if (!isBottomRow) {
        const doorX = room.x + room.w / 2 - doorWidth / 2;
        this.obstacles.push({ x: room.x, y: room.y + room.h, w: doorX - room.x, h: roomGap });
        this.obstacles.push({ x: doorX + doorWidth, y: room.y + room.h, w: room.x + room.w - (doorX + doorWidth), h: roomGap });
      }
      // Right wall
      const isRightmost = room.x + room.w >= this.mapWidth - border;
      if (!isRightmost) {
        const doorY = room.y + room.h / 2 - doorWidth / 2;
        this.obstacles.push({ x: room.x + room.w, y: room.y, w: roomGap, h: doorY - room.y });
        this.obstacles.push({ x: room.x + room.w, y: doorY + doorWidth, w: roomGap, h: room.y + room.h - (doorY + doorWidth) });
      }
    }
  }

  // Draw rooms with walls, doors, and light switches
  private drawRooms() {
    // Room floors
    const shades = [0x1e1e3a, 0x222238, 0x1a2a2e, 0x2a1e2e];
    this.rooms.forEach((room, i) => {
      this.mapGraphics.fillStyle(shades[i % shades.length], 1);
      this.mapGraphics.fillRect(room.x, room.y, room.w, room.h);
      
      // Room name
      const roomLabel = this.add.text(room.centerX, room.y + 20, room.name, {
        fontSize: '18px',
        color: '#555577',
      }).setOrigin(0.5).setDepth(1);
      this.roomNameTexts.push(roomLabel);
      
      // Light switch
      const switchColor = room.lightOn ? 0xffff00 : 0x888888;
      this.mapGraphics.fillStyle(switchColor, 0.8);
      this.mapGraphics.fillRect(room.switchX - 8, room.switchY - 8, 16, 16);
      this.mapGraphics.lineStyle(2, 0xffffff, 0.6);
      this.mapGraphics.strokeRect(room.switchX - 8, room.switchY - 8, 16, 16);
      
      // Dark overlay if light is off
      if (!room.lightOn) {
        const overlay = this.add.graphics();
        overlay.fillStyle(0x000000, 0.7);
        overlay.fillRect(room.x, room.y, room.w, room.h);
        overlay.setDepth(2);
        this.roomLightOverlays.push(overlay);
      }
    });
    
    // Walls
    this.mapGraphics.fillStyle(0x444466, 1);
    for (const obs of this.obstacles) {
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
    }
    
    // Wall outlines
    this.mapGraphics.lineStyle(2, 0x666688, 1);
    for (const room of this.rooms) {
      this.mapGraphics.strokeRect(room.x, room.y, room.w, room.h);
    }
  }

  // Create fog of war canvas
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
  }

  // Update fog based on player position and room lighting
  private updateFog() {
    const ctx = this.fogCtx;
    const screenX = this.player.x - this.cam.scrollX;
    const screenY = this.player.y - this.cam.scrollY;
    
    // Check if player is in a dark room
    const playerRoom = this.rooms.find(r => 
      this.player.x >= r.x && this.player.x <= r.x + r.w &&
      this.player.y >= r.y && this.player.y <= r.y + r.h
    );
    const inDarkRoom = playerRoom && !playerRoom.lightOn;
    
    // Cone parameters - smaller in dark rooms
    const coneRadius = inDarkRoom ? this.viewRadius * 1.2 : this.viewRadius * 4;
    const coneAngle = Math.PI / 2; // 90 degrees cone
    
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.94)';
    ctx.fillRect(0, 0, this.screenW, this.screenH);
    
    ctx.globalCompositeOperation = 'destination-out';
    
    // Raycasting for wall-occluded vision
    const rayCount = 60;
    const startAngle = this.playerFacingAngle - coneAngle / 2;
    const endAngle = this.playerFacingAngle + coneAngle / 2;
    const angleStep = (endAngle - startAngle) / rayCount;
    
    ctx.beginPath();
    ctx.moveTo(screenX, screenY);
    
    for (let i = 0; i <= rayCount; i++) {
      const angle = startAngle + angleStep * i;
      const rayEnd = this.castRay(this.player.x, this.player.y, angle, coneRadius);
      
      const rayScreenX = rayEnd.x - this.cam.scrollX;
      const rayScreenY = rayEnd.y - this.cam.scrollY;
      
      ctx.lineTo(rayScreenX, rayScreenY);
    }
    
    ctx.closePath();
    
    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, coneRadius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fill();
    
    ctx.globalCompositeOperation = 'source-over';
    
    // Upload canvas to WebGL texture
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

  // Raycasting for vision occlusion
  private castRay(originX: number, originY: number, angle: number, maxDist: number): { x: number; y: number } {
    const step = 5;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    
    for (let dist = 0; dist < maxDist; dist += step) {
      const checkX = originX + dirX * dist;
      const checkY = originY + dirY * dist;
      
      if (this.isObstacleAt(checkX, checkY, 1)) {
        return { x: checkX, y: checkY };
      }
    }
    
    return { x: originX + dirX * maxDist, y: originY + dirY * maxDist };
  }

  // Check if point is inside obstacle
  private isObstacleAt(x: number, y: number, radius: number): boolean {
    for (const obs of this.obstacles) {
      const closestX = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
      const closestY = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
      const dist = Phaser.Math.Distance.Between(x, y, closestX, closestY);
      if (dist < radius) return true;
    }
    return false;
  }

  // Handle light switch interaction
  private handleLightSwitch() {
    if (!Phaser.Input.Keyboard.JustDown(this.eKey)) return;
    
    for (const room of this.rooms) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, room.switchX, room.switchY);
      if (dist < 40 && room.hasLight) {
        room.lightOn = !room.lightOn;
        
        // Update overlay
        const overlayIdx = this.rooms.indexOf(room);
        if (room.lightOn) {
          if (this.roomLightOverlays[overlayIdx]) {
            this.roomLightOverlays[overlayIdx].destroy();
            this.roomLightOverlays[overlayIdx] = null as any;
          }
        } else {
          const overlay = this.add.graphics();
          overlay.fillStyle(0x000000, 0.7);
          overlay.fillRect(room.x, room.y, room.w, room.h);
          overlay.setDepth(2);
          this.roomLightOverlays[overlayIdx] = overlay;
        }
        
        // Redraw switch
        if (this.mapGraphics) this.mapGraphics.destroy();
        this.mapGraphics = this.add.graphics();
        this.drawRooms();
        
        break;
      }
    }
  }

  create() {
    this.cam = this.cameras.main;
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
    
    // Start with roulette
    this.startRoulettePhase();
  }

  // ── Roulette Phase ───────────────────────────────────────────────────────

  private startRoulettePhase() {
    this.gameState = 'roulette';
    this.clearScene();
    
    // Generate 6 random locations
    const locationPool: Location[] = [
      { name: '废弃医院', icon: '🏥', resources: { medical: 15, ammo: 3, material: 2, food: 1 }, monsterType: '护士', monsterCount: 3, dangerLevel: 2 },
      { name: '闹鬼学校', icon: '🏫', resources: { medical: 2, ammo: 12, material: 3, food: 2 }, monsterType: '孩童', monsterCount: 5, dangerLevel: 3 },
      { name: '深夜超市', icon: '🏪', resources: { medical: 3, ammo: 5, material: 8, food: 10 }, monsterType: '顾客', monsterCount: 6, dangerLevel: 2 },
      { name: '荒废工厂', icon: '🏭', resources: { medical: 2, ammo: 8, material: 15, food: 1 }, monsterType: '工人', monsterCount: 2, dangerLevel: 4 },
      { name: '居民楼', icon: '🏠', resources: { medical: 5, ammo: 5, material: 5, food: 5 }, monsterType: '邻居', monsterCount: 4, dangerLevel: 2 },
      { name: '墓地', icon: '⚰️', resources: { medical: 5, ammo: 10, material: 5, food: 2 }, monsterType: '守墓人', monsterCount: 1, dangerLevel: 5 },
    ];
    
    // Shuffle and pick 6
    this.rouletteSlots = Phaser.Utils.Array.Shuffle(locationPool).slice(0, 6);
    this.selectedSlot = 0;
    
    this.drawRoulette();
    this.createRouletteUI();
  }

  private drawRoulette() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);
    
    // Draw roulette wheel
    const centerX = 400;
    const centerY = 280;
    const radius = 150;
    
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const nextAngle = ((i + 1) / 6) * Math.PI * 2 - Math.PI / 2;
      
      const color = i === this.selectedSlot ? 0x4488ff : 0x333355;
      this.mapGraphics.fillStyle(color, 0.8);
      this.mapGraphics.beginPath();
      this.mapGraphics.moveTo(centerX, centerY);
      this.mapGraphics.lineTo(
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius
      );
      this.mapGraphics.lineTo(
        centerX + Math.cos(nextAngle) * radius,
        centerY + Math.sin(nextAngle) * radius
      );
      this.mapGraphics.closePath();
      this.mapGraphics.fillPath();
      
      // Location icon
      const midAngle = (angle + nextAngle) / 2;
      const iconX = centerX + Math.cos(midAngle) * (radius * 0.6);
      const iconY = centerY + Math.sin(midAngle) * (radius * 0.6);
      
      this.add.text(iconX, iconY, this.rouletteSlots[i].icon, {
        fontSize: '32px',
      }).setOrigin(0.5);
    }
    
    // Center circle
    this.mapGraphics.fillStyle(0x222244, 1);
    this.mapGraphics.fillCircle(centerX, centerY, 40);
  }

  private createRouletteUI() {
    // Title
    this.add.text(400, 40, '午夜赌局', {
      fontSize: '36px',
      color: '#ffcc00',
    }).setOrigin(0.5);
    
    // Instructions
    this.add.text(400, 80, '← → 选择地点 | 空格 转动轮盘 | E 查看避难所', {
      fontSize: '16px',
      color: '#888888',
    }).setOrigin(0.5);
    
    // Selected location info
    const slot = this.rouletteSlots[this.selectedSlot];
    const infoText = this.add.text(400, 460, 
      `${slot.icon} ${slot.name}\n危险等级: ${'⭐'.repeat(slot.dangerLevel)}\n怪物: ${slot.monsterType} × ${slot.monsterCount}`, {
      fontSize: '18px',
      color: '#ffffff',
      align: 'center',
    }).setOrigin(0.5);
    
    this.uiTexts.set('locationInfo', infoText);
    
    // Shelter resources
    const shelterText = this.add.text(20, 20, 
      `避难所等级: ${this.shelterLevel}\n医疗: ${this.shelterResources.medical} | 弹药: ${this.shelterResources.ammo}\n建材: ${this.shelterResources.material} | 食物: ${this.shelterResources.food}`, {
      fontSize: '14px',
      color: '#88ff88',
    });
    
    this.uiTexts.set('shelterInfo', shelterText);
  }

  // ── Mission Phase ────────────────────────────────────────────────────────

  private startMissionPhase(location: Location) {
    this.gameState = 'mission';
    this.clearScene();
    
    this.currentLocation = location;
    this.missionTimer = this.missionTimeLimit;
    this.isExtracting = false;
    
    // Generate room layout
    this.generateRooms();
    
    // Reset player position to extraction zone (elevator)
    this.player.x = 320;
    this.player.y = 510;
    this.player.isAlive = true;
    
    // Create player sprite
    this.playerSprite = this.add.container(this.player.x, this.player.y);
    const playerBody = this.add.rectangle(0, 0, 24, 24, 0x00ff00);
    this.playerSprite.add(playerBody);
    this.playerSprite.setDepth(10);
    
    // Generate monsters in random rooms
    this.monsters = [];
    for (let i = 0; i < location.monsterCount; i++) {
      const room = this.rooms[Phaser.Math.Between(1, this.rooms.length - 1)]; // Avoid first room
      const mx = Phaser.Math.Between(room.x + 30, room.x + room.w - 30);
      const my = Phaser.Math.Between(room.y + 30, room.y + room.h - 30);
      this.monsters.push({
        x: mx, y: my,
        type: location.monsterType,
        health: 30 + location.dangerLevel * 10,
        speed: 40 + location.dangerLevel * 10,
        damage: 5 + location.dangerLevel * 2,
        sprite: this.createMonsterSprite(mx, my, location.monsterType),
        isAlive: true
      });
    }
    
    // Generate resources in rooms
    this.resources = [];
    const resTypes: Array<'medical' | 'ammo' | 'material' | 'food'> = ['medical', 'ammo', 'material', 'food'];
    for (const type of resTypes) {
      const count = location.resources[type];
      for (let i = 0; i < count; i++) {
        const room = this.rooms[Phaser.Math.Between(0, this.rooms.length - 1)];
        const rx = Phaser.Math.Between(room.x + 20, room.x + room.w - 20);
        const ry = Phaser.Math.Between(room.y + 20, room.y + room.h - 20);
        this.resources.push({
          x: rx, y: ry,
          type,
          amount: 1,
          sprite: this.createResourceSprite(rx, ry, type),
          collected: false
        });
      }
    }
    
    // Draw room map
    this.mapGraphics = this.add.graphics();
    this.drawRooms();
    
    // Create fog of war
    this.createFog();
    
    // Camera follow
    this.cameras.main.startFollow(this.playerSprite, true, 0.1, 0.1);
    
    this.createMissionUI();
  }

  private drawMissionMap() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);
    
    // Location name
    this.add.text(400, 30, `${this.currentLocation!.icon} ${this.currentLocation!.name}`, {
      fontSize: '24px',
      color: '#ffcc00',
    }).setOrigin(0.5);
    
    // Extraction zone (inside bottom-left room)
    this.mapGraphics.fillStyle(0x00ff00, 0.3);
    this.mapGraphics.fillRect(280, 480, 80, 60);
    this.add.text(320, 510, '撤离点', {
      fontSize: '14px',
      color: '#00ff00',
    }).setOrigin(0.5);
  }

  private createMonsterSprite(x: number, y: number, type: string): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const colors: { [key: string]: number } = {
      '护士': 0xff8888,
      '孩童': 0xff88ff,
      '顾客': 0x88ff88,
      '工人': 0x8888ff,
      '邻居': 0xffff88,
      '守墓人': 0x888888
    };
    const body = this.add.rectangle(0, 0, 20, 20, colors[type] || 0xff0000);
    container.add(body);
    container.setDepth(5);
    return container;
  }

  private createResourceSprite(x: number, y: number, type: string): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const colors: { [key: string]: number } = {
      'medical': 0xff4444,
      'ammo': 0xffaa00,
      'material': 0x888888,
      'food': 0x44ff44
    };
    const body = this.add.rectangle(0, 0, 12, 12, colors[type] || 0xffffff);
    container.add(body);
    container.setDepth(3);
    return container;
  }

  private createMissionUI() {
    // Timer
    const timerText = this.add.text(400, 60, `剩余时间: 60s`, {
      fontSize: '20px',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5);
    this.uiTexts.set('timer', timerText);
    
    // Health
    const healthText = this.add.text(20, 60, `生命: ${this.player.health}/${this.player.maxHealth}`, {
      fontSize: '16px',
      color: '#ff4444',
    });
    this.uiTexts.set('health', healthText);
    
    // Carrying
    const carryText = this.add.text(20, 85, `携带: 医疗${this.player.carrying.medical} 弹药${this.player.carrying.ammo} 建材${this.player.carrying.material} 食物${this.player.carrying.food}`, {
      fontSize: '14px',
      color: '#88ff88',
    });
    this.uiTexts.set('carrying', carryText);
    
    // Instructions
    this.add.text(400, 580, 'WASD 移动 | E 拾取/攻击 | 到达撤离点按Q撤离', {
      fontSize: '14px',
      color: '#888888',
    }).setOrigin(0.5);
  }

  // ── Shelter Phase ────────────────────────────────────────────────────────

  private startShelterPhase() {
    this.gameState = 'shelter';
    this.clearScene();
    
    this.drawShelter();
    this.createShelterUI();
  }

  private drawShelter() {
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);
    
    // Draw shelter buildings
    const buildings = [
      { name: '医疗站', level: this.shelter.medicalStation, x: 200, y: 200, color: 0xff4444 },
      { name: '军械库', level: this.shelter.armory, x: 400, y: 200, color: 0xffaa00 },
      { name: '防御工事', level: this.shelter.defense, x: 600, y: 200, color: 0x888888 },
      { name: '情报站', level: this.shelter.intel, x: 200, y: 400, color: 0x4488ff },
      { name: '厨房', level: this.shelter.kitchen, x: 400, y: 400, color: 0x44ff44 },
    ];
    
    for (const b of buildings) {
      this.mapGraphics.fillStyle(b.color, 0.5);
      this.mapGraphics.fillRect(b.x - 50, b.y - 50, 100, 100);
      this.mapGraphics.lineStyle(2, b.color, 1);
      this.mapGraphics.strokeRect(b.x - 50, b.y - 50, 100, 100);
      
      this.add.text(b.x, b.y - 20, b.name, {
        fontSize: '16px',
        color: '#ffffff',
      }).setOrigin(0.5);
      
      this.add.text(b.x, b.y + 10, `Lv.${b.level}`, {
        fontSize: '14px',
        color: '#ffcc00',
      }).setOrigin(0.5);
    }
  }

  private createShelterUI() {
    this.add.text(400, 40, '避难所', {
      fontSize: '32px',
      color: '#ffcc00',
    }).setOrigin(0.5);
    
    // Resources
    const resText = this.add.text(20, 20, 
      `医疗: ${this.shelterResources.medical} | 弹药: ${this.shelterResources.ammo}\n建材: ${this.shelterResources.material} | 食物: ${this.shelterResources.food}`, {
      fontSize: '16px',
      color: '#88ff88',
    });
    this.uiTexts.set('resources', resText);
    
    // Instructions
    this.add.text(400, 560, '1-5 升级建筑 | 空格 返回轮盘', {
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
      case 'roulette':
        this.updateRoulette(delta);
        break;
      case 'mission':
        this.updateMission(delta);
        break;
      case 'shelter':
        this.updateShelter(delta);
        break;
    }
  }

  private updateRoulette(_delta: number) {
    // Navigation
    if (Phaser.Input.Keyboard.JustDown(this.cursors.left!)) {
      this.selectedSlot = (this.selectedSlot - 1 + 6) % 6;
      this.refreshRouletteUI();
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursors.right!)) {
      this.selectedSlot = (this.selectedSlot + 1) % 6;
      this.refreshRouletteUI();
    }
    
    // Spin
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey) && !this.isSpinning) {
      this.spinRoulette();
    }
    
    // Shelter
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      this.startShelterPhase();
    }
  }

  private refreshRouletteUI() {
    // Redraw
    if (this.mapGraphics) this.mapGraphics.destroy();
    this.drawRoulette();
    
    // Update info
    const slot = this.rouletteSlots[this.selectedSlot];
    const infoText = this.uiTexts.get('locationInfo');
    if (infoText) {
      infoText.setText(`${slot.icon} ${slot.name}\n危险等级: ${'⭐'.repeat(slot.dangerLevel)}\n怪物: ${slot.monsterType} × ${slot.monsterCount}`);
    }
  }

  private spinRoulette() {
    this.isSpinning = true;
    
    // Random result
    this.spinResult = Phaser.Math.Between(0, 5);
    
    // Animate selection
    let spinCount = 0;
    const spinInterval = this.time.addEvent({
      delay: 100,
      callback: () => {
        this.selectedSlot = (this.selectedSlot + 1) % 6;
        this.refreshRouletteUI();
        spinCount++;
        
        if (spinCount >= 20 + this.spinResult) {
          spinInterval.remove();
          this.selectedSlot = this.spinResult;
          this.refreshRouletteUI();
          this.isSpinning = false;
          
          // Start mission after delay
          this.time.delayedCall(1500, () => {
            this.startMissionPhase(this.rouletteSlots[this.selectedSlot]);
          });
        }
      },
      loop: true
    });
  }

  private updateMission(delta: number) {
    if (!this.player.isAlive) return;
    
    // Timer
    this.missionTimer -= delta;
    const timerText = this.uiTexts.get('timer');
    if (timerText) {
      timerText.setText(`剩余时间: ${Math.ceil(this.missionTimer / 1000)}s`);
    }
    
    if (this.missionTimer <= 0) {
      this.player.health = 0;
      this.player.isAlive = false;
      this.showMessage('时间到！任务失败！');
      this.time.delayedCall(2000, () => this.startRoulettePhase());
      return;
    }
    
    // Movement with obstacle collision
    const speed = 150;
    const dt = delta / 1000;
    let dx = 0, dy = 0;
    
    if (this.cursors.left!.isDown || this.wasdKeys.A.isDown) dx -= 1;
    if (this.cursors.right!.isDown || this.wasdKeys.D.isDown) dx += 1;
    if (this.cursors.up!.isDown || this.wasdKeys.W.isDown) dy -= 1;
    if (this.cursors.down!.isDown || this.wasdKeys.S.isDown) dy += 1;
    
    if (dx !== 0 || dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy);
      const newX = this.player.x + (dx / len) * speed * dt;
      const newY = this.player.y + (dy / len) * speed * dt;
      
      // Update facing angle
      this.playerFacingAngle = Math.atan2(dy, dx);
      
      // Check collision before moving
      if (!this.isObstacleAt(newX, this.player.y, 12)) {
        this.player.x = newX;
      }
      if (!this.isObstacleAt(this.player.x, newY, 12)) {
        this.player.y = newY;
      }
      
      // Bounds
      this.player.x = Phaser.Math.Clamp(this.player.x, 20, 780);
      this.player.y = Phaser.Math.Clamp(this.player.y, 20, 580);
      
      this.playerSprite.x = this.player.x;
      this.playerSprite.y = this.player.y;
    }
    
    // Update fog of war
    this.updateFog();
    
    // Handle E key interactions (light switch, pickup, attack)
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      // First check for light switches
      let handledLightSwitch = false;
      for (const room of this.rooms) {
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, room.switchX, room.switchY);
        if (dist < 40 && room.hasLight) {
          room.lightOn = !room.lightOn;
          
          // Update overlay
          const overlayIdx = this.rooms.indexOf(room);
          if (room.lightOn) {
            if (this.roomLightOverlays[overlayIdx]) {
              this.roomLightOverlays[overlayIdx].destroy();
              this.roomLightOverlays[overlayIdx] = null as any;
            }
          } else {
            const overlay = this.add.graphics();
            overlay.fillStyle(0x000000, 0.7);
            overlay.fillRect(room.x, room.y, room.w, room.h);
            overlay.setDepth(2);
            this.roomLightOverlays[overlayIdx] = overlay;
          }
          
          // Redraw switch
          if (this.mapGraphics) this.mapGraphics.destroy();
          this.mapGraphics = this.add.graphics();
          this.drawRooms();
          
          handledLightSwitch = true;
          break;
        }
      }
      
      // If not a light switch, try pickup/attack
      if (!handledLightSwitch) {
        for (const res of this.resources) {
          if (res.collected) continue;
          const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, res.x, res.y);
          if (dist < 30) {
            res.collected = true;
            res.sprite.setVisible(false);
            this.player.carrying[res.type] += res.amount;
            this.updateCarryingUI();
            break;
          }
        }
        
        // Attack monsters
        for (const mon of this.monsters) {
          if (!mon.isAlive) continue;
          const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, mon.x, mon.y);
          if (dist < 40 && this.player.carrying.ammo > 0) {
            mon.health -= 20;
            this.player.carrying.ammo--;
            this.updateCarryingUI();
            if (mon.health <= 0) {
              mon.isAlive = false;
              mon.sprite.setVisible(false);
            }
            break;
          }
        }
      }
    }
    
    // Monster AI
    for (const mon of this.monsters) {
      if (!mon.isAlive) continue;
      
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, mon.x, mon.y);
      if (dist < 200) {
        // Chase
        const dir = new Phaser.Math.Vector2(this.player.x - mon.x, this.player.y - mon.y).normalize();
        mon.x += dir.x * mon.speed * dt;
        mon.y += dir.y * mon.speed * dt;
        mon.sprite.x = mon.x;
        mon.sprite.y = mon.y;
        
        // Attack
        if (dist < 30) {
          this.player.health -= mon.damage * dt;
          const healthText = this.uiTexts.get('health');
          if (healthText) {
            healthText.setText(`生命: ${Math.ceil(this.player.health)}/${this.player.maxHealth}`);
          }
          
          if (this.player.health <= 0) {
            this.player.isAlive = false;
            this.showMessage('你被怪物击杀！');
            this.time.delayedCall(2000, () => this.startRoulettePhase());
            return;
          }
        }
      }
    }
    
    // Extraction
    const inExtractZone = this.player.x > 280 && this.player.x < 360 && this.player.y > 480 && this.player.y < 540;
    
    if (inExtractZone && Phaser.Input.Keyboard.JustDown(this.qKey)) {
      this.isExtracting = true;
      this.extractTimer = 3000;
    }
    
    if (this.isExtracting) {
      this.extractTimer -= delta;
      if (this.extractTimer <= 0) {
        this.extract();
      }
    }
  }

  private extract() {
    // Transfer carrying to shelter
    this.shelterResources.medical += this.player.carrying.medical;
    this.shelterResources.ammo += this.player.carrying.ammo;
    this.shelterResources.material += this.player.carrying.material;
    this.shelterResources.food += this.player.carrying.food;
    
    this.showMessage('撤离成功！物资已存入避难所');
    this.time.delayedCall(2000, () => this.startRoulettePhase());
  }

  private updateShelter(_delta: number) {
    // Upgrade buildings
    const keys = ['1', '2', '3', '4', '5'];
    const buildings: Array<keyof Shelter> = ['medicalStation', 'armory', 'defense', 'intel', 'kitchen'];
    const costs = [10, 15, 20, 12, 8];
    
    for (let i = 0; i < 5; i++) {
      const key = this.input.keyboard!.addKey(keys[i]);
      if (Phaser.Input.Keyboard.JustDown(key)) {
        const building = buildings[i];
        const cost = costs[i] * (this.shelter[building] + 1);
        
        if (this.shelterResources.material >= cost) {
          this.shelterResources.material -= cost;
          this.shelter[building]++;
          this.shelterLevel++;
          this.showMessage(`${building} 升级到 Lv.${this.shelter[building]}!`);
          this.time.delayedCall(1500, () => this.hideMessage());
          this.startShelterPhase(); // Refresh
        } else {
          this.showMessage('建材不足！');
          this.time.delayedCall(1500, () => this.hideMessage());
        }
      }
    }
    
    // Return to roulette
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.startRoulettePhase();
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private clearScene() {
    this.children.removeAll(true);
    this.uiTexts.clear();
    this.monsters = [];
    this.resources = [];
  }

  private updateCarryingUI() {
    const carryText = this.uiTexts.get('carrying');
    if (carryText) {
      carryText.setText(`携带: 医疗${this.player.carrying.medical} 弹药${this.player.carrying.ammo} 建材${this.player.carrying.material} 食物${this.player.carrying.food}`);
    }
  }

  private showMessage(text: string) {
    if (this.messageText) this.messageText.destroy();
    this.messageText = this.add.text(400, 300, text, {
      fontSize: '24px',
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
