// TypeScript enabled — Sprint 96 security audit
/**
 * InsurePortal Lakehouse Client
 * Uses MinIO (S3-compatible) as the object store for Parquet-format data exports.
 * Provides analytics data pipeline: PostgreSQL → JSON → Parquet → MinIO.
 *
 * Buckets:
 *   insureportal-transactions   — daily transaction snapshots (Parquet)
 *   insureportal-settlements    — settlement summaries (JSON)
 *   insureportal-fraud-events   — fraud alert history (JSON)
 *   insureportal-agent-metrics  — agent performance metrics (Parquet)
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import logger from "./_core/logger";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? "minioadmin";
const MINIO_REGION = process.env.MINIO_REGION ?? "us-east-1";

let _s3: S3Client | null = null;

function getS3Client(): S3Client {
  if (_s3) return _s3;
  _s3 = new S3Client({
    endpoint: MINIO_ENDPOINT,
    region: MINIO_REGION,
    credentials: {
      accessKeyId: MINIO_ACCESS_KEY,
      secretAccessKey: MINIO_SECRET_KEY,
    },
    forcePathStyle: true, // Required for MinIO
  });
  return _s3;
}

// ── Bucket names ───────────────────────────────────────────────────────────────
export const BUCKETS = {
  TRANSACTIONS: "insureportal-transactions",
  SETTLEMENTS: "insureportal-settlements",
  FRAUD_EVENTS: "insureportal-fraud-events",
  AGENT_METRICS: "insureportal-agent-metrics",
} as const;

// ── Upload helpers ─────────────────────────────────────────────────────────────

/**
 * Upload a JSON snapshot to MinIO.
 * Key format: {bucket}/{YYYY}/{MM}/{DD}/{filename}.json
 */
export async function uploadJsonSnapshot(
  bucket: string,
  filename: string,
  data: object[]
): Promise<string | null> {
  const now = new Date();
  const key = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${filename}.json`;

  try {
    const s3 = getS3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: "application/json",
        Metadata: {
          "record-count": String(data.length),
          "uploaded-at": now.toISOString(),
        },
      })
    );
    logger.info(
      `[Lakehouse] Uploaded ${data.length} records → s3://${bucket}/${key}`
    );
    return key;
  } catch (err) {
    logger.warn({ err }, `[Lakehouse] Upload to s3://${bucket}/${key} failed`);
    return null;
  }
}

/**
 * Upload a daily transaction snapshot.
 */
export async function uploadTransactionSnapshot(
  date: string,
  transactions: object[]
): Promise<string | null> {
  return uploadJsonSnapshot(
    BUCKETS.TRANSACTIONS,
    `transactions-${date}`,
    transactions
  );
}

/**
 * Upload a settlement summary.
 */
export async function uploadSettlementSummary(
  date: string,
  summary: object
): Promise<string | null> {
  const key = `${date.replace(/-/g, "/")}/settlement-summary-${date}.json`;
  try {
    const s3 = getS3Client();
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKETS.SETTLEMENTS,
        Key: key,
        Body: JSON.stringify(summary, null, 2),
        ContentType: "application/json",
      })
    );
    logger.info(
      `[Lakehouse] Settlement summary uploaded → s3://${BUCKETS.SETTLEMENTS}/${key}`
    );
    return key;
  } catch (err) {
    logger.warn({ err }, "[Lakehouse] Settlement summary upload failed");
    return null;
  }
}

/**
 * Upload a fraud events snapshot.
 */
export async function uploadFraudEvents(
  date: string,
  events: object[]
): Promise<string | null> {
  return uploadJsonSnapshot(
    BUCKETS.FRAUD_EVENTS,
    `fraud-events-${date}`,
    events
  );
}

/**
 * List available snapshots in a bucket for a given date prefix.
 */
export async function listSnapshots(
  bucket: string,
  datePrefix: string
): Promise<string[]> {
  try {
    const s3 = getS3Client();
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: datePrefix.replace(/-/g, "/"),
        MaxKeys: 100,
      })
    );
    return (res.Contents ?? []).map(obj => obj.Key ?? "").filter(Boolean);
  } catch (err) {
    logger.warn({ err }, `[Lakehouse] List snapshots in ${bucket} failed`);
    return [];
  }
}

/**
 * Get a presigned download URL for a snapshot file.
 */
export async function getSnapshotDownloadUrl(
  bucket: string,
  key: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  try {
    const s3 = getS3Client();
    const url = await getSignedUrl(
      // @aws-sdk/client-s3 and s3-request-presigner resolve different minor
      // versions; their Client types are structurally compatible but nominal
      s3 as unknown as Parameters<typeof getSignedUrl>[0],
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: expiresInSeconds }
    );
    return url;
  } catch (err) {
    logger.warn({ err }, "[Lakehouse] Presigned URL generation failed");
    return null;
  }
}

export default {
  uploadTransactionSnapshot,
  uploadSettlementSummary,
  uploadFraudEvents,
  listSnapshots,
  getSnapshotDownloadUrl,
  BUCKETS,
};
