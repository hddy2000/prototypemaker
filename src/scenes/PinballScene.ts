import Phaser from 'phaser';

// ── 常量 ──────────────────────────────────────────────────────────────────

const GAME_W = 800;
const GAME_H = 600;

// 弹珠
const BALL_RADIUS = 12;
const BALL_BOUNCE = 0.7;
const GRAVITY = 300;

// 牙齿挡板
const FLIPPER_COOLDOWN = 2000;  // 2秒冷却
const FLIPPER_FORCE_X = 350;    // 侧向力
const FLIPPER_FORCE_Y = -250;   // 向上力
const FLIPPER_MAX_DURABILITY = 10;

// 追击的黑暗
const DARKNESS_BASE_SPEED = 40;  // 基础上升速度
const DARKNESS_FIXED_SLOW = 0.5; // 固定点时减速50%

// 固定点
const FIXED_POINT_Y = 520;      // 固定点Y坐标
const FIXED_POINT_WIDTH = 120;

// SAN值
const SAN_MAX = 100;
const SAN_DECAY_GROTESQUE = 5;   // 血肉沟壑每秒掉SAN
const SAN_DECAY_HOST = 2;        // 被主持人注视每秒掉SAN

// 机关
const BUMPER_SCORE = 100;
const GROTESQUE_SLOW_FACTOR = 0.4;  // 血肉沟壑减速

// ── 场景 ──────────────────────────────────────────────────────────────────

export class PinballScene extends Phaser.Scene {
  // 弹珠
  private ball!: Phaser.GameObjects.Arc;
  private ballBody!: Phaser.Physics.Arcade.Body;
  private isFixed = false;
  private launchPower = 0;
  private launchAngle = 0;  // -30° 到 +30°

  // 牙齿挡板
  private flipperCooldown = 0;
  private flipperDurability = FLIPPER_MAX_DURABILITY;
  private flipperCount = 3;  // 初始3颗牙

  // 追击的黑暗
  private darknessY = GAME_H + 100;
  private darknessSpeed = DARKNESS_BASE_SPEED;
  private darknessGraphics!: Phaser.GameObjects.Graphics;

  // 固定点
  private fixedPointGraphics!: Phaser.GameObjects.Graphics;

  // 机关
  private bumpers: Phaser.GameObjects.Arc[] = [];
  private nails: Phaser.GameObjects.Arc[] = [];
  private grotesques: Phaser.GameObjects.Rectangle[] = [];

  // 分数
  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;

  // SAN值
  private san = SAN_MAX;
  private sanText!: Phaser.GameObjects.Text;
  private sanOverlay!: Phaser.GameObjects.Rectangle;

  // 主持人
  private hostFace!: Phaser.GameObjects.Container;
  private hostText!: Phaser.GameObjects.Text;
  private hostTimer = 0;
  private hostMessages = [
    '你逃不掉的……',
    '把眼睛给我……',
    '这颗牙不错……',
    '你欠我的，今晚用弹珠还……',
  ];

  // 回头看
  private isLookingBack = false;
  private lookBackTimer = 0;
  private lookBackOverlay!: Phaser.GameObjects.Rectangle;

  // 状态
  private isDead = false;
  private isWon = false;

  // 输入
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private rKey!: Phaser.Input.Keyboard.Key;
  private escKey!: Phaser.Input.Keyboard.Key;

  // UI
  private messageText!: Phaser.GameObjects.Text;
  private flipperText!: Phaser.GameObjects.Text;
  private powerBar!: Phaser.GameObjects.Rectangle;
  private powerBarBg!: Phaser.GameObjects.Rectangle;

