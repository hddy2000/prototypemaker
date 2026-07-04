import Phaser from 'phaser';
import { Client, Room } from 'colyseus.js';
import { ARENA, OBSTACLES } from '../shared/multiplayer-types';

interface PlayerSprite {
  sprite: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Rectangle;
  nameText: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  targetRotation: number;
}

export class MultiplayerScene extends Phaser.Scene {
  private client!: Client;
  private room!: Room;
  private playerSprites: Map<string, PlayerSprite> = new Map();
  private mySessionId: string = '';
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private moveSpeed = 200;
  private obstacles: Phaser.GameObjects.Rectangle[] = [];
  private connectionStatus!: Phaser.GameObjects.Text;
  private playerCountText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'MultiplayerScene' });
  }

  async create() {
    // Create arena background
    this.add.rectangle(
      ARENA.WIDTH / 2,
      ARENA.HEIGHT / 2,
      ARENA.WIDTH,
      ARENA.HEIGHT,
      0x1a1a2e
    );

    // Create obstacles
    OBSTACLES.forEach((obs) => {
      const rect = this.add.rectangle(
        obs.x + obs.w / 2,
        obs.y + obs.h / 2,
        obs.w,
        obs.h,
        0x4a4a6a
      );
      this.obstacles.push(rect);
    });

    // Set up camera
    this.cameras.main.setBounds(0, 0, ARENA.WIDTH, ARENA.HEIGHT);
    this.cameras.main.setZoom(0.8);

    // Connection status
    this.connectionStatus = this.add.text(10, 10, 'Connecting...', {
      fontSize: '16px',
      color: '#ffff00',
    }).setScrollFactor(0).setDepth(10);

    this.playerCountText = this.add.text(10, 30, 'Players: 0', {
      fontSize: '14px',
      color: '#aaaaaa',
    }).setScrollFactor(0).setDepth(10);

    // Back button
    const backBtn = this.add.text(700, 10, '← Back to Menu', {
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 10, y: 5 },
    }).setScrollFactor(0).setDepth(10).setInteractive({ useHandCursor: true });

    backBtn.on('pointerdown', () => {
      if (this.room) {
        this.room.leave();
      }
      this.scene.start('MenuScene');
    });

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys();

    // Connect to server
    await this.connectToServer();
  }

  private async connectToServer() {
    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';
      console.log('[MultiplayerScene] connect:start', { serverUrl });
      this.client = new Client(serverUrl);
      
      this.connectionStatus.setText('Joining room...');
      
      this.room = await this.client.joinOrCreate('game');
      this.mySessionId = this.room.sessionId;
      console.log('[MultiplayerScene] connect:joined', {
        roomId: this.room.roomId,
        sessionId: this.mySessionId,
      });
      
      this.connectionStatus.setText(`Connected! ID: ${this.mySessionId.slice(0, 8)}`);
      this.connectionStatus.setColor('#00ff00');

      // Handle player additions
      this.room.state.players.onAdd((player: any, sessionId: string) => {
        console.log('[MultiplayerScene] state:onAdd', {
          sessionId,
          x: player.x,
          y: player.y,
          color: player.color,
        });
        this.ensurePlayerSprite(sessionId, player);
        
        // Listen for position changes
        player.onChange(() => {
          const sprite = this.playerSprites.get(sessionId);
          if (sprite) {
            sprite.targetX = player.x;
            sprite.targetY = player.y;
            sprite.targetRotation = player.rotation;
          }
        });
      });

      // Handle player removals
      this.room.state.players.onRemove((_player: any, sessionId: string) => {
        console.log('[MultiplayerScene] state:onRemove', { sessionId });
        this.removePlayerSprite(sessionId);
      });

      // Colyseus may already have existing players in state before onAdd callbacks are observed.
      this.room.state.players.forEach((player: any, sessionId: string) => {
        console.log('[MultiplayerScene] state:existing', {
          sessionId,
          x: player.x,
          y: player.y,
          color: player.color,
        });
        this.ensurePlayerSprite(sessionId, player);
      });

      // Handle disconnection
      this.room.onLeave((code) => {
        console.log('[MultiplayerScene] room:onLeave', { code });
        this.connectionStatus.setText(`Disconnected (code: ${code})`);
        this.connectionStatus.setColor('#ff0000');
      });

    } catch (error) {
      console.error('[MultiplayerScene] connect:error', error);
      this.connectionStatus.setText('Connection failed! Check server.');
      this.connectionStatus.setColor('#ff0000');
    }
  }

  private ensurePlayerSprite(sessionId: string, player: any) {
    if (this.playerSprites.has(sessionId)) {
      return;
    }

    this.createPlayerSprite(sessionId, player);
  }

  private createPlayerSprite(sessionId: string, player: any) {
    console.log('[MultiplayerScene] sprite:create', {
      sessionId,
      x: player.x,
      y: player.y,
      color: player.color,
      isLocal: sessionId === this.mySessionId,
    });
    const container = this.add.container(player.x, player.y);
    
    // Player body
    const body = this.add.rectangle(0, 0, 30, 30, Phaser.Display.Color.HexStringToColor(player.color).color);
    body.setStrokeStyle(2, 0xffffff);
    container.add(body);

    // Direction indicator
    const indicator = this.add.triangle(0, -20, 0, 0, 8, 12, -8, 12, 0xffffff);
    container.add(indicator);

    // Name tag
    const nameText = this.add.text(0, 25, sessionId.slice(0, 8), {
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#00000080',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5);
    container.add(nameText);

    this.playerSprites.set(sessionId, {
      sprite: container,
      body,
      nameText,
      targetX: player.x,
      targetY: player.y,
      targetRotation: player.rotation,
    });

    // Update player count
    this.playerCountText.setText(`Players: ${this.playerSprites.size}`);

    // Follow local player with camera
    if (sessionId === this.mySessionId) {
      this.cameras.main.startFollow(container, false, 0.1, 0.1);
    }
  }

  private removePlayerSprite(sessionId: string) {
    const sprite = this.playerSprites.get(sessionId);
    if (sprite) {
      sprite.sprite.destroy();
      this.playerSprites.delete(sessionId);
      this.playerCountText.setText(`Players: ${this.playerSprites.size}`);
    }
  }

  update(_time: number, delta: number) {
    if (!this.room || !this.mySessionId) return;

    const mySprite = this.playerSprites.get(this.mySessionId);
    if (!mySprite) return;

    // Handle movement
    let vx = 0;
    let vy = 0;

    if (this.cursors.left?.isDown) vx -= 1;
    if (this.cursors.right?.isDown) vx += 1;
    if (this.cursors.up?.isDown) vy -= 1;
    if (this.cursors.down?.isDown) vy += 1;

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx /= len;
      vy /= len;
    }

    // Calculate new position
    const speed = (this.moveSpeed * delta) / 1000;
    let newX = mySprite.sprite.x + vx * speed;
    let newY = mySprite.sprite.y + vy * speed;

    // Clamp to arena bounds
    newX = Phaser.Math.Clamp(newX, 15, ARENA.WIDTH - 15);
    newY = Phaser.Math.Clamp(newY, 15, ARENA.HEIGHT - 15);

    // Simple collision with obstacles
    const playerRect = new Phaser.Geom.Rectangle(newX - 15, newY - 15, 30, 30);
    let collided = false;
    
    for (const obs of this.obstacles) {
      const obsRect = new Phaser.Geom.Rectangle(
        obs.x - obs.width / 2,
        obs.y - obs.height / 2,
        obs.width,
        obs.height
      );
      
      if (Phaser.Geom.Intersects.RectangleToRectangle(playerRect, obsRect)) {
        collided = true;
        break;
      }
    }

    if (!collided) {
      mySprite.sprite.x = newX;
      mySprite.sprite.y = newY;
    }

    // Update rotation based on movement
    if (vx !== 0 || vy !== 0) {
      const rotation = Math.atan2(vy, vx) + Math.PI / 2;
      mySprite.sprite.rotation = rotation;
    }

    // Send position to server
    this.room.send('move', {
      x: mySprite.sprite.x,
      y: mySprite.sprite.y,
      rotation: mySprite.sprite.rotation,
    });

    // Smooth interpolation for other players
    this.playerSprites.forEach((sprite, sessionId) => {
      if (sessionId === this.mySessionId) return;

      const lerpFactor = 0.2;
      sprite.sprite.x = Phaser.Math.Linear(sprite.sprite.x, sprite.targetX, lerpFactor);
      sprite.sprite.y = Phaser.Math.Linear(sprite.sprite.y, sprite.targetY, lerpFactor);
      sprite.sprite.rotation = Phaser.Math.Linear(
        sprite.sprite.rotation,
        sprite.targetRotation,
        lerpFactor
      );
    });
  }
}
