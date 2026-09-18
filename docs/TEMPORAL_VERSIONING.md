# Temporal Workflow Versioning Discipline (OPS-11)

## Problem

Workflow-code changes replay against persisted histories of **in-flight**
executions. Without versioning discipline, a code change makes replay
non-deterministic and breaks every running workflow on the task queue.

## Rules (mandatory for any change to `server/temporal-workflows.ts`,
`server/insurance-journeys-v2.ts` workflow functions, or shared workflow helpers)

1. **Pin a build ID per deploy.** Set `TEMPORAL_WORKER_BUILD_ID` to a unique,
   monotonically increasing value (e.g. `<version>-<git-sha>`). The worker
   passes it to `Worker.create({ buildId })`. Default is
   `<npm_package_version>-<GIT_SHA>` — explicit beats default.
2. **Prefer `patch()` / `patched()` for behaviour changes** while any
   workflow that started before the change may still be running:
   ```ts
   import { patched } from "@temporalio/workflow";
   if (patched("J03-faster-fraud-check-2026-09")) {
     await newFraudCheck(...);   // new path
   } else {
     await legacyFraudCheck(...); // old path for pre-patch histories
   }
   ```
   Once NO in-flight execution predates the patch, remove the old branch and
   call `deprecatePatch("J03-faster-fraud-check-2026-09")`.
3. **Never** reorder/remove existing `await`ed commands (activities, timers,
   child workflows) without a patch marker — that is exactly what breaks
   determinism.
4. **Version guard at worker startup** (`server/temporal-worker.ts`
   `assertVersionGuard`): if the task queue has in-flight executions and
   `TEMPORAL_WORKER_BUILD_ID` is not pinned, the worker logs a LOUD error;
   with `TEMPORAL_VERSION_GUARD=strict` it refuses to start.
5. **Full worker versioning** (optional, server-side feature): enable with
   `TEMPORAL_WORKER_VERSIONING=true` so old-build workers keep draining old
   executions while new-build workers take new ones.

## Deploy checklist

- [ ] List in-flight executions: `temporal workflow list --query 'ExecutionStatus="Running"'`
- [ ] If any exist: use `patched()` markers for changed code paths
- [ ] Bump `TEMPORAL_WORKER_BUILD_ID`
- [ ] Keep the previous worker build running until its executions complete
      (or use worker versioning), then decommission
