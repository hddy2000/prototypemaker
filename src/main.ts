import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { MazeScene } from './scenes/MazeScene';
import { EscortScene } from './scenes/EscortScene';
import { TowerDefenseScene } from './scenes/TowerDefenseScene';
import { HauntedMansionScene } from './scenes/HauntedMansionScene';
import { CleanupScene } from './scenes/CleanupScene';
import { PinballScene } from './scenes/PinballScene';
import { ConvoyScene } from './scenes/ConvoyScene';
import { EcholocationScene } from './scenes/EcholocationScene';
import { GreedCurseScene } from './scenes/GreedCurseScene';
import { MultiplayerScene } from './scenes/MultiplayerScene';
import { DeathmatchScene } from './scenes/DeathmatchScene';
import { RitualRoomsScene } from './scenes/RitualRoomsScene';
import { TrapHunterScene } from './scenes/TrapHunterScene';
import { NameTagScene } from './scenes/NameTagScene';
import { StealScene } from './scenes/StealScene';
import { MidnightGambleScene } from './scenes/MidnightGambleScene';
import { AbyssHotelScene } from './scenes/AbyssHotelScene';
import { CleanupEvacScene } from './scenes/CleanupEvacScene';
import { BlindBoxHorrorScene } from './scenes/BlindBoxHorrorScene';
import { CleanupMultiplayerScene } from './scenes/CleanupMultiplayerScene';
import { BlindBoxMultiplayerScene } from './scenes/BlindBoxMultiplayerScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 600,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [BootScene, MenuScene, MazeScene, EscortScene, TowerDefenseScene, HauntedMansionScene, CleanupScene, ConvoyScene, EcholocationScene, GreedCurseScene, MultiplayerScene, DeathmatchScene, PinballScene, RitualRoomsScene, TrapHunterScene, NameTagScene, StealScene, MidnightGambleScene, AbyssHotelScene, CleanupEvacScene, BlindBoxHorrorScene, CleanupMultiplayerScene, BlindBoxMultiplayerScene],
};

(window as any).game = new Phaser.Game(config);
