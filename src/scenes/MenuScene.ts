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
      description: '收集5种材料升级物品A，护送到终点通关！',
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
      key: 'MidnightGambleScene',
      name: '午夜赌局',
      description: '搜打撤+赌博：轮盘赌选地点，搜刮资源躲避怪物，建造避难所升级设施！',
    },
    {
      key: 'AbyssHotelScene',
      name: '深渊旅馆',
      description: '模拟经营+赌博：倒置塔下坠探索，占领楼层经营客房，赚取收益继续下坠！',
    },
    // Add new prototypes here
  ];

  private selectedIndex = 0;
  private menuItems: Phaser.GameObjects.Text[] = [];

  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    // Title
    this.add.text(400, 50, 'Prototype Maker', {
      fontSize: '36px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.add.text(400, 90, '选择一个原型：', {
      fontSize: '16px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    // Menu items
    const startY = 170;
    const itemHeight = 60;

    this.prototypes.forEach((proto, index) => {
      const y = startY + index * itemHeight;

      const nameText = this.add.text(100, y, proto.name, {
        fontSize: '22px',
        color: '#ffffff',
      });

      const descText = this.add.text(100, y + 26, proto.description, {
        fontSize: '13px',
        color: '#888888',
      });

      this.menuItems.push(nameText);

      // Make clickable
      nameText.setInteractive({ useHandCursor: true });
      descText.setInteractive({ useHandCursor: true });

      const launchScene = () => {
        if (proto.key === 'CleanupScene') {
          this.showCleanupIntro();
        } else {
          this.scene.start(proto.key);
        }
      };

      nameText.on('pointerdown', launchScene);
      descText.on('pointerdown', launchScene);

      nameText.on('pointerover', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });
    });

    // Instructions
    this.add.text(400, 550, '↑↓ 选择 • 回车 启动', {
      fontSize: '16px',
      color: '#666666',
    }).setOrigin(0.5);

    // Keyboard input
    const cursors = this.input.keyboard!.createCursorKeys();
    const enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    enterKey.on('down', () => {
      const proto = this.prototypes[this.selectedIndex];
      if (proto.key === 'CleanupScene') {
        this.showCleanupIntro();
      } else {
        this.scene.start(proto.key);
      }
    });

    cursors.up!.on('down', () => {
      this.selectedIndex = Phaser.Math.Wrap(this.selectedIndex - 1, 0, this.prototypes.length);
      this.updateSelection();
    });

    cursors.down!.on('down', () => {
      this.selectedIndex = Phaser.Math.Wrap(this.selectedIndex + 1, 0, this.prototypes.length);
      this.updateSelection();
    });

    this.updateSelection();
  }

  private updateSelection() {
    this.menuItems.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.setColor('#00ff00');
      } else {
        item.setColor('#ffffff');
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
}
