import { Room, Client } from "@colyseus/core";
import {
  BlindBoxPlayer,
  BlindBoxGhost,
  BlindBoxTreasure,
  BlindBoxCollectible,
  BlindBoxSwitch,
  BlindBoxObstacle,
  BlindBoxRoomArea,
  BlindBoxStair,
  BlindBoxCrackingTable,
  BlindBoxExit,
  BlindBoxFloorData,
  BlindBoxGameState,
} from "../schema/BlindBoxState.js";

// ─── Constants ───────────────────────────────────────────────

const PLAYER_COLORS = [
  "#ff6b6b", "#4ecdc4", "#45b7d1", "#f9ca24",
  "#6c5ce7", "#a8e6cf", "#fd79a8", "#fdcb6e",
];

const MAP_WIDTH = 900;
const MAP_HEIGHT = 700;
const PLAYER_RADIUS = 12;
const PLAYER_SPEED = 150;

const FLOOR_CONFIGS = [
  { floor: 1, name: '大厅层', ghostSpeed: 30, ghostChaseSpeed: 70, ghostDamage: 10, ghostVision: 180, bossDamage: 30, decorCount: [2, 3], darkRoomChance: 0.3, evacTaskType: 0, evacTarget: 3, evacRewardMult: 1.1 },
  { floor: 2, name: '居住层', ghostSpeed: 40, ghostChaseSpeed: 90, ghostDamage: 15, ghostVision: 200, bossDamage: 40, decorCount: [3, 4], darkRoomChance: 0.5, evacTaskType: 1, evacTarget: 1, evacRewardMult: 1.2 },
  { floor: 3, name: '储藏层', ghostSpeed: 50, ghostChaseSpeed: 110, ghostDamage: 20, ghostVision: 220, bossDamage: 50, decorCount: [3, 5], darkRoomChance: 0.6, evacTaskType: 2, evacTarget: 30, evacRewardMult: 1.3 },
  { floor: 4, name: '禁区层', ghostSpeed: 60, ghostChaseSpeed: 130, ghostDamage: 25, ghostVision: 250, bossDamage: 60, decorCount: [4, 6], darkRoomChance: 0.7, evacTaskType: 3, evacTarget: 3, evacRewardMult: 1.5 },
  { floor: 5, name: 'BOSS层', ghostSpeed: 70, ghostChaseSpeed: 150, ghostDamage: 30, ghostVision: 280, bossDamage: 80, decorCount: [4, 6], darkRoomChance: 0.8, evacTaskType: 4, evacTarget: 1, evacRewardMult: 2.0 },
];

const FLOOR_NAMES = [
  ['大厅', '客厅', '厨房', '餐厅'],
  ['卧室', '书房', '浴室', '走廊'],
  ['阁楼', '储藏室', '阳台', '密室'],
  ['禁室', '实验室', '档案室', '暗廊'],
  ['祭坛', '王座', '囚室', '深渊'],
];

const QUALITY_VALUE_RANGES: [[number, number], [number, number], [number, number], [number, number]] = [
  [50, 100], [200, 300], [500, 800], [1000, 2000],
];

const DOWN_DURATION_MS = 15000;
const REVIVE_RATE_PER_SEC = 100 / 3;
const REVIVE_RANGE = 50;
const DAMAGE_COOLDOWN_MS = 1000;
const SPAWN_IMMUNITY_MS = 3000;
const VOTE_DURATION_MS = 10000;

// ─── Types ───────────────────────────────────────────────────

interface ServerObstacle { x: number; y: number; w: number; h: number; floor: number; }
interface ServerRoom { x: number; y: number; w: number; h: number; name: string; centerX: number; centerY: number; hasLight: boolean; lightOn: boolean; switchX: number; switchY: number; floor: number; }
interface ServerStair { x: number; y: number; floor: number; targetFloor: number; direction: string; }
interface ServerCrackingTable { x: number; y: number; floor: number; }
interface ServerExit { x: number; y: number; floor: number; }

interface GhostAI {
  id: string;
  isBoss: boolean;
  isChasing: boolean;
  homeX: number;
  homeY: number;
  patrolTimer: number;
  giveUpTimer: number;
  giveUpDuration: number;
  attackCooldown: number;
  floor: number;
  speed: number;
  chaseSpeed: number;
  visionRange: number;
  damage: number;
  dirX: number;
  dirY: number;
}

// ─── Room ────────────────────────────────────────────────────

export class BlindBoxRoom extends Room<BlindBoxGameState> {
  maxClients = 8;

  private serverObstacles: ServerObstacle[] = [];
  private serverRooms: ServerRoom[] = [];
  private serverStairs: ServerStair[] = [];
  private serverCrackingTables: ServerCrackingTable[] = [];
  private serverExits: ServerExit[] = [];
  private ghostAIs: Map<string, GhostAI> = new Map();
  private nextGhostId = 1;
  private nextTreasureId = 1;
  private nextCollectibleId = 1;
  private nextSwitchId = 1;
  private nextObstacleId = 1;
  private nextRoomId = 1;
  private nextStairId = 1;
  private nextCrackingTableId = 1;
  private nextExitId = 1;
  private mapGenerated = false;
  private votes: Map<string, number> = new Map(); // sessionId → boxType

