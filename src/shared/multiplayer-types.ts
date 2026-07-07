// Shared types and constants between client and server

export const PLAYER_COLORS = [
  "#ff6b6b", // red
  "#4ecdc4", // teal
  "#45b7d1", // blue
  "#f9ca24", // yellow
  "#6c5ce7", // purple
  "#a8e6cf", // mint
  "#fd79a8", // pink
  "#fdcb6e", // orange
];

export const ARENA = {
  WIDTH: 1600,
  HEIGHT: 1200,
  TILE_SIZE: 40,
} as const;

// Obstacle definitions (x, y, width, height) in pixels
export const OBSTACLES: Array<{ x: number; y: number; w: number; h: number }> = [
  // Center cross
  { x: 720, y: 400, w: 160, h: 40 },
  { x: 780, y: 340, w: 40, h: 160 },
  // Corner blocks
  { x: 200, y: 200, w: 120, h: 120 },
  { x: 1280, y: 200, w: 120, h: 120 },
  { x: 200, y: 880, w: 120, h: 120 },
  { x: 1280, y: 880, w: 120, h: 120 },
  // Side walls
  { x: 500, y: 560, w: 40, h: 200 },
  { x: 1060, y: 440, w: 40, h: 200 },
  // Extra cover
  { x: 400, y: 700, w: 80, h: 40 },
  { x: 1120, y: 460, w: 80, h: 40 },
];
