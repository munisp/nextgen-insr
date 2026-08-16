/**
 * Generic object-storage upload helper (MinIO / S3-compatible).
 * Used by j20-scheduler for report artifacts. Config matches server/lakehouse.ts.
 */
import { S3Client, PutObjectCommand, CreateBucketCommand } from "@aws-sdk/client-s3";

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? "minioadmin";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? "minioadmin";
const MINIO_REGION = process.env.MINIO_REGION ?? "us-east-1";
const REPORTS_BUCKET = process.env.REPORTS_BUCKET ?? "insureportal-reports";

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