  onCreate(_options: any) {
    console.log(`[BlindBoxRoom] onCreate roomId=${this.roomId}`);
    this.setState(new BlindBoxGameState());

    this.state.mapWidth = MAP_WIDTH;
    this.state.mapHeight = MAP_HEIGHT;
    this.state.totalFloors = 5;

    // Pre-generate the entire mansion (all 5 floors)
    this.generateMansion();
    this.syncMapToState();

    // ── Message handlers ──

    this.onMessage("move", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.state !== "alive") return;
      if (this.state.phase !== "playing") return;

      const dt = (message.dt as number) || 16;
      this.handlePlayerMovement(player, message, dt);
    });

    this.onMessage("interact", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.state !== "alive") return;
      if (this.state.phase !== "playing") return;
      this.handleInteraction(client.sessionId);
    });

    this.onMessage("stairs", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.state !== "alive") return;
      if (this.state.phase !== "playing") return;
      this.handleStairs(client.sessionId);
    });

    this.onMessage("vote", (client, message) => {
      const boxType = message.boxType as number;
      if (this.state.phase !== "select") return;
      if (boxType < 1 || boxType > 3) return;
      this.votes.set(client.sessionId, boxType);
      this.recountVotes();
    });

    this.onMessage("revive", (client, message) => {
      const reviver = this.state.players.get(client.sessionId);
      if (!reviver || reviver.state !== "alive") return;
      const targetId = message.targetId as string;
      const target = this.state.players.get(targetId);
      if (!target || target.state !== "down") return;
      const dist = Math.hypot(target.x - reviver.x, target.y - reviver.y);
      if (dist > REVIVE_RANGE) return;
      target.reviverId = client.sessionId;
    });

    this.setSimulationInterval((deltaTime) => {
      this.update(deltaTime);
    });
  }

  onJoin(client: Client, _options: any) {
    const player = new BlindBoxPlayer();
    const colorIndex = this.state.players.size % PLAYER_COLORS.length;
    player.color = PLAYER_COLORS[colorIndex];
    player.health = 100;
    player.state = "alive";
    player.score = 0;
    player.spawnImmunity = SPAWN_IMMUNITY_MS;

    // Place at spawn room
    const spawnRoom = this.serverRooms.find(r => r.floor === 1);
    if (spawnRoom) {
      player.x = spawnRoom.centerX;
      player.y = spawnRoom.centerY;
    }

    this.state.players.set(client.sessionId, player);

    // If first player and no vote active, start voting
    if (this.state.players.size >= 1 && !this.state.voteActive && this.state.phase === "select") {
      this.startVoting();
    }

    console.log(`[BlindBoxRoom] onJoin roomId=${this.roomId} sessionId=${client.sessionId} color=${player.color}`);
  }

  onLeave(client: Client, _consented: boolean) {
    this.state.players.delete(client.sessionId);
    this.votes.delete(client.sessionId);

    // Revoke revive if reviver leaves
    this.state.players.forEach((p) => {
      if (p.reviverId === client.sessionId) {
        p.reviverId = "";
      }
    });

    if (this.state.phase === "select") {
      this.recountVotes();
    }

    console.log(`[BlindBoxRoom] onLeave roomId=${this.roomId} sessionId=${client.sessionId}`);
  }

  onDispose() {
    console.log("BlindBoxRoom disposed");
  }

  // ─── Voting ─────────────────────────────────────────────────

  private startVoting() {
    this.state.voteActive = true;
    this.state.voteTimer = VOTE_DURATION_MS;
    this.state.boxVoteSmall = 0;
    this.state.boxVoteMedium = 0;
    this.state.boxVoteLarge = 0;
    this.votes.clear();
    this.showMessage("投票选择盲盒大小！10秒后截止");
  }

  private recountVotes() {
    let small = 0, medium = 0, large = 0;
    this.votes.forEach((v) => {
      if (v === 1) small++;
      else if (v === 2) medium++;
      else if (v === 3) large++;
    });
    this.state.boxVoteSmall = small;
    this.state.boxVoteMedium = medium;
    this.state.boxVoteLarge = large;
  }

  private resolveVote() {
    this.state.voteActive = false;
    let boxType = 1;
    const s = this.state.boxVoteSmall;
    const m = this.state.boxVoteMedium;
    const l = this.state.boxVoteLarge;

    if (l >= m && l >= s && l > 0) boxType = 3;
    else if (m >= s && m > 0) boxType = 2;
    else if (s > 0) boxType = 1;
    // If no votes, default to small

    this.state.boxType = boxType;
    this.state.cracksRemaining = boxType;
    this.state.totalCracks = boxType;
    this.state.crackCount = 0;
    this.startGame();
  }

  // ─── Game Start ────────────────────────────────────────────

  private startGame() {
    this.state.phase = "playing";
    this.state.currentFloor = 1;
    this.state.teamScore = 0;
    this.state.finalScore = 0;
    this.state.timeWarpTimer = 0;

    // Reset all players to spawn
    let i = 0;
    const spawnRoom = this.serverRooms.find(r => r.floor === 1);
    this.state.players.forEach((player) => {
      if (spawnRoom) {
        player.x = spawnRoom.centerX + (i % 4) * 30;
        player.y = spawnRoom.centerY + Math.floor(i / 4) * 30;
      }
      player.health = 100;
      player.state = "alive";
      player.score = 0;
      player.spawnImmunity = SPAWN_IMMUNITY_MS;
      player.damageCooldown = 0;
      player.downTimer = 0;
      player.reviveProgress = 0;
      player.reviverId = "";
      i++;
    });

    // Initialize floor data
    for (let f = 1; f <= 5; f++) {
      const fd = new BlindBoxFloorData();
      fd.floor = f;
      fd.isCracked = false;
      fd.evacTaskType = FLOOR_CONFIGS[f - 1].evacTaskType;
      fd.evacTarget = FLOOR_CONFIGS[f - 1].evacTarget;
      fd.evacCurrent = 0;
      fd.evacCompleted = false;
      fd.evacTimer = 0;
      fd.evacTimerActive = false;
      fd.rewardMult = FLOOR_CONFIGS[f - 1].evacRewardMult;
      fd.exitActive = false;
      this.state.floorData.set(String(f), fd);
    }

    // Spawn collectibles for floor 1 (CollectItems)
    this.initFloorCollectibles(1);

    // Spawn wandering ghosts
    this.createWanderingGhosts();

    this.showMessage(`游戏开始！${this.state.boxType === 1 ? '小' : this.state.boxType === 2 ? '中' : '大'}盲盒，${this.state.cracksRemaining}次破解机会`);
  }

  // ─── Mansion Generation ─────────────────────────────────────

  private generateMansion() {
    for (let floor = 1; floor <= 5; floor++) {
      const cfg = FLOOR_CONFIGS[floor - 1];
      const cols = 2;
      const rows = 2;
      const roomGap = 40;
      const border = 20;
      const usableW = MAP_WIDTH - border * 2;
      const usableH = MAP_HEIGHT - border * 2;
      const roomW = Math.floor((usableW - roomGap * (cols - 1)) / cols);
      const roomH = Math.floor((usableH - roomGap * (rows - 1)) / rows);

      let idx = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = border + c * (roomW + roomGap);
          const y = border + r * (roomH + roomGap);
          const hasLight = Math.random() < cfg.darkRoomChance ? false : Math.random() < 0.5;

          this.serverRooms.push({
            x, y, w: roomW, h: roomH,
            name: FLOOR_NAMES[floor - 1][idx],
            centerX: x + roomW / 2,
            centerY: y + roomH / 2,
            hasLight, lightOn: hasLight,
            switchX: x + roomW - 40,
            switchY: y + 40,
            floor,
          });
          idx++;
        }
      }

      // Border walls
      this.serverObstacles.push({ x: 0, y: 0, w: MAP_WIDTH, h: border, floor });
      this.serverObstacles.push({ x: 0, y: MAP_HEIGHT - border, w: MAP_WIDTH, h: border, floor });
      this.serverObstacles.push({ x: 0, y: 0, w: border, h: MAP_HEIGHT, floor });
      this.serverObstacles.push({ x: MAP_WIDTH - border, y: 0, w: border, h: MAP_HEIGHT, floor });

      // Room walls with doorways
      const doorWidth = 60;
      const floorRooms = this.serverRooms.filter(r => r.floor === floor);
      for (const room of floorRooms) {
        if (room.y > border) {
          const doorX = room.x + room.w / 2 - doorWidth / 2;
          this.serverObstacles.push({ x: room.x, y: room.y - roomGap, w: doorX - room.x, h: roomGap, floor });
          this.serverObstacles.push({ x: doorX + doorWidth, y: room.y - roomGap, w: room.x + room.w - (doorX + doorWidth), h: roomGap, floor });
        }
        if (room.x > border) {
          const doorY = room.y + room.h / 2 - doorWidth / 2;
          this.serverObstacles.push({ x: room.x - roomGap, y: room.y, w: roomGap, h: doorY - room.y, floor });
          this.serverObstacles.push({ x: room.x - roomGap, y: doorY + doorWidth, w: roomGap, h: room.y + room.h - (doorY + doorWidth), floor });
        }
        const isBottomRow = room.y + room.h >= MAP_HEIGHT - border;
        if (!isBottomRow) {
          const doorX = room.x + room.w / 2 - doorWidth / 2;
          this.serverObstacles.push({ x: room.x, y: room.y + room.h, w: doorX - room.x, h: roomGap, floor });
          this.serverObstacles.push({ x: doorX + doorWidth, y: room.y + room.h, w: room.x + room.w - (doorX + doorWidth), h: roomGap, floor });
        }
        const isRightmost = room.x + room.w >= MAP_WIDTH - border;
        if (!isRightmost) {
          const doorY = room.y + room.h / 2 - doorWidth / 2;
          this.serverObstacles.push({ x: room.x + room.w, y: room.y, w: roomGap, h: doorY - room.y, floor });
          this.serverObstacles.push({ x: room.x + room.w, y: doorY + doorWidth, w: roomGap, h: room.y + room.h - (doorY + doorWidth), floor });
        }
      }

      // Furniture obstacles
      for (const room of floorRooms) {
        const decorCount = this.randInt(cfg.decorCount[0], cfg.decorCount[1]);
        for (let i = 0; i < decorCount; i++) {
          const dw = this.randInt(25, 60);
          const dh = this.randInt(25, 60);
          const dx = this.randInt(room.x + 30, room.x + room.w - 30 - dw);
          const dy = this.randInt(room.y + 30, room.y + room.h - 30 - dh);
          const distToCenter = Math.hypot(dx - room.centerX, dy - room.centerY);
          if (distToCenter < 80) continue;
          this.serverObstacles.push({ x: dx, y: dy, w: dw, h: dh, floor });
        }
      }

      // Stairs
      const stairRoom = floorRooms[3];
      if (floor < 5) {
        this.serverStairs.push({ x: stairRoom.centerX - 40, y: stairRoom.centerY, floor, targetFloor: floor + 1, direction: "up" });
      }
      if (floor > 1) {
        this.serverStairs.push({ x: stairRoom.centerX + 40, y: stairRoom.centerY, floor, targetFloor: floor - 1, direction: "down" });
      }

      // Cracking table
      const ctRoom = floorRooms[this.randInt(0, floorRooms.length - 1)];
      this.serverCrackingTables.push({ x: ctRoom.centerX, y: ctRoom.centerY, floor });
    }

    this.mapGenerated = true;
  }

  private syncMapToState() {
    // Sync obstacles
    for (const obs of this.serverObstacles) {
      const o = new BlindBoxObstacle();
      o.x = obs.x; o.y = obs.y; o.w = obs.w; o.h = obs.h; o.floor = obs.floor;
      this.state.obstacles.set(String(this.nextObstacleId++), o);
    }

    // Sync rooms
    for (const room of this.serverRooms) {
      const r = new BlindBoxRoomArea();
      r.x = room.x; r.y = room.y; r.w = room.w; r.h = room.h;
      r.floor = room.floor; r.name = room.name;
      r.centerX = room.centerX; r.centerY = room.centerY;
      r.hasLight = room.hasLight; r.lightOn = room.lightOn;
      r.switchX = room.switchX; r.switchY = room.switchY;
      this.state.rooms.set(String(this.nextRoomId++), r);
    }

    // Sync stairs
    for (const stair of this.serverStairs) {
      const s = new BlindBoxStair();
      s.x = stair.x; s.y = stair.y; s.floor = stair.floor;
      s.targetFloor = stair.targetFloor; s.direction = stair.direction;
      this.state.stairs.set(String(this.nextStairId++), s);
    }

    // Sync cracking tables
    for (const ct of this.serverCrackingTables) {
      const t = new BlindBoxCrackingTable();
      t.x = ct.x; t.y = ct.y; t.floor = ct.floor; t.isCracked = false;
      this.state.crackingTables.set(String(this.nextCrackingTableId++), t);
    }
  }

  // ─── Floor Collectibles ────────────────────────────────────

  private initFloorCollectibles(floor: number) {
    const cfg = FLOOR_CONFIGS[floor - 1];
    if (cfg.evacTaskType !== 0) return; // Only CollectItems floor

    const floorRooms = this.serverRooms.filter(r => r.floor === floor);
    for (let i = 0; i < cfg.evacTarget; i++) {
      const room = floorRooms[this.randInt(0, floorRooms.length - 1)];
      const x = this.randInt(room.x + 40, room.x + room.w - 40);
      const y = this.randInt(room.y + 40, room.y + room.h - 40);
      const col = new BlindBoxCollectible();
      col.x = x; col.y = y; col.floor = floor; col.collected = false; col.name = "古老硬币";
      this.state.collectibles.set(String(this.nextCollectibleId++), col);
    }
  }

  // ─── Multi Switches ────────────────────────────────────────

  private initFloorSwitches(floor: number) {
    const cfg = FLOOR_CONFIGS[floor - 1];
    if (cfg.evacTaskType !== 3) return; // Only MultiActivate floor

    const floorRooms = this.serverRooms.filter(r => r.floor === floor);
    for (let i = 0; i < 3; i++) {
      const room = floorRooms[i % floorRooms.length];
      const x = room.centerX + (i - 1) * 30;
      const y = room.centerY;
      const sw = new BlindBoxSwitch();
      sw.x = x; sw.y = y; sw.floor = floor; sw.activated = false;
      this.state.switches.set(String(this.nextSwitchId++), sw);
    }
  }

  // ─── Wandering Ghosts ─────────────────────────────────────

  private createWanderingGhosts() {
    for (let floor = 1; floor <= 5; floor++) {
      const cfg = FLOOR_CONFIGS[floor - 1];
      const ghostCount = 1 + floor;
      const floorRooms = this.serverRooms.filter(r => r.floor === floor);
      for (let i = 0; i < ghostCount; i++) {
        const room = floorRooms[this.randInt(1, floorRooms.length - 1)];
        this.createGhost(room.centerX, room.centerY, false, floor, cfg);
      }
    }
  }

  private createGhost(x: number, y: number, isBoss: boolean, floor: number, cfg: any) {
    const id = String(this.nextGhostId++);
    const ghost = new BlindBoxGhost();
    ghost.x = x; ghost.y = y; ghost.floor = floor;
    ghost.isBoss = isBoss; ghost.alive = true;
    ghost.isChasing = false;
    ghost.homeX = x; ghost.homeY = y;
    ghost.visionRange = cfg.ghostVision;
    ghost.speed = cfg.ghostSpeed;
    ghost.chaseSpeed = cfg.ghostChaseSpeed;
    ghost.damage = isBoss ? cfg.bossDamage : cfg.ghostDamage;
    ghost.giveUpTimer = 0;
    ghost.patrolTimer = 0;
    ghost.attackCooldown = 0;

    const angle = Math.random() * Math.PI * 2;
    ghost.dirX = Math.cos(angle);
    ghost.dirY = Math.sin(angle);

    this.state.ghosts.set(id, ghost);

    this.ghostAIs.set(id, {
      id, isBoss,
      isChasing: false,
      homeX: x, homeY: y,
      patrolTimer: 0,
      giveUpTimer: 0,
      giveUpDuration: isBoss ? 5000 : 3000,
      attackCooldown: 0,
      floor,
      speed: cfg.ghostSpeed,
      chaseSpeed: cfg.ghostChaseSpeed,
      visionRange: cfg.ghostVision,
      damage: isBoss ? cfg.bossDamage : cfg.ghostDamage,
      dirX: ghost.dirX,
      dirY: ghost.dirY,
    });
  }

  // ─── Main Update ──────────────────────────────────────────

  private update(deltaTime: number) {
    // Vote timer
    if (this.state.voteActive) {
      this.state.voteTimer -= deltaTime;
      if (this.state.voteTimer <= 0) {
        this.resolveVote();
      }
      return;
    }

    if (this.state.phase !== "playing") return;

    const dt = deltaTime / 1000;

    this.updateGhosts(deltaTime);
    this.updateGhostAttacks(deltaTime);
    this.updateDownedPlayers(deltaTime);
    this.updateRevives(deltaTime);
    this.updateTreasurePickup();
    this.updateEvacTimer(deltaTime);
    this.checkEvacuationComplete();

    // Decrement timers
    this.state.players.forEach((player) => {
      if (player.spawnImmunity > 0) player.spawnImmunity -= deltaTime;
      if (player.damageCooldown > 0) player.damageCooldown -= deltaTime;
    });

    if (this.state.timeWarpTimer > 0) {
      this.state.timeWarpTimer -= deltaTime;
      if (this.state.timeWarpTimer <= 0) {
        // Restore ghost speeds
        this.ghostAIs.forEach((ai, id) => {
          const ghost = this.state.ghosts.get(id);
          if (!ghost) return;
          const cfg = FLOOR_CONFIGS[ai.floor - 1];
          ai.speed = cfg.ghostSpeed;
          ai.chaseSpeed = cfg.ghostChaseSpeed;
          ghost.speed = cfg.ghostSpeed;
          ghost.chaseSpeed = cfg.ghostChaseSpeed;
        });
      }
    }

    // Message timer
    if (this.state.messageTimer > 0) {
      this.state.messageTimer -= deltaTime;
      if (this.state.messageTimer <= 0) {
        this.state.messageText = "";
      }
    }
  }

  // ─── Player Movement ──────────────────────────────────────

  private handlePlayerMovement(player: BlindBoxPlayer, message: any, deltaMs: number) {
    const dt = deltaMs / 1000;
    const inputX = message.inputX || 0;
    const inputY = message.inputY || 0;

    let vx = inputX * PLAYER_SPEED;
    let vy = inputY * PLAYER_SPEED;

    if (vx !== 0 && vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * PLAYER_SPEED;
      vy = (vy / len) * PLAYER_SPEED;
    }

    const halfSize = PLAYER_RADIUS;

    if (vx !== 0) {
      const dx = vx * dt;
      const newX = player.x + dx;
      const edgeX = newX + (dx > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(edgeX, player.y - halfSize, this.state.currentFloor) &&
          !this.isObstacleAt(edgeX, player.y + halfSize, this.state.currentFloor)) {
        player.x = newX;
      }
    }

    if (vy !== 0) {
      const dy = vy * dt;
      const newY = player.y + dy;
      const edgeY = newY + (dy > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(player.x - halfSize, edgeY, this.state.currentFloor) &&
          !this.isObstacleAt(player.x + halfSize, edgeY, this.state.currentFloor)) {
        player.y = newY;
      }
    }

    player.x = Math.max(16, Math.min(MAP_WIDTH - 16, player.x));
    player.y = Math.max(16, Math.min(MAP_HEIGHT - 16, player.y));

    if (typeof message.facingAngle === "number") {
      player.facingAngle = message.facingAngle;
    }
  }

  // ─── Interaction ──────────────────────────────────────────

  private handleInteraction(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const floor = this.state.currentFloor;
    const fd = this.state.floorData.get(String(floor));
    if (!fd) return;

    // Crack blind box
    if (!fd.isCracked && this.state.cracksRemaining > 0) {
      for (const ct of this.state.crackingTables.values()) {
        if (ct.floor !== floor || ct.isCracked) continue;
        const dist = Math.hypot(player.x - ct.x, player.y - ct.y);
        if (dist < 60) {
          this.crackBlindBox(sessionId);
          return;
        }
      }
    }

    // Pickup treasure
    for (const treasure of this.state.treasures.values()) {
      if (treasure.collected || treasure.floor !== floor) continue;
      const dist = Math.hypot(player.x - treasure.x, player.y - treasure.y);
      if (dist < 30) {
        treasure.collected = true;
        this.state.teamScore += treasure.value;
        player.score += treasure.value;
        this.showMessage(`玩家获得财宝！价值 ${treasure.value}（团队: ${this.state.teamScore}）`);
        // Remove after pickup
        for (const [tid, t] of this.state.treasures) {
          if (t === treasure) { this.state.treasures.delete(tid); break; }
        }
        return;
      }
    }

    // Pickup collectible
    for (const col of this.state.collectibles.values()) {
      if (col.collected || col.floor !== floor) continue;
      const dist = Math.hypot(player.x - col.x, player.y - col.y);
      if (dist < 30) {
        col.collected = true;
        fd.evacCurrent++;
        this.showMessage(`拾取了${col.name}！(${fd.evacCurrent}/${fd.evacTarget})`);
        for (const [cid, c] of this.state.collectibles) {
          if (c === col) { this.state.collectibles.delete(cid); break; }
        }
        return;
      }
    }

    // Multi switch
    for (const sw of this.state.switches.values()) {
      if (sw.activated || sw.floor !== floor) continue;
      const dist = Math.hypot(player.x - sw.x, player.y - sw.y);
      if (dist < 40) {
        sw.activated = true;
        const activated = Array.from(this.state.switches.values()).filter(s => s.floor === floor && s.activated).length;
        const total = Array.from(this.state.switches.values()).filter(s => s.floor === floor).length;
        this.showMessage(`机关激活！(${activated}/${total})`);
        return;
      }
    }

    // Light switch
    for (const room of this.state.rooms.values()) {
      if (room.floor !== floor || !room.hasLight) continue;
      const dist = Math.hypot(player.x - room.switchX, player.y - room.switchY);
      if (dist < 40) {
        room.lightOn = !room.lightOn;
        return;
      }
    }

    // Exit
    if (fd.exitActive) {
      for (const exit of this.state.exits.values()) {
        if (exit.floor !== floor || !exit.active) continue;
        const dist = Math.hypot(player.x - exit.x, player.y - exit.y);
        if (dist < 40) {
          this.winGame();
          return;
        }
      }
    }
  }

  // ─── Crack Blind Box ──────────────────────────────────────

  private crackBlindBox(sessionId: string) {
    if (this.state.cracksRemaining <= 0) return;
    const floor = this.state.currentFloor;
    const fd = this.state.floorData.get(String(floor));
    if (!fd || fd.isCracked) return;

    this.state.cracksRemaining--;
    this.state.crackCount++;
    fd.isCracked = true;

    // Mark cracking table as cracked
    for (const ct of this.state.crackingTables.values()) {
      if (ct.floor === floor) { ct.isCracked = true; break; }
    }

    // Grant immunity to all players
    this.state.players.forEach((p) => {
      if (p.state === "alive") p.spawnImmunity = 4000;
    });

    this.showMessage(`正在破解盲盒... (第${this.state.crackCount}次)`);

    // Roll result
    const roll = Math.random();
    const crackBonus = this.state.crackCount - 1;
    const treasureChance = Math.max(0.1, 0.5 - (floor - 1) * 0.1);
    const treasureMonsterChance = Math.max(0.15, 0.3 - (floor - 1) * 0.05);
    const monsterChance = 0.15 + (floor - 1) * 0.05;
    const bossChance = 0.05 + (floor - 1) * 0.075;

    const cfg = FLOOR_CONFIGS[floor - 1];

    if (roll < treasureChance) {
      this.spawnTreasures(this.randInt(3, 5), crackBonus, floor);
      this.showMessage("盲盒结果：财宝散落各处！收集它们！");
    } else if (roll < treasureChance + treasureMonsterChance) {
      this.spawnTreasures(this.randInt(2, 3), crackBonus, floor);
      this.spawnMonsters(this.randInt(1, 2), floor, cfg);
      this.showMessage("盲盒结果：财宝和少量怪物！");
    } else if (roll < treasureChance + treasureMonsterChance + monsterChance) {
      this.spawnTreasures(this.randInt(2, 3), crackBonus, floor);
      this.spawnMonsters(this.randInt(2, 4), floor, cfg);
      this.showMessage("盲盒结果：大量怪物出现！小心！");
    } else if (roll < treasureChance + treasureMonsterChance + monsterChance + bossChance) {
      this.spawnTreasures(1, crackBonus + 1, floor);
      this.spawnBoss(floor, cfg);
      this.showMessage("盲盒结果：BOSS出现！击败或躲避后收集财宝！");
    } else {
      this.triggerSpecialEvent(floor, cfg);
    }

    // Activate evacuation task
    this.activateEvacuationTask(floor, fd);

    // KeyPuzzle: cracking gives the key directly
    if (cfg.evacTaskType === 1) {
      fd.evacCurrent = 1;
      this.showMessage("获得钥匙！可以撤离了！");
    }

    // Init switches for MultiActivate floor
    if (cfg.evacTaskType === 3) {
      this.initFloorSwitches(floor);
    }
  }

  // ─── Treasure Spawning ────────────────────────────────────

  private rollQuality(crackBonus: number, floor: number): number {
    const roll = Math.random();
    let normalChance: number, rareChance: number, epicChance: number, legendaryChance: number;
    switch (floor) {
      case 1: normalChance = 0.70; rareChance = 0.25; epicChance = 0.05; legendaryChance = 0; break;
      case 2: normalChance = 0.50; rareChance = 0.35; epicChance = 0.13; legendaryChance = 0.02; break;
      case 3: normalChance = 0.30; rareChance = 0.40; epicChance = 0.25; legendaryChance = 0.05; break;
      case 4: normalChance = 0.10; rareChance = 0.30; epicChance = 0.35; legendaryChance = 0.25; break;
      default: normalChance = 0; rareChance = 0.15; epicChance = 0.35; legendaryChance = 0.50; break;
    }

    for (let i = 0; i < crackBonus; i++) {
      if (legendaryChance < 0.4) { legendaryChance += 0.15; epicChance += 0.05; rareChance -= 0.10; normalChance -= 0.10; }
    }

    if (roll < legendaryChance) return 3;
    if (roll < legendaryChance + epicChance) return 2;
    if (roll < legendaryChance + epicChance + rareChance) return 1;
    return 0;
  }

  private spawnTreasures(count: number, crackBonus: number, floor: number) {
    const floorRooms = this.serverRooms.filter(r => r.floor === floor);
    for (let i = 0; i < count; i++) {
      const room = floorRooms[this.randInt(0, floorRooms.length - 1)];
      const x = this.randInt(room.x + 40, room.x + room.w - 40);
      const y = this.randInt(room.y + 40, room.y + room.h - 40);
      const quality = this.rollQuality(crackBonus, floor);
      const valRange = QUALITY_VALUE_RANGES[quality];
      const value = this.randInt(valRange[0], valRange[1]);

      const t = new BlindBoxTreasure();
      t.x = x; t.y = y; t.floor = floor; t.value = value; t.quality = quality; t.collected = false;
      this.state.treasures.set(String(this.nextTreasureId++), t);
    }
  }

  // ─── Monster Spawning ──────────────────────────────────────

  private spawnMonsters(count: number, floor: number, cfg: any) {
    const floorRooms = this.serverRooms.filter(r => r.floor === floor);
    for (let i = 0; i < count; i++) {
      const room = floorRooms[this.randInt(1, floorRooms.length - 1)];
      this.createGhost(this.randInt(room.x + 40, room.x + room.w - 40),
        this.randInt(room.y + 40, room.y + room.h - 40), false, floor, cfg);
    }
  }

  private spawnBoss(floor: number, cfg: any) {
    const floorRooms = this.serverRooms.filter(r => r.floor === floor);
    const room = floorRooms[this.randInt(0, floorRooms.length - 1)];
    this.createGhost(room.centerX, room.centerY, true, floor, cfg);
  }

  // ─── Special Events ───────────────────────────────────────

  private triggerSpecialEvent(floor: number, cfg: any) {
    const roll = Math.random();
    if (roll < 0.30) {
      this.spawnTreasures(3, 2, floor);
      this.showMessage("特殊事件：隐藏房间开启！高价值财宝出现！");
    } else if (roll < 0.55) {
      // Ghost seal - freeze all ghosts on this floor
      this.ghostAIs.forEach((ai, id) => {
        if (ai.floor === floor) {
          ai.speed = 0;
          ai.chaseSpeed = 0;
          const ghost = this.state.ghosts.get(id);
          if (ghost) { ghost.speed = 0; ghost.chaseSpeed = 0; }
        }
      });
      // Restore after 60s (will be handled by a delayed check)
      this.clock.setTimeout(() => {
        this.ghostAIs.forEach((ai, id) => {
          if (ai.floor === floor) {
            const fcfg = FLOOR_CONFIGS[floor - 1];
            ai.speed = fcfg.ghostSpeed;
            ai.chaseSpeed = fcfg.ghostChaseSpeed;
            const ghost = this.state.ghosts.get(id);
            if (ghost) { ghost.speed = fcfg.ghostSpeed; ghost.chaseSpeed = fcfg.ghostChaseSpeed; }
          }
        });
      }, 60000);
      this.showMessage("特殊事件：鬼魂封印！所有鬼冻结60秒！");
    } else if (roll < 0.75) {
      this.state.timeWarpTimer = 30000;
      this.ghostAIs.forEach((ai, id) => {
        ai.speed *= 0.5;
        ai.chaseSpeed *= 0.5;
        const ghost = this.state.ghosts.get(id);
        if (ghost) { ghost.speed *= 0.5; ghost.chaseSpeed *= 0.5; }
      });
      this.showMessage("特殊事件：时间扭曲！鬼速度降低50%，持续30秒！");
    } else if (roll < 0.90) {
      this.showMessage("特殊事件：宝藏地图！财宝位置已标记！");
      // Client handles visual indicator
    } else {
      // Curse removal - heal all players
      this.state.players.forEach((p) => {
        if (p.state === "alive") p.health = 100;
      });
      this.showMessage("特殊事件：诅咒解除！全员生命恢复满值！");
    }
  }

  // ─── Evacuation Tasks ─────────────────────────────────────

  private activateEvacuationTask(floor: number, fd: BlindBoxFloorData) {
    const cfg = FLOOR_CONFIGS[floor - 1];
    if (cfg.evacTaskType === 2) {
      // TimedEscape
      fd.evacTimer = cfg.evacTarget * 1000;
      fd.evacTimerActive = true;
      this.showMessage("警报触发！限时逃脱开始！");
    } else if (cfg.evacTaskType === 4) {
      // BossSeal
      this.showMessage("击败BOSS或存活即可撤离！");
    }
  }

  private updateEvacTimer(deltaTime: number) {
    const floor = this.state.currentFloor;
    const fd = this.state.floorData.get(String(floor));
    if (!fd) return;

    if (fd.evacTimerActive && fd.evacTimer > 0) {
      fd.evacTimer -= deltaTime;
      if (fd.evacTimer <= 0) {
        fd.evacTimer = 0;
        fd.evacTimerActive = false;
        this.showMessage("时间到！撤离点已开启！");
        this.completeEvacTask(floor);
      }
    }
  }

  private checkEvacuationComplete() {
    const floor = this.state.currentFloor;
    const fd = this.state.floorData.get(String(floor));
    if (!fd || fd.evacCompleted) return;
    const cfg = FLOOR_CONFIGS[floor - 1];

    switch (cfg.evacTaskType) {
      case 0: // CollectItems
        if (fd.evacCurrent >= fd.evacTarget) this.completeEvacTask(floor);
        break;
      case 1: // KeyPuzzle
        if (fd.evacCurrent >= 1) this.completeEvacTask(floor);
        break;
      case 3: // MultiActivate
        if (Array.from(this.state.switches.values()).filter(s => s.floor === floor).every(s => s.activated)) {
          this.completeEvacTask(floor);
        }
        break;
      case 4: // BossSeal
        if (!Array.from(this.state.ghosts.values()).some(g => g.floor === floor && g.isBoss && g.alive)) {
          this.completeEvacTask(floor);
        }
        break;
      // TimedEscape handled in updateEvacTimer
    }
  }

  private completeEvacTask(floor: number) {
    const fd = this.state.floorData.get(String(floor));
    if (!fd) return;
    fd.evacCompleted = true;
    fd.evacTimerActive = false;
    this.activateExit(floor);

    const taskNames: Record<number, string> = {
      0: '物资收集', 1: '钥匙解谜', 2: '限时逃脱', 3: '多点激活', 4: 'BOSS封印',
    };
    this.showMessage(`撤离任务完成：${taskNames[FLOOR_CONFIGS[floor - 1].evacTaskType] || ''}！前往出口撤离！`);
  }

  private activateExit(floor: number) {
    const fd = this.state.floorData.get(String(floor));
    if (!fd || fd.exitActive) return;
    fd.exitActive = true;

    // Find cracking table room to avoid overlap
    const ct = this.serverCrackingTables.find(c => c.floor === floor);
    const floorRooms = this.serverRooms.filter(r => r.floor === floor);
    let exitRoom = floorRooms[0];
    if (ct) {
      const ctRoom = floorRooms.find(r => ct.x >= r.x && ct.x <= r.x + r.w && ct.y >= r.y && ct.y <= r.y + r.h);
      if (ctRoom) {
        const otherRooms = floorRooms.filter(r => r !== ctRoom);
        if (otherRooms.length > 0) exitRoom = otherRooms[0];
      }
    }

    const exit = new BlindBoxExit();
    exit.x = exitRoom.centerX; exit.y = exitRoom.centerY; exit.floor = floor; exit.active = true;
    this.state.exits.set(String(this.nextExitId++), exit);
  }

  // ─── Stairs ────────────────────────────────────────────────

  private handleStairs(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    const floor = this.state.currentFloor;
    const fd = this.state.floorData.get(String(floor));
    if (!fd || !fd.evacCompleted) {
      this.showMessage("完成当前层撤离任务才能上楼！");
      return;
    }
    if (this.state.cracksRemaining <= 0) {
      this.showMessage("没有破解次数了！请前往出口撤离！");
      return;
    }

    for (const stair of this.state.stairs.values()) {
      if (stair.floor !== floor) continue;
      const dist = Math.hypot(player.x - stair.x, player.y - stair.y);
      if (dist < 50 && stair.direction === "up") {
        this.transitionToFloor(stair.targetFloor);
        return;
      }
    }
    this.showMessage("附近没有上楼楼梯");
  }

  private transitionToFloor(targetFloor: number) {
    // Save current floor ghosts state
    const currentFD = this.state.floorData.get(String(this.state.currentFloor));
    if (currentFD) {
      currentFD.isCracked = currentFD.isCracked;
    }

    this.state.currentFloor = targetFloor;

    // Move all players to target floor spawn
    const targetRooms = this.serverRooms.filter(r => r.floor === targetFloor);
    const targetRoom = targetRooms[3]; // stair room
    let i = 0;
    this.state.players.forEach((player) => {
      if (player.state === "alive" || player.state === "down") {
        player.x = targetRoom.centerX + (i % 4) * 30;
        player.y = targetRoom.centerY + 60 + Math.floor(i / 4) * 30;
        player.spawnImmunity = SPAWN_IMMUNITY_MS;
        i++;
      }
    });

    // Init collectibles for new floor if needed
    const cfg = FLOOR_CONFIGS[targetFloor - 1];
    if (cfg.evacTaskType === 0) {
      // Check if collectibles already exist for this floor
      const hasCollectibles = Array.from(this.state.collectibles.values()).some(c => c.floor === targetFloor);
      if (!hasCollectibles) this.initFloorCollectibles(targetFloor);
    }
    if (cfg.evacTaskType === 3) {
      const hasSwitches = Array.from(this.state.switches.values()).some(s => s.floor === targetFloor);
      if (!hasSwitches) this.initFloorSwitches(targetFloor);
    }

    this.showMessage(`到达 ${targetFloor}F - ${FLOOR_CONFIGS[targetFloor - 1].name}`);
  }

  // ─── Ghost AI ──────────────────────────────────────────────

  private updateGhosts(deltaTime: number) {
    const dt = deltaTime / 1000;
    const floor = this.state.currentFloor;

    this.state.ghosts.forEach((ghost, ghostId) => {
      const ai = this.ghostAIs.get(ghostId);
      if (!ai || !ghost.alive || ai.floor !== floor) return;

      // Attack cooldown
      if (ai.attackCooldown > 0) {
        ai.attackCooldown -= deltaTime;
      }

      // Find nearest alive player
      let nearestPlayer: BlindBoxPlayer | null = null;
      let nearestDist = Infinity;
      for (const p of this.state.players.values()) {
        if (p.state !== "alive") continue;
        const d = Math.hypot(p.x - ghost.x, p.y - ghost.y);
        if (d < nearestDist) { nearestDist = d; nearestPlayer = p; }
      }

      // Vision check
      if (nearestPlayer && nearestDist < ai.visionRange && !ghost.isChasing) {
        ghost.isChasing = true;
        ai.isChasing = true;
        ai.giveUpTimer = ai.giveUpDuration;
      }

      if (ghost.isChasing && nearestPlayer) {
        const dirX = nearestPlayer.x - ghost.x;
        const dirY = nearestPlayer.y - ghost.y;
        const len = Math.hypot(dirX, dirY) || 1;
        const newX = ghost.x + (dirX / len) * ai.chaseSpeed * dt;
        const newY = ghost.y + (dirY / len) * ai.chaseSpeed * dt;
        if (!this.isObstacleAt(newX, ghost.y, floor)) ghost.x = newX;
        if (!this.isObstacleAt(ghost.x, newY, floor)) ghost.y = newY;
        ghost.dirX = dirX / len;
        ghost.dirY = dirY / len;

        ai.giveUpTimer -= deltaTime;
        if (ai.giveUpTimer <= 0 || nearestDist > ai.visionRange * 1.5) {
          ghost.isChasing = false;
          ai.isChasing = false;
        }
      } else {
        // Patrol
        const newX = ghost.x + ghost.dirX * ai.speed * dt;
        const newY = ghost.y + ghost.dirY * ai.speed * dt;
        if (!this.isObstacleAt(newX, ghost.y, floor)) ghost.x = newX;
        else ghost.dirX *= -1;
        if (!this.isObstacleAt(ghost.x, newY, floor)) ghost.y = newY;
        else ghost.dirY *= -1;

        ai.patrolTimer -= deltaTime;
        if (ai.patrolTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          ghost.dirX = Math.cos(angle);
          ghost.dirY = Math.sin(angle);
          ai.patrolTimer = this.randInt(2000, 5000);
        }

        const distFromHome = Math.hypot(ghost.x - ai.homeX, ghost.y - ai.homeY);
        if (distFromHome > 300) {
          const toHomeX = ai.homeX - ghost.x;
          const toHomeY = ai.homeY - ghost.y;
          const hlen = Math.hypot(toHomeX, toHomeY) || 1;
          ghost.dirX = ghost.dirX * 0.9 + (toHomeX / hlen) * 0.1;
          ghost.dirY = ghost.dirY * 0.9 + (toHomeY / hlen) * 0.1;
          const dlen = Math.hypot(ghost.dirX, ghost.dirY) || 1;
          ghost.dirX /= dlen;
          ghost.dirY /= dlen;
        }
      }
    });
  }

  // ─── Ghost Attacks ────────────────────────────────────────

  private updateGhostAttacks(deltaTime: number) {
    const floor = this.state.currentFloor;

    this.state.ghosts.forEach((ghost, ghostId) => {
      const ai = this.ghostAIs.get(ghostId);
      if (!ai || !ghost.alive || ai.floor !== floor) return;
      if (ai.attackCooldown > 0) return;

      this.state.players.forEach((player) => {
        if (player.state !== "alive") return;
        if (player.spawnImmunity > 0) return;
        if (player.damageCooldown > 0) return;

        const dist = Math.hypot(player.x - ghost.x, player.y - ghost.y);
        if (dist < 30) {
          ai.attackCooldown = DAMAGE_COOLDOWN_MS;
          player.health -= ai.damage;
          player.damageCooldown = DAMAGE_COOLDOWN_MS;

          if (player.health <= 0) {
            player.health = 0;
            player.state = "down";
            player.downTimer = 0;
          }
        }
      });
      void ghostId;
    });
  }

  // ─── Downed Players & Revives ─────────────────────────────

  private updateDownedPlayers(deltaTime: number) {
    this.state.players.forEach((player) => {
      if (player.state !== "down") return;
      player.downTimer += deltaTime;

      if (player.reviverId) {
        const reviver = this.state.players.get(player.reviverId);
        if (!reviver || reviver.state !== "alive") {
          player.reviverId = "";
          player.reviveProgress = 0;
          return;
        }
        const dist = Math.hypot(reviver.x - player.x, reviver.y - player.y);
        if (dist > REVIVE_RANGE) {
          player.reviverId = "";
          return;
        }
      }

      if (player.downTimer >= DOWN_DURATION_MS) {
        player.state = "dead";
        player.reviveProgress = 0;
        player.reviverId = "";
      }
    });

    this.checkLoseCondition();
  }

  private updateRevives(deltaTime: number) {
    this.state.players.forEach((player) => {
      if (player.state !== "down" || !player.reviverId) return;
      const reviver = this.state.players.get(player.reviverId);
      if (!reviver || reviver.state !== "alive") return;
      const dist = Math.hypot(reviver.x - player.x, reviver.y - player.y);
      if (dist > REVIVE_RANGE) return;

      player.reviveProgress += REVIVE_RATE_PER_SEC * (deltaTime / 1000);
      if (player.reviveProgress >= 100) {
        player.state = "alive";
        player.health = 50;
        player.reviveProgress = 0;
        player.reviverId = "";
        player.downTimer = 0;
        player.spawnImmunity = SPAWN_IMMUNITY_MS;
      }
    });
  }

  private checkLoseCondition() {
    let aliveCount = 0;
    let downCount = 0;
    this.state.players.forEach((p) => {
      if (p.state === "alive") aliveCount++;
      else if (p.state === "down") downCount++;
    });

    if (this.state.players.size > 0 && aliveCount === 0 && downCount === 0) {
      this.state.phase = "dead";
      this.showMessage("全员阵亡...游戏结束");
    }
  }

  // ─── Treasure Pickup ──────────────────────────────────────

  private updateTreasurePickup() {
    // Auto-pickup is handled via interact message, not here
    // This is a no-op to keep the update loop clean
  }

  // ─── Win ──────────────────────────────────────────────────

  private winGame() {
    this.state.phase = "won";
    const fd = this.state.floorData.get(String(this.state.currentFloor));
    const mult = fd ? fd.rewardMult : 1;
    this.state.finalScore = Math.floor(this.state.teamScore * mult);
    this.showMessage(`撤离成功！\n财宝分数: ${this.state.teamScore}\n楼层加成: x${mult}\n最终分数: ${this.state.finalScore}`);
  }

  // ─── Collision Helpers ────────────────────────────────────

  private isObstacleAt(px: number, py: number, floor: number): boolean {
    for (const obs of this.serverObstacles) {
      if (obs.floor !== floor) continue;
      if (px >= obs.x && px <= obs.x + obs.w && py >= obs.y && py <= obs.y + obs.h) {
        return true;
      }
    }
    return false;
  }

  // ─── Utility ──────────────────────────────────────────────

  private randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private showMessage(msg: string) {
    this.state.messageText = msg;
    this.state.messageTimer = 3000;
  }
}
