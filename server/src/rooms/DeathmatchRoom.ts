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
const SHOOT_COOLDOWN_MS = 220;
const RESPAWN_DELAY_MS = 1200;
const SPAWN_POINTS = [
  { x: 140, y: 140 },
  { x: 1460, y: 140 },
  { x: 140, y: 1060 },
  { x: 1460, y: 1060 },
  { x: 220, y: 600 },
  { x: 1380, y: 600 },
  { x: 800, y: 160 },
  { x: 800, y: 1040 },
];

export class DeathmatchRoom extends Room<GameState> {
  maxClients = 12;
  private nextBulletId = 1;
  private shootCooldowns = new Map<string, number>();
  private spawnIndex = 0;

  onCreate(_options: unknown) {
    console.log(`[DeathmatchRoom] onCreate roomId=${this.roomId}`);
    this.setState(new GameState());
    this.state.phase = "active";

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
    });
  }

  onJoin(client: Client, _options: unknown) {
    const player = new Player();
    const colorIndex = this.state.players.size % PLAYER_COLORS.length;
    player.color = PLAYER_COLORS[colorIndex];
    player.role = "fighter";
    player.alive = true;
    player.kills = 0;
    this.spawnPlayer(player);
    this.state.players.set(client.sessionId, player);

    console.log(`[DeathmatchRoom] onJoin roomId=${this.roomId} sessionId=${client.sessionId} color=${player.color} x=${player.x} y=${player.y}`);
  }

  onLeave(client: Client, _consented: boolean) {
    this.state.players.delete(client.sessionId);
    this.shootCooldowns.delete(client.sessionId);
    this.removeBulletsByOwner(client.sessionId);
    console.log(`[DeathmatchRoom] onLeave roomId=${this.roomId} sessionId=${client.sessionId}`);
  }

  onDispose() {
    console.log("Deathmatch room disposed");
  }

  private handleShoot(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) {
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
        const shooter = this.state.players.get(bullet.ownerSessionId);
        if (target && target.alive) {
          target.alive = false;
          if (shooter) {
            shooter.kills += 1;
          }
          this.scheduleRespawn(hitPlayerId);
        }
        bulletsToRemove.push(bulletId);
      }
    });

    bulletsToRemove.forEach((bulletId) => this.state.bullets.delete(bulletId));
  }

  private scheduleRespawn(sessionId: string) {
    this.clock.setTimeout(() => {
      const player = this.state.players.get(sessionId);
      if (!player) {
        return;
      }
      player.alive = true;
      this.spawnPlayer(player);
    }, RESPAWN_DELAY_MS);
  }

  private spawnPlayer(player: Player) {
    const spawn = SPAWN_POINTS[this.spawnIndex % SPAWN_POINTS.length];
    this.spawnIndex += 1;
    player.x = spawn.x;
    player.y = spawn.y;
    player.rotation = 0;
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

  private findBulletHitTarget(bullet: Bullet): string | null {
    for (const [sessionId, player] of this.state.players.entries()) {
      if (sessionId === bullet.ownerSessionId || !player.alive) {
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