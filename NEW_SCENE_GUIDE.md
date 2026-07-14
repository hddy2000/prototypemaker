# 新建场景通用规则指南

> 每次创建新的 Prototype 场景时，**必须**参考本文档，确保遵循所有约定。

---

## 1. 文件与注册

### 1.1 创建场景文件
- 路径：`src/scenes/XxxScene.ts`
- 类名：`export class XxxScene extends Phaser.Scene`
- 构造函数必须指定 key：
  ```typescript
  constructor() {
    super({ key: 'XxxScene' });
  }
  ```

### 1.2 注册到 main.ts
- 在 `src/main.ts` 顶部添加 import
- 在 `scene: [...]` 数组中追加新场景类

### 1.3 注册到菜单 MenuScene.ts
- 在 `prototypes` 数组中添加条目（放在 `// Add new prototypes here` 注释之前）：
  ```typescript
  {
    key: 'XxxScene',
    name: '中文名',
    description: '一句话描述核心玩法和操作提示',
  },
  ```
- 如果场景需要专属说明页（复杂机制），在 MenuScene 中添加 `showXxxIntro()` 方法，并在 `launchScene` 和 `enterKey` 两处加入条件分支

---

## 2. 返回菜单（必须！）

每个场景**必须**提供两种返回菜单的方式：

### 2.1 ESC 键
```typescript
// 在 update() 最前面检测
if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
  this.scene.start('MenuScene');
  return;
}
```

### 2.2 可见的"← 菜单"按钮
```typescript
const backBtn = this.add.text(680, 16, '← 菜单', {
  fontSize: '18px', color: '#ffffff', backgroundColor: '#333333',
  padding: { x: 10, y: 5 },
}).setInteractive({ useHandCursor: true }).setScrollFactor(0).setDepth(20);

backBtn.on('pointerdown', () => this.scene.start('MenuScene'));
```

---

## 3. 场景生命周期 — 状态重置

### 3.1 create() 中重置所有实例属性
Phaser 的 `scene.start()` 会复用同一个场景对象，**所有**数组、计数器、标志位必须在 `create()` 开头重置：
```typescript
create() {
  // ⚠️ 必须在最前面重置，否则重启场景会有幽灵引用
  this.monsters = [];
  this.treasures = [];
  this.obstacles = [];
  this.isDead = false;
  this.isEscaped = false;
  this.money = 0;
  // ... 所有其他属性

  this.cam = this.cameras.main;
  this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);
  // ... 后续初始化
}
```

### 3.2 死亡/胜利后阻止 update
```typescript
update(_time: number, delta: number) {
  if (this.isDead || this.isEscaped) return;
  // ... 正常逻辑
}
```

---

## 4. 摄像机与地图

### 4.1 标准摄像机设置
```typescript
this.cam = this.cameras.main;
this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);
// ... 创建玩家后
this.cam.startFollow(this.player, true, 0.1, 0.1);
```

### 4.2 标准地图尺寸
- 大地图场景：`mapWidth = 2400`, `mapHeight = 1600`
- 小地图/室内场景：按需调整（如 `900×700`）
- 游戏画布固定 `800×600`

### 4.3 边界墙（必须）
```typescript
// 四面边界墙
this.obstacles.push({ x: 0, y: 0, w: this.mapWidth, h: 20 });
this.obstacles.push({ x: 0, y: this.mapHeight - 20, w: this.mapWidth, h: 20 });
this.obstacles.push({ x: 0, y: 0, w: 20, h: this.mapHeight });
this.obstacles.push({ x: this.mapWidth - 20, y: 0, w: 20, h: this.mapHeight });
```

---

## 5. UI 元素规范

### 5.1 固定到屏幕
所有 UI 元素必须设置：
```typescript
.setScrollFactor(0)   // 不随摄像机滚动
.setDepth(20)         // 在游戏对象之上（雾之上用更高 depth）
```

### 5.2 标准 UI 布局
- 左上角：状态信息（生命、分数等） — `x: 16, y: 16` 起
- 右上角：返回菜单按钮 — `x: 680, y: 16`
- 底部中央：操作提示 — `x: 400, y: 585`
- 中央偏下：消息提示 — `x: 400, y: 500`

