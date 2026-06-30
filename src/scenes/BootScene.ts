import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // 加载美术资源
    this.load.image('ghost', 'assets/ghost.png');
    this.load.image('blood', 'assets/blood.png');
  }

  create() {
    this.scene.start('MenuScene');
  }
}
