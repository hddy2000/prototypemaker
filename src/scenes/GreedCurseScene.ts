import Phaser from 'phaser';

// ── 贪婪诅咒 (Curse of Greed) 单机制验证场景 ─────────────────────────────
// 核心机制：每拾取一个宝藏增加贪婪值，贪婪越高世界越敌对
// 0-30: 正常 | 30-60: 雾变浓+怪物加速 | 60-80: 新怪物生成 | 80-100: 暗影追猎者出现
// 出口需要贪婪≥40才开启，但≥80时出口会移动
// 玩家可在祭坛丢弃宝藏降贪婪值（丢掉的分数减半）

interface Treasure {
  x: number;
  y: number;
  value: number;
  weight: number;       // 贪婪增加值
  collected: boolean;
  detected: boolean;
  revealed: boolean;
  sprite: Phaser.GameObjects.Container;
}

interface Monster {
  sprite: Phaser.GameObjects.Rectangle;
  speed: number;
  chaseSpeed: number;
  direction: Phaser.Math.Vector2;
  patrolTimer: number;
  isChasing: boolean;
  visionRange: number;
  homeX: number;
  homeY: number;
  territoryRadius: number;
  giveUpTimer: number;
  giveUpDuration: number;
  alive: boolean;
}

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Altar {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Container;
  used: boolean;
}

