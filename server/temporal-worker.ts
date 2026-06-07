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
import {
  NativeConnection,
  Worker,
  Runtime,
  DefaultLogger,
} from "@temporalio/worker";
import * as activities from "./temporal-activities";

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
      console.log(
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

  // Resolve the workflows file path — works in both CJS and ESM contexts
  const workflowsPath = path.resolve(
    __dirname ?? process.cwd(),
    "temporal-workflows"
  );

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath,
    activities,
    maxConcurrentActivityTaskExecutions: 20,
    maxConcurrentWorkflowTaskExecutions: 10,
  });

  console.log(
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
