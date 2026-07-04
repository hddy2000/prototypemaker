import Phaser from 'phaser';

interface Treasure {
  x: number;
  y: number;
  value: number;
  collected: boolean;
  detected: boolean;   // detector has beeped (treasure is nearby)
  revealed: boolean;   // player pressed E to reveal it (now visible & pickable)
  sprite: Phaser.GameObjects.Container;
}

type MonsterType = 'sentinel' | 'patroller' | 'hunter' | 'wanderer';

interface Monster {
  sprite: Phaser.GameObjects.Rectangle;
  type: MonsterType;
  speed: number;          // patrol speed
  chaseSpeed: number;     // chase speed
  direction: Phaser.Math.Vector2;
  patrolTimer: number;
  isChasing: boolean;
  visionRange: number;    // how far it can see the player
  visionAngle: number;    // half-angle of vision cone (radians); 0 = 360°
  territoryRadius: number; // max distance from home point
  homeX: number;          // patrol center
  homeY: number;
  giveUpTimer: number;    // ms remaining of chase after losing sight
  giveUpDuration: number; // how long to keep chasing after losing sight
  textLabel?: Phaser.GameObjects.Text;
}

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class MazeScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;

  // Map
  private mapWidth = 2400;
  private mapHeight = 1600;
  private obstacles: Obstacle[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Fog of war
  private fogImage!: Phaser.GameObjects.Image;
  private fogCanvas!: HTMLCanvasElement;
  private fogCtx!: CanvasRenderingContext2D;
  private fogTextureKey = 'fogTexture';
  private viewRadius = 180;
  private screenW = 800;
  private screenH = 600;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private treasures: Treasure[] = [];
  private monsters: Monster[] = [];
  private exit!: Phaser.GameObjects.Rectangle;

  // Player stats
  private health = 100;
  private money = 0;
  private hasTreasure = false;

  // UI (fixed to camera)
  private healthText!: Phaser.GameObjects.Text;
  private moneyText!: Phaser.GameObjects.Text;
  private detectorText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;

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
  private staminaDepleted = false;   // true when hit 0 — must rest to recover before sprinting again
  private shiftKey!: Phaser.Input.Keyboard.Key;
  private staminaText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'MazeScene' });
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

    // Position camera on player
    this.cam.startFollow(this.player, true, 0.1, 0.1);
  }

  private generateObstacles() {
    this.obstacles = [];

    // Border walls
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    // Scatter random obstacles (pillars, walls, debris)
    const obstacleCount = 60;
    for (let i = 0; i < obstacleCount; i++) {
      const isHorizontal = Math.random() > 0.5;
      const w = isHorizontal ? Phaser.Math.Between(60, 200) : Phaser.Math.Between(30, 60);
      const h = isHorizontal ? Phaser.Math.Between(30, 60) : Phaser.Math.Between(60, 200);
      const x = Phaser.Math.Between(100, this.mapWidth - 100 - w);
      const y = Phaser.Math.Between(100, this.mapHeight - 100 - h);

      // Don't place on player start or exit
      const nearStart = x < 200 && y < 200;
      const nearExit = x + w > this.mapWidth - 200 && y + h > this.mapHeight - 200;
      if (nearStart || nearExit) continue;

      this.obstacles.push({ x, y, w, h });
    }
  }

  private drawMap() {
    this.mapGraphics = this.add.graphics();

    // Floor
    this.mapGraphics.fillStyle(0x1a1a2e, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

    // Grid lines for atmosphere
    this.mapGraphics.lineStyle(1, 0x222244, 0.3);
    for (let x = 0; x < this.mapWidth; x += 80) {
      this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += 80) {
      this.mapGraphics.lineBetween(0, y, this.mapWidth, y);
    }

    // Obstacles
    this.mapGraphics.fillStyle(0x333355, 1);
    for (const obs of this.obstacles) {
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
    }

    // Border highlight
    this.mapGraphics.lineStyle(2, 0x555577, 1);
    this.mapGraphics.strokeRect(20, 20, this.mapWidth - 40, this.mapHeight - 40);
  }

  private createPlayer() {
    this.player = this.add.rectangle(80, 80, 24, 24, 0x00ff00);
  }

  private createTreasures() {
    const treasureCount = Phaser.Math.Between(10, 15);
    let placed = 0;
    let attempts = 0;

    while (placed < treasureCount && attempts < 500) {
      const x = Phaser.Math.Between(100, this.mapWidth - 100);
      const y = Phaser.Math.Between(100, this.mapHeight - 100);

      // Not too close to start or exit
      const distToStart = Phaser.Math.Distance.Between(x, y, 80, 80);
      const distToExit = Phaser.Math.Distance.Between(x, y, this.mapWidth - 80, this.mapHeight - 80);
      if (distToStart < 200 || distToExit < 200) {
        attempts++;
        continue;
      }

      if (!this.isInsideObstacle(x, y, 12)) {
        const value = Phaser.Math.Between(100, 500);

        // Create treasure visual: a container with a diamond shape + glow
        const container = this.add.container(x, y);
        container.setDepth(4);

        const gem = this.add.rectangle(0, 0, 16, 16, 0xffdd00);
        gem.setRotation(Math.PI / 4); // diamond shape
        const glow = this.add.circle(0, 0, 20, 0xffdd00, 0.2);
        container.add([glow, gem]);

        // Hide until detected
        container.setVisible(false);

        this.treasures.push({
          x, y, value,
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
    const monsterCount = Phaser.Math.Between(8, 12);
    let placed = 0;
    let attempts = 0;

    const types: MonsterType[] = ['sentinel', 'patroller', 'hunter', 'wanderer'];

    while (placed < monsterCount && attempts < 500) {
      const x = Phaser.Math.Between(200, this.mapWidth - 200);
      const y = Phaser.Math.Between(200, this.mapHeight - 200);

      const distToPlayer = Phaser.Math.Distance.Between(x, y, 80, 80);
      if (distToPlayer < 400) {
        attempts++;
        continue;
      }

      if (!this.isInsideObstacle(x, y, 12)) {
        const type = types[placed % types.length];
        const sprite = this.add.rectangle(x, y, 24, 24, this.monsterColor(type));
        sprite.setDepth(5);

        this.monsters.push({
          sprite,
          type,
          ...this.monsterStats(type),
          direction: new Phaser.Math.Vector2(Phaser.Math.FloatBetween(-1, 1), Phaser.Math.FloatBetween(-1, 1)).normalize(),
          patrolTimer: Phaser.Math.Between(0, 3000),
          isChasing: false,
          homeX: x,
          homeY: y,
          giveUpTimer: 0,
        });
        placed++;
      }
      attempts++;
    }
  }

  private monsterColor(type: MonsterType): number {
    switch (type) {
      case 'sentinel':  return 0xff4444; // red — stationary guard
      case 'patroller': return 0xff8800; // orange — medium patrol
      case 'hunter':    return 0xff00ff; // magenta — aggressive
      case 'wanderer':  return 0x88ff00; // green — passive
    }
  }

  private monsterStats(type: MonsterType): Pick<Monster, 'speed' | 'chaseSpeed' | 'visionRange' | 'visionAngle' | 'territoryRadius' | 'giveUpDuration'> {
    switch (type) {
      case 'sentinel':  // Stays near home, narrow but long vision, slow chase
        return { speed: 15, chaseSpeed: 80,  visionRange: 350, visionAngle: Math.PI / 6, territoryRadius: 80,  giveUpDuration: 1500 };
      case 'patroller': // Wide patrol, medium vision, medium chase
        return { speed: 35, chaseSpeed: 110, visionRange: 220, visionAngle: Math.PI / 4, territoryRadius: 300, giveUpDuration: 2500 };
      case 'hunter':    // Roams far, wide vision, fast chase, persistent
        return { speed: 45, chaseSpeed: 130, visionRange: 300, visionAngle: Math.PI / 3, territoryRadius: 250, giveUpDuration: 2500 };
      case 'wanderer':  // Roams everywhere, short vision, gives up quickly
        return { speed: 30, chaseSpeed: 90,  visionRange: 140, visionAngle: 0,           territoryRadius: 9999, giveUpDuration: 1000 };
    }
  }

  private createExit() {
    this.exit = this.add.rectangle(this.mapWidth - 80, this.mapHeight - 80, 40, 40, 0x00ffff);
    this.exit.setAlpha(0.8);
  }

  private createFog() {
    // Create a canvas for the fog
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.screenW;
    this.fogCanvas.height = this.screenH;
    this.fogCtx = this.fogCanvas.getContext('2d')!;

    // Add the canvas as a Phaser texture
    if (this.textures.exists(this.fogTextureKey)) {
      this.textures.remove(this.fogTextureKey);
    }
    this.textures.addCanvas(this.fogTextureKey, this.fogCanvas);

    // Create an image using the canvas texture, fixed to camera
    this.fogImage = this.add.image(0, 0, this.fogTextureKey);
    this.fogImage.setOrigin(0, 0);
    this.fogImage.setScrollFactor(0);
    this.fogImage.setDepth(10);

    // Initial fog draw
    this.drawFog(this.screenW / 2, this.screenH / 2);
  }

  private drawFog(screenX: number, screenY: number) {
    const ctx = this.fogCtx;

    // Fill the entire screen with black
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.fillRect(0, 0, this.screenW, this.screenH);

    // Erase a circle around the player using destination-out
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

    // Reset composite operation
    ctx.globalCompositeOperation = 'source-over';

    // Manually upload the canvas to the WebGL texture
    // (Phaser 3.90's source.update() doesn't properly refresh canvas textures in WebGL)
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
    // Calculate player's position on screen
    const screenX = this.player.x - this.cam.scrollX;
    const screenY = this.player.y - this.cam.scrollY;

    this.drawFog(screenX, screenY);
  }

  private createUI() {
    this.healthText = this.add.text(16, 16, '生命: 100', {
      fontSize: '18px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.moneyText = this.add.text(16, 40, '金币: $0', {
      fontSize: '18px',
      color: '#ffff00',
    }).setScrollFactor(0).setDepth(20);

    this.detectorText = this.add.text(16, 64, '探测器: 就绪 [空格探测] | [E显形]', {
      fontSize: '16px',
      color: '#00ffff',
    }).setScrollFactor(0).setDepth(20);

    this.staminaText = this.add.text(16, 88, '体力: 100 [Shift冲刺]', {
      fontSize: '16px',
      color: '#88ff88',
    }).setScrollFactor(0).setDepth(20);

    this.messageText = this.add.text(400, 500, '', {
      fontSize: '24px',
      color: '#ffffff',
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);

    // Back to menu button
    const backBtn = this.add.text(680, 16, '← 菜单', {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);

    backBtn.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });
  }

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.shiftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
  }

  update(_time: number, delta: number) {
    if (this.isDead || this.isEscaped) return;

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    this.handlePlayerMovement(delta);
    this.handleDetector();
    this.handleReveal();
    this.updateMonsters(delta);
    this.checkCollisions();
    this.checkExit();
    this.updateFog();

    if (this.damageCooldown > 0) {
      this.damageCooldown -= delta;
    }
  }

  private handlePlayerMovement(delta: number) {
    const baseSpeed = 160;
    const sprintSpeed = 280;
    const dt = delta / 1000;

    // Sprint logic: hold SHIFT while moving, drains stamina; must recover past
    // threshold once depleted before sprinting again.
    const wantsSprint = this.shiftKey.isDown && !this.staminaDepleted;
    const isMoving = this.cursors.left.isDown || this.cursors.right.isDown ||
                     this.cursors.up.isDown || this.cursors.down.isDown ||
                     this.wasdKeys.A.isDown || this.wasdKeys.D.isDown ||
                     this.wasdKeys.W.isDown || this.wasdKeys.S.isDown;
    const isSprinting = wantsSprint && isMoving && this.stamina > 0;

    if (isSprinting) {
      this.stamina -= 35 * dt;            // drain
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.staminaDepleted = true;      // must rest to recover
      }
    } else {
      // Recover stamina when not sprinting (resting)
      this.stamina += 18 * dt;
      if (this.stamina >= this.maxStamina) this.stamina = this.maxStamina;
      // Once recovered enough, allow sprinting again
      if (this.staminaDepleted && this.stamina >= this.maxStamina * 0.3) {
        this.staminaDepleted = false;
      }
    }

    const speed = isSprinting ? sprintSpeed : baseSpeed;
    this.staminaText.setText(
      `体力: ${Math.ceil(this.stamina)}/${this.maxStamina}` +
      (this.staminaDepleted ? ' (恢复中...)' : ' [Shift冲刺]')
    );
    this.staminaText.setColor(this.staminaDepleted ? '#ff8888' : (isSprinting ? '#ffff88' : '#88ff88'));

    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.wasdKeys.A.isDown) vx -= speed;
    if (this.cursors.right.isDown || this.wasdKeys.D.isDown) vx += speed;
    if (this.cursors.up.isDown || this.wasdKeys.W.isDown) vy -= speed;
    if (this.cursors.down.isDown || this.wasdKeys.S.isDown) vy += speed;

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * speed;
      vy = (vy / len) * speed;
    }

    const halfSize = 11;

    // Try X movement
    if (vx !== 0) {
      const dx = vx * dt;
      const newX = this.player.x + dx;
      const edgeX = newX + (dx > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(edgeX, this.player.y - halfSize, halfSize) &&
          !this.isObstacleAt(edgeX, this.player.y + halfSize, halfSize)) {
        this.player.x = newX;
      }
    }

    // Try Y movement
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

  private handleDetector() {
    if (this.detectorCooldown > 0) {
      this.detectorCooldown--;
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.detectorCooldown = 60;

      let nearestDist = Infinity;
      for (const treasure of this.treasures) {
        if (treasure.collected) continue;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, treasure.x, treasure.y);
        if (dist < nearestDist) nearestDist = dist;
      }

      // Mark treasures within detector range as detected (but NOT revealed/visible)
      for (const treasure of this.treasures) {
        if (treasure.collected) continue;
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, treasure.x, treasure.y);
        if (dist < this.detectorRange * 2.5) {
          treasure.detected = true;
        }
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
          this.detectorText.setText('探测器: 就绪 [空格探测] | [E显形]');
          this.detectorText.setColor('#00ffff');
        }
      });
    }
  }

  private handleReveal() {
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      let revealedAny = false;
      for (const treasure of this.treasures) {
        if (treasure.collected || treasure.revealed) continue;
        if (!treasure.detected) continue;

        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, treasure.x, treasure.y);
        if (dist < this.detectorRange * 2.5) {
          treasure.revealed = true;
          treasure.sprite.setVisible(true);
          this.tweens.add({
            targets: treasure.sprite,
            scale: { from: 0.8, to: 1.3 },
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.inOut',
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

  private updateMonsters(delta: number) {
    const dt = delta / 1000;

    for (const monster of this.monsters) {
      const distToPlayer = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y,
        this.player.x, this.player.y
      );

      // --- Vision check: can this monster see the player? ---
      const canSee = this.monsterCanSeePlayer(monster, distToPlayer);

      if (canSee) {
        monster.isChasing = true;
        monster.giveUpTimer = monster.giveUpDuration;
      } else if (monster.giveUpTimer > 0) {
        // Lost sight but still chasing for a bit
        monster.giveUpTimer -= delta;
        if (monster.giveUpTimer <= 0) {
          monster.isChasing = false;
        }
      }

      // --- Territory check: don't leave home area ---
      const distFromHome = Phaser.Math.Distance.Between(
        monster.sprite.x, monster.sprite.y,
        monster.homeX, monster.homeY
      );
      if (monster.isChasing && distFromHome > monster.territoryRadius) {
        // Too far from home — give up and return
        monster.isChasing = false;
        monster.giveUpTimer = 0;
      }

      if (monster.isChasing) {
        // Chase player
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
        // Patrol / wander around home
        monster.patrolTimer += delta;

        // Wanderers change direction frequently; sentinels barely move
        const patrolInterval = monster.type === 'wanderer' ? 1500 : monster.type === 'sentinel' ? 5000 : 3000;
        if (monster.patrolTimer > patrolInterval) {
          monster.patrolTimer = 0;
          const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          monster.direction.set(Math.cos(angle), Math.sin(angle));
        }

        // If too far from home, steer back
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

  /**
   * Check if a monster can see the player based on:
   * - Distance (must be within visionRange)
   * - Vision cone angle (if visionAngle > 0)
   * - Proximity sense (very close = always detected, simulates hearing)
   * - Line of sight (not blocked by obstacles)
   */
  private monsterCanSeePlayer(monster: Monster, distToPlayer: number): boolean {
    // Hard cap: monsters never detect the player beyond the player's own view radius.
    // This prevents monsters from spotting the player while still off-screen / in fog.
    const effectiveVisionRange = Math.min(monster.visionRange, this.viewRadius);
    if (distToPlayer > effectiveVisionRange) return false;

    // Proximity sense: if player is very close, detect regardless of facing
    const proximitySense = 60;

    // 360° vision (visionAngle === 0) or within proximity sense — only distance matters
    if (monster.visionAngle > 0 && distToPlayer > proximitySense) {
      // Check if player is within the vision cone
      const angleToPlayer = Math.atan2(
        this.player.y - monster.sprite.y,
        this.player.x - monster.sprite.x
      );
      // Use movement direction as facing direction
      let facingAngle = Math.atan2(monster.direction.y, monster.direction.x);
      if (monster.isChasing) {
        // While chasing, face the player
        facingAngle = angleToPlayer;
      }

      let diff = Math.abs(angleToPlayer - facingAngle);
      // Normalize to [0, PI]
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      if (diff > monster.visionAngle) return false;
    }

    // Line of sight check — raycast through obstacles
    // Skip LoS check if player is within proximity sense (heard through walls)
    if (distToPlayer > proximitySense &&
        this.lineBlockedByObstacle(monster.sprite.x, monster.sprite.y, this.player.x, this.player.y)) {
      return false;
    }

    return true;
  }

  /**
   * Check if a line between two points is blocked by any obstacle.
   * Uses simple sampling along the line.
   */
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

  private checkCollisions() {
    // Treasures
    for (const treasure of this.treasures) {
      if (treasure.collected) continue;

      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, treasure.x, treasure.y);

      if (dist < 30) {
        if (treasure.revealed) {
          treasure.collected = true;
          treasure.sprite.setVisible(false);
          this.tweens.killTweensOf(treasure.sprite);
          this.hasTreasure = true;
          // Settle money immediately on pickup
          this.money += treasure.value;
          this.moneyText.setText(`金币: $${this.money}`);
          this.showMessage(`发现宝藏！价值: $${treasure.value}`);
          this.time.delayedCall(2000, () => this.hideMessage());
        } else if (treasure.detected) {
          this.showMessage('先按 [E] 显形宝藏！');
          this.time.delayedCall(1500, () => this.hideMessage());
        } else {
          this.showMessage('先用探测器 [空格] 定位宝藏！');
          this.time.delayedCall(1500, () => this.hideMessage());
        }
      }
    }

    // Monsters
    if (this.damageCooldown <= 0) {
      for (const monster of this.monsters) {
        const dist = Phaser.Math.Distance.Between(
          this.player.x, this.player.y,
          monster.sprite.x, monster.sprite.y
        );

        if (dist < 30) {
          // Damage scales by monster type
          let dmg = 10;
          switch (monster.type) {
            case 'hunter':    dmg = 20; break;
            case 'patroller': dmg = 15; break;
            case 'sentinel':  dmg = 15; break;
            case 'wanderer':  dmg = 8;  break;
          }
          this.health -= dmg;
          this.healthText.setText(`生命: ${this.health}`);
          this.damageCooldown = 800; // 0.8s invulnerability

          // Knockback player away from monster
          const kx = this.player.x - monster.sprite.x;
          const ky = this.player.y - monster.sprite.y;
          const klen = Math.sqrt(kx * kx + ky * ky) || 1;
          this.player.x += (kx / klen) * 20;
          this.player.y += (ky / klen) * 20;

          if (this.health <= 0) {
            this.die();
          }
          break;
        }
      }
    }
  }

  private checkExit() {
    if (!this.hasTreasure) return;

    const dist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.exit.x, this.exit.y
    );

    if (dist < 35) {
      this.escape();
    }
  }

  private die() {
    this.isDead = true;
    this.player.setFillStyle(0x666666);
    this.showMessage('你死了！\n所有宝藏丢失...\n\n按ESC返回菜单');
  }

  private escape() {
    this.isEscaped = true;
    // Money was already added on pickup; just show the escape summary.
    this.showMessage(`成功逃脱！\n总计: $${this.money}\n\n按ESC返回菜单`);
  }

  private showMessage(text: string) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
  }

  private hideMessage() {
    this.messageText.setVisible(false);
  }
}
