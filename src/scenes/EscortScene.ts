import Phaser from 'phaser';

interface Material {
  x: number;
  y: number;
  type: MaterialType;
  collected: boolean;
  sprite: Phaser.GameObjects.Container;
}

type MaterialType = 'iron' | 'crystal' | 'wood' | 'stone' | 'core';

interface Monster {
  sprite: Phaser.GameObjects.Rectangle;
  speed: number;
  chaseSpeed: number;
  direction: Phaser.Math.Vector2;
  patrolTimer: number;
  isChasing: boolean;
  visionRange: number;
  visionAngle: number;
  territoryRadius: number;
  homeX: number;
  homeY: number;
  giveUpTimer: number;
  giveUpDuration: number;
}

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MATERIAL_INFO: Record<MaterialType, { color: number; name: string; label: string }> = {
  iron:    { color: 0xff4444, name: '铁',  label: '🔴' },
  crystal: { color: 0x44aaff, name: '晶',  label: '🔵' },
  wood:    { color: 0x44ff44, name: '木',  label: '🟢' },
  stone:   { color: 0xaa44ff, name: '石',  label: '🟣' },
  core:    { color: 0xffdd00, name: '核',  label: '🟡' },
};

const MATERIAL_ORDER: MaterialType[] = ['iron', 'crystal', 'wood', 'stone', 'core'];

