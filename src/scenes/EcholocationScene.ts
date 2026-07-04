import Phaser from 'phaser';

// ── 回声定位 (Echolocation) 单机制验证场景 ───────────────────────────────
// 核心机制：按空格发出声波脉冲，短暂照亮周围地形和宝藏，但会惊动附近怪物
// 玩家面临抉择：要信息还是要隐蔽
// 静默移动时怪物几乎发现不了你，但你看不到路；频繁探路则引来杀身之祸

interface Treasure {
  x: number;
  y: number;
  value: number;
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
  revealTimer: number;   // 被脉冲扫过后持续显形的倒计时(ms)
}

interface Monster {
  sprite: Phaser.GameObjects.Rectangle;
  speed: number;
  chaseSpeed: number;
  direction: Phaser.Math.Vector2;
  patrolTimer: number;
  isChasing: boolean;
  isInvestigating: boolean;       // 正在前往声源调查
  investigateX: number;           // 声源X
  investigateY: number;           // 声源Y
  investigateTimer: number;       // 调查持续时间
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

interface Pulse {
  x: number;          // 世界坐标
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  ringGraphics: Phaser.GameObjects.Graphics;  // 脉冲环（画在雾上方）
}

export class EcholocationScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
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
  private fogTextureKey = 'echoFog';
  private viewRadius = 90;        // 基础视野很小（只能看到脚下）
  private screenW = 800;
  private screenH = 600;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private treasures: Treasure[] = [];
  private monsters: Monster[] = [];
  private exit!: Phaser.GameObjects.Rectangle;
  private pulses: Pulse[] = [];

  // Player stats
  private health = 100;
  private money = 0;

  // UI
  private healthText!: Phaser.GameObjects.Text;
  private moneyText!: Phaser.GameObjects.Text;
  private pulseText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private staminaText!: Phaser.GameObjects.Text;
  private alertText!: Phaser.GameObjects.Text;

  // Pulse
  private pulseCooldown = 0;
  private pulseMaxRadius = 350;

  // Game state
  private isDead = false;
  private isEscaped = false;
  private damageCooldown = 0;

  // Sprint / stamina
  private stamina = 100;
  private maxStamina = 100;
  private staminaDepleted = false;

  // Noise level — 累积噪音，影响怪物警觉度
  private noiseLevel = 0;

  constructor() {
    super({ key: 'EcholocationScene' });
  }

  create() {
    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateObstacles();
    this.drawMap();
    this.createPlayer();
    this.createTreasures();
    this.createMonsters();
    this.createExit();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('回声定位验证\n[空格] 发出声波（会惊动怪物）\n[Shift] 冲刺（也会产生噪音）\n静默移动最安全但看不见路');
    this.time.delayedCall(4000, () => this.hideMessage());
  }

  // ── Map Generation ───────────────────────────────────────────────────────

