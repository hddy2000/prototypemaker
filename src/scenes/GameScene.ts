import Phaser from 'phaser';

export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private escKey!: Phaser.Input.Keyboard.Key;

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    // Create a simple player rectangle
    this.player = this.add.rectangle(400, 300, 40, 40, 0x00ff00);

    // Enable physics on the player
    this.physics.add.existing(this.player);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    body.setBounce(0.2);

    // Set up keyboard input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.escKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // Add some text
    this.add.text(16, 16, 'Arrow keys to move • ESC for menu', {
      fontSize: '18px',
      color: '#ffffff',
    });

    // Create a ground platform
    const ground = this.add.rectangle(400, 580, 800, 40, 0x666666);
    this.physics.add.existing(ground, true); // static body
    
    // Add collision between player and ground
    this.physics.add.collider(this.player, ground);
  }

  update() {
    // Return to menu
    if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
      this.scene.start('MenuScene');
      return;
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const speed = 250;

    body.setVelocityX(0);

    if (this.cursors.left.isDown) {
      body.setVelocityX(-speed);
    } else if (this.cursors.right.isDown) {
      body.setVelocityX(speed);
    }

    if (this.cursors.up.isDown && body.blocked.down) {
      body.setVelocityY(-400);
    }
  }
}
