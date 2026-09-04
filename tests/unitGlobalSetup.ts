/**
 * unitGlobalSetup.ts — vitest globalSetup for the UNIT suite (vitest.config.ts).
 *
 * Ledger WRITES (tbCreateTransfer, tbEnsureAgentAccount) have been
 * FAIL-CLOSED since dd-tb: with no reachable ledger endpoint they throw
 * TBLedgerUnavailableError. Unit money-path tests (e.g. server/pos.test.ts →
 * transactions.ts) exercise those legs for real, so the suite needs a live
 * endpoint. Unless TB_SIDECAR_URL is provided (a real tb-sidecar +
 * TigerBeetle stack), we spawn the same protocol-faithful in-process mini
 * ledger the integration harness uses (tests/integration/setup/
 * miniTigerBeetle.ts — REAL double-entry, ref idempotency, constraint
 * enforcement; NOT a mock and NOT TigerBeetle — see its header).
 *
 * The forks pool (vitest default) forks workers from the main process AFTER
 * globalSetup runs, so this process.env mutation is inherited by every
 * worker — proven by the integration job on main. TB_SIDECAR_URL must stay
 * OUT of the vitest config env block: a config `env` entry is applied
 * per-worker and would OVERRIDE this assignment (same override hazard as
 * REDIS_URL / TB_SIDECAR_URL in vitest.integration.config.ts).
 */
import {
  startMiniTigerBeetle,
  type MiniTigerBeetle,
} from "./integration/setup/miniTigerBeetle";

let miniTB: MiniTigerBeetle | null = null;

export default async function unitGlobalSetup(): Promise<() => Promise<void>> {
  if (!process.env.TB_SIDECAR_URL) {
    miniTB = await startMiniTigerBeetle(17071);
    process.env.TB_SIDECAR_URL = miniTB.url;
    console.log(
      `[unit-setup] no TB_SIDECAR_URL provided — mini-TigerBeetle ledger at ${miniTB.url}`
    );
  } else {
    console.log(
      "[unit-setup] using provided TB_SIDECAR_URL (real tb-sidecar + TigerBeetle)"
    );
  }
  return async () => {
    if (miniTB) {
      await miniTB.close();
      miniTB = null;
    }
  };
}
