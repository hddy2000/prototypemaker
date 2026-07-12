import Phaser from 'phaser';

// ── 常量 ──────────────────────────────────────────────────────────────────

const GAME_W = 800;
const GAME_H = 600;

// 弹珠
const BALL_RADIUS = 12;
const BALL_BOUNCE = 0.98;  // 高弹性，减少能量流失
const GRAVITY = 500;
const MIN_BALL_SPEED = 120;  // 最低速度，低于此值自动补能，防止卡关
const OBSTACLE_HIT_COOLDOWN = 200;  // 同一障碍物连续碰撞冷却(ms)，防止卡住时耐久度秒空

// 挡板
const FLIPPER_Y = 500;
const FLIPPER_LEFT_X = 260;
const FLIPPER_RIGHT_X = 540;
const FLIPPER_W = 120;
const FLIPPER_H = 14;
const FLIPPER_BOUNCE_PASSIVE = 300;   // 被动弹力：球碰到静止挡板时的弹力
const FLIPPER_BOUNCE_ACTIVE = 550;    // 主动弹力：挡板按下时的弹力
const FLIPPER_FLICK_BONUS = 500;      // 挥击奖励：挡板正在转动时的额外弹力
const FLIPPER_SWING_LERP = 0.45;      // 挡板旋转速度（lerp 系数，越大越快）
const FLIPPER_REST_ANGLE = 22;
const FLIPPER_ACTIVE_ANGLE = -22;
const FLIPPER_MOVE_SPEED = 250;     // 挡板上下移动速度(px/s)
const FLIPPER_MIN_Y = 350;          // 挡板最高位置
const FLIPPER_MAX_Y = 560;          // 挡板最低位置

// Boss
const BOSS_X = 400;
const BOSS_Y = 95;
const BOSS_RADIUS = 45;
const BOSS_HIT_SCORE = 200;
const BOSS_HIT_COOLDOWN = 300;

// 发射
const LAUNCH_X = 400;
const LAUNCH_Y = 470;
const LAUNCH_MAX_POWER = 100;

// 机关
const BUMPER_SCORE = 50;
const NAIL_SCORE = 10;
const BUMPER_BOUNCE = 450;
const GROTESQUE_BOUNCE_VEL = 420;  // 沟壑改为弹射而非减速

// 球
const MAX_BALLS = 10;
const MAX_BALLS_LEVEL2 = 12;  // 第二关存球量
const BALL_DURABILITY = 28;

// 第二关
const BOSS2_MAX_HP = 240;  // 6倍
const BOSS2_BULLET_SPEED = 300;
const BOSS2_BULLET_INTERVAL = 2000;  // 每2秒发射一颗子弹
const BOSS2_BULLET_RADIUS = 8;

// 第三关
// 第三关旧常量（已废弃，保留供参考）
// const BOSS3_MAX_HP = 12;
// const BOSS3_BULLET_SPEED = 320;
// const BOSS3_BULLET_INTERVAL = 1200;
// const BOSS3_BULLET_DAMAGE = 5;
// const BOSS3_BULLET_RADIUS = 8;
// const BOSS3_MOVE_SPEED = 80;
// const BOSS3_LEFT_MIN_X = 120;
// const BOSS3_LEFT_MAX_X = 380;
// const BOSS3_RIGHT_MIN_X = 420;
// const BOSS3_RIGHT_MAX_X = 680;
const MAX_BALLS_LEVEL3 = 11;           // 第三关存球量

// ── 第三关：地图即怪物 ──────────────────────────────────────────────────
// 弹珠款式
const BALL_TYPE_BASIC = 'basic';
const BALL_TYPE_FIRE = 'fire';
const BALL_TYPE_SPLIT = 'split';

const BALL_TYPES: Record<string, {
  radius: number; bounce: number; durability: number;
  damage: number; color: number; count: number;
  label: string; stroke: number;
}> = {
  basic: { radius: 12, bounce: 0.98, durability: 28, damage: 1, color: 0xeeeeee, count: 5, label: '基础', stroke: 0xffffff },
  fire:  { radius: 14, bounce: 0.95, durability: 20, damage: 2, color: 0xff6600, count: 3, label: '烈焰', stroke: 0xffaa00 },
  split: { radius: 12, bounce: 0.98, durability: 30, damage: 1, color: 0x66ccff, count: 3, label: '分裂', stroke: 0xaaddff },
};

// 器官HP
const RIB_HP = 5;
const SPINE_HP = 2;
const JOINT_HP = 4;
const FLESH_WALL_HP = 6;
const HEART_HP = 360;  // 6倍

// 状态效果
const BURN_DURATION = 3000;       // 灼烧持续3秒
const BURN_DAMAGE_PER_SEC = 1;   // 每秒1点伤害

// 心脏
const HEART_EXPOSE_THRESHOLD = 8; // 需摧毁8个器官（共11个）
const HEART_HIT_SCORE = 1000;
const HEART_HIT_COOLDOWN = 300;

// 怒吼
const RAGE_DURATION = 3000;
const RAGE_SPEED_BOOST = 1.2;

// 脊椎冲击波
const SPINE_SHOCKWAVE_INTERVAL = 5000;
const SPINE_SHOCKWAVE_FORCE = 200;
const SPINE_SHOCKWAVE_RADIUS = 120;

// 心脏子弹
const HEART_BULLET_SPEED = 300;
const HEART_BULLET_INTERVAL = 2000;
const HEART_BULLET_DAMAGE = 2;
const HEART_BULLET_RADIUS = 8;

// 器官分数
const RIB_SCORE = 100;
const SPINE_SCORE = 50;
const JOINT_SCORE = 150;
const FLESH_WALL_SCORE = 100;

// L1/L2 障碍物HP
const BUMPER_HP = 4;
const NAIL_HP = 2;
const GROTESQUE_HP = 5;
const SLINGSHOT_HP = 3;

// L1/L2 障碍物分数
const GROTESQUE_SCORE = 80;
const SLINGSHOT_SCORE = 120;

// 统一Boss HP
const BOSS_HP_L1 = 150;  // 5倍
const ORGAN_BOSS_DAMAGE = 1;    // 器官/障碍物命中扣Boss血量
const HEART_BOSS_DAMAGE = 5.5; // 心脏/顶部圆球命中扣Boss血量（5.5倍器官伤害）
const DIRECT_BOSS_DAMAGE = 4;  // 直接命中Boss扣血量（4倍器官伤害）

// 器官恢复系统
const ORGAN_REGEN_INTERVAL = 15000;  // 每15秒恢复一个被摧毁的器官

// ── 场景 ──────────────────────────────────────────────────────────────────

// ── 多球信息接口（分裂弹珠用）─────────────────────────────────────────────
interface BallInfo {
  obj: Phaser.GameObjects.Arc;
  body: Phaser.Physics.Arcade.Body;
  type: string;
  durability: number;
  maxDurability: number;
  hasBounced: boolean;  // 是否已弹射过（分裂弹珠用）
  isExtra: boolean;     // 是否为分裂产生的额外球
}

// ── 器官接口 ──────────────────────────────────────────────────────────────
interface Organ {
  obj: Phaser.GameObjects.GameObject;       // 主游戏对象
  body: Phaser.Physics.Arcade.Body | null;  // 物理体（joint为null）
  type: 'rib' | 'spine' | 'joint' | 'fleshWall' | 'bumper' | 'nail' | 'grotesque' | 'slingshot';
  hp: number;
  maxHp: number;
  burnTimer: number;     // 灼烧剩余ms
  destroyed: boolean;
  darkened: boolean;     // 被摧毁后变暗但仍可反弹
  hpBar: Phaser.GameObjects.Rectangle;
  hpBarBg: Phaser.GameObjects.Rectangle;
  statusText: Phaser.GameObjects.Text;
  score: number;
  // 旋转挡板专用
  container?: Phaser.GameObjects.Container;
  orgX?: number;
  orgY?: number;
  // 肋骨专用
  pupil?: Phaser.GameObjects.Arc;
  // 脊椎冲击波计时器
  shockwaveTimer?: number;
}

export class PinballScene extends Phaser.Scene {
  // 关卡
  private level = 1;
  private showingLevelSelect = true;  // 选关界面标志
  private selectedLevel = 0;  // 选关界面当前选中项（0=第一关, 1=第二关, 2=第三关）
  private levelSelectTexts: Phaser.GameObjects.Text[] = [];
  private levelSelectBg!: Phaser.GameObjects.Rectangle;

  // 弹珠
  private ball!: Phaser.GameObjects.Arc;
  private ballBody!: Phaser.Physics.Arcade.Body;
  private ballsLeft = MAX_BALLS;
  private ballDurability = BALL_DURABILITY;
  private isLaunching = true;
  private launchPower = 0;

  // 多球系统（分裂弹珠用）
  private extraBalls: BallInfo[] = [];

  // 挡板
  private leftFlipper!: Phaser.GameObjects.Rectangle;
  private rightFlipper!: Phaser.GameObjects.Rectangle;
  private leftFlipperActive = false;
  private rightFlipperActive = false;
  private leftFlipperY = FLIPPER_Y;   // 左挡板当前 Y 位置（可上下移动）
  private rightFlipperY = FLIPPER_Y; // 右挡板当前 Y 位置（可上下移动）
  private wKey!: Phaser.Input.Keyboard.Key;
  private sKey!: Phaser.Input.Keyboard.Key;
  private upKey!: Phaser.Input.Keyboard.Key;
  private downKey!: Phaser.Input.Keyboard.Key;

  // Boss
  private boss!: Phaser.GameObjects.Arc;
  private bossHp = 10;
  private bossMaxHp = 10;
  private bossHpBar!: Phaser.GameObjects.Rectangle;
  private bossEyeLeft!: Phaser.GameObjects.Arc;
  private bossEyeRight!: Phaser.GameObjects.Arc;
  private bossHitCooldown = 0;

  // 第二关：Boss 子弹
  private bullets: Phaser.GameObjects.Arc[] = [];
  private bulletTimer = 0;

  // Boss 视觉元素
  private bossMouth!: Phaser.GameObjects.Rectangle;
  private bossHpBarBg!: Phaser.GameObjects.Rectangle;
  private bossNameText!: Phaser.GameObjects.Text;

  // ── 第三关：地图即怪物 ──
  // 弹珠款式系统
  private ballType: string = BALL_TYPE_BASIC;
  private ballTypeCounts: Record<string, number> = {};
  private key1!: Phaser.Input.Keyboard.Key;
  private key2!: Phaser.Input.Keyboard.Key;
  private key3!: Phaser.Input.Keyboard.Key;
  private ballTypeIcons: { text: Phaser.GameObjects.Text; bg: Phaser.GameObjects.Rectangle }[] = [];

  // 器官系统
  private organs: Organ[] = [];
  private destroyedOrganCount = 0;
  private totalOrganCount = 0;

  // 心脏（复用 boss 作为心脏）
  private heartExposed = false;
  private heartHp = HEART_HP;
  private heartMaxHp = HEART_HP;
  private heartHitCooldown = 0;
  private heartBulletTimer = 0;
  private heartProtectShield!: Phaser.GameObjects.Arc;  // 保护罩
  private heartBeatTimer = 0;

  // 怪物总HP条
  private monsterHpBar!: Phaser.GameObjects.Rectangle;
  private monsterHpBarBg!: Phaser.GameObjects.Rectangle;
  private monsterHpText!: Phaser.GameObjects.Text;

  // 怒吼系统
  private rageTimer = 0;

  // 器官恢复计时器
  private organRegenTimer = 0;

  // 心跳脉动
  private heartbeatTimer = 0;
  private bgRect!: Phaser.GameObjects.Rectangle;

  // 消息定时器（修复：取消上一个消息定时器，防止通关消息被旧定时器隐藏）
  private messageTimer?: Phaser.Time.TimerEvent;

  // 发射就绪标志（修复：场景重启后需先松开空格才能蓄力，防止自动发射）
  private launchReady = false;

  // 机关
  private bumpers: { obj: Phaser.GameObjects.Arc; pupil: Phaser.GameObjects.Arc }[] = [];
  private nails: Phaser.GameObjects.Arc[] = [];
  private grotesques: Phaser.GameObjects.Rectangle[] = [];
  private slingshots: Phaser.GameObjects.Triangle[] = [];
  // 第二关旋转挡板（手动碰撞检测，物理体不旋转）
  private spinners: { container: Phaser.GameObjects.Container; bar: Phaser.GameObjects.Rectangle; x: number; y: number }[] = [];

  // 分数
  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private ballsText!: Phaser.GameObjects.Text;

  // 状态
  private isDead = false;
  private isWon = false;
  private levelClear = false;  // 当前关卡是否通关

  // 输入
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private escKey!: Phaser.Input.Keyboard.Key;
  private enterKey!: Phaser.Input.Keyboard.Key;

  // UI
  private messageText!: Phaser.GameObjects.Text;
  private powerBar!: Phaser.GameObjects.Rectangle;
  private powerBarBg!: Phaser.GameObjects.Rectangle;
  private durabilityText!: Phaser.GameObjects.Text;

  // ── 音效系统 ──
  private bgm!: Phaser.Sound.BaseSound;
  private audioLoaded = false;