### 5.3 消息提示系统
```typescript
// createUI 中创建
this.messageText = this.add.text(400, 500, '', {
  fontSize: '22px', color: '#ffffff', align: 'center',
  backgroundColor: '#000000', padding: { x: 16, y: 8 },
}).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);

// 使用
private showMessage(text: string, duration = 3000) {
  this.messageText.setText(text).setVisible(true);
  if (duration < 999999) {
    this.time.delayedCall(duration, () => this.hideMessage());
  }
}
private hideMessage() {
  this.messageText.setVisible(false);
}
```

### 5.4 死亡/胜利消息格式
```typescript
// 死亡
this.showMessage(`💀 ${cause}\n\n按ESC返回菜单`, 999999);
// 胜利
this.showMessage(`🎉 通关！\n总计: $${this.money}\n\n按ESC返回菜单`, 999999);
```

---

## 6. 输入设置

### 6.1 标准键位绑定
```typescript
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
  // 按需添加 E, Q 等交互键
}
```

### 6.2 键位约定
| 按键 | 用途 |
|------|------|
| WASD / 方向键 | 移动 |
| 空格 | 主要动作（射击/声波/拾取等） |
| E | 交互（躲藏/开门/拾取/复活） |
| Shift | 冲刺/疾跑 |
| ESC | 返回菜单 |
| Q | 次要动作（丢弃等） |
| 鼠标左键 | 射击/喷射 |
| 鼠标右键 | 取消/止损 |

> **禁止**用不直观的键位（如 `I`）做核心操作。优先使用空格、E 等顺手键。

---

## 7. 战争迷雾（Fog of War）

### 7.1 标准初始化模式
```typescript
private fogTextureKey = 'xxxSceneFog';  // 每个场景用唯一 key！

// create() 中：
if (this.textures.exists(this.fogTextureKey)) {
  this.textures.remove(this.fogTextureKey);
}
this.fogCanvas = document.createElement('canvas');
this.fogCanvas.width = this.screenW;   // 800
this.fogCanvas.height = this.screenH;  // 600
this.fogCtx = this.fogCanvas.getContext('2d')!;
this.textures.addCanvas(this.fogTextureKey, this.fogCanvas);
this.fogImage = this.add.image(0, 0, this.fogTextureKey)
  .setOrigin(0, 0)
  .setScrollFactor(0)
  .setDepth(10);
```

### 7.2 ⚠️ WebGL 纹理上传（关键！）
Phaser 3.90 的 `CanvasTexture.refresh()` **不会**把 canvas 数据上传到 WebGL 纹理。必须手动上传：
```typescript
private updateFogTexture() {
  const gl = (this.game.renderer as any).gl;
  const source = this.fogImage.texture.source[0];
  const webGLTexture = source.glTexture.webGLTexture;
  gl.bindTexture(gl.TEXTURE_2D, webGLTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fogCanvas);
}
```
每次修改 `fogCtx` 后**必须**调用此方法。

### 7.3 迷雾绘制技巧
- 用 `destination-out` 合成模式"擦除"迷雾来显示视野
- `RenderTexture.erase()` 在 WebGL 下**不工作**，不要用
- `BitmapMask` + `invertAlpha` 不可靠，不要用

---

## 8. 怪物 AI 通用模式

### 8.1 标准状态机
```typescript
interface Monster {
  sprite: Phaser.GameObjects.Rectangle;
  speed: number;           // 巡逻速度
  chaseSpeed: number;      // 追击速度
  direction: Phaser.Math.Vector2;
  patrolTimer: number;     // 巡逻方向切换计时
  isChasing: boolean;
  visionRange: number;     // 视野距离
  homeX: number;           // 巡逻中心点
  homeY: number;
  territoryRadius: number; // 最大巡逻半径
  giveUpTimer: number;     // 丢失目标后的追击剩余时间
  giveUpDuration: number;  // 追击持续时间（通常 3000-5000ms）
  alive: boolean;
}
```

