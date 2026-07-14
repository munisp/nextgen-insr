// TypeScript enabled — Sprint 96 security audit
/**
 * socketSingleton.ts
 *
 * Provides a module-level reference to the Socket.IO server so that tRPC
 * routers can emit real-time events without circular import issues.
 *
 * Usage:
 *   import { getIO, setIO } from "../socketSingleton";
 *   // In socket.ts after creating the io instance:
 *   setIO(io);
 *   // In any router:
 *   getIO()?.of("/terminal").emit("terminal:fraud_alert", payload);
 */
import type { Server as SocketIOServer } from "socket.io";

let _io: SocketIOServer | null = null;

/** Called once from socket.ts after the io instance is created. */
export function setIO(io: SocketIOServer): void {
  _io = io;
}

/** Returns the shared Socket.IO server, or null if not yet initialised. */
export function getIO(): SocketIOServer | null {
  return _io;
}