  constructor() {
    super({ key: 'PinballScene' });
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────

  preload() {
    // 加载音效资源
    this.load.audio('bgm', 'assets/audio/弹珠bgm.mp3');
    this.load.audio('crash', 'assets/audio/爆裂撞击.mp3');     // 爆裂撞击
    this.load.audio('metal', 'assets/audio/金属脆响.mp3');      // 金属脆响
    this.load.audio('electric', 'assets/audio/电子碰撞.mp3');   // 电子碰撞
    this.load.audio('muffled', 'assets/audio/闷响撞击.mp3');    // 闷响撞击（已破坏部位）
    this.load.audio('whisper', 'assets/audio/古神低语.mp3');    // 古神低语
    this.load.audio('bleed', 'assets/audio/爆血.mp3');         // 爆血
    this.load.audio('victory', 'assets/audio/胜利.mp3');       // 胜利
  }

  create() {
    // 场景关闭时停止BGM
    this.events.once('shutdown', () => {
      if (this.bgm && this.bgm.isPlaying) this.bgm.stop();
    });

    if (this.showingLevelSelect) {
      // 显示选关界面
      this.showLevelSelect();
    } else {
      // 直接初始化游戏（通关后进入下一关）
      this.initGame();
    }
  }

  // ── 音效系统 ────────────────────────────────────────────────────────────

  private initAudio() {
    if (!this.audioLoaded) {
      // 第一次进入游戏时，等待音频解码完成
      this.audioLoaded = true;
    }

    // 播放BGM（循环，音量适中）
    if (this.bgm && this.bgm.isPlaying) {
      this.bgm.stop();
    }
    this.bgm = this.sound.add('bgm', { loop: true, volume: 0.3 });
    this.bgm.play();

    // 关卡开始时播放古神低语
    this.sound.play('whisper', { volume: 0.6 });
  }

  // 播放碰撞音效（非心脏部位）
  private playCollisionSound(organ: Organ | null) {
    if (organ && (organ.destroyed || organ.darkened)) {
      // 撞在已破坏/变暗的部位：闷响撞击
      this.sound.play('muffled', { volume: 0.5 });
      return;
    }
    // 正常部位：爆裂撞击 + 金属脆响，有时触发电子碰撞
    this.sound.play('crash', { volume: 0.4 });
    this.sound.play('metal', { volume: 0.3 });
    // 30%概率触发电子碰撞
    if (Math.random() < 0.3) {
      this.time.delayedCall(50, () => {
        this.sound.play('electric', { volume: 0.35 });
      });
    }
  }

  // 播放心脏命中音效
  private playHeartHitSound() {
    // 爆裂撞击 + 爆血
    this.sound.play('crash', { volume: 0.6 });
    this.sound.play('bleed', { volume: 0.5 });
    // 30%概率触发古神低语（怪物吃痛的怒吼）
    if (Math.random() < 0.3) {
      this.time.delayedCall(100, () => {
        this.sound.play('whisper', { volume: 0.7 });
      });
    }
  }

  // 播放Boss/眼球命中音效（L1/L2的Boss直接命中）
  private playBossHitSound() {
    this.sound.play('crash', { volume: 0.5 });
    // 30%概率触发古神低语
    if (Math.random() < 0.3) {
      this.time.delayedCall(100, () => {
        this.sound.play('whisper', { volume: 0.6 });
      });
    }
  }

  // ── 选关界面 ────────────────────────────────────────────────────────────
  private showLevelSelect() {
    this.cameras.main.setBackgroundColor('#0a0a0f');

    // 半透明背景
    this.levelSelectBg = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x0a0a0f);
    this.levelSelectBg.setDepth(200);

    // 标题
    this.add.text(GAME_W / 2, 100, '🎰 弹珠赌局', {
      fontSize: '48px', color: '#ffaa44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(201);

    this.add.text(GAME_W / 2, 145, '选择关卡', {
      fontSize: '24px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(201);

    // 关卡选项
    const levels = [
      { name: '第一关：赌场老板', desc: '基础弹珠 × 10  •  Boss HP 150', color: '#44ff44' },
      { name: '第二关：暴怒老板', desc: '基础 × 8 + 烈焰 × 4  •  Boss HP 240', color: '#ff8844' },
      { name: '第三关：地图即怪物', desc: '基础 × 5 + 烈焰 × 3 + 分裂 × 3  •  Boss HP 360', color: '#ff4444' },
    ];

    this.levelSelectTexts = [];
    levels.forEach((lv, i) => {
      const y = 230 + i * 100;
      const nameText = this.add.text(GAME_W / 2, y, lv.name, {
        fontSize: '28px', color: lv.color, fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(201);

      this.add.text(GAME_W / 2, y + 30, lv.desc, {
        fontSize: '14px', color: '#888888',
      }).setOrigin(0.5).setDepth(201);

      // 可点击
      const hitArea = this.add.rectangle(GAME_W / 2, y + 15, 600, 80, 0xffffff, 0)
        .setInteractive({ useHandCursor: true })
        .setDepth(200);
      hitArea.on('pointerdown', () => {
        this.selectedLevel = i;
        this.updateLevelSelect();
        this.startLevel(i + 1);
      });
      hitArea.on('pointerover', () => {
        this.selectedLevel = i;
        this.updateLevelSelect();
      });

      this.levelSelectTexts.push(nameText);
    });

    // 提示
    this.add.text(GAME_W / 2, 540, '↑↓ 选择  •  Enter 确认  •  ESC 返回菜单', {
      fontSize: '16px', color: '#666666',
    }).setOrigin(0.5).setDepth(201);

    // 键盘输入 - 使用全局keydown事件确保在选关界面期间也能响应
    this.input.keyboard!.on('keydown-UP', () => {
      this.selectedLevel = Phaser.Math.Wrap(this.selectedLevel - 1, 0, 3);
      this.updateLevelSelect();
    });
    this.input.keyboard!.on('keydown-DOWN', () => {
      this.selectedLevel = Phaser.Math.Wrap(this.selectedLevel + 1, 0, 3);
      this.updateLevelSelect();
    });
    this.input.keyboard!.on('keydown-ENTER', () => {
      this.startLevel(this.selectedLevel + 1);
    });
    this.input.keyboard!.on('keydown-ESC', () => {
      this.scene.start('MenuScene');
    });

    this.updateLevelSelect();
  }

  private updateLevelSelect() {
    this.levelSelectTexts.forEach((text, i) => {
      if (i === this.selectedLevel) {
        text.setScale(1.15);
        text.setAlpha(1);
      } else {
        text.setScale(1);
        text.setAlpha(0.6);
      }
    });
  }

  // ── 开始指定关卡 ────────────────────────────────────────────────────────
  private startLevel(lv: number) {
    this.showingLevelSelect = false;
    this.level = lv;
    // restart会重新调用create()，此时showingLevelSelect=false则直接initGame()
    this.scene.restart();
  }

  // ── 实际游戏初始化 ──────────────────────────────────────────────────────
  private initGame() {
    this.resetState();
    this.cameras.main.setBackgroundColor('#0a0a0f');
    this.physics.world.setBounds(0, 0, GAME_W, GAME_H);
    this.physics.world.gravity.y = GRAVITY;

    // ── 音效系统初始化 ──
    this.initAudio();

    // 第三关：背景心跳脉动层
    if (this.level === 3) {
      this.bgRect = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x110011);
      this.bgRect.setDepth(-1);
    }

    this.createBall();
    this.createFlippers();

    if (this.level === 3) {
      // 第三关：地图即怪物
      this.createMonsterBody();
    } else {
      this.createBoss();
      this.createObstacles();
      this.totalOrganCount = this.organs.length;
    }

    // L2/L3：应用弹珠款式属性
    if (this.level >= 2) {
      this.ballType = this.selectDefaultBallType();
      this.applyBallTypeProperties();
    }

    this.createUI();
    this.setupInput();

    if (this.level === 1) {
      this.showMessage('← → 弹起挡板 | 空格蓄力发射\nW/S 左挡板上/下移动 | ↑/↓ 右挡板上/下移动\n击败Boss即可逃脱', 3500);
    } else if (this.level === 2) {
      this.showMessage('第二关：Boss会发射子弹！\n按 1/2 切换弹珠款式\n小心躲避', 3500);
    } else {
      this.showMessage('第三关：地图即怪物！\n摧毁器官→暴露心脏→击碎心脏\n按 1/2/3 切换弹珠款式', 4500);
    }
  }

  private resetState() {
    this.score = 0;
    this.ballsLeft = this.level === 1 ? MAX_BALLS : (this.level === 2 ? MAX_BALLS_LEVEL2 : MAX_BALLS_LEVEL3);
    this.isDead = false;
    this.isWon = false;
    this.levelClear = false;
    this.isLaunching = true;
    this.launchPower = 0;
    this.launchReady = false;  // 必须先松开空格才能蓄力
    this.ballDurability = BALL_DURABILITY;
    this.leftFlipperActive = false;
    this.rightFlipperActive = false;
    this.leftFlipperY = FLIPPER_Y;
    this.rightFlipperY = FLIPPER_Y;
    this.bossHitCooldown = 0;
    this.bulletTimer = 0;
    this.lowSpeedFrames = 0;
    this.stallFrames = 0;
    this.stallCheckX = 0;
    this.stallCheckY = 0;
    this.bumpers = [];
    this.nails = [];
    this.grotesques = [];
    this.slingshots = [];
    this.spinners = [];
    this.bullets = [];
    this.extraBalls = [];
    this.organRegenTimer = 0;

    // 弹珠款式系统重置（L2/L3都用）
    this.ballType = BALL_TYPE_BASIC;
    this.ballTypeCounts = {};
    this.ballTypeIcons = [];
    this.organs = [];
    this.destroyedOrganCount = 0;
    this.totalOrganCount = 0;
    this.heartExposed = false;
    this.heartHp = HEART_HP;
    this.heartMaxHp = HEART_HP;
    this.heartHitCooldown = 0;
    this.heartBulletTimer = 0;
    this.rageTimer = 0;
    this.heartbeatTimer = 0;
    this.heartBeatTimer = 0;

    if (this.level === 1) {
      this.bossHp = BOSS_HP_L1;
      this.bossMaxHp = BOSS_HP_L1;
      // L1只有基础弹珠
      this.ballTypeCounts = { [BALL_TYPE_BASIC]: MAX_BALLS };
    } else if (this.level === 2) {
      this.bossHp = BOSS2_MAX_HP;
      this.bossMaxHp = BOSS2_MAX_HP;
      // L2：8基础+4火弹珠
      this.ballTypeCounts = { [BALL_TYPE_BASIC]: 8, [BALL_TYPE_FIRE]: 4 };
    } else {
      // 第三关：心脏作为最终Boss，初始不可攻击
      this.bossHp = HEART_HP;
      this.bossMaxHp = HEART_HP;
      // 初始化弹珠库存
      for (const key of Object.keys(BALL_TYPES)) {
        this.ballTypeCounts[key] = BALL_TYPES[key].count;
      }
    }
  }

  update(_time: number, delta: number) {
    // 选关界面期间不执行游戏更新
    if (this.showingLevelSelect) return;

    if (this.isDead) return;

    // 通关后等待 Enter
    if (this.levelClear) {
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        if (this.level === 1) {
          this.level = 2;
          this.showingLevelSelect = false;  // 跳过选关界面，直接进入下一关
          this.scene.restart();
        } else if (this.level === 2) {
          this.level = 3;
          this.showingLevelSelect = false;  // 跳过选关界面，直接进入下一关
          this.scene.restart();
        } else {
          this.win();
        }
      }
      return;
    }

    if (this.isWon) return;

    if (this.bossHitCooldown > 0) {
      this.bossHitCooldown -= delta;
    }
    if (this.heartHitCooldown > 0) {
      this.heartHitCooldown -= delta;
    }

    this.handleInput(delta);
    this.updateFlippers();
    this.checkBallLost();
    this.preventStall();  // 防止球失去动能卡关
    this.updateExtraBalls(delta);  // 更新分裂球

    if (this.level === 3) {
      // 第三关：地图即怪物
      this.updateOrganStates(delta);
      this.updateJoints(delta);
      this.updateSpineShockwaves(delta);
      this.updateHeart(delta);
      this.updateHeartbeat(delta);
      this.updateRage(delta);
      this.updateOrganRegen(delta);
      this.updateMonsterHpBar();
    } else {
      this.updateBosses(delta);  // 旧Boss移动逻辑（已废弃，仅保留方法）
      this.updateSpinners(delta);
      this.updateObstacleOrgans(delta);  // L1/L2障碍物器官更新
      this.updateOrganRegen(delta);  // 器官恢复
      this.updateMonsterHpBar();  // L1/L2也更新统一HP条
    }

    this.updateBullets(delta);
    this.updateUI();
  }

  // ── 防卡关：球速度极低且持续多帧时才补能 ────────────────────────────────

  private lowSpeedFrames = 0;  // 球低速持续的帧数
  private stallCheckX = 0;  // 防卡关：记录上次检查时球的x位置
  private stallCheckY = 0;  // 防卡关：记录上次检查时球的y位置
  private stallFrames = 0;  // 球在小范围内停留的帧数

  private preventStall() {
    if (this.isLaunching) return;
    const vx = this.ballBody.velocity.x;
    const vy = this.ballBody.velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);

    // 检测1：球速度极低
    if (speed < MIN_BALL_SPEED) {
      this.lowSpeedFrames++;
      // 只有连续 60 帧（约1秒）低速才补能，避免每帧干预导致诡异匀速
      if (this.lowSpeedFrames > 60) {
        // 给球一个随机方向的向上推力，模拟自然弹跳
        const angle = Phaser.Math.FloatBetween(-Math.PI * 0.75, -Math.PI * 0.25);
        const boost = 350;
        this.ballBody.setVelocity(
          Math.cos(angle) * boost,
          Math.sin(angle) * boost
        );
        this.lowSpeedFrames = 0;
        this.stallFrames = 0;
      }
    } else {
      this.lowSpeedFrames = 0;
    }

    // 检测2：球在小范围内停留太久（即使速度不低，如在bumper上反复弹跳）
    const moveDist = Math.sqrt(
      (this.ball.x - this.stallCheckX) ** 2 + (this.ball.y - this.stallCheckY) ** 2
    );
    if (moveDist < 60) {
      this.stallFrames++;
    } else {
      this.stallFrames = 0;
      this.stallCheckX = this.ball.x;
      this.stallCheckY = this.ball.y;
    }

    // 连续180帧（约3秒）在小范围内停留 → 强制弹开
    if (this.stallFrames > 180) {
      const angle = Phaser.Math.FloatBetween(-Math.PI * 0.75, -Math.PI * 0.25);
      const boost = 400;
      this.ballBody.setVelocity(
        Math.cos(angle) * boost,
        Math.sin(angle) * boost
      );
      this.stallFrames = 0;
      this.stallCheckX = this.ball.x;
      this.stallCheckY = this.ball.y;
    }
  }

  // ── 第三关：双Boss水平巡逻移动（旧逻辑，仅L1/L2不触发）─────────────────
  private updateBosses(delta: number) {
    if (this.level !== 3) return;
    // 第三关已改为地图即怪物，不再有巡逻Boss
    // 此方法保留但不再被调用（update中L3走新逻辑）
    void delta;
  }

  // ── 创建游戏对象 ────────────────────────────────────────────────────────

  private createBall() {
    this.ball = this.add.circle(LAUNCH_X, LAUNCH_Y, BALL_RADIUS, 0xeeeeee);
    this.ball.setStrokeStyle(2, 0xffffff);
    this.ball.setDepth(5);

    this.physics.add.existing(this.ball, false);
    this.ballBody = this.ball.body as Phaser.Physics.Arcade.Body;
    this.ballBody.setCircle(BALL_RADIUS);
    this.ballBody.setBounce(BALL_BOUNCE);
    this.ballBody.setCollideWorldBounds(true);
    this.ballBody.checkCollision.down = false;  // 底部不碰撞，让球可以掉下去
    this.ballBody.setAllowGravity(false);
  }

  private createFlippers() {
    // 左挡板（纯视觉，碰撞在 checkFlipperCollision 中手动处理）
    this.leftFlipper = this.add.rectangle(
      FLIPPER_LEFT_X, FLIPPER_Y, FLIPPER_W, FLIPPER_H, 0xddcc88
    );
    this.leftFlipper.setOrigin(0, 0.5);
    this.leftFlipper.setAngle(FLIPPER_REST_ANGLE);
    this.leftFlipper.setStrokeStyle(2, 0x998844);
    this.leftFlipper.setDepth(10);  // 在障碍物(depth=0)之上，对球生效

    // 右挡板
    this.rightFlipper = this.add.rectangle(
      FLIPPER_RIGHT_X, FLIPPER_Y, FLIPPER_W, FLIPPER_H, 0xddcc88
    );
    this.rightFlipper.setOrigin(1, 0.5);
    this.rightFlipper.setAngle(-FLIPPER_REST_ANGLE);
    this.rightFlipper.setStrokeStyle(2, 0x998844);
    this.rightFlipper.setDepth(10);  // 在障碍物(depth=0)之上，对球生效
  }

  private createBoss() {
    if (this.level === 3) {
      // 第三关不再创建旧Boss，由 createMonsterBody() 处理
      return;
    }

    // Boss 主体
    const bossColor = this.level === 1 ? 0x440011 : 0x110044;
    this.boss = this.add.circle(BOSS_X, BOSS_Y, BOSS_RADIUS, bossColor);
    this.boss.setStrokeStyle(3, this.level === 1 ? 0x880033 : 0x330088);
    this.boss.setDepth(4);

    // 眼睛
    this.bossEyeLeft = this.add.circle(BOSS_X - 18, BOSS_Y - 8, 10, 0xff0000);
    this.bossEyeRight = this.add.circle(BOSS_X + 18, BOSS_Y - 8, 10, 0xff0000);

    // 嘴
    this.bossMouth = this.add.rectangle(BOSS_X, BOSS_Y + 18, 30, 6, 0x330000);

    // HP 条背景（Boss上方小条，与顶部统一HP条重复，隐藏）
    this.bossHpBarBg = this.add.rectangle(BOSS_X, BOSS_Y - 65, 104, 10, 0x333333);
    this.bossHpBarBg.setStrokeStyle(1, 0x666666);
    this.bossHpBarBg.setVisible(false);

    // HP 条
    this.bossHpBar = this.add.rectangle(
      BOSS_X - 50, BOSS_Y - 65, 100, 8, 0xff3333
    );
    this.bossHpBar.setOrigin(0, 0.5);
    this.bossHpBar.setVisible(false);

    // Boss 标签（隐藏，统一HP条已有标签）
    const bossName = this.level === 1 ? '赌场老板' : '赌场老板·暴怒';
    this.bossNameText = this.add.text(BOSS_X, BOSS_Y - 80, bossName, {
      fontSize: '14px',
      color: this.level === 1 ? '#ff6666' : '#aa66ff',
    }).setOrigin(0.5);
    this.bossNameText.setVisible(false);

    // Boss 物理体
    this.physics.add.existing(this.boss, true);
    this.physics.add.overlap(this.ball, this.boss, () => {
      this.hitBoss();
    });
  }

  private hitBoss() {
    if (this.level === 3) return;  // 第三关不走旧Boss逻辑
    if (this.bossHitCooldown > 0) return;
    this.bossHitCooldown = BOSS_HIT_COOLDOWN;
    this.damageBall(1);

    // ── 音效：Boss/眼球命中 ──
    this.playBossHitSound();

    // 分裂弹珠：第一次弹射时分裂
    this.trySplitBall(this.ball, this.ballBody, this.ballType, false);

    // 直接命中Boss扣更多血
    this.bossHp -= DIRECT_BOSS_DAMAGE;
    this.score += BOSS_HIT_SCORE;

    // 反弹球
    const dx = this.ball.x - BOSS_X;
    const dy = this.ball.y - BOSS_Y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      this.ballBody.setVelocity((dx / dist) * 450, (dy / dist) * 450);
    }

    // 闪烁
    this.boss.setFillStyle(0xff6666);
    this.bossEyeLeft.setFillStyle(0xffffff);
    this.bossEyeRight.setFillStyle(0xffffff);
    this.time.delayedCall(150, () => {
      this.boss.setFillStyle(this.level === 1 ? 0x440011 : 0x110044);
      this.bossEyeLeft.setFillStyle(0xff0000);
      this.bossEyeRight.setFillStyle(0xff0000);
    });

    // 更新 Boss 自身HP条（小条，在Boss上方）
    this.bossHpBar.width = Math.max(0, (this.bossHp / this.bossMaxHp) * 100);

    this.showFloatingText(BOSS_X, BOSS_Y, `-${DIRECT_BOSS_DAMAGE}`, '#ff4444');

    if (this.bossHp <= 0) {
      this.clearLevel();
    }
  }

  // ── 第三关：创建怪物身体（地图即怪物）──────────────────────────────────
  private createMonsterBody() {
    // ── 心脏（复用 boss 作为心脏，位于顶部）──
    this.createHeart();

    // ── 脊椎骨（3节，中路纵列）──
    this.createSpine(400, 170);
    this.createSpine(400, 220);
    this.createSpine(400, 270);

    // ── 肋骨（4根，两侧）──
    this.createRib(150, 330);
    this.createRib(150, 380);
    this.createRib(650, 330);
    this.createRib(650, 380);

    // ── 关节（2个，旋转挡板）──
    this.createJoint(250, 300);
    this.createJoint(550, 300);

    // ── 血肉壁（2块，底部两侧）──
    this.createFleshWall(60, 470, 80, 20);
    this.createFleshWall(740, 470, 80, 20);

    this.totalOrganCount = this.organs.length;
  }

  // ── 第三关：创建心脏（复用 boss）────────────────────────────────────────
  private createHeart() {
    // 心脏位于顶部，复用 boss 对象
    this.boss = this.add.circle(BOSS_X, BOSS_Y, BOSS_RADIUS, 0x440011);
    this.boss.setStrokeStyle(3, 0x880033);
    this.boss.setDepth(4);

    // 眼睛（心脏的"眼睛"，暴露后用于子弹发射闪烁）
    this.bossEyeLeft = this.add.circle(BOSS_X - 18, BOSS_Y - 8, 10, 0xff0000);
    this.bossEyeRight = this.add.circle(BOSS_X + 18, BOSS_Y - 8, 10, 0xff0000);

    // 嘴
    this.bossMouth = this.add.rectangle(BOSS_X, BOSS_Y + 18, 30, 6, 0x330000);

    // HP 条背景
    this.bossHpBarBg = this.add.rectangle(BOSS_X, BOSS_Y - 65, 104, 10, 0x333333);
    this.bossHpBarBg.setStrokeStyle(1, 0x666666);

    // HP 条
    this.bossHpBar = this.add.rectangle(BOSS_X - 50, BOSS_Y - 65, 100, 8, 0xff3333);
    this.bossHpBar.setOrigin(0, 0.5);

    // 标签
    this.bossNameText = this.add.text(BOSS_X, BOSS_Y - 80, '心脏（保护中）', {
      fontSize: '14px', color: '#ff6666',
    }).setOrigin(0.5);

    // 保护罩（半透明圆环）
    this.heartProtectShield = this.add.circle(BOSS_X, BOSS_Y, BOSS_RADIUS + 8, 0x666666, 0.3);
    this.heartProtectShield.setStrokeStyle(3, 0xaaaaaa);
    this.heartProtectShield.setDepth(3);

    // 心脏物理体（初始不可攻击，overlap 仅在暴露后生效）
    this.physics.add.existing(this.boss, true);
    this.physics.add.overlap(this.ball, this.boss, () => {
      this.hitHeart();
    });

    // 初始隐藏HP条（未暴露时）
    this.bossHpBar.setVisible(false);
    this.bossHpBarBg.setVisible(false);
  }

  // ── 第三关：心脏受击 ─────────────────────────────────────────────────────
  private hitHeart() {
    if (!this.heartExposed) return;  // 未暴露时不可攻击
    if (this.heartHitCooldown > 0) return;
    this.heartHitCooldown = HEART_HIT_COOLDOWN;

    // ── 音效：心脏命中（爆裂撞击 + 爆血 + 30%古神低语）──
    this.playHeartHitSound();

    // 分裂弹珠：第一次弹射时分裂
    this.trySplitBall(this.ball, this.ballBody, this.ballType, false);

    // 心脏命中扣更多Boss血
    this.heartHp -= HEART_BOSS_DAMAGE;
    this.bossHp -= HEART_BOSS_DAMAGE;
    this.score += HEART_HIT_SCORE;
    this.damageBall(1);

    // 反弹球
    const dx = this.ball.x - BOSS_X;
    const dy = this.ball.y - BOSS_Y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      this.ballBody.setVelocity((dx / dist) * 450, (dy / dist) * 450);
    }

    // 闪烁
    this.boss.setFillStyle(0xff6666);
    this.bossEyeLeft.setFillStyle(0xffffff);
    this.bossEyeRight.setFillStyle(0xffffff);
    this.time.delayedCall(150, () => {
      this.boss.setFillStyle(0x440011);
      this.bossEyeLeft.setFillStyle(0xff0000);
      this.bossEyeRight.setFillStyle(0xff0000);
    });

    // 更新 HP 条
    this.bossHpBar.width = Math.max(0, (this.heartHp / this.heartMaxHp) * 100);

    this.showFloatingText(BOSS_X, BOSS_Y, `-${HEART_BOSS_DAMAGE}`, '#ff4444');

    if (this.heartHp <= 0) {
      this.boss.setVisible(false);
      this.bossEyeLeft.setVisible(false);
      this.bossEyeRight.setVisible(false);
      this.bossMouth.setVisible(false);
      this.bossHpBar.setVisible(false);
      this.bossHpBarBg.setVisible(false);
      this.bossNameText.setVisible(false);
      this.heartProtectShield.setVisible(false);
      this.clearLevel();
    }
  }

  // ── 第三关：心脏暴露 ─────────────────────────────────────────────────────
  private exposeHeart() {
    if (this.heartExposed) return;
    this.heartExposed = true;

    // 保护罩碎裂动画
    this.heartProtectShield.setFillStyle(0xffffff, 0.6);
    this.tweens.add({
      targets: this.heartProtectShield,
      alpha: 0,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 500,
      onComplete: () => this.heartProtectShield.setVisible(false),
    });

    // 心脏开始脉动
    this.tweens.add({
      targets: this.boss,
      scaleX: 1.1,
      scaleY: 1.1,
      duration: 400,
      yoyo: true,
      repeat: -1,
    });

    // 显示HP条
    this.bossHpBar.setVisible(true);
    this.bossHpBarBg.setVisible(true);
    this.bossNameText.setText('心脏');
    this.bossNameText.setColor('#ff3333');

    this.showMessage('心脏暴露了！', 2000);
    this.cameras.main.shake(500, 0.03);
  }

  // ── 第三关：心脏更新（脉动+子弹）─────────────────────────────────────────
  private updateHeart(delta: number) {
    // 心跳脉动计时
    this.heartBeatTimer += delta;
  }

  // ── 第三关：创建肋骨 ─────────────────────────────────────────────────────
  private createRib(x: number, y: number) {
    const rib = this.add.circle(x, y, 28, 0xffffff);
    rib.setStrokeStyle(3, 0xff0000);
    const pupil = this.add.circle(x, y, 11, 0x000000);

    const hpBarBg = this.add.rectangle(x, y - 40, 44, 6, 0x333333);
    const hpBar = this.add.rectangle(x - 20, y - 40, 40, 4, 0xff3333);
    hpBar.setOrigin(0, 0.5);
    const statusText = this.add.text(x, y - 52, '', {
      fontSize: '10px', color: '#ffaa00',
    }).setOrigin(0.5).setDepth(15);

    this.physics.add.existing(rib, true);
    const collider = this.physics.add.collider(this.ball, rib, () => {
      if (!this.canHitOrgan(rib)) return;
      this.hitRib(rib, pupil);
    });

    const organ: Organ = {
      obj: rib, body: rib.body as Phaser.Physics.Arcade.Body,
      type: 'rib', hp: RIB_HP, maxHp: RIB_HP,
      burnTimer: 0, destroyed: false, darkened: false,
      hpBar, hpBarBg, statusText, score: RIB_SCORE, pupil,
    };
    this.organs.push(organ);
    // 保存collider引用到obj上，摧毁时用
    rib.setData('collider', collider);
    rib.setData('organRef', organ);
  }

  private hitRib(rib: Phaser.GameObjects.Arc, pupil: Phaser.GameObjects.Arc) {
    const organ = rib.getData('organRef') as Organ;
    // ── 音效 ──
    this.playCollisionSound(organ);
    if (!organ || organ.destroyed) return;

    // 弹射球（无论是否变暗都反弹）
    const dx = this.ball.x - rib.x;
    const dy = this.ball.y - rib.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      let vx = (dx / dist) * BUMPER_BOUNCE;
      let vy = (dy / dist) * BUMPER_BOUNCE;
      // 防止球在rib正上方永久垂直弹跳
      if (Math.abs(vx) < 80) {
        vx = (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 80);
      }
      this.ballBody.setVelocity(vx, vy);
    }

    // 分裂弹珠：第一次弹射时分裂
    this.trySplitBall(this.ball, this.ballBody, this.ballType, false);

    // 变暗后只反弹，不扣耐久不扣HP
    if (organ.darkened) return;

    const damage = this.getBallDamage();
    organ.hp -= damage;
    this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
    this.score += RIB_SCORE;
    this.damageBall(1);

    // 瞳孔追踪球
    const angle = Phaser.Math.Angle.Between(rib.x, rib.y, this.ball.x, this.ball.y);
    pupil.x = rib.x + Math.cos(angle) * 8;
    pupil.y = rib.y + Math.sin(angle) * 8;

    // 应用特殊效果
    this.applyBallEffects(organ);

    // 闪烁
    rib.setFillStyle(0xff6666);
    this.time.delayedCall(100, () => {
      if (!organ.destroyed) rib.setFillStyle(0xffffff);
    });

    this.showFloatingText(rib.x, rib.y, `-${damage}`, '#ffff00');
    this.updateOrganHpBar(organ);

    if (organ.hp <= 0) {
      this.destroyOrgan(organ);
    }
  }

