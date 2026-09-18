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

/**
 * G3 (audit #14): force-disconnect every socket bound to an agent identity
 * across all authenticated namespaces. Used by the deactivation cascade so a
 * suspended agent's live /chat, /terminal, /settlement, /fraud connections
 * die immediately instead of surviving until the 12h JWT expires.
 *
 * Test-runner-aware: returns 0 when Socket.IO was never initialised (unit /
 * integration runs never call initSocketIO), so callers can invoke it
 * unconditionally.
 */
export function disconnectAgentSockets(agentPk: number): number {
  const io = getIO();
  if (!io) return 0;
  let disconnected = 0;
  // io._nsps is the canonical namespace registry; typed as non-public.
  const nsps = (io as unknown as { _nsps?: Map<string, { sockets: Map<string, { data: Record<string, unknown>; disconnect: (close?: boolean) => void }> }> })._nsps;
  if (!nsps) return 0;
  for (const ns of nsps.values()) {
    for (const socket of ns.sockets.values()) {
      if (socket.data?.agentId === agentPk) {
        socket.disconnect(true);
        disconnected++;
      }
    }
  }
  return disconnected;
}