### 8.2 AI 行为
- **巡逻**：随机方向移动，`patrolTimer` 到期换方向
- **追击**：发现玩家后 `isChasing = true`，用 `chaseSpeed` 追击
- **放弃**：丢失视野后 `giveUpTimer` 倒计时，归零则回巡逻
- **领地**：超出 `territoryRadius` 则放弃追击回家

---

## 9. Phaser 3.90 已知坑

| 问题 | 说明 | 解决方案 |
|------|------|----------|
| `CanvasTexture.refresh()` | 不上传 WebGL 纹理 | 手动 `gl.texImage2D()` |
| `RenderTexture.erase()` | WebGL 下无效 | 用 Canvas + `destination-out` + 手动上传 |
| `BitmapMask` + `invertAlpha` | 不可靠 | 不用，改用 fog canvas 方案 |
| `Graphics` even-odd fill | 无法挖洞 | 不用，改用 fog canvas 方案 |
| `textures.addCanvas()` 重复 key | 场景重启时警告 | 先 `textures.exists()` + `textures.remove()` |
| `scene.start()` 复用对象 | 数组/计数器残留 | `create()` 开头全部重置 |
| Text 纹理销毁 | 场景关闭后引用失效 | 不要保留跨场景的 Text 引用 |
| `setText()` 性能 | 每次调用重渲染纹理 | 用 `if (obj.text !== newText)` 包裹 |

---

## 10. 性能注意事项

- **setText 节流**：`setText()` 触发纹理重渲染，高频更新的文本（如坐标、计时器）用变化检测包裹：
  ```typescript
  const newText = `生命: ${this.health}`;
  if (this.healthText.text !== newText) this.healthText.setText(newText);
  ```
- **节流频率参考**：移动 20Hz、UI 10Hz、体力 15Hz
- **碰撞检测**：大地图用空间网格（200px cells），不要线性扫描

---

## 11. 场景模板骨架

```typescript
import Phaser from 'phaser';

interface Obstacle { x: number; y: number; w: number; h: number; }

export class XxxScene extends Phaser.Scene {
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

  // Camera
  private cam!: Phaser.Cameras.Scene2D.Camera;

  // State
  private isDead = false;
  private isEscaped = false;

  // UI
  private messageText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'XxxScene' });
  }

  create() {
    // ⚠️ 重置所有状态
    this.obstacles = [];
    this.isDead = false;
    this.isEscaped = false;

    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.generateMap();
    this.createPlayer();
    this.createUI();
    this.setupInput();

    this.cam.startFollow(this.player, true, 0.1, 0.1);
    this.showMessage('场景名\n操作提示');
    this.time.delayedCall(3000, () => this.hideMessage());
  }

  update(_time: number, delta: number) {
    if (this.isDead || this.isEscaped) return;
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }
    // ... 游戏逻辑
  }

  private generateMap() { /* 边界墙 + 随机障碍 */ }
  private createPlayer() { /* 玩家对象 */ }
  private createUI() { /* 固定 UI + 返回按钮 + 消息文本 */ }
  private setupInput() { /* 键位绑定 */ }
  private showMessage(text: string, duration = 3000) { /* ... */ }
  private hideMessage() { /* ... */ }
}
```

---

## 12. 检查清单

创建新场景后，逐项确认：

- [ ] `src/scenes/XxxScene.ts` 文件已创建，class 导出正确
- [ ] `src/main.ts` 已 import 并添加到 scene 数组
- [ ] `MenuScene.ts` 已添加 prototypes 条目
- [ ] ESC 键可返回菜单
- [ ] 可见的"← 菜单"按钮存在且可点击
- [ ] `create()` 开头重置了所有数组和状态变量
- [ ] UI 元素都设置了 `setScrollFactor(0)` 和合适的 `setDepth`
- [ ] 死亡/胜利消息包含"按ESC返回菜单"提示
- [ ] 如使用迷雾：fog texture key 唯一，且手动 WebGL 上传
- [ ] 如使用 `textures.addCanvas()`：先检查 `exists` + `remove`
- [ ] 高频 `setText` 已加变化检测
- [ ] 键位符合约定（WASD移动、空格主动作、E交互、Shift冲刺）
