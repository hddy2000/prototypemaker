import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";
import { DeathmatchRoom } from "./rooms/DeathmatchRoom.js";

const gameServer = new Server({
  transport: new WebSocketTransport(),
});

// Define room
gameServer.define("game", GameRoom);
gameServer.define("deathmatch", DeathmatchRoom);
console.log("[Server] room type registered: game");
console.log("[Server] room type registered: deathmatch");

const PORT = Number(process.env.PORT) || 2567;

gameServer.listen(PORT).then(() => {
  console.log(`🎮 Colyseus server running on port ${PORT}`);
  console.log(`   Local:   ws://localhost:${PORT}`);
  console.log(`   Network: ws://0.0.0.0:${PORT}`);
});
