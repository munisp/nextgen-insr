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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const PG_HOST = "127.0.0.1";
const PG_PORT = Number(process.env.PGLITE_PORT ?? 54329);
const PGLITE_URL = `postgresql://postgres:postgres@${PG_HOST}:${PG_PORT}/postgres`;

let pgliteChild: ChildProcess | null = null;

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
  if (process.env.POSTGRES_URL) {
    // CI path: real PostgreSQL provided by the environment.
    console.log(
      `[integration-setup] using provided POSTGRES_URL (${process.env.POSTGRES_URL.replace(/\/\/.*@/, "//***@")})`
    );
    await runDrizzleKitPush(process.env.POSTGRES_URL);
    return async () => {};
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
  };
}
