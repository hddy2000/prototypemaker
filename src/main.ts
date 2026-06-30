import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { MazeScene } from './scenes/MazeScene';
import { EscortScene } from './scenes/EscortScene';
import { TowerDefenseScene } from './scenes/TowerDefenseScene';
import { HauntedMansionScene } from './scenes/HauntedMansionScene';
import { CleanupScene } from './scenes/CleanupScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, MenuScene, MazeScene, EscortScene, TowerDefenseScene, HauntedMansionScene, CleanupScene],
};

new Phaser.Game(config);
