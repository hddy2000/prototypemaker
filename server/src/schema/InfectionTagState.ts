import { Schema, type } from "@colyseus/schema";

export class InfectionPlayer extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") rotation: number = 0;
  @type("string") color: string = "#ffffff";
  @type("boolean") alive: boolean = true;
  @type("boolean") infected: boolean = false;
  @type("number") infectedAt: number = 0; // timestamp when infected
  @type("number") lastInfectTime: number = 0; // cooldown tracking
  @type("number") infectionCount: number = 0; // how many people this player infected
  @type("boolean") isZeroPatient: boolean = false; // only zero patient has full map vision
  @type("number") score: number = 0;
  @type("number") survivalSeconds: number = 0; // how long survived (for scoring)
}

export class InfectionTagState extends Schema {
  @type("string") phase: string = "waiting"; // waiting, active, ended
  @type({ map: InfectionPlayer }) players = new Map<string, InfectionPlayer>();
  @type("number") timeRemaining: number = 120; // 2 minutes in seconds
  @type("number") startTime: number = 0;
}
