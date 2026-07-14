// Shared types and constants between client and server for BlindBox Multiplayer

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

export const MAP_WIDTH = 900;
export const MAP_HEIGHT = 700;
export const SCREEN_W = 800;
export const SCREEN_H = 600;

export const PLAYER_RADIUS = 12;
export const PLAYER_SPEED = 150;

export const VIEW_RADIUS = 180;

// Blind box types
export const BLIND_BOX_TYPES = [
  { type: 1, name: '小盲盒', cracks: 1, price: 100, color: '#44aa44', desc: '1次破解\n探索1层\n风险低' },
  { type: 2, name: '中盲盒', cracks: 2, price: 250, color: '#4488ff', desc: '2次破解\n探索2层\n风险中' },
  { type: 3, name: '大盲盒', cracks: 3, price: 500, color: '#aa44ff', desc: '3次破解\n探索3层\n风险高' },
] as const;

// Floor configs (must match client FLOOR_CONFIGS)
export const FLOOR_CONFIGS = [
  { floor: 1, name: '大厅层', ghostSpeed: 30, ghostChaseSpeed: 70, ghostDamage: 10, ghostVision: 180, bossDamage: 30, decorCount: [2, 3], darkRoomChance: 0.3, evacTaskType: 0, evacTarget: 3, evacRewardMult: 1.1 },
  { floor: 2, name: '居住层', ghostSpeed: 40, ghostChaseSpeed: 90, ghostDamage: 15, ghostVision: 200, bossDamage: 40, decorCount: [3, 4], darkRoomChance: 0.5, evacTaskType: 1, evacTarget: 1, evacRewardMult: 1.2 },
  { floor: 3, name: '储藏层', ghostSpeed: 50, ghostChaseSpeed: 110, ghostDamage: 20, ghostVision: 220, bossDamage: 50, decorCount: [3, 5], darkRoomChance: 0.6, evacTaskType: 2, evacTarget: 30, evacRewardMult: 1.3 },
  { floor: 4, name: '禁区层', ghostSpeed: 60, ghostChaseSpeed: 130, ghostDamage: 25, ghostVision: 250, bossDamage: 60, decorCount: [4, 6], darkRoomChance: 0.7, evacTaskType: 3, evacTarget: 3, evacRewardMult: 1.5 },
  { floor: 5, name: 'BOSS层', ghostSpeed: 70, ghostChaseSpeed: 150, ghostDamage: 30, ghostVision: 280, bossDamage: 80, decorCount: [4, 6], darkRoomChance: 0.8, evacTaskType: 4, evacTarget: 1, evacRewardMult: 2.0 },
];

export const FLOOR_NAMES = [
  ['大厅', '客厅', '厨房', '餐厅'],
  ['卧室', '书房', '浴室', '走廊'],
  ['阁楼', '储藏室', '阳台', '密室'],
  ['禁室', '实验室', '档案室', '暗廊'],
  ['祭坛', '王座', '囚室', '深渊'],
];

export const QUALITY_COLORS = [0xffffff, 0x4488ff, 0xaa44ff, 0xffaa00];
export const QUALITY_NAMES = ['普通', '稀有', '史诗', '传说'];
export const QUALITY_VALUE_RANGES: [[number, number], [number, number], [number, number], [number, number]] = [
  [50, 100], [200, 300], [500, 800], [1000, 2000],
];

// Evacuation task types
export const EVAC_TASK_TYPES = {
  CollectItems: 0,
  KeyPuzzle: 1,
  TimedEscape: 2,
  MultiActivate: 3,
  BossSeal: 4,
} as const;

// Down/revive system
export const DOWN_DURATION_MS = 15000;
export const REVIVE_RATE_PER_SEC = 100 / 3; // 3 seconds to fully revive
export const REVIVE_RANGE = 50;

// Damage cooldown
export const DAMAGE_COOLDOWN_MS = 1000;
export const SPAWN_IMMUNITY_MS = 3000;
