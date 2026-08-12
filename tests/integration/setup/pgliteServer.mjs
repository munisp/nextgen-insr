/**
 * pgliteServer.mjs — PGlite wire-protocol server child process.
 *
 * Spawned by globalSetup.ts when POSTGRES_URL is not provided. Runs PGlite
 * out-of-process because an in-process PGlite deadlocks when drizzle-kit
 * push (a separate client) needs the single connection at the same time.
 *
 * Prints "PGLITE_READY" to stdout once the socket server is listening.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

process.env.TZ = "UTC";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PGLITE_PORT ?? 54329);

const db = new PGlite();
await db.waitReady;

const server = new PGLiteSocketServer({
  db,
  host: HOST,
  port: PORT,
});

await server.start();
console.log("PGLITE_READY");

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await server.stop();
  } catch {
    /* ignore */
  }
  try {
    await db.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("disconnect", shutdown);
