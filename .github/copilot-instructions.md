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
1. Create new file in src/scenes/
2. Extend Phaser.Scene
3. Add scene key to src/main.ts config
4. **MUST include a visible "Back to Menu" button** (and/or ESC key) to return to MenuScene

## Architecture
- BootScene → MenuScene (main menu) → individual prototype scenes
- Every prototype scene must have a way to return to MenuScene (ESC key + visible button)

## Phaser 3.90 Known Issues
- `RenderTexture.erase()` does NOT work in WebGL — use Canvas + manual `gl.texImage2D()` upload instead
- `CanvasTexture.refresh()` and `TextureSource.update()` do NOT upload canvas data to WebGL texture — must manually call `gl.texImage2D()`
- For fog of war: use HTMLCanvasElement with `destination-out` composite + manual WebGL texture upload