  constructor() {
    super({ key: 'PinballScene' });
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────

  create() {
    this.cameras.main.setBounds(0, 0, GAME_W, GAME_H);
    this.cameras.main.setBackgroundColor('#0a0a0f');

    // 物理世界
    this.physics.world.setBounds(0, 0, GAME_W, GAME_H);
    this.physics.world.gravity.y = GRAVITY;

    // 创建游戏对象
    this.createBall();
    this.createFixedPoint();
    this.createBumpers();
    this.createNails();
    this.createGrotesques();
    this.createHost();
    this.createDarkness();
    this.createUI();
    this.setupInput();

    // 初始消息
    this.showMessage('欢迎来到我的桌子，小赌徒……', 3000);
    this.time.delayedCall(3500, () => {
      this.showMessage('用 ← → 控制挡板，空格蓄力发射', 3000);
    });
  }

  update(_time: number, delta: number) {
    if (this.isDead || this.isWon) return;

    const dt = delta / 1000;

    // 更新挡板冷却
    if (this.flipperCooldown > 0) {
      this.flipperCooldown -= delta;
    }

    // 处理输入
    this.handleInput(delta);

    // 更新弹珠
    this.updateBall(dt);

    // 更新追击的黑暗
    this.updateDarkness(dt);

    // 更新SAN值
    this.updateSan(dt);

    // 更新主持人
    this.updateHost(delta);

    // 更新回头看
    this.updateLookBack(delta);

    // 更新UI
    this.updateUI();

    // 检查胜负
    this.checkWinLose();
  }

  // ── 创建游戏对象 ────────────────────────────────────────────────────────

  private createBall() {
    // 弹珠
    this.ball = this.add.circle(GAME_W / 2, FIXED_POINT_Y, BALL_RADIUS, 0xcccccc);
    this.ball.setStrokeStyle(2, 0xffffff);
    
    // 物理体
    this.physics.add.existing(this.ball, true);  // true = static
    this.ballBody = this.ball.body as Phaser.Physics.Arcade.Body;
    this.ballBody.setCircle(BALL_RADIUS);
    this.ballBody.setBounce(BALL_BOUNCE);
    this.ballBody.setCollideWorldBounds(true);
    this.ballBody.setMass(1);
    this.ballBody.setMaxSpeed(800);

    // 牙齿挡板视觉
    this.createFlipperVisual();
  }

  private createFlipperVisual() {
    // 左侧牙齿
    const leftTooth = this.add.rectangle(
      this.ball.x - 20, this.ball.y,
      8, 16, 0xffffcc
    );
    leftTooth.setStrokeStyle(1, 0xffffff);

    // 右侧牙齿
    const rightTooth = this.add.rectangle(
      this.ball.x + 20, this.ball.y,
      8, 16, 0xffffcc
    );
    rightTooth.setStrokeStyle(1, 0xffffff);
  }

  private createFixedPoint() {
    // 固定点（凹槽）
    this.fixedPointGraphics = this.add.graphics();
    this.fixedPointGraphics.fillStyle(0x333333, 0.5);
    this.fixedPointGraphics.fillRect(
      GAME_W / 2 - FIXED_POINT_WIDTH / 2,
      FIXED_POINT_Y - 10,
      FIXED_POINT_WIDTH,
      30
    );
    this.fixedPointGraphics.lineStyle(2, 0x666666, 1);
    this.fixedPointGraphics.strokeRect(
      GAME_W / 2 - FIXED_POINT_WIDTH / 2,
      FIXED_POINT_Y - 10,
      FIXED_POINT_WIDTH,
      30
    );

    // 固定点标签
    this.add.text(GAME_W / 2, FIXED_POINT_Y + 25, '固定点', {
      fontSize: '12px',
      color: '#666666',
    }).setOrigin(0.5);
  }

  private createBumpers() {
    // 眼球bumper（3个）
    const positions = [
      { x: 200, y: 200 },
      { x: 400, y: 150 },
      { x: 600, y: 200 },
    ];

    for (const pos of positions) {
      // 眼球主体
      const bumper = this.add.circle(pos.x, pos.y, 30, 0xffffff);
      bumper.setStrokeStyle(3, 0xff0000);

      // 瞳孔
      const pupil = this.add.circle(pos.x, pos.y, 12, 0x000000);

      // 物理体
      this.physics.add.existing(bumper, true);
      const body = bumper.body as Phaser.Physics.Arcade.Body;
      body.setCircle(30);

      // 碰撞检测
      this.physics.add.overlap(this.ball, bumper, () => {
        this.hitBumper(bumper, pupil);
      });

      this.bumpers.push(bumper);
    }
  }

  private hitBumper(bumper: Phaser.GameObjects.Arc, pupil: Phaser.GameObjects.Circle) {
    // 得分
    this.score += BUMPER_SCORE;

    // 眼球转动效果
    const angle = Phaser.Math.Angle.Between(
      bumper.x, bumper.y,
      this.ball.x, this.ball.y
    );
    pupil.x = bumper.x + Math.cos(angle) * 10;
    pupil.y = bumper.y + Math.sin(angle) * 10;

    // 弹珠获得反弹力
    const dx = this.ball.x - bumper.x;
    const dy = this.ball.y - bumper.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      const nx = dx / dist;
      const ny = dy / dist;
      this.ballBody.setVelocity(nx * 400, ny * 400);
    }

    // 闪烁效果
    bumper.setFillStyle(0xff6666);
    this.time.delayedCall(100, () => {
      bumper.setFillStyle(0xffffff);
    });

    // 显示得分
    this.showFloatingText(bumper.x, bumper.y, `+${BUMPER_SCORE}`, '#ffff00');
  }