  // ── 第三关：创建脊椎骨 ───────────────────────────────────────────────────
  private createSpine(x: number, y: number) {
    const spine = this.add.circle(x, y, 10, 0xaaaaaa);
    spine.setStrokeStyle(2, 0x666666);

    const hpBarBg = this.add.rectangle(x, y - 22, 30, 5, 0x333333);
    const hpBar = this.add.rectangle(x - 14, y - 22, 26, 3, 0xff3333);
    hpBar.setOrigin(0, 0.5);
    const statusText = this.add.text(x, y - 30, '', {
      fontSize: '9px', color: '#ffaa00',
    }).setOrigin(0.5).setDepth(15);

    this.physics.add.existing(spine, true);
    const collider = this.physics.add.collider(this.ball, spine, () => {
      if (!this.canHitOrgan(spine)) return;
      this.hitSpine(spine);
    });

    const organ: Organ = {
      obj: spine, body: spine.body as Phaser.Physics.Arcade.Body,
      type: 'spine', hp: SPINE_HP, maxHp: SPINE_HP,
      burnTimer: 0, destroyed: false, darkened: false,
      hpBar, hpBarBg, statusText, score: SPINE_SCORE,
      shockwaveTimer: SPINE_SHOCKWAVE_INTERVAL,
    };
    this.organs.push(organ);
    spine.setData('collider', collider);
    spine.setData('organRef', organ);
  }

  private hitSpine(spine: Phaser.GameObjects.Arc) {
    const organ = spine.getData('organRef') as Organ;
    // ── 音效 ──
    this.playCollisionSound(organ);
    if (!organ || organ.destroyed) return;

    // 弹射球（无论是否变暗都反弹）
    const dx = this.ball.x - spine.x;
    const dy = this.ball.y - spine.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      this.ballBody.setVelocity(
        (dx / dist) * 250 + this.ballBody.velocity.x * 0.3,
        (dy / dist) * 250 + this.ballBody.velocity.y * 0.3
      );
    }

    // 分裂弹珠：第一次弹射时分裂
    this.trySplitBall(this.ball, this.ballBody, this.ballType, false);

    // 变暗后只反弹
    if (organ.darkened) return;

    const damage = this.getBallDamage();
    organ.hp -= damage;
    this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
    this.score += SPINE_SCORE;
    this.damageBall(1);

    this.applyBallEffects(organ);

    spine.setFillStyle(0xcccccc);
    this.time.delayedCall(50, () => {
      if (!organ.destroyed) spine.setFillStyle(0xaaaaaa);
    });

    this.showFloatingText(spine.x, spine.y, `-${damage}`, '#ffff00');
    this.updateOrganHpBar(organ);

