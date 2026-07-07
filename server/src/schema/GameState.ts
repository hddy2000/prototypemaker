import { Schema, MapSchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") color: string = "#ffffff";
  @type("number") rotation: number = 0;
  @type("string") role: string = "civilian";
  @type("boolean") alive: boolean = true;
  @type("number") kills: number = 0;
}

export class Bullet extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") vx: number = 0;
  @type("number") vy: number = 0;
  @type("number") ttlMs: number = 0;
  @type("string") ownerSessionId: string = "";
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Bullet }) bullets = new MapSchema<Bullet>();
  @type("string") hunterSessionId: string = "";
  @type("string") phase: string = "waiting";
  @type("string") winner: string = "";
  @type("number") roundEndsAt: number = 0;
}