export class EscortScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private itemA!: Phaser.GameObjects.Container; // 物品A跟随玩家
  private itemASprite!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private escKey!: Phaser.Input.Keyboard.Key;
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
  private fogTextureKey = 'escortFogTexture';
  private viewRadius = 220;
  private screenW = 800;
  private screenH = 600;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private materials: Material[] = [];
  private monsters: Monster[] = [];
  private exit!: Phaser.GameObjects.Rectangle;

  // Player stats
  private health = 100;
  private collectedMaterials = new Set<MaterialType>();
  private damageCooldown = 0;

  // Stamina (加速跑)
  private stamina = 100;
  private maxStamina = 100;
  private isSprinting = false;
  private staminaRegenDelay = 0; // 消耗后延迟恢复的计时器

  // Game state
  private isDead = false;
  private isWon = false;

  // UI
  private healthText!: Phaser.GameObjects.Text;
  private materialsText!: Phaser.GameObjects.Text;
  private itemStatusText!: Phaser.GameObjects.Text;
  private staminaText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'EscortScene' });
  }

  create() {
    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateObstacles();
    this.drawMap();
    this.createPlayer();
    this.createItemA();
    this.createMaterials();
    this.createMonsters();
    this.createExit();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('护送物品A到终点！\n收集5种材料升级后才能通关');
    this.time.delayedCall(3000, () => this.hideMessage());
  }

  // ─── Map generation ───────────────────────────────────────────

  private generateObstacles() {
    this.obstacles = [];

    // Border walls
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    // Scatter random obstacles
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

  // ─── Player & Item A ──────────────────────────────────────────

  private createPlayer() {
    this.player = this.add.rectangle(80, 80, 24, 24, 0x00ff00);
    this.player.setDepth(5);
  }

  private createItemA() {
    // 物品A跟随玩家，显示在角色右上方
    this.itemASprite = this.add.rectangle(0, 0, 16, 16, 0xffdd00);
    this.itemASprite.setStrokeStyle(2, 0xffffff);
    this.itemA = this.add.container(this.player.x + 18, this.player.y - 18, [this.itemASprite]);
    this.itemA.setDepth(6);
  }

  private updateItemA() {
    // 平滑跟随玩家
    const targetX = this.player.x + 18;
    const targetY = this.player.y - 18;
    this.itemA.x += (targetX - this.itemA.x) * 0.2;
    this.itemA.y += (targetY - this.itemA.y) * 0.2;

    // 根据已收集材料数量改变外观
    const count = this.collectedMaterials.size;
    const size = 16 + count * 4;
    this.itemASprite.setSize(size, size);

    if (count >= 5) {
      // 集齐后彩虹脉冲
      const hue = (this.time.now / 10) % 360;
      const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1).color;
      this.itemASprite.setFillStyle(color);
    } else if (count > 0) {
      this.itemASprite.setFillStyle(0xffaa00);
    }
  }

  // ─── Materials ────────────────────────────────────────────────

  private createMaterials() {
    for (const type of MATERIAL_ORDER) {
      let placed = false;
      let attempts = 0;
      while (!placed && attempts < 500) {
        const x = Phaser.Math.Between(200, this.mapWidth - 200);
        const y = Phaser.Math.Between(200, this.mapHeight - 200);

        const distToStart = Phaser.Math.Distance.Between(x, y, 80, 80);
        const distToExit = Phaser.Math.Distance.Between(x, y, this.mapWidth - 80, this.mapHeight - 80);
        if (distToStart < 300 || distToExit < 200) {
          attempts++;
          continue;
        }

        if (!this.isInsideObstacle(x, y, 20)) {
          const info = MATERIAL_INFO[type];
          const circle = this.add.circle(0, 0, 14, info.color);
          circle.setStrokeStyle(3, 0xffffff);
          const container = this.add.container(x, y, [circle]);
          container.setDepth(4);

          // 发光脉冲动画
          this.tweens.add({
            targets: circle,
            scale: { from: 0.8, to: 1.3 },
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.inOut',
          });

          this.materials.push({ x, y, type, collected: false, sprite: container });
          placed = true;
        }
        attempts++;
      }
    }
  }

  // ─── Monsters ─────────────────────────────────────────────────

  private createMonsters() {
    const monsterCount = Phaser.Math.Between(6, 9);
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
        const isHunter = placed < 3;
        const sprite = this.add.rectangle(x, y, 24, 24, isHunter ? 0xff00ff : 0xff8800);
        sprite.setDepth(5);

        this.monsters.push({
          sprite,
          speed: isHunter ? 40 : 30,
          chaseSpeed: isHunter ? 150 : 110,
          direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
          patrolTimer: Phaser.Math.Between(0, 3000),
          isChasing: false,
          visionRange: isHunter ? 200 : 140,
          visionAngle: Math.PI / 3,
          territoryRadius: isHunter ? 600 : 300,
          homeX: x,
          homeY: y,
          giveUpTimer: 0,
          giveUpDuration: isHunter ? 4000 : 2500,
        });
        placed++;
      }
      attempts++;
    }
  }

  // ─── Exit ─────────────────────────────────────────────────────

  private createExit() {
    this.exit = this.add.rectangle(this.mapWidth - 80, this.mapHeight - 80, 50, 50, 0x00ffff);
    this.exit.setAlpha(0.8);
    this.exit.setDepth(3);

    // 终点脉冲提示
    this.tweens.add({
      targets: this.exit,
      alpha: { from: 0.4, to: 0.9 },
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  // ─── Fog of war ───────────────────────────────────────────────

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

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.fillRect(0, 0, this.screenW, this.screenH);

    ctx.globalCompositeOperation = 'destination-out';
    const gradient = ctx.createRadialGradient(
      screenX, screenY, 0,
      screenX, screenY, this.viewRadius
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(screenX, screenY, this.viewRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';

    // 手动上传canvas到WebGL纹理（Phaser 3.90已知问题）
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

  // ─── UI ───────────────────────────────────────────────────────

  private createUI() {
    this.healthText = this.add.text(16, 16, 'HP: 100', {
      fontSize: '18px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.materialsText = this.add.text(16, 40, '', {
      fontSize: '16px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.itemStatusText = this.add.text(16, 70, '物品A: 基础形态 (0/5)', {
      fontSize: '16px',
      color: '#ffdd00',
    }).setScrollFactor(0).setDepth(20);

    this.staminaText = this.add.text(16, 94, '', {
      fontSize: '16px',
      color: '#00ff88',
    }).setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 500, '', {
      fontSize: '24px',
      color: '#ffffff',
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    const backBtn = this.add.text(680, 16, '← Menu', {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);

    backBtn.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });

    this.updateMaterialsUI();
    this.updateStaminaUI();
  }

  private updateStaminaUI() {
    const pct = Math.round((this.stamina / this.maxStamina) * 100);
    const bars = Math.round(pct / 10);
    const barStr = '█'.repeat(bars) + '░'.repeat(10 - bars);
    const status = this.isSprinting ? ' [冲刺中]' : this.staminaRegenDelay > 0 ? ' [恢复中]' : ' [就绪]';
    this.staminaText.setText(`体力: ${barStr} ${pct}%${status}`);
    if (this.stamina < 20) {
      this.staminaText.setColor('#ff4444');
    } else if (this.isSprinting) {
      this.staminaText.setColor('#ffaa00');
    } else {
      this.staminaText.setColor('#00ff88');
    }
  }

  private updateMaterialsUI() {
    let line = '材料: ';
    for (const type of MATERIAL_ORDER) {
      const info = MATERIAL_INFO[type];
      if (this.collectedMaterials.has(type)) {
        line += `${info.label}${info.name}✓ `;
      } else {
        line += `⬜${info.name} `;
      }
    }
    this.materialsText.setText(line);

    const count = this.collectedMaterials.size;
    if (count >= 5) {
      this.itemStatusText.setText('物品A: 完全体! (5/5) 🌈');
      this.itemStatusText.setColor('#ff00ff');
    } else {
      this.itemStatusText.setText(`物品A: 升级中 (${count}/5)`);
      this.itemStatusText.setColor('#ffdd00');
    }
  }

  // ─── Input ────────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
  }

  // ─── Update loop ──────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.isDead || this.isWon) return;

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    this.handlePlayerMovement(delta);
    this.updateStamina(delta);
    this.updateItemA();
    this.updateMonsters(delta);
    this.checkMaterialPickup();
    this.checkMonsterCollision();
    this.checkExit();
    this.updateFog();

    if (this.damageCooldown > 0) {
      this.damageCooldown -= delta;
    }
  }

  private updateStamina(delta: number) {
    const dt = delta / 1000;
    const moving = this.cursors.left.isDown || this.cursors.right.isDown ||
                   this.cursors.up.isDown || this.cursors.down.isDown;

    // 判断是否在冲刺：按住Shift + 有体力 + 在移动
    this.isSprinting = this.shiftKey.isDown && this.stamina > 0 && moving;

    if (this.isSprinting) {
      this.stamina -= 35 * dt;          // 每秒消耗35
      this.staminaRegenDelay = 1.0;     // 消耗后1秒才开始恢复
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.isSprinting = false;
      }
    } else {
      // 延迟恢复
      if (this.staminaRegenDelay > 0) {
        this.staminaRegenDelay -= dt;
      } else {
        this.stamina += 20 * dt;        // 每秒恢复20
        if (this.stamina > this.maxStamina) this.stamina = this.maxStamina;
      }
    }

    this.updateStaminaUI();
  }

  private handlePlayerMovement(delta: number) {
    const baseSpeed = 160;
    const sprintSpeed = 280;
    const speed = this.isSprinting ? sprintSpeed : baseSpeed;
    const dt = delta / 1000;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown) vx -= speed;
    if (this.cursors.right.isDown) vx += speed;
    if (this.cursors.up.isDown) vy -= speed;
    if (this.cursors.down.isDown) vy += speed;

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

  // ─── Collision helpers ────────────────────────────────────────

  private isObstacleAt(px: number, py: number, _halfSize: number): boolean {
    for (const obs of this.obstacles) {
      if (px >= obs.x && px <= obs.x + obs.w && py >= obs.y && py <= obs.y + obs.h) {
        return true;
      }
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

  // ─── Monster AI ───────────────────────────────────────────────

  private updateMonsters(delta: number) {
    const dt = delta / 1000;

    for (const monster of this.monsters) {
      const distToPlayer = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y,
        this.player.x, this.player.y
      );

      const canSee = this.monsterCanSeePlayer(monster, distToPlayer);

      if (canSee) {
        monster.isChasing = true;
        monster.giveUpTimer = monster.giveUpDuration;
      } else if (monster.giveUpTimer > 0) {
        monster.giveUpTimer -= delta;
        if (monster.giveUpTimer <= 0) {
          monster.isChasing = false;
        }
      }

      const distFromHome = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y,
        monster.homeX, monster.homeY
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

        const newX = monster.sprite.x + dir.x * monster.chaseSpeed * dt;
        const newY = monster.sprite.y + dir.y * monster.chaseSpeed * dt;

        if (!this.isObstacleAt(newX, monster.sprite.y, 11)) {
          monster.sprite.x = newX;
        }
        if (!this.isObstacleAt(monster.sprite.x, newY, 11)) {
          monster.sprite.y = newY;
        }
      } else {
        monster.patrolTimer += delta;
        if (monster.patrolTimer > 3000) {
          monster.patrolTimer = 0;
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          monster.direction.set(Math.cos(angle), Math.sin(angle));
        }

        if (distFromHome > monster.territoryRadius * 0.8) {
          const toHome = new Phaser.Math.Vector2(
            monster.homeX - monster.sprite.x,
            monster.homeY - monster.sprite.y
          ).normalize();
          monster.direction.lerp(toHome, 0.1).normalize();
        }

        const newX = monster.sprite.x + monster.direction.x * monster.speed * dt;
        const newY = monster.sprite.y + monster.direction.y * monster.speed * dt;

        if (!this.isObstacleAt(newX, monster.sprite.y, 11)) {
          monster.sprite.x = newX;
        } else {
          monster.direction.x *= -1;
        }
        if (!this.isObstacleAt(monster.sprite.x, newY, 11)) {
          monster.sprite.y = newY;
        } else {
          monster.direction.y *= -1;
        }
      }
    }
  }

  private monsterCanSeePlayer(monster: Monster, distToPlayer: number): boolean {
    if (distToPlayer > monster.visionRange) return false;

    const proximitySense = 60;

    if (monster.visionAngle > 0 && distToPlayer > proximitySense) {
      const angleToPlayer = Math.atan2(
        this.player.y - monster.sprite.y,
        this.player.x - monster.sprite.x
      );
      let facingAngle = Math.atan2(monster.direction.y, monster.direction.x);
      if (monster.isChasing) {
        facingAngle = angleToPlayer;
      }

      let diff = Math.abs(angleToPlayer - facingAngle);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > monster.visionAngle) return false;
    }

    if (distToPlayer > proximitySense &&
        this.lineBlockedByObstacle(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y)) {
      return false;
    }

    return true;
  }

  // ─── Pickup & combat ──────────────────────────────────────────

  private checkMaterialPickup() {
    for (const mat of this.materials) {
      if (mat.collected) continue;

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, mat.x, mat.y);
      if (dist < 30) {
        mat.collected = true;
        mat.sprite.setVisible(false);
        this.tweens.killTweensOf(mat.sprite);
        this.collectedMaterials.add(mat.type);

        const info = MATERIAL_INFO[mat.type];
        const count = this.collectedMaterials.size;
        this.updateMaterialsUI();

        if (count >= 5) {
          this.showMessage(`收集到 ${info.name}！\n物品A进化为完全体！\n前往终点通关！`);
        } else {
          this.showMessage(`收集到 ${info.name}！\n(${count}/5)`);
        }
        this.time.delayedCall(2000, () => this.hideMessage());
      }
    }
  }

  private checkMonsterCollision() {
    if (this.damageCooldown > 0) return;

    for (const monster of this.monsters) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        monster.sprite.x, monster.sprite.y
      );

      if (dist < 30) {
        this.health -= 15;
        this.healthText.setText(`HP: ${this.health}`);
        this.damageCooldown = 800;

        // 击退
        const kx = this.player.x - monster.sprite.x;
        const ky = this.player.y - monster.sprite.y;
        const klen = Math.sqrt(kx * kx + ky * ky) || 1;
        this.player.x += (kx / klen) * 20;
        this.player.y += (ky / klen) * 20;

        // 闪烁受伤
        this.player.setFillStyle(0xff0000);
        this.time.delayedCall(200, () => {
          if (!this.isDead) this.player.setFillStyle(0x00ff00);
        });

        if (this.health <= 0) {
          this.die();
        }
        break;
      }
    }
  }

  // ─── Exit check ───────────────────────────────────────────────

  private checkExit() {
    const dist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.exit.x, this.exit.y
    );

    if (dist < 40) {
      if (this.collectedMaterials.size >= 5) {
        this.win();
      } else {
        const remaining = 5 - this.collectedMaterials.size;
        this.showMessage(`物品A未完全升级！\n还需收集 ${remaining} 种材料`);
        this.time.delayedCall(1500, () => this.hideMessage());
      }
    }
  }

  // ─── End states ───────────────────────────────────────────────

  private die() {
    this.isDead = true;
    this.player.setFillStyle(0x666666);
    this.itemA.setVisible(false);
    this.showMessage('你死了！\n物品A丢失...\n\n按ESC返回菜单');
  }

  private win() {
    this.isWon = true;
    this.exit.setFillStyle(0x00ff00);
    this.showMessage(`🎉 通关！\n物品A成功送达终点！\n\n按ESC返回菜单`);
  }

  // ─── Message ──────────────────────────────────────────────────

  private showMessage(text: string) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
  }

  private hideMessage() {
    this.messageText.setVisible(false);
  }
}
