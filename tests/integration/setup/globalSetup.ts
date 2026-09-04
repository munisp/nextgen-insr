/**
 * globalSetup.ts — integration test database bootstrap.
 *
 * - POSTGRES_URL provided (CI postgres service): used as-is.
 * - Otherwise: spawns a PGlite wire-protocol server in a CHILD process
 *   (in-process PGlite deadlocks with drizzle-kit push, which opens its own
 *   client while the pool holds the single connection).
 *
 * In both cases the schema is applied with `drizzle-kit push --force`, so the
 * database always matches drizzle/schema.ts exactly.
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMiniRedis, type MiniRedis } from "../../e2e/setup/miniRedis";
import { startMiniTigerBeetle, type MiniTigerBeetle } from "./miniTigerBeetle";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const PG_HOST = "127.0.0.1";
const PG_PORT = Number(process.env.PGLITE_PORT ?? 54329);
const PGLITE_URL = `postgresql://postgres:postgres@${PG_HOST}:${PG_PORT}/postgres`;

let pgliteChild: ChildProcess | null = null;
let miniRedis: MiniRedis | null = null;
let miniTB: MiniTigerBeetle | null = null;

function runDrizzleKitPush(databaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = path.join(repoRoot, "node_modules", ".bin", "drizzle-kit");
    execFile(
      bin,
      ["push", "--force"],
      {
        cwd: repoRoot,
        env: { ...process.env, POSTGRES_URL: databaseUrl },
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `drizzle-kit push --force failed: ${error.message}\n${stdout}\n${stderr}`
            )
          );
        } else {
          console.log(`[integration-setup] schema pushed to ${databaseUrl}`);
          resolve();
        }
      }
    );
  });
}

function waitForReady(child: ChildProcess, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("PGlite server did not become ready in time")),
      timeoutMs
    );
    let stderr = "";
    child.stderr?.on("data", chunk => {
      stderr += String(chunk);
    });
    child.stdout?.on("data", chunk => {
      if (String(chunk).includes("PGLITE_READY")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", code => {
      clearTimeout(timer);
      reject(
        new Error(`PGlite server exited early (code ${code})\n${stderr}`)
      );
    });
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  // ── Redis (local fallback only) ──────────────────────────────────────────
  // Distributed locks (acquireLock) and token blacklists are FAIL-CLOSED:
  // with no reachable Redis every guarded money path refuses to run. CI jobs
  // provide a real redis:7 service via REDIS_URL; locally we spawn the same
  // in-process mini RESP server the e2e suite uses (faithful SET PX NX
  // semantics) so the lock/idempotency tests exercise REAL lock behavior.
  if (!process.env.REDIS_URL) {
    miniRedis = await startMiniRedis(6381);
    process.env.REDIS_URL = miniRedis.url;
    console.log(
      `[integration-setup] no REDIS_URL provided — mini-Redis at ${miniRedis.url}`
    );
  } else {
    console.log("[integration-setup] using provided REDIS_URL (CI redis service)");
  }
  // ── TigerBeetle ledger (local fallback only) ────────────────────────────
  // Ledger WRITES (tbCreateTransfer, tbEnsureAgentAccount) are FAIL-CLOSED
  // since dd-tb: with no reachable sidecar every money path throws
  // TBLedgerUnavailableError during test seeding. CI does not run a
  // tb-sidecar+TigerBeetle stack, so unless TB_SIDECAR_URL is provided we
  // spawn an in-process, protocol-faithful mini ledger (REAL double-entry,
  // ref idempotency, constraint enforcement — see miniTigerBeetle.ts). The
  // forks/singleFork pool means this process.env mutation reaches workers;
  // TB_SIDECAR_URL must therefore stay OUT of the vitest config env block.
  if (!process.env.TB_SIDECAR_URL) {
    miniTB = await startMiniTigerBeetle(17071);
    process.env.TB_SIDECAR_URL = miniTB.url;
    console.log(
      `[integration-setup] no TB_SIDECAR_URL provided — mini-TigerBeetle ledger at ${miniTB.url}`
    );
  } else {
    console.log("[integration-setup] using provided TB_SIDECAR_URL (real tb-sidecar + TigerBeetle)");
  }
  const closeMiniServers = async () => {
    if (miniRedis) {
      await miniRedis.close();
      miniRedis = null;
    }
    if (miniTB) {
      await miniTB.close();
      miniTB = null;
    }
  };

  if (process.env.POSTGRES_URL) {
    // CI path: real PostgreSQL provided by the environment.
    console.log(
      `[integration-setup] using provided POSTGRES_URL (${process.env.POSTGRES_URL.replace(/\/\/.*@/, "//***@")})`
    );
    await runDrizzleKitPush(process.env.POSTGRES_URL);
    return closeMiniServers;
  }

  // Local path: spawn PGlite wire server as a child process.
  console.log("[integration-setup] POSTGRES_URL not set — spawning PGlite server");
  pgliteChild = spawn(
    process.execPath,
    [path.join(repoRoot, "tests", "integration", "setup", "pgliteServer.mjs")],
    {
      cwd: repoRoot,
      env: { ...process.env, TZ: "UTC" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  await waitForReady(pgliteChild);
  console.log(`[integration-setup] PGlite listening on ${PG_HOST}:${PG_PORT}`);

  process.env.POSTGRES_URL = PGLITE_URL;
  await runDrizzleKitPush(PGLITE_URL);

  return async () => {
    pgliteChild?.kill("SIGTERM");
    pgliteChild = null;
    await closeMiniServers();
  };
}
