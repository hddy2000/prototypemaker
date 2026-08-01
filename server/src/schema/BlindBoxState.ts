import { Schema, MapSchema, type } from "@colyseus/schema";

// ── Player ──────────────────────────────────────────────────

export class BlindBoxPlayer extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") rotation: number = 0;
  @type("string") color: string = "#ffffff";
  @type("number") health: number = 100;
  @type("string") state: string = "alive"; // 'alive' | 'down' | 'dead'
  @type("number") score: number = 0;
  @type("number") downTimer: number = 0;
  @type("number") reviveProgress: number = 0;
  @type("string") reviverId: string = "";
  @type("number") spawnImmunity: number = 0;
  @type("number") damageCooldown: number = 0;
  @type("number") facingAngle: number = 0;
}

// ── Ghost ───────────────────────────────────────────────────

export class BlindBoxGhost extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") floor: number = 1;
  @type("boolean") isChasing: boolean = false;
  @type("boolean") isBoss: boolean = false;
  @type("boolean") alive: boolean = true;
  @type("number") dirX: number = 0;
  @type("number") dirY: number = 0;
  @type("number") homeX: number = 0;
  @type("number") homeY: number = 0;
  @type("number") visionRange: number = 180;
  @type("number") speed: number = 30;
  @type("number") chaseSpeed: number = 70;
  @type("number") damage: number = 10;
  @type("number") giveUpTimer: number = 0;
  @type("number") patrolTimer: number = 0;
  @type("number") attackCooldown: number = 0;
}

// ── Treasure ────────────────────────────────────────────────

export class BlindBoxTreasure extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") floor: number = 1;
  @type("number") value: number = 0;
  @type("number") quality: number = 0; // 0=Normal, 1=Rare, 2=Epic, 3=Legendary
  @type("boolean") collected: boolean = false;
}

// ── Collectible ─────────────────────────────────────────────

export class BlindBoxCollectible extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") floor: number = 1;
  @type("boolean") collected: boolean = false;
  @type("string") name: string = "物品";
}

// ── Multi Switch ────────────────────────────────────────────

export class BlindBoxSwitch extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") floor: number = 1;
  @type("boolean") activated: boolean = false;
}

// ── Obstacle ─────────────────────────────────────────────────

export class BlindBoxObstacle extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") w: number = 0;
  @type("number") h: number = 0;
  @type("number") floor: number = 1;
}

// ── Room Area ──────────────────────────────────────────────

export class BlindBoxRoomArea extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") w: number = 0;
  @type("number") h: number = 0;
  @type("number") floor: number = 1;
  @type("string") name: string = "";
  @type("number") centerX: number = 0;
  @type("number") centerY: number = 0;
  @type("boolean") hasLight: boolean = true;
  @type("boolean") lightOn: boolean = true;
  @type("number") switchX: number = 0;
  @type("number") switchY: number = 0;
}

// ── Stair ───────────────────────────────────────────────────

export class BlindBoxStair extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") floor: number = 1;
  @type("number") targetFloor: number = 1;
  @type("string") direction: string = "up";
}

// ── Cracking Table ──────────────────────────────────────────

export class BlindBoxCrackingTable extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") floor: number = 1;
  @type("boolean") isCracked: boolean = false;
}

// ── Exit ────────────────────────────────────────────────────

export class BlindBoxExit extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") floor: number = 1;
  @type("boolean") active: boolean = false;
}

// ── Floor Data (embedded in root state) ─────────────────────

export class BlindBoxFloorData extends Schema {
  @type("number") floor: number = 1;
  @type("boolean") isCracked: boolean = false;
  @type("number") evacTaskType: number = 0;
  @type("number") evacTarget: number = 0;
  @type("number") evacCurrent: number = 0;
  @type("boolean") evacCompleted: boolean = false;
  @type("number") evacTimer: number = 0;
  @type("boolean") evacTimerActive: boolean = false;
  @type("number") rewardMult: number = 1;
  @type("boolean") exitActive: boolean = false;
}

// ── Game State ──────────────────────────────────────────────

export class BlindBoxGameState extends Schema {
  @type({ map: BlindBoxPlayer }) players = new MapSchema<BlindBoxPlayer>();
  @type({ map: BlindBoxGhost }) ghosts = new MapSchema<BlindBoxGhost>();
  @type({ map: BlindBoxTreasure }) treasures = new MapSchema<BlindBoxTreasure>();
  @type({ map: BlindBoxCollectible }) collectibles = new MapSchema<BlindBoxCollectible>();
  @type({ map: BlindBoxSwitch }) switches = new MapSchema<BlindBoxSwitch>();
  @type({ map: BlindBoxObstacle }) obstacles = new MapSchema<BlindBoxObstacle>();
  @type({ map: BlindBoxRoomArea }) rooms = new MapSchema<BlindBoxRoomArea>();
  @type({ map: BlindBoxStair }) stairs = new MapSchema<BlindBoxStair>();
  @type({ map: BlindBoxCrackingTable }) crackingTables = new MapSchema<BlindBoxCrackingTable>();
  @type({ map: BlindBoxExit }) exits = new MapSchema<BlindBoxExit>();
  @type({ map: BlindBoxFloorData }) floorData = new MapSchema<BlindBoxFloorData>();

  @type("string") phase: string = "select"; // select | playing | dead | won
  @type("number") currentFloor: number = 1;
  @type("number") totalFloors: number = 5;
  @type("number") boxType: number = 1; // 1=Small, 2=Medium, 3=Large
  @type("number") cracksRemaining: number = 1;
  @type("number") totalCracks: number = 1;
  @type("number") crackCount: number = 0;
  @type("number") teamScore: number = 0;
  @type("number") finalScore: number = 0;
  @type("number") mapWidth: number = 900;
  @type("number") mapHeight: number = 700;
  @type("number") timeWarpTimer: number = 0;
  @type("string") messageText: string = "";
  @type("number") messageTimer: number = 0;

  // Voting system
  @type("number") boxVoteSmall: number = 0;
  @type("number") boxVoteMedium: number = 0;
  @type("number") boxVoteLarge: number = 0;
  @type("number") voteTimer: number = 0;
  @type("boolean") voteActive: boolean = false;
}
