import Phaser from 'phaser';
import { Client, Room } from 'colyseus.js';

// ─── Types ───────────────────────────────────────────────────

interface Obstacle { x: number; y: number; w: number; h: number; }
interface HideSpot { x: number; y: number; w: number; h: number; }

interface PlayerRender {
  body: Phaser.GameObjects.Arc;
  nameText: Phaser.GameObjects.Text;
  healthBar: Phaser.GameObjects.Graphics;
  downIcon: Phaser.GameObjects.Text;
  healthBarDirty: boolean;
  colorValue: number;  // cached parsed color to avoid HexStringToColor every onChange
  targetX: number;     // server-authoritative target position (lerped in update)
  targetY: number;
}

interface MonsterRender {
  sprite: Phaser.GameObjects.Rectangle;
  targetX: number;     // server-authoritative target position (lerped in update)
  targetY: number;
}

interface StainRender {
  sprite: Phaser.GameObjects.Graphics;
}

interface LootRender {
  sprite: Phaser.GameObjects.Container;
  pulse: Phaser.GameObjects.Arc;
}

const LOOT_COLORS: Record<string, number> = {
  gold: 0xffdd00,
  gem: 0x44ffff,
  medkit: 0xff4444,
  shield: 0x44aaff,
};

const VIEW_RADIUS = 180;
const SCREEN_W = 800;
const SCREEN_H = 600;

// ─── Scene ───────────────────────────────────────────────────

export class CleanupMultiplayerScene extends Phaser.Scene {
  private client!: Client;
  private room!: Room;
  private mySessionId: string = '';

  // Input
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private shiftKey!: Phaser.Input.Keyboard.Key;

