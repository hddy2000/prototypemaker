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

export class DeathmatchScene extends Phaser.Scene {
  private client!: Client;
  private room!: Room;
  private playerSprites: Map<string, PlayerSprite> = new Map();
  private bulletSprites: Map<string, BulletSprite> = new Map();
  private observedPlayers: Set<string> = new Set();
  private observedBullets: Set<string> = new Set();
  private mySessionId = '';
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private shootKey!: Phaser.Input.Keyboard.Key;
  private moveSpeed = 220;
  private obstacles: Phaser.GameObjects.Rectangle[] = [];
  private connectionStatus!: Phaser.GameObjects.Text;
  private playerCountText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'DeathmatchScene' });
  }

  async create() {
    this.add.rectangle(ARENA.WIDTH / 2, ARENA.HEIGHT / 2, ARENA.WIDTH, ARENA.HEIGHT, 0x14142a);

    OBSTACLES.forEach((obs) => {
      const rect = this.add.rectangle(obs.x + obs.w / 2, obs.y + obs.h / 2, obs.w, obs.h, 0x515179);
      this.obstacles.push(rect);
    });

    this.cameras.main.setBounds(0, 0, ARENA.WIDTH, ARENA.HEIGHT);
    this.cameras.main.setZoom(0.8);

    this.add.text(10, 52, '多人互射测试', {
      fontSize: '20px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(10);

    this.connectionStatus = this.add.text(10, 10, 'Connecting...', {
      fontSize: '16px',
      color: '#ffff00',
    }).setScrollFactor(0).setDepth(10);

    this.playerCountText = this.add.text(10, 30, 'Players: 0', {
      fontSize: '14px',
      color: '#aaaaaa',
    }).setScrollFactor(0).setDepth(10);

    this.add.text(10, 80, 'WASD/方向键移动，按 I 开枪。无时间限制，死亡后自动复活。', {
      fontSize: '15px',
      color: '#ffffff',
      wordWrap: { width: 340 },
    }).setScrollFactor(0).setDepth(10);

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

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
    this.shootKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.I);

    await this.connectToServer();
  }

  private async connectToServer() {
    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';
      this.client = new Client(serverUrl);
      this.connectionStatus.setText('Joining room...');

      this.room = await this.client.joinOrCreate('deathmatch');
      this.mySessionId = this.room.sessionId;

      this.connectionStatus.setText(`Connected! ID: ${this.mySessionId.slice(0, 8)}`);
      this.connectionStatus.setColor('#00ff00');

      this.room.state.players.onAdd((player: any, sessionId: string) => {
        this.ensurePlayerSprite(sessionId, player);
        this.observePlayer(sessionId, player);
      });

      this.room.state.players.onRemove((_player: any, sessionId: string) => {
        this.removePlayerSprite(sessionId);
      });

      this.room.state.players.forEach((player: any, sessionId: string) => {
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

      this.room.state.bullets.forEach((bullet: any, bulletId: string) => {
        this.ensureBulletSprite(bulletId, bullet);
        this.observeBullet(bulletId, bullet);
      });

      this.room.onLeave((code) => {
        this.connectionStatus.setText(`Disconnected (code: ${code})`);
        this.connectionStatus.setColor('#ff0000');
      });
    } catch (error) {
      console.error('[DeathmatchScene] connect:error', error);
      this.connectionStatus.setText('Connection failed! Check server.');
      this.connectionStatus.setColor('#ff0000');
    }
  }

  private ensurePlayerSprite(sessionId: string, player: any) {
    if (this.playerSprites.has(sessionId)) {
      this.refreshPlayerAppearance(sessionId, player);
      return;
    }

    const container = this.add.container(player.x, player.y);
    const body = this.add.rectangle(0, 0, 30, 30, Phaser.Display.Color.HexStringToColor(player.color).color);
    body.setStrokeStyle(2, 0xffffff);
    container.add(body);

    const indicator = this.add.triangle(0, -20, 0, 0, 8, 12, -8, 12, 0xffffff);
    container.add(indicator);

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

    this.playerCountText.setText(`Players: ${this.playerSprites.size}`);

    if (sessionId === this.mySessionId) {
      this.cameras.main.startFollow(container, false, 0.1, 0.1);
    }

    this.refreshPlayerAppearance(sessionId, player);
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

    const isLocal = sessionId === this.mySessionId;
    const isAlive = player.alive !== false;
    const suffix = isLocal ? ' · 你' : '';
    sprite.nameText.setText(`玩家${suffix}${isAlive ? '' : ' · OUT'}`);
    sprite.body.setAlpha(isAlive ? 1 : 0.25);
    sprite.nameText.setAlpha(isAlive ? 1 : 0.45);
    sprite.body.setStrokeStyle(isLocal ? 4 : 2, isLocal ? 0xfff275 : 0xffffff);
  }

  update(_time: number, delta: number) {
    if (!this.room || !this.mySessionId) return;

    const mySprite = this.playerSprites.get(this.mySessionId);
    if (!mySprite) return;

    const myState: any = this.room.state.players.get(this.mySessionId);
    const canAct = myState && myState.alive !== false;

    let vx = 0;
    let vy = 0;

    if (canAct) {
      if (this.cursors.left?.isDown || this.wasdKeys.A.isDown) vx -= 1;
      if (this.cursors.right?.isDown || this.wasdKeys.D.isDown) vx += 1;
      if (this.cursors.up?.isDown || this.wasdKeys.W.isDown) vy -= 1;
      if (this.cursors.down?.isDown || this.wasdKeys.S.isDown) vy += 1;
    }

    if (vx !== 0 && vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx /= len;
      vy /= len;
    }

    const speed = (this.moveSpeed * delta) / 1000;
    let newX = mySprite.sprite.x + vx * speed;
    let newY = mySprite.sprite.y + vy * speed;

    newX = Phaser.Math.Clamp(newX, 15, ARENA.WIDTH - 15);
    newY = Phaser.Math.Clamp(newY, 15, ARENA.HEIGHT - 15);

    const playerRect = new Phaser.Geom.Rectangle(newX - 15, newY - 15, 30, 30);
    let collided = false;
    for (const obs of this.obstacles) {
      const obsRect = new Phaser.Geom.Rectangle(obs.x - obs.width / 2, obs.y - obs.height / 2, obs.width, obs.height);
      if (Phaser.Geom.Intersects.RectangleToRectangle(playerRect, obsRect)) {
        collided = true;
        break;
      }
    }

    if (!collided) {
      mySprite.sprite.x = newX;
      mySprite.sprite.y = newY;
    }

    if (vx !== 0 || vy !== 0) {
      mySprite.sprite.rotation = Math.atan2(vy, vx) + Math.PI / 2;
    }

    if (Phaser.Input.Keyboard.JustDown(this.shootKey) && canAct) {
      this.room.send('shoot');
    }

    if (canAct) {
      this.room.send('move', {
        x: mySprite.sprite.x,
        y: mySprite.sprite.y,
        rotation: mySprite.sprite.rotation,
      });
    }

    this.playerSprites.forEach((sprite, sessionId) => {
      if (sessionId === this.mySessionId) return;
      sprite.sprite.x = Phaser.Math.Linear(sprite.sprite.x, sprite.targetX, 0.2);
      sprite.sprite.y = Phaser.Math.Linear(sprite.sprite.y, sprite.targetY, 0.2);
      sprite.sprite.rotation = Phaser.Math.Linear(sprite.sprite.rotation, sprite.targetRotation, 0.2);
    });

    this.bulletSprites.forEach((bullet) => {
      bullet.sprite.x = Phaser.Math.Linear(bullet.sprite.x, bullet.targetX, 0.35);
      bullet.sprite.y = Phaser.Math.Linear(bullet.sprite.y, bullet.targetY, 0.35);
    });
  }
}