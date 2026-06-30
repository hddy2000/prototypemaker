# Prototype Maker

Game prototype development environment using **Phaser 3** + **TypeScript** + **Vite**.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173/ in your browser.

## Project Structure

```
src/
├── main.ts              # Game entry point & config
└── scenes/
    ├── BootScene.ts     # Boot/loading scene
    └── GameScene.ts     # Main game scene (sample included)
```

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Sample Game

The included sample demonstrates:
- Arrow key movement
- Physics (gravity, collision, bounce)
- Simple rectangle-based player (no assets needed)

## Adding New Scenes

1. Create a new file in `src/scenes/`
2. Extend `Phaser.Scene`
3. Add the scene key to `src/main.ts` config

## Notes

- No external assets required - uses programmatic graphics
- Physics debug can be enabled in `src/main.ts` config
- Game canvas is 800x600 (configurable in `src/main.ts`)
