import 'server-only';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** DigitalOcean Spaces behind the standard S3 SDK. Objects are private;
 *  access is only ever through short-lived presigned URLs. The whole layer
 *  degrades gracefully when the SPACES_* env vars are unset. */

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.SPACES_KEY &&
      process.env.SPACES_SECRET &&
      process.env.SPACES_ENDPOINT &&
      process.env.SPACES_BUCKET,
  );
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!isStorageConfigured()) {
    throw new Error('File storage is not configured. Set the SPACES_* environment variables.');
  }
  if (!client) {
    client = new S3Client({
      // The SDK uses region only for validation; the endpoint decides the
      // real location. Spaces uses virtual-hosted-style URLs.
      region: 'us-east-1',
      endpoint: process.env.SPACES_ENDPOINT,
      forcePathStyle: false,
      credentials: {
        accessKeyId: process.env.SPACES_KEY!,
        secretAccessKey: process.env.SPACES_SECRET!,
      },
    });
  }
  return client;
}

const bucket = () => process.env.SPACES_BUCKET!;

/** Presigned PUT so uploads go browser-to-Spaces without the file ever
 *  passing through the app server. Five minutes is plenty. */
export async function getSignedUploadUrl(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType, ACL: 'private' }),
    { expiresIn: 300 },
  );
}

/** Presigned GET for viewing. Inline disposition renders PDFs in the
 *  browser instead of forcing a download. */
export async function getSignedViewUrl(
  key: string,
  fileName: string,
  contentType: string,
  inline = true,
): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentType: contentType,
      ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}; filename="${fileName.replace(/"/g, '')}"`,
    }),
    { expiresIn: 600 },
  );
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
