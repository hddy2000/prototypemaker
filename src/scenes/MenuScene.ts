import Phaser from 'phaser';

interface PrototypeItem {
  key: string;
  name: string;
  description: string;
}

export class MenuScene extends Phaser.Scene {
  private prototypes: PrototypeItem[] = [
    {
      key: 'MazeScene',
      name: '宝藏迷宫',
      description: '用探测器找宝藏，躲避怪物，逃出生天！',
    },
    {
      key: 'EscortScene',
      name: '护送升级',
      description: '收集5种材料升级足球，把足球推滚到终点通关！',
    },
    {
      key: 'TowerDefenseScene',
      name: '物理塔防',
      description: '拖拽塔防御核心，用怪物掉落物升级！',
    },
    {
      key: 'HauntedMansionScene',
      name: '鬼屋探秘',
      description: '在鬼屋房间中扫描线索，躲避陷阱与鬼魂，发现所有秘密！',
    },
    {
      key: 'CleanupScene',
      name: '末班地铁',
      description: '怪物在车厢间穿行留下致命残秽，吸取残秽喂给列车跑到下一站！被怪物碰到即死！',
    },
    {
      key: 'ConvoyScene',
      name: '荒原车队',
      description: '上车亲自开卡车探索荒原，找燃料与物资，拾取罗盘定位撤离门！',
    },
    {
      key: 'EcholocationScene',
      name: '回声定位',
      description: '【单机制验证】声波探路会惊动怪物，静默最安全但看不见路！',
    },
    {
      key: 'GreedCurseScene',
      name: '贪婪诅咒',
      description: '【单机制验证】拾取越多贪婪越高，世界越危险，祭坛可净化！',
    },
    {
      key: 'MultiplayerScene',
      name: '多人躲猫猫测试',
      description: '【多人联机】第一个玩家是猎人，按空格开枪；后续玩家扮演平民，活到倒计时结束即胜利！',
    },
    {
      key: 'DeathmatchScene',
      name: '多人互射测试',
      description: '【多人联机】WASD/方向键移动，按空格开枪，死亡无限复活，无时间限制，专门用来联机射击调试。',
    },
    {
      key: 'PinballScene',
      name: '弹珠赌局',
      description: '你是赌徒，被迫用牙齿做的挡板操控弹珠完成致命赌局！黑暗在身后追赶！',
    },
    {
      key: 'RitualRoomsScene',
      name: '仪式房间',
      description: '中央祭坛+周围6房间，吸取残秽喂给祭坛完成仪式！怪物碰触即死，可躲进柜子/桌下！',
    },
    {
      key: 'TrapHunterScene',
      name: '陷阱猎人',
      description: '布置陷阱，用噪音器引诱怪物踩中爆炸！杀怪掉灵魂→献祭祭坛→完成仪式。冲刺有噪音会暴露自己，想引诱又怕发声！',
    },
    {
      key: 'NameTagScene',
      name: '撕名牌大乱斗',
      description: '【俯视角竞技】WASD移动，空格撕对手背后名牌！冲刺消耗体力，道具护盾/烟雾/磁铁，60秒后缩圈，最后存活者胜！',
    },
    {
      key: 'StealScene',
      name: '绕背偷',
      description: '【差异化验证】怪物身上携带残秽，绕到背后盲区按空格偷取！怪物有视野锥，追击比玩家慢但有攻击前摇，偷越多越容易惊动！',
    },
    {
      key: 'MidnightGambleScene',
      name: '午夜赌局',
      description: '搜打撤+赌博：轮盘赌选地点，搜刮资源躲避怪物，建造避难所升级设施！',
    },
    {
      key: 'AbyssHotelScene',
      name: '深渊旅馆',
      description: '模拟经营+赌博：倒置塔下坠探索，占领楼层经营客房，赚取收益继续下坠！',
    },
    {
      key: 'CleanupEvacScene',
      name: '赌石撤离',
      description: '进入黑暗废弃建筑，用水枪清洗石皮！逐步揭晓内部价值——废料还是帝王绿？洗到一半可右键止损！小心诅咒石触发怪物！收集价值1000后撤离！',
    },
    {
      key: 'BlindBoxHorrorScene',
      name: '盲盒惊魂',
      description: '选择盲盒大小（小/中/大=1/2/3次破解），每次破解探索一层鬼屋！破解台开盲盒：财宝、怪物、BOSS或特殊事件！完成每层撤离任务（收集、解谜、限时、激活、封印）才能上楼！财宝分普通/稀有/史诗/传说4档品质，楼层越高奖励越好但风险越大！',
    },
    {
      key: 'CleanupMultiplayerScene',
      name: '多人清扫撤离',
      description: '多人合作版！一起用水枪清扫污渍收集宝物，团队价值达1000后到撤离点撤离！被怪物打倒后倒地，队友靠近按E复活！Shift疾跑 | E躲藏/复活/撤离 | 左键喷射',
    },
    {
      key: 'BlindBoxMultiplayerScene',
      name: '多人盲盒惊魂',
      description: '【多人联机】合作PvE版盲盒惊魂！投票选盲盒大小，团队共享破解次数和财宝分数。5层鬼屋探索，每层完成撤离任务才能上楼。被鬼打倒倒地15秒，队友靠近按E复活！E交互/复活 | F上楼 | 1/2/3投票',
    },
    // Add new prototypes here
  ];

