import Phaser from 'phaser';
import { Client, Room } from 'colyseus.js';

// ─── Types ───────────────────────────────────────────────────

interface Obstacle { x: number; y: number; w: number; h: number; floor: number; }
interface RoomData { x: number; y: number; w: number; h: number; name: string; centerX: number; centerY: number; hasLight: boolean; lightOn: boolean; switchX: number; switchY: number; floor: number; }

interface PlayerRender {
  body: Phaser.GameObjects.Arc;
  nameText: Phaser.GameObjects.Text;
  healthBar: Phaser.GameObjects.Graphics;
  downIcon: Phaser.GameObjects.Text;
}

interface GhostRender {
  body: Phaser.GameObjects.Arc;
  eyeL: Phaser.GameObjects.Arc;
  eyeR: Phaser.GameObjects.Arc;
}

interface TreasureRender {
  sprite: Phaser.GameObjects.Container;
  pulse: Phaser.GameObjects.Arc;
}

interface CollectibleRender {
  sprite: Phaser.GameObjects.Container;
  pulse: Phaser.GameObjects.Arc;
}

interface SwitchRender {
  sprite: Phaser.GameObjects.Rectangle;
}

interface ExitRender {
  sprite: Phaser.GameObjects.Container;
}

const QUALITY_COLORS = [0xaaaaaa, 0x4488ff, 0xaa44ff, 0xffaa00];

const VIEW_RADIUS = 180;
const SCREEN_W = 800;
const SCREEN_H = 600;

// ─── Scene ───────────────────────────────────────────────────

export class BlindBoxMultiplayerScene extends Phaser.Scene {
  private client!: Client;
  private room!: Room;
  private mySessionId: string = '';

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private oneKey!: Phaser.Input.Keyboard.Key;
  private twoKey!: Phaser.Input.Keyboard.Key;
  private threeKey!: Phaser.Input.Keyboard.Key;

