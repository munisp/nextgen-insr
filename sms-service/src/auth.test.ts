import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { apiKeyAuth } from "./auth";

// Security regression tests (2026-10-03): the auth gate must reject missing
// and wrong keys with 401 and pass the correct key through. Exercises the
// real middleware on a real express server over a real socket (ephemeral
// port) — no mock req/res objects.

async function withServer(key: string, fn: (base: string) => Promise<void>) {
  const app = express();
  app.use("/api", apiKeyAuth(key));
  app.get("/api/v1/sms/status/:id", (_req, res) => res.json({ ok: true }));
  app.get("/health", (_req, res) => res.json({ status: "healthy" }));
  const server = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

test("missing key -> 401", async () => {
  await withServer("secret-key", async (base) => {
    const res = await fetch(`${base}/api/v1/sms/status/msg-1`);
    assert.equal(res.status, 401);
  });
});

test("wrong key -> 401", async () => {
  await withServer("secret-key", async (base) => {
    const res = await fetch(`${base}/api/v1/sms/status/msg-1`, {
      headers: { "X-API-Key": "wrong-key!" },
    });
    assert.equal(res.status, 401);
  });
});

test("correct key (X-API-Key) -> existing behavior", async () => {
  await withServer("secret-key", async (base) => {
    const res = await fetch(`${base}/api/v1/sms/status/msg-1`, {
      headers: { "X-API-Key": "secret-key" },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test("correct key (Bearer) -> existing behavior", async () => {
  await withServer("secret-key", async (base) => {
    const res = await fetch(`${base}/api/v1/sms/status/msg-1`, {
      headers: { Authorization: "Bearer secret-key" },
    });
    assert.equal(res.status, 200);
  });
});

test("health endpoint stays open without a key", async () => {
  await withServer("secret-key", async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
  });
});
