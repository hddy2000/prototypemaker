import { Schema, MapSchema, type } from "@colyseus/schema";

export class CleanupPlayer extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") rotation: number = 0;
  @type("string") color: string = "#ffffff";
  @type("number") health: number = 100;
  @type("string") state: string = "alive"; // 'alive' | 'down' | 'dead'
  @type("number") score: number = 0;
  @type("boolean") hasShield: boolean = false;
  @type("boolean") isHidden: boolean = false;
  @type("boolean") isSpraying: boolean = false;
  @type("number") sprayAngle: number = 0;
  @type("number") stamina: number = 100;
  @type("number") blindTimer: number = 0;
  @type("number") slowTimer: number = 0;
  @type("number") downTimer: number = 0; // time since downed (ms)
  @type("number") reviveProgress: number = 0; // 0-100
  @type("string") reviverId: string = ""; // who is reviving me
}

export class CleanupMonster extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("boolean") isChasing: boolean = false;
  @type("boolean") isHunter: boolean = false;
  @type("number") stunTimer: number = 0;
  @type("number") dirX: number = 0;
  @type("number") dirY: number = 0;
}

export class CleanupStain extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") radius: number = 0;
  @type("number") cleanliness: number = 100;
  @type("boolean") cleaned: boolean = false;
}

export class CleanupLoot extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") type: string = "gold"; // gold | gem | medkit | shield
  @type("number") value: number = 0;
  @type("boolean") collected: boolean = false;
}

export class CleanupObstacle extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") w: number = 0;
  @type("number") h: number = 0;
}

export class CleanupHideSpot extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") w: number = 0;
  @type("number") h: number = 0;
}

export class CleanupGameState extends Schema {
  @type({ map: CleanupPlayer }) players = new MapSchema<CleanupPlayer>();
  @type({ map: CleanupMonster }) monsters = new MapSchema<CleanupMonster>();
  @type({ map: CleanupStain }) stains = new MapSchema<CleanupStain>();
  @type({ map: CleanupLoot }) loots = new MapSchema<CleanupLoot>();
  @type({ map: CleanupObstacle }) obstacles = new MapSchema<CleanupObstacle>();
  @type({ map: CleanupHideSpot }) hideSpots = new MapSchema<CleanupHideSpot>();
  @type("string") phase: string = "waiting"; // waiting | active | won | lost
  @type("number") teamScore: number = 0;
  @type("number") goalScore: number = 1000;
  @type("number") exitX: number = 0;
  @type("number") exitY: number = 0;
  @type("number") mapWidth: number = 2400;
  @type("number") mapHeight: number = 1600;
  @type("number") roundEndsAt: number = 0;
}