    if (organ.hp <= 0) {
      this.destroyOrgan(organ);
    }
  }

  // ── 第三关：创建关节（旋转挡板）──────────────────────────────────────────
  private createJoint(x: number, y: number) {
    const container = this.add.container(x, y);
    const bar = this.add.rectangle(0, 0, 80, 10, 0x22aa44);
    bar.setStrokeStyle(2, 0x44cc66);
    container.add(bar);

    const hpBarBg = this.add.rectangle(x, y - 30, 40, 5, 0x333333);
    const hpBar = this.add.rectangle(x - 18, y - 30, 36, 3, 0xff3333);
    hpBar.setOrigin(0, 0.5);
    const statusText = this.add.text(x, y - 40, '', {
      fontSize: '9px', color: '#ffaa00',
    }).setOrigin(0.5).setDepth(15);

    const organ: Organ = {
      obj: bar, body: null,
      type: 'joint', hp: JOINT_HP, maxHp: JOINT_HP,
      burnTimer: 0, destroyed: false, darkened: false,
      hpBar, hpBarBg, statusText, score: JOINT_SCORE,
      container, orgX: x, orgY: y,
    };
    this.organs.push(organ);
    bar.setData('organRef', organ);
  }

  // ── 第三关：创建血肉壁 ───────────────────────────────────────────────────
  private createFleshWall(x: number, y: number, w: number, h: number) {
    const wall = this.add.rectangle(x, y, w, h, 0x660000);
    wall.setStrokeStyle(2, 0x990000);

    const hpBarBg = this.add.rectangle(x, y - 20, w + 4, 5, 0x333333);
    const hpBar = this.add.rectangle(x - w / 2, y - 20, w, 3, 0xff3333);
    hpBar.setOrigin(0, 0.5);
    const statusText = this.add.text(x, y - 30, '', {
      fontSize: '9px', color: '#ffaa00',
    }).setOrigin(0.5).setDepth(15);

    this.physics.add.existing(wall, true);
    const collider = this.physics.add.collider(this.ball, wall, () => {
      if (!this.canHitOrgan(wall)) return;
      this.hitFleshWall(wall);
    });

    const organ: Organ = {
      obj: wall, body: wall.body as Phaser.Physics.Arcade.Body,
      type: 'fleshWall', hp: FLESH_WALL_HP, maxHp: FLESH_WALL_HP,
      burnTimer: 0, destroyed: false, darkened: false,
      hpBar, hpBarBg, statusText, score: FLESH_WALL_SCORE,
    };
    this.organs.push(organ);
    wall.setData('collider', collider);
    wall.setData('organRef', organ);
  }

  private hitFleshWall(wall: Phaser.GameObjects.Rectangle) {
    const organ = wall.getData('organRef') as Organ;
    // ── 音效 ──
    this.playCollisionSound(organ);
    if (!organ || organ.destroyed) return;

    // 向上弹射球（无论是否变暗都反弹）
    const dx = this.ball.x - wall.x;
    const dist = Math.max(1, Math.abs(dx));
    let vx = (dx / dist) * 200;
    // 防止球在fleshWall正上方永久垂直弹跳
    if (Math.abs(vx) < 80) {
      vx = (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 80);
    }
    this.ballBody.setVelocity(vx, -GROTESQUE_BOUNCE_VEL);

    // 分裂弹珠：第一次弹射时分裂
    this.trySplitBall(this.ball, this.ballBody, this.ballType, false);

    // 变暗后只反弹
    if (organ.darkened) return;

    const damage = this.getBallDamage();
    organ.hp -= damage;
    this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
    this.score += FLESH_WALL_SCORE;
    this.damageBall(1);

    this.applyBallEffects(organ);

    wall.setFillStyle(0x880000);
    this.time.delayedCall(100, () => {
      if (!organ.destroyed) wall.setFillStyle(0x660000);
    });

    this.showFloatingText(wall.x, wall.y, `-${damage}`, '#ffff00');
    this.updateOrganHpBar(organ);

    if (organ.hp <= 0) {
      this.destroyOrgan(organ);
    }
  }

  // ── 第三关：器官状态更新（灼烧/冻结）──────────────────────────────────────
  private updateOrganStates(delta: number) {
    for (const organ of this.organs) {
      if (organ.destroyed) continue;

      // 灼烧
      if (organ.burnTimer > 0) {
        const prevSec = Math.floor(organ.burnTimer / 1000);
        organ.burnTimer -= delta;
        if (organ.burnTimer <= 0) organ.burnTimer = 0;  // 防止负值
        const currSec = Math.floor(organ.burnTimer / 1000);
        // 每经过1秒扣1HP
        if (currSec < prevSec) {
          organ.hp -= BURN_DAMAGE_PER_SEC;
          this.showFloatingText((organ.obj as Phaser.GameObjects.Arc).x, (organ.obj as Phaser.GameObjects.Arc).y, `-${BURN_DAMAGE_PER_SEC}`, '#ff6600');
          this.updateOrganHpBar(organ);
          if (organ.hp <= 0) {
            this.destroyOrgan(organ);
            continue;
          }
        }
      }

      // 更新状态图标
      this.updateOrganStatusText(organ);
    }
  }

  // ── L1/L2障碍物器官更新（灼烧等）─────────────────────────────────────────
  private updateObstacleOrgans(delta: number) {
    for (const organ of this.organs) {
      // 只处理L1/L2障碍物类型
      if (organ.type !== 'bumper' && organ.type !== 'nail' &&
          organ.type !== 'grotesque' && organ.type !== 'slingshot') continue;
      if (organ.destroyed) continue;

      // 灼烧
      if (organ.burnTimer > 0) {
        const prevSec = Math.floor(organ.burnTimer / 1000);
        organ.burnTimer -= delta;
        if (organ.burnTimer <= 0) organ.burnTimer = 0;
        const currSec = Math.floor(organ.burnTimer / 1000);
        if (currSec < prevSec) {
          organ.hp -= BURN_DAMAGE_PER_SEC;
          this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
          const obj = organ.obj as Phaser.GameObjects.Arc;
          this.showFloatingText(obj.x, obj.y, `-${BURN_DAMAGE_PER_SEC}`, '#ff6600');
          this.updateOrganHpBar(organ);
          if (organ.hp <= 0) {
            this.destroyOrgan(organ);
            continue;
          }
        }
      }

      // 更新状态图标
      this.updateOrganStatusText(organ);
    }
  }

  // ── 第三关：关节更新（旋转+碰撞）──────────────────────────────────────────
  private updateJoints(delta: number) {
    for (const organ of this.organs) {
      if (organ.destroyed || organ.type !== 'joint' || !organ.container) continue;

      // 变暗后停止旋转
      if (organ.darkened) continue;

      // 旋转（灼烧时加速）
      const speed = organ.burnTimer > 0 ? delta * 0.002 * RAGE_SPEED_BOOST : delta * 0.002;
      organ.container.rotation += speed;

      // 手动碰撞检测
      if (!this.isLaunching && !this.isDead && !this.isWon) {
        this.checkJointCollision(organ);
      }
    }
  }

  private checkJointCollision(organ: Organ) {
    if (!organ.container || organ.orgX === undefined || organ.orgY === undefined) return;
    const angle = organ.container.rotation;
    const barLen = 80;
    const barHalfH = 5;
    const cx = organ.orgX;
    const cy = organ.orgY;

    const halfLen = barLen / 2;
    const x1 = cx - Math.cos(angle) * halfLen;
    const y1 = cy - Math.sin(angle) * halfLen;
    const x2 = cx + Math.cos(angle) * halfLen;
    const y2 = cy + Math.sin(angle) * halfLen;

    const fx = x2 - x1;
    const fy = y2 - y1;
    const fLen2 = fx * fx + fy * fy;
    const bx = this.ball.x - x1;
    const by = this.ball.y - y1;
    let t = (bx * fx + by * fy) / fLen2;
    t = Math.max(0, Math.min(1, t));

    const closestX = x1 + fx * t;
    const closestY = y1 + fy * t;

    const dx = this.ball.x - closestX;
    const dy = this.ball.y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const ballR = BALL_TYPES[this.ballType].radius;
    const collisionRadius = ballR + barHalfH;

    if (dist < collisionRadius && dist > 0.01) {
      const nx = dx / dist;
      const ny = dy / dist;

      const overlap = collisionRadius - dist + 1;
      this.ball.x += nx * overlap;
      this.ball.y += ny * overlap;

      const vx = this.ballBody.velocity.x;
      const vy = this.ballBody.velocity.y;
      const dot = vx * nx + vy * ny;

      if (dot < 0) {
        const tx = -Math.sin(angle) * 300;
        const ty = Math.cos(angle) * 300;
        this.ballBody.setVelocity(
          vx - 2 * dot * nx + nx * 250 + tx * 0.5,
          vy - 2 * dot * ny + ny * 250 + ty * 0.5
        );
        // 分裂弹珠：第一次弹射时分裂
        this.trySplitBall(this.ball, this.ballBody, this.ballType, false);
        if (this.canHitOrgan(organ.obj)) {
          // 变暗后只反弹，不扣耐久不扣HP
          if (organ.darkened) return;
          this.damageBall(1);
          // 扣器官HP
          const dmg = this.getBallDamage();
          organ.hp -= dmg;
          this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
          this.score += JOINT_SCORE;
          this.applyBallEffects(organ);
          this.showFloatingText(cx, cy, `-${dmg}`, '#ffff00');
          this.updateOrganHpBar(organ);
          if (organ.hp <= 0) {
            this.destroyOrgan(organ);
          }
        }
      }
    }
  }

  // ── 第三关：脊椎冲击波 ───────────────────────────────────────────────────
  private updateSpineShockwaves(delta: number) {
    for (const organ of this.organs) {
      if (organ.destroyed || organ.type !== 'spine') continue;
      if (organ.darkened) continue;  // 变暗后不发射冲击波

      organ.shockwaveTimer = (organ.shockwaveTimer ?? SPINE_SHOCKWAVE_INTERVAL) - delta;
      if (organ.shockwaveTimer <= 0) {
        organ.shockwaveTimer = SPINE_SHOCKWAVE_INTERVAL;
        this.fireSpineShockwave(organ);
      }
    }
  }

  private fireSpineShockwave(organ: Organ) {
    const obj = organ.obj as Phaser.GameObjects.Arc;
    const sx = obj.x;
    const sy = obj.y;

    // 视觉冲击波（环形扩散）
    const wave = this.add.circle(sx, sy, 10, 0x66aaff, 0.3);
    wave.setStrokeStyle(2, 0x88ccff);
    wave.setDepth(2);
    this.tweens.add({
      targets: wave,
      radius: SPINE_SHOCKWAVE_RADIUS,
      alpha: 0,
      duration: 500,
      onComplete: () => wave.destroy(),
    });

    // 对球施加推力
    if (!this.isLaunching) {
      const dx = this.ball.x - sx;
      const dy = this.ball.y - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < SPINE_SHOCKWAVE_RADIUS && dist > 0) {
        const force = SPINE_SHOCKWAVE_FORCE * (1 - dist / SPINE_SHOCKWAVE_RADIUS);
        this.ballBody.setVelocity(
          this.ballBody.velocity.x + (dx / dist) * force,
          this.ballBody.velocity.y + (dy / dist) * force
        );
      }
    }
  }

  // ── 器官被摧毁（变暗但保留反弹）─────────────────────────────────────────
  private destroyOrgan(organ: Organ) {
    if (organ.destroyed) return;
    organ.destroyed = true;
    organ.darkened = true;
    organ.hp = 0;

    // 变暗但不隐藏——保留物理体用于反弹
    // 隐藏HP条和状态文字
    organ.hpBar.setVisible(false);
    organ.hpBarBg.setVisible(false);
    organ.statusText.setVisible(false);
    if (organ.pupil) organ.pupil.setVisible(false);

    // 变暗视觉
    if (organ.type === 'rib' || organ.type === 'spine' || organ.type === 'bumper' || organ.type === 'nail') {
      const arc = organ.obj as Phaser.GameObjects.Arc;
      arc.setFillStyle(0x222222);
      arc.setStrokeStyle(2, 0x444444);
    } else if (organ.type === 'fleshWall' || organ.type === 'grotesque') {
      const rect = organ.obj as Phaser.GameObjects.Rectangle;
      rect.setFillStyle(0x220000);
      rect.setStrokeStyle(2, 0x440000);
    } else if (organ.type === 'slingshot') {
      const tri = organ.obj as Phaser.GameObjects.Triangle;
      tri.setFillStyle(0x111122);
      tri.setStrokeStyle(2, 0x222244);
    } else if (organ.type === 'joint') {
      const bar = organ.obj as Phaser.GameObjects.Rectangle;
      bar.setFillStyle(0x112211);
      bar.setStrokeStyle(2, 0x224422);
    }

    // 不移除物理体——保留反弹能力
    // 不销毁collider——保留碰撞

    this.destroyedOrganCount++;
    this.score += organ.score;
    this.showFloatingText(
      (organ.obj as Phaser.GameObjects.Arc).x,
      (organ.obj as Phaser.GameObjects.Arc).y,
      '摧毁!', '#ff0000'
    );

    // 怒吼（仅L3）
    if (this.level === 3) {
      this.triggerRage();
    }

    // 检查心脏暴露条件（仅L3）
    if (this.level === 3 && this.destroyedOrganCount >= HEART_EXPOSE_THRESHOLD && !this.heartExposed) {
      this.exposeHeart();
    }
  }

  // ── 器官恢复（Boss再生被摧毁的组织）──────────────────────────────────────
  private updateOrganRegen(delta: number) {
    if (this.destroyedOrganCount === 0) return;

    this.organRegenTimer += delta;
    if (this.organRegenTimer < ORGAN_REGEN_INTERVAL) return;
    this.organRegenTimer = 0;

    // 找到最早被摧毁的器官，恢复它
    const regenTarget = this.organs.find(o => o.destroyed);
    if (!regenTarget) return;

    regenTarget.destroyed = false;
    regenTarget.darkened = false;
    regenTarget.hp = regenTarget.maxHp;
    regenTarget.burnTimer = 0;
    this.destroyedOrganCount--;

    // 恢复视觉
    regenTarget.hpBar.setVisible(true);
    regenTarget.hpBarBg.setVisible(true);
    regenTarget.statusText.setVisible(true);
    if (regenTarget.pupil) regenTarget.pupil.setVisible(true);

    // 恢复原始颜色
    if (regenTarget.type === 'rib' || regenTarget.type === 'bumper') {
      const arc = regenTarget.obj as Phaser.GameObjects.Arc;
      arc.setFillStyle(0xffffff);
      arc.setStrokeStyle(3, 0xff0000);
    } else if (regenTarget.type === 'spine' || regenTarget.type === 'nail') {
      const arc = regenTarget.obj as Phaser.GameObjects.Arc;
      arc.setFillStyle(0xaaaaaa);
      arc.setStrokeStyle(2, 0x666666);
    } else if (regenTarget.type === 'fleshWall' || regenTarget.type === 'grotesque') {
      const rect = regenTarget.obj as Phaser.GameObjects.Rectangle;
      rect.setFillStyle(0x660000);
      rect.setStrokeStyle(2, 0x990000);
    } else if (regenTarget.type === 'slingshot') {
      const tri = regenTarget.obj as Phaser.GameObjects.Triangle;
      tri.setFillStyle(0x4422aa);
      tri.setStrokeStyle(2, 0x6644cc);
    } else if (regenTarget.type === 'joint') {
      const bar = regenTarget.obj as Phaser.GameObjects.Rectangle;
      bar.setFillStyle(0x22aa44);
      bar.setStrokeStyle(2, 0x44cc66);
    }

    this.updateOrganHpBar(regenTarget);

    const obj = regenTarget.obj as Phaser.GameObjects.Arc;
    this.showFloatingText(obj.x, obj.y, '再生!', '#00ff00');
    this.cameras.main.flash(200, 0, 80, 0);
  }

  // ── 器官命中时扣Boss总血量 ──────────────────────────────────────────────
  private damageBossFromOrgan(damage: number) {
    this.bossHp -= damage;
    if (this.bossHp <= 0) {
      this.bossHp = 0;
      this.clearLevel();
    }
  }

  // ── 怒吼系统 ─────────────────────────────────────────────────────────
  private triggerRage() {
    this.rageTimer = RAGE_DURATION;
    this.cameras.main.shake(300, 0.02);
    this.showFloatingText(GAME_W / 2, 100, '怪物怒吼了！', '#ff6600');
  }

  private updateRage(delta: number) {
    if (this.rageTimer > 0) {
      this.rageTimer -= delta;
      if (this.rageTimer <= 0) this.rageTimer = 0;
    }
  }

  // ── 第三关：心跳脉动 ─────────────────────────────────────────────────────
  private updateHeartbeat(delta: number) {
    this.heartbeatTimer += delta;
    // 心跳速度随器官摧毁加快
    const destroyedRatio = this.totalOrganCount > 0 ? this.destroyedOrganCount / this.totalOrganCount : 0;
    const beatInterval = 1200 - destroyedRatio * 500;  // 1200ms→700ms
    if (this.heartbeatTimer >= beatInterval) {
      this.heartbeatTimer = 0;
      // 背景脉动
      if (this.bgRect) {
        this.tweens.add({
          targets: this.bgRect,
          alpha: 0.8,
          duration: 100,
          yoyo: true,
        });
      }
    }
  }

  // ── 弹珠款式切换 ─────────────────────────────────────────────────────
  private switchBallType(type: string) {
    if (this.ballTypeCounts[type] <= 0) return;
    this.ballType = type;
    this.applyBallTypeProperties();
    this.updateBallTypePanel();
    const bt = BALL_TYPES[type];
    this.showFloatingText(this.ball.x, this.ball.y - 30, bt.label, '#' + bt.color.toString(16).padStart(6, '0'));
  }

  // ── 获取弹珠伤害值 ───────────────────────────────────────────────────
  private getBallDamage(): number {
    return BALL_TYPES[this.ballType].damage;
  }

  // ── 第三关：应用弹珠特殊效果（点燃）──────────────────────────────────
  private applyBallEffects(organ: Organ) {
    if (this.ballType === BALL_TYPE_FIRE) {
      // 点燃：重置灼烧计时器
      organ.burnTimer = BURN_DURATION;
    }
    // 分裂弹珠无特殊器官效果（分裂逻辑在碰撞时处理）
  }

  // ── 第三关：器官碰撞冷却（重命名自 canHitObstacle）────────────────────────
  private canHitOrgan(obj: Phaser.GameObjects.GameObject): boolean {
    const now = this.time.now;
    const last = obj.getData('lastHit') as number;
    if (last !== undefined && now - last < OBSTACLE_HIT_COOLDOWN) return false;
    obj.setData('lastHit', now);
    return true;
  }

  // ── 第三关：更新器官HP条 ─────────────────────────────────────────────────
  private updateOrganHpBar(organ: Organ) {
    const ratio = Math.max(0, organ.hp / organ.maxHp);
    let barW = 40;
    switch (organ.type) {
      case 'rib': barW = 40; break;
      case 'spine': barW = 26; break;
      case 'joint': barW = 36; break;
      case 'fleshWall': barW = 80; break;
      case 'bumper': barW = 56; break;
      case 'nail': barW = 26; break;
      case 'grotesque': barW = 56; break;
      case 'slingshot': barW = 46; break;
    }
    organ.hpBar.width = ratio * barW;
  }

  // ── 第三关：更新器官状态图标 ─────────────────────────────────────────────
  private updateOrganStatusText(organ: Organ) {
    let text = '';
    if (organ.burnTimer > 0) {
      text = '🔥';
    }
    organ.statusText.setText(text);

    // 点燃时器官变色
    if (organ.type === 'rib' || organ.type === 'spine' || organ.type === 'bumper' || organ.type === 'nail') {
      const arcObj = organ.obj as Phaser.GameObjects.Arc;
      if (organ.burnTimer > 0) {
        arcObj.setFillStyle(0xff6600);
      }
    } else if (organ.type === 'fleshWall' || organ.type === 'grotesque') {
      const rectObj = organ.obj as Phaser.GameObjects.Rectangle;
      if (organ.burnTimer > 0) {
        rectObj.setFillStyle(0xff6600);
      }
    }
  }

  // ── 机关（按关卡不同） ──────────────────────────────────────────────────

  private createObstacles() {
    if (this.level === 1) {
      this.createLevel1Obstacles();
    } else if (this.level === 2) {
      this.createLevel2Obstacles();
    } else {
      this.createLevel3Obstacles();
    }
  }

  private createLevel1Obstacles() {
    // 第一关：2 个 bumper（两侧）
    const bumperPositions = [
      { x: 180, y: 250 },
      { x: 620, y: 250 },
    ];
    for (const pos of bumperPositions) {
      this.createBumper(pos.x, pos.y);
    }

    // 斜弹板
    this.createSlingshot(150, 430);
    this.createSlingshot(650, 430);

    // 骨头钉（V 形）
    const nailPositions = [
      { x: 200, y: 320 }, { x: 250, y: 360 }, { x: 300, y: 400 },
      { x: 600, y: 320 }, { x: 550, y: 360 }, { x: 500, y: 400 },
      { x: 280, y: 180 }, { x: 520, y: 180 },
    ];
    for (const pos of nailPositions) {
      this.createNail(pos.x, pos.y);
    }

    // 血肉沟壑
    this.createGrotesque(60, 470, 80, 20);
    this.createGrotesque(740, 470, 80, 20);
  }

  private createLevel2Obstacles() {
    // ── 第二关地图改良 ──
    // 设计理念：三层防线 + 通道引导，球从上方下落经过层层阻击才能到达挡板
    //
    // 第一层（y≈160-200）：高位 bumper 群，球发射后首先遭遇
    // 第二层（y≈280-340）：旋转挡板 + 钉子墙，中路封锁
    // 第三层（y≈400-470）：斜弹板 + 沟壑，底部防线

    // 第一层：4 个 bumper 形成弧形阵列
    const bumperPositions = [
      { x: 150, y: 200 }, { x: 650, y: 200 },   // 两侧高位
      { x: 300, y: 170 }, { x: 500, y: 170 },   // 中间高位
    ];
    for (const pos of bumperPositions) {
      this.createBumper(pos.x, pos.y);
    }

    // 第二层：2 个旋转挡板（中路封锁）
    this.createSpinner(220, 330);
    this.createSpinner(580, 330);

    // 第二层：钉子墙（V 形引导，球被弹向两侧）
    // 注意：不在 x=400 发射通道正上方放置钉子，避免球一弹射就被挡住
    const nailPositions = [
      // 左侧 V 形
      { x: 120, y: 280 }, { x: 170, y: 380 },
      // 右侧 V 形
      { x: 680, y: 280 }, { x: 630, y: 380 },
      // 中间散点（Boss 下方，偏左右两侧避开发射通道）
      { x: 340, y: 260 }, { x: 460, y: 260 },
    ];
    for (const pos of nailPositions) {
      this.createNail(pos.x, pos.y);
    }

    // 第三层：斜弹板（引导球回到中路）
    this.createSlingshot(150, 440);
    this.createSlingshot(650, 440);

    // 第三层：血肉沟壑（仅底部两侧，不挡住中间发射通道）
    this.createGrotesque(60, 470, 80, 20);
    this.createGrotesque(740, 470, 80, 20);
  }

  private createLevel3Obstacles() {
    // ── 第三关地图设计 ──
    // 设计理念：双Boss在上方左右巡逻，地图需为Boss让出移动空间
    // Boss巡逻区域：左Boss x∈[120,380], 右Boss x∈[420,680], y=95
    // 障碍物避开 Boss 巡逻带（y < 160 的区域不放障碍物）
    // 同时避开发射通道（x=400 附近不放障碍物）
    //
    // 第一层（y≈180-220）：bumper 群，球发射后首先遭遇
    // 第二层（y≈280-340）：旋转挡板 + 钉子，中路封锁
    // 第三层（y≈400-470）：斜弹板 + 沟壑，底部防线

    // 第一层：4 个 bumper（避开Boss巡逻区域，放在 bumper 层）
    const bumperPositions = [
      { x: 100, y: 220 }, { x: 700, y: 220 },   // 两侧
      { x: 280, y: 180 }, { x: 520, y: 180 },   // 中间偏左右（避开发射通道 x=400）
    ];
    for (const pos of bumperPositions) {
      this.createBumper(pos.x, pos.y);
    }

    // 第二层：2 个旋转挡板（中路封锁，避开发射通道）
    this.createSpinner(200, 330);
    this.createSpinner(600, 330);

    // 第二层：钉子墙（V 形引导，避开发射通道和Boss巡逻带）
    const nailPositions = [
      // 左侧 V 形
      { x: 100, y: 280 }, { x: 150, y: 380 },
      // 右侧 V 形
      { x: 700, y: 280 }, { x: 650, y: 380 },
      // 中间散点（偏左右两侧避开发射通道 x=400）
      { x: 320, y: 260 }, { x: 480, y: 260 },
      // 额外钉子增加难度
      { x: 250, y: 400 }, { x: 550, y: 400 },
    ];
    for (const pos of nailPositions) {
      this.createNail(pos.x, pos.y);
    }

    // 第三层：斜弹板（引导球回到中路）
    this.createSlingshot(130, 440);
    this.createSlingshot(670, 440);

    // 第三层：血肉沟壑（仅底部两侧，不挡住中间发射通道）
    this.createGrotesque(60, 470, 80, 20);
    this.createGrotesque(740, 470, 80, 20);
  }

  private createBumper(x: number, y: number) {
    const bumper = this.add.circle(x, y, 28, 0xffffff);
    bumper.setStrokeStyle(3, 0xff0000);
    const pupil = this.add.circle(x, y, 11, 0x000000);

    // HP条
    const hpBarBg = this.add.rectangle(x, y - 35, 60, 6, 0x333333);
    hpBarBg.setStrokeStyle(1, 0x666666);
    const hpBar = this.add.rectangle(x - 30, y - 35, 56, 4, 0x33ff33);
    hpBar.setOrigin(0, 0.5);
    const statusText = this.add.text(x, y - 50, '', {
      fontSize: '10px', color: '#88ff88'
    }).setOrigin(0.5);

    this.physics.add.existing(bumper, true);
    this.physics.add.collider(this.ball, bumper, () => {
      if (!this.canHitObstacle(bumper)) return;
      this.hitBumper(bumper, pupil);
    });
    this.bumpers.push({ obj: bumper, pupil });

    // 创建器官对象
    const organ: Organ = {
      obj: bumper, body: bumper.body as Phaser.Physics.Arcade.Body,
      type: 'bumper', hp: BUMPER_HP, maxHp: BUMPER_HP,
      burnTimer: 0, destroyed: false, darkened: false,
      hpBar, hpBarBg, statusText, score: BUMPER_SCORE,
    };
    this.organs.push(organ);
    bumper.setData('organRef', organ);
  }

  private createSlingshot(x: number, y: number) {
    const sling = this.add.triangle(
      x, y, -30, 30, 30, 30, 0, -30, 0x4422aa
    );
    sling.setStrokeStyle(2, 0x6644cc);

    // HP条
    const hpBarBg = this.add.rectangle(x, y - 40, 50, 6, 0x333333);
    hpBarBg.setStrokeStyle(1, 0x666666);
    const hpBar = this.add.rectangle(x - 25, y - 40, 46, 4, 0x33ff33);
    hpBar.setOrigin(0, 0.5);
    const statusText = this.add.text(x, y - 55, '', {
      fontSize: '10px', color: '#88ff88'
    }).setOrigin(0.5);

    this.physics.add.existing(sling, true);
    this.physics.add.collider(this.ball, sling, () => {
      if (!this.canHitObstacle(sling)) return;
      // 查找器官
      const organ = sling.getData('organRef') as Organ | null;
      // ── 音效 ──
      this.playCollisionSound(organ);
      // 弹射球
      const dir = x < GAME_W / 2 ? 1 : -1;
      this.ballBody.setVelocity(dir * 200, -500);
      // 分裂弹珠
      this.trySplitBall(this.ball, this.ballBody, this.ballType, false);
      if (organ && !organ.destroyed && !organ.darkened) {
        const damage = this.getBallDamage();
        organ.hp -= damage;
        this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
        this.score += SLINGSHOT_SCORE;
        this.damageBall(1);
        this.applyBallEffects(organ);
        sling.setFillStyle(0x6644ff);
        this.time.delayedCall(100, () => {
          if (!organ.destroyed) sling.setFillStyle(0x4422aa);
        });
        this.showFloatingText(x, y, `-${damage}`, '#ffff00');
        this.updateOrganHpBar(organ);
        if (organ.hp <= 0) {
          this.destroyOrgan(organ);
        }
      } else if (!organ) {
        sling.setFillStyle(0x6644ff);
        this.time.delayedCall(100, () => sling.setFillStyle(0x4422aa));
        this.damageBall(1);
      }
    });
    this.slingshots.push(sling);

    // 创建器官对象
    const organ: Organ = {
      obj: sling, body: sling.body as Phaser.Physics.Arcade.Body,
      type: 'slingshot', hp: SLINGSHOT_HP, maxHp: SLINGSHOT_HP,
      burnTimer: 0, destroyed: false, darkened: false,
      hpBar, hpBarBg, statusText, score: SLINGSHOT_SCORE,
    };
    this.organs.push(organ);
    sling.setData('organRef', organ);
  }

  private createNail(x: number, y: number) {
    const nail = this.add.circle(x, y, 7, 0xaaaaaa);
    nail.setStrokeStyle(2, 0x666666);

    // HP条
    const hpBarBg = this.add.rectangle(x, y - 15, 30, 5, 0x333333);
    hpBarBg.setStrokeStyle(1, 0x666666);
    const hpBar = this.add.rectangle(x - 15, y - 15, 26, 3, 0x33ff33);
    hpBar.setOrigin(0, 0.5);
    const statusText = this.add.text(x, y - 25, '', {
      fontSize: '9px', color: '#88ff88'
    }).setOrigin(0.5);

    this.physics.add.existing(nail, true);
    this.physics.add.collider(this.ball, nail, () => {
      if (!this.canHitObstacle(nail)) return;
      this.hitNail(nail);
    });
    this.nails.push(nail);

    // 创建器官对象
    const organ: Organ = {
      obj: nail, body: nail.body as Phaser.Physics.Arcade.Body,
      type: 'nail', hp: NAIL_HP, maxHp: NAIL_HP,
      burnTimer: 0, destroyed: false, darkened: false,
      hpBar, hpBarBg, statusText, score: NAIL_SCORE,
    };
    this.organs.push(organ);
    nail.setData('organRef', organ);
  }

  private createGrotesque(x: number, y: number, w: number, h: number) {
    const grotesque = this.add.rectangle(x, y, w, h, 0x660000);
    grotesque.setStrokeStyle(2, 0x990000);

    // HP条
    const hpBarBg = this.add.rectangle(x, y - h/2 - 10, 60, 6, 0x333333);
    hpBarBg.setStrokeStyle(1, 0x666666);
    const hpBar = this.add.rectangle(x - 30, y - h/2 - 10, 56, 4, 0x33ff33);
    hpBar.setOrigin(0, 0.5);
    const statusText = this.add.text(x, y - h/2 - 25, '', {
      fontSize: '10px', color: '#88ff88'
    }).setOrigin(0.5);

    this.physics.add.existing(grotesque, true);
    this.physics.add.collider(this.ball, grotesque, () => {
      if (!this.canHitObstacle(grotesque)) return;
      this.hitGrotesque(grotesque);
    });
    this.grotesques.push(grotesque);

    // 创建器官对象
    const organ: Organ = {
      obj: grotesque, body: grotesque.body as Phaser.Physics.Arcade.Body,
      type: 'grotesque', hp: GROTESQUE_HP, maxHp: GROTESQUE_HP,
      burnTimer: 0, destroyed: false, darkened: false,
      hpBar, hpBarBg, statusText, score: GROTESQUE_SCORE,
    };
    this.organs.push(organ);
    grotesque.setData('organRef', organ);
  }

  private createSpinner(x: number, y: number) {
    // 旋转挡板：视觉旋转，碰撞手动检测（Arcade Physics 不支持旋转体碰撞）
    const container = this.add.container(x, y);
    const bar = this.add.rectangle(0, 0, 80, 10, 0x22aa44);
    bar.setStrokeStyle(2, 0x44cc66);
    container.add(bar);

    // 不创建物理体——碰撞在 updateSpinners 中手动处理
    this.spinners.push({ container, bar, x, y });
  }

  private updateSpinners(delta: number) {
    for (const spinner of this.spinners) {
      spinner.container.rotation += delta * 0.002;

      // 手动碰撞检测：将旋转挡板视为线段
      if (!this.isLaunching && !this.isDead && !this.isWon) {
        this.checkSpinnerCollision(spinner);
      }
    }
  }

  // 旋转挡板碰撞检测：与挡板碰撞类似，但挡板在持续旋转
  private checkSpinnerCollision(spinner: { container: Phaser.GameObjects.Container; bar: Phaser.GameObjects.Rectangle; x: number; y: number }) {
    const angle = spinner.container.rotation;
    const barLen = 80;

    // 挡板两端坐标（容器旋转后）
    const halfLen = barLen / 2;
    const x1 = spinner.x - Math.cos(angle) * halfLen;
    const y1 = spinner.y - Math.sin(angle) * halfLen;
    const x2 = spinner.x + Math.cos(angle) * halfLen;
    const y2 = spinner.y + Math.sin(angle) * halfLen;

    // 球到线段最近点
    const fx = x2 - x1;
    const fy = y2 - y1;
    const fLen2 = fx * fx + fy * fy;

    // 主球碰撞检测
    this.checkSpinnerBallCollision(spinner, angle, x1, y1, fx, fy, fLen2, this.ball, this.ballBody, false);

    // 额外球碰撞检测
    for (const eb of this.extraBalls) {
      if (eb.obj.active && eb.obj.visible) {
        this.checkSpinnerBallCollision(spinner, angle, x1, y1, fx, fy, fLen2, eb.obj, eb.body, true);
      }
    }
  }

  private checkSpinnerBallCollision(
    spinner: { container: Phaser.GameObjects.Container; bar: Phaser.GameObjects.Rectangle; x: number; y: number },
    angle: number, x1: number, y1: number, fx: number, fy: number, fLen2: number,
    ballObj: Phaser.GameObjects.Arc, ballBody: Phaser.Physics.Arcade.Body, isExtra: boolean
  ) {
    const barHalfH = 5;

    const bx = ballObj.x - x1;
    const by = ballObj.y - y1;
    let t = (bx * fx + by * fy) / fLen2;
    t = Math.max(0, Math.min(1, t));

    const closestX = x1 + fx * t;
    const closestY = y1 + fy * t;

    const dx = ballObj.x - closestX;
    const dy = ballObj.y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const ballR = isExtra ? BALL_TYPES[BALL_TYPE_SPLIT].radius : BALL_TYPES[this.ballType].radius;
    const collisionRadius = ballR + barHalfH;

    if (dist < collisionRadius && dist > 0.01) {
      const nx = dx / dist;
      const ny = dy / dist;

      // 推出
      const overlap = collisionRadius - dist + 1;
      ballObj.x += nx * overlap;
      ballObj.y += ny * overlap;

      const vx = ballBody.velocity.x;
      const vy = ballBody.velocity.y;
      const dot = vx * nx + vy * ny;

      if (dot < 0) {
        // 旋转挡板给球切向速度 + 反弹
        const tx = -Math.sin(angle) * 300;
        const ty = Math.cos(angle) * 300;
        ballBody.setVelocity(
          vx - 2 * dot * nx + nx * 250 + tx * 0.5,
          vy - 2 * dot * ny + ny * 250 + ty * 0.5
        );
        if (this.canHitObstacle(spinner.bar)) {
          if (isExtra) {
            this.damageExtraBall(this.findExtraBall(ballObj), 1);
          } else {
            this.damageBall(1);
          }
        }
      }
    }
  }

  private hitBumper(bumper: Phaser.GameObjects.Arc, pupil: Phaser.GameObjects.Arc) {
    const organ = bumper.getData('organRef') as Organ | null;

    // ── 音效 ──
    this.playCollisionSound(organ);

    // 弹射球
    const angle = Phaser.Math.Angle.Between(
      bumper.x, bumper.y, this.ball.x, this.ball.y
    );
    pupil.x = bumper.x + Math.cos(angle) * 8;
    pupil.y = bumper.y + Math.sin(angle) * 8;

    const dx = this.ball.x - bumper.x;
    const dy = this.ball.y - bumper.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      let vx = (dx / dist) * BUMPER_BOUNCE;
      let vy = (dy / dist) * BUMPER_BOUNCE;
      // 防止球在bumper正上方永久垂直弹跳：水平分量太小时添加随机偏移
      if (Math.abs(vx) < 80) {
        vx = (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 80);
      }
      this.ballBody.setVelocity(vx, vy);
    }

    // 分裂弹珠：第一次弹射时分裂
    this.trySplitBall(this.ball, this.ballBody, this.ballType, false);

    // 无器官系统时（旧逻辑），直接处理
    if (!organ) {
      this.score += BUMPER_SCORE;
      this.damageBall(1);
      bumper.setFillStyle(0xff6666);
      this.time.delayedCall(100, () => bumper.setFillStyle(0xffffff));
      this.showFloatingText(bumper.x, bumper.y, `+${BUMPER_SCORE}`, '#ffff00');
      return;
    }

    // 器官系统
    if (organ.destroyed || organ.darkened) return;

    const damage = this.getBallDamage();
    organ.hp -= damage;
    this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
    this.score += BUMPER_SCORE;
    this.damageBall(1);
    this.applyBallEffects(organ);

    bumper.setFillStyle(0xff6666);
    this.time.delayedCall(100, () => {
      if (!organ.destroyed) bumper.setFillStyle(0xffffff);
    });
    this.showFloatingText(bumper.x, bumper.y, `-${damage}`, '#ffff00');
    this.updateOrganHpBar(organ);

    if (organ.hp <= 0) {
      this.destroyOrgan(organ);
    }
  }

  private hitNail(nail: Phaser.GameObjects.Arc) {
    const organ = nail.getData('organRef') as Organ | null;

    // ── 音效 ──
    this.playCollisionSound(organ);

    // 钉子给球一个小弹力
    const dx = this.ball.x - nail.x;
    const dy = this.ball.y - nail.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      this.ballBody.setVelocity(
        (dx / dist) * 250 + this.ballBody.velocity.x * 0.3,
        (dy / dist) * 250 + this.ballBody.velocity.y * 0.3
      );
    }

    // 分裂弹珠：第一次弹射时分裂
    this.trySplitBall(this.ball, this.ballBody, this.ballType, false);

    // 无器官系统时
    if (!organ) {
      this.score += NAIL_SCORE;
      this.damageBall(1);
      nail.setFillStyle(0xcccccc);
      this.time.delayedCall(50, () => nail.setFillStyle(0xaaaaaa));
      return;
    }

    if (organ.destroyed || organ.darkened) return;

    const damage = this.getBallDamage();
    organ.hp -= damage;
    this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
    this.score += NAIL_SCORE;
    this.damageBall(1);
    this.applyBallEffects(organ);

    nail.setFillStyle(0xcccccc);
    this.time.delayedCall(50, () => {
      if (!organ.destroyed) nail.setFillStyle(0xaaaaaa);
    });
    this.showFloatingText(nail.x, nail.y, `-${damage}`, '#ffff00');
    this.updateOrganHpBar(organ);

    if (organ.hp <= 0) {
      this.destroyOrgan(organ);
    }
  }

  private hitGrotesque(grotesque: Phaser.GameObjects.Rectangle) {
    // 沟壑弹射球向上
    const dx = this.ball.x - grotesque.x;
    const dist = Math.max(1, Math.abs(dx));
    let vx = (dx / dist) * 200;
    // 防止球在grotesque正上方永久垂直弹跳
    if (Math.abs(vx) < 80) {
      vx = (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 80);
    }
    this.ballBody.setVelocity(vx, -GROTESQUE_BOUNCE_VEL);

    // 分裂弹珠：第一次弹射时分裂
    this.trySplitBall(this.ball, this.ballBody, this.ballType, false);

    // 通过 organRef 获取正确的器官
    const organ = grotesque.getData('organRef') as Organ | null;
    // ── 音效 ──
    this.playCollisionSound(organ);
    if (organ && !organ.destroyed && !organ.darkened) {
      const damage = this.getBallDamage();
      organ.hp -= damage;
      this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
      this.score += GROTESQUE_SCORE;
      this.damageBall(1);
      this.applyBallEffects(organ);
      this.showFloatingText(grotesque.x, grotesque.y - 20, `-${damage}`, '#ffff00');
      this.updateOrganHpBar(organ);
      if (organ.hp <= 0) {
        this.destroyOrgan(organ);
      }
    } else if (!organ) {
      // 旧逻辑
      this.damageBall(1);
    }
  }

  // ── 第二关：Boss 子弹系统 ────────────────────────────────────────────────

  private updateBullets(delta: number) {
    if (this.level === 1) return;

    if (this.level === 3) {
      // 第三关：心脏暴露后发射子弹
      if (this.heartExposed && this.heartHp > 0) {
        this.heartBulletTimer += delta;
        if (this.heartBulletTimer >= HEART_BULLET_INTERVAL) {
          this.heartBulletTimer = 0;
          this.fireBulletFromHeart();
        }
      }
    } else {
      // 第二关：Boss 定时发射子弹
      this.bulletTimer += delta;
      if (this.bulletTimer >= BOSS2_BULLET_INTERVAL) {
        this.bulletTimer = 0;
        this.fireBullet(false);
      }
    }

    // 子弹伤害值
    const bulletDamage = this.level === 3 ? HEART_BULLET_DAMAGE : 1;
    const bulletRadius = this.level === 3 ? HEART_BULLET_RADIUS : BOSS2_BULLET_RADIUS;

    // 更新子弹位置，检测与球碰撞
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];

      // 子弹掉出屏幕则移除
      if (bullet.y > GAME_H + 20 || bullet.x < -20 || bullet.x > GAME_W + 20) {
        bullet.destroy();
        this.bullets.splice(i, 1);
        continue;
      }

      // 检测与球碰撞（距离判断）
      const dist = Phaser.Math.Distance.Between(
        bullet.x, bullet.y, this.ball.x, this.ball.y
      );
      if (dist < BALL_RADIUS + bulletRadius && !this.isLaunching) {
        // 被子弹击中
        this.damageBall(bulletDamage);
        const hitText = this.level === 3 ? `-${bulletDamage}!` : '击中!';
        this.showFloatingText(this.ball.x, this.ball.y, hitText, '#ff00ff');
        bullet.destroy();
        this.bullets.splice(i, 1);
      }
    }
  }

  private fireBullet(_fromLeftBoss: boolean = false, _fromRightBoss: boolean = false) {
    if (this.level === 3) return;  // 第三关用 fireBulletFromHeart
    // 确定发射位置
    let originX: number, originY: number;
    originX = BOSS_X;
    originY = BOSS_Y + 30;

    const bulletRadius = BOSS2_BULLET_RADIUS;
    const bulletSpeed = BOSS2_BULLET_SPEED;
    const bulletColor = 0xff00ff;

    const bullet = this.add.circle(
      originX, originY, bulletRadius, bulletColor
    );
    bullet.setStrokeStyle(2, 0xaa00aa);
    bullet.setDepth(6);

    this.physics.add.existing(bullet, false);
    const bBody = bullet.body as Phaser.Physics.Arcade.Body;
    bBody.setCircle(bulletRadius);
    bBody.setAllowGravity(false);
    bBody.setCollideWorldBounds(false);

    // 随机方向发射（偏向下方）
    const angle = Phaser.Math.FloatBetween(0.3, 0.7) * Math.PI;  // 54°~126°，即向下偏左右
    const vx = Math.cos(angle) * bulletSpeed;
    const vy = Math.sin(angle) * bulletSpeed;
    bBody.setVelocity(vx, vy);

    this.bullets.push(bullet);

    // Boss 眼睛闪烁
    this.bossEyeLeft.setFillStyle(0xffffff);
    this.bossEyeRight.setFillStyle(0xffffff);
    this.time.delayedCall(100, () => {
      this.bossEyeLeft.setFillStyle(0xff0000);
      this.bossEyeRight.setFillStyle(0xff0000);
    });
  }

  // ── 第三关：心脏发射子弹 ──────────────────────────────────────────────────
  private fireBulletFromHeart() {
    const originX = BOSS_X;
    const originY = BOSS_Y + 30;

    const bullet = this.add.circle(originX, originY, HEART_BULLET_RADIUS, 0xff0066);
    bullet.setStrokeStyle(2, 0xaa0044);
    bullet.setDepth(6);

    this.physics.add.existing(bullet, false);
    const bBody = bullet.body as Phaser.Physics.Arcade.Body;
    bBody.setCircle(HEART_BULLET_RADIUS);
    bBody.setAllowGravity(false);
    bBody.setCollideWorldBounds(false);

    // 随机方向发射（偏向下方）
    const angle = Phaser.Math.FloatBetween(0.3, 0.7) * Math.PI;
    const vx = Math.cos(angle) * HEART_BULLET_SPEED;
    const vy = Math.sin(angle) * HEART_BULLET_SPEED;
    bBody.setVelocity(vx, vy);

    this.bullets.push(bullet);

    // 心脏眼睛闪烁
    this.bossEyeLeft.setFillStyle(0xffffff);
    this.bossEyeRight.setFillStyle(0xffffff);
    this.time.delayedCall(100, () => {
      this.bossEyeLeft.setFillStyle(0xff0000);
      this.bossEyeRight.setFillStyle(0xff0000);
    });
  }

  // ── UI ──────────────────────────────────────────────────────────────────

  private createUI() {
    this.scoreText = this.add.text(16, 16, '分数: 0', {
      fontSize: '20px', color: '#ffffff',
    }).setDepth(20);

    this.ballsText = this.add.text(16, 44, `球: ${this.ballsLeft}`, {
      fontSize: '18px', color: '#44aaff',
    }).setDepth(20);

    this.durabilityText = this.add.text(16, 70, `耐久: ${BALL_DURABILITY}/${BALL_DURABILITY}`, {
      fontSize: '16px', color: '#ffcc66',
    }).setDepth(20);

    this.add.text(GAME_W - 16, 44, `第 ${this.level} 关`, {
      fontSize: '16px', color: '#aaaaff',
    }).setOrigin(1, 0).setDepth(20);

    this.powerBarBg = this.add.rectangle(
      GAME_W / 2, GAME_H - 25, 200, 16, 0x333333
    );
    this.powerBarBg.setDepth(20);
    this.powerBar = this.add.rectangle(
      GAME_W / 2 - 100, GAME_H - 25, 0, 16, 0x00ff00
    );
    this.powerBar.setOrigin(0, 0.5);
    this.powerBar.setDepth(21);

    this.messageText = this.add.text(GAME_W / 2, GAME_H / 2, '', {
      fontSize: '22px', color: '#ffffff', align: 'center',
      backgroundColor: '#000000', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setDepth(30).setVisible(false);

    const backBtn = this.add.text(GAME_W - 16, 16, '← 菜单', {
      fontSize: '18px', color: '#ffffff', backgroundColor: '#333333',
      padding: { x: 10, y: 5 },
    }).setInteractive({ useHandCursor: true }).setDepth(20);
    backBtn.on('pointerdown', () => this.scene.start('MenuScene'));

    // 弹珠选择面板（L2/L3用，L1只有基础弹珠不显示面板）
    if (this.level >= 2) {
      this.createBallTypePanel();
    }
    // 统一HP条（所有关卡都显示）
    this.createMonsterHpBar();

    const hint = this.level === 1
      ? '← → 弹挡板 | W/S 左挡上下 | ↑/↓ 右挡上下 | 空格发射 | ESC返回'
      : this.level === 2
      ? '← → 弹挡板 | 1/2 切换弹珠 | W/S 左挡上下 | ↑/↓ 右挡上下 | 空格发射 | ESC返回'
      : '← → 弹挡板 | 1/2/3 切换弹珠 | 空格发射 | 摧毁器官→击碎心脏 | ESC返回';
    this.add.text(GAME_W / 2, GAME_H - 50, hint, {
      fontSize: '13px', color: '#666666',
    }).setOrigin(0.5).setDepth(20);
  }

  // ── 弹珠选择面板 ──────────────────────────────────────────────────────
  private createBallTypePanel() {
    const keys = Object.keys(this.ballTypeCounts);
    const startX = GAME_W / 2 - (keys.length - 1) * 40;
    const y = GAME_H - 80;
    this.ballTypeIcons = [];

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const bt = BALL_TYPES[key];
      const x = startX + i * 80;

      const bg = this.add.rectangle(x, y, 70, 36, 0x222233);
      bg.setStrokeStyle(2, 0x555566);
      bg.setDepth(20);

      const colorStr = '#' + bt.color.toString(16).padStart(6, '0');
      const text = this.add.text(x, y, `[${i + 1}] ${bt.label}\n×${this.ballTypeCounts[key]}`, {
        fontSize: '11px', color: colorStr, align: 'center',
      }).setOrigin(0.5).setDepth(21);

      this.ballTypeIcons.push({ text, bg });
    }
    this.updateBallTypePanel();
  }

  private updateBallTypePanel() {
    const keys = Object.keys(this.ballTypeCounts);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const icon = this.ballTypeIcons[i];
      if (!icon) continue;
      const count = this.ballTypeCounts[key] || 0;
      const bt = BALL_TYPES[key];
      const colorStr = '#' + bt.color.toString(16).padStart(6, '0');
      icon.text.setText(`[${i + 1}] ${bt.label}\n×${count}`);
      icon.text.setColor(colorStr);

      if (count <= 0) {
        icon.bg.setFillStyle(0x111111);
        icon.bg.setStrokeStyle(2, 0x333333);
        icon.text.setAlpha(0.4);
      } else if (key === this.ballType) {
        icon.bg.setFillStyle(0x444466);
        icon.bg.setStrokeStyle(2, 0xffff00);
        icon.text.setAlpha(1);
      } else {
        icon.bg.setFillStyle(0x222233);
        icon.bg.setStrokeStyle(2, 0x555566);
        icon.text.setAlpha(0.8);
      }
    }
  }

  // ── 统一HP条（所有关卡）──────────────────────────────────────────────────
  private createMonsterHpBar() {
    const barW = 300;
    const barX = GAME_W / 2;
    const barY = 16;

    const label = this.level === 1 ? '赌场老板' : (this.level === 2 ? '赌场老板·暴怒' : '怪物生命');
    this.monsterHpText = this.add.text(barX, barY, label, {
      fontSize: '12px', color: '#ff6666',
    }).setOrigin(0.5, 0).setDepth(20);

    this.monsterHpBarBg = this.add.rectangle(barX, barY + 16, barW + 4, 12, 0x333333);
    this.monsterHpBarBg.setStrokeStyle(1, 0x666666);
    this.monsterHpBarBg.setDepth(20);

    this.monsterHpBar = this.add.rectangle(barX - barW / 2, barY + 16, barW, 10, 0xff3333);
    this.monsterHpBar.setOrigin(0, 0.5);
    this.monsterHpBar.setDepth(21);
  }

  private updateMonsterHpBar() {
    const barW = 300;
    let ratio = 0;
    let label = '';

    // 所有关卡统一使用 bossHp / bossMaxHp
    ratio = this.bossMaxHp > 0 ? this.bossHp / this.bossMaxHp : 0;

    if (this.level === 3) {
      label = `怪物生命 ${Math.round(ratio * 100)}%`;
      if (this.heartExposed) {
        this.monsterHpBar.setFillStyle(0xff0000);
        this.monsterHpText.setColor('#ff3333');
      } else if (ratio < 0.3) {
        this.monsterHpBar.setFillStyle(0xff6600);
      } else {
        this.monsterHpBar.setFillStyle(0xff3333);
      }
    } else {
      label = `${this.level === 1 ? '赌场老板' : '赌场老板·暴怒'} ${Math.round(ratio * 100)}%`;
      if (ratio < 0.3) {
        this.monsterHpBar.setFillStyle(0xff6600);
      } else {
        this.monsterHpBar.setFillStyle(0xff3333);
      }
    }

    this.monsterHpBar.width = Math.max(0, ratio * barW);
    this.monsterHpText.setText(label);
  }

  private setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    // 挡板移动键：左挡板 W上/S下，右挡板 ↑上/↓下
    this.wKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.sKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.upKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.downKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    // 弹珠切换键（L2/L3）
    if (this.level >= 2) {
      this.key1 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ONE);
      this.key2 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TWO);
      if (this.level === 3) {
        this.key3 = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.THREE);
      }
    }
  }

  // ── 更新逻辑 ────────────────────────────────────────────────────────────

  private handleInput(delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    this.leftFlipperActive = this.cursors.left?.isDown ?? false;
    this.rightFlipperActive = this.cursors.right?.isDown ?? false;

    // 挡板上下移动：左挡板 W(上) S(下)，右挡板 ↑(上) ↓(下)
    const moveStep = FLIPPER_MOVE_SPEED * (delta / 1000);
    if (this.wKey.isDown) {
      this.leftFlipperY = Math.max(FLIPPER_MIN_Y, this.leftFlipperY - moveStep);
    }
    if (this.sKey.isDown) {
      this.leftFlipperY = Math.min(FLIPPER_MAX_Y, this.leftFlipperY + moveStep);
    }
    if (this.upKey.isDown) {
      this.rightFlipperY = Math.max(FLIPPER_MIN_Y, this.rightFlipperY - moveStep);
    }
    if (this.downKey.isDown) {
      this.rightFlipperY = Math.min(FLIPPER_MAX_Y, this.rightFlipperY + moveStep);
    }

    // 弹珠款式切换（L2/L3，仅在发射台蓄力时）
    if (this.level >= 2 && this.isLaunching) {
      const keys = Object.keys(this.ballTypeCounts);
      if (Phaser.Input.Keyboard.JustDown(this.key1) && keys[0]) {
        this.switchBallType(keys[0]);
      } else if (Phaser.Input.Keyboard.JustDown(this.key2) && keys[1]) {
        this.switchBallType(keys[1]);
      } else if (this.level === 3 && Phaser.Input.Keyboard.JustDown(this.key3) && keys[2]) {
        this.switchBallType(keys[2]);
      }
    }

    if (this.isLaunching) {
      if (this.spaceKey.isDown) {
        this.launchReady = true;
        this.launchPower = Math.min(LAUNCH_MAX_POWER, this.launchPower + delta * 0.1);
      } else if (this.launchPower > 0 && this.launchReady) {
        // 只有先按下空格蓄力后松开才发射（防止场景重启时残留状态自动发射）
        this.launchBall();
      } else {
        // 空格未按下且未蓄力，重置标志
        this.launchReady = false;
      }
    }
  }

  private updateFlippers() {
    // 更新挡板显示位置
    this.leftFlipper.setY(this.leftFlipperY);
    this.rightFlipper.setY(this.rightFlipperY);

    // 左挡板
    const leftTarget = this.leftFlipperActive ? FLIPPER_ACTIVE_ANGLE : FLIPPER_REST_ANGLE;
    const newLeftAngle = Phaser.Math.Linear(this.leftFlipper.angle, leftTarget, FLIPPER_SWING_LERP);
    const leftAngularVel = newLeftAngle - this.leftFlipper.angle;
    this.leftFlipper.setAngle(newLeftAngle);

    // 右挡板
    const rightTarget = this.rightFlipperActive ? -FLIPPER_ACTIVE_ANGLE : -FLIPPER_REST_ANGLE;
    const newRightAngle = Phaser.Math.Linear(this.rightFlipper.angle, rightTarget, FLIPPER_SWING_LERP);
    const rightAngularVel = newRightAngle - this.rightFlipper.angle;
    this.rightFlipper.setAngle(newRightAngle);

    // 手动碰撞检测（Arcade Physics 不支持旋转体碰撞）
    if (!this.isLaunching && !this.isDead && !this.isWon) {
      this.checkFlipperCollision(
        FLIPPER_LEFT_X, this.leftFlipperY,
        newLeftAngle, true,
        this.leftFlipperActive, leftAngularVel
      );
      this.checkFlipperCollision(
        FLIPPER_RIGHT_X, this.rightFlipperY,
        newRightAngle, false,
        this.rightFlipperActive, rightAngularVel
      );
    }
  }

  // ── 手动挡板碰撞检测 ────────────────────────────────────────────────────
  // 将挡板视为一条线段（pivot → tip），计算球到线段的最近距离
  // 若距离 < 碰撞半径，则沿法线方向反弹球
  private checkFlipperCollision(
    pivotX: number, pivotY: number,
    angle: number,
    isLeft: boolean,
    isActive: boolean,
    angularVel: number
  ): void {
    // 主球碰撞
    this.checkFlipperBallCollision(pivotX, pivotY, angle, isLeft, isActive, angularVel, this.ball, this.ballBody, false);

    // 额外球碰撞
    for (const eb of this.extraBalls) {
      if (eb.obj.active && eb.obj.visible) {
        this.checkFlipperBallCollision(pivotX, pivotY, angle, isLeft, isActive, angularVel, eb.obj, eb.body, true);
      }
    }
  }

  private checkFlipperBallCollision(
    pivotX: number, pivotY: number,
    angle: number,
    isLeft: boolean,
    isActive: boolean,
    angularVel: number,
    ballObj: Phaser.GameObjects.Arc,
    ballBody: Phaser.Physics.Arcade.Body,
    isExtra: boolean
  ): void {
    const rad = Phaser.Math.DegToRad(angle);

    // 计算挡板尖端位置
    let tipX: number, tipY: number;
    if (isLeft) {
      tipX = pivotX + Math.cos(rad) * FLIPPER_W;
      tipY = pivotY + Math.sin(rad) * FLIPPER_W;
    } else {
      tipX = pivotX - Math.cos(rad) * FLIPPER_W;
      tipY = pivotY - Math.sin(rad) * FLIPPER_W;
    }

    const fx = tipX - pivotX;
    const fy = tipY - pivotY;
    const fLen2 = fx * fx + fy * fy;

    const bx = ballObj.x - pivotX;
    const by = ballObj.y - pivotY;
    let t = (bx * fx + by * fy) / fLen2;
    t = Math.max(0, Math.min(1, t));

    const closestX = pivotX + fx * t;
    const closestY = pivotY + fy * t;

    const dx = ballObj.x - closestX;
    const dy = ballObj.y - closestY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const ballR = isExtra ? BALL_TYPES[BALL_TYPE_SPLIT].radius : BALL_TYPES[this.ballType].radius;
    const collisionRadius = ballR + FLIPPER_H / 2;

    if (dist < collisionRadius && dist > 0.01) {
      const nx = dx / dist;
      const ny = dy / dist;

      const overlap = collisionRadius - dist + 1;
      ballObj.x += nx * overlap;
      ballObj.y += ny * overlap;

      const vx = ballBody.velocity.x;
      const vy = ballBody.velocity.y;
      const dot = vx * nx + vy * ny;

      if (dot < 0) {
        let bouncePower = FLIPPER_BOUNCE_PASSIVE;
        if (isActive) {
          bouncePower = FLIPPER_BOUNCE_ACTIVE;
        }
        const swingSpeed = Math.abs(angularVel);
        if (swingSpeed > 0.5) {
          bouncePower += FLIPPER_FLICK_BONUS * Math.min(1, swingSpeed / 15);
        }

        ballBody.setVelocity(
          vx - 2 * dot * nx + nx * bouncePower,
          vy - 2 * dot * ny + ny * bouncePower
        );
        if (isExtra) {
          this.damageExtraBall(this.findExtraBall(ballObj), 1);
        } else {
          this.damageBall(1);
        }
      }
    }
  }

  private launchBall() {
    this.isLaunching = false;
    this.ballBody.setAllowGravity(true);
    const power = this.launchPower * 9;
    this.ballBody.setVelocity(Phaser.Math.Between(-30, 30), -power);
    this.launchPower = 0;

    // 发射时消耗一颗当前款式的弹珠（L2/L3）
    if (this.level >= 2) {
      if (this.ballTypeCounts[this.ballType] > 0) {
        this.ballTypeCounts[this.ballType]--;
      }
      this.updateBallTypePanel();
      // 重置分裂标记
      this.ball.setData('hasBounced', false);
    }
  }

  private checkBallLost() {
    if (this.isLaunching) return;
    // 主球掉出
    if (this.ball.y > GAME_H + 20) {
      this.ballsLeft--;
      if (this.level >= 2) {
        // L2/L3：检查弹珠库存
        const totalLeft = Object.values(this.ballTypeCounts).reduce((a, b) => a + b, 0);
        if (totalLeft <= 0 && this.ballsLeft <= 0) {
          this.lose();
        } else if (this.ballsLeft <= 0) {
          this.lose();
        } else {
          this.resetBall();
        }
      } else {
        if (this.ballsLeft <= 0) {
          this.lose();
        } else {
          this.resetBall();
        }
      }
    }
  }

  private resetBall() {
    this.isLaunching = true;
    this.ball.setPosition(LAUNCH_X, LAUNCH_Y);
    this.ballBody.setVelocity(0, 0);
    this.ballBody.setAllowGravity(false);
    this.launchPower = 0;

    if (this.level >= 2) {
      // L2/L3：重置为默认弹珠款式（优先基础，其次有库存的）
      this.ballType = this.selectDefaultBallType();
      this.applyBallTypeProperties();
    } else {
      this.ballDurability = BALL_DURABILITY;
      this.ball.setFillStyle(0xeeeeee);
    }
    this.ball.setVisible(true);
    this.showMessage(`剩余 ${this.ballsLeft} 颗球`, 1500);
  }

  // ── 选择默认弹珠款式 ──────────────────────────────────────────────────
  private selectDefaultBallType(): string {
    if (this.ballTypeCounts[BALL_TYPE_BASIC] > 0) return BALL_TYPE_BASIC;
    if (this.ballTypeCounts[BALL_TYPE_FIRE] > 0) return BALL_TYPE_FIRE;
    if (this.ballTypeCounts[BALL_TYPE_SPLIT] > 0) return BALL_TYPE_SPLIT;
    return BALL_TYPE_BASIC;
  }

  // ── 第三关：应用弹珠款式属性 ──────────────────────────────────────────────
  private applyBallTypeProperties() {
    const bt = BALL_TYPES[this.ballType];
    this.ballDurability = bt.durability;
    // 更新球视觉
    this.ball.setRadius(bt.radius);
    this.ball.setFillStyle(bt.color);
    this.ball.setStrokeStyle(2, bt.stroke);
    // 更新物理属性
    this.ballBody.setCircle(bt.radius);
    this.ballBody.setBounce(bt.bounce);
  }

  // ── 多球系统：获取所有活跃球（主球+额外球）──────────────────────────────
  // ── 多球系统：分裂弹珠在第一次弹射时分裂 ─────────────────────────────────
  private trySplitBall(ballObj: Phaser.GameObjects.Arc, ballBdy: Phaser.Physics.Arcade.Body, ballType: string, isExtra: boolean): boolean {
    if (ballType !== BALL_TYPE_SPLIT) return false;

    // 主球：检查 hasBounced 标志（通过 data）
    // 额外球：检查 BallInfo.hasBounced
    let hasBounced: boolean;
    if (isExtra) {
      const eb = this.extraBalls.find(e => e.obj === ballObj);
      if (!eb) return false;
      hasBounced = eb.hasBounced;
      if (hasBounced) return false;  // 已经弹射过，不再分裂
      eb.hasBounced = true;
    } else {
      // 主球用 data 标记
      hasBounced = ballObj.getData('hasBounced') as boolean;
      if (hasBounced) return false;
      ballObj.setData('hasBounced', true);
    }

    // 分裂！创建2颗新球，每颗15耐久
    this.spawnSplitBall(ballObj, ballBdy, -1);
    this.spawnSplitBall(ballObj, ballBdy, 1);
    return true;
  }

  // ── 多球系统：生成分裂球 ─────────────────────────────────────────────────
  private spawnSplitBall(srcBall: Phaser.GameObjects.Arc, srcBody: Phaser.Physics.Arcade.Body, dir: number) {
    const splitDurability = 15;
    const bt = BALL_TYPES[BALL_TYPE_SPLIT];
    const newBall = this.add.circle(srcBall.x, srcBall.y, bt.radius, bt.color);
    newBall.setStrokeStyle(2, bt.stroke);
    newBall.setDepth(5);

    this.physics.add.existing(newBall, false);
    const newBody = newBall.body as Phaser.Physics.Arcade.Body;
    newBody.setCircle(bt.radius);
    newBody.setBounce(bt.bounce);
    newBody.setCollideWorldBounds(true);
    newBody.checkCollision.down = false;
    newBody.setAllowGravity(true);

    // 分裂球速度：源球速度的旋转±30°
    const vx = srcBody.velocity.x;
    const vy = srcBody.velocity.y;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const angle = Math.atan2(vy, vx) + dir * 0.5;  // ±约30°
    newBody.setVelocity(Math.cos(angle) * speed * 0.9, Math.sin(angle) * speed * 0.9);

    // 为分裂球添加与障碍物/Boss的碰撞
    this.setupExtraBallColliders(newBall, newBody);

    const ballInfo: BallInfo = {
      obj: newBall, body: newBody, type: BALL_TYPE_SPLIT,
      durability: splitDurability, maxDurability: splitDurability,
      hasBounced: true, isExtra: true,
    };
    this.extraBalls.push(ballInfo);
  }

  // ── 多球系统：为额外球设置碰撞器 ───────────────────────────────────────
  private setupExtraBallColliders(ballObj: Phaser.GameObjects.Arc, ballBody: Phaser.Physics.Arcade.Body) {
    // 与Boss碰撞
    if (this.boss && this.boss.body) {
      this.physics.add.overlap(ballObj, this.boss, () => {
        if (this.level === 3) {
          // L3: 心脏碰撞
          if (this.heartHitCooldown > 0) return;
          this.heartHitCooldown = HEART_HIT_COOLDOWN;
          // ── 音效：心脏命中 ──
          this.playHeartHitSound();
          this.heartHp -= HEART_BOSS_DAMAGE;
          this.bossHp -= HEART_BOSS_DAMAGE;
          this.score += HEART_HIT_SCORE;
          this.damageExtraBall(this.findExtraBall(ballObj), 1);
          // 反弹
          const dx = ballObj.x - BOSS_X;
          const dy = ballObj.y - BOSS_Y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0) {
            ballBody.setVelocity((dx / dist) * 450, (dy / dist) * 450);
          }
          this.boss.setFillStyle(0xff6666);
          this.time.delayedCall(150, () => {
            this.boss.setFillStyle(0x440011);
          });
          if (this.heartHp <= 0) {
            this.boss.setVisible(false);
            this.bossEyeLeft.setVisible(false);
            this.bossEyeRight.setVisible(false);
            this.bossMouth.setVisible(false);
            this.bossHpBar.setVisible(false);
            this.bossHpBarBg.setVisible(false);
            this.bossNameText.setVisible(false);
            this.heartProtectShield.setVisible(false);
            this.clearLevel();
          }
        } else {
          // L1/L2: Boss碰撞
          if (this.bossHitCooldown > 0) return;
          this.bossHitCooldown = BOSS_HIT_COOLDOWN;
          // ── 音效：Boss命中 ──
          this.playBossHitSound();
          this.bossHp -= DIRECT_BOSS_DAMAGE;
          this.score += BOSS_HIT_SCORE;
          this.damageExtraBall(this.findExtraBall(ballObj), 1);
          const dx = ballObj.x - BOSS_X;
          const dy = ballObj.y - BOSS_Y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0) {
            ballBody.setVelocity((dx / dist) * 450, (dy / dist) * 450);
          }
          this.boss.setFillStyle(0xff6666);
          this.time.delayedCall(150, () => {
            this.boss.setFillStyle(this.level === 1 ? 0x440011 : 0x110044);
          });
          this.bossHpBar.width = Math.max(0, (this.bossHp / this.bossMaxHp) * 100);
          if (this.bossHp <= 0) {
            this.clearLevel();
          }
        }
      });
    }

    // 与bumper碰撞
    for (const b of this.bumpers) {
      this.physics.add.collider(ballObj, b.obj, () => {
        if (!this.canHitObstacle(b.obj)) return;
        const organ = b.obj.getData('organRef') as Organ | null;
        // ── 音效 ──
        this.playCollisionSound(organ);
        // 弹射
        const angle = Phaser.Math.Angle.Between(b.obj.x, b.obj.y, ballObj.x, ballObj.y);
        b.pupil.x = b.obj.x + Math.cos(angle) * 8;
        b.pupil.y = b.obj.y + Math.sin(angle) * 8;
        const dx = ballObj.x - b.obj.x;
        const dy = ballObj.y - b.obj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          let vx = (dx / dist) * BUMPER_BOUNCE;
          let vy = (dy / dist) * BUMPER_BOUNCE;
          // 防止球在bumper正上方永久垂直弹跳
          if (Math.abs(vx) < 80) {
            vx = (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 80);
          }
          ballBody.setVelocity(vx, vy);
        }
        if (organ && !organ.destroyed && !organ.darkened) {
          const damage = this.getBallDamage();
          organ.hp -= damage;
          this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
          this.score += BUMPER_SCORE;
          this.damageExtraBall(this.findExtraBall(ballObj), 1);
          this.applyBallEffects(organ);
          b.obj.setFillStyle(0xff6666);
          this.time.delayedCall(100, () => {
            if (!organ.destroyed) b.obj.setFillStyle(0xffffff);
          });
          this.updateOrganHpBar(organ);
          if (organ.hp <= 0) this.destroyOrgan(organ);
        }
      });
    }

    // 与nail碰撞
    for (const n of this.nails) {
      this.physics.add.collider(ballObj, n, () => {
        if (!this.canHitObstacle(n)) return;
        const organ = n.getData('organRef') as Organ | null;
        // ── 音效 ──
        this.playCollisionSound(organ);
        const dx = ballObj.x - n.x;
        const dy = ballObj.y - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          ballBody.setVelocity(
            (dx / dist) * 250 + ballBody.velocity.x * 0.3,
            (dy / dist) * 250 + ballBody.velocity.y * 0.3
          );
        }
        if (organ && !organ.destroyed && !organ.darkened) {
          const damage = this.getBallDamage();
          organ.hp -= damage;
          this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
          this.score += NAIL_SCORE;
          this.damageExtraBall(this.findExtraBall(ballObj), 1);
          this.applyBallEffects(organ);
          n.setFillStyle(0xcccccc);
          this.time.delayedCall(50, () => {
            if (!organ.destroyed) n.setFillStyle(0xaaaaaa);
          });
          this.updateOrganHpBar(organ);
          if (organ.hp <= 0) this.destroyOrgan(organ);
        }
      });
    }

    // 与slingshot碰撞
    for (const s of this.slingshots) {
      this.physics.add.collider(ballObj, s, () => {
        if (!this.canHitObstacle(s)) return;
        const organ = s.getData('organRef') as Organ | null;
        // ── 音效 ──
        this.playCollisionSound(organ);
        const dir = s.x < GAME_W / 2 ? 1 : -1;
        ballBody.setVelocity(dir * 200, -500);
        if (organ && !organ.destroyed && !organ.darkened) {
          const damage = this.getBallDamage();
          organ.hp -= damage;
          this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
          this.score += SLINGSHOT_SCORE;
          this.damageExtraBall(this.findExtraBall(ballObj), 1);
          this.applyBallEffects(organ);
          s.setFillStyle(0x6644ff);
          this.time.delayedCall(100, () => {
            if (!organ.destroyed) s.setFillStyle(0x4422aa);
          });
          this.updateOrganHpBar(organ);
          if (organ.hp <= 0) this.destroyOrgan(organ);
        }
      });
    }

    // 与grotesque碰撞
    for (const g of this.grotesques) {
      this.physics.add.collider(ballObj, g, () => {
        if (!this.canHitObstacle(g)) return;
        const organ = g.getData('organRef') as Organ | null;
        // ── 音效 ──
        this.playCollisionSound(organ);
        const dx = ballObj.x - g.x;
        const dist = Math.max(1, Math.abs(dx));
        let vx = (dx / dist) * 200;
        // 防止球在grotesque正上方永久垂直弹跳
        if (Math.abs(vx) < 80) {
          vx = (Math.random() < 0.5 ? -1 : 1) * (80 + Math.random() * 80);
        }
        ballBody.setVelocity(vx, -GROTESQUE_BOUNCE_VEL);
        if (organ && !organ.destroyed && !organ.darkened) {
          const damage = this.getBallDamage();
          organ.hp -= damage;
          this.damageBossFromOrgan(ORGAN_BOSS_DAMAGE);
          this.score += GROTESQUE_SCORE;
          this.damageExtraBall(this.findExtraBall(ballObj), 1);
          this.applyBallEffects(organ);
          this.updateOrganHpBar(organ);
          if (organ.hp <= 0) this.destroyOrgan(organ);
        }
      });
    }
  }

  // ── 多球系统：查找额外球 ───────────────────────────────────────────────
  private findExtraBall(obj: Phaser.GameObjects.Arc): BallInfo {
    return this.extraBalls.find(e => e.obj === obj) || this.extraBalls[0];
  }

  // ── 多球系统：更新额外球（耐久、碰撞、掉落检测）────────────────────────
  private updateExtraBalls(_delta: number) {
    for (let i = this.extraBalls.length - 1; i >= 0; i--) {
      const eb = this.extraBalls[i];
      if (!eb.obj.active || !eb.obj.visible) {
        this.extraBalls.splice(i, 1);
        continue;
      }

      // 掉出屏幕
      if (eb.obj.y > GAME_H + 20) {
        eb.obj.destroy();
        this.extraBalls.splice(i, 1);
        continue;
      }

      // 防卡关
      const speed = Math.sqrt(eb.body.velocity.x ** 2 + eb.body.velocity.y ** 2);
      if (speed < MIN_BALL_SPEED) {
        eb.body.setVelocity(
          eb.body.velocity.x + Phaser.Math.FloatBetween(-50, 50),
          eb.body.velocity.y - 200
        );
      }
    }
  }

  // ── 多球系统：额外球耐久扣减 ─────────────────────────────────────────────
  private damageExtraBall(eb: BallInfo, amount: number) {
    eb.durability -= amount;
    const ratio = eb.durability / eb.maxDurability;
    if (ratio > 0.66) {
      eb.obj.setFillStyle(BALL_TYPES[BALL_TYPE_SPLIT].color);
    } else if (ratio > 0.33) {
      eb.obj.setFillStyle(0x884422);
    } else {
      eb.obj.setFillStyle(0x442211);
    }
    if (eb.durability <= 0) {
      eb.durability = 0;
      eb.obj.setVisible(false);
      eb.body.setVelocity(0, 0);
      eb.body.setAllowGravity(false);
      eb.obj.setPosition(LAUNCH_X, LAUNCH_Y);
      // 从额外球列表移除
      const idx = this.extraBalls.indexOf(eb);
      if (idx >= 0) {
        this.extraBalls.splice(idx, 1);
        eb.obj.destroy();
      }
    }
  }

  // 同一障碍物连续碰撞冷却，防止球卡住时耐久度秒空
  private canHitObstacle(obj: Phaser.GameObjects.GameObject): boolean {
    const now = this.time.now;
    const last = obj.getData('lastHit') as number;
    // last 为 undefined（首次碰撞）或 now - last >= 冷却时间时允许
    if (last !== undefined && now - last < OBSTACLE_HIT_COOLDOWN) return false;
    obj.setData('lastHit', now);
    return true;
  }

  private damageBall(amount: number) {
    if (this.isLaunching) return;  // 球在发射台上不扣耐久
    this.ballDurability -= amount;

    // L2/L3：颜色基于当前弹珠款式
    if (this.level >= 2) {
      const bt = BALL_TYPES[this.ballType];
      const ratio = this.ballDurability / bt.durability;
      if (ratio > 0.66) {
        this.ball.setFillStyle(bt.color);
      } else if (ratio > 0.33) {
        // 变暗
        this.ball.setFillStyle(0x884422);
      } else {
        this.ball.setFillStyle(0x442211);
      }
    } else {
      const ratio = this.ballDurability / BALL_DURABILITY;
      if (ratio > 0.66) {
        this.ball.setFillStyle(0xeeeeee);
      } else if (ratio > 0.33) {
        this.ball.setFillStyle(0xccaa44);
      } else {
        this.ball.setFillStyle(0x884422);
      }
    }

    if (this.ballDurability <= 0) {
      this.ballDurability = 0;
      this.isLaunching = true;
      this.ball.setVisible(false);
      this.ballBody.setVelocity(0, 0);
      this.ballBody.setAllowGravity(false);
      this.ball.setPosition(LAUNCH_X, LAUNCH_Y);
      this.ballsLeft--;
      // L2/L3：检查弹珠库存
      if (this.level >= 2) {
        const totalLeft = Object.values(this.ballTypeCounts).reduce((a, b) => a + b, 0);
        if (totalLeft <= 0 && this.ballsLeft <= 0) {
          this.lose();
        } else if (this.ballsLeft <= 0) {
          this.lose();
        } else {
          this.time.delayedCall(800, () => this.resetBall());
        }
      } else {
        if (this.ballsLeft <= 0) {
          this.lose();
        } else {
          this.time.delayedCall(800, () => this.resetBall());
        }
      }
    }
  }

  private updateUI() {
    this.scoreText.setText(`分数: ${this.score}`);
    this.ballsText.setText(`球: ${this.ballsLeft}`);

    // L2/L3：耐久显示基于当前弹珠款式
    if (this.level >= 2) {
      const bt = BALL_TYPES[this.ballType];
      const maxDur = bt.durability;
      this.durabilityText.setText(`[${bt.label}] 耐久: ${Math.max(0, this.ballDurability)}/${maxDur}`);
      this.durabilityText.setColor(
        this.ballDurability < maxDur * 0.25 ? '#ff4444' :
        (this.ballDurability < maxDur * 0.5 ? '#ffaa44' : '#ffcc66')
      );
      this.updateBallTypePanel();
    } else {
      this.durabilityText.setText(`耐久: ${Math.max(0, this.ballDurability)}/${BALL_DURABILITY}`);
      this.durabilityText.setColor(
        this.ballDurability < 10 ? '#ff4444' :
        (this.ballDurability < 20 ? '#ffaa44' : '#ffcc66')
      );
    }

    const powerWidth = (this.launchPower / LAUNCH_MAX_POWER) * 200;
    this.powerBar.width = powerWidth;
    this.powerBar.setFillStyle(this.launchPower > 80 ? 0xff0000 : 0x00ff00);
  }

  // ── 胜负 ────────────────────────────────────────────────────────────────

  private clearLevel() {
    if (this.levelClear) return;
    this.levelClear = true;
    this.cameras.main.flash(500, 255, 255, 255);

    // ── 音效：关卡结束时播放古神低语 ──
    this.sound.play('whisper', { volume: 0.6 });

    // 清除所有子弹
    for (const bullet of this.bullets) {
      bullet.destroy();
    }
    this.bullets = [];

    if (this.level === 1) {
      this.showMessage(
        '🎉 第一关通过！\n\n按 Enter 进入第二关\n或按 ESC 返回菜单',
        999999
      );
    } else if (this.level === 2) {
      this.showMessage(
        '🎉 第二关通过！\n\n按 Enter 进入第三关\n或按 ESC 返回菜单',
        999999
      );
    } else {
      this.showMessage(
        '🎉🎉🎉 第三关通过！\n你击碎了怪物的核心！\n\n按 ESC 返回菜单',
        999999
      );
    }
  }

  private win() {
    if (this.isWon) return;
    this.isWon = true;
    this.cameras.main.flash(500, 255, 255, 255);

    // ── 音效：胜利 ──
    if (this.bgm && this.bgm.isPlaying) this.bgm.stop();
    this.sound.play('victory', { volume: 0.7 });

    this.showMessage(
      '🎉🎉 你彻底逃脱了赌场的诅咒！\n\n按ESC返回菜单',
      999999
    );
  }

  private lose() {
    if (this.isDead) return;
    this.isDead = true;
    this.cameras.main.shake(500, 0.03);
    this.showMessage(
      '💀 球用完了，你永远留在了这里……\n\n按ESC返回菜单',
      999999
    );
  }

  // ── 辅助方法 ────────────────────────────────────────────────────────────

  private showMessage(text: string, duration: number = 2000) {
    // 取消上一个消息定时器，防止旧定时器把通关消息隐藏
    if (this.messageTimer) {
      this.messageTimer.remove();
      this.messageTimer = undefined;
    }
    this.messageText.setText(text);
    this.messageText.setVisible(true);
    if (duration < 999999) {
      this.messageTimer = this.time.delayedCall(duration, () => {
        this.messageText.setVisible(false);
        this.messageTimer = undefined;
      });
    }
  }

  private showFloatingText(x: number, y: number, text: string, color: string) {
    const floatingText = this.add.text(x, y, text, {
      fontSize: '20px', color: color, fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(25);

    this.tweens.add({
      targets: floatingText,
      y: y - 50,
      alpha: 0,
      duration: 1000,
      onComplete: () => floatingText.destroy(),
    });
  }
}