  private selectedIndex = 0;
  private gridCells: Phaser.GameObjects.Container[] = [];

  // Grid layout constants
  private readonly gridMarginX = 30;
  private readonly gridTop = 110;
  private readonly gridBottomMargin = 30;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    // Clear stale references from previous scene instance (scene.restart/start reuses the same object)
    this.gridCells = [];
    this.selectedIndex = 0;

    // Title
    this.add.text(400, 40, 'Prototype Maker', {
      fontSize: '32px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.add.text(400, 75, '选择一个原型：', {
      fontSize: '14px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    // Compute dynamic grid layout
    const layout = this.computeGrid();
    const { cols, cellW, cellH, nameFontSize, descFontSize } = layout;

    const gap = 4;
    const gridLeft = this.gridMarginX;
    const gridTop = this.gridTop;

    // Build grid cells
    this.prototypes.forEach((proto, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = gridLeft + col * cellW;
      const y = gridTop + row * cellH;

      const cell = this.add.container(x, y);

      // Background (interactive hitbox)
      const bg = this.add.rectangle(
        cellW / 2, cellH / 2,
        cellW - gap, cellH - gap,
        0x111122, 0.6,
      );
      bg.setStrokeStyle(1, 0x333355, 0.6);
      bg.setInteractive({ useHandCursor: true });
      cell.add(bg);

      // Name text
      const nameText = this.add.text(
        8, 4,
        proto.name,
        { fontSize: `${nameFontSize}px`, color: '#ffffff', fontStyle: 'bold' },
      );
      cell.add(nameText);

      // Description text (word-wrapped to fit cell width)
      const descText = this.add.text(
        8, 4 + nameFontSize + 4,
        proto.description,
        {
          fontSize: `${descFontSize}px`,
          color: '#888888',
          wordWrap: { width: cellW - gap - 16, useAdvancedWrap: true },
        },
      );
      cell.add(descText);

      this.gridCells.push(cell);

      // Click handler
      const launchScene = () => {
        if (proto.key === 'CleanupScene') {
          this.showCleanupIntro();
        } else if (proto.key === 'EcholocationScene') {
          this.showEcholocationIntro();
        } else if (proto.key === 'GreedCurseScene') {
          this.showGreedCurseIntro();
        } else {
          this.scene.start(proto.key);
        }
      };

      bg.on('pointerdown', launchScene);
      bg.on('pointerover', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });
    });

    // Instructions
    this.add.text(400, 585, '↑↓←→ 选择 • 回车 启动 • 点击进入', {
      fontSize: '14px',
      color: '#666666',
    }).setOrigin(0.5);

    // Keyboard input
    const cursors = this.input.keyboard!.createCursorKeys();
    const enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    enterKey.on('down', () => {
      const proto = this.prototypes[this.selectedIndex];
      if (proto.key === 'CleanupScene') {
        this.showCleanupIntro();
      } else if (proto.key === 'EcholocationScene') {
        this.showEcholocationIntro();
      } else if (proto.key === 'GreedCurseScene') {
        this.showGreedCurseIntro();
      } else {
        this.scene.start(proto.key);
      }
    });

    cursors.up!.on('down', () => {
      this.selectedIndex = Phaser.Math.Wrap(this.selectedIndex - cols, 0, this.prototypes.length);
      this.updateSelection();
    });

    cursors.down!.on('down', () => {
      this.selectedIndex = Phaser.Math.Wrap(this.selectedIndex + cols, 0, this.prototypes.length);
      this.updateSelection();
    });

    cursors.left!.on('down', () => {
      this.selectedIndex = Phaser.Math.Wrap(this.selectedIndex - 1, 0, this.prototypes.length);
      this.updateSelection();
    });

    cursors.right!.on('down', () => {
      this.selectedIndex = Phaser.Math.Wrap(this.selectedIndex + 1, 0, this.prototypes.length);
      this.updateSelection();
    });

    this.updateSelection();
  }

