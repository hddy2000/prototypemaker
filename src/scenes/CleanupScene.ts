import Phaser from 'phaser';

// ── Types ──────────────────────────────────────────────────────────────────

interface Obstacle {
  x: number; y: number; w: number; h: number;
}

interface Monster {
  sprite: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  facing: Phaser.Math.Vector2;   // direction the monster is "facing"
  speed: number;
  wanderTimer: number;
  alive: boolean;
  attackCooldown: number;
  pollutionDropTimer: number;    // drops pollution periodically while wandering
}

interface Pollution {
  sprite: Phaser.GameObjects.Arc;
  x: number; y: number;
  amount: number;                // how much "pollution" this puddle holds
  collected: boolean;
}

// ── Scene ──────────────────────────────────────────────────────────────────

export class CleanupScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;

  // Map
  private mapWidth = 1600;
  private mapHeight = 1200;
  private obstacles: Obstacle[] = [];
  private mapGraphics!: Phaser.GameObjects.Graphics;

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // Game objects
  private monsters: Monster[] = [];
  private pollutions: Pollution[] = [];
  private depositZone!: Phaser.GameObjects.Container;

  // Player stats
  private health = 100;
  private maxHealth = 100;
  private carrying = 0;          // pollution currently being carried
  private carryCapacity = 10;    // max carry per trip

  // Attack
  private attackRange = 90;
  private attackCooldown = 0;
  private attackArc!: Phaser.GameObjects.Graphics;
  private attackVisualTimer = 0;

  // Spawning
  private spawnTimer = 0;
  private spawnInterval = 16000; // a new monster every 16s
  private maxMonsters = 6;

  // Win / lose
  private deposited = 0;
  private goal = 50;             // need to deposit 50 units total
  private timeLimit = 180000;    // 3 minutes
  private pollutionCap = 80;     // total pollution on map >= this → lose
  private isDead = false;
  private isWon = false;

  // UI
  private healthText!: Phaser.GameObjects.Text;
  private carryText!: Phaser.GameObjects.Text;
  private depositedText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private pollutionText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'CleanupScene' });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  create() {
    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateMap();
    this.drawMap();
    this.createDepositZone();
    this.createPlayer();
    this.createUI();
    this.setupInput();
    this.createAttackArc();

    // Spawn first monster
    this.spawnMonster();

    this.cam.startFollow(this.player, true, 0.1, 0.1);
  }

  // ── Map Generation ───────────────────────────────────────────────────────

  private generateMap() {
    this.obstacles = [];

    // Border walls
    this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
    this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });

    // Scattered crate obstacles
    const crateCount = 24;
    for (let i = 0; i < crateCount; i++) {
      const w = Phaser.Math.Between(40, 90);
      const h = Phaser.Math.Between(40, 90);
      const x = Phaser.Math.Between(60, this.mapWidth - 60 - w);
      const y = Phaser.Math.Between(60, this.mapHeight - 60 - h);
      // keep center-ish area clear for deposit zone
      const cx = this.mapWidth / 2;
      const cy = this.mapHeight / 2;
      if (Phaser.Math.Distance.Between(x + w / 2, y + h / 2, cx, cy) < 140) continue;
      this.obstacles.push({ x, y, w, h });
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  private drawMap() {
    this.mapGraphics = this.add.graphics();

    // Floor — industrial grime
    this.mapGraphics.fillStyle(0x1c1c22, 1);
    this.mapGraphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

    // Grid
    this.mapGraphics.lineStyle(1, 0x2a2a32, 0.4);
    for (let x = 0; x < this.mapWidth; x += 80) {
      this.mapGraphics.lineBetween(x, 0, x, this.mapHeight);
    }
    for (let y = 0; y < this.mapHeight; y += 80) {
      this.mapGraphics.lineBetween(0, y, this.mapWidth, y);
    }

    // Crates
    this.mapGraphics.fillStyle(0x3a3a44, 1);
    this.mapGraphics.lineStyle(2, 0x555560, 1);
    for (const obs of this.obstacles) {
      if (obs.w >= this.mapWidth || obs.h >= this.mapHeight) continue; // skip borders
      this.mapGraphics.fillRect(obs.x, obs.y, obs.w, obs.h);
      this.mapGraphics.strokeRect(obs.x, obs.y, obs.w, obs.h);
    }
  }

  // ── Deposit Zone ─────────────────────────────────────────────────────────

  private createDepositZone() {
    const cx = this.mapWidth / 2;
    const cy = this.mapHeight / 2;
    const container = this.add.container(cx, cy);
    container.setDepth(2);

    const pad = this.add.rectangle(0, 0, 90, 90, 0x004422, 0.5);
    const ring = this.add.circle(0, 0, 50, 0x00ff66, 0.15);
    ring.setStrokeStyle(3, 0x00ff66, 0.8);
    const label = this.add.text(0, 0, '净化站', {
      fontSize: '14px', color: '#00ff66',
    }).setOrigin(0.5);
    container.add([pad, ring, label]);

    this.tweens.add({
      targets: ring,
      scale: { from: 0.85, to: 1.15 },
      duration: 800, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });

    this.depositZone = container;
  }

  // ── Player ───────────────────────────────────────────────────────────────

  private createPlayer() {
    // Start near top-left, away from deposit zone
    this.player = this.add.rectangle(120, 120, 24, 24, 0x44ddff);
    this.player.setDepth(5);
  }

  // ── Attack Arc Visual ────────────────────────────────────────────────────

  private createAttackArc() {
    this.attackArc = this.add.graphics();
    this.attackArc.setDepth(4);
  }

  // ── Monsters ─────────────────────────────────────────────────────────────

  private spawnMonster() {
    // Spawn at a random edge location, away from player
    let x = 0, y = 0;
    for (let attempt = 0; attempt < 50; attempt++) {
      const edge = Phaser.Math.Between(0, 3);
      if (edge === 0) { x = Phaser.Math.Between(60, this.mapWidth - 60); y = 60; }
      else if (edge === 1) { x = Phaser.Math.Between(60, this.mapWidth - 60); y = this.mapHeight - 60; }
      else if (edge === 2) { x = 60; y = Phaser.Math.Between(60, this.mapHeight - 60); }
      else { x = this.mapWidth - 60; y = Phaser.Math.Between(60, this.mapHeight - 60); }

      if (this.isInsideObstacle(x, y, 20)) continue;
      if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 250) continue;
      break;
    }

    const container = this.add.container(x, y);
    container.setDepth(6);

    const body = this.add.circle(0, 0, 16, 0x9933ff, 0.9);
    const eye = this.add.circle(8, -4, 4, 0xff0000); // eye offset shows facing
    const wisp = this.add.circle(0, 0, 22, 0x9933ff, 0.15);
    container.add([wisp, body, eye]);

    this.tweens.add({
      targets: [body, eye],
      y: '+=5',
      duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut',
    });

    // spawn pop-in
    container.setScale(0);
    this.tweens.add({
      targets: container,
      scale: { from: 0, to: 1 },
      duration: 300, ease: 'Back.easeOut',
    });

    this.monsters.push({
      sprite: container,
      body,
      facing: new Phaser.Math.Vector2(1, 0),
      speed: 70,
      wanderTimer: 0,
      alive: true,
      attackCooldown: 0,
      pollutionDropTimer: 0,
    });
  }

  private updateMonsters(delta: number) {
    const dt = delta / 1000;

    for (const m of this.monsters) {
      if (!m.alive) continue;

      // Wander randomly
      m.wanderTimer += delta;
      if (m.wanderTimer > 1500) {
        m.wanderTimer = 0;
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        m.facing.set(Math.cos(angle), Math.sin(angle));
      }

      const newX = m.sprite.x + m.facing.x * m.speed * dt;
      const newY = m.sprite.y + m.facing.y * m.speed * dt;
      if (!this.isObstacleAt(newX, m.sprite.y, 12)) m.sprite.x = newX;
      else m.facing.x *= -1;
      if (!this.isObstacleAt(m.sprite.x, newY, 12)) m.sprite.y = newY;
      else m.facing.y *= -1;

      // Update eye position to show facing direction
      const eye = m.sprite.getAt(2) as Phaser.GameObjects.Arc;
      if (eye) {
        eye.x = m.facing.x * 8;
        eye.y = m.facing.y * 8 - 2;
      }

      // Drop pollution periodically while alive
      m.pollutionDropTimer += delta;
      if (m.pollutionDropTimer > 2500) {
        m.pollutionDropTimer = 0;
        this.dropPollution(m.sprite.x, m.sprite.y);
      }

      // Attack: only if player is in front (within facing cone) and close
      m.attackCooldown -= delta;
      if (m.attackCooldown <= 0) {
        const toPlayer = new Phaser.Math.Vector2(
          this.player.x - m.sprite.x,
          this.player.y - m.sprite.y
        );
        const dist = toPlayer.length();
        if (dist < 120) {
          toPlayer.normalize();
          const dot = m.facing.dot(toPlayer);
          // dot > 0.6 ≈ within ~53° cone in front
          if (dot > 0.6) {
            this.monsterAttack(m);
            m.attackCooldown = 1200;
          }
        }
      }
    }

    // Clean up dead monsters
    this.monsters = this.monsters.filter(m => {
      if (!m.alive) { m.sprite.destroy(); return false; }
      return true;
    });
  }

  private monsterAttack(m: Monster) {
    // Lunge toward player and deal damage if still close
    const dir = new Phaser.Math.Vector2(
      this.player.x - m.sprite.x,
      this.player.y - m.sprite.y
    ).normalize();
    this.tweens.add({
      targets: m.sprite,
      x: m.sprite.x + dir.x * 30,
      y: m.sprite.y + dir.y * 30,
      duration: 200, yoyo: true, ease: 'Quad.out',
    });

    const dist = Phaser.Math.Distance.Between(
      this.player.x, this.player.y, m.sprite.x, m.sprite.y
    );
    if (dist < 40) {
      this.health -= 12;
      this.cam.shake(100, 0.008);
      if (this.health <= 0) { this.health = 0; this.die('被怪物击杀！'); }
    }
  }

  // ── Pollution ────────────────────────────────────────────────────────────

  private dropPollution(x: number, y: number) {
    // Slight random offset
    const px = x + Phaser.Math.Between(-15, 15);
    const py = y + Phaser.Math.Between(-15, 15);
    if (this.isInsideObstacle(px, py, 10)) return;

    const puddle = this.add.circle(px, py, 14, 0x44ff00, 0.55);
    puddle.setDepth(3);
    this.tweens.add({
      targets: puddle,
      scale: { from: 0.3, to: 1 },
      duration: 300, ease: 'Back.easeOut',
    });

    this.pollutions.push({
      sprite: puddle,
      x: px, y: py,
      amount: 2,
      collected: false,
    });
  }

  private totalPollutionOnMap(): number {
    return this.pollutions
      .filter(p => !p.collected)
      .reduce((sum, p) => sum + p.amount, 0);
  }

  // ── Player Attack ────────────────────────────────────────────────────────

  private handleAttack() {
    if (this.attackCooldown > 0) return;

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.attackCooldown = 500;
      this.attackVisualTimer = 250;

      // Determine attack direction from last movement / facing
      let dx = 0, dy = 0;
      if (this.cursors.left.isDown) dx -= 1;
      if (this.cursors.right.isDown) dx += 1;
      if (this.cursors.up.isDown) dy -= 1;
      if (this.cursors.down.isDown) dy += 1;
      if (dx === 0 && dy === 0) { dx = 1; dy = 0; } // default right
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;

      // Kill monsters within range and in front cone
      for (const m of this.monsters) {
        if (!m.alive) continue;
        const toM = new Phaser.Math.Vector2(
          m.sprite.x - this.player.x,
          m.sprite.y - this.player.y
        );
        const dist = toM.length();
        if (dist > this.attackRange) continue;
        toM.normalize();
        const dot = dx * toM.x + dy * toM.y;
        if (dot > 0.3) { // wide cone
          m.alive = false;
          // burst of pollution on death
          for (let i = 0; i < 3; i++) {
            this.dropPollution(m.sprite.x, m.sprite.y);
          }
          // death effect
          this.tweens.add({
            targets: m.sprite,
            scale: 0, alpha: 0,
            duration: 250, ease: 'Quad.in',
          });
        }
      }
    }
  }

  private drawAttackArc(delta: number) {
    this.attackArc.clear();
    if (this.attackVisualTimer > 0) {
      this.attackVisualTimer -= delta;

      let dx = 0, dy = 0;
      if (this.cursors.left.isDown) dx -= 1;
      if (this.cursors.right.isDown) dx += 1;
      if (this.cursors.up.isDown) dy -= 1;
      if (this.cursors.down.isDown) dy += 1;
      if (dx === 0 && dy === 0) { dx = 1; dy = 0; }
      const angle = Math.atan2(dy, dx);

      this.attackArc.fillStyle(0x44ddff, 0.25);
      this.attackArc.lineStyle(2, 0x88eeff, 0.8);
      this.attackArc.beginPath();
      this.attackArc.moveTo(this.player.x, this.player.y);
      this.attackArc.arc(this.player.x, this.player.y, this.attackRange, angle - 0.6, angle + 0.6, false);
      this.attackArc.lineTo(this.player.x, this.player.y);
      this.attackArc.fillPath();
      this.attackArc.strokePath();
    }
  }

  // ── Collect & Deposit ────────────────────────────────────────────────────

  private checkCollect() {
    if (this.carrying >= this.carryCapacity) return;

    for (const p of this.pollutions) {
      if (p.collected) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, p.x, p.y);
      if (d < 28) {
        const space = this.carryCapacity - this.carrying;
        const take = Math.min(space, p.amount);
        this.carrying += take;
        p.amount -= take;
        if (p.amount <= 0) {
          p.collected = true;
          this.tweens.add({
            targets: p.sprite, scale: 0, alpha: 0,
            duration: 200, ease: 'Quad.in',
            onComplete: () => p.sprite.destroy(),
          });
        }
      }
    }

    // Clean up collected
    this.pollutions = this.pollutions.filter(p => !p.collected || p.sprite.active);
  }

  private checkDeposit() {
    const d = Phaser.Math.Distance.Between(
      this.player.x, this.player.y,
      this.depositZone.x, this.depositZone.y
    );
    if (d < 50 && this.carrying > 0) {
      this.deposited += this.carrying;
      this.carrying = 0;
      this.cam.flash(200, 0, 255, 100);
      if (this.deposited >= this.goal) {
        this.win();
      }
    }
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  private createUI() {
    this.healthText = this.add.text(16, 16, '生命: 100', {
      fontSize: '18px', color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.carryText = this.add.text(16, 40, '携带: 0/10', {
      fontSize: '18px', color: '#88ff88',
    }).setScrollFactor(0).setDepth(20);

    this.depositedText = this.add.text(16, 64, '已净化: 0/50', {
      fontSize: '18px', color: '#00ff66',
    }).setScrollFactor(0).setDepth(20);

    this.timerText = this.add.text(16, 88, '时间: 180s', {
      fontSize: '18px', color: '#ffff88',
    }).setScrollFactor(0).setDepth(20);

    this.pollutionText = this.add.text(16, 112, '污染: 0/80', {
      fontSize: '18px', color: '#ff4444',
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

    this.add.text(400, 560, '方向键移动 • 空格攻击 • 走到污染体上自动拾取 • 回净化站卸货', {
      fontSize: '14px', color: '#666666',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
  }

  // ── Input ────────────────────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  }

  // ── Update Loop ──────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (this.isDead || this.isWon) return;

    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    this.handlePlayerMovement(delta);
    this.handleAttack();
    this.updateMonsters(delta);
    this.checkCollect();
    this.checkDeposit();
    this.drawAttackArc(delta);
    this.updateSpawning(delta);
    this.updateTimers(delta);
    this.updateUI();

    if (this.attackCooldown > 0) this.attackCooldown -= delta;
  }

  // ── Player Movement ──────────────────────────────────────────────────────

  private handlePlayerMovement(delta: number) {
    const speed = 170;
    const dt = delta / 1000;

    let vx = 0, vy = 0;
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

  // ── Spawning ─────────────────────────────────────────────────────────────

  private updateSpawning(delta: number) {
    this.spawnTimer += delta;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      const aliveCount = this.monsters.filter(m => m.alive).length;
      if (aliveCount < this.maxMonsters) {
        this.spawnMonster();
      }
    }
  }

  // ── Timers ───────────────────────────────────────────────────────────────

  private updateTimers(delta: number) {
    this.timeLimit -= delta;
    if (this.timeLimit <= 0) {
      this.timeLimit = 0;
      this.die('时间耗尽，污染失控！');
      return;
    }

    const totalPollution = this.totalPollutionOnMap();
    if (totalPollution >= this.pollutionCap) {
      this.die('污染总量超标，任务失败！');
      return;
    }
  }

  // ── UI Update ────────────────────────────────────────────────────────────

  private updateUI() {
    this.healthText.setText(`生命: ${Math.max(0, Math.ceil(this.health))}`);
    this.carryText.setText(`携带: ${this.carrying}/${this.carryCapacity}`);
    this.depositedText.setText(`已净化: ${Math.min(this.deposited, this.goal)}/${this.goal}`);
    this.timerText.setText(`时间: ${Math.ceil(this.timeLimit / 1000)}s`);
    const total = this.totalPollutionOnMap();
    this.pollutionText.setText(`污染: ${total}/${this.pollutionCap}`);
    this.pollutionText.setColor(total > this.pollutionCap * 0.7 ? '#ff0000' : '#ff4444');
  }

  // ── Win / Lose ───────────────────────────────────────────────────────────

  private win() {
    this.isWon = true;
    this.showMessage('🎉 净化完成！\n车厢已恢复安全！\n\n按ESC返回菜单');
  }

  private die(cause: string) {
    this.isDead = true;
    this.player.setFillStyle(0x666666);
    this.showMessage(`💀 ${cause}\n\n按ESC返回菜单`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private showMessage(text: string) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
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
}
