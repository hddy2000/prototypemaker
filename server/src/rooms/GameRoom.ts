import { Room, Client } from "@colyseus/core";
import { GameState, Player } from "../schema/GameState.js";

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

export class GameRoom extends Room<GameState> {
  maxClients = 8;

  onCreate(_options: any) {
    console.log(`[GameRoom] onCreate roomId=${this.roomId}`);
    this.setState(new GameState());

    this.onMessage("move", (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (player && typeof message.x === "number") {
        player.x = message.x;
        player.y = message.y;
        player.rotation = message.rotation ?? 0;
      }
    });
  }

  onJoin(client: Client, _options: any) {
    const player = new Player();
    const colorIndex = this.state.players.size % PLAYER_COLORS.length;
    player.color = PLAYER_COLORS[colorIndex];
    // Spread spawn positions so players don't overlap
    player.x = 300 + (this.state.players.size * 120) % 1000;
    player.y = 300 + (this.state.players.size * 90) % 600;
    this.state.players.set(client.sessionId, player);
    console.log(`[GameRoom] onJoin roomId=${this.roomId} sessionId=${client.sessionId} color=${player.color} x=${player.x} y=${player.y}`);
  }

  onLeave(client: Client, _consented: boolean) {
    this.state.players.delete(client.sessionId);
    console.log(`[GameRoom] onLeave roomId=${this.roomId} sessionId=${client.sessionId}`);
  }

  onDispose() {
    console.log("Room disposed");
  }
}