  private generateObstacles() {
    this.obstacles = [];

    // Border walls
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    // Scatter obstacles
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

    // Floor
    this.mapGraphics.fillStyle(0x0a0a14, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

    // Grid lines (very faint — only visible when pulsed)
    this.mapGraphics.lineStyle(1, 0x1a1a2e, 0.5);
    for (let x = 0; x < this.mapWidth; x += 80) {
      this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += 80) {
      this.mapGraphics.lineBetween(0, y, this.mapWidth, y);
    }

    // Obstacles
    this.mapGraphics.fillStyle(0x222244, 1);
    for (const obs of this.obstacles) {
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
    }

    // Border highlight
    this.mapGraphics.lineStyle(2, 0x333355, 1);
    this.mapGraphics.strokeRect(20, 20, this.mapWidth - 40, this.mapHeight - 40);
  }

  private createPlayer() {
    this.player = this.add.rectangle(80, 80, 24, 24, 0x00ffaa);
    this.player.setDepth(5);
  }

  private createTreasures() {
    const treasureCount = Phaser.Math.Between(8, 12);
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
        const container = this.add.container(x, y);
        container.setDepth(4);

        const gem = this.add.rectangle(0, 0, 16, 16, 0xffdd00);
        gem.setRotation(Math.PI / 4);
        const glow = this.add.circle(0, 0, 20, 0xffdd00, 0.2);
        container.add([glow, gem]);
        container.setVisible(false); // 宝藏默认不可见，只有脉冲照亮时才显形

        this.treasures.push({
          x, y, value,
          collected: false,
          sprite: container,
          revealTimer: 0,
        });
        placed++;
      }
      attempts++;
    }
  }

  private createMonsters() {
    const monsterCount = Phaser.Math.Between(8, 12);
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
        const sprite = this.add.rectangle(x, y, 24, 24, 0xff4488);
        sprite.setDepth(5);

        this.monsters.push({
          sprite,
          speed: 25,
          chaseSpeed: 95,
          direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
          patrolTimer: Phaser.Math.Between(0, 3000),
          isChasing: false,
          isInvestigating: false,
          investigateX: 0,
          investigateY: 0,
          investigateTimer: 0,
          homeX: x,
          homeY: y,
          territoryRadius: 400,
          giveUpTimer: 0,
          giveUpDuration: 2500,
          alive: true,
        });
        placed++;
      }
      attempts++;
    }
  }

  private createExit() {
    this.exit = this.add.rectangle(this.mapWidth - 80, this.mapHeight - 80, 40, 40, 0x00ffff);
    this.exit.setAlpha(0.8);
    this.exit.setDepth(4);
  }

  // ── Fog of War (极小基础视野) ────────────────────────────────────────────

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

    // 极浓的雾 — 基础视野只有 viewRadius (90px)
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.98)';
    ctx.fillRect(0, 0, this.screenW, this.screenH);

    // 1) 玩家基础视野 — 在雾上开洞
    ctx.globalCompositeOperation = 'destination-out';
    const pGrad = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, this.viewRadius);
    pGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
    pGrad.addColorStop(0.6, 'rgba(0, 0, 0, 0.8)');
    pGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = pGrad;
    ctx.beginPath();
    ctx.arc(screenX, screenY, this.viewRadius, 0, Math.PI * 2);
    ctx.fill();

    // 2) 脉冲在雾上开洞 — 脉冲范围内的雾被清除，露出下面的地图和宝藏
    for (const p of this.pulses) {
      // 脉冲圆环在屏幕上的位置
      const pulseScreenX = p.x - this.cam.scrollX;
      const pulseScreenY = p.y - this.cam.scrollY;
      // 只画在屏幕内的部分
      if (pulseScreenX + p.radius < 0 || pulseScreenX - p.radius > this.screenW ||
          pulseScreenY + p.radius < 0 || pulseScreenY - p.radius > this.screenH) continue;

      // 用脉冲alpha控制开洞强度 — 脉冲越淡洞越浅
      const holeAlpha = p.alpha * 0.95;
      const pGrad = ctx.createRadialGradient(
        pulseScreenX, pulseScreenY, Math.max(0, p.radius - 30),
        pulseScreenX, pulseScreenY, p.radius
      );
      pGrad.addColorStop(0, `rgba(0, 0, 0, ${holeAlpha})`);
      pGrad.addColorStop(0.8, `rgba(0, 0, 0, ${holeAlpha})`);
      pGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = pGrad;
      ctx.beginPath();
      ctx.arc(pulseScreenX, pulseScreenY, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    // 手动上传到 WebGL 纹理（Phaser 3.90 bug workaround）
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

    this.pulseText = this.add.text(16, 64, '声波: 就绪 [空格]', {
      fontSize: '16px', color: '#00ffcc',
    }).setScrollFactor(0).setDepth(20);

    this.staminaText = this.add.text(16, 88, '体力: 100 [Shift冲刺]', {
      fontSize: '16px', color: '#88ff88',
    }).setScrollFactor(0).setDepth(20);

    this.alertText = this.add.text(16, 112, '噪音: 0', {
      fontSize: '16px', color: '#888888',
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

    this.add.text(400, 585, 'WASD移动 • 空格声波(惊动怪物) • Shift冲刺(产生噪音) • 声波扫过宝藏显形2秒→走过去捡 • 拾取宝藏后到出口逃脱', {
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
    this.handlePulse();
    this.updatePulses(delta);
    this.updateMonsters(delta);
    this.updateNoise(delta);
    this.checkCollisions();
    this.checkExit();
    this.updateFog();

    if (this.damageCooldown > 0) this.damageCooldown -= delta;
    if (this.pulseCooldown > 0) this.pulseCooldown -= delta;
  }

  // ── Player Movement ──────────────────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    const baseSpeed = 150;
    const sprintSpeed = 260;
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
      // 冲刺产生噪音
      this.noiseLevel = Math.min(100, this.noiseLevel + 30 * dt);
    } else {
      this.stamina += 18 * dt;
      if (this.stamina >= this.maxStamina) this.stamina = this.maxStamina;
      if (this.staminaDepleted && this.stamina >= this.maxStamina * 0.3) this.staminaDepleted = false;
      // 普通移动产生少量噪音
      if (isMoving) this.noiseLevel = Math.min(100, this.noiseLevel + 8 * dt);
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

  // ── 声波脉冲 (核心机制) ──────────────────────────────────────────────────

  private handlePulse() {
    if (this.pulseCooldown > 0) {
      this.pulseText.setText(`声波: 冷却中 ${Math.ceil(this.pulseCooldown / 1000)}s`);
      this.pulseText.setColor('#ff8888');
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.pulseCooldown = 2500; // 2.5秒冷却
      this.emitPulse(this.player.x, this.player.y);
      this.noiseLevel = 100; // 声波产生最大噪音
      this.pulseText.setText('声波: 已发出！怪物被惊动了！');
      this.pulseText.setColor('#ff4444');

      this.time.delayedCall(2000, () => {
        if (!this.isDead && !this.isEscaped) {
          this.pulseText.setText('声波: 就绪 [空格]');
          this.pulseText.setColor('#00ffcc');
        }
      });
    }
  }

  private emitPulse(x: number, y: number) {
    // 脉冲环画在雾上方 (depth 11)
    const ringGraphics = this.add.graphics();
    ringGraphics.setDepth(11);
    this.pulses.push({
      x, y,
      radius: 0,
      maxRadius: this.pulseMaxRadius,
      alpha: 1,
      ringGraphics,
    });

    // 惊动附近怪物 — 在脉冲范围内的怪物前往声源调查
    for (const monster of this.monsters) {
      if (!monster.alive) continue;
      const dist = Phaser.Math.Distance.Between(x, y, monster.sprite.x, monster.sprite.y);
      if (dist < this.pulseMaxRadius) {
        monster.isInvestigating = true;
        monster.investigateX = x;
        monster.investigateY = y;
        monster.investigateTimer = 4000; // 调查4秒
      }
    }
  }

  private updatePulses(delta: number) {
    const dt = delta / 1000;
    const expandSpeed = 600; // px/s

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.radius += expandSpeed * dt;
      p.alpha = Math.max(0, 1 - p.radius / p.maxRadius);

      // 绘制脉冲环（画在雾上方，玩家能看到扩散的声波）
      p.ringGraphics.clear();
      p.ringGraphics.lineStyle(4, 0x00ffcc, p.alpha);
      p.ringGraphics.strokeCircle(p.x, p.y, p.radius);
      // 内圈淡光填充
      p.ringGraphics.fillStyle(0x00ffcc, p.alpha * 0.08);
      p.ringGraphics.fillCircle(p.x, p.y, p.radius);

      // 扫描宝藏 — 被脉冲扫到的宝藏持续显形2秒
      for (const t of this.treasures) {
        if (t.collected) continue;
        const dist = Phaser.Math.Distance.Between(p.x, p.y, t.x, t.y);
        // 宝藏刚好在脉冲环附近时被"照亮"
        if (dist <= p.radius + 20 && dist >= p.radius - 40) {
          t.revealTimer = 2000; // 持续显形2秒
        }
      }

      if (p.radius >= p.maxRadius) {
        p.ringGraphics.destroy();
        this.pulses.splice(i, 1);
      }
    }

    // 更新宝藏显形计时器
    for (const t of this.treasures) {
      if (t.collected) continue;
      if (t.revealTimer > 0) {
        t.revealTimer -= delta;
        t.sprite.setVisible(true);
        // 淡入淡出：最后500ms渐隐
        const fadeAlpha = t.revealTimer > 500 ? 1 : (t.revealTimer / 500);
        t.sprite.setAlpha(fadeAlpha);
        if (t.revealTimer <= 0) {
          t.sprite.setVisible(false);
          t.sprite.setAlpha(1);
        }
      }
    }
  }

  // ── 噪音系统 ─────────────────────────────────────────────────────────────

  private updateNoise(delta: number) {
    // 噪音自然衰减
    this.noiseLevel = Math.max(0, this.noiseLevel - 15 * (delta / 1000));
    const noisePct = Math.ceil(this.noiseLevel);
    this.alertText.setText(`噪音: ${noisePct}`);
    if (noisePct > 60) this.alertText.setColor('#ff4444');
    else if (noisePct > 30) this.alertText.setColor('#ffff44');
    else this.alertText.setColor('#888888');
  }

  // ── Monsters ─────────────────────────────────────────────────────────────

  private updateMonsters(delta: number) {
    const dt = delta / 1000;

    for (const monster of this.monsters) {
      if (!monster.alive) continue;

      const distToPlayer = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y, this.player.x, this.player.y
      );

      // 视觉检测：怪物视野很小（30px），但噪音高时检测范围扩大
      const noiseBonus = this.noiseLevel * 1.5; // 噪音100时+150px
      const effectiveVision = 30 + noiseBonus;
      const canSee = distToPlayer < effectiveVision &&
        !this.lineBlockedByObstacle(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y);

      if (canSee) {
        monster.isChasing = true;
        monster.isInvestigating = false;
        monster.giveUpTimer = monster.giveUpDuration;
      } else if (monster.isChasing) {
        monster.giveUpTimer -= delta;
        if (monster.giveUpTimer <= 0) monster.isChasing = false;
      }

      // 调查声源
      if (monster.isInvestigating) {
        monster.investigateTimer -= delta;
        if (monster.investigateTimer <= 0) {
          monster.isInvestigating = false;
        }
      }

      if (monster.isChasing) {
        // 追击玩家
        const dir = new Phaser.Math.Vector2(
          this.player.x - monster.sprite.x,
          this.player.y - monster.sprite.y
        ).normalize();
        const newX = monster.sprite.x + dir.x * monster.chaseSpeed * dt;
        const newY = monster.sprite.y + dir.y * monster.chaseSpeed * dt;
        if (!this.isObstacleAt(newX, monster.sprite.y, 11)) monster.sprite.x = newX;
        if (!this.isObstacleAt(monster.sprite.x, newY, 11)) monster.sprite.y = newY;
        monster.sprite.setFillStyle(0xff2244);
      } else if (monster.isInvestigating) {
        // 前往声源调查
        const dir = new Phaser.Math.Vector2(
          monster.investigateX - monster.sprite.x,
          monster.investigateY - monster.sprite.y
        );
        const dist = dir.length();
        if (dist > 15) {
          dir.normalize();
          const newX = monster.sprite.x + dir.x * (monster.speed * 1.8) * dt;
          const newY = monster.sprite.y + dir.y * (monster.speed * 1.8) * dt;
          if (!this.isObstacleAt(newX, monster.sprite.y, 11)) monster.sprite.x = newX;
          if (!this.isObstacleAt(monster.sprite.x, newY, 11)) monster.sprite.y = newY;
        }
        monster.sprite.setFillStyle(0xffaa44);
      } else {
        // 巡逻
        monster.patrolTimer += delta;
        if (monster.patrolTimer > 3000) {
          monster.patrolTimer = 0;
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          monster.direction.set(Math.cos(angle), Math.sin(angle));
        }
        const distFromHome = Phaser.Math.Distance.Between(
          monster.sprite.x, monster.sprite.y, monster.homeX, monster.homeY
        );
        if (distFromHome > monster.territoryRadius * 0.8) {
          const toHome = new Phaser.Math.Vector2(
            monster.homeX - monster.sprite.x, monster.homeY - monster.sprite.y
          ).normalize();
          monster.direction.lerp(toHome, 0.1).normalize();
        }
        const newX = monster.sprite.x + monster.direction.x * monster.speed * dt;
        const newY = monster.sprite.y + monster.direction.y * monster.speed * dt;
        if (!this.isObstacleAt(newX, monster.sprite.y, 11)) monster.sprite.x = newX;
        else monster.direction.x *= -1;
        if (!this.isObstacleAt(monster.sprite.x, newY, 11)) monster.sprite.y = newY;
        else monster.direction.y *= -1;
        monster.sprite.setFillStyle(0xff4488);
      }
    }
  }

  // ── Collisions ───────────────────────────────────────────────────────────

  private checkCollisions() {
    // Treasures — 脉冲显形后可直接拾取
    for (const t of this.treasures) {
      if (t.collected) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, t.x, t.y);
      if (d < 28 && t.sprite.visible) {
        t.collected = true;
        t.sprite.setVisible(false);
        t.revealTimer = 0;
        this.money += t.value;
        this.moneyText.setText(`金币: $${this.money}`);
        this.showMessage(`发现宝藏！价值: $${t.value}`);
        this.time.delayedCall(1500, () => this.hideMessage());
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
  }

  private checkExit() {
    if (this.money <= 0) return;
    const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.exit.x, this.exit.y);
    if (d < 35) this.escape();
  }

  private die() {
    this.isDead = true;
    this.player.setFillStyle(0x666666);
    this.showMessage('你死了！\n\n按ESC返回菜单');
  }

  private escape() {
    this.isEscaped = true;
    this.showMessage(`成功逃脱！\n总计: $${this.money}\n\n按ESC返回菜单`);
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
