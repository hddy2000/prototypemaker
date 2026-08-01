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
  sprite: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  speed: number;
  chaseSpeed: number;
  direction: Phaser.Math.Vector2;
  patrolTimer: number;
  isChasing: boolean;
  visionRange: number;
  homeX: number;
  homeY: number;
  giveUpTimer: number;
  giveUpDuration: number;
  alive: boolean;
  isBoss: boolean;
  bossDamage: number;
}

interface SafeRoom {
  x: number;
  y: number;
  w: number;
  h: number;
  centerX: number;
  centerY: number;
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
  private ball!: Phaser.GameObjects.Image; // 足球——玩家可推动/滚动
  private ballRadius = 14;
  private ballAbsorbRange = 90; // 足球周围吸收材料的范围（无需碰撞即可吸收）
  private ballVx = 0;
  private ballVy = 0;
  private ballFriction = 0.985; // 每帧速度衰减
  private ballMaxSpeed = 600;
  private ballPushForce = 320; // 玩家碰撞时赋予的速度
  private ballRotation: { angle: number } = { angle: 0 }; // 用于旋转动画
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
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
  private safeRooms: SafeRoom[] = [];
  private exit!: Phaser.GameObjects.Rectangle;

  // Player stats
  private health = 100;
  private collectedMaterials = new Set<MaterialType>();
  private damageCooldown = 0;
  private playerVx = 0; // 上一帧玩家速度，用于推动足球
  private playerVy = 0;

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
    // ── 重置所有实例状态（scene.start() 复用同一对象）──
    this.isDead = false;
    this.isWon = false;
    this.health = 100;
    this.damageCooldown = 0;
    this.collectedMaterials.clear();
    this.materials = [];
    this.monsters = [];
    this.safeRooms = [];
    this.obstacles = [];
    this.stamina = 100;
    this.isSprinting = false;
    this.staminaRegenDelay = 0;
    this.playerVx = 0;
    this.playerVy = 0;
    this.ballVx = 0;
    this.ballVy = 0;
    this.ballRotation.angle = 0;

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateObstacles();
    this.createSafeRooms();
    this.drawMap();
    this.createPlayer();
    this.createBall();
    this.createMaterials();
    this.createMonsters();
    this.createExit();
    this.createFog();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);

    this.showMessage('把足球滚到材料上拾取！\n收集5种材料升级后滚到终点通关\n绿色房间可躲避怪物');
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

  // ─── Safe rooms (躲避小房间) ─────────────────────────────────

  private createSafeRooms() {
    this.safeRooms = [];

    const roomCount = 4;
    const roomW = 160;
    const roomH = 120;
    const wallThick = 16;
    const doorWidth = 50;

    let placed = 0;
    let attempts = 0;

    while (placed < roomCount && attempts < 500) {
      attempts++;
      const x = Phaser.Math.Between(150, this.mapWidth - 150 - roomW);
      const y = Phaser.Math.Between(150, this.mapHeight - 150 - roomH);

      // 避开起点和终点
      const distToStart = Phaser.Math.Distance.Between(x + roomW / 2, y + roomH / 2, 80, 80);
      const distToExit = Phaser.Math.Distance.Between(x + roomW / 2, y + roomH / 2, this.mapWidth - 80, this.mapHeight - 80);
      if (distToStart < 350 || distToExit < 250) continue;

      // 避免与已有安全房重叠
      let overlap = false;
      for (const r of this.safeRooms) {
        if (x < r.x + r.w + 80 && x + roomW + 80 > r.x &&
            y < r.y + r.h + 80 && y + roomH + 80 > r.y) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;

      const room: SafeRoom = {
        x, y, w: roomW, h: roomH,
        centerX: x + roomW / 2,
        centerY: y + roomH / 2,
      };
      this.safeRooms.push(room);

      // 建造四面墙，每面墙留一个门口
      // 上墙（留中间门口）
      this.obstacles.push({ x: room.x, y: room.y - wallThick, w: (roomW - doorWidth) / 2, h: wallThick });
      this.obstacles.push({ x: room.x + (roomW + doorWidth) / 2, y: room.y - wallThick, w: (roomW - doorWidth) / 2, h: wallThick });
      // 下墙
      this.obstacles.push({ x: room.x, y: room.y + roomH, w: (roomW - doorWidth) / 2, h: wallThick });
      this.obstacles.push({ x: room.x + (roomW + doorWidth) / 2, y: room.y + roomH, w: (roomW - doorWidth) / 2, h: wallThick });
      // 左墙
      this.obstacles.push({ x: room.x - wallThick, y: room.y, w: wallThick, h: (roomH - doorWidth) / 2 });
      this.obstacles.push({ x: room.x - wallThick, y: room.y + (roomH + doorWidth) / 2, w: wallThick, h: (roomH - doorWidth) / 2 });
      // 右墙
      this.obstacles.push({ x: room.x + roomW, y: room.y, w: wallThick, h: (roomH - doorWidth) / 2 });
      this.obstacles.push({ x: room.x + roomW, y: room.y + (roomH + doorWidth) / 2, w: wallThick, h: (roomH - doorWidth) / 2 });

      placed++;
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

    // 安全房地面（高亮显示，让玩家容易找到躲避处）
    this.mapGraphics.fillStyle(0x1a3a1a, 0.6);
    for (const room of this.safeRooms) {
      this.mapGraphics.fillRect(room.x, room.y, room.w, room.h);
    }
    this.mapGraphics.lineStyle(2, 0x44ff44, 0.5);
    for (const room of this.safeRooms) {
      this.mapGraphics.strokeRect(room.x, room.y, room.w, room.h);
    }

    this.mapGraphics.lineStyle(2, 0x555577, 1);
    this.mapGraphics.strokeRect(20, 20, this.mapWidth - 40, this.mapHeight - 40);
  }

  // ─── Player & Item A ──────────────────────────────────────────

  private createPlayer() {
    this.player = this.add.rectangle(80, 80, 24, 24, 0x00ff00);
    this.player.setDepth(5);
  }

  private createBall() {
    // 生成足球纹理（程序化绘制）
    if (!this.textures.exists('escortBall')) {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const cx = size / 2;
      const cy = size / 2;
      const r = size / 2 - 2;

      // 白色底
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // 黑色五边形花纹（简化版足球）
      ctx.fillStyle = '#222222';
      const drawPentagon = (px: number, py: number, pr: number, rot: number) => {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = rot + (i / 5) * Math.PI * 2 - Math.PI / 2;
          const x = px + Math.cos(a) * pr;
          const y = py + Math.sin(a) * pr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      };

      // 中心五边形
      drawPentagon(cx, cy, r * 0.32, 0);
      // 周围5个
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const px = cx + Math.cos(a) * r * 0.62;
        const py = cy + Math.sin(a) * r * 0.62;
        drawPentagon(px, py, r * 0.22, a + Math.PI);
      }

      // 边框
      ctx.strokeStyle = '#444444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      this.textures.addCanvas('escortBall', canvas);
    }

    // 足球放在玩家前方
    this.ball = this.add.image(this.player.x + 40, this.player.y, 'escortBall');
    const count = this.collectedMaterials.size;
    const scale = (this.ballRadius * 2) / 64 * (1 + count * 0.08);
    this.ball.setScale(scale);
    this.ball.setDepth(6);
  }

  private updateBall(delta: number) {
    const dt = delta / 1000;

    // 玩家与足球碰撞 → 推动足球
    const dx = this.ball.x - this.player.x;
    const dy = this.ball.y - this.player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const playerHalf = 12;
    const minDist = playerHalf + this.ballRadius;

    if (dist < minDist && dist > 0.01) {
      // 法线方向
      const nx = dx / dist;
      const ny = dy / dist;

      // 把球推到接触面之外（检查目标位置不在墙内）
      const targetX = this.player.x + nx * minDist;
      const targetY = this.player.y + ny * minDist;
      if (!this.circleCollidesObstacle(targetX, targetY, this.ballRadius)) {
        this.ball.x = targetX;
        this.ball.y = targetY;
      }

      // 玩家朝球方向的速度分量赋予球
      const pSpeed = Math.sqrt(this.playerVx * this.playerVx + this.playerVy * this.playerVy);
      if (pSpeed > 1) {
        const dot = this.playerVx * nx + this.playerVy * ny;
        if (dot > 0) {
          // 玩家正朝球方向移动 → 推球
          this.ballVx += nx * this.ballPushForce * dt * 60 * 0.5;
          this.ballVy += ny * this.ballPushForce * dt * 60 * 0.5;
        }
      }
    }

    // 摩擦衰减
    const friction = Math.pow(this.ballFriction, delta / 16.67);
    this.ballVx *= friction;
    this.ballVy *= friction;

    // 限速
    const speed = Math.sqrt(this.ballVx * this.ballVx + this.ballVy * this.ballVy);
    if (speed > this.ballMaxSpeed) {
      this.ballVx = (this.ballVx / speed) * this.ballMaxSpeed;
      this.ballVy = (this.ballVy / speed) * this.ballMaxSpeed;
    }

    // 微速度归零
    if (Math.abs(this.ballVx) < 0.5) this.ballVx = 0;
    if (Math.abs(this.ballVy) < 0.5) this.ballVy = 0;

    // 移动 + 障碍物碰撞（精确圆检测，分轴滑动）
    const newX = this.ball.x + this.ballVx * dt;
    if (!this.circleCollidesObstacle(newX, this.ball.y, this.ballRadius)) {
      this.ball.x = newX;
    } else {
      this.ballVx *= -0.4; // 反弹
    }

    const newY = this.ball.y + this.ballVy * dt;
    if (!this.circleCollidesObstacle(this.ball.x, newY, this.ballRadius)) {
      this.ball.y = newY;
    } else {
      this.ballVy *= -0.4; // 反弹
    }

    // 边界
    this.ball.x = Phaser.Math.Clamp(this.ball.x, this.ballRadius + 20, this.mapWidth - this.ballRadius - 20);
    this.ball.y = Phaser.Math.Clamp(this.ball.y, this.ballRadius + 20, this.mapHeight - this.ballRadius - 20);

    // 兜底：如果球仍卡在墙里，强制推出
    this.pushBallOutOfWalls();

    // 旋转动画（根据滚动方向）
    const rollSpeed = Math.sqrt(this.ballVx * this.ballVx + this.ballVy * this.ballVy);
    if (rollSpeed > 1) {
      const rotDir = this.ballVx >= 0 ? 1 : -1;
      this.ballRotation.angle += rotDir * rollSpeed * dt * 0.08;
      this.ball.setRotation(this.ballRotation.angle);
    }

    // 根据已收集材料数量改变大小
    const count = this.collectedMaterials.size;
    const scale = (this.ballRadius * 2) / 64 * (1 + count * 0.08);
    this.ball.setScale(scale);

    // 集齐后彩虹色调
    if (count >= 5) {
      const hue = (this.time.now / 10) % 360;
      const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1).color;
      this.ball.setTint(color);
    } else if (count > 0) {
      this.ball.setTint(0xffcc88);
    } else {
      this.ball.clearTint();
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

      // 不生成在安全房内
      if (this.isInsideSafeRoom(x, y)) {
        attempts++;
        continue;
      }

      if (!this.isInsideObstacle(x, y, 12)) {
        const isBoss = placed < 2; // 前2只为Boss怪
        const size = isBoss ? 24 : 14;
        const color = isBoss ? 0xff00ff : 0xff8800;
        const alpha = isBoss ? 0.9 : 0.7;

        const container = this.add.container(x, y);
        container.setDepth(5);
        const body = this.add.arc(0, 0, size, 0, 360, false, color, alpha);
        container.add(body);

        if (isBoss) {
          const crown = this.add.text(0, -size - 5, '👑', { fontSize: '16px' }).setOrigin(0.5);
          container.add(crown);
        }

        this.monsters.push({
          sprite: container,
          body,
          speed: isBoss ? 40 : 30,
          chaseSpeed: isBoss ? 100 : 70,
          direction: new Phaser.Math.Vector2(Phaser.Math.Between(-1, 1), Phaser.Math.Between(-1, 1)).normalize(),
          patrolTimer: 0,
          isChasing: false,
          visionRange: isBoss ? 300 : 200,
          homeX: x,
          homeY: y,
          giveUpTimer: 0,
          giveUpDuration: isBoss ? 5000 : 3000,
          alive: true,
          isBoss,
          bossDamage: isBoss ? 40 : 15,
        });
        placed++;
      }
      attempts++;
    }
  }

  private isInsideSafeRoom(x: number, y: number): boolean {
    for (const room of this.safeRooms) {
      if (x >= room.x && x <= room.x + room.w &&
          y >= room.y && y <= room.y + room.h) {
        return true;
      }
    }
    return false;
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
    this.healthText = this.add.text(16, 16, '生命: 100', {
      fontSize: '18px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.materialsText = this.add.text(16, 40, '', {
      fontSize: '16px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(20);

    this.itemStatusText = this.add.text(16, 70, '足球: 基础形态 (0/5)', {
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

    const backBtn = this.add.text(680, 16, '← 菜单', {
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
      this.itemStatusText.setText('足球: 完全体! (5/5) 🌈');
      this.itemStatusText.setColor('#ff00ff');
    } else {
      this.itemStatusText.setText(`足球: 升级中 (${count}/5)`);
      this.itemStatusText.setColor('#ffdd00');
    }
  }

  // ─── Input ────────────────────────────────────────────────────

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasdKeys = this.input.keyboard!.addKeys('W,A,S,D') as { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
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
    this.updateBall(delta);
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
                   this.cursors.up.isDown || this.cursors.down.isDown ||
                   this.wasdKeys.A.isDown || this.wasdKeys.D.isDown ||
                   this.wasdKeys.W.isDown || this.wasdKeys.S.isDown;

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
    let actualVx = 0;
    let actualVy = 0;

    if (vx !== 0) {
      const dx = vx * dt;
      const newX = this.player.x + dx;
      const edgeX = newX + (dx > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(edgeX, this.player.y - halfSize, halfSize) &&
          !this.isObstacleAt(edgeX, this.player.y + halfSize, halfSize)) {
        this.player.x = newX;
        actualVx = vx;
      }
    }

    if (vy !== 0) {
      const dy = vy * dt;
      const newY = this.player.y + dy;
      const edgeY = newY + (dy > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(this.player.x - halfSize, edgeY, halfSize) &&
          !this.isObstacleAt(this.player.x + halfSize, edgeY, halfSize)) {
        this.player.y = newY;
        actualVy = vy;
      }
    }

    // 记录实际速度供推动足球使用
    this.playerVx = actualVx;
    this.playerVy = actualVy;
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

  // 圆与所有障碍物的碰撞检测（精确）
  private circleCollidesObstacle(x: number, y: number, radius: number): boolean {
    for (const obs of this.obstacles) {
      const closestX = Phaser.Math.Clamp(x, obs.x, obs.x + obs.w);
      const closestY = Phaser.Math.Clamp(y, obs.y, obs.y + obs.h);
      const dx = x - closestX;
      const dy = y - closestY;
      if (dx * dx + dy * dy < radius * radius) return true;
    }
    return false;
  }

  // 如果球卡在墙里，沿最短路径推出到自由位置
  private pushBallOutOfWalls() {
    if (!this.circleCollidesObstacle(this.ball.x, this.ball.y, this.ballRadius)) return;

    // 搜索最近的自由位置（螺旋向外）
    const maxSearch = 200;
    for (let r = 4; r <= maxSearch; r += 4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const tx = this.ball.x + Math.cos(a) * r;
        const ty = this.ball.y + Math.sin(a) * r;
        if (!this.circleCollidesObstacle(tx, ty, this.ballRadius)) {
          this.ball.x = tx;
          this.ball.y = ty;
          return;
        }
      }
    }
  }

  // ─── Monster AI (BlindBoxHorror 风格) ────────────────────────

  private updateMonsters(delta: number) {
    for (const monster of this.monsters) {
      if (!monster.alive || !monster.sprite.visible) continue;

      const distToPlayer = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        monster.sprite.x, monster.sprite.y
      );

      // 进入视野范围 → 开始追击
      if (distToPlayer < monster.visionRange && !monster.isChasing) {
        monster.isChasing = true;
        monster.giveUpTimer = monster.giveUpDuration;
      }

      if (monster.isChasing) {
        // 追击：朝玩家移动
        const dir = new Phaser.Math.Vector2(
          this.player.x - monster.sprite.x,
          this.player.y - monster.sprite.y
        ).normalize();
        monster.sprite.x += dir.x * monster.chaseSpeed * delta / 1000;
        monster.sprite.y += dir.y * monster.chaseSpeed * delta / 1000;

        // 放弃条件：超时 或 超出视野1.5倍
        monster.giveUpTimer -= delta;
        if (monster.giveUpTimer <= 0 || distToPlayer > monster.visionRange * 1.5) {
          monster.isChasing = false;
        }
      } else {
        // 巡逻：随机方向移动
        monster.sprite.x += monster.direction.x * monster.speed * delta / 1000;
        monster.sprite.y += monster.direction.y * monster.speed * delta / 1000;

        monster.patrolTimer -= delta;
        if (monster.patrolTimer <= 0) {
          monster.direction = new Phaser.Math.Vector2(
            Phaser.Math.Between(-1, 1),
            Phaser.Math.Between(-1, 1)
          ).normalize();
          monster.patrolTimer = Phaser.Math.Between(2000, 5000);
        }

        // 离家太远 → 朝家走
        const distToHome = Phaser.Math.Distance.Between(
          monster.homeX, monster.homeY,
          monster.sprite.x, monster.sprite.y
        );
        if (distToHome > 300) {
          const dir = new Phaser.Math.Vector2(
            monster.homeX - monster.sprite.x,
            monster.homeY - monster.sprite.y
          ).normalize();
          monster.direction = dir;
        }
      }

      // 障碍物碰撞反弹
      if (this.isObstacleAt(monster.sprite.x, monster.sprite.y, 0)) {
        monster.direction = new Phaser.Math.Vector2(-monster.direction.x, -monster.direction.y);
        monster.sprite.x -= monster.direction.x * 10;
        monster.sprite.y -= monster.direction.y * 10;
      }

      // 不进入安全房：如果怪物在安全房内，推出到门口外
      if (this.isInsideSafeRoom(monster.sprite.x, monster.sprite.y)) {
        // 朝最近的房间边缘推出
        const room = this.findSafeRoomAt(monster.sprite.x, monster.sprite.y);
        if (room) {
          const dx = monster.sprite.x - room.centerX;
          const dy = monster.sprite.y - room.centerY;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          monster.sprite.x = room.centerX + (dx / len) * (room.w / 2 + 20);
          monster.sprite.y = room.centerY + (dy / len) * (room.h / 2 + 20);
          monster.isChasing = false; // 进房后放弃追击
        }
      }
    }
  }

  private findSafeRoomAt(x: number, y: number): SafeRoom | null {
    for (const room of this.safeRooms) {
      if (x >= room.x && x <= room.x + room.w &&
          y >= room.y && y <= room.y + room.h) {
        return room;
      }
    }
    return null;
  }

  // ─── Pickup & combat ──────────────────────────────────────────

  private checkMaterialPickup() {
    for (const mat of this.materials) {
      if (mat.collected) continue;

      // 足球周围一定范围内即可吸收材料（无需直接碰撞）
      const dist = Phaser.Math.Distance.Between(this.ball.x, this.ball.y, mat.x, mat.y);
      const absorbRadius = this.ballRadius + this.ballAbsorbRange;

      if (dist < this.ballRadius + 16) {
        // 直接接触 → 立即吸收
        this.collectMaterial(mat);
      } else if (dist < absorbRadius) {
        // 在吸收范围内 → 磁力吸附：把材料拉向足球，靠近后吸收
        const pullSpeed = 350;
        const dx = this.ball.x - mat.x;
        const dy = this.ball.y - mat.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const moveX = (dx / len) * pullSpeed * (this.game.loop.delta / 1000);
        const moveY = (dy / len) * pullSpeed * (this.game.loop.delta / 1000);
        mat.x += moveX;
        mat.y += moveY;
        mat.sprite.x = mat.x;
        mat.sprite.y = mat.y;

        // 拉近到接触距离 → 吸收
        const newDist = Phaser.Math.Distance.Between(this.ball.x, this.ball.y, mat.x, mat.y);
        if (newDist < this.ballRadius + 16) {
          this.collectMaterial(mat);
        }
      }
    }
  }

  private collectMaterial(mat: Material) {
    if (mat.collected) return;
    mat.collected = true;
    mat.sprite.setVisible(false);
    this.tweens.killTweensOf(mat.sprite);
    this.collectedMaterials.add(mat.type);

    const info = MATERIAL_INFO[mat.type];
    const count = this.collectedMaterials.size;
    this.updateMaterialsUI();

    if (count >= 5) {
      this.showMessage(`收集到 ${info.name}！\n足球进化为完全体！\n前往终点通关！`);
    } else {
      this.showMessage(`收集到 ${info.name}！\n(${count}/5)`);
    }
    this.time.delayedCall(2000, () => this.hideMessage());
  }

  private checkMonsterCollision() {
    if (this.damageCooldown > 0) return;

    for (const monster of this.monsters) {
      if (!monster.alive) continue;

      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        monster.sprite.x, monster.sprite.y
      );

      const hitRange = monster.isBoss ? 34 : 24;
      if (dist < hitRange) {
        this.health -= monster.bossDamage;
        this.healthText.setText(`生命: ${this.health}`);
        this.damageCooldown = 1000;

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
    // 检查足球是否到达终点
    const dist = Phaser.Math.Distance.Between(
      this.ball.x, this.ball.y,
      this.exit.x, this.exit.y
    );

    if (dist < 45) {
      if (this.collectedMaterials.size >= 5) {
        this.win();
      } else {
        const remaining = 5 - this.collectedMaterials.size;
        this.showMessage(`足球未完全升级！\n还需收集 ${remaining} 种材料`);
        this.time.delayedCall(1500, () => this.hideMessage());
      }
    }
  }

  // ─── End states ───────────────────────────────────────────────

  private die() {
    this.isDead = true;
    this.player.setFillStyle(0x666666);
    this.ball.setVisible(false);
    this.showMessage('你死了！\n足球丢失...\n\n按ESC返回菜单');
  }

  private win() {
    this.isWon = true;
    this.exit.setFillStyle(0x00ff00);
    this.showMessage(`🎉 通关！\n足球成功滚到终点！\n\n按ESC返回菜单`);
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
