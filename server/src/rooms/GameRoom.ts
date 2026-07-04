import { Room, Client } from "@colyseus/core";
import { Bullet, GameState, Player } from "../schema/GameState.js";

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

const ARENA = {
  width: 1600,
  height: 1200,
};

const OBSTACLES: Array<{ x: number; y: number; w: number; h: number }> = [
  { x: 720, y: 400, w: 160, h: 40 },
  { x: 780, y: 340, w: 40, h: 160 },
  { x: 200, y: 200, w: 120, h: 120 },
  { x: 1280, y: 200, w: 120, h: 120 },
  { x: 200, y: 880, w: 120, h: 120 },
  { x: 1280, y: 880, w: 120, h: 120 },
  { x: 500, y: 560, w: 40, h: 200 },
  { x: 1060, y: 440, w: 40, h: 200 },
  { x: 400, y: 700, w: 80, h: 40 },
  { x: 1120, y: 460, w: 80, h: 40 },
];

const PLAYER_RADIUS = 15;
const BULLET_RADIUS = 6;
const BULLET_SPEED = 720;
const BULLET_LIFETIME_MS = 1400;
const SHOOT_COOLDOWN_MS = 350;
const ROUND_DURATION_MS = 45000;
const ROUND_RESTART_DELAY_MS = 4000;
const HUNTER_SPAWN = { x: 800, y: 600 };
const CIVILIAN_SPAWNS = [
  { x: 140, y: 140 },
  { x: 1460, y: 140 },
  { x: 140, y: 1060 },
  { x: 1460, y: 1060 },
  { x: 240, y: 600 },
  { x: 1360, y: 600 },
  { x: 800, y: 160 },
  { x: 800, y: 1040 },
];

export class GameRoom extends Room<GameState> {
  maxClients = 8;
  private nextBulletId = 1;
  private shootCooldowns = new Map<string, number>();
  private restartScheduled = false;

  onCreate(_options: any) {
    console.log(`[GameRoom] onCreate roomId=${this.roomId}`);
    this.setState(new GameState());

    this.onMessage("move", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (player && player.alive && typeof message.x === "number") {
        player.x = message.x;
        player.y = message.y;
        player.rotation = message.rotation ?? 0;
      }
    });

    this.onMessage("shoot", (client) => {
      this.handleShoot(client);
    });

