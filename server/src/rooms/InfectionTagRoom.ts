import { Room, Client } from "@colyseus/core";
import { InfectionTagState, InfectionPlayer } from "../schema/InfectionTagState.js";

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
  { x: 760, y: 100, w: 80, h: 280 },
  { x: 760, y: 820, w: 80, h: 280 },
  { x: 220, y: 320, w: 380, h: 60 },
  { x: 1000, y: 320, w: 380, h: 60 },
  { x: 220, y: 820, w: 380, h: 60 },
  { x: 1000, y: 820, w: 380, h: 60 },
  { x: 320, y: 500, w: 60, h: 200 },
  { x: 1220, y: 500, w: 60, h: 200 },
  { x: 520, y: 560, w: 180, h: 60 },
  { x: 900, y: 560, w: 180, h: 60 },
  { x: 120, y: 120, w: 180, h: 60 },
  { x: 1300, y: 1020, w: 180, h: 60 },
];

const PLAYER_RADIUS = 15;
const INFECT_COOLDOWN_MS = 3000; // 3 seconds
const PLAYER_SPEED = 200; // everyone same speed
const GAME_DURATION_SECONDS = 120; // 2 minutes
const MIN_PLAYERS_TO_START = 2;

const SPAWN_POINTS = [
  { x: 420, y: 150 },
  { x: 1180, y: 150 },
  { x: 160, y: 600 },
  { x: 1440, y: 600 },
  { x: 420, y: 1050 },
  { x: 1180, y: 1050 },
  { x: 700, y: 690 },
  { x: 900, y: 510 },
];

export class InfectionTagRoom extends Room<InfectionTagState> {
  maxClients = 8;
  private spawnIndex = 0;
  private gameTimer: any = null;

  onCreate(_options: unknown) {
    console.log(`[InfectionTagRoom] onCreate roomId=${this.roomId}`);
    this.setState(new InfectionTagState());
    this.state.phase = "waiting";

    this.onMessage("move", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (player && player.alive && typeof message.x === "number") {
        const resolvedPosition = this.resolvePlayerPosition(player.x, player.y, message.x, message.y);
        player.x = resolvedPosition.x;
        player.y = resolvedPosition.y;
        player.rotation = message.rotation ?? 0;
      }
    });

    this.onMessage("restart", (client) => {
      if (this.state.phase === "ended") {
        this.resetGame();
      }
    });