  private createNails() {
    // 骨头钉（5x3网格）
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const x = 150 + col * 125;
        const y = 280 + row * 60;

        const nail = this.add.circle(x, y, 8, 0xaaaaaa);
        nail.setStrokeStyle(2, 0x666666);

        // 物理体
        this.physics.add.existing(nail, true);
        const body = nail.body as Phaser.Physics.Arcade.Body;
        body.setCircle(8);

        // 碰撞检测
        this.physics.add.overlap(this.ball, nail, () => {
          this.hitNail(nail);
        });

        this.nails.push(nail);
      }
    }
  }

  private hitNail(nail: Phaser.GameObjects.Arc) {
    // 普通反弹（物理引擎自动处理）
    // 添加音效/视觉效果
    nail.setFillStyle(0xcccccc);
    this.time.delayedCall(50, () => {
      nail.setFillStyle(0xaaaaaa);
    });
  }

  private createGrotesques() {
    // 血肉沟壑（2个）
    const positions = [
      { x: 100, y: 350, w: 150, h: 40 },
      { x: 550, y: 350, w: 150, h: 40 },
    ];

    for (const pos of positions) {
      const grotesque = this.add.rectangle(pos.x, pos.y, pos.w, pos.h, 0x660000);
      grotesque.setStrokeStyle(2, 0x990000);

      // 物理体
      this.physics.add.existing(grotesque, true);
      const body = grotesque.body as Phaser.Physics.Arcade.Body;

      // 重叠检测（减速+掉SAN）
      this.physics.add.overlap(this.ball, grotesque, () => {
        this.hitGrotesque();
      });

      this.grotesques.push(grotesque);
    }
  }

  private hitGrotesque() {
    // 减速
    this.ballBody.setVelocity(
      this.ballBody.velocity.x * GROTESQUE_SLOW_FACTOR,
      this.ballBody.velocity.y * GROTESQUE_SLOW_FACTOR
    );

    // 掉SAN
    this.san -= SAN_DECAY_GROTESQUE * 0.016;  // 每帧掉SAN
  }

  private createHost() {
    // 主持人的脸（远处的黑暗中）
    this.hostFace = this.add.container(GAME_W / 2, 50);

    // 脸部轮廓
    const face = this.add.rectangle(0, 0, 120, 80, 0x222222, 0.3);
    face.setStrokeStyle(2, 0x444444, 0.5);

    // 眼睛
    const leftEye = this.add.circle(-25, -10, 8, 0xff0000, 0.6);
    const rightEye = this.add.circle(25, -10, 8, 0xff0000, 0.6);

    // 嘴
    const mouth = this.add.rectangle(0, 15, 40, 8, 0x330000, 0.5);

    this.hostFace.add([face, leftEye, rightEye, mouth]);
    this.hostFace.setAlpha(0.4);

    // 主持人对话
    this.hostText = this.add.text(GAME_W / 2, 100, '', {
      fontSize: '16px',
      color: '#888888',
      align: 'center',
    }).setOrigin(0.5).setAlpha(0);
  }

  private createDarkness() {
    // 追击的黑暗
    this.darknessGraphics = this.add.graphics();
    this.darknessGraphics.setDepth(10);
  }

  private createUI() {
    // 分数
    this.scoreText = this.add.text(16, 16, '分数: 0', {
      fontSize: '20px',
      color: '#ffffff',
    }).setDepth(20);

    // SAN值
    this.sanText = this.add.text(16, 44, '理智: 100', {
      fontSize: '18px',
      color: '#44ff44',
    }).setDepth(20);

    // SAN值覆盖层（画面扭曲效果）
    this.sanOverlay = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0);
    this.sanOverlay.setDepth(15);

    // 挡板信息
    this.flipperText = this.add.text(16, 72, '牙齿: 3/3 (耐久: 10)', {
      fontSize: '16px',
      color: '#ffcc66',
    }).setDepth(20);

    // 蓄力条
    this.powerBarBg = this.add.rectangle(GAME_W / 2, GAME_H - 30, 200, 20, 0x333333);
    this.powerBarBg.setDepth(20);
    this.powerBar = this.add.rectangle(GAME_W / 2 - 100, GAME_H - 30, 0, 20, 0x00ff00);
    this.powerBar.setOrigin(0, 0.5);
    this.powerBar.setDepth(21);

    // 回头看覆盖层
    this.lookBackOverlay = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0);
    this.lookBackOverlay.setDepth(16);

    // 消息文本
    this.messageText = this.add.text(GAME_W / 2, GAME_H / 2, '', {
      fontSize: '24px',
      color: '#ffffff',
      align: 'center',
      backgroundColor: '#000000',
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setDepth(30).setVisible(false);

    // 返回菜单按钮
    const backBtn = this.add.text(GAME_W - 16, 16, '← 菜单', {
      fontSize: '18px',
      color: '#ffffff',
      backgroundColor: '#333333',
      padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setDepth(20);
    backBtn.on('pointerdown', () => this.scene.start('MenuScene'));

    // 操作提示
    this.add.text(GAME_W / 2, GAME_H - 60, '← → 控制挡板 | 空格蓄力发射 | R回头看', {
      fontSize: '14px',
      color: '#666666',
    }).setOrigin(0.5).setDepth(20);
  }

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.rKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
  }

  // ── 更新逻辑 ────────────────────────────────────────────────────────────

  private handleInput(delta: number) {
    // ESC返回菜单
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    // 回头看
    if (Phaser.Input.Keyboard.JustDown(this.rKey)) {
      this.toggleLookBack();
    }

    // 固定点状态：蓄力发射
    if (this.isFixed) {
      // 调整角度
      if (this.cursors.left?.isDown) {
        this.launchAngle = Math.max(-30, this.launchAngle - 1);
      }
      if (this.cursors.right?.isDown) {
        this.launchAngle = Math.min(30, this.launchAngle + 1);
      }

      // 蓄力
      if (this.spaceKey.isDown) {
        this.launchPower = Math.min(100, this.launchPower + delta * 0.08);
      } else if (this.launchPower > 0) {
        this.launchBall();
      }
    } else {
      // 飞行中：使用挡板
      if (Phaser.Input.Keyboard.JustDown(this.cursors.left!) && this.flipperCooldown <= 0) {
        this.activateFlipper('left');
      }
      if (Phaser.Input.Keyboard.JustDown(this.cursors.right!) && this.flipperCooldown <= 0) {
        this.activateFlipper('right');
      }
    }
  }

  private activateFlipper(side: 'left' | 'right') {
    if (this.flipperDurability <= 0) {
      this.showMessage('牙齿已耗尽……', 1500);
      return;
    }

    this.flipperCooldown = FLIPPER_COOLDOWN;
    this.flipperDurability--;

    // 给弹珠施加力
    const forceX = side === 'left' ? -FLIPPER_FORCE_X : FLIPPER_FORCE_X;
    this.ballBody.setVelocityX(forceX);
    this.ballBody.setVelocityY(FLIPPER_FORCE_Y);

    // 视觉效果
    this.ball.setFillStyle(0xffff00);
    this.time.delayedCall(100, () => {
      this.ball.setFillStyle(0xcccccc);
    });

    // 耐久度检查
    if (this.flipperDurability <= 0) {
      this.flipperCount--;
      if (this.flipperCount > 0) {
        this.flipperDurability = FLIPPER_MAX_DURABILITY;
        this.showMessage(`又一颗牙没了……还剩${this.flipperCount}颗`, 2000);
      } else {
        this.showMessage('你的牙齿全部失去了……', 2000);
      }
    }
  }

  private updateBall(dt: number) {
    if (this.isFixed) return;

    // 检查是否到达固定点
    if (this.ball.y >= FIXED_POINT_Y && this.ballBody.velocity.y > 0) {
      this.fixBall();
    }

    // 更新弹珠位置（跟随牙齿挡板视觉）
    // 这里简化处理，实际应该让牙齿跟随弹珠
  }

  private fixBall() {
    this.isFixed = true;
    this.ballBody.setVelocity(0, 0);
    this.ball.setPosition(GAME_W / 2, FIXED_POINT_Y);
    this.ballBody.setAllowGravity(false);
    this.launchPower = 0;
    this.launchAngle = 0;

    // 黑暗减速
    this.darknessSpeed = DARKNESS_BASE_SPEED * DARKNESS_FIXED_SLOW;

    this.showMessage('弹珠固定！按空格蓄力发射', 1500);
  }

  private launchBall() {
    this.isFixed = false;
    this.ballBody.setAllowGravity(true);

    // 根据蓄力和角度发射
    const power = this.launchPower * 8;
    const angleRad = Phaser.Math.DegToRad(this.launchAngle - 90);  // -90° = 正上方
    const vx = Math.cos(angleRad) * power;
    const vy = Math.sin(angleRad) * power;

    this.ballBody.setVelocity(vx, vy);

    this.launchPower = 0;
    this.launchAngle = 0;

    // 黑暗恢复正常速度
    this.darknessSpeed = DARKNESS_BASE_SPEED;
  }

  private updateDarkness(dt: number) {
    // 黑暗上升
    this.darknessY -= this.darknessSpeed * dt;

    // 绘制黑暗
    this.darknessGraphics.clear();
    this.darknessGraphics.fillStyle(0x000000, 0.95);
    this.darknessGraphics.fillRect(0, this.darknessY, GAME_W, GAME_H - this.darknessY + 100);

    // 黑暗边缘雾气效果
    for (let i = 0; i < 5; i++) {
      const y = this.darknessY + i * 10;
      const alpha = 0.3 - i * 0.05;
      this.darknessGraphics.fillStyle(0x000000, alpha);
      this.darknessGraphics.fillRect(0, y - 20, GAME_W, 20);
    }
  }

  private updateSan(dt: number) {
    // 被主持人注视时掉SAN
    if (this.hostFace.alpha > 0.3) {
      this.san -= SAN_DECAY_HOST * dt;
    }

    // SAN值限制
    this.san = Phaser.Math.Clamp(this.san, 0, SAN_MAX);

    // SAN值视觉效果
    const sanRatio = this.san / SAN_MAX;
    if (sanRatio < 0.5) {
      // 画面变暗
      this.sanOverlay.setAlpha((0.5 - sanRatio) * 0.6);
      
      // 画面扭曲（用tint模拟）
      if (sanRatio < 0.3) {
        this.cameras.main.setRoll(Phaser.Math.Between(-2, 2));
      }
    }
  }

  private updateHost(delta: number) {
    this.hostTimer += delta;

    // 主持人随机说话
    if (this.hostTimer > 8000 && Math.random() < 0.01) {
      this.hostTimer = 0;
      const msg = Phaser.Utils.Array.GetRandom(this.hostMessages);
      this.showHostMessage(msg);
    }

    // 主持人脸部若隐若现
    const targetAlpha = 0.3 + Math.sin(this.time.now * 0.001) * 0.2;
    this.hostFace.setAlpha(Phaser.Math.Linear(this.hostFace.alpha, targetAlpha, 0.02));
  }

  private showHostMessage(msg: string) {
    this.hostText.setText(msg);
    this.hostText.setAlpha(1);
    this.tweens.add({
      targets: this.hostText,
      alpha: 0,
      duration: 3000,
    });
  }

  private updateLookBack(delta: number) {
    if (this.isLookingBack) {
      this.lookBackTimer += delta;

      // 看太久触发跳杀
      if (this.lookBackTimer > 3000) {
        this.triggerJumpscare('你看到了不该看的东西……');
      }

      // 追击者加速
      this.darknessSpeed *= 1.01;

      // 画面变暗
      this.lookBackOverlay.setAlpha(0.3);
    } else {
      this.lookBackOverlay.setAlpha(0);
    }
  }

  private toggleLookBack() {
    this.isLookingBack = !this.isLookingBack;
    this.lookBackTimer = 0;

    if (this.isLookingBack) {
      // 视角向上旋转
      this.cameras.main.setRotation(Math.PI);
      this.hostFace.setAlpha(0.8);
      this.showMessage('你看到了……', 1500);
    } else {
      // 视角恢复正常
      this.cameras.main.setRotation(0);
      this.hostFace.setAlpha(0.4);
    }
  }

  private updateUI() {
    this.scoreText.setText(`分数: ${this.score}`);
    this.sanText.setText(`理智: ${Math.ceil(this.san)}`);
    this.sanText.setColor(this.san < 30 ? '#ff4444' : (this.san < 60 ? '#ffaa44' : '#44ff44'));
    this.flipperText.setText(`牙齿: ${this.flipperCount}/3 (耐久: ${this.flipperDurability})`);

    // 蓄力条
    const powerWidth = (this.launchPower / 100) * 200;
    this.powerBar.width = powerWidth;
    this.powerBar.setFillStyle(this.launchPower > 80 ? 0xff0000 : 0x00ff00);
  }

  private checkWinLose() {
    // 被黑暗追上
    if (this.ball.y > this.darknessY) {
      this.triggerJumpscare('黑暗吞没了你……');
    }

    // SAN值归零
    if (this.san <= 0) {
      this.triggerJumpscare('你的理智已经崩溃……');
    }

    // 胜利条件（临时：分数达到1000）
    if (this.score >= 1000) {
      this.win();
    }
  }

  private triggerJumpscare(cause: string) {
    if (this.isDead) return;
    this.isDead = true;

    // 跳杀效果
    this.cameras.main.shake(500, 0.05);
    this.cameras.main.flash(300, 255, 0, 0);

    // 主持人的脸突然放大
    this.tweens.add({
      targets: this.hostFace,
      scale: 5,
      alpha: 1,
      duration: 200,
    });

    // 显示死亡信息
    this.time.delayedCall(1200, () => {
      this.showMessage(`💀 ${cause}\n\n按ESC返回菜单`, 999999);
    });
  }

  private win() {
    if (this.isWon) return;
    this.isWon = true;

    this.showMessage('🎉 你暂时活下来了……\n\n但这只是开始。\n\n按ESC返回菜单', 999999);
  }

  // ── 辅助方法 ────────────────────────────────────────────────────────────

  private showMessage(text: string, duration: number = 2000) {
    this.messageText.setText(text);
    this.messageText.setVisible(true);
    this.time.delayedCall(duration, () => {
      if (duration < 999999) {
        this.messageText.setVisible(false);
      }
    });
  }

  private showFloatingText(x: number, y: number, text: string, color: string) {
    const floatingText = this.add.text(x, y, text, {
      fontSize: '20px',
      color: color,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this.tweens.add({
      targets: floatingText,
      y: y - 50,
      alpha: 0,
      duration: 1000,
      onComplete: () => floatingText.destroy(),
    });
  }
}