  // Map
  private obstacles: Obstacle[] = [];
  private hideSpots: HideSpot[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Fog of war
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'cleanupMpFog';

  // Render maps
  private playerRenders: Map<string, PlayerRender> = new Map();
  private monsterRenders: Map<string, MonsterRender> = new Map();
  private stainRenders: Map<string, StainRender> = new Map();
  private lootRenders: Map<string, LootRender> = new Map();

  // Observed sets (to avoid re-registering onChange)
  private observedPlayers: Set<string> = new Set();
  private observedMonsters: Set<string> = new Set();
  private observedStains: Set<string> = new Set();
  private observedLoots: Set<string> = new Set();

  // Local state
  private isSpraying = false;
  private aimAngle = 0;
  private sprayGraphics!: Phaser.GameObjects.Graphics;

  // Network throttling — avoid sending spray/move every frame
  private lastSpraySent = false;       // last spray state sent to server
  private lastSprayAngleSent = 0;      // last spray angle sent to server
  private moveAccumulator = 0;         // ms accumulator for move throttling
  private lastInputX = 0;
  private lastInputY = 0;
  private lastSprintSent = false;
  private lastRotationSent = 0;

  // Render throttling — avoid redundant per-frame work
  private fogAccumulator = 0;          // ms accumulator for fog redraw (~30Hz)
  private uiAccumulator = 0;           // ms accumulator for UI text updates (~10Hz)
  private staminaAccumulator = 0;      // ms accumulator for stamina bar (~15Hz)
  private lastStaminaVal = -1;
  private lastSprintVal = false;
  private cameraFollowSet = false;     // startFollow only once
  private sprayGraphicsDirty = false;  // track if spray graphics has content

  // UI
  private connectionStatus!: Phaser.GameObjects.Text;
  private playerCountText!: Phaser.GameObjects.Text;
  private teamScoreText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private evacText!: Phaser.GameObjects.Text;
  private staminaBar!: Phaser.GameObjects.Graphics;
  private revivePrompt!: Phaser.GameObjects.Text;

  // Exit marker
  private exitMarker!: Phaser.GameObjects.Rectangle;

  // Map built flag
  private mapBuilt = false;

  constructor() {
    super({ key: 'CleanupMultiplayerScene' });
  }

  async create() {
    // Clean up previous room connection (scene may restart without proper leave)
    if (this.room) {
      try { await this.room.leave(); } catch { /* ignore */ }
      this.room = null as any;
    }

    // Reset all state
    this.playerRenders.clear();
    this.monsterRenders.clear();
    this.stainRenders.clear();
    this.lootRenders.clear();
    this.observedPlayers.clear();
    this.observedMonsters.clear();
    this.observedStains.clear();
    this.observedLoots.clear();
    this.obstacles = [];
    this.hideSpots = [];
    this.mapBuilt = false;
    this.isSpraying = false;
    this.aimAngle = 0;
    this.fogAccumulator = 0;
    this.uiAccumulator = 0;
    this.staminaAccumulator = 0;
    this.lastStaminaVal = -1;
    this.lastSprintVal = false;
    this.cameraFollowSet = false;
    this.sprayGraphicsDirty = false;

    // Background
    this.add.rectangle(400, 300, SCREEN_W, SCREEN_H, 0x0a0a1a).setScrollFactor(0).setDepth(0);

    // Map graphics
    this.mapGraphics = this.add.graphics();
    this.mapGraphics.setDepth(1);

    // Spray graphics
    this.sprayGraphics = this.add.graphics();
    this.sprayGraphics.setDepth(7);

    // Exit marker
    this.exitMarker = this.add.rectangle(0, 0, 50, 50, 0x00ffff, 0.8);
    this.exitMarker.setDepth(3);
    this.tweens.add({
      targets: this.exitMarker,
      alpha: { from: 0.4, to: 0.9 },
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    // UI
    this.connectionStatus = this.add.text(10, 10, 'Connecting...', {
      fontSize: '14px', color: '#ffff00',
    }).setScrollFactor(0).setDepth(20);

    this.playerCountText = this.add.text(10, 30, 'Players: 0', {
      fontSize: '12px', color: '#aaaaaa',
    }).setScrollFactor(0).setDepth(20);

    this.teamScoreText = this.add.text(10, 46, '团队价值: 0 / 1000', {
      fontSize: '16px', color: '#ffdd00',
    }).setScrollFactor(0).setDepth(20);

    this.statusText = this.add.text(10, 68, '', {
      fontSize: '12px', color: '#ff8844',
    }).setScrollFactor(0).setDepth(20);

    this.timerText = this.add.text(400, 10, '', {
      fontSize: '20px', color: '#ffffff', backgroundColor: '#00000080',
      padding: { x: 10, y: 6 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(20);

    this.evacText = this.add.text(400, 300, '', {
      fontSize: '28px', color: '#00ff00', align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

    this.messageText = this.add.text(400, 500, '', {
      fontSize: '18px', color: '#ffffff', align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    this.revivePrompt = this.add.text(400, 280, '', {
      fontSize: '16px', color: '#ff44ff', align: 'center',
      backgroundColor: '#00000099', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    this.staminaBar = this.add.graphics();
    this.staminaBar.setScrollFactor(0).setDepth(20);

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
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    // Mouse spray
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) this.isSpraying = true;
    });
    this.input.on('pointerup', () => { this.isSpraying = false; });

    // Title
    this.add.text(10, 88, '多人清扫撤离', {
      fontSize: '14px', color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.showMessage('多人清扫撤离！\n用水枪清扫污渍→收集宝物→团队价值1000后到撤离点撤离\n被怪物打倒后倒地，队友靠近按E复活！\nShift疾跑 | E躲藏/撤离/复活 | 左键喷射');
    this.time.delayedCall(6000, () => this.hideMessage());

    await this.connectToServer();
  }

  // ─── Server connection ─────────────────────────────────────

  private async connectToServer() {
    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'ws://localhost:2567';
      console.log('[CleanupMP] connect:start', { serverUrl });
      this.client = new Client(serverUrl);

      this.connectionStatus.setText('Joining room...');
      this.room = await this.client.joinOrCreate('cleanup');
      this.mySessionId = this.room.sessionId;
      console.log('[CleanupMP] connect:joined', { roomId: this.room.roomId, sessionId: this.mySessionId });

      this.connectionStatus.setText(`Connected! ID: ${this.mySessionId.slice(0, 8)}`);
      this.connectionStatus.setColor('#00ff00');

      this.setupStateListeners();

      this.room.onLeave((code) => {
        console.log('[CleanupMP] room:onLeave', { code });
        this.connectionStatus.setText(`Disconnected (code: ${code})`);
        this.connectionStatus.setColor('#ff0000');
      });
    } catch (error) {
      console.error('[CleanupMP] connect:error', error);
      this.connectionStatus.setText(`Connection Error: ${(error as Error).message}`);
      this.connectionStatus.setColor('#ff0000');
    }
  }

  // ─── State listeners ───────────────────────────────────────

  private setupStateListeners() {
    const state = this.room.state as any;

    // Obstacles
    state.obstacles.onAdd((obs: any, _id: string) => {
      this.obstacles.push({ x: obs.x, y: obs.y, w: obs.w, h: obs.h });
      this.rebuildMap();
    });
    state.obstacles.onRemove(() => { /* obstacles are static */ });

    // Hide spots
    state.hideSpots.onAdd((hs: any, _id: string) => {
      this.hideSpots.push({ x: hs.x, y: hs.y, w: hs.w, h: hs.h });
      this.rebuildMap();
    });

    // Players
    state.players.onAdd((player: any, sessionId: string) => {
      this.ensurePlayerRender(sessionId, player);
      this.observePlayer(sessionId, player);
    });
    state.players.onRemove((_player: any, sessionId: string) => {
      this.removePlayerRender(sessionId);
    });

    // Monsters
    state.monsters.onAdd((monster: any, monsterId: string) => {
      this.ensureMonsterRender(monsterId, monster);
      this.observeMonster(monsterId, monster);
    });
    state.monsters.onRemove((_monster: any, monsterId: string) => {
      this.removeMonsterRender(monsterId);
    });

    // Stains
    state.stains.onAdd((stain: any, stainId: string) => {
      this.ensureStainRender(stainId, stain);
      this.observeStain(stainId, stain);
    });
    state.stains.onRemove((_stain: any, stainId: string) => {
      this.removeStainRender(stainId);
    });

    // Loots
    state.loots.onAdd((loot: any, lootId: string) => {
      this.ensureLootRender(lootId, loot);
      this.observeLoot(lootId, loot);
    });
    state.loots.onRemove((_loot: any, lootId: string) => {
      this.removeLootRender(lootId);
    });

    // Phase changes (Colyseus 0.15: root state onChange fires on any field change)
    state.onChange(() => {
      const phase = state.phase as string;
      if (phase === 'won') {
        this.showMessage('🎉 撤离成功！\n按ESC返回菜单');
      } else if (phase === 'lost') {
        this.showMessage('💀 团队全灭！\n按ESC返回菜单');
      }
      const scoreStr = `团队价值: ${state.teamScore} / ${state.goalScore}`;
      if (this.teamScoreText.text !== scoreStr) {
        this.teamScoreText.setText(scoreStr);
      }
      if (state.teamScore >= state.goalScore) {
        this.teamScoreText.setColor('#00ff00');
      }
    });

    // Existing state (for late joiners)
    state.obstacles.forEach((obs: any) => {
      this.obstacles.push({ x: obs.x, y: obs.y, w: obs.w, h: obs.h });
    });
    state.hideSpots.forEach((hs: any) => {
      this.hideSpots.push({ x: hs.x, y: hs.y, w: hs.w, h: hs.h });
    });
    if (this.obstacles.length > 0) this.rebuildMap();

    state.players.forEach((player: any, sessionId: string) => {
      this.ensurePlayerRender(sessionId, player);
      this.observePlayer(sessionId, player);
    });
    state.monsters.forEach((monster: any, monsterId: string) => {
      this.ensureMonsterRender(monsterId, monster);
      this.observeMonster(monsterId, monster);
    });
    state.stains.forEach((stain: any, stainId: string) => {
      this.ensureStainRender(stainId, stain);
      this.observeStain(stainId, stain);
    });
    state.loots.forEach((loot: any, lootId: string) => {
      this.ensureLootRender(lootId, loot);
      this.observeLoot(lootId, loot);
    });
  }

  // ─── Observe helpers ───────────────────────────────────────

  private observePlayer(sessionId: string, player: any) {
    if (this.observedPlayers.has(sessionId)) return;
    this.observedPlayers.add(sessionId);

    player.onChange(() => {
      const render = this.playerRenders.get(sessionId);
      if (!render) return;

      // Store server position as interpolation target — actual setPosition happens in update() via lerp
      render.targetX = player.x;
      render.targetY = player.y;
      const isMe = sessionId === this.mySessionId;
      const isDown = player.state === 'down';
      const isDead = player.state === 'dead';

      if (isDown) {
        render.body.setFillStyle(0xff4444, 0.6);
        render.downIcon.setVisible(true);
      } else if (isDead) {
        render.body.setVisible(false);
        render.nameText.setVisible(false);
        render.downIcon.setVisible(false);
      } else {
        render.body.setVisible(true).setFillStyle(render.colorValue);
        render.downIcon.setVisible(false);
      }

      if (isMe && !this.cameraFollowSet) {
        // Camera follow — only set once
        this.cameras.main.startFollow(render.body, true, 0.1, 0.1);
        this.cameraFollowSet = true;
      }

      // Only update text if it changed (setText is expensive — triggers texture re-render)
      const newName = isMe ? '我' : sessionId.slice(0, 4);
      if (render.nameText.text !== newName) {
        render.nameText.setText(newName);
      }
      render.healthBarDirty = true;
    });
  }

  private observeMonster(monsterId: string, monster: any) {
    if (this.observedMonsters.has(monsterId)) return;
    this.observedMonsters.add(monsterId);

    monster.onChange(() => {
      const render = this.monsterRenders.get(monsterId);
      if (!render) return;
      // Store server position as interpolation target — actual setPosition happens in update() via lerp
      render.targetX = monster.x;
      render.targetY = monster.y;

      if (monster.stunTimer > 0) {
        render.sprite.setFillStyle(0x666666);
      } else if (monster.isChasing) {
        render.sprite.setFillStyle(monster.isHunter ? 0xff00ff : 0xff4400);
      } else {
        render.sprite.setFillStyle(monster.isHunter ? 0xaa00aa : 0xff8800);
      }
    });
  }

  private observeStain(stainId: string, stain: any) {
    if (this.observedStains.has(stainId)) return;
    this.observedStains.add(stainId);

    stain.onChange(() => {
      const render = this.stainRenders.get(stainId);
      if (!render) return;
      if (stain.cleaned) {
        render.sprite.setVisible(false);
      } else {
        const alpha = Math.max(0, stain.cleanliness / 100) * 0.7;
        render.sprite.setAlpha(alpha);
      }
    });
  }

  private observeLoot(lootId: string, loot: any) {
    if (this.observedLoots.has(lootId)) return;
    this.observedLoots.add(lootId);

    loot.onChange(() => {
      const render = this.lootRenders.get(lootId);
      if (!render) return;
      if (loot.collected) {
        render.sprite.setVisible(false);
      } else {
        render.sprite.setVisible(true);
        render.sprite.setPosition(loot.x, loot.y);
      }
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

    this.playerRenders.set(sessionId, { body, nameText, healthBar, downIcon, healthBarDirty: true, colorValue: color, targetX: player.x, targetY: player.y });
  }

  private ensureMonsterRender(monsterId: string, monster: any) {
    if (this.monsterRenders.has(monsterId)) return;
    const sprite = this.add.rectangle(monster.x, monster.y, 24, 24, monster.isHunter ? 0xff00ff : 0xff8800);
    sprite.setDepth(5);
    this.monsterRenders.set(monsterId, { sprite, targetX: monster.x, targetY: monster.y });
  }

  private ensureStainRender(stainId: string, stain: any) {
    if (this.stainRenders.has(stainId)) return;
    const g = this.add.graphics();
    const colors = [0x552222, 0x224422, 0x443311, 0x332233];
    const color = Phaser.Utils.Array.GetRandom(colors);
    g.fillStyle(color, 0.7);
    g.beginPath();
    const points = 8;
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * Math.PI * 2;
      const r = stain.radius * (0.7 + Math.random() * 0.4);
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillPath();
    g.setPosition(stain.x, stain.y);
    g.setDepth(2);
    this.stainRenders.set(stainId, { sprite: g });
  }

  private ensureLootRender(lootId: string, loot: any) {
    if (this.lootRenders.has(lootId)) return;
    const color = LOOT_COLORS[loot.type] || 0xffdd00;
    const pulse = this.add.circle(0, 0, 10, color);
    pulse.setStrokeStyle(2, 0xffffff);
    const container = this.add.container(loot.x, loot.y, [pulse]);
    container.setDepth(4);
    this.tweens.add({
      targets: pulse,
      scale: { from: 0.8, to: 1.3 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
    this.lootRenders.set(lootId, { sprite: container, pulse });
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

  private removeMonsterRender(monsterId: string) {
    const r = this.monsterRenders.get(monsterId);
    if (r) r.sprite.destroy();
    this.monsterRenders.delete(monsterId);
    this.observedMonsters.delete(monsterId);
  }

  private removeStainRender(stainId: string) {
    const r = this.stainRenders.get(stainId);
    if (r) r.sprite.destroy();
    this.stainRenders.delete(stainId);
    this.observedStains.delete(stainId);
  }

  private removeLootRender(lootId: string) {
    const r = this.lootRenders.get(lootId);
    if (r) {
      this.tweens.killTweensOf(r.pulse);
      r.sprite.destroy();
    }
    this.lootRenders.delete(lootId);
    this.observedLoots.delete(lootId);
  }

  // ─── Map rendering ─────────────────────────────────────────

  private rebuildMap() {
    if (this.mapBuilt) return;
    // Wait until we have obstacles
    if (this.obstacles.length === 0) return;
    this.mapBuilt = true;

    const mapW = (this.room.state as any).mapWidth || 2400;
    const mapH = (this.room.state as any).mapHeight || 1600;

    this.cameras.main.setBounds(0, 0, mapW, mapH);
    this.cameras.main.setZoom(0.8);

    const g = this.mapGraphics;
    g.clear();

    // Floor
    g.fillStyle(0x1a1a2e, 1);
    g.fillRect(0, 0, mapW, mapH);

    // Grid
    g.lineStyle(1, 0x222244, 0.3);
    for (let x = 0; x < mapW; x += 80) g.lineBetween(x, 0, x, mapH);
    for (let y = 0; y < mapH; y += 80) g.lineBetween(0, y, mapW, y);

    // Walls
    g.fillStyle(0x3a3a55, 1);
    for (const obs of this.obstacles) {
      g.fillRect(obs.x, obs.y, obs.w, obs.h);
      g.lineStyle(1, 0x555577, 0.5);
      g.strokeRect(obs.x, obs.y, obs.w, obs.h);
    }

    // Hide spots
    g.fillStyle(0x1a2a4e, 0.6);
    for (const hs of this.hideSpots) {
      g.fillRect(hs.x, hs.y, hs.w, hs.h);
      g.lineStyle(2, 0x4466aa, 0.4);
      g.strokeRect(hs.x, hs.y, hs.w, hs.h);
    }

    // Exit marker position
    this.exitMarker.setPosition((this.room.state as any).exitX, (this.room.state as any).exitY);

    // Create fog
    this.createFog();
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

  private drawFog(screenX: number, screenY: number, blind: boolean) {
    const ctx = this.fogCtx;
    const radius = blind ? VIEW_RADIUS * 0.3 : VIEW_RADIUS;

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

    const myPlayer = this.room?.state?.players?.get(this.mySessionId) as any;
    if (!myPlayer) return;

    // E key: hide / revive / evac
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      // Check if near a downed player → revive
      let revived = false;
      this.room.state.players.forEach((p: any, sid: string) => {
        if (sid === this.mySessionId || p.state !== 'down') return;
        const dist = Math.hypot(p.x - myPlayer.x, p.y - myPlayer.y);
        if (dist < 50) {
          this.room.send('revive', { targetId: sid });
          revived = true;
        }
      });
      if (!revived) {
        this.room.send('hide');
      }
    }

    // Movement input
    let inputX = 0, inputY = 0;
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) inputX -= 1;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) inputX += 1;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) inputY -= 1;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) inputY += 1;

    const wantSprint = this.shiftKey.isDown && (inputX !== 0 || inputY !== 0);

    // Aim angle
    const pointer = this.input.activePointer;
    const cam = this.cameras.main;
    // NOTE: Use cam.worldView (not cam.scrollX/Y) because Phaser 3.90 scrollX != worldView.x when zoom != 1
    const mouseWorldX = pointer.x / cam.zoom + cam.worldView.x;
    const mouseWorldY = pointer.y / cam.zoom + cam.worldView.y;
    this.aimAngle = Math.atan2(mouseWorldY - myPlayer.y, mouseWorldX - myPlayer.x);

    // Send move — throttle to ~20Hz instead of every frame (60Hz)
    // Only send when input actually changes or every 50ms
    this.moveAccumulator += delta;
    const inputChanged = inputX !== this.lastInputX || inputY !== this.lastInputY;
    const sprintChanged = wantSprint !== this.lastSprintSent;
    const rotChanged = Math.abs(this.aimAngle - this.lastRotationSent) > 0.05;

    if (myPlayer.state === 'alive' && !myPlayer.isHidden) {
      if (inputChanged || sprintChanged || rotChanged || this.moveAccumulator >= 50) {
        this.room.send('move', {
          inputX, inputY,
          sprint: wantSprint,
          rotation: this.aimAngle,
          dt: Math.min(this.moveAccumulator, 50) || delta,
        });
        this.lastInputX = inputX;
        this.lastInputY = inputY;
        this.lastSprintSent = wantSprint;
        this.lastRotationSent = this.aimAngle;
        this.moveAccumulator = 0;
      }
    }

    // Send spray — only when state or angle changes significantly
    const sprayAngleChanged = Math.abs(this.aimAngle - this.lastSprayAngleSent) > 0.05;
    if (this.isSpraying !== this.lastSpraySent || (this.isSpraying && sprayAngleChanged)) {
      this.room.send('spray', {
        spraying: this.isSpraying,
        angle: this.aimAngle,
      });
      this.lastSpraySent = this.isSpraying;
      this.lastSprayAngleSent = this.aimAngle;
    }

    // Draw spray cone for local player — only redraw if spraying (avoid clear() every frame when idle)
    if (this.isSpraying && myPlayer.state === 'alive' && !myPlayer.isHidden) {
      this.sprayGraphics.clear();
      this.sprayGraphicsDirty = true;
      const px = myPlayer.x;
      const py = myPlayer.y;
      const a = this.aimAngle;
      const halfAngle = Math.PI / 6;
      const range = 160;

      this.sprayGraphics.fillStyle(0x44aaff, 0.2);
      this.sprayGraphics.beginPath();
      this.sprayGraphics.moveTo(px, py);
      this.sprayGraphics.lineTo(px + Math.cos(a - halfAngle) * range, py + Math.sin(a - halfAngle) * range);
      this.sprayGraphics.lineTo(px + Math.cos(a + halfAngle) * range, py + Math.sin(a + halfAngle) * range);
      this.sprayGraphics.closePath();
      this.sprayGraphics.fillPath();

      this.sprayGraphics.fillStyle(0x88ccff, 0.35);
      this.sprayGraphics.beginPath();
      this.sprayGraphics.moveTo(px, py);
      this.sprayGraphics.lineTo(px + Math.cos(a - halfAngle * 0.4) * range, py + Math.sin(a - halfAngle * 0.4) * range);
      this.sprayGraphics.lineTo(px + Math.cos(a + halfAngle * 0.4) * range, py + Math.sin(a + halfAngle * 0.4) * range);
      this.sprayGraphics.closePath();
      this.sprayGraphics.fillPath();
    } else if (this.sprayGraphicsDirty) {
      // Clear once when spray stops
      this.sprayGraphics.clear();
      this.sprayGraphicsDirty = false;
    }

    // Update health bars for all players — only redraw if dirty (set in onChange)
    this.playerRenders.forEach((render, sid) => {
      const p = this.room.state.players.get(sid) as any;
      if (!p || !render.healthBarDirty) return;
      this.drawHealthBar(render, p);
      render.healthBarDirty = false;
    });

    // Interpolate remote entity positions toward server target (smooths 20Hz updates to 60fps)
    // Local player: snap directly (no jitter — server echoes our own input)
    this.playerRenders.forEach((render, sid) => {
      if (sid === this.mySessionId) {
        render.body.setPosition(render.targetX, render.targetY);
      } else {
        render.body.x = Phaser.Math.Linear(render.body.x, render.targetX, 0.2);
        render.body.y = Phaser.Math.Linear(render.body.y, render.targetY, 0.2);
      }
      // Name text & down icon follow the body
      render.nameText.setPosition(render.body.x, render.body.y - 22);
      const p = this.room.state.players.get(sid) as any;
      if (p && p.state === 'down') {
        render.downIcon.setPosition(render.body.x, render.body.y - 20);
      }
    });
    this.monsterRenders.forEach((render) => {
      render.sprite.x = Phaser.Math.Linear(render.sprite.x, render.targetX, 0.2);
      render.sprite.y = Phaser.Math.Linear(render.sprite.y, render.targetY, 0.2);
    });

    // Fog — throttle to ~30Hz (visual difference is imperceptible above 30fps)
    this.fogAccumulator += delta;
    if (this.fogImage && this.fogCanvas && this.fogAccumulator >= 33) {
      // NOTE: Use cam.worldView (not cam.scrollX/Y) because Phaser 3.90 scrollX != worldView.x when zoom != 1
      const screenX = (myPlayer.x - cam.worldView.x) * cam.zoom;
      const screenY = (myPlayer.y - cam.worldView.y) * cam.zoom;
      this.drawFog(screenX, screenY, myPlayer.blindTimer > 0);
      this.fogAccumulator = 0;
    }

    // Stamina bar — throttle to ~15Hz, skip if unchanged
    const isSprinting = myPlayer.isSprinting || (this.shiftKey.isDown && (inputX !== 0 || inputY !== 0));
    this.staminaAccumulator += delta;
    if (this.staminaAccumulator >= 66) {
      const staminaChanged = Math.abs(myPlayer.stamina - this.lastStaminaVal) > 0.5;
      const sprintChanged = isSprinting !== this.lastSprintVal;
      if (staminaChanged || sprintChanged) {
        this.drawStaminaBar(myPlayer.stamina, isSprinting);
        this.lastStaminaVal = myPlayer.stamina;
        this.lastSprintVal = isSprinting;
      }
      this.staminaAccumulator = 0;
    }

    // Update UI text + revive prompt + player count — throttle to ~10Hz
    this.uiAccumulator += delta;
    if (this.uiAccumulator >= 100) {
      this.updateUI(myPlayer);
      const nearDowned: string[] = [];
      let aliveCount = 0;
      this.room.state.players.forEach((p: any, sid: string) => {
        if (p.state === 'alive' || p.state === 'down') aliveCount++;
        if (sid === this.mySessionId || p.state !== 'down') return;
        const dist = Math.hypot(p.x - myPlayer.x, p.y - myPlayer.y);
        if (dist < 50) nearDowned.push(sid);
      });
      if (nearDowned.length > 0 && myPlayer.state === 'alive') {
        const promptStr = `按 E 复活队友 ${nearDowned.slice(0, 4).join(', ')}!`;
        if (this.revivePrompt.text !== promptStr) this.revivePrompt.setText(promptStr);
        this.revivePrompt.setVisible(true);
      } else {
        this.revivePrompt.setVisible(false);
      }
      const countStr = `Players: ${this.room.state.players.size} (${aliveCount} alive)`;
      if (this.playerCountText.text !== countStr) this.playerCountText.setText(countStr);
      this.uiAccumulator = 0;
    }
  }

  /** Draw a player's health bar onto its Graphics object */
  private drawHealthBar(render: PlayerRender, p: any) {
    render.healthBar.clear();
    const barW = 30;
    const barH = 4;
    // Use interpolated body position (not raw server p.x/p.y) so bar stays attached to sprite
    const bx = render.body.x - barW / 2;
    const by = render.body.y + 16;

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

    // Down timer ring
    if (p.state === 'down') {
      const downPct = 1 - (p.downTimer / 15000);
      render.healthBar.fillStyle(0xff0000, 0.5);
      render.healthBar.fillRect(bx, by + barH + 1, barW * downPct, 2);

      // Revive progress
      if (p.reviveProgress > 0) {
        render.healthBar.fillStyle(0x00ff00, 0.9);
        render.healthBar.fillRect(bx, by + barH + 4, barW * (p.reviveProgress / 100), 2);
      }
    }
  }

  // ─── UI updates ────────────────────────────────────────────

  private updateUI(myPlayer: any) {
    // Status effects
    const effects: string[] = [];
    if (myPlayer.hasShield) effects.push('🛡护盾');
    if (myPlayer.blindTimer > 0) effects.push('👁致盲');
    if (myPlayer.slowTimer > 0) effects.push('🐌减速');
    const effectsStr = effects.join(' ');
    if (this.statusText.text !== effectsStr) this.statusText.setText(effectsStr);

    // Timer
    const state = this.room.state as any;
    let timerStr: string;
    if (state.phase === 'active' && state.roundEndsAt > 0) {
      const remaining = Math.max(0, state.roundEndsAt - Date.now());
      const sec = Math.ceil(remaining / 1000);
      const min = Math.floor(sec / 60);
      const s = sec % 60;
      timerStr = `${min}:${s.toString().padStart(2, '0')}`;
    } else if (state.phase === 'waiting') {
      timerStr = 'Waiting...';
    } else if (state.phase === 'won') {
      timerStr = 'WIN!';
    } else if (state.phase === 'lost') {
      timerStr = 'LOST';
    } else {
      timerStr = '';
    }
    if (this.timerText.text !== timerStr) this.timerText.setText(timerStr);

    // Evac text
    const distToExit = Math.hypot(myPlayer.x - state.exitX, myPlayer.y - state.exitY);
    let evacStr: string;
    if (distToExit < 40 && state.teamScore >= state.goalScore && myPlayer.state === 'alive') {
      evacStr = '按 E 撤离！';
    } else if (distToExit < 40 && state.teamScore < state.goalScore) {
      evacStr = `还需 ${state.goalScore - state.teamScore} 价值`;
    } else {
      evacStr = '';
    }
    if (this.evacText.text !== evacStr) this.evacText.setText(evacStr);
  }

  private drawStaminaBar(stamina: number, isSprinting: boolean) {
    const g = this.staminaBar;
    g.clear();

    const barW = 200;
    const barH = 10;
    const barX = 10;
    const barY = 86;

    g.fillStyle(0x222222, 0.8);
    g.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);

    const pct = stamina / 100;
    const fillW = barW * pct;
    if (isSprinting) {
      g.fillStyle(0xffcc00, 0.9);
    } else if (stamina < 5) {
      g.fillStyle(0xff4444, 0.9);
    } else {
      g.fillStyle(0x44ff44, 0.9);
    }
    g.fillRect(barX, barY, fillW, barH);

    g.lineStyle(1, 0x888888, 0.6);
    g.strokeRect(barX, barY, barW, barH);
  }

  // ─── Message ───────────────────────────────────────────────

  private showMessage(text: string) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
  }

  private hideMessage() {
    this.messageText.setVisible(false);
  }
}