    this.setSimulationInterval((deltaTime) => {
      this.updateBullets(deltaTime);
      this.updateRoundTimer();
    });
  }

  onJoin(client: Client, _options: any) {
    const player = new Player();
    const colorIndex = this.state.players.size % PLAYER_COLORS.length;
    player.color = PLAYER_COLORS[colorIndex];

    if (!this.state.hunterSessionId) {
      this.state.hunterSessionId = client.sessionId;
    }

    player.role = client.sessionId === this.state.hunterSessionId ? "hunter" : "civilian";
    player.alive = true;
    player.kills = 0;
    this.spawnPlayer(player, client.sessionId);
    this.state.players.set(client.sessionId, player);
    this.maybeStartRound();
    console.log(`[GameRoom] onJoin roomId=${this.roomId} sessionId=${client.sessionId} role=${player.role} color=${player.color} x=${player.x} y=${player.y}`);
  }

  onLeave(client: Client, _consented: boolean) {
    this.state.players.delete(client.sessionId);
    this.shootCooldowns.delete(client.sessionId);
    this.removeBulletsByOwner(client.sessionId);

    if (client.sessionId === this.state.hunterSessionId) {
      this.reassignHunter();
    }

    if (this.state.phase === "active") {
      this.checkForWinner();
    } else if (this.state.phase !== "active") {
      this.maybeStartRound();
    }

    console.log(`[GameRoom] onLeave roomId=${this.roomId} sessionId=${client.sessionId}`);
  }

  onDispose() {
    console.log("Room disposed");
  }

  private handleShoot(client: Client) {
    if (this.state.phase !== "active") {
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive || player.role !== "hunter") {
      return;
    }

    const now = Date.now();
    const lastShotAt = this.shootCooldowns.get(client.sessionId) ?? 0;
    if (now - lastShotAt < SHOOT_COOLDOWN_MS) {
      return;
    }

    const directionX = Math.sin(player.rotation);
    const directionY = -Math.cos(player.rotation);
    const magnitude = Math.hypot(directionX, directionY) || 1;
    const unitX = directionX / magnitude;
    const unitY = directionY / magnitude;

    const bullet = new Bullet();
    bullet.x = player.x + unitX * (PLAYER_RADIUS + 10);
    bullet.y = player.y + unitY * (PLAYER_RADIUS + 10);
    bullet.vx = unitX * BULLET_SPEED;
    bullet.vy = unitY * BULLET_SPEED;
    bullet.ttlMs = BULLET_LIFETIME_MS;
    bullet.ownerSessionId = client.sessionId;

    this.state.bullets.set(String(this.nextBulletId++), bullet);
    this.shootCooldowns.set(client.sessionId, now);
  }

  private updateBullets(deltaTime: number) {
    if (this.state.bullets.size === 0) {
      return;
    }

    const deltaSeconds = deltaTime / 1000;
    const bulletsToRemove: string[] = [];

    this.state.bullets.forEach((bullet, bulletId) => {
      bullet.x += bullet.vx * deltaSeconds;
      bullet.y += bullet.vy * deltaSeconds;
      bullet.ttlMs -= deltaTime;

      if (
        bullet.ttlMs <= 0 ||
        bullet.x < 0 ||
        bullet.x > ARENA.width ||
        bullet.y < 0 ||
        bullet.y > ARENA.height ||
        this.intersectsObstacle(bullet.x, bullet.y, BULLET_RADIUS)
      ) {
        bulletsToRemove.push(bulletId);
        return;
      }

      const hitPlayerId = this.findBulletHitTarget(bullet);
      if (hitPlayerId) {
        const target = this.state.players.get(hitPlayerId);
        if (target) {
          target.alive = false;
          const shooter = this.state.players.get(bullet.ownerSessionId);
          if (shooter) {
            shooter.kills += 1;
          }
        }
        bulletsToRemove.push(bulletId);
      }
    });

    bulletsToRemove.forEach((bulletId) => this.state.bullets.delete(bulletId));

    if (bulletsToRemove.length > 0) {
      this.checkForWinner();
    }
  }

  private updateRoundTimer() {
    if (this.state.phase !== "active") {
      return;
    }

    if (Date.now() >= this.state.roundEndsAt) {
      this.finishRound("civilians");
    }
  }

  private checkForWinner() {
    if (!this.state.hunterSessionId || this.state.players.size < 2) {
      this.state.phase = "waiting";
      this.state.winner = "";
      this.state.roundEndsAt = 0;
      this.clearBullets();
      return;
    }

    const hunter = this.state.players.get(this.state.hunterSessionId);
    if (!hunter) {
      this.reassignHunter();
      return;
    }

    const civiliansAlive = this.getCivilianIds().filter((sessionId) => this.state.players.get(sessionId)?.alive);
    if (this.state.phase === "active" && civiliansAlive.length === 0) {
      this.finishRound("hunter");
    }
  }

  private maybeStartRound(forceRestart = false) {
    if (!this.state.hunterSessionId) {
      this.reassignHunter();
    }

    if (this.state.players.size < 2 || !this.state.hunterSessionId) {
      this.state.phase = "waiting";
      this.state.winner = "";
      this.state.roundEndsAt = 0;
      this.clearBullets();
      return;
    }

    if (!forceRestart && this.state.phase === "active") {
      return;
    }

    this.restartScheduled = false;
    this.clearBullets();
    this.state.phase = "active";
    this.state.winner = "";
    this.state.roundEndsAt = Date.now() + ROUND_DURATION_MS;

    let civilianIndex = 0;
    this.state.players.forEach((player, sessionId) => {
      player.role = sessionId === this.state.hunterSessionId ? "hunter" : "civilian";
      player.alive = true;
      player.kills = 0;

      if (player.role === "hunter") {
        player.x = HUNTER_SPAWN.x;
        player.y = HUNTER_SPAWN.y;
        player.rotation = 0;
      } else {
        const spawn = CIVILIAN_SPAWNS[civilianIndex % CIVILIAN_SPAWNS.length];
        civilianIndex += 1;
        player.x = spawn.x;
        player.y = spawn.y;
        player.rotation = Math.PI;
      }
    });
  }

  private finishRound(winner: "hunter" | "civilians") {
    if (this.state.phase === "finished") {
      return;
    }

    this.state.phase = "finished";
    this.state.winner = winner;
    this.state.roundEndsAt = 0;
    this.clearBullets();

    if (!this.restartScheduled && this.state.players.size >= 2) {
      this.restartScheduled = true;
      this.clock.setTimeout(() => {
        this.maybeStartRound(true);
      }, ROUND_RESTART_DELAY_MS);
    }
  }

  private reassignHunter() {
    const nextHunterId = Array.from(this.state.players.keys())[0] ?? "";
    this.state.hunterSessionId = nextHunterId;
    this.state.players.forEach((player, sessionId) => {
      player.role = sessionId === nextHunterId ? "hunter" : "civilian";
    });
  }

  private spawnPlayer(player: Player, sessionId: string) {
    if (sessionId === this.state.hunterSessionId) {
      player.x = HUNTER_SPAWN.x;
      player.y = HUNTER_SPAWN.y;
      player.rotation = 0;
      return;
    }

    const civilianIndex = Math.max(0, this.state.players.size - 1);
    const spawn = CIVILIAN_SPAWNS[civilianIndex % CIVILIAN_SPAWNS.length];
    player.x = spawn.x;
    player.y = spawn.y;
    player.rotation = Math.PI;
  }

  private removeBulletsByOwner(sessionId: string) {
    const bulletIds: string[] = [];
    this.state.bullets.forEach((bullet, bulletId) => {
      if (bullet.ownerSessionId === sessionId) {
        bulletIds.push(bulletId);
      }
    });
    bulletIds.forEach((bulletId) => this.state.bullets.delete(bulletId));
  }

  private clearBullets() {
    Array.from(this.state.bullets.keys()).forEach((bulletId) => this.state.bullets.delete(bulletId));
  }

  private getCivilianIds(): string[] {
    return Array.from(this.state.players.entries())
      .filter(([, player]) => player.role === "civilian")
      .map(([sessionId]) => sessionId);
  }

  private findBulletHitTarget(bullet: Bullet): string | null {
    for (const [sessionId, player] of this.state.players.entries()) {
      if (sessionId === bullet.ownerSessionId || !player.alive || player.role !== "civilian") {
        continue;
      }

      const dx = bullet.x - player.x;
      const dy = bullet.y - player.y;
      if (dx * dx + dy * dy <= (PLAYER_RADIUS + BULLET_RADIUS) ** 2) {
        return sessionId;
      }
    }

    return null;
  }

  private intersectsObstacle(x: number, y: number, radius: number) {
    return OBSTACLES.some((obstacle) => {
      const closestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.w));
      const closestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.h));
      const dx = x - closestX;
      const dy = y - closestY;
      return dx * dx + dy * dy <= radius * radius;
    });
  }
}
