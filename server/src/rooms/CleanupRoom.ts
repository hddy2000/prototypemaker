import { Room, Client } from "@colyseus/core";
import {
  CleanupPlayer,
  CleanupMonster,
  CleanupStain,
  CleanupLoot,
  CleanupObstacle,
  CleanupHideSpot,
  CleanupGameState,
} from "../schema/CleanupState.js";

// ─── Constants ───────────────────────────────────────────────

const PLAYER_COLORS = [
  "#ff6b6b",
  "#4ecdc4",
  "#45b7d1",
  "#f9ca24",
  "#6c5ce7",
  "#a8e6cf",
  "#fd79a8",
  "#fdcb6e",
];

const MAP_WIDTH = 2400;
const MAP_HEIGHT = 1600;
const PLAYER_RADIUS = 12;
const PLAYER_BASE_SPEED = 160;
const PLAYER_SPRINT_SPEED = 260;
const STAMINA_MAX = 100;
const STAMINA_DRAIN_RATE = 35;
const STAMINA_REGEN_RATE = 20;
const STAMINA_SPRINT_MIN = 5;

const SPRAY_RANGE = 160;
const SPRAY_HALF_ANGLE = Math.PI / 6;
const CLEAN_POWER_PER_SEC = 80;

const MONSTER_VISION_RANGE_HUNTER = 220;
const MONSTER_VISION_RANGE_NORMAL = 160;
const MONSTER_VISION_ANGLE = Math.PI / 3;
const MONSTER_PATROL_SPEED_HUNTER = 40;
const MONSTER_PATROL_SPEED_NORMAL = 30;
const MONSTER_CHASE_SPEED_HUNTER = 185;
const MONSTER_CHASE_SPEED_NORMAL = 170;
const MONSTER_GIVEUP_DURATION_HUNTER = 10000;
const MONSTER_GIVEUP_DURATION_NORMAL = 8000;
const MONSTER_STUN_DURATION = 2000;
const MONSTER_ATTACK_COOLDOWN = 800;
const MONSTER_DAMAGE = 15;
const HIDE_LOSE_AGGRO_TIME = 3000;

const DOWN_DURATION_MS = 15000; // 15s to revive before dying
const REVIVE_RATE_PER_SEC = 100 / 3; // 3 seconds to fully revive
const REVIVE_RANGE = 50;

const GOAL_SCORE = 1000;
const EVAC_DURATION_MS = 3000;
const ROUND_DURATION_MS = 180000; // 3 minutes

const SPAWN_POINT = { x: 80, y: 80 };
const EXIT_POINT = { x: MAP_WIDTH - 80, y: MAP_HEIGHT - 80 };

// ─── Types ───────────────────────────────────────────────────

interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface HideSpot {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MonsterAI {
  id: string;
  isHunter: boolean;
  isChasing: boolean;
  homeX: number;
  homeY: number;
  patrolTimer: number;
  giveUpTimer: number;
  giveUpDuration: number;
  stunTimer: number;
  attackCooldown: number;
  returnHomeTimer: number;
  lastSeenX: number;
  lastSeenY: number;
  hasLastSeen: boolean;
  searchingTimer: number;
}

type LootType = "gold" | "gem" | "medkit" | "shield";

const POSITIVE_TABLE: { type: LootType; weight: number; value: number }[] = [
  { type: "gold", weight: 50, value: 10 },
  { type: "gem", weight: 30, value: 50 },
  { type: "medkit", weight: 15, value: 30 },
  { type: "shield", weight: 5, value: 0 },
];

type NegativeType = "spawn_monster" | "alarm" | "blind" | "slow";

const NEGATIVE_TABLE: { type: NegativeType; weight: number }[] = [
  { type: "spawn_monster", weight: 60 },
  { type: "alarm", weight: 20 },
  { type: "blind", weight: 15 },
  { type: "slow", weight: 5 },
];

// ─── Room ────────────────────────────────────────────────────

export class CleanupRoom extends Room<CleanupGameState> {
  maxClients = 8;

  private obstacles: Obstacle[] = [];
  private hideSpots: HideSpot[] = [];
  private monsterAIs: Map<string, MonsterAI> = new Map();
  private nextMonsterId = 1;
  private nextLootId = 1;
  private nextStainId = 1;
  private evacTimers: Map<string, number> = new Map(); // sessionId → remaining ms
  private sprayCooldowns: Map<string, number> = new Map(); // sessionId → last spray time

  onCreate(_options: any) {
    console.log(`[CleanupRoom] onCreate roomId=${this.roomId}`);
    this.setState(new CleanupGameState());

    this.state.mapWidth = MAP_WIDTH;
    this.state.mapHeight = MAP_HEIGHT;
    this.state.goalScore = GOAL_SCORE;
    this.state.exitX = EXIT_POINT.x;
    this.state.exitY = EXIT_POINT.y;

    this.generateBuilding();
    this.generateHideRooms();
    this.createStains();

    // Sync obstacles + hide spots to state (so client can render them)
    let obsId = 1;
    for (const obs of this.obstacles) {
      const o = new CleanupObstacle();
      o.x = obs.x;
      o.y = obs.y;
      o.w = obs.w;
      o.h = obs.h;
      this.state.obstacles.set(String(obsId++), o);
    }
    let hsId = 1;
    for (const hs of this.hideSpots) {
      const h = new CleanupHideSpot();
      h.x = hs.x;
      h.y = hs.y;
      h.w = hs.w;
      h.h = hs.h;
      this.state.hideSpots.set(String(hsId++), h);
    }

    // ── Message handlers ──

    this.onMessage("move", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.state !== "alive") return;

      const dt = (message.dt as number) || 16;
      this.handlePlayerMovement(player, message, dt);
    });

    this.onMessage("spray", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.state !== "alive" || player.isHidden) return;

      player.isSpraying = !!message.spraying;
      if (typeof message.angle === "number") {
        player.sprayAngle = message.angle;
      }
    });

    this.onMessage("hide", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || player.state !== "alive") return;

      if (player.isHidden) {
        this.exitHide(player);
      } else {
        this.tryHide(player);
      }
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
    const player = new CleanupPlayer();
    const colorIndex = this.state.players.size % PLAYER_COLORS.length;
    player.color = PLAYER_COLORS[colorIndex];
    player.x = SPAWN_POINT.x + (this.state.players.size % 4) * 30;
    player.y = SPAWN_POINT.y + (Math.floor(this.state.players.size / 4)) * 30;
    player.health = 100;
    player.state = "alive";
    player.score = 0;
    player.stamina = STAMINA_MAX;
    this.state.players.set(client.sessionId, player);

    this.maybeStartRound();
    console.log(`[CleanupRoom] onJoin roomId=${this.roomId} sessionId=${client.sessionId} color=${player.color}`);
  }

  onLeave(client: Client, _consented: boolean) {
    this.state.players.delete(client.sessionId);
    this.evacTimers.delete(client.sessionId);
    this.sprayCooldowns.delete(client.sessionId);

    if (this.state.phase === "waiting") {
      this.maybeStartRound();
    }
    console.log(`[CleanupRoom] onLeave roomId=${this.roomId} sessionId=${client.sessionId}`);
  }

  onDispose() {
    console.log("CleanupRoom disposed");
  }

  // ─── Round management ──────────────────────────────────────

  private maybeStartRound() {
    if (this.state.players.size < 1) {
      this.state.phase = "waiting";
      return;
    }

    if (this.state.phase === "active") return;

    this.state.phase = "active";
    this.state.teamScore = 0;
    this.state.roundEndsAt = Date.now() + ROUND_DURATION_MS;

    // Reset all players
    let i = 0;
    this.state.players.forEach((player, _sessionId) => {
      player.x = SPAWN_POINT.x + (i % 4) * 30;
      player.y = SPAWN_POINT.y + (Math.floor(i / 4)) * 30;
      player.health = 100;
      player.state = "alive";
      player.score = 0;
      player.hasShield = false;
      player.isHidden = false;
      player.isSpraying = false;
      player.stamina = STAMINA_MAX;
      player.blindTimer = 0;
      player.slowTimer = 0;
      player.downTimer = 0;
      player.reviveProgress = 0;
      player.reviverId = "";
      i++;
    });

    // Clear monsters + loot, respawn monsters
    Array.from(this.state.monsters.keys()).forEach((id) => this.state.monsters.delete(id));
    this.monsterAIs.clear();
    Array.from(this.state.loots.keys()).forEach((id) => this.state.loots.delete(id));

    this.createMonsters();
  }

  // ─── Main update ───────────────────────────────────────────

  private update(deltaTime: number) {
    if (this.state.phase !== "active") return;

    const dt = deltaTime / 1000;

    this.updateSprayCleaning(deltaTime);
    this.updateMonsters(deltaTime);
    this.updateMonsterAttacks(deltaTime);
    this.updateDownedPlayers(deltaTime);
    this.updateRevives(deltaTime);
    this.updateLootPickup();
    this.updateEvacuation(deltaTime);
    this.updateNegativeEffects(deltaTime);
    this.updateRoundTimer();
  }

  // ─── Player movement ───────────────────────────────────────

  private handlePlayerMovement(player: CleanupPlayer, message: any, deltaMs: number) {
    if (player.isHidden) return;

    const dt = deltaMs / 1000;
    const inputX = message.inputX || 0;
    const inputY = message.inputY || 0;
    const wantSprint = !!message.sprint && (inputX !== 0 || inputY !== 0) && player.stamina > 0;

    if (wantSprint) {
      player.stamina = Math.max(0, player.stamina - STAMINA_DRAIN_RATE * dt);
    } else {
      player.stamina = Math.min(STAMINA_MAX, player.stamina + STAMINA_REGEN_RATE * dt);
    }

    const slowFactor = player.slowTimer > 0 ? 0.5 : 1;
    const baseSpeed = wantSprint ? PLAYER_SPRINT_SPEED : PLAYER_BASE_SPEED;
    const speed = baseSpeed * slowFactor;

    let vx = inputX * speed;
    let vy = inputY * speed;

    if (vx !== 0 && vy !== 0) {
      const len = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / len) * speed;
      vy = (vy / len) * speed;
    }

    const halfSize = PLAYER_RADIUS;

    if (vx !== 0) {
      const dx = vx * dt;
      const newX = player.x + dx;
      const edgeX = newX + (dx > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(edgeX, player.y - halfSize) &&
          !this.isObstacleAt(edgeX, player.y + halfSize)) {
        player.x = newX;
      }
    }

    if (vy !== 0) {
      const dy = vy * dt;
      const newY = player.y + dy;
      const edgeY = newY + (dy > 0 ? halfSize : -halfSize);
      if (!this.isObstacleAt(player.x - halfSize, edgeY) &&
          !this.isObstacleAt(player.x + halfSize, edgeY)) {
        player.y = newY;
      }
    }

    player.x = Math.max(16, Math.min(MAP_WIDTH - 16, player.x));
    player.y = Math.max(16, Math.min(MAP_HEIGHT - 16, player.y));

    if (typeof message.rotation === "number") {
      player.rotation = message.rotation;
    }
  }

  // ─── Spray & stain cleaning ────────────────────────────────

  private updateSprayCleaning(deltaTime: number) {
    const cleanPower = CLEAN_POWER_PER_SEC * (deltaTime / 1000);

    this.state.players.forEach((player) => {
      if (!player.isSpraying || player.state !== "alive" || player.isHidden) return;

      const px = player.x;
      const py = player.y;
      const a = player.sprayAngle;
      const halfAngle = SPRAY_HALF_ANGLE;
      const range = SPRAY_RANGE;

      // Clean stains
      this.state.stains.forEach((stain) => {
        if (stain.cleaned) return;

        const dx = stain.x - px;
        const dy = stain.y - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range + stain.radius) return;

        const stainAngle = Math.atan2(dy, dx);
        let diff = Math.abs(stainAngle - a);
        while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
        if (diff > halfAngle) return;

        stain.cleanliness -= cleanPower;
        if (stain.cleanliness <= 0) {
          stain.cleaned = true;
          this.onStainCleaned(stain.x, stain.y);
        }
      });

      // Spray hits monsters → stun + knockback
      this.state.monsters.forEach((monster, monsterId) => {
        const dx = monster.x - px;
        const dy = monster.y - py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > range + 16) return;

        const monAngle = Math.atan2(dy, dx);
        let diff = Math.abs(monAngle - a);
        while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
        if (diff > halfAngle) return;

        const ai = this.monsterAIs.get(monsterId);
        if (!ai) return;

        ai.stunTimer = MONSTER_STUN_DURATION;
        monster.stunTimer = MONSTER_STUN_DURATION;
        ai.giveUpTimer = 0;

        // Knockback
        const klen = dist || 1;
        const knockback = 60 * (deltaTime / 1000);
        const newX = monster.x + (dx / klen) * knockback;
        const newY = monster.y + (dy / klen) * knockback;
        if (!this.isObstacleAt(newX, monster.y)) monster.x = newX;
        if (!this.isObstacleAt(monster.x, newY)) monster.y = newY;
      });
    });
  }

  private onStainCleaned(x: number, y: number) {
    if (Math.random() < 0.6) {
      this.spawnPositiveLoot(x, y);
    } else {
      this.triggerNegativeEffect(x, y);
    }
  }

  // ─── Loot ──────────────────────────────────────────────────

  private spawnPositiveLoot(x: number, y: number) {
    const totalWeight = POSITIVE_TABLE.reduce((s, e) => s + e.weight, 0);
    let roll = Math.random() * totalWeight;
    let chosen = POSITIVE_TABLE[0];
    for (const entry of POSITIVE_TABLE) {
      roll -= entry.weight;
      if (roll <= 0) {
        chosen = entry;
        break;
      }
    }

    const loot = new CleanupLoot();
    loot.x = x;
    loot.y = y;
    loot.type = chosen.type;
    loot.value = chosen.value;
    loot.collected = false;
    this.state.loots.set(String(this.nextLootId++), loot);
  }

  private updateLootPickup() {
    this.state.loots.forEach((loot, lootId) => {
      if (loot.collected) return;

      this.state.players.forEach((player) => {
        if (player.state !== "alive" || loot.collected) return;
        const dist = Math.hypot(player.x - loot.x, player.y - loot.y);
        if (dist < 25) {
          loot.collected = true;

          if (loot.type === "medkit") {
            player.health = Math.min(100, player.health + 30);
          } else if (loot.type === "shield") {
            player.hasShield = true;
          } else {
            player.score += loot.value;
            this.state.teamScore += loot.value;
          }
        }
      });

      if (loot.collected) {
        this.state.loots.delete(lootId);
      }
    });
  }

  // ─── Negative effects ──────────────────────────────────────

  private triggerNegativeEffect(x: number, y: number) {
    const totalWeight = NEGATIVE_TABLE.reduce((s, e) => s + e.weight, 0);
    let roll = Math.random() * totalWeight;
    let chosen: NegativeType = "spawn_monster";
    for (const entry of NEGATIVE_TABLE) {
      roll -= entry.weight;
      if (roll <= 0) {
        chosen = entry.type;
        break;
      }
    }

    switch (chosen) {
      case "spawn_monster":
        this.spawnMonsterNear(x, y, true);
        break;
      case "alarm":
        this.monsterAIs.forEach((ai) => {
          ai.isChasing = true;
          ai.giveUpTimer = 5000;
        });
        this.state.monsters.forEach((m) => { m.isChasing = true; });
        break;
      case "blind":
        this.state.players.forEach((p) => {
          if (p.state === "alive") p.blindTimer = 4000;
        });
        break;
      case "slow":
        this.state.players.forEach((p) => {
          if (p.state === "alive") p.slowTimer = 5000;
        });
        break;
    }
  }

  private spawnMonsterNear(x: number, y: number, isHunter: boolean) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 100) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 120;
      const mx = x + Math.cos(angle) * dist;
      const my = y + Math.sin(angle) * dist;

      if (mx > 30 && mx < MAP_WIDTH - 30 && my > 30 && my < MAP_HEIGHT - 30) {
        if (!this.isInsideObstacle(mx, my, 14)) {
          const id = String(this.nextMonsterId++);
          const monster = new CleanupMonster();
          monster.x = mx;
          monster.y = my;
          monster.isHunter = isHunter;
          monster.isChasing = true;
          monster.stunTimer = 0;
          monster.dirX = Math.cos(angle);
          monster.dirY = Math.sin(angle);
          this.state.monsters.set(id, monster);

          this.monsterAIs.set(id, {
            id,
            isHunter,
            isChasing: true,
            homeX: mx,
            homeY: my,
            patrolTimer: 0,
            giveUpTimer: 10000,
            giveUpDuration: isHunter ? MONSTER_GIVEUP_DURATION_HUNTER : MONSTER_GIVEUP_DURATION_NORMAL,
            stunTimer: 0,
            attackCooldown: 0,
            returnHomeTimer: 0,
            lastSeenX: x,
            lastSeenY: y,
            hasLastSeen: true,
            searchingTimer: 0,
          });
          placed = true;
        }
      }
      attempts++;
    }
  }

  private updateNegativeEffects(deltaTime: number) {
    this.state.players.forEach((player) => {
      if (player.blindTimer > 0) player.blindTimer -= deltaTime;
      if (player.slowTimer > 0) player.slowTimer -= deltaTime;
    });
  }

  // ─── Monster AI ─────────────────────────────────────────────

  private updateMonsters(deltaTime: number) {
    const dt = deltaTime / 1000;

    this.state.monsters.forEach((monster, monsterId) => {
      const ai = this.monsterAIs.get(monsterId);
      if (!ai) return;

      // Stun
      if (ai.stunTimer > 0) {
        ai.stunTimer -= deltaTime;
        monster.stunTimer = ai.stunTimer;
        return;
      }
      monster.stunTimer = 0;

      // Attack cooldown
      if (ai.attackCooldown > 0) {
        ai.attackCooldown -= deltaTime;
        return;
      }

      // Find nearest alive, non-hidden player
      let nearestPlayer: CleanupPlayer | null = null;
      let nearestDist = Infinity;
      for (const p of this.state.players.values()) {
        if (p.state !== "alive" || p.isHidden) continue;
        const d = Math.hypot(p.x - monster.x, p.y - monster.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestPlayer = p;
        }
      }

      const visionRange = ai.isHunter ? MONSTER_VISION_RANGE_HUNTER : MONSTER_VISION_RANGE_NORMAL;
      let canSee = false;
      if (nearestPlayer && nearestDist < visionRange) {
        canSee = !this.lineBlockedByObstacle(monster.x, monster.y, nearestPlayer.x, nearestPlayer.y);
      }

      if (canSee && nearestPlayer) {
        ai.isChasing = true;
        monster.isChasing = true;
        ai.giveUpTimer = ai.giveUpDuration;
        ai.lastSeenX = nearestPlayer.x;
        ai.lastSeenY = nearestPlayer.y;
        ai.hasLastSeen = true;
        ai.searchingTimer = 0;
      } else if (ai.isChasing) {
        // Go to last known position
        if (ai.hasLastSeen) {
          const distToLastSeen = Math.hypot(monster.x - ai.lastSeenX, monster.y - ai.lastSeenY);
          if (distToLastSeen > 25) {
            const dirX = ai.lastSeenX - monster.x;
            const dirY = ai.lastSeenY - monster.y;
            const len = Math.hypot(dirX, dirY) || 1;
            const chaseSpeed = ai.isHunter ? MONSTER_CHASE_SPEED_HUNTER : MONSTER_CHASE_SPEED_NORMAL;
            const newX = monster.x + (dirX / len) * chaseSpeed * dt;
            const newY = monster.y + (dirY / len) * chaseSpeed * dt;
            if (!this.isObstacleAt(newX, monster.y)) monster.x = newX;
            if (!this.isObstacleAt(monster.x, newY)) monster.y = newY;
            monster.dirX = dirX / len;
            monster.dirY = dirY / len;
            return;
          } else {
            // Search
            ai.searchingTimer += deltaTime;
            ai.patrolTimer += deltaTime;
            if (ai.patrolTimer > 800) {
              ai.patrolTimer = 0;
              const angle = Math.random() * Math.PI * 2;
              monster.dirX = Math.cos(angle);
              monster.dirY = Math.sin(angle);
            }
            const patrolSpeed = (ai.isHunter ? MONSTER_PATROL_SPEED_HUNTER : MONSTER_PATROL_SPEED_NORMAL) * 1.5;
            const newX = monster.x + monster.dirX * patrolSpeed * dt;
            const newY = monster.y + monster.dirY * patrolSpeed * dt;
            if (!this.isObstacleAt(newX, monster.y)) monster.x = newX;
            else monster.dirX *= -1;
            if (!this.isObstacleAt(monster.x, newY)) monster.y = newY;
            else monster.dirY *= -1;

            if (ai.searchingTimer > HIDE_LOSE_AGGRO_TIME) {
              ai.hasLastSeen = false;
              ai.giveUpTimer -= deltaTime;
              if (ai.giveUpTimer <= 0) {
                ai.isChasing = false;
                monster.isChasing = false;
                ai.searchingTimer = 0;
              }
            }
            return;
          }
        } else {
          ai.giveUpTimer -= deltaTime;
          if (ai.giveUpTimer <= 0) {
            ai.isChasing = false;
            monster.isChasing = false;
          }
        }
      }

      if (ai.isChasing && nearestPlayer) {
        const dirX = nearestPlayer.x - monster.x;
        const dirY = nearestPlayer.y - monster.y;
        const len = Math.hypot(dirX, dirY) || 1;
        const chaseSpeed = ai.isHunter ? MONSTER_CHASE_SPEED_HUNTER : MONSTER_CHASE_SPEED_NORMAL;
        const newX = monster.x + (dirX / len) * chaseSpeed * dt;
        const newY = monster.y + (dirY / len) * chaseSpeed * dt;
        if (!this.isObstacleAt(newX, monster.y)) monster.x = newX;
        if (!this.isObstacleAt(monster.x, newY)) monster.y = newY;
        monster.dirX = dirX / len;
        monster.dirY = dirY / len;
      } else {
        // Patrol
        ai.patrolTimer += deltaTime;
        if (ai.patrolTimer > 3000) {
          ai.patrolTimer = 0;
          const angle = Math.random() * Math.PI * 2;
          monster.dirX = Math.cos(angle);
          monster.dirY = Math.sin(angle);
        }

        let returnHome = false;
        if (ai.returnHomeTimer > 0) {
          ai.returnHomeTimer -= deltaTime;
          returnHome = true;
        }

        const distFromHome = Math.hypot(monster.x - ai.homeX, monster.y - ai.homeY);
        if (returnHome || distFromHome > 400) {
          const toHomeX = ai.homeX - monster.x;
          const toHomeY = ai.homeY - monster.y;
          const hlen = Math.hypot(toHomeX, toHomeY) || 1;
          monster.dirX = monster.dirX * 0.9 + (toHomeX / hlen) * 0.1;
          monster.dirY = monster.dirY * 0.9 + (toHomeY / hlen) * 0.1;
          const dlen = Math.hypot(monster.dirX, monster.dirY) || 1;
          monster.dirX /= dlen;
          monster.dirY /= dlen;
        }

        const patrolSpeed = ai.isHunter ? MONSTER_PATROL_SPEED_HUNTER : MONSTER_PATROL_SPEED_NORMAL;
        const newX = monster.x + monster.dirX * patrolSpeed * dt;
        const newY = monster.y + monster.dirY * patrolSpeed * dt;
        if (!this.isObstacleAt(newX, monster.y)) monster.x = newX;
        else monster.dirX *= -1;
        if (!this.isObstacleAt(monster.x, newY)) monster.y = newY;
        else monster.dirY *= -1;
      }
    });
  }

  // ─── Monster attacks ───────────────────────────────────────

  private updateMonsterAttacks(deltaTime: number) {
    this.state.monsters.forEach((monster, monsterId) => {
      const ai = this.monsterAIs.get(monsterId);
      if (!ai || ai.stunTimer > 0 || ai.attackCooldown > 0) return;

      this.state.players.forEach((player) => {
        if (player.state !== "alive" || player.isHidden) return;
        const dist = Math.hypot(player.x - monster.x, player.y - monster.y);
        if (dist < 28) {
          // Attack!
          ai.attackCooldown = MONSTER_ATTACK_COOLDOWN;

          if (player.hasShield) {
            player.hasShield = false;
            // Knockback monster
            const kx = monster.x - player.x;
            const ky = monster.y - player.y;
            const klen = Math.hypot(kx, ky) || 1;
            const newX = monster.x + (kx / klen) * 40;
            const newY = monster.y + (ky / klen) * 40;
            if (!this.isObstacleAt(newX, monster.y)) monster.x = newX;
            if (!this.isObstacleAt(monster.x, newY)) monster.y = newY;
          } else {
            player.health -= MONSTER_DAMAGE;
            // Knockback player
            const kx = player.x - monster.x;
            const ky = player.y - monster.y;
            const klen = Math.hypot(kx, ky) || 1;
            const newX = player.x + (kx / klen) * 20;
            const newY = player.y + (ky / klen) * 20;
            if (!this.isObstacleAt(newX, player.y)) player.x = newX;
            if (!this.isObstacleAt(player.x, newY)) player.y = newY;

            if (player.health <= 0) {
              player.health = 0;
              player.state = "down";
              player.downTimer = 0;
              player.isSpraying = false;
            }
          }
        }
      });

      // unused: monsterId
      void monsterId;
    });
  }

  // ─── Downed players & revives ──────────────────────────────

  private updateDownedPlayers(deltaTime: number) {
    this.state.players.forEach((player) => {
      if (player.state !== "down") return;

      player.downTimer += deltaTime;

      // Check if being revived
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
          // Don't reset progress — keep partial
          return;
        }
        // Revive progress handled in updateRevives
      }

      // Bleed out
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
      }
    });
  }

  private checkLoseCondition() {
    // Lose if all players are dead
    let aliveCount = 0;
    let downCount = 0;
    let deadCount = 0;
    this.state.players.forEach((p) => {
      if (p.state === "alive") aliveCount++;
      else if (p.state === "down") downCount++;
      else if (p.state === "dead") deadCount++;
    });

    if (this.state.players.size > 0 && aliveCount === 0 && downCount === 0) {
      this.state.phase = "lost";
    }
  }

  // ─── Evacuation ────────────────────────────────────────────

  private updateEvacuation(deltaTime: number) {
    this.state.players.forEach((player, sessionId) => {
      if (player.state !== "alive") return;

      const dist = Math.hypot(player.x - this.state.exitX, player.y - this.state.exitY);

      if (dist < 40 && this.state.teamScore >= this.state.goalScore) {
        // Player is at exit with enough score → start evac
        let timer = this.evacTimers.get(sessionId) ?? EVAC_DURATION_MS;
        timer -= deltaTime;
        this.evacTimers.set(sessionId, timer);

        if (timer <= 0) {
          // This player escaped!
          player.state = "dead"; // "escaped" — treat as out of game
          this.evacTimers.delete(sessionId);

          // Check if all alive players escaped
          let stillAlive = 0;
          this.state.players.forEach((p) => {
            if (p.state === "alive" || p.state === "down") stillAlive++;
          });
          if (stillAlive === 0) {
            this.state.phase = "won";
          }
        }
      } else {
        this.evacTimers.delete(sessionId);
      }
    });
  }

  // ─── Round timer ───────────────────────────────────────────

  private updateRoundTimer() {
    if (Date.now() >= this.state.roundEndsAt) {
      // Time's up — check win/lose
      if (this.state.teamScore >= this.state.goalScore) {
        this.state.phase = "won";
      } else {
        this.state.phase = "lost";
      }
    }
  }

  // ─── Hide system ───────────────────────────────────────────

  private tryHide(player: CleanupPlayer) {
    let nearest: HideSpot | null = null;
    let minD = 40;
    for (const hs of this.hideSpots) {
      const cx = hs.x + hs.w / 2;
      const cy = hs.y + hs.h / 2;
      const d = Math.hypot(player.x - cx, player.y - cy);
      if (d < minD) {
        minD = d;
        nearest = hs;
      }
    }

    if (nearest) {
      player.isHidden = true;
      player.x = nearest.x + nearest.w / 2;
      player.y = nearest.y + nearest.h / 2;
      player.isSpraying = false;

      // Clear all monster aggro
      this.monsterAIs.forEach((ai) => {
        ai.isChasing = false;
        ai.hasLastSeen = false;
        ai.searchingTimer = 0;
        ai.returnHomeTimer = 5000;
      });
      this.state.monsters.forEach((m) => { m.isChasing = false; });
    }
  }

  private exitHide(player: CleanupPlayer) {
    // Find the hide spot the player is in
    for (const hs of this.hideSpots) {
      const cx = hs.x + hs.w / 2;
      const cy = hs.y + hs.h / 2;
      if (Math.hypot(player.x - cx, player.y - cy) < 20) {
        player.x = hs.x + hs.w / 2;
        player.y = hs.y + hs.h + 20;
        break;
      }
    }
    player.isHidden = false;
  }

  // ─── Map generation ────────────────────────────────────────

  private generateBuilding() {
    this.obstacles = [];

    // Outer walls
    this.obstacles.push({ x: 0, y: 0, w: MAP_WIDTH, h: 20 });
    this.obstacles.push({ x: 0, y: MAP_HEIGHT - 20, w: MAP_WIDTH, h: 20 });
    this.obstacles.push({ x: 0, y: 0, w: 20, h: MAP_HEIGHT });
    this.obstacles.push({ x: MAP_WIDTH - 20, y: 0, w: 20, h: MAP_HEIGHT });

    const cols = 4;
    const rows = 3;
    const cellW = MAP_WIDTH / cols;
    const cellH = MAP_HEIGHT / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const roomX = c * cellW;
        const roomY = r * cellH;
        const walls = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < walls; i++) {
          const isHorizontal = Math.random() > 0.5;
          if (isHorizontal) {
            const wallY = roomY + cellH * (0.3 + Math.random() * 0.4);
            const gapStart = cellW * (0.1 + Math.random() * 0.4);
            const gapW = cellW * (0.2 + Math.random() * 0.15);
            if (gapStart > 30) {
              this.obstacles.push({ x: roomX + 20, y: wallY, w: gapStart - 20, h: 16 });
            }
            const rightStart = gapStart + gapW;
            const rightW = cellW - rightStart - 20;
            if (rightW > 30) {
              this.obstacles.push({ x: roomX + rightStart, y: wallY, w: rightW, h: 16 });
            }
          } else {
            const wallX = roomX + cellW * (0.3 + Math.random() * 0.4);
            const gapStart = cellH * (0.1 + Math.random() * 0.4);
            const gapH = cellH * (0.2 + Math.random() * 0.15);
            if (gapStart > 30) {
              this.obstacles.push({ x: wallX, y: roomY + 20, w: 16, h: gapStart - 20 });
            }
            const bottomStart = gapStart + gapH;
            const bottomH = cellH - bottomStart - 20;
            if (bottomH > 30) {
              this.obstacles.push({ x: wallX, y: roomY + bottomStart, w: 16, h: bottomH });
            }
          }
        }
      }
    }

    // Random furniture
    for (let i = 0; i < 20; i++) {
      const w = 20 + Math.floor(Math.random() * 30);
      const h = 20 + Math.floor(Math.random() * 30);
      const x = 100 + Math.floor(Math.random() * (MAP_WIDTH - 200 - w));
      const y = 100 + Math.floor(Math.random() * (MAP_HEIGHT - 200 - h));
      if (x < 200 && y < 200) continue;
      if (x + w > MAP_WIDTH - 200 && y + h > MAP_HEIGHT - 200) continue;
      this.obstacles.push({ x, y, w, h });
    }
  }

  private generateHideRooms() {
    this.hideSpots = [];
    const roomCount = 7;
    const roomSize = 90;
    const wallT = 12;
    const doorGap = 36;
    let placed = 0;
    let attempts = 0;

    while (placed < roomCount && attempts < 500) {
      attempts++;
      const x = 120 + Math.floor(Math.random() * (MAP_WIDTH - 240 - roomSize));
      const y = 120 + Math.floor(Math.random() * (MAP_HEIGHT - 240 - roomSize));

      if (Math.hypot(x + roomSize / 2 - 80, y + roomSize / 2 - 80) < 200) continue;
      if (Math.hypot(x + roomSize / 2 - (MAP_WIDTH - 80), y + roomSize / 2 - (MAP_HEIGHT - 80)) < 200) continue;

      let tooClose = false;
      for (const hs of this.hideSpots) {
        if (Math.hypot(x + roomSize / 2 - (hs.x + hs.w / 2), y + roomSize / 2 - (hs.y + hs.h / 2)) < 250) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      let overlaps = false;
      for (const obs of this.obstacles) {
        if (x < obs.x + obs.w + 20 && x + roomSize + 20 > obs.x &&
            y < obs.y + obs.h + 20 && y + roomSize + 20 > obs.y) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;

      // Walls with door gaps
      this.obstacles.push({ x: x - wallT, y: y - wallT, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: x + (roomSize + doorGap) / 2, y: y - wallT, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: x - wallT, y: y + roomSize, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: x + (roomSize + doorGap) / 2, y: y + roomSize, w: (roomSize - doorGap) / 2 + wallT, h: wallT });
      this.obstacles.push({ x: x - wallT, y: y, w: wallT, h: (roomSize - doorGap) / 2 });
      this.obstacles.push({ x: x - wallT, y: y + (roomSize + doorGap) / 2, w: wallT, h: (roomSize - doorGap) / 2 });
      this.obstacles.push({ x: x + roomSize, y: y, w: wallT, h: (roomSize - doorGap) / 2 });
      this.obstacles.push({ x: x + roomSize, y: y + (roomSize + doorGap) / 2, w: wallT, h: (roomSize - doorGap) / 2 });

      this.hideSpots.push({ x, y, w: roomSize, h: roomSize });
      placed++;
    }
  }

  private createStains() {
    const stainCount = 35;
    let placed = 0;
    let attempts = 0;

    while (placed < stainCount && attempts < 1000) {
      const x = 60 + Math.floor(Math.random() * (MAP_WIDTH - 120));
      const y = 60 + Math.floor(Math.random() * (MAP_HEIGHT - 120));

      if (Math.hypot(x - 80, y - 80) < 150) {
        attempts++;
        continue;
      }

      if (this.isInsideObstacle(x, y, 18)) {
        attempts++;
        continue;
      }

      const radius = 12 + Math.floor(Math.random() * 10);
      const stain = new CleanupStain();
      stain.x = x;
      stain.y = y;
      stain.radius = radius;
      stain.cleanliness = 100;
      stain.cleaned = false;
      this.state.stains.set(String(this.nextStainId++), stain);
      placed++;
      attempts++;
    }
  }

  private createMonsters() {
    const monsterCount = 4 + Math.floor(Math.random() * 3); // 4-6
    let placed = 0;
    let attempts = 0;

    while (placed < monsterCount && attempts < 500) {
      const x = 200 + Math.floor(Math.random() * (MAP_WIDTH - 400));
      const y = 200 + Math.floor(Math.random() * (MAP_HEIGHT - 400));

      if (Math.hypot(x - 80, y - 80) < 400) {
        attempts++;
        continue;
      }

      if (!this.isInsideObstacle(x, y, 14)) {
        const isHunter = placed < 2;
        const id = String(this.nextMonsterId++);
        const monster = new CleanupMonster();
        monster.x = x;
        monster.y = y;
        monster.isHunter = isHunter;
        monster.isChasing = false;
        monster.stunTimer = 0;
        const angle = Math.random() * Math.PI * 2;
        monster.dirX = Math.cos(angle);
        monster.dirY = Math.sin(angle);
        this.state.monsters.set(id, monster);

        this.monsterAIs.set(id, {
          id,
          isHunter,
          isChasing: false,
          homeX: x,
          homeY: y,
          patrolTimer: Math.floor(Math.random() * 3000),
          giveUpTimer: 0,
          giveUpDuration: isHunter ? MONSTER_GIVEUP_DURATION_HUNTER : MONSTER_GIVEUP_DURATION_NORMAL,
          stunTimer: 0,
          attackCooldown: 0,
          returnHomeTimer: 0,
          lastSeenX: 0,
          lastSeenY: 0,
          hasLastSeen: false,
          searchingTimer: 0,
        });
        placed++;
      }
      attempts++;
    }
  }

  // ─── Collision helpers ─────────────────────────────────────

  private isObstacleAt(px: number, py: number): boolean {
    for (const obs of this.obstacles) {
      if (px >= obs.x && px <= obs.x + obs.w && py >= obs.y && py <= obs.y + obs.h) {
        return true;
      }
    }
    return false;
  }

  private isInsideObstacle(x: number, y: number, radius: number): boolean {
    for (const obs of this.obstacles) {
      const closestX = Math.max(obs.x, Math.min(x, obs.x + obs.w));
      const closestY = Math.max(obs.y, Math.min(y, obs.y + obs.h));
      const dist = Math.hypot(x - closestX, y - closestY);
      if (dist < radius) return true;
    }
    return false;
  }

  private lineBlockedByObstacle(x1: number, y1: number, x2: number, y2: number): boolean {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(dist / 10);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      if (this.isObstacleAt(px, py)) return true;
    }
    return false;
  }

  // ── Send obstacle data to client on join ──
  // Client needs to know obstacle positions for rendering
  getObstacles(): Obstacle[] {
    return this.obstacles;
  }

  getHideSpots(): HideSpot[] {
    return this.hideSpots;
  }
}
