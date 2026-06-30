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
    // Add new prototypes here
  ];

  private selectedIndex = 0;
  private menuItems: Phaser.GameObjects.Text[] = [];

  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    // Title
    this.add.text(400, 80, 'Prototype Maker', {
      fontSize: '48px',
      color: '#ffffff',
    }).setOrigin(0.5);

    this.add.text(400, 130, 'Select a prototype:', {
      fontSize: '20px',
      color: '#aaaaaa',
    }).setOrigin(0.5);

    // Menu items
    const startY = 200;
    const itemHeight = 80;

    this.prototypes.forEach((proto, index) => {
      const y = startY + index * itemHeight;

      const nameText = this.add.text(100, y, proto.name, {
        fontSize: '28px',
        color: '#ffffff',
      });

      const descText = this.add.text(100, y + 35, proto.description, {
        fontSize: '16px',
        color: '#888888',
      });

      this.menuItems.push(nameText);

      // Make clickable
      nameText.setInteractive({ useHandCursor: true });
      descText.setInteractive({ useHandCursor: true });

      const launchScene = () => {
        this.scene.start(proto.key);
      };

      nameText.on('pointerdown', launchScene);
      descText.on('pointerdown', launchScene);

      nameText.on('pointerover', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });
    });

    // Instructions
    this.add.text(400, 550, '↑↓ to select • Enter to launch', {
      fontSize: '16px',
      color: '#666666',
    }).setOrigin(0.5);

    // Keyboard input
    const cursors = this.input.keyboard!.createCursorKeys();
    const enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    enterKey.on('down', () => {
      this.scene.start(this.prototypes[this.selectedIndex].key);
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
}
