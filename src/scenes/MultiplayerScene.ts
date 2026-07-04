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

interface BulletSprite {
  sprite: Phaser.GameObjects.Arc;
  targetX: number;
  targetY: number;
}

export class MultiplayerScene extends Phaser.Scene {
  private client!: Client;
  private room!: Room;
  private playerSprites: Map<string, PlayerSprite> = new Map();
  private bulletSprites: Map<string, BulletSprite> = new Map();
  private observedPlayers: Set<string> = new Set();
  private observedBullets: Set<string> = new Set();
  private mySessionId: string = '';
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private shootKey!: Phaser.Input.Keyboard.Key;
  private moveSpeed = 200;
  private obstacles: Phaser.GameObjects.Rectangle[] = [];
  private connectionStatus!: Phaser.GameObjects.Text;
  private playerCountText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private resultText!: Phaser.GameObjects.Text;

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

    this.add.text(10, 52, '多人躲猫猫测试', {
      fontSize: '20px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(10);

    // Connection status
    this.connectionStatus = this.add.text(10, 10, 'Connecting...', {
      fontSize: '16px',
      color: '#ffff00',
    }).setScrollFactor(0).setDepth(10);

    this.playerCountText = this.add.text(10, 30, 'Players: 0', {
      fontSize: '14px',
      color: '#aaaaaa',
    }).setScrollFactor(0).setDepth(10);

    this.objectiveText = this.add.text(10, 80, '等待更多玩家加入...', {
      fontSize: '15px',
      color: '#ffffff',
      wordWrap: { width: 320 },
    }).setScrollFactor(0).setDepth(10);

    this.timerText = this.add.text(400, 20, 'Waiting', {
      fontSize: '22px',
      color: '#ffffff',
      backgroundColor: '#00000080',
      padding: { x: 10, y: 6 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10);

    this.resultText = this.add.text(400, 70, '', {
      fontSize: '26px',
      color: '#ffffff',
      backgroundColor: '#00000099',
      padding: { x: 12, y: 8 },
      align: 'center',
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10).setVisible(false);

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
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
    this.shootKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

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
        this.observePlayer(sessionId, player);
      });

      this.room.state.bullets.onAdd((bullet: any, bulletId: string) => {
        this.ensureBulletSprite(bulletId, bullet);
        this.observeBullet(bulletId, bullet);
      });

      this.room.state.bullets.onRemove((_bullet: any, bulletId: string) => {
        this.removeBulletSprite(bulletId);
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
        this.observePlayer(sessionId, player);
      });

      this.room.state.bullets.forEach((bullet: any, bulletId: string) => {
        this.ensureBulletSprite(bulletId, bullet);
        this.observeBullet(bulletId, bullet);
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
      this.refreshPlayerAppearance(sessionId, player);
      return;
    }

    this.createPlayerSprite(sessionId, player);
  }

  private observePlayer(sessionId: string, player: any) {
    if (this.observedPlayers.has(sessionId)) {
      return;
    }

    this.observedPlayers.add(sessionId);
    player.onChange(() => {
      const sprite = this.playerSprites.get(sessionId);
      if (sprite) {
        sprite.targetX = player.x;
        sprite.targetY = player.y;
        sprite.targetRotation = player.rotation;
      }
      this.refreshPlayerAppearance(sessionId, player);
    });
  }

  private observeBullet(bulletId: string, bullet: any) {
    if (this.observedBullets.has(bulletId)) {
      return;
    }

    this.observedBullets.add(bulletId);
    bullet.onChange(() => {
      const sprite = this.bulletSprites.get(bulletId);
      if (sprite) {
        sprite.targetX = bullet.x;
        sprite.targetY = bullet.y;
      }
    });
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

    this.refreshPlayerAppearance(sessionId, player);
  }

  private removePlayerSprite(sessionId: string) {
    const sprite = this.playerSprites.get(sessionId);
    if (sprite) {
      sprite.sprite.destroy();
      this.playerSprites.delete(sessionId);
      this.observedPlayers.delete(sessionId);
      this.playerCountText.setText(`Players: ${this.playerSprites.size}`);
    }
  }

  private ensureBulletSprite(bulletId: string, bullet: any) {
    if (this.bulletSprites.has(bulletId)) {
      return;
    }

    const arc = this.add.circle(bullet.x, bullet.y, 6, 0xfff275);
    arc.setDepth(4);
    this.bulletSprites.set(bulletId, {
      sprite: arc,
      targetX: bullet.x,
      targetY: bullet.y,
    });
  }

  private removeBulletSprite(bulletId: string) {
    const bullet = this.bulletSprites.get(bulletId);
    if (bullet) {
      bullet.sprite.destroy();
      this.bulletSprites.delete(bulletId);
      this.observedBullets.delete(bulletId);
    }
  }

  private refreshPlayerAppearance(sessionId: string, player: any) {
    const sprite = this.playerSprites.get(sessionId);
    if (!sprite) {
      return;
    }

    const isHunter = player.role === 'hunter';
    const isLocal = sessionId === this.mySessionId;
    const isAlive = player.alive !== false;
    const baseName = isHunter ? '猎人' : '平民';
    const status = isAlive ? '' : ' · OUT';
    const suffix = isLocal ? ' · 你' : '';

    sprite.nameText.setText(`${baseName}${suffix}${status}`);
    sprite.nameText.setColor(isHunter ? '#ffb3b3' : '#d7f7ff');
    sprite.body.setStrokeStyle(isHunter ? 4 : 2, isHunter ? 0xff4444 : 0xffffff);
    sprite.body.setAlpha(isAlive ? 1 : 0.3);
    sprite.nameText.setAlpha(isAlive ? 1 : 0.45);
    sprite.sprite.setDepth(isHunter ? 6 : 5);
  }

  private updateHud() {
    if (!this.room) {
      return;
    }

    const state: any = this.room.state;
    const me = state.players?.get?.(this.mySessionId);
    const phase = state.phase ?? 'waiting';
    const winner = state.winner ?? '';

    if (!me) {
      this.objectiveText.setText('加入房间中...');
      return;
    }

    if (me.role === 'hunter') {
      this.objectiveText.setText('你是猎人：WASD/方向键移动，按空格开枪。45 秒内击倒全部平民即获胜。');
    } else if (me.alive === false) {
      this.objectiveText.setText('你已出局：保持观战，等待本回合结束后自动重开。');
    } else {
      this.objectiveText.setText('你是平民：利用障碍物躲避猎人射击，活到倒计时结束。');
    }

    if (phase === 'active') {
      const remainingMs = Math.max(0, (state.roundEndsAt ?? 0) - Date.now());
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      this.timerText.setText(`倒计时 ${remainingSeconds}s`);
      this.resultText.setVisible(false);
    } else if (phase === 'waiting') {
      this.timerText.setText('等待至少 2 名玩家');
      this.resultText.setVisible(false);
    } else {
      this.timerText.setText('本回合结束');
      const hunterWon = winner === 'hunter';
      const myWin = (me.role === 'hunter' && hunterWon) || (me.role !== 'hunter' && winner === 'civilians');
      const winnerText = hunterWon ? '猎人胜利' : '平民胜利';
      this.resultText
        .setText(`${winnerText}\n${myWin ? '你赢了' : '你输了'}\n4 秒后自动重开`)
        .setColor(hunterWon ? '#ffcccc' : '#ccffdd')
        .setVisible(true);
    }
  }

  update(_time: number, delta: number) {
    if (!this.room || !this.mySessionId) return;

    this.updateHud();

    const mySprite = this.playerSprites.get(this.mySessionId);
    if (!mySprite) return;

    const myState: any = this.room.state.players.get(this.mySessionId);
    const canAct = myState && myState.alive !== false && this.room.state.phase === 'active';

    // Handle movement
    let vx = 0;
    let vy = 0;

    if (canAct) {
      if (this.cursors.left?.isDown || this.wasdKeys.A.isDown) vx -= 1;
      if (this.cursors.right?.isDown || this.wasdKeys.D.isDown) vx += 1;
      if (this.cursors.up?.isDown || this.wasdKeys.W.isDown) vy -= 1;
      if (this.cursors.down?.isDown || this.wasdKeys.S.isDown) vy += 1;
    }

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

    if (Phaser.Input.Keyboard.JustDown(this.shootKey) && canAct && myState?.role === 'hunter') {
      this.room.send('shoot');
    }

    if (canAct) {
      this.room.send('move', {
        x: mySprite.sprite.x,
        y: mySprite.sprite.y,
        rotation: mySprite.sprite.rotation,
      });
    }

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

    this.bulletSprites.forEach((bullet) => {
      bullet.sprite.x = Phaser.Math.Linear(bullet.sprite.x, bullet.targetX, 0.35);
      bullet.sprite.y = Phaser.Math.Linear(bullet.sprite.y, bullet.targetY, 0.35);
    });
  }
}
