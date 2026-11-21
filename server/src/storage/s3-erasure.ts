import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { conflict } from "../errors.js";

const ERASE_PAGE_SIZE = 100;
const ERASE_PAGE_LIMIT = 10_000;

function inScope(key: string | undefined, prefix: string, exactKey?: string): boolean {
  return Boolean(key && key.startsWith(prefix) && (!exactKey || key === exactKey));
}

async function eraseS3Scope(client: S3Client, bucket: string, prefix: string, exactKey?: string): Promise<number> {
  let removed = 0;
  let versionPages = 0;
  let objectPages = 0;
  // Re-read the first page after each batch because deleting pages while
  // advancing markers can skip versions. This preserves the existing 10,000
  // page bound for each listing surface.
  while (true) {
    while (true) {
      if (versionPages >= ERASE_PAGE_LIMIT) throw conflict("Object version erasure ceiling reached", { code: "storage_object_erasure_pending" });
      const versions = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, MaxKeys: ERASE_PAGE_SIZE }), { abortSignal: AbortSignal.timeout(30000) });
      versionPages++;
      const records = [...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])];
      for (const record of records) {
        if (!record.Key?.startsWith(prefix) || !record.VersionId) throw conflict("Object version scope mismatch", { code: "storage_object_erasure_pending" });
      }
      const selected = records.filter(record => inScope(record.Key, prefix, exactKey));
      if (!selected.length) break;
      for (const record of selected) {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: record.Key!, VersionId: record.VersionId! }), { abortSignal: AbortSignal.timeout(30000) });
        removed++;
      }
    }

    if (objectPages >= ERASE_PAGE_LIMIT) throw conflict("Object erasure page ceiling reached", { code: "storage_object_erasure_pending" });
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: ERASE_PAGE_SIZE }), { abortSignal: AbortSignal.timeout(30000) });
    objectPages++;
    const contents = listed.Contents ?? [];
    for (const item of contents) {
      if (!item.Key?.startsWith(prefix)) throw conflict("Object erasure prefix mismatch", { code: "storage_object_erasure_pending" });
    }
    const selected = contents.filter(item => inScope(item.Key, prefix, exactKey));
    if (!selected.length) return removed;
    for (const item of selected) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: item.Key! }), { abortSignal: AbortSignal.timeout(30000) });
      removed++;
    }
  }
}

/** Deletes an existing storage namespace using the bounded company-erasure algorithm. */
export async function eraseS3Prefix(client: S3Client, bucket: string, prefix: string): Promise<number> {
  if (!prefix) throw conflict("Object erasure prefix is required", { code: "storage_object_erasure_pending" });
  return eraseS3Scope(client, bucket, prefix);
}

/** Removes every version, marker and current copy of one exact key, then proves absence. */
export async function eraseS3Object(client: S3Client, bucket: string, objectKey: string): Promise<void> {
  if (!objectKey) throw conflict("Object erasure key is required", { code: "storage_object_erasure_pending" });
  await eraseS3Scope(client, bucket, objectKey, objectKey);

  const versions = await client.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: objectKey, MaxKeys: ERASE_PAGE_SIZE }), { abortSignal: AbortSignal.timeout(30000) });
  if ([...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])].some(record => record.Key === objectKey))
    throw conflict("Object version erasure is unconfirmed", { code: "storage_object_erasure_pending" });
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: objectKey, MaxKeys: ERASE_PAGE_SIZE }), { abortSignal: AbortSignal.timeout(30000) });
  if (listed.Contents?.some(item => item.Key === objectKey))
    throw conflict("Object erasure is unconfirmed", { code: "storage_object_erasure_pending" });

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }), { abortSignal: AbortSignal.timeout(30000) });
  } catch (error) {
    const providerError = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (providerError.$metadata?.httpStatusCode === 404 && ["NoSuchKey", "NotFound"].includes(providerError.name ?? "")) return;
    throw error;
  }
  throw conflict("Object erasure is unconfirmed", { code: "storage_object_erasure_pending" });
}
