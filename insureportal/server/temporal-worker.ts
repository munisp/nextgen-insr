// TypeScript enabled — Sprint 96 security audit
/**
 * InsurePortal POS — Temporal Worker Process
 * Run: npx tsx server/temporal-worker.ts
 * Or via Docker: CMD ["node", "dist/temporal-worker.js"]
 *
 * Registers and runs the SettlementWorkflow with all its activities.
 * Connects to Temporal server at TEMPORAL_ADDRESS (default: localhost:7233).
 */
import path from "path";
import fs from "fs";
import {
  NativeConnection,
  Worker,
  Runtime,
  DefaultLogger,
} from "@temporalio/worker";
import * as activities from "./temporal-activities";
import { logger } from './_core/logger';

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "insureportal";
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "settlement-queue";

/**
 * Start the Temporal worker in-process.
 * Called from server/_core/index.ts after server starts listening.
 * Throws if Temporal server is unreachable — callers should catch and warn.
 */
export async function startTemporalWorker(): Promise<void> {
  await run();
}

async function run() {
  // Set up Temporal runtime with structured logging
  Runtime.install({
    logger: new DefaultLogger("INFO", ({ level, message, meta }) => {
      logger.info(
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          msg: message,
          ...meta,
        })
      );
    }),
  });

  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  // Resolve the workflows file path. Two real defects fixed here (W31-C):
  //  1. The portal always runs as ESM ("type": "module"; tsx loader in dev,
  //     esbuild --format=esm dist bundle in prod), where the old
  //     `__dirname ?? process.cwd()` threw ReferenceError — the `??` fallback
  //     was unreachable because the reference itself throws.
  //     import.meta.dirname is defined on Node >= 20.11.
  //  2. @temporalio/worker's bundler statSync()s workflowsPath verbatim
  //     (makeEntrypointPath in lib/workflow/bundler.js) — it does NOT append
  //     extensions, so the extensionless "temporal-workflows" never resolved
  //     to temporal-workflows.ts (dev) or .js (compiled). Probe both.
  const workflowsDir = import.meta.dirname ?? process.cwd();
  const workflowsPath =
    [".js", ".ts"]
      .map(ext => path.resolve(workflowsDir, `temporal-workflows${ext}`))
      .find(p => fs.existsSync(p)) ??
    path.resolve(workflowsDir, "temporal-workflows");

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath,
    activities,
    maxConcurrentActivityTaskExecutions: 20,
    maxConcurrentWorkflowTaskExecutions: 10,
  });

  logger.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "INFO",
      msg: "Temporal worker starting",
      address: TEMPORAL_ADDRESS,
      namespace: TEMPORAL_NAMESPACE,
      taskQueue: TASK_QUEUE,
    })
  );

  await worker.run();
}
