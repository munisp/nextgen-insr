/**
 * k6 Load Test — MDM OTA Update Endpoint
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests the OTA firmware check and download URL generation endpoints under load.
 * Simulates a fleet of POS devices polling for firmware updates simultaneously.
 *
 * Usage:
 *   k6 run k6/mdm-ota-update.js
 *   k6 run --vus 200 --duration 5m k6/mdm-ota-update.js
 *   BASE_URL=https://your-app.manus.space k6 run k6/mdm-ota-update.js
 *
 * Environment variables:
 *   BASE_URL        Target base URL (default: http://localhost:3000)
 *   OTA_SERVICE_URL OTA service URL (default: http://localhost:8081)
 *   DEVICE_COUNT    Number of simulated devices (default: 500)
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Rate, Trend, Gauge } from "k6/metrics";

// ── Custom metrics ────────────────────────────────────────────────────────────
const otaCheckDuration = new Trend("ota_check_duration_ms", true);
const otaDownloadDuration = new Trend("ota_download_url_duration_ms", true);
const otaCheckSuccessRate = new Rate("ota_check_success_rate");
const otaUpdateAvailable = new Counter("ota_update_available_count");
const otaErrors = new Counter("ota_errors");
const activeDevices = new Gauge("ota_active_devices");

// ── Test configuration ────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Scenario 1: Steady fleet polling (devices check every 4h, staggered)
    fleet_polling: {
      executor: "constant-vus",
      vus: 50,
      duration: "2m",
      tags: { scenario: "fleet_polling" },
    },
    // Scenario 2: Mass update rollout (all devices check simultaneously)
    mass_update_rollout: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 200 }, // Ramp up to 200 VUs
        { duration: "1m", target: 200 }, // Hold — simulates fleet-wide update push
        { duration: "30s", target: 0 }, // Ramp down
      ],
      startTime: "2m30s", // Start after fleet_polling scenario
      tags: { scenario: "mass_update_rollout" },
    },
  },
  thresholds: {
    // OTA check endpoint: P95 < 200ms (devices need fast responses)
    ota_check_duration_ms: ["p(95)<200", "p(99)<500"],
    // Download URL generation: P95 < 1000ms (presigned URL generation)
    ota_download_url_duration_ms: ["p(95)<1000"],
    // Success rate: 99.9% (critical for fleet management)
    ota_check_success_rate: ["rate>0.999"],
    // HTTP error rate: < 0.1%
    http_req_failed: ["rate<0.001"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const OTA_SERVICE_URL = __ENV.OTA_SERVICE_URL || "http://localhost:8081";
const DEVICE_COUNT = parseInt(__ENV.DEVICE_COUNT || "500");

// ── Device model distribution (matches real InsurePortal fleet) ────────────────────
const DEVICE_MODELS = [
  { model: "PAX-A920", weight: 40 },
  { model: "PAX-A35", weight: 25 },
  { model: "Sunmi-P2", weight: 20 },
  { model: "Verifone-P400", weight: 10 },
  { model: "Ingenico-Move5000", weight: 5 },
];

const FIRMWARE_VERSIONS = [
  "1.0.0",
  "1.1.0",
  "1.2.0",
  "1.2.1",
  "1.3.0",
  "2.0.0",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function weightedRandom(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.model;
  }
  return items[0].model;
}

function randomDeviceId() {
  const id = Math.floor(Math.random() * DEVICE_COUNT) + 1;
  return `DEV-${String(id).padStart(6, "0")}`;
}

function randomFirmwareVersion() {
  return FIRMWARE_VERSIONS[
    Math.floor(Math.random() * FIRMWARE_VERSIONS.length)
  ];
}

// ── Main test function ────────────────────────────────────────────────────────
export default function () {
  const deviceId = randomDeviceId();
  const model = weightedRandom(DEVICE_MODELS);
  const currentVersion = randomFirmwareVersion();

  activeDevices.add(1);

  group("OTA Check for Update", () => {
    // Step 1: Check if update is available
    const checkStart = Date.now();
    const checkRes = http.get(
      `${OTA_SERVICE_URL}/api/v1/ota/check?model=${model}&version=${currentVersion}`,
      {
        headers: {
          "X-Device-ID": deviceId,
          "X-Device-Model": model,
          "X-Firmware-Version": currentVersion,
          Accept: "application/json",
        },
        timeout: "5s",
        tags: { endpoint: "ota_check" },
      }
    );
    const checkElapsed = Date.now() - checkStart;
    otaCheckDuration.add(checkElapsed);

    const checkOk = check(checkRes, {
      "check: status 200": r => r.status === 200,
      "check: has updateAvailable": r => {
        try {
          const body = JSON.parse(r.body);
          return typeof body.updateAvailable === "boolean";
        } catch {
          return false;
        }
      },
      "check: response time < 200ms": () => checkElapsed < 200,
    });

    otaCheckSuccessRate.add(checkOk);
    if (!checkOk) {
      otaErrors.add(1);
      return;
    }

    let body;
    try {
      body = JSON.parse(checkRes.body);
    } catch {
      otaErrors.add(1);
      return;
    }

    // Step 2: If update available, request download URL
    if (body.updateAvailable && body.firmwareId) {
      otaUpdateAvailable.add(1);

      const dlStart = Date.now();
      const dlRes = http.get(
        `${OTA_SERVICE_URL}/api/v1/ota/download/${body.firmwareId}`,
        {
          headers: {
            "X-Device-ID": deviceId,
            "X-Device-Model": model,
            Accept: "application/json",
          },
          timeout: "10s",
          tags: { endpoint: "ota_download" },
        }
      );
      const dlElapsed = Date.now() - dlStart;
      otaDownloadDuration.add(dlElapsed);

      const dlOk = check(dlRes, {
        "download: status 200": r => r.status === 200,
        "download: has downloadUrl": r => {
          try {
            const b = JSON.parse(r.body);
            return (
              typeof b.downloadUrl === "string" &&
              b.downloadUrl.startsWith("http")
            );
          } catch {
            return false;
          }
        },
        "download: has expiresAt": r => {
          try {
            const b = JSON.parse(r.body);
            return typeof b.expiresAt === "string";
          } catch {
            return false;
          }
        },
        "download: has checksum": r => {
          try {
            const b = JSON.parse(r.body);
            return typeof b.checksum === "string" && b.checksum.length > 0;
          } catch {
            return false;
          }
        },
        "download: response time < 1s": () => dlElapsed < 1000,
      });

      if (!dlOk) otaErrors.add(1);
    }
  });

  // Simulate device polling interval (staggered to avoid thundering herd)
  sleep(Math.random() * 2 + 0.5); // 0.5–2.5s between requests
}

// ── Setup ─────────────────────────────────────────────────────────────────────
export function setup() {
  // Verify OTA service is reachable
  const res = http.get(`${OTA_SERVICE_URL}/api/v1/ota/health`, {
    timeout: "5s",
  });
  if (res.status !== 200) {
    console.warn(
      `OTA service health check failed (status ${res.status}). Tests may fail.`
    );
  }
  console.log(
    `OTA Load Test: ${DEVICE_COUNT} simulated devices, base URL: ${OTA_SERVICE_URL}`
  );
  return { startTime: new Date().toISOString() };
}

// ── Teardown ──────────────────────────────────────────────────────────────────
export function teardown(data) {
  console.log(`OTA Load Test completed. Started: ${data.startTime}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const m = data.metrics;
  const summary = [
    "\n=== OTA Update Load Test Summary ===",
    `  OTA check P50:      ${m.ota_check_duration_ms?.values?.med?.toFixed(0) ?? "N/A"}ms`,
    `  OTA check P95:      ${m.ota_check_duration_ms?.values?.["p(95)"]?.toFixed(0) ?? "N/A"}ms`,
    `  Download URL P95:   ${m.ota_download_url_duration_ms?.values?.["p(95)"]?.toFixed(0) ?? "N/A"}ms`,
    `  Success rate:       ${((m.ota_check_success_rate?.values?.rate ?? 0) * 100).toFixed(3)}%`,
    `  Updates available:  ${m.ota_update_available_count?.values?.count ?? 0}`,
    `  Total errors:       ${m.ota_errors?.values?.count ?? 0}`,
    `  Total requests:     ${m.iterations?.values?.count ?? 0}`,
  ].join("\n");

  return {
    "k6/results/mdm-ota-update.json": JSON.stringify(data, null, 2),
    stdout: summary,
  };
}
