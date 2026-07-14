import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // 加载美术资源
    this.load.image('ghost', 'assets/ghost.png');
    this.load.image('blood', 'assets/blood.png');
    // 加载音频资源
    this.load.audio('crying', 'assets/crying.mp3');   // 怪物靠近时的哭泣声
    this.load.audio('scream', 'assets/scream.mp3');    // 死亡跳脸音效
    this.load.image('pathghost', 'assets/pathghost.png');  // 小道瞬杀跳脸鬼图
    this.load.audio('pathlaugh', 'assets/pathlaugh.mp3');  // 小道瞬杀鬼笑声
  }

  create() {
    // URL hash 直跳：#XxxScene → 直接进入对应场景，跳过菜单
    const hashKey = location.hash.replace(/^#\/?/, '');
    if (hashKey && hashKey !== 'BootScene' && hashKey !== 'MenuScene') {
      try {
        this.scene.get(hashKey); // throws if not registered
        this.scene.start(hashKey);
        return;
      } catch { /* invalid key, fall through to menu */ }
    }
    this.scene.start('MenuScene');
  }
}
