import Phaser from 'phaser';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TowerDef {
  key: string;
  name: string;
  color: number;
  range: number;
  damage: number;
  fireRate: number;
  upgradeCost: number;
  bulletColor: number;
  bulletSpeed: number;
  splash?: number;
}

interface TowerData {
  def: TowerDef;
  level: number;
  lastFired: number;
  placed: boolean;
  slotIndex: number;
}

interface MonsterData {
  hp: number;
  maxHp: number;
  speed: number;
  reward: number;
  damage: number;
  color: number;
  size: number;
}

interface WaveDef {
  monsters: { type: string; count: number; interval: number }[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TOWER_DEFS: TowerDef[] = [
  {
    key: 'basic', name: '基础塔', color: 0x4488ff, range: 130,
    damage: 10, fireRate: 600, upgradeCost: 50,
    bulletColor: 0x88bbff, bulletSpeed: 350,
  },
  {
    key: 'sniper', name: '狙击塔', color: 0xff4444, range: 250,
    damage: 40, fireRate: 1500, upgradeCost: 80,
    bulletColor: 0xff8888, bulletSpeed: 600,
  },
  {
    key: 'splash', name: '溅射塔', color: 0x44dd44, range: 110,
    damage: 15, fireRate: 1000, upgradeCost: 100,
    bulletColor: 0x88ff88, bulletSpeed: 250, splash: 60,
  },
];

const MONSTER_TYPES: Record<string, MonsterData> = {
  grunt: { hp: 30, maxHp: 30, speed: 50, reward: 10, damage: 5, color: 0xcc44cc, size: 16 },
  fast: { hp: 15, maxHp: 15, speed: 100, reward: 15, damage: 3, color: 0xffaa00, size: 12 },
  tank: { hp: 120, maxHp: 120, speed: 30, reward: 30, damage: 15, color: 0x884444, size: 24 },
  boss: { hp: 400, maxHp: 400, speed: 25, reward: 100, damage: 30, color: 0xff0044, size: 32 },
};

const WAVES: WaveDef[] = [
  { monsters: [{ type: 'grunt', count: 5, interval: 1200 }] },
  { monsters: [{ type: 'grunt', count: 8, interval: 1000 }] },
  { monsters: [{ type: 'grunt', count: 5, interval: 1000 }, { type: 'fast', count: 3, interval: 800 }] },
  { monsters: [{ type: 'fast', count: 8, interval: 600 }] },
  { monsters: [{ type: 'grunt', count: 6, interval: 800 }, { type: 'tank', count: 2, interval: 2000 }] },
  { monsters: [{ type: 'tank', count: 5, interval: 1500 }] },
  { monsters: [{ type: 'fast', count: 10, interval: 400 }, { type: 'grunt', count: 5, interval: 800 }] },
  { monsters: [{ type: 'grunt', count: 8, interval: 600 }, { type: 'tank', count: 3, interval: 1500 }, { type: 'fast', count: 5, interval: 500 }] },
  { monsters: [{ type: 'tank', count: 5, interval: 1000 }, { type: 'fast', count: 8, interval: 400 }] },
  { monsters: [{ type: 'boss', count: 1, interval: 0 }, { type: 'grunt', count: 10, interval: 600 }, { type: 'tank', count: 3, interval: 1200 }] },
];

// ─── Scene ───────────────────────────────────────────────────────────────────

export class TowerDefenseScene extends Phaser.Scene {
  // Core
  private core!: Phaser.GameObjects.Rectangle;
  private coreHp = 100;
  private coreMaxHp = 100;

  // Player (the carrier / mover)
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private escKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private eKey!: Phaser.Input.Keyboard.Key;

  // Tower placement slots (around core)
  private towerSlots: { x: number; y: number; occupied: boolean }[] = [];
  private slotIndicators: Phaser.GameObjects.Rectangle[] = [];

  // Placed & active towers
  private placedTowers: { rect: Phaser.GameObjects.Rectangle; data: TowerData; rangeCircle?: Phaser.GameObjects.Arc }[] = [];

  // Warehouse towers (physics bodies the player can push / pick up)
  private warehouseTowers: { rect: Phaser.GameObjects.Rectangle; defIndex: number }[] = [];

  // Carrying state
  private carriedTower: { rect: Phaser.GameObjects.Rectangle; defIndex: number } | null = null;
  private carryOffsetX = 0;
  private carryOffsetY = 0;

  // Monsters
  private monsters: { sprite: Phaser.GameObjects.Rectangle; data: MonsterData; hpBar: Phaser.GameObjects.Rectangle; hpBarBg: Phaser.GameObjects.Rectangle }[] = [];

  // Bullets
  private bullets: { sprite: Phaser.GameObjects.Rectangle; target: number; damage: number; speed: number; splash?: number }[] = [];

  // Economy & state
  private money = 0;
  private score = 0;
  private wave = 0;
  private waveActive = false;
  private waveSpawnQueue: { type: string; delay: number }[] = [];
  private spawnTimer = 0;
  private gameOver = false;
  private betweenWaves = true;

  // UI
  private moneyText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;
  private coreHpText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  // Upgrade prompt
  private upgradePrompt!: Phaser.GameObjects.Text;
  private nearPlacedTowerIdx = -1;

  constructor() {
    super({ key: 'TowerDefenseScene' });
  }

  create() {
    // Reset state
    this.coreHp = 100;
    this.coreMaxHp = 100;
    this.money = 0;
    this.score = 0;
    this.wave = 0;
    this.waveActive = false;
    this.gameOver = false;
    this.betweenWaves = true;
    this.monsters = [];
    this.bullets = [];
    this.placedTowers = [];
    this.warehouseTowers = [];
    this.waveSpawnQueue = [];
    this.carriedTower = null;
    this.nearPlacedTowerIdx = -1;

    // ─── Background ──────────────────────────────────────────────────
    this.add.rectangle(400, 300, 800, 600, 0x1a1a2e);

    // Grid
    const gridColor = 0x222244;
    for (let x = 0; x <= 800; x += 40) {
      this.add.rectangle(x, 300, 1, 600, gridColor);
    }
    for (let y = 0; y <= 600; y += 40) {
      this.add.rectangle(400, y, 800, 1, gridColor);
    }

    // ─── Warehouse zone (bottom-left) ────────────────────────────────
    const warehouseBg = this.add.rectangle(75, 520, 140, 150, 0x2a2a3e, 0.8);
    warehouseBg.setStrokeStyle(2, 0x555577);
    this.add.text(75, 450, '仓库', {
      fontSize: '12px', color: '#777799',
    }).setOrigin(0.5);

    // ─── Core in center ──────────────────────────────────────────────
    this.core = this.add.rectangle(400, 280, 50, 50, 0xffdd44);
    this.core.setStrokeStyle(2, 0xffffff);
    this.physics.add.existing(this.core, true);

    // ─── Tower placement slots (ring around core) ────────────────────
    this.towerSlots = [
      { x: 400, y: 160, occupied: false },  // top
      { x: 400, y: 400, occupied: false },  // bottom
      { x: 270, y: 280, occupied: false },  // left
      { x: 530, y: 280, occupied: false },  // right
      { x: 310, y: 190, occupied: false },  // top-left
      { x: 490, y: 190, occupied: false },  // top-right
      { x: 310, y: 370, occupied: false },  // bottom-left
      { x: 490, y: 370, occupied: false },  // bottom-right
    ];

    this.slotIndicators = [];
    this.towerSlots.forEach((slot) => {
      const indicator = this.add.rectangle(slot.x, slot.y, 36, 36, 0x333355);
      indicator.setStrokeStyle(1, 0x555577);
      indicator.setAlpha(0.5);
      this.slotIndicators.push(indicator);
    });

    // ─── Player (the carrier) ────────────────────────────────────────
    this.player = this.add.rectangle(100, 400, 26, 26, 0x00ffaa);
    this.player.setStrokeStyle(2, 0xffffff);
    this.physics.add.existing(this.player);
    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    playerBody.setCollideWorldBounds(true);
    playerBody.setDrag(500);
    playerBody.setMaxSpeed(200);
    playerBody.setMass(2);

    // ─── Warehouse towers (physics bodies player can push) ───────────
    TOWER_DEFS.forEach((def, i) => {
      const x = 45 + (i % 3) * 45;
      const y = 500 + Math.floor(i / 3) * 45;
      const rect = this.add.rectangle(x, y, 28, 28, def.color);
      rect.setStrokeStyle(2, 0xffffff);

      // Label
      this.add.text(x, y - 20, def.name, {
        fontSize: '9px', color: '#aaaaaa',
      }).setOrigin(0.5);

      this.physics.add.existing(rect);
      const body = rect.body as Phaser.Physics.Arcade.Body;
      body.setCollideWorldBounds(true);
      body.setDrag(800);
      body.setMass(1.5);
      body.setBounce(0.1);

      this.warehouseTowers.push({ rect, defIndex: i });
    });

    // Player collides with warehouse towers (push them!)
    for (const wt of this.warehouseTowers) {
      this.physics.add.collider(this.player, wt.rect);
    }

    // Warehouse towers collide with each other
    for (let i = 0; i < this.warehouseTowers.length; i++) {
      for (let j = i + 1; j < this.warehouseTowers.length; j++) {
        this.physics.add.collider(this.warehouseTowers[i].rect, this.warehouseTowers[j].rect);
      }
    }

    // ─── Input ───────────────────────────────────────────────────────
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    // ─── UI ──────────────────────────────────────────────────────────
    this.moneyText = this.add.text(10, 10, '', { fontSize: '18px', color: '#ffdd44' }).setDepth(50);
    this.scoreText = this.add.text(10, 34, '', { fontSize: '18px', color: '#44ff44' }).setDepth(50);
    this.waveText = this.add.text(400, 10, '', { fontSize: '18px', color: '#ffffff' }).setOrigin(0.5, 0).setDepth(50);
    this.coreHpText = this.add.text(400, 315, '', { fontSize: '11px', color: '#ffffff' }).setOrigin(0.5, 0).setDepth(50);
    this.statusText = this.add.text(400, 580, '', { fontSize: '14px', color: '#00ffaa' }).setOrigin(0.5).setDepth(50);
    this.hintText = this.add.text(400, 460, '将塔从仓库推出，然后走进即可搬运！\n放置到核心周围的发光槽位上。按 [E] 升级附近的塔。', {
      fontSize: '12px', color: '#888888', align: 'center',
    }).setOrigin(0.5).setDepth(50);

    this.upgradePrompt = this.add.text(0, 0, '', { fontSize: '12px', color: '#44ff44' }).setOrigin(0.5).setDepth(50);

    this.updateUI();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private findNearestEmptySlot(x: number, y: number): number {
    let best = -1;
    let bestDist = 45;
    for (let i = 0; i < this.towerSlots.length; i++) {
      if (this.towerSlots[i].occupied) continue;
      const d = Phaser.Math.Distance.Between(x, y, this.towerSlots[i].x, this.towerSlots[i].y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  private findNearestPlacedTower(x: number, y: number): number {
    let best = -1;
    let bestDist = 60;
    for (let i = 0; i < this.placedTowers.length; i++) {
      const t = this.placedTowers[i];
      const d = Phaser.Math.Distance.Between(x, y, t.rect.x, t.rect.y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  private isInWarehouse(x: number, y: number): boolean {
    return x < 150 && y > 445;
  }

  private placeTower(defIndex: number, slotIndex: number) {
    const def = TOWER_DEFS[defIndex];
    const slot = this.towerSlots[slotIndex];
    slot.occupied = true;

    // Create placed tower graphic
    const rect = this.add.rectangle(slot.x, slot.y, 32, 32, def.color);
    rect.setStrokeStyle(2, 0xffffff);

    // Range circle
    const rangeCircle = this.add.circle(slot.x, slot.y, def.range, def.color, 0.08);
    rangeCircle.setStrokeStyle(1, def.color, 0.25);

    // Flash slot
    const indicator = this.slotIndicators[slotIndex];
    this.tweens.add({
      targets: indicator,
      alpha: 0,
      duration: 300,
    });

    const towerData: TowerData = {
      def,
      level: 1,
      lastFired: 0,
      placed: true,
      slotIndex,
    };

    this.placedTowers.push({ rect, data: towerData, rangeCircle });
  }

  private startNextWave() {
    if (this.wave >= WAVES.length) {
      this.wave = 0;
    }

    this.betweenWaves = false;
    this.waveActive = true;
    this.wave++;
    this.hintText.setVisible(false);

    const waveDef = WAVES[(this.wave - 1) % WAVES.length];
    this.waveSpawnQueue = [];

    let totalDelay = 0;
    waveDef.monsters.forEach((group) => {
      for (let i = 0; i < group.count; i++) {
        this.waveSpawnQueue.push({ type: group.type, delay: totalDelay });
        totalDelay += group.interval;
      }
    });

    this.spawnTimer = 0;
    this.updateUI();
  }

  private spawnMonster(type: string) {
    const base = MONSTER_TYPES[type];
    const hpScale = 1 + (this.wave - 1) * 0.15;
    const hp = Math.floor(base.hp * hpScale);

    const side = Phaser.Math.Between(0, 3);
    let x: number, y: number;
    switch (side) {
      case 0: x = Phaser.Math.Between(20, 780); y = -20; break;
      case 1: x = Phaser.Math.Between(20, 780); y = 620; break;
      case 2: x = -20; y = Phaser.Math.Between(20, 580); break;
      default: x = 820; y = Phaser.Math.Between(20, 580); break;
    }

    const sprite = this.add.rectangle(x, y, base.size, base.size, base.color);
    sprite.setStrokeStyle(1, 0x000000);

    const hpBarBg = this.add.rectangle(x, y - base.size / 2 - 6, base.size + 4, 4, 0x333333);
    const hpBar = this.add.rectangle(x, y - base.size / 2 - 6, base.size + 4, 4, 0x44ff44);

    this.monsters.push({
      sprite,
      data: { ...base, hp, maxHp: hp },
      hpBar,
      hpBarBg,
    });
  }

  private fireBullet(tower: typeof this.placedTowers[0], targetIdx: number) {
    const def = tower.data.def;
    const level = tower.data.level;
    const damage = def.damage * level;

    const bullet = this.add.rectangle(tower.rect.x, tower.rect.y, 6, 6, def.bulletColor);
    this.bullets.push({
      sprite: bullet,
      target: targetIdx,
      damage,
      speed: def.bulletSpeed,
      splash: def.splash,
    });

    tower.data.lastFired = this.time.now;
  }

  private damageMonster(index: number, damage: number) {
    if (index < 0 || index >= this.monsters.length) return;
    const m = this.monsters[index];
    m.data.hp -= damage;

    const ratio = Math.max(0, m.data.hp / m.data.maxHp);
    m.hpBar.width = (m.data.size + 4) * ratio;
    if (ratio < 0.3) m.hpBar.setFillStyle(0xff4444);
    else if (ratio < 0.6) m.hpBar.setFillStyle(0xffaa44);

    if (m.data.hp <= 0) {
      this.money += m.data.reward;
      this.score += m.data.reward;
      this.floatRewardText(m.sprite.x, m.sprite.y, m.data.reward);
      this.killMonster(index);
    }
  }

  private floatRewardText(x: number, y: number, value: number) {
    const txt = this.add.text(x, y, `+$${value}`, {
      fontSize: '14px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(60);
    this.tweens.add({
      targets: txt,
      y: y - 30,
      alpha: 0,
      duration: 800,
      onComplete: () => txt.destroy(),
    });
  }

  private killMonster(index: number) {
    const m = this.monsters[index];
    this.tweens.add({
      targets: m.sprite,
      alpha: 0,
      duration: 150,
      onComplete: () => {
        m.sprite.destroy();
        m.hpBar.destroy();
        m.hpBarBg.destroy();
      },
    });
    this.monsters.splice(index, 1);
    this.updateUI();
  }

  private updateUI() {
    this.moneyText.setText(`$ ${this.money}`);
    this.scoreText.setText(`分数: ${this.score}`);
    this.waveText.setText(this.waveActive ? `第 ${this.wave} 波` : (this.betweenWaves ? `[空格] 开始第 ${this.wave + 1} 波` : ''));
    this.coreHpText.setText(`${this.coreHp}/${this.coreMaxHp}`);
  }

  update(_time: number, delta: number) {
    if (this.gameOver) return;

    // ESC to menu
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    // ─── Player movement ──────────────────────────────────────────────
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const accel = 800;

    if (this.cursors.left.isDown) body.setAccelerationX(-accel);
    else if (this.cursors.right.isDown) body.setAccelerationX(accel);
    else body.setAccelerationX(0);

    if (this.cursors.up.isDown) body.setAccelerationY(-accel);
    else if (this.cursors.down.isDown) body.setAccelerationY(accel);
    else body.setAccelerationY(0);

    // ─── Carrying a tower: move it with the player ───────────────────
    if (this.carriedTower) {
      this.carriedTower.rect.x = this.player.x + this.carryOffsetX;
      this.carriedTower.rect.y = this.player.y + this.carryOffsetY;
      // Zero out its physics velocity so it doesn't drift
      const cBody = this.carriedTower.rect.body as Phaser.Physics.Arcade.Body;
      cBody.setVelocity(0, 0);
    }

    // ─── SPACE: pick up / drop tower, or start wave ──────────────────
    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      if (this.carriedTower) {
        // Try to place on a slot
        const slotIdx = this.findNearestEmptySlot(this.carriedTower.rect.x, this.carriedTower.rect.y);
        if (slotIdx >= 0) {
          // Place it!
          const defIndex = this.carriedTower.defIndex;
          // Destroy the carried physics body
          this.carriedTower.rect.destroy();
          this.carriedTower = null;
          this.placeTower(defIndex, slotIdx);
          this.statusText.setText('塔已放置！');
          this.time.delayedCall(1500, () => {
            if (!this.gameOver) this.statusText.setText('');
          });
        } else if (this.isInWarehouse(this.player.x, this.player.y)) {
          // Drop back in warehouse area
          this.carriedTower.rect.x = this.player.x + this.carryOffsetX;
          this.carriedTower.rect.y = this.player.y + this.carryOffsetY;
          const cBody = this.carriedTower.rect.body as Phaser.Physics.Arcade.Body;
          cBody.setVelocity(0, 0);
          this.carriedTower = null;
          this.statusText.setText('');
        } else {
          // Drop on the ground (becomes a pushable block again)
          const cBody = this.carriedTower.rect.body as Phaser.Physics.Arcade.Body;
          cBody.setVelocity(0, 0);
          this.carriedTower = null;
          this.statusText.setText('');
        }
      } else {
        // Try to pick up a warehouse tower or a dropped tower
        let pickedUp = this.tryPickup();
        // If not picked up, try to pick up a placed tower
        if (!pickedUp) {
          pickedUp = this.tryPickupPlacedTower();
        }
        if (!pickedUp && this.betweenWaves) {
          this.startNextWave();
        }
      }
    }

    // ─── E: upgrade nearby placed tower ──────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
      const idx = this.findNearestPlacedTower(this.player.x, this.player.y);
      if (idx >= 0) {
        const tower = this.placedTowers[idx];
        const upgCost = Math.floor(tower.data.def.upgradeCost * tower.data.level);
        if (this.money >= upgCost) {
          this.money -= upgCost;
          tower.data.level++;
          // Update range circle
          if (tower.rangeCircle) {
            const newRange = tower.data.def.range + (tower.data.level - 1) * 20;
            tower.rangeCircle.setRadius(newRange);
          }
          // Flash effect
          this.tweens.add({
            targets: tower.rect,
            alpha: 0.3,
            duration: 100,
            yoyo: true,
            repeat: 2,
          });
          this.statusText.setText(`${tower.data.def.name} 升级到 Lv.${tower.data.level}！`);
          this.time.delayedCall(1500, () => {
            if (!this.gameOver) this.statusText.setText('');
          });
          this.updateUI();
        } else {
          this.statusText.setText(`需要 $${upgCost} 才能升级！`);
          this.time.delayedCall(1500, () => {
            if (!this.gameOver) this.statusText.setText('');
          });
        }
      }
    }

    // ─── Pickup detection (walk into tower to pick up) ───────────────
    if (!this.carriedTower) {
      // Check warehouse towers
      for (const wt of this.warehouseTowers) {
        if (!wt.rect.active) continue;
        const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, wt.rect.x, wt.rect.y);
        if (d < 30) {
          // Pick up!
          this.carriedTower = wt;
          this.carryOffsetX = wt.rect.x - this.player.x;
          this.carryOffsetY = wt.rect.y - this.player.y;
          // Disable physics on carried tower
          const cBody = wt.rect.body as Phaser.Physics.Arcade.Body;
          cBody.setAllowGravity(false);
          cBody.setImmovable(true);
          cBody.setVelocity(0, 0);
          wt.rect.setAlpha(0.8);
          wt.rect.setDepth(10);
          this.statusText.setText(`正在搬运 ${TOWER_DEFS[wt.defIndex].name} - 移动到槽位并按 [空格]`);
          break;
        }
      }

      // Also check dropped towers (warehouse towers that were pushed out)
      // They are still in warehouseTowers array but outside the warehouse zone
    }

    // ─── Status text for near-slot / near-tower hints ────────────────
    if (this.carriedTower) {
      const slotIdx = this.findNearestEmptySlot(this.carriedTower.rect.x, this.carriedTower.rect.y);
      if (slotIdx >= 0) {
        // Highlight the slot
        this.slotIndicators[slotIdx].setAlpha(1);
        this.slotIndicators[slotIdx].setFillStyle(0x44ff44);
        // Reset others
        for (let i = 0; i < this.slotIndicators.length; i++) {
          if (i !== slotIdx && !this.towerSlots[i].occupied) {
            this.slotIndicators[i].setFillStyle(0x333355);
            this.slotIndicators[i].setAlpha(0.5);
          }
        }
      } else {
        // Reset all slot highlights
        for (let i = 0; i < this.slotIndicators.length; i++) {
          if (!this.towerSlots[i].occupied) {
            this.slotIndicators[i].setFillStyle(0x333355);
            this.slotIndicators[i].setAlpha(0.5);
          }
        }
      }
    }

    // ─── Upgrade prompt for nearby placed tower ──────────────────────
    this.nearPlacedTowerIdx = this.findNearestPlacedTower(this.player.x, this.player.y);
    if (this.nearPlacedTowerIdx >= 0 && !this.carriedTower) {
      const tower = this.placedTowers[this.nearPlacedTowerIdx];
      const upgCost = Math.floor(tower.data.def.upgradeCost * tower.data.level);
      this.upgradePrompt.setPosition(tower.rect.x, tower.rect.y - 30);
      this.upgradePrompt.setText(`[E] 升级 Lv.${tower.data.level} ($${upgCost})`);
      this.upgradePrompt.setColor(this.money >= upgCost ? '#44ff44' : '#ff4444');
      this.upgradePrompt.setVisible(true);
    } else {
      this.upgradePrompt.setVisible(false);
    }

    // ─── Wave spawning ────────────────────────────────────────────────
    if (this.waveActive && this.waveSpawnQueue.length > 0) {
      this.spawnTimer += delta;
      while (this.waveSpawnQueue.length > 0 && this.spawnTimer >= this.waveSpawnQueue[0].delay) {
        this.spawnMonster(this.waveSpawnQueue[0].type);
        this.waveSpawnQueue.shift();
      }
    }

    // Check wave complete
    if (this.waveActive && this.waveSpawnQueue.length === 0 && this.monsters.length === 0) {
      this.waveActive = false;
      this.betweenWaves = true;
      this.score += this.wave * 50;
      this.updateUI();
    }

    // ─── Monster movement toward core ─────────────────────────────────
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      const dx = this.core.x - m.sprite.x;
      const dy = this.core.y - m.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 30) {
        this.coreHp -= m.data.damage;
        this.tweens.add({
          targets: this.core,
          alpha: 0.3,
          duration: 100,
          yoyo: true,
        });
        m.sprite.destroy();
        m.hpBar.destroy();
        m.hpBarBg.destroy();
        this.monsters.splice(i, 1);

        if (this.coreHp <= 0) {
          this.coreHp = 0;
          this.endGame();
        }
        this.updateUI();
        continue;
      }

      const speed = m.data.speed;
      m.sprite.x += (dx / dist) * speed * (delta / 1000);
      m.sprite.y += (dy / dist) * speed * (delta / 1000);
      m.hpBar.x = m.sprite.x;
      m.hpBar.y = m.sprite.y - m.data.size / 2 - 6;
      m.hpBarBg.x = m.sprite.x;
      m.hpBarBg.y = m.sprite.y - m.data.size / 2 - 6;
    }

    // ─── Tower firing ─────────────────────────────────────────────────
    for (const tower of this.placedTowers) {
      const def = tower.data.def;
      const level = tower.data.level;
      const fireRate = Math.max(200, def.fireRate - (level - 1) * 50);
      const range = def.range + (level - 1) * 20;

      if (this.time.now - tower.data.lastFired < fireRate) continue;
      if (this.monsters.length === 0) continue;

      let nearestIdx = -1;
      let nearestDist = range;
      for (let i = 0; i < this.monsters.length; i++) {
        const m = this.monsters[i];
        const d = Phaser.Math.Distance.Between(tower.rect.x, tower.rect.y, m.sprite.x, m.sprite.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }

      if (nearestIdx >= 0) {
        this.fireBullet(tower, nearestIdx);
      }
    }

    // ─── Bullet movement ──────────────────────────────────────────────
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];

      if (b.target >= this.monsters.length || b.target < 0) {
        b.sprite.destroy();
        this.bullets.splice(i, 1);
        continue;
      }

      const target = this.monsters[b.target];
      if (!target || !target.sprite || !target.sprite.active) {
        b.sprite.destroy();
        this.bullets.splice(i, 1);
        continue;
      }

      const dx = target.sprite.x - b.sprite.x;
      const dy = target.sprite.y - b.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 10) {
        if (b.splash) {
          for (let j = this.monsters.length - 1; j >= 0; j--) {
            const m = this.monsters[j];
            const sd = Phaser.Math.Distance.Between(b.sprite.x, b.sprite.y, m.sprite.x, m.sprite.y);
            if (sd <= b.splash) {
              this.damageMonster(j, b.damage * (1 - sd / b.splash * 0.5));
            }
          }
          const splashCircle = this.add.circle(b.sprite.x, b.sprite.y, b.splash, 0x44ff44, 0.3);
          this.tweens.add({
            targets: splashCircle,
            alpha: 0,
            scale: 1.5,
            duration: 200,
            onComplete: () => splashCircle.destroy(),
          });
        } else {
          this.damageMonster(b.target, b.damage);
        }
        b.sprite.destroy();
        this.bullets.splice(i, 1);
        continue;
      }

      const speed = b.speed * (delta / 1000);
      b.sprite.x += (dx / dist) * speed;
      b.sprite.y += (dy / dist) * speed;

      if (b.sprite.x < -50 || b.sprite.x > 850 || b.sprite.y < -50 || b.sprite.y > 650) {
        b.sprite.destroy();
        this.bullets.splice(i, 1);
      }
    }

    // ─── Core pulse effect ────────────────────────────────────────────
    const pulse = 0.8 + Math.sin(this.time.now / 500) * 0.2;
    this.core.setAlpha(pulse);
  }

  private tryPickup(): boolean {
    // Check all warehouse towers (including those pushed out of warehouse)
    for (const wt of this.warehouseTowers) {
      if (!wt.rect.active) continue;
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, wt.rect.x, wt.rect.y);
      if (d < 30) {
        this.carriedTower = wt;
        this.carryOffsetX = wt.rect.x - this.player.x;
        this.carryOffsetY = wt.rect.y - this.player.y;
        const cBody = wt.rect.body as Phaser.Physics.Arcade.Body;
        cBody.setAllowGravity(false);
        cBody.setImmovable(true);
        cBody.setVelocity(0, 0);
        wt.rect.setAlpha(0.8);
        wt.rect.setDepth(10);
        this.statusText.setText(`正在搬运 ${TOWER_DEFS[wt.defIndex].name} - 移动到槽位并按 [空格]`);
        return true;
      }
    }
    return false;
  }

  private tryPickupPlacedTower(): boolean {
    // Find a placed tower near the player
    for (let i = 0; i < this.placedTowers.length; i++) {
      const tower = this.placedTowers[i];
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, tower.rect.x, tower.rect.y);
      if (d < 40) {
        // Pick up this placed tower!
        const defIndex = TOWER_DEFS.findIndex(def => def.key === tower.data.def.key);
        const level = tower.data.level;

        // Free the slot
        this.towerSlots[tower.data.slotIndex].occupied = false;

        // Remove range circle
        if (tower.rangeCircle) {
          tower.rangeCircle.destroy();
        }

        // Remove the placed tower graphic
        tower.rect.destroy();
        this.placedTowers.splice(i, 1);

        // Create a new physics body for the carried tower
        const newRect = this.add.rectangle(this.player.x, this.player.y, 28, 28, TOWER_DEFS[defIndex].color);
        newRect.setStrokeStyle(2, 0xffffff);
        this.physics.add.existing(newRect);
        const body = newRect.body as Phaser.Physics.Arcade.Body;
        body.setCollideWorldBounds(true);
        body.setDrag(800);
        body.setMass(1.5);
        body.setBounce(0.1);
        body.setVelocity(0, 0);

        // Add to warehouse towers array so it can be pushed/picked up
        const newWarehouseTower = { rect: newRect, defIndex };
        this.warehouseTowers.push(newWarehouseTower);

        // Set up colliders with player and other warehouse towers
        this.physics.add.collider(this.player, newRect);
        for (const wt of this.warehouseTowers) {
          if (wt.rect !== newRect) {
            this.physics.add.collider(newRect, wt.rect);
          }
        }

        // Immediately pick it up
        this.carriedTower = newWarehouseTower;
        this.carryOffsetX = 0;
        this.carryOffsetY = 0;
        body.setAllowGravity(false);
        body.setImmovable(true);
        newRect.setAlpha(0.8);
        newRect.setDepth(10);

        this.statusText.setText(`正在搬运 Lv.${level} ${TOWER_DEFS[defIndex].name} - 移动到槽位并按 [空格]`);
        return true;
      }
    }
    return false;
  }

  private endGame() {
    this.gameOver = true;

    const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.7);
    overlay.setDepth(200);

    this.add.text(400, 220, '游戏结束', {
      fontSize: '48px', color: '#ff4444', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(201);

    this.add.text(400, 290, `分数: ${this.score}`, {
      fontSize: '28px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(201);

    this.add.text(400, 330, `坚持波数: ${this.wave}`, {
      fontSize: '22px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(201);

    const restartBtn = this.add.text(400, 400, '[ 重新开始 ]', {
      fontSize: '24px', color: '#44ff44',
    }).setOrigin(0.5).setDepth(201).setInteractive({ useHandCursor: true });

    const menuBtn = this.add.text(400, 440, '[ 返回菜单 ]', {
      fontSize: '20px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(201).setInteractive({ useHandCursor: true });

    restartBtn.on('pointerdown', () => {
      this.scene.restart();
    });

    menuBtn.on('pointerdown', () => {
      this.scene.start('MenuScene');
    });
  }
}