export class GreedCurseScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;
  private qKey!: Phaser.Input.Keyboard.Key;    // 丢弃宝藏
  private shiftKey!: Phaser.Input.Keyboard.Key;

  // Map
  private mapWidth = 2400;
  private mapHeight = 1600;
  private obstacles: Obstacle[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Fog of war
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'greedFog';
  private baseViewRadius = 180;
  private screenW = 800;
  private screenH = 600;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private treasures: Treasure[] = [];
  private monsters: Monster[] = [];
  private altars: Altar[] = [];
  private exit!: Phaser.GameObjects.Rectangle;
  private exitActive = false;

  // 贪婪系统 (核心)
  private greed = 0;
  private maxGreed = 100;
  private shadowStalker: Monster | null = null;  // 贪婪≥80时出现的暗影追猎者

  // Player stats
  private health = 100;
  private money = 0;

  // UI
  private healthText!: Phaser.GameObjects.Text;
  private moneyText!: Phaser.GameObjects.Text;
  private greedText!: Phaser.GameObjects.Text;
  private greedBarFill!: Phaser.GameObjects.Rectangle;   // 贪婪条填充
  private detectorText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private staminaText!: Phaser.GameObjects.Text;

  // Detector
  private detectorRange = 120;
  private detectorCooldown = 0;

  // Game state
  private isDead = false;
  private isEscaped = false;
  private damageCooldown = 0;

  // Sprint / stamina
  private stamina = 100;
  private maxStamina = 100;
  private staminaDepleted = false;

  // 出口移动计时（贪婪≥80时）
  private exitMoveTimer = 0;

  constructor() {
    super({ key: 'GreedCurseScene' });
  }

  create() {
    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateObstacles();
    this.drawMap();
    this.createPlayer();
    this.createTreasures();
    this.createMonsters();
    this.createAltars();
    this.createExit();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('贪婪诅咒验证\n拾取宝藏增加贪婪值\n贪婪越高世界越危险\n[空格]探测 [E]显形 [Q]在祭坛丢弃降贪婪\n出口需贪婪≥40开启');
    this.time.delayedCall(5000, () => this.hideMessage());
  }

  // ── Map Generation ───────────────────────────────────────────────────────

  private generateObstacles() {
    this.obstacles = [];

    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    const obstacleCount = 60;
    for (let i = 0; i < obstacleCount; i++) {
      const isHorizontal = Math.random() > 0.5;
      const w = isHorizontal ? Phaser.Math.Between(60, 200) : Phaser.Math.Between(30, 60);
      const h = isHorizontal ? Phaser.Math.Between(30, 60) : Phaser.Math.Between(60, 200);
      const x = Phaser.Math.Between(100, this.mapWidth - 100 - w);
      const y = Phaser.Math.Between(100, this.mapHeight - 100 - h);

      const nearStart = x < 200 && y < 200;
      const nearExit = x + w > this.mapWidth - 200 && y + h > this.mapHeight - 200;
      if (nearStart || nearExit) continue;

      this.obstacles.push({ x, y, w, h });
    }
  }

  private drawMap() {
    this.mapGraphics = this.add.graphics();

    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

    this.mapGraphics.lineStyle(1, 0x222244, 0.3);
    for (let x = 0; x < this.mapWidth; x += 80) {
      this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += 80) {
      this.mapGraphics.lineBetween(0, y, this.mapWidth, y);
    }

    this.mapGraphics.fillStyle(0x333355, 1);
    for (const obs of this.obstacles) {
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
    }

    this.mapGraphics.lineStyle(2, 0x555577, 1);
    this.mapGraphics.strokeRect(20, 20, this.mapWidth - 40, this.mapHeight - 40);
  }

  private createPlayer() {
    this.player = this.add.rectangle(80, 80, 24, 24, 0x00ff00);
    this.player.setDepth(5);
  }

  private createTreasures() {
    const treasureCount = Phaser.Math.Between(12, 16);
    let placed = 0;
    let attempts = 0;

    while (placed < treasureCount && attempts < 500) {
      const x = Phaser.Math.Between(100, this.mapWidth - 100);
      const y = Phaser.Math.Between(100, this.mapHeight - 100);

      const distToStart = Phaser.Math.Distance.Between(x, y, 80, 80);
      const distToExit = Phaser.Math.Distance.Between(x, y, this.mapWidth - 80, this.mapHeight - 80);
      if (distToStart < 200 || distToExit < 200) {
        attempts++;
        continue;
      }

      if (!this.isInsideObstacle(x, y, 12)) {
        const value = Phaser.Math.Between(100, 500);
        const weight = Phaser.Math.Between(12, 25); // 每个宝藏增加12-25贪婪
        const container = this.add.container(x, y);
        container.setDepth(4);

        const gem = this.add.rectangle(0, 0, 16, 16, 0xffdd00);
        gem.setRotation(Math.PI / 4);
        const glow = this.add.circle(0, 0, 20, 0xffdd00, 0.2);
        container.add([glow, gem]);
        container.setVisible(false);

        this.treasures.push({
          x, y, value, weight,
          collected: false,
          detected: false,
          revealed: false,
          sprite: container,
        });
        placed++;
      }
      attempts++;
    }
  }

  private createMonsters() {
    const monsterCount = Phaser.Math.Between(6, 8); // 初始较少，贪婪高时会生成更多
    let placed = 0;
    let attempts = 0;

    while (placed < monsterCount && attempts < 500) {
      const x = Phaser.Math.Between(200, this.mapWidth - 200);
      const y = Phaser.Math.Between(200, this.mapHeight - 200);

      const distToPlayer = Phaser.Math.Distance.Between(x, y, 80, 80);
      if (distToPlayer < 400) {
        attempts++;
        continue;
      }

      if (!this.isInsideObstacle(x, y, 12)) {
        const sprite = this.add.rectangle(x, y, 24, 24, 0xff8800);
        sprite.setDepth(5);

        this.monsters.push({
          sprite,
          speed: 30,
          chaseSpeed: 100,
          direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
          patrolTimer: Phaser.Math.Between(0, 3000),
          isChasing: false,
          visionRange: 200,
          homeX: x,
          homeY: y,
          territoryRadius: 300,
          giveUpTimer: 0,
          giveUpDuration: 2500,
          alive: true,
        });
        placed++;
      }
      attempts++;
    }
  }

  private createAltars() {
    // 3个祭坛，分布在地图各处
    const altarCount = 3;
    let placed = 0;
    let attempts = 0;

    while (placed < altarCount && attempts < 500) {
      const x = Phaser.Math.Between(300, this.mapWidth - 300);
      const y = Phaser.Math.Between(300, this.mapHeight - 300);

      if (!this.isInsideObstacle(x, y, 30)) {
        const container = this.add.container(x, y);
        container.setDepth(3);

        const base = this.add.rectangle(0, 0, 50, 50, 0x4a0040, 0.8);
        base.setStrokeStyle(2, 0xaa00aa, 1);
        const rune = this.add.text(0, 0, '✦', {
          fontSize: '28px', color: '#cc88ff',
        }).setOrigin(0.5);
        container.add([base, rune]);

        this.tweens.add({
          targets: rune,
          alpha: { from: 0.5, to: 1 },
          duration: 1000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.inOut',
        });

        this.altars.push({ x, y, sprite: container, used: false });
        placed++;
      }
      attempts++;
    }
  }

  private createExit() {
    this.exit = this.add.rectangle(this.mapWidth - 80, this.mapHeight - 80, 40, 40, 0x444444);
    this.exit.setAlpha(0.6);
    this.exit.setDepth(4);
  }

  // ── Fog of War (贪婪影响雾浓度) ──────────────────────────────────────────

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

    this.drawFog(this.screenW / 2, this.screenH / 2);
  }

  private getViewRadius(): number {
    // 贪婪30-60: 视野-30%; 60-80: -50%; 80-100: -65%
    if (this.greed < 30) return this.baseViewRadius;
    if (this.greed < 60) return this.baseViewRadius * 0.7;
    if (this.greed < 80) return this.baseViewRadius * 0.5;
    return this.baseViewRadius * 0.35;
  }

  private getFogAlpha(): number {
    // 贪婪越高雾越浓
    if (this.greed < 30) return 0.92;
    if (this.greed < 60) return 0.95;
    if (this.greed < 80) return 0.97;
    return 0.98;
  }

  private drawFog(screenX: number, screenY: number) {
    const ctx = this.fogCtx;
    const vr = this.getViewRadius();
    const alpha = this.getFogAlpha();

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fillRect(0, 0, this.screenW, this.screenH);

    ctx.globalCompositeOperation = 'destination-out';
    const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, vr);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(screenX, screenY, vr, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';

    // 贪婪≥80时叠加红色雾
    if (this.greed >= 80) {
      ctx.fillStyle = 'rgba(40, 0, 0, 0.15)';
      ctx.fillRect(0, 0, this.screenW, this.screenH);
    }

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

    this.moneyText = this.add.text(16, 40, '金币: $0', {
      fontSize: '18px', color: '#ffff00',
    }).setScrollFactor(0).setDepth(20);

    // 贪婪条
    this.add.text(16, 68, '贪婪', {
      fontSize: '14px', color: '#ff44ff',
    }).setScrollFactor(0).setDepth(20);

    this.add.rectangle(60, 74, 154, 16, 0x333333).setScrollFactor(0).setDepth(20);
    this.greedBarFill = this.add.rectangle(61, 75, 0, 14, 0xff44ff).setScrollFactor(0).setDepth(20).setOrigin(0, 0.5);

    this.greedText = this.add.text(220, 68, '0/100', {
      fontSize: '14px', color: '#ff44ff',
    }).setScrollFactor(0).setDepth(20);

    this.detectorText = this.add.text(16, 92, '探测器: 就绪 [空格] | [E显形] | [Q祭坛丢弃]', {
      fontSize: '14px', color: '#00ffff',
    }).setScrollFactor(0).setDepth(20);

    this.staminaText = this.add.text(16, 112, '体力: 100 [Shift冲刺]', {
      fontSize: '14px', color: '#88ff88',
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

    this.add.text(400, 585, 'WASD移动 • 空格探测 • E显形宝藏 • Q祭坛丢弃降贪婪 • 拾取宝藏+贪婪 • 贪婪≥40出口开启 • 暗影追猎者接触即死', {
      fontSize: '11px', color: '#666666',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
  }

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = {
      W: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      A: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      S: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      D: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.qKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
  }

  // ── Update Loop ──────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.isDead || this.isEscaped) return;

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    this.handlePlayerMovement(delta);
    this.handleDetector();
    this.handleReveal();
    this.handleAltarDiscard();
    this.updateGreedEffects(delta);
    this.updateMonsters(delta);
    this.updateShadowStalker(delta);
    this.checkCollisions();
    this.checkExit();
    this.updateFog();

    if (this.damageCooldown > 0) this.damageCooldown -= delta;
    if (this.detectorCooldown > 0) this.detectorCooldown -= delta;
  }

  // ── Player Movement ──────────────────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    const baseSpeed = 160;
    const sprintSpeed = 280;
    const dt = delta / 1000;

    const wantsSprint = this.shiftKey.isDown && !this.staminaDepleted;
    const isMoving = this.cursors.left.isDown || this.cursors.right.isDown ||
                     this.cursors.up.isDown || this.cursors.down.isDown ||
                     this.wasdKeys.A.isDown || this.wasdKeys.D.isDown ||
                     this.wasdKeys.W.isDown || this.wasdKeys.S.isDown;
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

    const speed = isSprinting ? sprintSpeed : baseSpeed;

    let vx = 0, vy = 0;
    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) vx -= speed;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) vx += speed;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) vy -= speed;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) vy += speed;

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

  // ── Detector ─────────────────────────────────────────────────────────────

  private handleDetector() {
    if (this.detectorCooldown > 0) return;

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.detectorCooldown = 800;

      let nearestDist = Infinity;
      for (const t of this.treasures) {
        if (t.collected) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, t.x, t.y);
        if (d < nearestDist) nearestDist = d;
        if (d < this.detectorRange * 2.5) t.detected = true;
      }

      if (nearestDist < this.detectorRange) {
        this.detectorText.setText('探测器: 滴滴滴！按 [E] 显形！');
        this.detectorText.setColor('#ff0000');
      } else if (nearestDist < this.detectorRange * 2.5) {
        this.detectorText.setText('探测器: 滴...滴...');
        this.detectorText.setColor('#ffff00');
      } else {
        this.detectorText.setText('探测器: ...');
        this.detectorText.setColor('#00ffff');
      }

      this.time.delayedCall(2000, () => {
        if (!this.isDead && !this.isEscaped) {
          this.detectorText.setText('探测器: 就绪 [空格] | [E显形] | [Q祭坛丢弃]');
          this.detectorText.setColor('#00ffff');
        }
      });
    }
  }

  private handleReveal() {
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      let revealedAny = false;
      for (const t of this.treasures) {
        if (t.collected || t.revealed) continue;
        if (!t.detected) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, t.x, t.y);
        if (d < this.detectorRange * 2.5) {
          t.revealed = true;
          t.sprite.setVisible(true);
          this.tweens.add({
            targets: t.sprite, scale: { from: 0.8, to: 1.3 },
            duration: 600, yoyo: true, repeat: -1, ease: 'Sine.inOut',
          });
          revealedAny = true;
        }
      }
      if (revealedAny) {
        this.showMessage('宝藏已显形！快去拾取！');
        this.time.delayedCall(1500, () => this.hideMessage());
      }
    }
  }

  // ── 祭坛丢弃 (降贪婪) ────────────────────────────────────────────────────

  private handleAltarDiscard() {
    if (Phaser.Input.Keyboard.JustDown(this.qKey)) {
      for (const altar of this.altars) {
        if (altar.used) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, altar.x, altar.y);
        if (d < 40) {
          // 丢弃一半金钱，降低贪婪
          const refund = Math.floor(this.money * 0.5);
          const greedReduce = Math.min(this.greed, 35);
          this.money = refund;
          this.greed = Math.max(0, this.greed - greedReduce);
          this.moneyText.setText(`金币: $${this.money}`);
          this.updateGreedUI();
          altar.used = true;
          (altar.sprite.list[0] as Phaser.GameObjects.Rectangle).setFillStyle(0x222222, 0.5); // 祭坛变暗

          this.showMessage(`祭坛净化！\n贪婪 -${greedReduce}\n金币保留 $${refund}`);
          this.time.delayedCall(2000, () => this.hideMessage());

          // 视觉效果
          this.cam.flash(300, 150, 0, 200);
          return;
        }
      }
      this.showMessage('附近没有可用祭坛');
      this.time.delayedCall(1200, () => this.hideMessage());
    }
  }

  // ── 贪婪系统 (核心) ──────────────────────────────────────────────────────

  private addGreed(amount: number) {
    const oldGreed = this.greed;
    this.greed = Math.min(this.maxGreed, this.greed + amount);
    this.updateGreedUI();

    // 阶段变化提示
    if (oldGreed < 30 && this.greed >= 30) {
      this.showMessage('⚠ 贪婪觉醒！雾变浓了，怪物更警觉...');
      this.time.delayedCall(2000, () => this.hideMessage());
    } else if (oldGreed < 60 && this.greed >= 60) {
      this.showMessage('⚠ 贪婪腐蚀！新怪物从暗处涌出！');
      this.time.delayedCall(2000, () => this.hideMessage());
      this.spawnExtraMonsters(2);
    } else if (oldGreed < 80 && this.greed >= 80) {
      this.showMessage('⚠ 贪婪之影降临！暗影追猎者出现了！\n出口开始移动！');
      this.time.delayedCall(3000, () => this.hideMessage());
      this.spawnShadowStalker();
    }
  }

  private updateGreedUI() {
    const pct = this.greed / this.maxGreed;
    this.greedBarFill.width = 152 * pct;
    this.greedText.setText(`${this.greed}/100`);

    // 颜色随阶段变化
    let color = 0xff44ff;
    if (this.greed >= 80) color = 0xff0000;
    else if (this.greed >= 60) color = 0xff4444;
    else if (this.greed >= 30) color = 0xff8844;
    this.greedBarFill.setFillStyle(color);
    this.greedText.setColor(`#${color.toString(16).padStart(6, '0')}`);
  }

  private updateGreedEffects(delta: number) {
    // 贪婪≥60时定期生成新怪物
    if (this.greed >= 60 && this.greed < 80) {
      if (!this._extraSpawnTimer) this._extraSpawnTimer = 0;
      this._extraSpawnTimer += delta;
      if (this._extraSpawnTimer >= 15000) { // 每15秒
        this._extraSpawnTimer = 0;
        this.spawnExtraMonsters(1);
      }
    }

    // 出口行为
    this.updateExit(delta);
  }

  private _extraSpawnTimer = 0;

  private spawnExtraMonsters(count: number) {
    for (let i = 0; i < count; i++) {
      let x = 0, y = 0;
      let found = false;
      for (let a = 0; a < 50; a++) {
        x = Phaser.Math.Between(200, this.mapWidth - 200);
        y = Phaser.Math.Between(200, this.mapHeight - 200);
        const distToPlayer = Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y);
        if (distToPlayer > 300 && !this.isInsideObstacle(x, y, 12)) {
          found = true;
          break;
        }
      }
      if (!found) continue;

      const sprite = this.add.rectangle(x, y, 24, 24, 0xff4400);
      sprite.setDepth(5);
      sprite.setScale(0);
      this.tweens.add({
        targets: sprite, scale: { from: 0, to: 1 },
        duration: 400, ease: 'Back.easeOut',
      });

      this.monsters.push({
        sprite,
        speed: 35,
        chaseSpeed: 115,
        direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
        patrolTimer: 0,
        isChasing: false,
        visionRange: 250,
        homeX: x,
        homeY: y,
        territoryRadius: 400,
        giveUpTimer: 0,
        giveUpDuration: 3000,
        alive: true,
      });
    }
  }

  private spawnShadowStalker() {
    // 在远离玩家的位置生成暗影追猎者
    let x = this.mapWidth - 200;
    let y = 200;
    const sprite = this.add.rectangle(x, y, 32, 32, 0x000000);
    sprite.setDepth(6);
    sprite.setStrokeStyle(2, 0xff0000, 1);
    sprite.setScale(0);
    this.tweens.add({
      targets: sprite, scale: { from: 0, to: 1 },
      duration: 800, ease: 'Back.easeOut',
    });

    this.shadowStalker = {
      sprite,
      speed: 0,
      chaseSpeed: 130,
      direction: new Phaser.Math.Vector2(0, 0),
      patrolTimer: 0,
      isChasing: true,
      visionRange: 9999,
      homeX: x,
      homeY: y,
      territoryRadius: 9999,
      giveUpTimer: 0,
      giveUpDuration: 999999,
      alive: true,
    };
  }

  private updateShadowStalker(delta: number) {
    if (!this.shadowStalker || !this.shadowStalker.alive) return;
    // 贪婪降到80以下时暗影消失
    if (this.greed < 80) {
      this.shadowStalker.alive = false;
      this.shadowStalker.sprite.setVisible(false);
      this.shadowStalker = null;
      this.showMessage('暗影追猎者退去了...');
      this.time.delayedCall(1500, () => this.hideMessage());
      return;
    }

    const dt = delta / 1000;
    const dir = new Phaser.Math.Vector2(
      this.player.x - this.shadowStalker.sprite.x,
      this.player.y - this.shadowStalker.sprite.y
    );
    const dist = dir.length();
    if (dist > 1) {
      dir.normalize();
      // 穿墙
      this.shadowStalker.sprite.x += dir.x * this.shadowStalker.chaseSpeed * dt;
      this.shadowStalker.sprite.y += dir.y * this.shadowStalker.chaseSpeed * dt;
    }
  }

  private updateExit(delta: number) {
    // 贪婪≥40开启出口
    if (this.greed >= 40 && !this.exitActive) {
      this.exitActive = true;
      this.exit.setFillStyle(0x00ff00, 0.8);
      this.tweens.add({
        targets: this.exit,
        alpha: { from: 0.4, to: 1 },
        duration: 500, yoyo: true, repeat: -1,
      });
    } else if (this.greed < 40 && this.exitActive) {
      this.exitActive = false;
      this.exit.setFillStyle(0x444444, 0.6);
      this.tweens.killTweensOf(this.exit);
    }

    // 贪婪≥80时出口每10秒移动到随机位置
    if (this.greed >= 80 && this.exitActive) {
      this.exitMoveTimer += delta;
      if (this.exitMoveTimer >= 10000) {
        this.exitMoveTimer = 0;
        let nx = 0, ny = 0;
        for (let a = 0; a < 50; a++) {
          nx = Phaser.Math.Between(100, this.mapWidth - 100);
          ny = Phaser.Math.Between(100, this.mapHeight - 100);
          if (!this.isInsideObstacle(nx, ny, 30)) break;
        }
        this.exit.x = nx;
        this.exit.y = ny;
        this.showMessage('出口移动了！');
        this.time.delayedCall(1200, () => this.hideMessage());
      }
    }
  }

  // ── Monsters ─────────────────────────────────────────────────────────────

  private updateMonsters(delta: number) {
    const dt = delta / 1000;
    // 贪婪影响怪物速度
    const speedMul = this.greed >= 60 ? 1.2 : (this.greed >= 30 ? 1.1 : 1.0);

    for (const monster of this.monsters) {
      if (!monster.alive) continue;

      const distToPlayer = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y, this.player.x, this.player.y
      );

      const effectiveVision = Math.min(monster.visionRange, this.getViewRadius());
      const canSee = distToPlayer < effectiveVision &&
        !this.lineBlockedByObstacle(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y);

      if (canSee) {
        monster.isChasing = true;
        monster.giveUpTimer = monster.giveUpDuration;
      } else if (monster.giveUpTimer > 0) {
        monster.giveUpTimer -= delta;
        if (monster.giveUpTimer <= 0) monster.isChasing = false;
      }

      const distFromHome = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y, monster.homeX, monster.homeY
      );
      if (monster.isChasing && distFromHome > monster.territoryRadius) {
        monster.isChasing = false;
        monster.giveUpTimer = 0;
      }

      if (monster.isChasing) {
        const dir = new Phaser.Math.Vector2(
          this.player.x - monster.sprite.x,
          this.player.y - monster.sprite.y
        ).normalize();
        const newX = monster.sprite.x + dir.x * monster.chaseSpeed * speedMul * dt;
        const newY = monster.sprite.y + dir.y * monster.chaseSpeed * speedMul * dt;
        if (!this.isObstacleAt(newX, monster.sprite.y, 11)) monster.sprite.x = newX;
        if (!this.isObstacleAt(monster.sprite.x, newY, 11)) monster.sprite.y = newY;
      } else {
        monster.patrolTimer += delta;
        if (monster.patrolTimer > 3000) {
          monster.patrolTimer = 0;
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          monster.direction.set(Math.cos(angle), Math.sin(angle));
        }
        if (distFromHome > monster.territoryRadius * 0.8) {
          const toHome = new Phaser.Math.Vector2(
            monster.homeX - monster.sprite.x, monster.homeY - monster.sprite.y
          ).normalize();
          monster.direction.lerp(toHome, 0.1).normalize();
        }
        const newX = monster.sprite.x + monster.direction.x * monster.speed * speedMul * dt;
        const newY = monster.sprite.y + monster.direction.y * monster.speed * speedMul * dt;
        if (!this.isObstacleAt(newX, monster.sprite.y, 11)) monster.sprite.x = newX;
        else monster.direction.x *= -1;
        if (!this.isObstacleAt(monster.sprite.x, newY, 11)) monster.sprite.y = newY;
        else monster.direction.y *= -1;
      }
    }
  }

  // ── Collisions ───────────────────────────────────────────────────────────

  private checkCollisions() {
    // Treasures — 拾取增加贪婪
    for (const t of this.treasures) {
      if (t.collected) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, t.x, t.y);
      if (d < 30) {
        if (t.revealed) {
          t.collected = true;
          t.sprite.setVisible(false);
          this.tweens.killTweensOf(t.sprite);
          this.money += t.value;
          this.moneyText.setText(`金币: $${this.money}`);
          this.addGreed(t.weight);
          this.showMessage(`拾取宝藏！+$${t.value}\n贪婪 +${t.weight}`);
          this.time.delayedCall(1500, () => this.hideMessage());
        } else if (t.detected) {
          this.showMessage('先按 [E] 显形宝藏！');
          this.time.delayedCall(1200, () => this.hideMessage());
        } else {
          this.showMessage('先用探测器 [空格] 定位！');
          this.time.delayedCall(1200, () => this.hideMessage());
        }
      }
    }

    // Monsters
    if (this.damageCooldown <= 0) {
      for (const monster of this.monsters) {
        if (!monster.alive) continue;
        const d = Phaser.Math.Distance.Between(
          this.player.x, this.player.y, monster.sprite.x, monster.sprite.y
        );
        if (d < 28) {
          this.health -= 15;
          this.healthText.setText(`生命: ${this.health}`);
          this.damageCooldown = 800;
          const kx = this.player.x - monster.sprite.x;
          const ky = this.player.y - monster.sprite.y;
          const klen = Math.sqrt(kx * kx + ky * ky) || 1;
          this.player.x += (kx / klen) * 20;
          this.player.y += (ky / klen) * 20;
          if (this.health <= 0) this.die();
          break;
        }
      }
    }

    // Shadow Stalker — 接触即死
    if (this.shadowStalker && this.shadowStalker.alive) {
      const d = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        this.shadowStalker.sprite.x, this.shadowStalker.sprite.y
      );
      if (d < 30) {
        this.die('暗影追猎者吞噬了你！');
        return;
      }
    }
  }

  private checkExit() {
    if (!this.exitActive) return;
    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exit.x, this.exit.y);
    if (d < 35) this.escape();
  }

  private die(cause?: string) {
    this.isDead = true;
    this.player.setFillStyle(0x666666);
    this.showMessage(cause ? `💀 ${cause}\n\n按ESC返回菜单` : '💀 你死了...\n\n按ESC返回菜单');
  }

  private escape() {
    this.isEscaped = true;
    this.showMessage(`成功逃脱！\n总计: $${this.money}\n贪婪残留: ${this.greed}\n\n按ESC返回菜单`);
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