  /** Compute grid columns/rows/cell-size from prototype count */
  private computeGrid() {
    const n = this.prototypes.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const availW = 800 - this.gridMarginX * 2;
    const availH = 600 - this.gridTop - this.gridBottomMargin;
    const cellW = availW / cols;
    const cellH = availH / rows;
    const nameFontSize = Math.min(20, Math.max(10, Math.floor(cellH * 0.22)));
    const descFontSize = Math.min(12, Math.max(8, Math.floor(cellH * 0.14)));
    return { cols, rows, cellW, cellH, nameFontSize, descFontSize };
  }

  private updateSelection() {
    this.gridCells.forEach((cell, index) => {
      const bg = cell.getAt(0) as Phaser.GameObjects.Rectangle;
      if (index === this.selectedIndex) {
        bg.setFillStyle(0x223366, 0.8);
        bg.setStrokeStyle(2, 0x66aaff, 1);
      } else {
        bg.setFillStyle(0x111122, 0.6);
        bg.setStrokeStyle(1, 0x333355, 0.6);
      }
    });
  }

  /** 末班地铁说明页：按Enter进入游戏 */
  private showCleanupIntro() {
    // 半透明遮罩
    const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.85);
    overlay.setDepth(100);

    const panel = this.add.rectangle(400, 300, 720, 520, 0x111122, 0.95);
    panel.setStrokeStyle(2, 0x444466, 1);
    panel.setDepth(101);

    const texts: Phaser.GameObjects.Text[] = [];
    const mkText = (y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle) => {
      const t = this.add.text(400, y, text, style).setOrigin(0.5).setDepth(102);
      texts.push(t);
      return t;
    };

    mkText(70, '🚇 末班地铁', { fontSize: '32px', color: '#ffaa44', fontStyle: 'bold' });
    mkText(110, '清理残秽，投喂燃料，抵达下一站', { fontSize: '14px', color: '#888888' });

    mkText(150, '🎮 操作', { fontSize: '18px', color: '#44ddff', fontStyle: 'bold' });
    mkText(178, 'WASD 移动  •  空格 吸取残秽(按住)  •  E 交互(拾取/封锁/投喂/躲藏)  •  ESC 菜单', { fontSize: '13px', color: '#cccccc' });

    mkText(215, '⚙️ 核心机制', { fontSize: '18px', color: '#44ddff', fontStyle: 'bold' });
    mkText(243, '• 残秽浓度自然增长并扩散，≥50%概率滋生怪物，爆表12秒即灭', { fontSize: '13px', color: '#cccccc' });
    mkText(263, '• 吸取残秽→走到车头投喂→转化为燃料，行驶满1000m通关', { fontSize: '13px', color: '#cccccc' });
    mkText(283, '• 燃料耗尽熄火30秒即灭，封锁器共4个，封门撞怪即杀(10秒解封)', { fontSize: '13px', color: '#cccccc' });
    mkText(303, '• 车厢内有厕所/柜子可按E躲藏避开怪物', { fontSize: '13px', color: '#cccccc' });

