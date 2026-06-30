import Phaser from 'phaser';

// ── Types ──────────────────────────────────────────────────────────────────

interface Room {
  x: number; y: number; w: number; h: number;
  name: string;
  centerX: number; centerY: number;
}

interface Secret {
  x: number; y: number;
  roomName: string;
  clue: string;
  collected: boolean;
  detected: boolean;
  revealed: boolean;
  sprite: Phaser.GameObjects.Container;
}

type TrapType = 'teleport' | 'slow' | 'poison' | 'confusion' | 'darkness';

interface Trap {
  x: number; y: number;
  type: TrapType;
  triggered: boolean;
  detected: boolean;
  disarmed: boolean;
  sprite: Phaser.GameObjects.Container;
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
  territoryRadius: number;
  visionRange: number;
  patrolTimer: number;
  alive: boolean;
}

interface Obstacle {
  x: number; y: number; w: number; h: number;
}

type DebuffType = 'slow' | 'poison' | 'confusion' | 'darkness';

interface Debuff {
  type: DebuffType;
  remaining: number; // ms
}

// ── Scene ──────────────────────────────────────────────────────────────────

export class HauntedMansionScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;

  // Map
  private mapWidth = 2400;
  private mapHeight = 1600;
  private obstacles: Obstacle[] = [];
  private rooms: Room[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Fog of war
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'hauntedFog';
  private viewRadius = 180;
  private screenW = 800;
  private screenH = 600;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private secrets: Secret[] = [];
  private traps: Trap[] = [];
  private ghosts: Ghost[] = [];

  // Player stats
  private health = 100;
  private maxHealth = 100;
  private debuffs: Debuff[] = [];

  // UI
  private healthText!: Phaser.GameObjects.Text;
  private secretText!: Phaser.GameObjects.Text;
  private scannerText!: Phaser.GameObjects.Text;
  private debuffText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private staminaText!: Phaser.GameObjects.Text;

  // Scanner
  private scannerRange = 130;
  private scannerCooldown = 0;

  // Game state
  private isDead = false;
  private isWon = false;
  private isEscaping = false;   // all clues collected → boss spawned, must reach exit
  private bossGhost: Ghost | null = null;
  private exit: Phaser.GameObjects.Container | null = null;
  private damageCooldown = 0;
  private totalSecrets = 0;

  // Sprint / stamina
  private stamina = 100;
  private maxStamina = 100;
  private staminaDepleted = false;

  // Darkness debuff reduces view radius
  private darknessTimer = 0;

  constructor() {
    super({ key: 'HauntedMansionScene' });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  create() {
    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateMansion();
    this.drawMap();
    this.createPlayer();
    this.createSecrets();
    this.createTraps();
    this.createWanderingGhosts();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);
  }

  // ── Mansion Generation ───────────────────────────────────────────────────

  private generateMansion() {
    this.obstacles = [];
    this.rooms = [];

    // 3×2 grid of rooms
    const cols = 3;
    const rows = 2;
    const roomGap = 60; // wall thickness between rooms
    const usableW = this.mapWidth - 40;  // minus border
    const usableH = this.mapHeight - 40;
    const roomW = Math.floor((usableW - roomGap * (cols - 1)) / cols);
    const roomH = Math.floor((usableH - roomGap * (rows - 1)) / rows);

    const roomNames = [
      '大厅', '书房', '厨房',
      '卧室', '地下室', '阁楼',
    ];

    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = 20 + c * (roomW + roomGap);
        const y = 20 + r * (roomH + roomGap);
        this.rooms.push({
          x, y, w: roomW, h: roomH,
          name: roomNames[idx % roomNames.length],
          centerX: x + roomW / 2,
          centerY: y + roomH / 2,
        });
        idx++;
      }
    }

    // Border walls
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    // Room walls with doorways
    const doorWidth = 80;

    for (const room of this.rooms) {
      // Top wall
      if (room.y > 20) {
        // doorway in center
        const doorX = room.x + room.w / 2 - doorWidth / 2;
        this.obstacles.push({ x: room.x, y: room.y - roomGap, w: doorX - room.x, h: roomGap });
        this.obstacles.push({ x: doorX + doorWidth, y: room.y - roomGap, w: room.x + room.w - (doorX + doorWidth), h: roomGap });
      }
      // Left wall
      if (room.x > 20) {
        const doorY = room.y + room.h / 2 - doorWidth / 2;
        this.obstacles.push({ x: room.x - roomGap, y: room.y, w: roomGap, h: doorY - room.y });
        this.obstacles.push({ x: room.x - roomGap, y: doorY + doorWidth, w: roomGap, h: room.y + room.h - (doorY + doorWidth) });
      }
      // Bottom wall (only for top-row rooms)
      const isBottomRow = room.y + room.h >= this.mapHeight - 40;
      if (!isBottomRow) {
        const doorX = room.x + room.w / 2 - doorWidth / 2;
        this.obstacles.push({ x: room.x, y: room.y + room.h, w: doorX - room.x, h: roomGap });
        this.obstacles.push({ x: doorX + doorWidth, y: room.y + room.h, w: room.x + room.w - (doorX + doorWidth), h: roomGap });
      }
      // Right wall (only for non-rightmost rooms)
      const isRightmost = room.x + room.w >= this.mapWidth - 40;
      if (!isRightmost) {
        const doorY = room.y + room.h / 2 - doorWidth / 2;
        this.obstacles.push({ x: room.x + room.w, y: room.y, w: roomGap, h: doorY - room.y });
        this.obstacles.push({ x: room.x + room.w, y: doorY + doorWidth, w: roomGap, h: room.y + room.h - (doorY + doorWidth) });
      }
    }

    // Add some decorative furniture obstacles inside rooms
    for (const room of this.rooms) {
      const decorCount = Phaser.Math.Between(2, 4);
      for (let i = 0; i < decorCount; i++) {
        const dw = Phaser.Math.Between(30, 80);
        const dh = Phaser.Math.Between(30, 80);
        const dx = Phaser.Math.Between(room.x + 40, room.x + room.w - 40 - dw);
        const dy = Phaser.Math.Between(room.y + 40, room.y + room.h - 40 - dh);
        // Keep center area clear for secrets/traps
        const distToCenter = Phaser.Math.Distance.Between(dx, dy, room.centerX, room.centerY);
        if (distToCenter < 100) continue;
        this.obstacles.push({ x: dx, y: dy, w: dw, h: dh });
      }
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  private drawMap() {
    this.mapGraphics = this.add.graphics();

    // Floor
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

    // Room floors with slightly different shades
    const shades = [0x1e1e3a, 0x222238, 0x1a2a2e, 0x2a1e2e, 0x1e2a1e, 0x2a2a1e];
    this.rooms.forEach((room, i) => {
      this.mapGraphics.fillStyle(shades[i % shades.length], 1);
      this.mapGraphics.fillRect(room.x, room.y, room.w, room.h);

      // Room name text
      this.add.text(room.centerX, room.y + 25, room.name, {
        fontSize: '20px',
        color: '#555577',
      }).setOrigin(0.5).setDepth(1);
    });

    // Grid lines
    this.mapGraphics.lineStyle(1, 0x222244, 0.2);
    for (let x = 0; x < this.mapWidth; x += 80) {
      this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += 80) {
      this.mapGraphics.lineBetween(0, y, this.mapWidth, y);
    }

    // Walls / obstacles
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

  // ── Player ───────────────────────────────────────────────────────────────

  private createPlayer() {
    // Start in first room center
    const startRoom = this.rooms[0];
    this.player = this.add.rectangle(startRoom.centerX, startRoom.centerY, 24, 24, 0x00ff00);
    this.player.setDepth(5);
  }

  // ── Secrets ──────────────────────────────────────────────────────────────

  private createSecrets() {
    const clues = [
      '一张泛黄的日记残页，写着"...午夜不要去地下..."',
      '一把生锈的钥匙，不知能打开什么',
      '一幅画背后藏着暗号：3-7-1',
      '书架上的禁书，封面刻着诡异符文',
      '壁炉里的烧焦信件，提到"祭坛"',
      '地板下的旧照片，画面模糊不清',
    ];

    // One secret per room (skip the starting room to give player a reason to explore)
    let secretIdx = 0;
    for (let i = 1; i < this.rooms.length; i++) {
      const room = this.rooms[i];
      let placed = false;
      let attempts = 0;
      while (!placed && attempts < 100) {
        const x = Phaser.Math.Between(room.x + 50, room.x + room.w - 50);
        const y = Phaser.Math.Between(room.y + 50, room.y + room.h - 50);
        if (!this.isInsideObstacle(x, y, 15)) {
          const container = this.add.container(x, y);
          container.setDepth(4);
          const gem = this.add.rectangle(0, 0, 16, 16, 0x00ffff);
          gem.setRotation(Math.PI / 4);
          const glow = this.add.circle(0, 0, 22, 0x00ffff, 0.2);
          container.add([glow, gem]);
          container.setVisible(false);

          this.secrets.push({
            x, y,
            roomName: room.name,
            clue: clues[secretIdx % clues.length],
            collected: false,
            detected: false,
            revealed: false,
            sprite: container,
          });
          secretIdx++;
          placed = true;
        }
        attempts++;
      }
    }

    this.totalSecrets = this.secrets.length;
  }

  // ── Traps ────────────────────────────────────────────────────────────────

  private createTraps() {
    const trapTypes: TrapType[] = ['teleport', 'slow', 'poison', 'confusion', 'darkness'];

    // Place 1-2 traps per room
    for (let i = 0; i < this.rooms.length; i++) {
      const room = this.rooms[i];
      const trapCount = i === 0 ? 0 : Phaser.Math.Between(2, 3); // no traps in start room
      for (let t = 0; t < trapCount; t++) {
        let placed = false;
        let attempts = 0;
        while (!placed && attempts < 100) {
          const x = Phaser.Math.Between(room.x + 50, room.x + room.w - 50);
          const y = Phaser.Math.Between(room.y + 50, room.y + room.h - 50);
          if (!this.isInsideObstacle(x, y, 15)) {
            // Don't overlap with secrets
            const tooCloseToSecret = this.secrets.some(s => Phaser.Math.Distance.Between(x, y, s.x, s.y) < 60);
            if (tooCloseToSecret) { attempts++; continue; }

            const type = trapTypes[Phaser.Math.Between(0, trapTypes.length - 1)];
            const container = this.add.container(x, y);
            container.setDepth(3);
            const plate = this.add.circle(0, 0, 18, 0x884400, 0.5);
            const ring = this.add.circle(0, 0, 18, 0xff6600, 0.3);
            ring.setStrokeStyle(2, 0xff6600, 0.5);
            container.add([plate, ring]);
            container.setVisible(false);

            this.traps.push({
              x, y, type,
              triggered: false,
              detected: false,
              disarmed: false,
              sprite: container,
            });
            placed = true;
          }
          attempts++;
        }
      }
    }
  }

  // ── Wandering Ghosts (pre-spawned at game start) ─────────────────────────

  private createWanderingGhosts() {
    // Spawn 4-5 wandering ghosts in non-start rooms
    const count = Phaser.Math.Between(4, 5);
    let placed = 0;
    let attempts = 0;

    while (placed < count && attempts < 300) {
      // Pick a random non-start room
      const room = this.rooms[Phaser.Math.Between(1, this.rooms.length - 1)];
      const x = Phaser.Math.Between(room.x + 60, room.x + room.w - 60);
      const y = Phaser.Math.Between(room.y + 60, room.y + room.h - 60);

      // Don't spawn too close to player start
      const distToPlayer = Phaser.Math.Distance.Between(x, y, this.rooms[0].centerX, this.rooms[0].centerY);
      if (distToPlayer < 300) { attempts++; continue; }

      if (!this.isInsideObstacle(x, y, 15)) {
        this.spawnGhost(x, y);
        placed++;
      }
      attempts++;
    }
  }

  // ── Ghosts ───────────────────────────────────────────────────────────────

  private spawnGhost(x: number, y: number, forceChase: boolean = false) {
    const container = this.add.container(x, y);
    container.setDepth(6);

    const body = this.add.circle(0, 0, 14, 0xffffff, 0.7);
    const eyes = this.add.rectangle(0, -2, 10, 4, 0xff0000);
    const wisp = this.add.circle(0, 0, 20, 0xffffff, 0.15);
    container.add([wisp, body, eyes]);

    // Floating animation — applied to body/eyes, NOT the container,
    // so it doesn't conflict with ghost y-movement in updateGhosts
    this.tweens.add({
      targets: [body, eyes],
      y: '+=6',
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    // Spawn effect for trap-spawned ghosts
    if (forceChase) {
      container.setScale(0);
      this.tweens.add({
        targets: container,
        scale: { from: 0, to: 1 },
        duration: 400,
        ease: 'Back.easeOut',
      });
    }

    this.ghosts.push({
      sprite: container,
      body,
      speed: 30,
      chaseSpeed: 100,
      direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
      isChasing: forceChase,
      giveUpTimer: forceChase ? 5000 : 0,
      giveUpDuration: 3000,
      homeX: x,
      homeY: y,
      territoryRadius: 9999,
      visionRange: 250,
      patrolTimer: 0,
      alive: true,
    });
  }

  // ── Fog of War ───────────────────────────────────────────────────────────

  private createFog() {
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.screenW;
    this.fogCanvas.height = this.screenH;
    this.fogCtx = this.fogCanvas.getContext('2d')!;

    this.textures.addCanvas(this.fogTextureKey, this.fogCanvas);

    this.fogImage = this.add.image(0, 0, this.fogTextureKey);
    this.fogImage.setOrigin(0, 0);
    this.fogImage.setScrollFactor(0);
    this.fogImage.setDepth(10);

    this.drawFog(this.screenW / 2, this.screenH / 2);
  }

  private drawFog(screenX: number, screenY: number) {
    const ctx = this.fogCtx;
    const radius = this.darknessTimer > 0 ? this.viewRadius * 0.5 : this.viewRadius;

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

    // Manually upload canvas to WebGL texture (Phaser 3.90 bug workaround)
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

  // ── UI ───────────────────────────────────────────────────────────────────

  private createUI() {
    this.healthText = this.add.text(16, 16, '生命: 100', {
      fontSize: '18px', color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.secretText = this.add.text(16, 40, `线索: 0/${this.totalSecrets}`, {
      fontSize: '18px', color: '#00ffff',
    }).setScrollFactor(0).setDepth(20);

    this.scannerText = this.add.text(16, 64, '扫描器: 就绪 [空格扫描] | [E显形/解除]', {
      fontSize: '16px', color: '#88ff88',
    }).setScrollFactor(0).setDepth(20);

    this.debuffText = this.add.text(16, 88, '', {
      fontSize: '16px', color: '#ff4444',
    }).setScrollFactor(0).setDepth(20);

    this.staminaText = this.add.text(16, 112, '体力: 100 [Shift冲刺]', {
      fontSize: '16px', color: '#88ff88',
    }).setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 500, '', {
      fontSize: '22px', color: '#ffffff', align: 'center',
      backgroundColor: '#000000', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);

    const backBtn = this.add.text(680, 16, '← 菜单', {
      fontSize: '18px', color: '#ffffff', backgroundColor: '#333333',
      padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);

    backBtn.on('pointerdown', () => this.scene.start('MenuScene'));
  }

  // ── Input ────────────────────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
  }

  // ── Update Loop ──────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.isDead || this.isWon) return;

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    this.handlePlayerMovement(delta);
    this.handleScanner();
    this.handleReveal();
    this.updateTraps();
    this.updateGhosts(delta);
    this.updateBossGhost(delta);
    this.checkCollisions();
    this.updateDebuffs(delta);
    this.updateFog();
    this.checkExit();
    this.checkWin();

    if (this.damageCooldown > 0) this.damageCooldown -= delta;
    if (this.scannerCooldown > 0) this.scannerCooldown -= delta;
    if (this.darknessTimer > 0) this.darknessTimer -= delta;
  }

  // ── Player Movement ──────────────────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    const baseSpeed = 160;
    const sprintSpeed = 280;
    const dt = delta / 1000;

    // Debuff: slow
    let speedMul = 1;
    if (this.hasDebuff('slow')) speedMul = 0.45;

    // Sprint logic
    const wantsSprint = this.shiftKey.isDown && !this.staminaDepleted;
    const isMoving = this.cursors.left.isDown || this.cursors.right.isDown ||
                     this.cursors.up.isDown || this.cursors.down.isDown;
    const isSprinting = wantsSprint && isMoving && this.stamina > 0;
    if (isSprinting) {
      this.stamina -= 35 * dt;
      if (this.stamina <= 0) { this.stamina = 0; this.staminaDepleted = true; }
    } else {
      this.stamina += 18 * dt;
      if (this.stamina >= this.maxStamina) this.stamina = this.maxStamina;
      if (this.staminaDepleted && this.stamina >= this.maxStamina * 0.3) this.staminaDepleted = false;
    }
    this.staminaText.setText(
      `体力: ${Math.ceil(this.stamina)}/${this.maxStamina}` +
      (this.staminaDepleted ? ' (恢复中...)' : ' [Shift冲刺]')
    );
    this.staminaText.setColor(this.staminaDepleted ? '#ff8888' : (isSprinting ? '#ffff88' : '#88ff88'));

    let speed = (isSprinting ? sprintSpeed : baseSpeed) * speedMul;

    let vx = 0, vy = 0;
    if (this.cursors.left.isDown) vx -= speed;
    if (this.cursors.right.isDown) vx += speed;
    if (this.cursors.up.isDown) vy -= speed;
    if (this.cursors.down.isDown) vy += speed;

    // Debuff: confusion — invert controls
    if (this.hasDebuff('confusion')) { vx = -vx; vy = -vy; }

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
      if (!this.isObstacleAt(edgeX, this.player.y - halfSize, halfSize) &&
          !this.isObstacleAt(edgeX, this.player.y + halfSize, halfSize)) {
        this.player.x = newX;
      }
    }
    if (vy !== 0) {
      const dy = vy * dt;
      const newY = this.player.y + dy;
      const edgeY = newY + (dy > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(this.player.x - halfSize, edgeY, halfSize) &&
          !this.isObstacleAt(this.player.x + halfSize, edgeY, halfSize)) {
        this.player.y = newY;
      }
    }
  }

  // ── Scanner ──────────────────────────────────────────────────────────────

  private handleScanner() {
    if (this.scannerCooldown > 0) return;

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.scannerCooldown = 800;

      let nearestSecretDist = Infinity;
      let nearestTrapDist = Infinity;

      for (const s of this.secrets) {
        if (s.collected) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
        if (d < nearestSecretDist) nearestSecretDist = d;
        if (d < this.scannerRange * 2.5) s.detected = true;
      }
      for (const t of this.traps) {
        if (t.triggered || t.disarmed) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, t.x, t.y);
        if (d < nearestTrapDist) nearestTrapDist = d;
        if (d < this.scannerRange * 2.5) t.detected = true;
      }

      // Report
      const minDist = Math.min(nearestSecretDist, nearestTrapDist);
      if (minDist < this.scannerRange) {
        this.scannerText.setText('扫描器: ⚡ 发现异常！按 [E] 显形/解除');
        this.scannerText.setColor('#ff0000');
      } else if (minDist < this.scannerRange * 2.5) {
        this.scannerText.setText('扫描器: 微弱信号...');
        this.scannerText.setColor('#ffff00');
      } else {
        this.scannerText.setText('扫描器: 附近无异常');
        this.scannerText.setColor('#88ff88');
      }

      this.time.delayedCall(1500, () => {
        if (!this.isDead && !this.isWon) {
          this.scannerText.setText('扫描器: 就绪 [空格扫描] | [E显形/解除]');
          this.scannerText.setColor('#88ff88');
        }
      });
    }
  }

  // ── Reveal / Disarm ──────────────────────────────────────────────────────

  private handleReveal() {
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      let didSomething = false;

      // Reveal secrets
      for (const s of this.secrets) {
        if (s.collected || s.revealed) continue;
        if (!s.detected) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
        if (d < this.scannerRange * 2.5) {
          s.revealed = true;
          s.sprite.setVisible(true);
          this.tweens.add({
            targets: s.sprite, scale: { from: 0.8, to: 1.3 },
            duration: 600, yoyo: true, repeat: -1, ease: 'Sine.inOut',
          });
          didSomething = true;
        }
      }

      // Disarm traps (must be close)
      for (const t of this.traps) {
        if (t.triggered || t.disarmed) continue;
        if (!t.detected) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, t.x, t.y);
        if (d < this.scannerRange) {
          t.disarmed = true;
          t.sprite.setVisible(true);
          // Show disarmed visual
          this.tweens.add({
            targets: t.sprite, alpha: { from: 0.8, to: 0.2 },
            duration: 400, yoyo: true, repeat: 2,
            onComplete: () => t.sprite.setVisible(false),
          });
          didSomething = true;
        }
      }

      if (didSomething) {
        this.showMessage('已显形/解除！靠近拾取线索');
        this.time.delayedCall(1200, () => this.hideMessage());
      }
    }
  }

  // ── Traps ────────────────────────────────────────────────────────────────

  private updateTraps() {
    for (const t of this.traps) {
      if (t.triggered || t.disarmed) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, t.x, t.y);
      if (d < 35) {
        t.triggered = true;
        this.triggerTrap(t);
      }
    }
  }

  private triggerTrap(t: Trap) {
    // Spawn 1-3 ghosts at trap location — immediately chasing the player
    const ghostCount = Phaser.Math.Between(1, 3);
    for (let i = 0; i < ghostCount; i++) {
      // Find a valid spawn position near the trap (not inside a wall)
      let gx = t.x;
      let gy = t.y;
      for (let attempt = 0; attempt < 20; attempt++) {
        const ox = t.x + Phaser.Math.Between(-30, 30);
        const oy = t.y + Phaser.Math.Between(-30, 30);
        if (!this.isInsideObstacle(ox, oy, 15)) {
          gx = ox;
          gy = oy;
          break;
        }
      }
      this.spawnGhost(gx, gy, true); // forceChase = true
    }

    const trapNames: Record<TrapType, string> = {
      teleport: '传送陷阱',
      slow: '减速陷阱',
      poison: '毒咒陷阱',
      confusion: '混乱陷阱',
      darkness: '黑暗陷阱',
    };
    this.showMessage(`⚠ 触发${trapNames[t.type]}！\n鬼魂出现了！`);
    this.time.delayedCall(2000, () => this.hideMessage());
  }

  // ── Ghosts ───────────────────────────────────────────────────────────────

  private updateGhosts(delta: number) {
    const dt = delta / 1000;

    for (const ghost of this.ghosts) {
      if (!ghost.alive) continue;

      const distToPlayer = Phaser.Math.Distance.Between(
        ghost.sprite.x, ghost.sprite.y, this.player.x, this.player.y
      );

      // Vision: can see player within range and line of sight
      const canSee = distToPlayer < ghost.visionRange &&
        !this.lineBlockedByObstacle(ghost.sprite.x, ghost.sprite.y, this.player.x, this.player.y);

      if (canSee) {
        ghost.isChasing = true;
        ghost.giveUpTimer = ghost.giveUpDuration;
      } else if (ghost.giveUpTimer > 0) {
        ghost.giveUpTimer -= delta;
        if (ghost.giveUpTimer <= 0) ghost.isChasing = false;
      }

      if (ghost.isChasing) {
        const dir = new Phaser.Math.Vector2(
          this.player.x - ghost.sprite.x,
          this.player.y - ghost.sprite.y
        ).normalize();
        const newX = ghost.sprite.x + dir.x * ghost.chaseSpeed * dt;
        const newY = ghost.sprite.y + dir.y * ghost.chaseSpeed * dt;
        if (!this.isObstacleAt(newX, ghost.sprite.y, 11)) ghost.sprite.x = newX;
        if (!this.isObstacleAt(ghost.sprite.x, newY, 11)) ghost.sprite.y = newY;
      } else {
        // Wander
        ghost.patrolTimer += delta;
        if (ghost.patrolTimer > 2000) {
          ghost.patrolTimer = 0;
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          ghost.direction.set(Math.cos(angle), Math.sin(angle));
        }
        const newX = ghost.sprite.x + ghost.direction.x * ghost.speed * dt;
        const newY = ghost.sprite.y + ghost.direction.y * ghost.speed * dt;
        if (!this.isObstacleAt(newX, ghost.sprite.y, 11)) ghost.sprite.x = newX;
        else ghost.direction.x *= -1;
        if (!this.isObstacleAt(ghost.sprite.x, newY, 11)) ghost.sprite.y = newY;
        else ghost.direction.y *= -1;
      }
    }
  }

  // ── Collisions ───────────────────────────────────────────────────────────

  private checkCollisions() {
    // Secrets
    for (const s of this.secrets) {
      if (s.collected) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
      if (d < 28) {
        if (s.revealed) {
          s.collected = true;
          s.sprite.setVisible(false);
          this.tweens.killTweensOf(s.sprite);
          const found = this.secrets.filter(x => x.collected).length;
          this.secretText.setText(`线索: ${found}/${this.totalSecrets}`);
          this.showMessage(`发现线索！\n${s.clue}`);
          this.time.delayedCall(3000, () => this.hideMessage());
        } else if (s.detected) {
          this.showMessage('先按 [E] 显形线索！');
          this.time.delayedCall(1200, () => this.hideMessage());
        } else {
          this.showMessage('先用扫描器 [空格] 探测！');
          this.time.delayedCall(1200, () => this.hideMessage());
        }
      }
    }

    // Ghosts
    if (this.damageCooldown <= 0) {
      for (const ghost of this.ghosts) {
        if (!ghost.alive) continue;
        const d = Phaser.Math.Distance.Between(
          this.player.x, this.player.y, ghost.sprite.x, ghost.sprite.y
        );
        if (d < 26) {
          this.onGhostCatch();
          break;
        }
      }
    }

    // Boss ghost — instant death on contact
    if (this.bossGhost && this.bossGhost.alive) {
      const bd = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        this.bossGhost.sprite.x, this.bossGhost.sprite.y
      );
      if (bd < 38) {
        this.die('大鬼魂吞噬了你！');
        return;
      }
    }
  }

  // ── Ghost Catch → Debuff ─────────────────────────────────────────────────

  private onGhostCatch() {
    this.damageCooldown = 1500;
    // Pick a random debuff from active traps' types, or default
    const debuffTypes: DebuffType[] = ['slow', 'poison', 'confusion', 'darkness'];
    const debuff = debuffTypes[Phaser.Math.Between(0, debuffTypes.length - 1)];

    // Also teleport sometimes
    const doTeleport = Math.random() < 0.3;

    // Knockback
    const nearestGhost = this.ghosts.filter(g => g.alive)
      .reduce((closest, g) => {
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, g.sprite.x, g.sprite.y);
        return d < closest.dist ? { ghost: g, dist: d } : closest;
      }, { ghost: null as Ghost | null, dist: Infinity });

    if (doTeleport) {
      // Teleport to a random room center
      const targetRoom = this.rooms[Phaser.Math.Between(0, this.rooms.length - 1)];
      this.player.x = targetRoom.centerX;
      this.player.y = targetRoom.centerY;
      this.showMessage('👻 鬼魂抓住了你！\n你被传送到了未知房间！');
    } else {
      // Apply debuff
      const durations: Record<DebuffType, number> = {
        slow: 8000,
        poison: 6000,
        confusion: 5000,
        darkness: 8000,
      };
      // Remove existing same-type debuff, then add
      this.debuffs = this.debuffs.filter(d => d.type !== debuff);
      this.debuffs.push({ type: debuff, remaining: durations[debuff] });

      if (debuff === 'darkness') this.darknessTimer = durations[debuff];

      const names: Record<DebuffType, string> = {
        slow: '减速',
        poison: '持续掉血',
        confusion: '混乱（方向反转）',
        darkness: '视野缩小',
      };
      this.showMessage(`👻 鬼魂抓住了你！\n负面效果: ${names[debuff]}`);

      // Knockback
      if (nearestGhost.ghost) {
        const kx = this.player.x - nearestGhost.ghost.sprite.x;
        const ky = this.player.y - nearestGhost.ghost.sprite.y;
        const klen = Math.sqrt(kx * kx + ky * ky) || 1;
        this.player.x += (kx / klen) * 25;
        this.player.y += (ky / klen) * 25;
      }
    }

    this.time.delayedCall(2000, () => this.hideMessage());
  }

  // ── Debuffs ──────────────────────────────────────────────────────────────

  private hasDebuff(type: DebuffType): boolean {
    return this.debuffs.some(d => d.type === type);
  }

  private updateDebuffs(delta: number) {
    // Tick poison
    if (this.hasDebuff('poison')) {
      this.health -= 5 * (delta / 1000);
      if (this.health <= 0) { this.health = 0; this.die('中毒身亡'); }
    }

    // Update timers
    this.debuffs = this.debuffs.filter(d => {
      d.remaining -= delta;
      return d.remaining > 0;
    });

    // Update debuff UI
    if (this.debuffs.length > 0) {
      const labels: Record<DebuffType, string> = {
        slow: '🐌减速',
        poison: '☠中毒',
        confusion: '😵混乱',
        darkness: '🌙黑暗',
      };
      const text = '负面: ' + this.debuffs.map(d => `${labels[d.type]} ${Math.ceil(d.remaining / 1000)}s`).join(' | ');
      this.debuffText.setText(text);
    } else {
      this.debuffText.setText('');
    }

    this.healthText.setText(`生命: ${Math.ceil(this.health)}`);
  }

  // ── Win / Lose ───────────────────────────────────────────────────────────

  private checkWin() {
    if (this.isEscaping || this.isWon) return;
    const found = this.secrets.filter(s => s.collected).length;
    if (found >= this.totalSecrets) {
      this.startEscape();
    }
  }

  /**
   * All clues collected → spawn boss ghost, open exit, player must escape.
   */
  private startEscape() {
    this.isEscaping = true;
    this.secretText.setText('线索: 全部收集！快撤离！');
    this.secretText.setColor('#ff4444');

    // Create exit at starting room (room 0)
    this.createExit();

    // Spawn boss ghost at the room farthest from the player
    let farthestRoom = this.rooms[0];
    let maxDist = 0;
    for (const room of this.rooms) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, room.centerX, room.centerY);
      if (d > maxDist) { maxDist = d; farthestRoom = room; }
    }
    this.spawnBossGhost(farthestRoom.centerX, farthestRoom.centerY);

    // Dramatic effects
    this.cam.flash(500, 255, 0, 0);
    this.cam.shake(400, 0.012);

    this.showMessage('⚠ 所有线索已收集！\n大鬼魂出现了！\n逃向大厅出口（绿色光门）！');
    this.time.delayedCall(3000, () => { if (this.isEscaping) this.hideMessage(); });
  }

  private createExit() {
    const startRoom = this.rooms[0];
    const container = this.add.container(startRoom.centerX, startRoom.centerY);
    container.setDepth(4);

    const door = this.add.rectangle(0, 0, 50, 50, 0x00ff00, 0.3);
    const glow = this.add.circle(0, 0, 35, 0x00ff00, 0.2);
    const ring = this.add.circle(0, 0, 30, 0x00ff00, 0.5);
    ring.setStrokeStyle(3, 0x00ff00, 0.8);
    container.add([glow, door, ring]);

    this.tweens.add({
      targets: container,
      scale: { from: 0.9, to: 1.15 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    this.exit = container;
  }

  private spawnBossGhost(x: number, y: number) {
    const container = this.add.container(x, y);
    container.setDepth(7);

    const body = this.add.circle(0, 0, 30, 0x440044, 0.85);
    const aura = this.add.circle(0, 0, 45, 0x880000, 0.2);
    const eyes = this.add.rectangle(0, -4, 16, 6, 0xff0000);
    const mouth = this.add.rectangle(0, 10, 12, 4, 0xff0000);
    container.add([aura, body, eyes, mouth]);

    // Pulsing aura
    this.tweens.add({
      targets: aura,
      scale: { from: 0.8, to: 1.3 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    // Floating
    this.tweens.add({
      targets: container,
      y: '+=10',
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    this.bossGhost = {
      sprite: container,
      body,
      speed: 0,
      chaseSpeed: 145,
      direction: new Phaser.Math.Vector2(0, 0),
      isChasing: true,
      giveUpTimer: 0,
      giveUpDuration: 999999,
      homeX: x,
      homeY: y,
      territoryRadius: 9999,
      visionRange: 9999,
      patrolTimer: 0,
      alive: true,
    };
  }

  /**
   * Boss ghost always moves toward the player and phases through walls.
   * Contact = instant death.
   */
  private updateBossGhost(delta: number) {
    if (!this.bossGhost || !this.bossGhost.alive) return;
    const dt = delta / 1000;

    const dir = new Phaser.Math.Vector2(
      this.player.x - this.bossGhost.sprite.x,
      this.player.y - this.bossGhost.sprite.y
    );
    const dist = dir.length();
    if (dist > 1) {
      dir.normalize();
      this.bossGhost.sprite.x += dir.x * this.bossGhost.chaseSpeed * dt;
      this.bossGhost.sprite.y += dir.y * this.bossGhost.chaseSpeed * dt;
    }
  }

  private checkExit() {
    if (!this.isEscaping || !this.exit) return;

    const d = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.exit.x, this.exit.y
    );

    // Update UI with distance to exit
    this.secretText.setText(`撤离中！距出口: ${Math.ceil(d)}px`);

    if (d < 35) {
      this.escape();
    }
  }

  private escape() {
    this.isWon = true;
    this.isEscaping = false;
    if (this.bossGhost) {
      this.bossGhost.alive = false;
      this.bossGhost.sprite.setVisible(false);
    }
    this.secretText.setText('线索: 全部收集 ✓ 已撤离！');
    this.secretText.setColor('#00ff00');
    this.showMessage('🎉 成功逃脱！\n你带着所有秘密活了下来！\n\n按ESC返回菜单');
  }

  private die(cause?: string) {
    this.isDead = true;
    this.player.setFillStyle(0x666666);
    this.showMessage(cause ? `💀 ${cause}\n\n按ESC返回菜单` : '💀 你死了...\n\n按ESC返回菜单');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private showMessage(text: string) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
  }

  private hideMessage() {
    this.messageText.setVisible(false);
  }

  private isObstacleAt(px: number, py: number, _halfSize: number): boolean {
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
}
