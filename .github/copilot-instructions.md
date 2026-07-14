# Prototype Maker - Game Development Environment

## Project Overview
Phaser 3 + TypeScript + Vite game prototype development environment.

## Quick Commands
- `npm run dev` - Start dev server (http://localhost:5173/)
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Project Structure
- `src/main.ts` - Game entry point and configuration
- `src/scenes/` - Game scenes (BootScene, GameScene)
- `index.html` - HTML entry point
- `vite.config.ts` - Vite configuration
- `tsconfig.json` - TypeScript configuration

## Development Notes
- Sample game includes arrow key movement and physics
- No external assets required - uses programmatic graphics
- Physics debug can be enabled in src/main.ts
- Game canvas: 800x600 (configurable)

## Adding New Scenes
**每次创建新场景前必须先阅读 `NEW_SCENE_GUIDE.md`**，然后严格按规则执行。

1. Create new file in src/scenes/
2. Extend Phaser.Scene
3. Add scene key to src/main.ts config
4. Add entry to MenuScene.ts `prototypes` array (before `// Add new prototypes here`)
5. **MUST include a visible "Back to Menu" button** (and/or ESC key) to return to MenuScene
6. `create()` 开头重置所有数组和状态变量（scene.start 复用对象）
7. UI 元素必须 `setScrollFactor(0)` + 合适 `setDepth`
8. 迷雾用 Canvas + 手动 `gl.texImage2D()` 上传（Phaser 3.90 bug）
9. `textures.addCanvas()` 前先 `exists()` + `remove()`
10. 高频 `setText()` 加 `.text !==` 变化检测
11. 键位约定：WASD移动、空格主动作、E交互、Shift冲刺、ESC菜单

## Architecture
- BootScene → MenuScene (main menu) → individual prototype scenes
- Every prototype scene must have a way to return to MenuScene (ESC key + visible button)

## Phaser 3.90 Known Issues
- `RenderTexture.erase()` does NOT work in WebGL — use Canvas + manual `gl.texImage2D()` upload instead
- `CanvasTexture.refresh()` and `TextureSource.update()` do NOT upload canvas data to WebGL texture — must manually call `gl.texImage2D()`
- For fog of war: use HTMLCanvasElement with `destination-out` composite + manual WebGL texture upload
- `scene.start()` reuses the same scene object — ALL instance properties (arrays, counters) must be reset in `create()` to avoid stale references
- Text objects' textures are destroyed on scene shutdown — stale references in uncleared arrays will cause `glTexture null` errors
- `textures.addCanvas()` warns "key already in use" on scene restart — call `textures.exists()` + `textures.remove()` before `addCanvas()`

## Multiplayer Performance Patterns
- Server `setPatchRate(50)` = 20Hz broadcast. Client MUST interpolate remote entities (players, monsters) with `Phaser.Math.Linear(current, target, 0.2)` in `update()` — do NOT `setPosition()` directly in `onChange`
- `onChange` callbacks: store `targetX/targetY` only; do actual position update in `update()` via lerp
- Local player: snap directly to server position (server echoes our input, no jitter)
- `setText()` is expensive (triggers texture re-render) — always wrap with `.text !==` change detection
- Throttle: move 20Hz, spray dirty-flag, fog 30Hz, UI 10Hz, stamina 15Hz
- Server: use spatial grid for obstacle collision (200px cells), not linear scan