    mkText(340, '⚠️ 规则怪谈小道（车厢上方绕行通道）', { fontSize: '16px', color: '#ffaa00', fontStyle: 'bold' });
    mkText(365, '🟤 棕色(安全)：可自由通行    🟡 黄光(预警1秒)：立刻停下！', { fontSize: '13px', color: '#cccccc' });
    mkText(385, '🔴 红光(危险)：任何移动 = 瞬间死亡！等回棕色再走', { fontSize: '13px', color: '#ff6666' });

    mkText(425, '💀 死亡条件', { fontSize: '16px', color: '#ff4444', fontStyle: 'bold' });
    mkText(450, '被怪物触碰 / 残秽爆表12秒 / 熄火30秒 / 小道红光时移动', { fontSize: '13px', color: '#cccccc' });

    const prompt = mkText(510, '按 Enter 进入游戏', { fontSize: '18px', color: '#ffffff', backgroundColor: '#333355', padding: { x: 20, y: 8 } });

    // 闪烁提示
    this.tweens.add({
      targets: prompt,
      alpha: { from: 1, to: 0.4 },
      duration: 600,
      yoyo: true,
      repeat: -1,
    });

    // 按Enter进入游戏
    const enterListener = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    const handler = () => {
      overlay.destroy();
      panel.destroy();
      texts.forEach(t => t.destroy());
      enterListener.removeListener('down', handler);
      this.scene.start('CleanupScene');
    };
    enterListener.on('down', handler);
  }

  /** 回声定位说明页：按Enter进入游戏 */
  private showEcholocationIntro() {
    const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.85);
    overlay.setDepth(100);

    const panel = this.add.rectangle(400, 300, 720, 520, 0x111122, 0.95);
    panel.setStrokeStyle(2, 0x446644, 1);
    panel.setDepth(101);

    const texts: Phaser.GameObjects.Text[] = [];
    const mkText = (y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle) => {
      const t = this.add.text(400, y, text, style).setOrigin(0.5).setDepth(102);
      texts.push(t);
      return t;
    };

    mkText(70, '📢 回声定位', { fontSize: '32px', color: '#00ffcc', fontStyle: 'bold' });
    mkText(110, '声波探路会惊动怪物，静默最安全但看不见路', { fontSize: '14px', color: '#888888' });

    mkText(150, '🎮 操作', { fontSize: '18px', color: '#44ddff', fontStyle: 'bold' });
    mkText(178, 'WASD 移动  •  空格 发出声波  •  Shift 冲刺  •  ESC 菜单', { fontSize: '13px', color: '#cccccc' });

    mkText(215, '⚙️ 核心机制', { fontSize: '18px', color: '#44ddff', fontStyle: 'bold' });
    mkText(243, '• 基础视野极小(90px)，几乎看不见任何东西', { fontSize: '13px', color: '#cccccc' });
    mkText(263, '• 空格发出声波脉冲，扩散350px，照亮地形和宝藏2秒', { fontSize: '13px', color: '#cccccc' });
    mkText(283, '• 声波会惊动范围内怪物，它们前往声源调查4秒', { fontSize: '13px', color: '#cccccc' });
    mkText(303, '• 冲刺也会产生噪音吸引怪物，冷却2.5秒', { fontSize: '13px', color: '#cccccc' });

    mkText(340, '💎 宝藏与逃脱', { fontSize: '16px', color: '#ffaa00', fontStyle: 'bold' });
    mkText(365, '声波扫过宝藏→显形2秒→走过去自动拾取', { fontSize: '13px', color: '#cccccc' });
    mkText(385, '拾取至少1个宝藏后走到出口(绿框)即可逃脱', { fontSize: '13px', color: '#cccccc' });

    mkText(425, '💀 死亡条件', { fontSize: '16px', color: '#ff4444', fontStyle: 'bold' });
    mkText(450, '被怪物触碰，生命归零即死', { fontSize: '13px', color: '#cccccc' });

    const prompt = mkText(510, '按 Enter 进入游戏', { fontSize: '18px', color: '#ffffff', backgroundColor: '#335533', padding: { x: 20, y: 8 } });

    this.tweens.add({
      targets: prompt,
      alpha: { from: 1, to: 0.4 },
      duration: 600,
      yoyo: true,
      repeat: -1,
    });

    const enterListener = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    const handler = () => {
      overlay.destroy();
      panel.destroy();
      texts.forEach(t => t.destroy());
      enterListener.removeListener('down', handler);
      this.scene.start('EcholocationScene');
    };
    enterListener.on('down', handler);
  }

  /** 贪婪诅咒说明页：按Enter进入游戏 */
  private showGreedCurseIntro() {
    const overlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.85);
    overlay.setDepth(100);

    const panel = this.add.rectangle(400, 300, 720, 520, 0x111122, 0.95);
    panel.setStrokeStyle(2, 0x664466, 1);
    panel.setDepth(101);

    const texts: Phaser.GameObjects.Text[] = [];
    const mkText = (y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle) => {
      const t = this.add.text(400, y, text, style).setOrigin(0.5).setDepth(102);
      texts.push(t);
      return t;
    };

    mkText(60, '💰 贪婪诅咒', { fontSize: '32px', color: '#ff44ff', fontStyle: 'bold' });
    mkText(100, '拾取越多贪婪越高，世界越危险，祭坛可净化', { fontSize: '14px', color: '#888888' });

    mkText(138, '🎮 操作', { fontSize: '18px', color: '#44ddff', fontStyle: 'bold' });
    mkText(166, 'WASD移动 • 空格探测 • E显形 • Q祭坛丢弃 • Shift冲刺 • ESC菜单', { fontSize: '13px', color: '#cccccc' });

    mkText(200, '⚙️ 核心机制：贪婪4阶段', { fontSize: '18px', color: '#44ddff', fontStyle: 'bold' });
    mkText(228, '🟢 0-30：正常，雾较淡，怪物正常速度', { fontSize: '13px', color: '#88ff88' });
    mkText(248, '🟡 30-60：雾变浓，怪物加速10%', { fontSize: '13px', color: '#ffaa44' });
    mkText(268, '🟠 60-80：视野减半，每15秒生成新怪物', { fontSize: '13px', color: '#ff8844' });
    mkText(288, '🔴 80-100：暗影追猎者出现(穿墙追击)，出口每10秒移动', { fontSize: '13px', color: '#ff4444' });

    mkText(325, '💎 宝藏流程', { fontSize: '16px', color: '#ffaa00', fontStyle: 'bold' });
    mkText(350, '空格探测→滴滴响表示附近有宝藏→走过去按E显形→触碰拾取', { fontSize: '13px', color: '#cccccc' });
    mkText(370, '拾取宝藏 +金钱 +贪婪值(不同宝藏权重不同)', { fontSize: '13px', color: '#cccccc' });

    mkText(405, '✦ 祭坛净化', { fontSize: '16px', color: '#cc88ff', fontStyle: 'bold' });
    mkText(430, '走到祭坛旁按Q：丢弃一半金钱，降低35点贪婪(每祭坛限1次)', { fontSize: '13px', color: '#cccccc' });

    mkText(465, '🚪 逃脱条件', { fontSize: '16px', color: '#44ff44', fontStyle: 'bold' });
    mkText(490, '贪婪≥40时出口开启(绿框)，走到出口即逃脱', { fontSize: '13px', color: '#cccccc' });

    const prompt = mkText(510, '按 Enter 进入游戏', { fontSize: '18px', color: '#ffffff', backgroundColor: '#553355', padding: { x: 20, y: 8 } });

    this.tweens.add({
      targets: prompt,
      alpha: { from: 1, to: 0.4 },
      duration: 600,
      yoyo: true,
      repeat: -1,
    });

    const enterListener = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    const handler = () => {
      overlay.destroy();
      panel.destroy();
      texts.forEach(t => t.destroy());
      enterListener.removeListener('down', handler);
      this.scene.start('GreedCurseScene');
    };
    enterListener.on('down', handler);
  }
}
