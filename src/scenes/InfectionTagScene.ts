import Phaser from 'phaser';
import { Client, Room } from 'colyseus.js';

interface PlayerSprite {
  sprite: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Rectangle;
  nameText: Phaser.GameObjects.Text;
  smokeParticles?: Phaser.GameObjects.Particles.ParticleEmitter;
  glowCircle?: Phaser.GameObjects.Arc;
  targetX: number;
  targetY: number;
  targetRotation: number;
  infected: boolean;
}

export class InfectionTagScene extends Phaser.Scene {
  private client!: Client;
  private room!: Room;
  private playerSprites: Map<string, PlayerSprite> = new Map();
  private mySessionId = '';
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private moveSpeed = 200;
  private obstacles: Phaser.GameObjects.Rectangle[] = [];
  private connectionStatus!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private phaseText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private restartBtn!: Phaser.GameObjects.Text;
  private readyBtn!: Phaser.GameObjects.Text;
  private readyCountText!: Phaser.GameObjects.Text;
  private mouseX = 0;
  private mouseY = 0;

  // Fog of war
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogImage!: Phaser.GameObjects.Image;
  private isZeroPatient = false;

  constructor() {
    super({ key: 'InfectionTagScene' });
  }

  async create() {
    // Reset all state
    this.playerSprites.clear();
    this.obstacles = [];
    this.mySessionId = '';
    this.isZeroPatient = false;

    // Create arena background (dark)
    this.add.rectangle(800, 600, 1600, 1200, 0x0a0a14);

    // Create obstacles
    const OBSTACLES = [
      { x: 720, y: 400, w: 160, h: 40 },
      { x: 780, y: 340, w: 40, h: 160 },
      { x: 200, y: 200, w: 120, h: 120 },
      { x: 1280, y: 200, w: 120, h: 120 },
      { x: 200, y: 880, w: 120, h: 120 },
      { x: 1280, y: 880, w: 120, h: 120 },
      { x: 500, y: 560, w: 40, h: 200 },
      { x: 1060, y: 440, w: 40, h: 200 },
      { x: 400, y: 700, w: 80, h: 40 },
      { x: 1120, y: 460, w: 80, h: 40 },
    ];

    OBSTACLES.forEach((obs) => {
      const rect = this.add.rectangle(obs.x + obs.w / 2, obs.y + obs.h / 2, obs.w, obs.h, 0x2a2a3e);
      this.obstacles.push(rect);
    });

    // Camera setup
    this.cameras.main.setBounds(0, 0, 1600, 1200);
    this.cameras.main.setZoom(1.0);

    // UI
    this.add.text(10, 52, '传染抓人', {
      fontSize: '20px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(30);

    this.connectionStatus = this.add.text(10, 10, 'Connecting...', {
      fontSize: '16px',
      color: '#ffff00',
    }).setScrollFactor(0).setDepth(30);

    this.timerText = this.add.text(10, 30, 'Time: --', {
      fontSize: '18px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(30);

    this.scoreText = this.add.text(10, 75, 'Score: 0', {
      fontSize: '16px',
      color: '#ffdd44',
    }).setScrollFactor(0).setDepth(30);

    this.restartBtn = this.add.text(400, 400, '再来一局', {
      fontSize: '24px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setInteractive({ useHandCursor: true }).setVisible(false);

    this.restartBtn.on('pointerdown', () => {
      if (this.room) {
        this.room.send('restart');
      }
    });

    // Ready button (shown during waiting phase)
    this.readyBtn = this.add.text(400, 400, '准备', {
      fontSize: '24px',
      color: '#ffffff',
      backgroundColor: '#226622',
      padding: { x: 30, y: 12 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setInteractive({ useHandCursor: true }).setVisible(false);

    this.readyBtn.on('pointerdown', () => {
      if (this.room) {
        this.room.send('ready');
      }
    });

    this.readyCountText = this.add.text(400, 350, '', {
      fontSize: '18px',
      color: '#aaaaaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30);

    this.phaseText = this.add.text(400, 300, '', {
      fontSize: '32px',
      color: '#ffff00',
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30);

    this.add.text(10, 95, 'WASD移动，黑暗中只有手电筒照明\n碰到感染者会被传染！活过2分钟即胜利。', {
      fontSize: '14px',
      color: '#aaaaaa',
      wordWrap: { width: 340 },
    }).setScrollFactor(0).setDepth(30);

    // Back button
    const backBtn = this.add.text(700, 10, '← Back to Menu', {
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 10, y: 5 },
    }).setScrollFactor(0).setDepth(30).setInteractive({ useHandCursor: true });

    backBtn.on('pointerdown', () => {
      if (this.room) {
        this.room.leave();
      }
      this.scene.start('MenuScene');
    });

    // Input setup
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };

    // Mouse tracking for rotation
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.mouseX = pointer.worldX;
      this.mouseY = pointer.worldY;
    });

    // Setup fog of war
    this.setupFog();

    await this.connectToServer();
  }

  private setupFog() {
    // Create fog canvas (screen-sized)
    if (this.textures.exists('fogTexture')) {
      this.textures.remove('fogTexture');
    }

    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = 800;
    this.fogCanvas.height = 600;
    this.fogCtx = this.fogCanvas.getContext('2d')!;

    this.textures.addCanvas('fogTexture', this.fogCanvas);
    this.fogImage = this.add.image(400, 300, 'fogTexture');
    this.fogImage.setScrollFactor(0);
    this.fogImage.setDepth(25);
  }

  private updateFog() {
    if (!this.fogCtx) return;

    const cam = this.cameras.main;
    const mySprite = this.playerSprites.get(this.mySessionId);

    // Fill with darkness
    this.fogCtx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    this.fogCtx.fillRect(0, 0, 800, 600);

    if (!mySprite) return;

    // Player screen position
    const px = mySprite.sprite.x - cam.scrollX;
    const py = mySprite.sprite.y - cam.scrollY;

    if (this.isZeroPatient) {
      // Zero patient: full map vision (no fog)
      this.fogCtx.clearRect(0, 0, 800, 600);
      return;
    }

    // Flashlight: cone in front of player
    const rotation = mySprite.sprite.rotation - Math.PI / 2;
    const coneLength = 250;
    const coneHalfAngle = Math.PI / 5; // 36 degrees half-angle

    // Use radial gradient for soft edge
    const gradient = this.fogCtx.createRadialGradient(px, py, 20, px, py, coneLength);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');

    this.fogCtx.save();
    this.fogCtx.globalCompositeOperation = 'destination-out';

    // Draw cone shape
    this.fogCtx.beginPath();
    this.fogCtx.moveTo(px, py);
    this.fogCtx.arc(px, py, coneLength, rotation - coneHalfAngle, rotation + coneHalfAngle);
    this.fogCtx.closePath();
    this.fogCtx.fillStyle = gradient;
    this.fogCtx.fill();

    // Small circle around player (immediate surroundings)
    const smallGradient = this.fogCtx.createRadialGradient(px, py, 0, px, py, 60);
    smallGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    smallGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
    this.fogCtx.beginPath();
    this.fogCtx.arc(px, py, 60, 0, Math.PI * 2);
    this.fogCtx.fillStyle = smallGradient;
    this.fogCtx.fill();

    this.fogCtx.restore();

    // Manual WebGL texture upload (Phaser 3.90 bug workaround)
    const gl = (this.game.renderer as any).gl;
    if (gl) {
      const source = this.fogImage.texture.source[0];
      const glTexture = source.glTexture;
      if (glTexture) {
        gl.bindTexture(gl.TEXTURE_2D, glTexture.webGLTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fogCanvas);
      }
    }
  }

  private async connectToServer() {
    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';
      this.client = new Client(serverUrl);
      this.connectionStatus.setText('Joining room...');

      this.room = await this.client.joinOrCreate('infectiontag');
      this.mySessionId = this.room.sessionId;

      this.connectionStatus.setText(`Connected! ID: ${this.mySessionId.slice(0, 8)}`);
      this.connectionStatus.setColor('#00ff00');

      // Listen for player additions
      this.room.state.players.onAdd((player: any, sessionId: string) => {
        this.createPlayerSprite(sessionId, player);
        this.observePlayer(sessionId, player);
      });

      // Listen for player removals
      this.room.state.players.onRemove((_player: any, sessionId: string) => {
        this.removePlayerSprite(sessionId);
      });

      // Initialize existing players
      this.room.state.players.forEach((player: any, sessionId: string) => {
        this.createPlayerSprite(sessionId, player);
        this.observePlayer(sessionId, player);
      });

      // Listen for game state changes
      this.room.state.listen('phase', (currentValue: string) => {
        if (currentValue === 'active') {
          this.phaseText.setText('游戏开始！');
          this.restartBtn.setVisible(false);
          this.readyBtn.setVisible(false);
          this.readyCountText.setVisible(false);
          this.time.delayedCall(2000, () => this.phaseText.setText(''));
        } else if (currentValue === 'ended') {
          this.phaseText.setText('游戏结束！');
          this.restartBtn.setVisible(true);
          this.readyBtn.setVisible(false);
          this.readyCountText.setVisible(false);
        } else if (currentValue === 'waiting') {
          this.phaseText.setText('等待玩家准备...');
          this.restartBtn.setVisible(false);
          this.readyBtn.setVisible(true);
          this.readyCountText.setVisible(true);
          this.isZeroPatient = false;
          this.resetAllPlayerSprites();
          this.updateReadyUI();
        }
      });

      // Listen for timer updates
      this.room.state.listen('timeRemaining', (value: number) => {
        const minutes = Math.floor(value / 60);
        const seconds = value % 60;
        this.timerText.setText(`Time: ${minutes}:${seconds.toString().padStart(2, '0')}`);
      });

      // Listen for infection events
      this.room.onMessage('infected', (message: any) => {
        console.log(`[InfectionTag] ${message.infectorId} infected ${message.infectedId}`);

        const infectedSprite = this.playerSprites.get(message.infectedId);
        if (infectedSprite) {
          this.tweens.add({
            targets: infectedSprite.body,
            alpha: 0.3,
            duration: 100,
            yoyo: true,
            repeat: 3,
          });
        }
      });

      // Listen for game end
      this.room.onMessage('gameEnded', (message: any) => {
        console.log('[InfectionTag] Game ended', message);

        const myResult = message.players.find((p: any) => p.id === this.mySessionId);
        if (myResult) {
          const status = myResult.survived ? '🎉 你存活了！' : '💀 你被感染了';
          const role = myResult.isZeroPatient ? ' (零号病人)' : '';
          this.phaseText.setText(`游戏结束！\n${status}${role}\n得分: ${myResult.score}`);
        }
      });

      this.room.onLeave((code) => {
        if (code === 1) {
          // Kicked: game in progress
          this.connectionStatus.setText('游戏进行中，请等待下一局...');
          this.connectionStatus.setColor('#ff8800');
          this.phaseText.setText('游戏进行中\n请等待下一局');
          // Auto-retry joining after 3 seconds
          this.time.delayedCall(3000, () => {
            this.connectToServer();
          });
        } else {
          this.connectionStatus.setText(`Disconnected (code: ${code})`);
          this.connectionStatus.setColor('#ff0000');
        }
      });
    } catch (error) {
      console.error('[InfectionTagScene] connect:error', error);
      this.connectionStatus.setText('Connection failed! Check server.');
      this.connectionStatus.setColor('#ff0000');
    }
  }

  private createPlayerSprite(sessionId: string, player: any) {
    const body = this.add.rectangle(0, 0, 30, 30, Phaser.Display.Color.HexStringToColor(player.color).color);
    const nameText = this.add.text(0, -25, sessionId.slice(0, 6), {
      fontSize: '12px',
      color: '#ffffff',
    }).setOrigin(0.5);

    const container = this.add.container(player.x, player.y, [body, nameText]);
    container.setDepth(15);

    const playerSprite: PlayerSprite = {
      sprite: container,
      body,
      nameText,
      targetX: player.x,
      targetY: player.y,
      targetRotation: player.rotation,
      infected: false,
    };

    this.playerSprites.set(sessionId, playerSprite);
  }

  private observePlayer(sessionId: string, player: any) {
    player.listen('x', (value: number) => {
      const sprite = this.playerSprites.get(sessionId);
      if (sprite) sprite.targetX = value;
    });

    player.listen('y', (value: number) => {
      const sprite = this.playerSprites.get(sessionId);
      if (sprite) sprite.targetY = value;
    });

    player.listen('rotation', (value: number) => {
      const sprite = this.playerSprites.get(sessionId);
      if (sprite) sprite.targetRotation = value;
    });

    player.listen('infected', (value: boolean) => {
      const sprite = this.playerSprites.get(sessionId);
      if (sprite && value) {
        sprite.infected = true;
        
        // Immediately turn body green
        sprite.body.setFillStyle(0x00ff00);
        
        // Add green glow circle around player
        const glow = this.add.circle(0, 0, 35, 0x00ff00, 0.3);
        glow.setDepth(-1);
        sprite.sprite.add(glow);
        sprite.glowCircle = glow;

        // Pulsing glow effect
        this.tweens.add({
          targets: glow,
          alpha: { from: 0.3, to: 0.6 },
          scale: { from: 1, to: 1.3 },
          duration: 800,
          yoyo: true,
          repeat: -1,
        });

        // Add smoke after 45 seconds (more obvious)
        const infectedAt = player.infectedAt;
        const now = Date.now();
        const timeSinceInfection = now - infectedAt;

        if (timeSinceInfection >= 45000) {
          this.addSmokeEffect(sessionId);
        } else {
          const delay = 45000 - timeSinceInfection;
          this.time.delayedCall(delay, () => {
            this.addSmokeEffect(sessionId);
          });
        }
      }
    });

    player.listen('isZeroPatient', (value: boolean) => {
      if (sessionId === this.mySessionId && value) {
        this.isZeroPatient = true;
        this.phaseText.setText('你是零号病人！\n你可以看到所有人！');
        this.time.delayedCall(3000, () => this.phaseText.setText(''));
      }
    });

    player.listen('score', (value: number) => {
      if (sessionId === this.mySessionId) {
        this.scoreText.setText(`Score: ${value}`);
      }
    });

    player.listen('ready', (value: boolean) => {
      this.updateReadyUI();
      // Update button text if it's my ready state
      if (sessionId === this.mySessionId) {
        this.readyBtn.setText(value ? '取消准备' : '准备');
        this.readyBtn.setBackgroundColor(value ? '#663333' : '#226622');
      }
    });
  }

  private addSmokeEffect(sessionId: string) {
    const sprite = this.playerSprites.get(sessionId);
    if (!sprite || sprite.smokeParticles) return;

    const particles = this.add.particles(0, 0, 'particle', {
      speed: { min: 20, max: 50 },
      angle: { min: 250, max: 290 },
      scale: { start: 0.3, end: 0 },
      lifespan: 1000,
      frequency: 200,
      alpha: { start: 0.6, end: 0 },
      tint: 0x44ff44,
    });

    sprite.sprite.add(particles);
    sprite.smokeParticles = particles;
  }

  private removePlayerSprite(sessionId: string) {
    const sprite = this.playerSprites.get(sessionId);
    if (sprite) {
      sprite.sprite.destroy();
      this.playerSprites.delete(sessionId);
    }
  }

  private updateReadyUI() {
    if (!this.room) return;
    let readyCount = 0;
    let totalCount = 0;
    this.room.state.players.forEach((player: any) => {
      totalCount++;
      if (player.ready) readyCount++;
    });
    this.readyCountText.setText(`${readyCount}/${totalCount} 已准备`);
  }

  private resetAllPlayerSprites() {
    this.playerSprites.forEach((sprite, sessionId) => {
      // Restore original color from server state
      const player = this.room.state.players.get(sessionId);
      if (player) {
        sprite.body.setFillStyle(Phaser.Display.Color.HexStringToColor(player.color).color);
      }
      sprite.infected = false;

      // Remove glow circle
      if (sprite.glowCircle) {
        sprite.glowCircle.destroy();
        sprite.glowCircle = undefined;
      }

      // Remove smoke particles
      if (sprite.smokeParticles) {
        sprite.smokeParticles.destroy();
        sprite.smokeParticles = undefined;
      }
    });
  }

  update(_time: number, delta: number) {
    if (!this.room || this.room.state.phase !== 'active') return;

    // Handle movement
    let vx = 0;
    let vy = 0;

    if (this.cursors.left?.isDown || this.wasdKeys.A.isDown) vx -= 1;
    if (this.cursors.right?.isDown || this.wasdKeys.D.isDown) vx += 1;
    if (this.cursors.up?.isDown || this.wasdKeys.W.isDown) vy -= 1;
    if (this.cursors.down?.isDown || this.wasdKeys.S.isDown) vy += 1;

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      vx *= 0.707;
      vy *= 0.707;
    }

    // Calculate rotation towards mouse
    const mySprite = this.playerSprites.get(this.mySessionId);
    if (mySprite) {
      const dx = this.mouseX - mySprite.sprite.x;
      const dy = this.mouseY - mySprite.sprite.y;
      const rotation = Math.atan2(dy, dx) + Math.PI / 2;

      // Send movement to server
      const newX = mySprite.sprite.x + vx * this.moveSpeed * (delta / 1000);
      const newY = mySprite.sprite.y + vy * this.moveSpeed * (delta / 1000);

      // Clamp to arena bounds
      const clampedX = Phaser.Math.Clamp(newX, 20, 1580);
      const clampedY = Phaser.Math.Clamp(newY, 20, 1180);

      // Update local position immediately (no interpolation for local player)
      mySprite.sprite.x = clampedX;
      mySprite.sprite.y = clampedY;
      mySprite.sprite.rotation = rotation;
      mySprite.targetX = clampedX;
      mySprite.targetY = clampedY;
      mySprite.targetRotation = rotation;

      this.room.send('move', {
        x: clampedX,
        y: clampedY,
        rotation: rotation,
      });
    }

    // Interpolate only remote players
    this.playerSprites.forEach((sprite, sessionId) => {
      if (sessionId === this.mySessionId) return; // skip local player
      sprite.sprite.x = Phaser.Math.Linear(sprite.sprite.x, sprite.targetX, 0.2);
      sprite.sprite.y = Phaser.Math.Linear(sprite.sprite.y, sprite.targetY, 0.2);
      sprite.sprite.rotation = Phaser.Math.Linear(sprite.sprite.rotation, sprite.targetRotation, 0.2);
    });

    // Update fog of war
    this.updateFog();

    // Follow my player with camera
    if (mySprite) {
      this.cameras.main.scrollX = mySprite.sprite.x - 400;
      this.cameras.main.scrollY = mySprite.sprite.y - 300;
    }
  }
}
