/**
 * InsurePortal Vault Client
 * Loads secrets from HashiCorp Vault via AppRole auth on startup.
 * Falls back to environment variables when Vault is unavailable (dev/test).
 *
 * Usage:
 *   import { loadVaultSecrets } from "./_core/vault";
 *   await loadVaultSecrets(); // call once at startup before any other init
 */
import logger from "./logger";

const VAULT_ADDR = process.env.VAULT_ADDR ?? "http://localhost:8200";
const VAULT_ROLE_ID = process.env.VAULT_ROLE_ID ?? "";
const VAULT_SECRET_ID = process.env.VAULT_SECRET_ID ?? "";
const VAULT_SECRET_PATH =
  process.env.VAULT_SECRET_PATH ?? "secret/data/insurance-portal-demo";

interface VaultTokenResponse {
  auth: { client_token: string };
}

interface VaultSecretResponse {
  data: { data: Record<string, string> };
}

/**
 * Authenticate with Vault via AppRole and return a client token.
 */
async function getVaultToken(): Promise<string> {
  const res = await fetch(`${VAULT_ADDR}/v1/auth/approle/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role_id: VAULT_ROLE_ID,
      secret_id: VAULT_SECRET_ID,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(
      `Vault AppRole login failed: ${res.status} ${await res.text()}`
    );
  }
  const json = (await res.json()) as VaultTokenResponse;
  return json.auth.client_token;
}

/**
 * Read secrets from Vault KV v2 at the configured path.
 */
async function readVaultSecrets(
  token: string
): Promise<Record<string, string>> {
  const res = await fetch(`${VAULT_ADDR}/v1/${VAULT_SECRET_PATH}`, {
    headers: { "X-Vault-Token": token },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(
      `Vault secret read failed: ${res.status} ${await res.text()}`
    );
  }
  const json = (await res.json()) as VaultSecretResponse;
  return json.data.data;
}

/**
 * Load secrets from Vault and inject them into process.env.
 * Silently falls back to existing env vars if Vault is unreachable.
 */
export async function loadVaultSecrets(): Promise<void> {
  if (!VAULT_ROLE_ID || !VAULT_SECRET_ID) {
    logger.debug(
      "[Vault] VAULT_ROLE_ID/VAULT_SECRET_ID not set — skipping Vault secret injection"
    );
    return;
  }

  try {
    logger.info("[Vault] Authenticating via AppRole...");
    const token = await getVaultToken();
    const secrets = await readVaultSecrets(token);

    let injected = 0;
    for (const [key, value] of Object.entries(secrets)) {
      if (!process.env[key]) {
        process.env[key] = value;
        injected++;
      }
    }
    logger.info(
      `[Vault] Injected ${injected} secrets from ${VAULT_SECRET_PATH}`
    );
  } catch (err) {
    logger.warn(
      { err },
      "[Vault] Secret injection failed — falling back to environment variables"
    );
  }
}

export default { loadVaultSecrets };
