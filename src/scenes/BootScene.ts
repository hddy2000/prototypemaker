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
  }

  create() {
    this.scene.start('MenuScene');
  }
}