  // Map
  private obstacles: Obstacle[] = [];
  private rooms: RoomData[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;
  private mapBuilt = false;

  // Fog of war
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'blindboxMpFog';

  // Render maps
  private playerRenders: Map<string, PlayerRender> = new Map();
  private ghostRenders: Map<string, GhostRender> = new Map();
  private treasureRenders: Map<string, TreasureRender> = new Map();
  private collectibleRenders: Map<string, CollectibleRender> = new Map();
  private switchRenders: Map<string, SwitchRender> = new Map();
  private exitRenders: Map<string, ExitRender> = new Map();

  // Observed sets
  private observedPlayers: Set<string> = new Set();
  private observedGhosts: Set<string> = new Set();
  private observedTreasures: Set<string> = new Set();
  private observedCollectibles: Set<string> = new Set();
  private observedSwitches: Set<string> = new Set();
  private observedExits: Set<string> = new Set();

  // UI
  private connectionStatus!: Phaser.GameObjects.Text;
  private playerCountText!: Phaser.GameObjects.Text;
  private teamScoreText!: Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;
  private cracksText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private votePanel!: Phaser.GameObjects.Container;
  private voteTimerText!: Phaser.GameObjects.Text;
  private phaseOverlay!: Phaser.GameObjects.Text;

  // Local state
  private moveTimer = 0;
  private readonly MOVE_INTERVAL = 50; // ms between move messages

  constructor() {
    super({ key: 'BlindBoxMultiplayerScene' });
  }

  async create() {
    // Reset
    this.playerRenders.clear();
    this.ghostRenders.clear();
    this.treasureRenders.clear();
    this.collectibleRenders.clear();
    this.switchRenders.clear();
    this.exitRenders.clear();
    this.observedPlayers.clear();
    this.observedGhosts.clear();
    this.observedTreasures.clear();
    this.observedCollectibles.clear();
    this.observedSwitches.clear();
    this.observedExits.clear();
    this.obstacles = [];
    this.rooms = [];
    this.mapBuilt = false;

    // Background
    this.add.rectangle(400, 300, SCREEN_W, SCREEN_H, 0x0a0a1a).setScrollFactor(0).setDepth(0);

    // Map graphics
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.setDepth(1);

    // UI
    this.connectionStatus = this.add.text(10, 10, 'Connecting...', {
      fontSize: '14px', color: '#ffff00',
    }).setScrollFactor(0).setDepth(20);

    this.playerCountText = this.add.text(10, 30, 'Players: 0', {
      fontSize: '12px', color: '#aaaaaa',
    }).setScrollFactor(0).setDepth(20);

    this.teamScoreText = this.add.text(10, 46, '团队财宝: 0', {
      fontSize: '16px', color: '#ffdd00',
    }).setScrollFactor(0).setDepth(20);

    this.floorText = this.add.text(10, 68, '1F - 大厅层', {
      fontSize: '14px', color: '#88ccff',
    }).setScrollFactor(0).setDepth(20);

    this.cracksText = this.add.text(10, 86, '破解次数: 0/0', {
      fontSize: '14px', color: '#ff8844',
    }).setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 520, '', {
      fontSize: '18px', color: '#ffffff', align: 'center',
      backgroundColor: '#00000099', padding: { x: 10, y: 6 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    this.phaseOverlay = this.add.text(400, 300, '', {
      fontSize: '32px', color: '#ffffff', align: 'center',
      backgroundColor: '#000000cc', padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(22).setVisible(false);

    // Vote panel
    this.votePanel = this.add.container(400, 300);
    this.votePanel.setDepth(25).setScrollFactor(0).setVisible(false);

    const voteBg = this.add.rectangle(0, 0, 400, 250, 0x000000, 0.9);
    voteBg.setStrokeStyle(2, 0x4444ff);
    this.votePanel.add(voteBg);

    const voteTitle = this.add.text(0, -100, '🗳 投票选择盲盒大小', {
      fontSize: '20px', color: '#ffff00', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.votePanel.add(voteTitle);

    this.voteTimerText = this.add.text(0, -70, '剩余时间: 10s', {
      fontSize: '16px', color: '#ff8800',
    }).setOrigin(0.5);
    this.votePanel.add(this.voteTimerText);

    // Vote buttons
    const boxTypes = [
      { type: 1, name: '小盲盒', color: 0x44ff44, desc: '1次破解\n低风险低回报' },
      { type: 2, name: '中盲盒', color: 0x44aaff, desc: '2次破解\n中等风险' },
      { type: 3, name: '大盲盒', color: 0xff4444, desc: '3次破解\n高风险高回报' },
    ];

    for (let i = 0; i < boxTypes.length; i++) {
      const bt = boxTypes[i];
      const x = (i - 1) * 120;
      const btn = this.add.container(x, 20);

      const bg = this.add.rectangle(0, 0, 100, 120, bt.color, 0.3);
      bg.setStrokeStyle(2, bt.color);
      bg.setInteractive({ useHandCursor: true });
      btn.add(bg);

      const title = this.add.text(0, -35, bt.name, {
        fontSize: '16px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5);
      btn.add(title);

      const desc = this.add.text(0, 10, bt.desc, {
        fontSize: '11px', color: '#cccccc', align: 'center',
      }).setOrigin(0.5);
      btn.add(desc);

      const voteCount = this.add.text(0, 45, '0票', {
        fontSize: '14px', color: '#ffff00',
      }).setOrigin(0.5);
      btn.add(voteCount);
      (bt as any)._voteCountText = voteCount;

      bg.on('pointerdown', () => {
        this.room.send('vote', { boxType: bt.type });
      });

      this.votePanel.add(btn);
    }

    // Back button
    const backBtn = this.add.text(730, 10, '← 菜单', {
      fontSize: '14px', color: '#ffffff', backgroundColor: '#333333',
      padding: { x: 8, y: 4 },
    }).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);
    backBtn.on('pointerdown', () => {
      if (this.room) this.room.leave();
      this.scene.start('MenuScene');
    });

    // Input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as any;
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.oneKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
    this.twoKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
    this.threeKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);

    await this.connectToServer();
  }

  // ─── Server connection ─────────────────────────────────────

  private async connectToServer() {
    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';
      console.log('[BlindBoxMP] connect:start', { serverUrl });
      this.client = new Client(serverUrl);

      this.connectionStatus.setText('Joining room...');
      this.room = await this.client.joinOrCreate('blindbox');
      this.mySessionId = this.room.sessionId;
      console.log('[BlindBoxMP] connect:joined', { roomId: this.room.roomId, sessionId: this.mySessionId });

      this.connectionStatus.setText(`Connected! ID: ${this.mySessionId.slice(0, 8)}`);
      this.connectionStatus.setColor('#00ff00');

      this.setupStateListeners();

      this.room.onLeave((code) => {
        console.log('[BlindBoxMP] room:onLeave', { code });
        this.connectionStatus.setText(`Disconnected (code: ${code})`);
        this.connectionStatus.setColor('#ff0000');
      });
    } catch (error) {
      console.error('[BlindBoxMP] connect:error', error);
      this.connectionStatus.setText(`Connection Error: ${(error as Error).message}`);
      this.connectionStatus.setColor('#ff0000');
    }
  }

  // ─── State listeners ───────────────────────────────────────

  private setupStateListeners() {
    const state = this.room.state as any;

    // Obstacles
    state.obstacles.onAdd((obs: any) => {
      this.obstacles.push({ x: obs.x, y: obs.y, w: obs.w, h: obs.h, floor: obs.floor });
      this.tryRebuildMap();
    });

    // Rooms
    state.rooms.onAdd((room: any) => {
      this.rooms.push({
        x: room.x, y: room.y, w: room.w, h: room.h,
        name: room.name, centerX: room.centerX, centerY: room.centerY,
        hasLight: room.hasLight, lightOn: room.lightOn,
        switchX: room.switchX, switchY: room.switchY, floor: room.floor,
      });
      this.tryRebuildMap();
    });

    // Players
    state.players.onAdd((player: any, sessionId: string) => {
      this.ensurePlayerRender(sessionId, player);
      this.observePlayer(sessionId, player);
    });
    state.players.onRemove((_player: any, sessionId: string) => {
      this.removePlayerRender(sessionId);
    });

    // Ghosts
    state.ghosts.onAdd((ghost: any, ghostId: string) => {
      this.ensureGhostRender(ghostId, ghost);
      this.observeGhost(ghostId, ghost);
    });
    state.ghosts.onRemove((_ghost: any, ghostId: string) => {
      this.removeGhostRender(ghostId);
    });

    // Treasures
    state.treasures.onAdd((treasure: any, treasureId: string) => {
      this.ensureTreasureRender(treasureId, treasure);
      this.observeTreasure(treasureId, treasure);
    });
    state.treasures.onRemove((_treasure: any, treasureId: string) => {
      this.removeTreasureRender(treasureId);
    });

    // Collectibles
    state.collectibles.onAdd((col: any, colId: string) => {
      this.ensureCollectibleRender(colId, col);
      this.observeCollectible(colId, col);
    });
    state.collectibles.onRemove((_col: any, colId: string) => {
      this.removeCollectibleRender(colId);
    });

    // Switches
    state.switches.onAdd((sw: any, swId: string) => {
      this.ensureSwitchRender(swId, sw);
      this.observeSwitch(swId, sw);
    });
    state.switches.onRemove((_sw: any, swId: string) => {
      this.removeSwitchRender(swId);
    });

    // Exits
    state.exits.onAdd((exit: any, exitId: string) => {
      this.ensureExitRender(exitId, exit);
      this.observeExit(exitId, exit);
    });
    state.exits.onRemove((_exit: any, exitId: string) => {
      this.removeExitRender(exitId);
    });

    // Root state changes
    state.onChange(() => {
      this.updateRootState();
    });

    // Existing state (for late joiners)
    state.obstacles.forEach((obs: any) => {
      this.obstacles.push({ x: obs.x, y: obs.y, w: obs.w, h: obs.h, floor: obs.floor });
    });
    state.rooms.forEach((room: any) => {
      this.rooms.push({
        x: room.x, y: room.y, w: room.w, h: room.h,
        name: room.name, centerX: room.centerX, centerY: room.centerY,
        hasLight: room.hasLight, lightOn: room.lightOn,
        switchX: room.switchX, switchY: room.switchY, floor: room.floor,
      });
    });
    if (this.obstacles.length > 0) this.tryRebuildMap();

    state.players.forEach((player: any, sessionId: string) => {
      this.ensurePlayerRender(sessionId, player);
      this.observePlayer(sessionId, player);
    });
    state.ghosts.forEach((ghost: any, ghostId: string) => {
      this.ensureGhostRender(ghostId, ghost);
      this.observeGhost(ghostId, ghost);
    });
    state.treasures.forEach((treasure: any, treasureId: string) => {
      this.ensureTreasureRender(treasureId, treasure);
      this.observeTreasure(treasureId, treasure);
    });
    state.collectibles.forEach((col: any, colId: string) => {
      this.ensureCollectibleRender(colId, col);
      this.observeCollectible(colId, col);
    });
    state.switches.forEach((sw: any, swId: string) => {
      this.ensureSwitchRender(swId, sw);
      this.observeSwitch(swId, sw);
    });
    state.exits.forEach((exit: any, exitId: string) => {
      this.ensureExitRender(exitId, exit);
      this.observeExit(exitId, exit);
    });

    this.updateRootState();
  }

  // ─── Root state update ────────────────────────────────────

  private updateRootState() {
    const state = this.room.state as any;

    // Phase
    const phase = state.phase as string;
    if (phase === 'won') {
      this.phaseOverlay.setVisible(true).setText(`🎉 撤离成功！\n最终分数: ${state.finalScore}\n按ESC返回菜单`);
    } else if (phase === 'dead') {
      this.phaseOverlay.setVisible(true).setText('💀 全员阵亡...\n按ESC返回菜单');
    } else {
      this.phaseOverlay.setVisible(false);
    }

    // Vote panel
    if (state.voteActive) {
      this.votePanel.setVisible(true);
      this.voteTimerText.setText(`剩余时间: ${Math.ceil(state.voteTimer / 1000)}s`);
      // Update vote counts
      const buttons = this.votePanel.list;
      for (const item of buttons) {
        if (item instanceof Phaser.GameObjects.Container) {
          for (const child of item.list) {
            if (child instanceof Phaser.GameObjects.Text && child.text.endsWith('票')) {
              // Match by position
            }
          }
        }
      }
      // Simpler: update by index
      const voteCounts = [state.boxVoteSmall, state.boxVoteMedium, state.boxVoteLarge];
      const voteBtns = this.votePanel.list.filter(i => i instanceof Phaser.GameObjects.Container);
      voteBtns.forEach((btn: any, i: number) => {
        const vcText = btn.list.find((c: any) => c instanceof Phaser.GameObjects.Text && c.text.includes('票'));
        if (vcText) vcText.setText(`${voteCounts[i] || 0}票`);
      });
    } else {
      this.votePanel.setVisible(false);
    }

    // UI text
    this.teamScoreText.setText(`团队财宝: ${state.teamScore}`);
    this.floorText.setText(`${state.currentFloor}F`);
    this.cracksText.setText(`破解次数: ${state.cracksRemaining}/${state.totalCracks}`);

    // Message
    if (state.messageText && state.messageTimer > 0) {
      this.messageText.setText(state.messageText).setVisible(true);
    } else {
      this.messageText.setVisible(false);
    }
  }

  // ─── Observe helpers ───────────────────────────────────────

  private observePlayer(sessionId: string, player: any) {
    if (this.observedPlayers.has(sessionId)) return;
    this.observedPlayers.add(sessionId);

    player.onChange(() => {
      const render = this.playerRenders.get(sessionId);
      if (!render) return;

      render.body.setPosition(player.x, player.y);
      const isMe = sessionId === this.mySessionId;
      const isDown = player.state === 'down';
      const isDead = player.state === 'dead';

      if (isDown) {
        render.body.setFillStyle(0xff4444, 0.6);
        render.downIcon.setVisible(true).setPosition(player.x, player.y - 20);
      } else if (isDead) {
        render.body.setVisible(false);
        render.nameText.setVisible(false);
        render.downIcon.setVisible(false);
      } else {
        const color = Phaser.Display.Color.HexStringToColor(player.color).color;
        render.body.setVisible(true).setFillStyle(color);
        render.downIcon.setVisible(false);
      }

      if (isMe) {
        this.cameras.main.startFollow(render.body, true, 0.1, 0.1);
      }

      render.nameText.setPosition(player.x, player.y - 22);
      render.nameText.setText(isMe ? '我' : sessionId.slice(0, 4));
    });
  }

  private observeGhost(ghostId: string, ghost: any) {
    if (this.observedGhosts.has(ghostId)) return;
    this.observedGhosts.add(ghostId);

    ghost.onChange(() => {
      const render = this.ghostRenders.get(ghostId);
      if (!render) return;
      render.body.setPosition(ghost.x, ghost.y);
      render.eyeL.setPosition(ghost.x - 5, ghost.y - 2);
      render.eyeR.setPosition(ghost.x + 5, ghost.y - 2);

      if (ghost.isBoss) {
        render.body.setFillStyle(0xff00ff, 0.85).setRadius(18);
      } else if (ghost.isChasing) {
        render.body.setFillStyle(0xff0000, 0.8);
      } else {
        render.body.setFillStyle(0x884400, 0.7);
      }
    });
  }

  private observeTreasure(treasureId: string, treasure: any) {
    if (this.observedTreasures.has(treasureId)) return;
    this.observedTreasures.add(treasureId);

    treasure.onChange(() => {
      const render = this.treasureRenders.get(treasureId);
      if (!render) return;
      if (treasure.collected) {
        render.sprite.setVisible(false);
      } else {
        render.sprite.setVisible(true).setPosition(treasure.x, treasure.y);
      }
    });
  }

  private observeCollectible(colId: string, col: any) {
    if (this.observedCollectibles.has(colId)) return;
    this.observedCollectibles.add(colId);

    col.onChange(() => {
      const render = this.collectibleRenders.get(colId);
      if (!render) return;
      if (col.collected) {
        render.sprite.setVisible(false);
      } else {
        render.sprite.setVisible(true).setPosition(col.x, col.y);
      }
    });
  }

  private observeSwitch(swId: string, sw: any) {
    if (this.observedSwitches.has(swId)) return;
    this.observedSwitches.add(swId);

    sw.onChange(() => {
      const render = this.switchRenders.get(swId);
      if (!render) return;
      render.sprite.setFillStyle(sw.activated ? 0x00ff00 : 0x666600);
    });
  }

  private observeExit(exitId: string, exit: any) {
    if (this.observedExits.has(exitId)) return;
    this.observedExits.add(exitId);

    exit.onChange(() => {
      const render = this.exitRenders.get(exitId);
      if (!render) return;
      render.sprite.setVisible(exit.active);
    });
  }

  // ─── Render creation ────────────────────────────────────────

  private ensurePlayerRender(sessionId: string, player: any) {
    if (this.playerRenders.has(sessionId)) return;
    const color = Phaser.Display.Color.HexStringToColor(player.color).color;
    const body = this.add.circle(player.x, player.y, 12, color);
    body.setStrokeStyle(2, 0xffffff);
    body.setDepth(5);

    const nameText = this.add.text(player.x, player.y - 22, sessionId.slice(0, 4), {
      fontSize: '10px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(6);

    const healthBar = this.add.graphics();
    healthBar.setDepth(6);

    const downIcon = this.add.text(player.x, player.y - 20, '💀', {
      fontSize: '14px',
    }).setOrigin(0.5).setDepth(6).setVisible(false);

    this.playerRenders.set(sessionId, { body, nameText, healthBar, downIcon });
  }

  private ensureGhostRender(ghostId: string, ghost: any) {
    if (this.ghostRenders.has(ghostId)) return;
    const radius = ghost.isBoss ? 18 : 14;
    const color = ghost.isBoss ? 0xff00ff : 0x884400;
    const body = this.add.circle(ghost.x, ghost.y, radius, color, 0.8);
    body.setDepth(4);

    const eyeL = this.add.circle(ghost.x - 5, ghost.y - 2, 3, 0xff0000);
    eyeL.setDepth(5);
    const eyeR = this.add.circle(ghost.x + 5, ghost.y - 2, 3, 0xff0000);
    eyeR.setDepth(5);

    this.ghostRenders.set(ghostId, { body, eyeL, eyeR });
  }

  private ensureTreasureRender(treasureId: string, treasure: any) {
    if (this.treasureRenders.has(treasureId)) return;
    const color = QUALITY_COLORS[treasure.quality] || 0xaaaaaa;
    const pulse = this.add.circle(0, 0, 10, color);
    pulse.setStrokeStyle(2, 0xffffff);
    const container = this.add.container(treasure.x, treasure.y, [pulse]);
    container.setDepth(3);
    this.tweens.add({
      targets: pulse,
      scale: { from: 0.8, to: 1.3 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    this.treasureRenders.set(treasureId, { sprite: container, pulse });
  }

  private ensureCollectibleRender(colId: string, col: any) {
    if (this.collectibleRenders.has(colId)) return;
    const pulse = this.add.circle(0, 0, 8, 0xffdd00);
    pulse.setStrokeStyle(1, 0xffffff);
    const container = this.add.container(col.x, col.y, [pulse]);
    container.setDepth(3);
    this.tweens.add({
      targets: pulse,
      scale: { from: 0.7, to: 1.2 },
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    this.collectibleRenders.set(colId, { sprite: container, pulse });
  }

  private ensureSwitchRender(swId: string, sw: any) {
    if (this.switchRenders.has(swId)) return;
    const sprite = this.add.rectangle(sw.x, sw.y, 24, 24, sw.activated ? 0x00ff00 : 0x666600);
    sprite.setDepth(3);
    this.switchRenders.set(swId, { sprite });
  }

  private ensureExitRender(exitId: string, exit: any) {
    if (this.exitRenders.has(exitId)) return;
    const bg = this.add.rectangle(0, 0, 50, 50, 0x00ffff, 0.4);
    bg.setStrokeStyle(3, 0x00ffff);
    const txt = this.add.text(0, 0, '出\n口', {
      fontSize: '12px', color: '#00ffff', align: 'center',
    }).setOrigin(0.5);
    const container = this.add.container(exit.x, exit.y, [bg, txt]);
    container.setDepth(3).setVisible(exit.active);
    this.tweens.add({
      targets: bg,
      alpha: { from: 0.3, to: 0.8 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    this.exitRenders.set(exitId, { sprite: container });
  }

  // ─── Render removal ────────────────────────────────────────

  private removePlayerRender(sessionId: string) {
    const r = this.playerRenders.get(sessionId);
    if (r) {
      r.body.destroy();
      r.nameText.destroy();
      r.healthBar.destroy();
      r.downIcon.destroy();
    }
    this.playerRenders.delete(sessionId);
    this.observedPlayers.delete(sessionId);
  }

  private removeGhostRender(ghostId: string) {
    const r = this.ghostRenders.get(ghostId);
    if (r) {
      r.body.destroy();
      r.eyeL.destroy();
      r.eyeR.destroy();
    }
    this.ghostRenders.delete(ghostId);
    this.observedGhosts.delete(ghostId);
  }

  private removeTreasureRender(treasureId: string) {
    const r = this.treasureRenders.get(treasureId);
    if (r) {
      this.tweens.killTweensOf(r.pulse);
      r.sprite.destroy();
    }
    this.treasureRenders.delete(treasureId);
    this.observedTreasures.delete(treasureId);
  }

  private removeCollectibleRender(colId: string) {
    const r = this.collectibleRenders.get(colId);
    if (r) {
      this.tweens.killTweensOf(r.pulse);
      r.sprite.destroy();
    }
    this.collectibleRenders.delete(colId);
    this.observedCollectibles.delete(colId);
  }

  private removeSwitchRender(swId: string) {
    const r = this.switchRenders.get(swId);
    if (r) r.sprite.destroy();
    this.switchRenders.delete(swId);
    this.observedSwitches.delete(swId);
  }

  private removeExitRender(exitId: string) {
    const r = this.exitRenders.get(exitId);
    if (r) r.sprite.destroy();
    this.exitRenders.delete(exitId);
    this.observedExits.delete(exitId);
  }

  // ─── Map rendering ─────────────────────────────────────────

  private tryRebuildMap() {
    if (this.mapBuilt) return;
    if (this.obstacles.length === 0 || this.rooms.length === 0) return;
    this.mapBuilt = true;

    const state = this.room.state as any;
    const mapW = state.mapWidth || 900;
    const mapH = state.mapHeight || 700;

    this.cameras.main.setBounds(0, 0, mapW, mapH);
    this.cameras.main.setZoom(0.85);

    this.rebuildMap();
    this.createFog();
  }

  private rebuildMap() {
    const state = this.room.state as any;
    const mapW = state.mapWidth || 900;
    const mapH = state.mapHeight || 700;
    const currentFloor = state.currentFloor || 1;

    const g = this.mapGraphics;
    g.clear();

    // Floor
    g.fillStyle(0x1a1a2e, 1);
    g.fillRect(0, 0, mapW, mapH);

    // Grid
    g.lineStyle(1, 0x222244, 0.3);
    for (let x = 0; x < mapW; x += 80) g.lineBetween(x, 0, x, mapH);
    for (let y = 0; y < mapH; y += 80) g.lineBetween(0, y, mapW, y);

    // Rooms
    const floorRooms = this.rooms.filter(r => r.floor === currentFloor);
    for (const room of floorRooms) {
      const isLit = room.lightOn;
      g.fillStyle(isLit ? 0x2a2a4e : 0x0a0a1a, 0.8);
      g.fillRect(room.x, room.y, room.w, room.h);

      g.lineStyle(2, 0x444466, 0.6);
      g.strokeRect(room.x, room.y, room.w, room.h);

      // Room name
      g.fillStyle(0x444466, 0.3);
      g.fillRect(room.x + 5, room.y + 5, 60, 16);
    }

    // Walls (obstacles)
    g.fillStyle(0x3a3a55, 1);
    for (const obs of this.obstacles) {
      if (obs.floor !== currentFloor) continue;
      g.fillRect(obs.x, obs.y, obs.w, obs.h);
      g.lineStyle(1, 0x555577, 0.5);
      g.strokeRect(obs.x, obs.y, obs.w, obs.h);
    }

    // Cracking tables
    state.crackingTables.forEach((ct: any) => {
      if (ct.floor !== currentFloor) return;
      const color = ct.isCracked ? 0x444444 : 0x8b4513;
      g.fillStyle(color, 0.8);
      g.fillRect(ct.x - 20, ct.y - 15, 40, 30);
      g.lineStyle(2, 0xffaa00, 0.6);
      g.strokeRect(ct.x - 20, ct.y - 15, 40, 30);
      if (!ct.isCracked) {
        g.fillStyle(0xffdd00, 0.8);
        g.fillRect(ct.x - 5, ct.y - 10, 10, 10);
      }
    });

    // Stairs
    state.stairs.forEach((stair: any) => {
      if (stair.floor !== currentFloor) return;
      g.fillStyle(0x4444aa, 0.6);
      g.fillRect(stair.x - 15, stair.y - 15, 30, 30);
      g.lineStyle(2, 0x6666ff, 0.8);
      g.strokeRect(stair.x - 15, stair.y - 15, 30, 30);
      g.fillStyle(0xffffff, 0.8);
      // Arrow drawn as triangle via polygon
      if (stair.direction === 'up') {
        g.beginPath();
        g.moveTo(stair.x, stair.y - 8);
        g.lineTo(stair.x - 6, stair.y + 4);
        g.lineTo(stair.x + 6, stair.y + 4);
        g.closePath();
        g.fillPath();
      } else {
        g.beginPath();
        g.moveTo(stair.x, stair.y + 8);
        g.lineTo(stair.x - 6, stair.y - 4);
        g.lineTo(stair.x + 6, stair.y - 4);
        g.closePath();
        g.fillPath();
      }
    });

    // Light switches
    for (const room of floorRooms) {
      if (!room.hasLight) continue;
      g.fillStyle(0x666644, 0.8);
      g.fillRect(room.switchX - 6, room.switchY - 6, 12, 12);
      g.lineStyle(1, 0x888866, 0.6);
      g.strokeRect(room.switchX - 6, room.switchY - 6, 12, 12);
    }
  }

  // ─── Fog of war ─────────────────────────────────────────────

  private createFog() {
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = SCREEN_W;
    this.fogCanvas.height = SCREEN_H;
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

  private drawFog(screenX: number, screenY: number) {
    const ctx = this.fogCtx;
    const radius = VIEW_RADIUS;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.94)';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

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

    // Manual WebGL texture upload (Phaser 3.90 bug workaround)
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

  // ─── Update loop ────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      if (this.room) this.room.leave();
      this.scene.start('MenuScene');
      return;
    }

    if (!this.room || !this.room.state) return;

    const state = this.room.state as any;
    const myPlayer = state.players.get(this.mySessionId) as any;
    if (!myPlayer) return;

    // Vote hotkeys
    if (state.voteActive) {
      if (Phaser.Input.Keyboard.JustDown(this.oneKey)) {
        this.room.send('vote', { boxType: 1 });
      }
      if (Phaser.Input.Keyboard.JustDown(this.twoKey)) {
        this.room.send('vote', { boxType: 2 });
      }
      if (Phaser.Input.Keyboard.JustDown(this.threeKey)) {
        this.room.send('vote', { boxType: 3 });
      }
    }

    // E key: interact / revive
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      // Check if near a downed player → revive
      let revived = false;
      state.players.forEach((p: any, sid: string) => {
        if (sid === this.mySessionId || p.state !== 'down') return;
        const dist = Math.hypot(p.x - myPlayer.x, p.y - myPlayer.y);
        if (dist < 50) {
          this.room.send('revive', { targetId: sid });
          revived = true;
        }
      });
      if (!revived) {
        this.room.send('interact');
      }
    }

    // Stairs: use F key
    const fKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    if (Phaser.Input.Keyboard.JustDown(fKey)) {
      this.room.send('stairs');
    }

    // Movement input
    let inputX = 0, inputY = 0;
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) inputX -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) inputX += 1;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) inputY -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) inputY += 1;

    // Send move at throttled interval
    this.moveTimer += delta;
    if (this.moveTimer >= this.MOVE_INTERVAL) {
      this.moveTimer = 0;
      if (myPlayer.state === 'alive' && state.phase === 'playing') {
        const pointer = this.input.activePointer;
        const cam = this.cameras.main;
        const mouseWorldX = pointer.x + cam.scrollX;
        const mouseWorldY = pointer.y + cam.scrollY;
        const facingAngle = Math.atan2(mouseWorldY - myPlayer.y, mouseWorldX - myPlayer.x);

        this.room.send('move', {
          inputX, inputY,
          facingAngle,
          dt: this.MOVE_INTERVAL,
        });
      }
    }

    // Rebuild map when floor changes
    const currentFloor = state.currentFloor as number;
    if (this._lastFloor !== currentFloor) {
      this._lastFloor = currentFloor;
      this.rebuildMap();
    }

    // Update health bars
    this.playerRenders.forEach((render, sid) => {
      const p = state.players.get(sid) as any;
      if (!p) return;
      render.healthBar.clear();
      const barW = 30;
      const barH = 4;
      const bx = p.x - barW / 2;
      const by = p.y + 16;

      render.healthBar.fillStyle(0x220000, 0.8);
      render.healthBar.fillRect(bx - 1, by - 1, barW + 2, barH + 2);

      const hpct = Math.max(0, p.health / 100);
      if (p.state === 'down') {
        render.healthBar.fillStyle(0xff4444, 0.9);
      } else if (hpct > 0.5) {
        render.healthBar.fillStyle(0x44ff44, 0.9);
      } else {
        render.healthBar.fillStyle(0xff8800, 0.9);
      }
      render.healthBar.fillRect(bx, by, barW * hpct, barH);

      // Down timer
      if (p.state === 'down') {
        const downPct = 1 - (p.downTimer / 15000);
        render.healthBar.fillStyle(0xff0000, 0.5);
        render.healthBar.fillRect(bx, by + barH + 1, barW * downPct, 2);

        if (p.reviveProgress > 0) {
          render.healthBar.fillStyle(0x00ff00, 0.9);
          render.healthBar.fillRect(bx, by + barH + 4, barW * (p.reviveProgress / 100), 2);
        }
      }
    });

    // Fog
    if (this.fogImage && this.fogCanvas) {
      const cam = this.cameras.main;
      const screenX = myPlayer.x - cam.scrollX;
      const screenY = myPlayer.y - cam.scrollY;
      this.drawFog(screenX, screenY);
    }

    // Player count
    let aliveCount = 0;
    state.players.forEach((p: any) => {
      if (p.state === 'alive' || p.state === 'down') aliveCount++;
    });
    this.playerCountText.setText(`Players: ${state.players.size} (${aliveCount} alive)`);
  }

  private _lastFloor = 0;
}
