import type { StorageProvider as StorageProviderId } from "@paperclipai/shared";
import type { Readable } from "node:stream";

export interface PutObjectInput {
  objectKey: string;
  // Readable bodies stream straight to the backend (contentLength must be the
  // exact byte size); Buffer stays supported for small payloads.
  body: Buffer | Readable;
  contentType: string;
  contentLength: number;
}

export interface GetObjectInput {
  objectKey: string;
  range?: {
    start: number;
    end: number;
  };
}

export interface GetObjectResult {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
}

export interface HeadObjectResult {
  exists: boolean;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
}

export interface StorageProvider {
  id: StorageProviderId;
  /** Private configured namespace identity. Unknown legacy/custom providers
   * cannot qualify protected-feedback allocation or physical erasure. */
  readonly scopeId?: string;
  putObject(input: PutObjectInput): Promise<void>;
  getObject(input: GetObjectInput): Promise<GetObjectResult>;
  headObject(input: GetObjectInput): Promise<HeadObjectResult>;
  deleteObject(input: GetObjectInput): Promise<void>;
}

export interface PutFileInput {
  companyId: string;
  namespace: string;
  originalFilename: string | null;
  contentType: string;
  body: Buffer;
  /** Server-owned durable reservation, completed before any provider write.
   * It receives only the original Storage owner's allocated company key. */
  onAllocated?: (objectKey: string) => Promise<void>;
  /** Observed only after the actual provider write fulfils. A rejected or
   * unknown provider acknowledgement never invokes this callback. */
  onTransportSettled?: (objectKey: string) => Promise<void>;
}

export interface PutFileResult {
  provider: StorageProviderId;
  readonly scopeId?: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  originalFilename: string | null;
}

export interface StorageAccounting {
  reserve(companyId: string, objectKey: string, byteSize: number): Promise<void>;
  stored(companyId: string, objectKey: string): Promise<void>;
  deleting(companyId: string, objectKey: string): Promise<void>;
  deleted(companyId: string, objectKey: string): Promise<void>;
}

export interface StorageService {
  provider: StorageProviderId;
  readonly scopeId?: string;
  putFile(input: PutFileInput): Promise<PutFileResult>;
  getObject(companyId: string, objectKey: string, options?: Pick<GetObjectInput, "range">): Promise<GetObjectResult>;
  headObject(companyId: string, objectKey: string): Promise<HeadObjectResult>;
  deleteObject(companyId: string, objectKey: string): Promise<void>;
}
