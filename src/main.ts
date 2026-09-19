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
import { AltarCleanupScene } from './scenes/AltarCleanupScene';
import { StoneGambleScene } from './scenes/StoneGambleScene';
import { RuneGambleScene } from './scenes/RuneGambleScene';
import { TrapGambleScene } from './scenes/TrapGambleScene';
import { InfectionTagScene } from './scenes/InfectionTagScene';
import { BlindBoxCasinoScene } from './scenes/BlindBoxCasinoScene';
import { BoxSmashScene } from './scenes/BoxSmashScene';
import { BoxHeistScene } from './scenes/BoxHeistScene';
import { BoxHorrorScene } from './scenes/BoxHorrorScene';

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
  scene: [BootScene, MenuScene, MazeScene, EscortScene, TowerDefenseScene, HauntedMansionScene, CleanupScene, ConvoyScene, EcholocationScene, GreedCurseScene, MultiplayerScene, DeathmatchScene, PinballScene, RitualRoomsScene, TrapHunterScene, NameTagScene, StealScene, MidnightGambleScene, AbyssHotelScene, CleanupEvacScene, BlindBoxHorrorScene, CleanupMultiplayerScene, BlindBoxMultiplayerScene, AltarCleanupScene, StoneGambleScene, RuneGambleScene, TrapGambleScene, InfectionTagScene, BlindBoxCasinoScene, BoxSmashScene, BoxHeistScene, BoxHorrorScene],
};

const game = new Phaser.Game(config);
(window as any).game = game;

// ─── URL hash ↔ 场景 保持一致 ─────────────────────────────────
// 之前只改地址栏的 #XxxScene 不会重新加载页面，导致「网址显示 A、实际跑的是 B」。
// 这里监听 hashchange，手动改地址栏 / 前进后退 / 粘贴链接都能正确切换场景。
function sceneKeyFromHash(): string {
  return location.hash.replace(/^#\/?/, '');
}

window.addEventListener('hashchange', () => {
  // 稍作延迟：让游戏自身的 scene.start() 先落地，避免重复启动
  setTimeout(() => {
    const key = sceneKeyFromHash();
    if (!key || key === 'BootScene') return;
    if (!game.scene.keys[key]) return;          // 未注册的场景名，忽略

    if (game.scene.isActive(key)) return;       // 已经在跑目标场景，无需处理

    const active = game.scene.getScenes(true);  // 当前正在运行的场景
    if (active.length === 0) return;            // 还没启动完成，交给正常流程

    if (key === 'MenuScene') {
      active.forEach(s => game.scene.stop(s.scene.key));
      game.scene.start('MenuScene');
      return;
    }

    active.forEach(s => {
      if (s.scene.key !== key) game.scene.stop(s.scene.key);
    });
    game.scene.start(key);
  }, 60);
});