    this.onMessage("ready", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (player && this.state.phase === "waiting") {
        player.ready = !player.ready;
        console.log(`[InfectionTagRoom] ${client.sessionId} ready=${player.ready}`);

        // Start game if all players are ready and enough players
        const allReady = Array.from(this.state.players.values()).every(p => p.ready);
        if (allReady && this.state.players.size >= MIN_PLAYERS_TO_START) {
          this.startGame();
        }
      }
    });

    this.setSimulationInterval((deltaTime) => {
      this.update(deltaTime);
    });
  }

  onJoin(client: Client, _options: unknown) {
    // Don't allow joining mid-game
    if (this.state.phase === "active") {
      console.log(`[InfectionTagRoom] Rejecting join during active game: ${client.sessionId}`);
      client.leave(1, "Game in progress, please wait for next round");
      return;
    }

    const player = new InfectionPlayer();
    const colorIndex = this.state.players.size % PLAYER_COLORS.length;
    player.color = PLAYER_COLORS[colorIndex];
    player.alive = true;
    player.infected = false;
    player.infectedAt = 0;
    player.lastInfectTime = 0;
    player.infectionCount = 0;
    player.isZeroPatient = false;
    player.score = 0;
    player.survivalSeconds = 0;
    player.ready = false;
    this.spawnPlayer(player);
    this.state.players.set(client.sessionId, player);

    console.log(`[InfectionTagRoom] onJoin sessionId=${client.sessionId} color=${player.color}`);
  }

  onLeave(client: Client, _consented: boolean) {
    this.state.players.delete(client.sessionId);
    console.log(`[InfectionTagRoom] onLeave sessionId=${client.sessionId}`);

    // End game if not enough players
    if (this.state.players.size < 2 && this.state.phase === "active") {
      this.endGame();
    }
  }

  onDispose() {
    if (this.gameTimer) {
      clearInterval(this.gameTimer);
    }
    console.log("[InfectionTagRoom] disposed");
  }

  private startGame() {
    console.log("[InfectionTagRoom] Starting game");
    this.state.phase = "active";
    this.state.startTime = Date.now();
    this.state.timeRemaining = GAME_DURATION_SECONDS;

    // Randomly infect one player as zero patient
    const playerIds = Array.from(this.state.players.keys());
    const zeroPatientId = playerIds[Math.floor(Math.random() * playerIds.length)];
    const zeroPatient = this.state.players.get(zeroPatientId);
    if (zeroPatient) {
      zeroPatient.infected = true;
      zeroPatient.isZeroPatient = true;
      zeroPatient.infectedAt = Date.now();
      console.log(`[InfectionTagRoom] Zero patient: ${zeroPatientId}`);
    }

    // Start countdown timer
    this.gameTimer = setInterval(() => {
      if (this.state.phase === "active") {
        this.state.timeRemaining--;

        // Survival score: +1 per second alive
        this.state.players.forEach((player) => {
          if (!player.infected && player.alive) {
            player.score += 1;
          }
        });

        if (this.state.timeRemaining <= 0) {
          this.endGame();
        }
      }
    }, 1000);
  }

  private endGame() {
    console.log("[InfectionTagRoom] Game ended");
    this.state.phase = "ended";
    if (this.gameTimer) {
      clearInterval(this.gameTimer);
      this.gameTimer = null;
    }

    // Award last survivor bonus
    const survivors = Array.from(this.state.players.values()).filter(p => !p.infected && p.alive);
    survivors.forEach(p => {
      p.score += 100; // last survivor bonus
    });

    // Broadcast final state with scores
    this.broadcast("gameEnded", {
      players: Array.from(this.state.players.entries()).map(([id, p]) => ({
        id,
        infected: p.infected,
        isZeroPatient: p.isZeroPatient,
        infectionCount: p.infectionCount,
        survived: !p.infected,
        score: p.score,
      })),
    });
  }

  private resetGame() {
    console.log("[InfectionTagRoom] Resetting game");
    this.state.phase = "waiting";

    // Reset all players
    this.spawnIndex = 0;
    this.state.players.forEach((player) => {
      player.infected = false;
      player.isZeroPatient = false;
      player.infectedAt = 0;
      player.lastInfectTime = 0;
      player.infectionCount = 0;
      player.score = 0;
      player.survivalSeconds = 0;
      player.alive = true;
      player.ready = false;
      this.spawnPlayer(player);
    });
  }

  private update(deltaTime: number) {
    if (this.state.phase !== "active") {
      return;
    }

    const now = Date.now();

    // Check for infections (collision detection)
    this.state.players.forEach((player1, id1) => {
      if (!player1.infected || !player1.alive) return;

      // Check cooldown
      if (now - player1.lastInfectTime < INFECT_COOLDOWN_MS) return;

      this.state.players.forEach((player2, id2) => {
        if (id1 === id2) return;
        if (player2.infected || !player2.alive) return;

        // Check collision
        const dx = player1.x - player2.x;
        const dy = player1.y - player2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < PLAYER_RADIUS * 2) {
          // Infection!
          player2.infected = true;
          player2.infectedAt = now;
          player1.lastInfectTime = now;
          player1.infectionCount++;

          // Score: +50 for infecting someone
          player1.score += 50;

          console.log(`[InfectionTagRoom] ${id1} infected ${id2}`);

          // Broadcast infection event
          this.broadcast("infected", {
            infectorId: id1,
            infectedId: id2,
          });

          // Check if all players are infected
          const allInfected = Array.from(this.state.players.values()).every(p => p.infected);
          if (allInfected) {
            this.endGame();
          }
        }
      });
    });
  }

  private spawnPlayer(player: InfectionPlayer) {
    const spawnPoint = SPAWN_POINTS[this.spawnIndex % SPAWN_POINTS.length];
    player.x = spawnPoint.x;
    player.y = spawnPoint.y;
    this.spawnIndex++;
  }

  private resolvePlayerPosition(currentX: number, currentY: number, targetX: number, targetY: number) {
    const clampedX = Math.max(PLAYER_RADIUS, Math.min(ARENA.width - PLAYER_RADIUS, targetX));
    const clampedY = Math.max(PLAYER_RADIUS, Math.min(ARENA.height - PLAYER_RADIUS, targetY));

    let resolvedX = currentX;
    let resolvedY = currentY;

    if (!this.collidesWithObstacle(clampedX, resolvedY)) {
      resolvedX = clampedX;
    }

    if (!this.collidesWithObstacle(resolvedX, clampedY)) {
      resolvedY = clampedY;
    }

    return { x: resolvedX, y: resolvedY };
  }

  private collidesWithObstacle(x: number, y: number) {
    const left = x - PLAYER_RADIUS;
    const right = x + PLAYER_RADIUS;
    const top = y - PLAYER_RADIUS;
    const bottom = y + PLAYER_RADIUS;

    return OBSTACLES.some((obstacle) => {
      const obstacleRight = obstacle.x + obstacle.w;
      const obstacleBottom = obstacle.y + obstacle.h;
      return right > obstacle.x && left < obstacleRight && bottom > obstacle.y && top < obstacleBottom;
    });
  }
}
