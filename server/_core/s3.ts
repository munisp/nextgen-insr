/**
 * Generic object-storage upload helper (MinIO / S3-compatible).
 * Used by j20-scheduler for report artifacts. Config matches server/lakehouse.ts.
 */
import { S3Client, PutObjectCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? "minioadmin";
const MINIO_REGION = process.env.MINIO_REGION ?? "us-east-1";
const REPORTS_BUCKET = process.env.REPORTS_BUCKET ?? "insureportal-reports";
// P-wave perf (2026-09-19): separate bucket for direct client uploads.
const UPLOADS_BUCKET = process.env.MINIO_UPLOADS_BUCKET ?? "insureportal-uploads";

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

let _bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (_bucketEnsured) return;
  try {
    await getS3Client().send(new CreateBucketCommand({ Bucket: REPORTS_BUCKET }));
  } catch {
    // BucketAlreadyOwnedByYou / BucketAlreadyExists — fine
  }
  _bucketEnsured = true;
}

/**
 * Upload an object and return its URL.
 */
export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string
): Promise<string> {
  await ensureBucket();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: REPORTS_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return `${MINIO_ENDPOINT}/${REPORTS_BUCKET}/${key}`;
}

// ── Presigned PUT for direct client uploads (P-wave perf, 2026-09-19) ────────
// Uploads previously proxied raw bytes through the Node process (multipart
// POST to the forge storage proxy or in-request PutObject), consuming Node
// memory/CPU and holding request slots on document-heavy traffic. Clients now
// upload DIRECTLY to MinIO with a presigned PUT URL; the server only
// authorizes and signs. The signed Content-Type is enforced by S3 signature
// validation; size is constrained at issuance time by the calling endpoint
// (declared-byte cap) — enforce a bucket-side max via MinIO bucket policy in
// production.
const _bucketsEnsured = new Set<string>();
async function ensureBucketNamed(bucket: string): Promise<void> {
  if (_bucketsEnsured.has(bucket)) return;
  try {
    await getS3Client().send(new CreateBucketCommand({ Bucket: bucket }));
  } catch {
    // BucketAlreadyOwnedByYou / BucketAlreadyExists — fine
  }
  _bucketsEnsured.add(bucket);
}

/**
 * Issue a presigned PUT URL for a direct-to-MinIO client upload.
 * `contentType` is baked into the signature (a PUT with a different
 * Content-Type is rejected). expiresInSeconds defaults to 1 hour.
 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 3600
): Promise<{ uploadUrl: string; bucket: string; key: string; expiresIn: number }> {
  await ensureBucketNamed(UPLOADS_BUCKET);
  const url = await getSignedUrl(
    // @aws-sdk/client-s3 and s3-request-presigner may resolve different minor
    // versions; the runtime client is compatible (same pattern as lakehouse.ts).
    getS3Client() as unknown as Parameters<typeof getSignedUrl>[0],
    new PutObjectCommand({
      Bucket: UPLOADS_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSeconds }
  );
  return { uploadUrl: url, bucket: UPLOADS_BUCKET, key, expiresIn: expiresInSeconds };
}
