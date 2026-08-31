import { createHash, timingSafeEqual } from "node:crypto";

import { Storage } from "@google-cloud/storage";

import type {
  GcsObjectGateway,
  GcsStoredObject,
} from "./gcs-object-store.js";

const UUID_PART =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OBJECT_ID = new RegExp(
  `^(?:documents/tenant/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.pdf|` +
  `exports/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.json)$`, "i",
);
const BUCKET_NAME = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const GENERATION = /^[1-9][0-9]*$/;
const MAXIMUM_BYTES = 25 * 1024 * 1024;

interface GoogleObjectMetadata {
  readonly size?: string | number;
  readonly generation?: string | number;
  readonly contentType?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface GoogleStorageFile {
  save(data: Buffer, options: {
    readonly resumable: false;
    readonly validation: "crc32c";
    readonly preconditionOpts: { readonly ifGenerationMatch: 0 };
    readonly metadata: {
      readonly cacheControl: "private, no-store";
      readonly contentDisposition: "attachment";
      readonly contentType: GcsStoredObject["contentType"];
      readonly metadata: { readonly sha256: string };
    };
  }): Promise<unknown>;
  getMetadata(): Promise<readonly [GoogleObjectMetadata, ...unknown[]]>;
  download(): Promise<readonly [Buffer, ...unknown[]]>;
  delete(options: {
    readonly preconditionOpts: { readonly ifGenerationMatch: string };
  }): Promise<unknown>;
}

interface GoogleStorageBucket {
  file(objectId: string, options?: {
    readonly generation?: string;
  }): GoogleStorageFile;
}

export interface GoogleStorageClient {
  bucket(bucketName: string): GoogleStorageBucket;
}

export class GoogleCloudStorageGatewayConfigurationError extends Error {
  constructor() {
    super("Google Cloud Storage gateway configuration is invalid.");
    this.name = "GoogleCloudStorageGatewayConfigurationError";
  }
}

export class GoogleCloudStorageGatewayError extends Error {
  constructor() {
    super("Google Cloud Storage gateway operation failed.");
    this.name = "GoogleCloudStorageGatewayError";
  }
}

const code = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const parsed = Number((error as { readonly code?: unknown }).code);
  return Number.isInteger(parsed) ? parsed : undefined;
};

const digest = (bytes: Uint8Array): Buffer =>
  createHash("sha256").update(bytes).digest();

const hashMatches = (bytes: Uint8Array, expected: string): boolean => {
  if (!SHA256.test(expected)) return false;
  const expectedBytes = Buffer.from(expected.slice("sha256:".length), "hex");
  const actual = digest(bytes);
  return expectedBytes.byteLength === actual.byteLength &&
    timingSafeEqual(expectedBytes, actual);
};

const validObjectId = (value: string): boolean => OBJECT_ID.test(value);

const validMaximum = (value: number): boolean =>
  Number.isInteger(value) && value >= 1 && value <= MAXIMUM_BYTES;

const isByteView = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) && "BYTES_PER_ELEMENT" in value &&
  value.BYTES_PER_ELEMENT === 1;

export class GoogleCloudStorageGateway implements GcsObjectGateway {
  private readonly bucket: GoogleStorageBucket;

  constructor(
    bucketName: string,
    storage: GoogleStorageClient = new Storage(),
  ) {
    if (!BUCKET_NAME.test(bucketName)) {
      throw new GoogleCloudStorageGatewayConfigurationError();
    }
    try {
      this.bucket = storage.bucket(bucketName);
    } catch {
      throw new GoogleCloudStorageGatewayConfigurationError();
    }
  }

  async create(input: {
    readonly objectId: string;
    readonly bytes: Uint8Array;
    readonly contentType: GcsStoredObject["contentType"];
    readonly sha256: string;
  }): Promise<"created" | "exists"> {
    if (
      !validObjectId(input.objectId) || !isByteView(input.bytes) ||
      !validMaximum(input.bytes.byteLength) ||
      !["application/pdf", "application/json"].includes(input.contentType) ||
      !hashMatches(input.bytes, input.sha256)
    ) throw new GoogleCloudStorageGatewayError();
    try {
      await this.bucket.file(input.objectId).save(Buffer.from(input.bytes), {
        resumable: false,
        validation: "crc32c",
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          cacheControl: "private, no-store",
          contentDisposition: "attachment",
          contentType: input.contentType,
          metadata: { sha256: input.sha256 },
        },
      });
      return "created";
    } catch (error) {
      if (code(error) === 412) return "exists";
      throw new GoogleCloudStorageGatewayError();
    }
  }

  async read(input: {
    readonly objectId: string;
    readonly maximumBytes: number;
  }): Promise<GcsStoredObject | null> {
    if (!validObjectId(input.objectId) || !validMaximum(input.maximumBytes)) {
      throw new GoogleCloudStorageGatewayError();
    }
    try {
      const [metadata] = await this.bucket.file(input.objectId).getMetadata();
      const size = Number(metadata.size);
      const generation = String(metadata.generation ?? "");
      const contentType = metadata.contentType;
      const sha256 = metadata.metadata?.sha256;
      if (
        !Number.isSafeInteger(size) || size < 1 || size > input.maximumBytes ||
        !GENERATION.test(generation) ||
        (contentType !== "application/pdf" && contentType !== "application/json") ||
        typeof sha256 !== "string" || !SHA256.test(sha256)
      ) throw new GoogleCloudStorageGatewayError();
      const [content] = await this.bucket.file(input.objectId, {
        generation,
      }).download();
      if (
        !isByteView(content) || content.byteLength !== size ||
        !hashMatches(content, sha256)
      ) throw new GoogleCloudStorageGatewayError();
      return {
        bytes: Uint8Array.from(content),
        contentType,
        sha256,
      };
    } catch (error) {
      if (code(error) === 404) return null;
      if (error instanceof GoogleCloudStorageGatewayError) throw error;
      throw new GoogleCloudStorageGatewayError();
    }
  }

  async delete(objectId: string): Promise<"deleted" | "missing"> {
    if (!validObjectId(objectId)) throw new GoogleCloudStorageGatewayError();
    try {
      const [metadata] = await this.bucket.file(objectId).getMetadata();
      const generation = String(metadata.generation ?? "");
      if (!GENERATION.test(generation)) throw new GoogleCloudStorageGatewayError();
      await this.bucket.file(objectId, { generation }).delete({
        preconditionOpts: { ifGenerationMatch: generation },
      });
      return "deleted";
    } catch (error) {
      if (code(error) === 404) return "missing";
      if (error instanceof GoogleCloudStorageGatewayError) throw error;
      throw new GoogleCloudStorageGatewayError();
    }
  }
}
