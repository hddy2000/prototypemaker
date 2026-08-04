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
  // Center cross
  { x: 720, y: 400, w: 160, h: 40 },
  { x: 780, y: 340, w: 40, h: 160 },
  // Corner blocks
  { x: 200, y: 200, w: 120, h: 120 },
  { x: 1280, y: 200, w: 120, h: 120 },
  { x: 200, y: 880, w: 120, h: 120 },
  { x: 1280, y: 880, w: 120, h: 120 },
  // Side walls
  { x: 500, y: 560, w: 40, h: 200 },
  { x: 1060, y: 440, w: 40, h: 200 },
  // Extra cover
  { x: 400, y: 700, w: 80, h: 40 },
  { x: 1120, y: 460, w: 80, h: 40 },
];

const PLAYER_RADIUS = 15;
const INFECT_COOLDOWN_MS = 3000; // 3 seconds
const PLAYER_SPEED = 220; // everyone same speed
const GAME_DURATION_SECONDS = 120; // 2 minutes
const MIN_PLAYERS_TO_START = 2; // For testing, set to 2. Production should be 4+

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
        player.x = message.x;
        player.y = message.y;
        player.rotation = message.rotation ?? 0;
      }
    });

    this.setSimulationInterval((deltaTime) => {
      this.update(deltaTime);
    });
  }

  onJoin(client: Client, _options: unknown) {
    const player = new InfectionPlayer();
    const colorIndex = this.state.players.size % PLAYER_COLORS.length;
    player.color = PLAYER_COLORS[colorIndex];
    player.alive = true;
    player.infected = false;
    player.infectedAt = 0;
    player.lastInfectTime = 0;
    player.infectionCount = 0;
    this.spawnPlayer(player);
    this.state.players.set(client.sessionId, player);

    console.log(`[InfectionTagRoom] onJoin sessionId=${client.sessionId} color=${player.color}`);

    // Auto-start if enough players
    if (this.state.players.size >= MIN_PLAYERS_TO_START && this.state.phase === "waiting") {
      this.startGame();
    }
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
        
        // Update survival scores every second
        this.state.players.forEach((player) => {
          if (!player.infected && player.alive) {
            player.survivalSeconds++;
            player.score += 1; // +1 per 10 seconds = +1 per second tick (simplified)
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
      p.score += 10; // last survivor bonus
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

          // Score: +5 for zero patient, +1 for unknowing infected
          if (player1.isZeroPatient) {
            player1.score += 5;
          } else {
            player1.score += 1;
          }

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
}
