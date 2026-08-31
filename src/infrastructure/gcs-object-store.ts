import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import type { DocumentMaterializationStore } from
  "../application/document-materialization-worker.js";
import {
  PrivateObjectNotFoundError,
  type PrivateObjectStore,
} from "../application/individual-document-delivery.js";
import type { TenantLifecycleObjectStore } from
  "../application/tenant-data-lifecycle-worker.js";

const UUID_PART =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_PART}$`, "i");
const DOCUMENT_OBJECT = new RegExp(
  `^documents/tenant/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.pdf$`, "i",
);
const EXPORT_OBJECT = new RegExp(
  `^exports/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.json$`, "i",
);
const ALLOWED_OBJECT = new RegExp(
  `^(?:documents/tenant/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.pdf|` +
  `exports/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.json)$`, "i",
);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;

export interface GcsStoredObject {
  readonly bytes: Uint8Array;
  readonly contentType: "application/pdf" | "application/json";
  readonly sha256: string;
}

export interface GcsObjectGateway {
  create(input: {
    readonly objectId: string;
    readonly bytes: Uint8Array;
    readonly contentType: GcsStoredObject["contentType"];
    readonly sha256: string;
  }): Promise<"created" | "exists">;
  read(input: {
    readonly objectId: string;
    readonly maximumBytes: number;
  }): Promise<GcsStoredObject | null>;
  delete(objectId: string): Promise<"deleted" | "missing">;
}

export class GcsObjectStoreConfigurationError extends Error {
  constructor() {
    super("GCS object store configuration is invalid.");
    this.name = "GcsObjectStoreConfigurationError";
  }
}

export class GcsObjectStoreError extends Error {
  constructor() {
    super("GCS object store operation failed.");
    this.name = "GcsObjectStoreError";
  }
}

interface StageRecord {
  readonly executionId: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

interface GcsObjectStoreOptions {
  readonly maximumDocumentBytes: number;
  readonly maximumExportBytes: number;
  readonly createStageToken?: () => string;
}

const isBoundedInteger = (
  value: number,
  maximum: number,
): boolean => Number.isInteger(value) && value >= 1 && value <= maximum;

const isBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array;

const digest = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const hashesEqual = (left: string, right: string): boolean => {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  const leftBytes = Buffer.from(left.slice("sha256:".length), "hex");
  const rightBytes = Buffer.from(right.slice("sha256:".length), "hex");
  return leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes);
};

const storedObjectMatches = (
  stored: GcsStoredObject | null,
  expected: {
    readonly bytes: Uint8Array;
    readonly contentType: GcsStoredObject["contentType"];
    readonly sha256: string;
  },
): stored is GcsStoredObject =>
  stored !== null &&
  isBytes(stored.bytes) &&
  stored.bytes.byteLength === expected.bytes.byteLength &&
  stored.contentType === expected.contentType &&
  hashesEqual(stored.sha256, expected.sha256) &&
  hashesEqual(digest(stored.bytes), expected.sha256);

export class GcsObjectStore implements
  PrivateObjectStore,
  DocumentMaterializationStore,
  TenantLifecycleObjectStore {
  private readonly stages = new Map<string, StageRecord>();
  private readonly createStageToken: () => string;

  constructor(
    private readonly gateway: GcsObjectGateway,
    private readonly options: GcsObjectStoreOptions,
  ) {
    if (
      !gateway || typeof gateway.create !== "function" ||
      typeof gateway.read !== "function" || typeof gateway.delete !== "function" ||
      !isBoundedInteger(options.maximumDocumentBytes, MAX_DOCUMENT_BYTES) ||
      !isBoundedInteger(options.maximumExportBytes, MAX_EXPORT_BYTES) ||
      (options.createStageToken !== undefined &&
        typeof options.createStageToken !== "function")
    ) throw new GcsObjectStoreConfigurationError();
    this.createStageToken = options.createStageToken ?? randomUUID;
  }

  stage(input: {
    readonly executionId: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  }): Promise<{ readonly token: string }> {
    if (
      !UUID.test(input.executionId) || !isBytes(input.bytes) ||
      !isBoundedInteger(input.bytes.byteLength, this.options.maximumDocumentBytes) ||
      !SHA256.test(input.sha256) || !hashesEqual(digest(input.bytes), input.sha256)
    ) throw new GcsObjectStoreError();
    let token: string;
    try {
      token = this.createStageToken();
    } catch {
      throw new GcsObjectStoreError();
    }
    if (!UUID.test(token) || this.stages.has(token)) throw new GcsObjectStoreError();
    this.stages.set(token, {
      executionId: input.executionId,
      sizeBytes: input.bytes.byteLength,
      sha256: input.sha256,
    });
    return Promise.resolve({ token });
  }

  async publish(input: {
    readonly stageToken: string;
    readonly tenantId: string;
    readonly documentId: string;
    readonly artifactId: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  }): Promise<{ readonly storageObjectId: string }> {
    const stage = this.stages.get(input.stageToken);
    if (
      !stage || !UUID.test(input.tenantId) || !UUID.test(input.documentId) ||
      !UUID.test(input.artifactId) || !isBytes(input.bytes) ||
      input.bytes.byteLength !== stage.sizeBytes ||
      !hashesEqual(input.sha256, stage.sha256) ||
      !hashesEqual(digest(input.bytes), stage.sha256)
    ) throw new GcsObjectStoreError();
    const objectId =
      `documents/tenant/${input.tenantId}/${input.documentId}/${input.artifactId}.pdf`;
    await this.createOrVerify({
      objectId,
      bytes: input.bytes,
      contentType: "application/pdf",
      sha256: input.sha256,
    });
    return { storageObjectId: objectId };
  }

  discard(stageToken: string): Promise<void> {
    this.stages.delete(stageToken);
    return Promise.resolve();
  }

  async read(storageObjectId: string, maximumBytes: number): Promise<Uint8Array> {
    if (!DOCUMENT_OBJECT.test(storageObjectId)) {
      throw new PrivateObjectNotFoundError();
    }
    if (!isBoundedInteger(maximumBytes, this.options.maximumDocumentBytes)) {
      throw new GcsObjectStoreError();
    }
    let stored: GcsStoredObject | null;
    try {
      stored = await this.gateway.read({
        objectId: storageObjectId, maximumBytes,
      });
    } catch {
      throw new GcsObjectStoreError();
    }
    if (!stored) throw new PrivateObjectNotFoundError();
    if (
      stored.contentType !== "application/pdf" ||
      stored.bytes.byteLength !== maximumBytes ||
      !hashesEqual(digest(stored.bytes), stored.sha256)
    ) throw new GcsObjectStoreError();
    return Uint8Array.from(stored.bytes);
  }

  async writeExport(input: {
    readonly tenantId: string;
    readonly requestId: string;
    readonly artifactId: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  }): Promise<string> {
    if (
      !UUID.test(input.tenantId) || !UUID.test(input.requestId) ||
      !UUID.test(input.artifactId) || !isBytes(input.bytes) ||
      !isBoundedInteger(input.bytes.byteLength, this.options.maximumExportBytes) ||
      !SHA256.test(input.sha256) || !hashesEqual(digest(input.bytes), input.sha256)
    ) throw new GcsObjectStoreError();
    const objectId =
      `exports/${input.tenantId}/${input.requestId}/${input.artifactId}.json`;
    await this.createOrVerify({
      objectId,
      bytes: input.bytes,
      contentType: "application/json",
      sha256: input.sha256,
    });
    return objectId;
  }

  async readExport(input: {
    readonly storageObjectId: string;
    readonly expectedBytes: number;
    readonly expectedSha256: string;
  }): Promise<Uint8Array> {
    if (
      !EXPORT_OBJECT.test(input.storageObjectId) ||
      !isBoundedInteger(input.expectedBytes, this.options.maximumExportBytes) ||
      !SHA256.test(input.expectedSha256)
    ) throw new GcsObjectStoreError();
    let stored: GcsStoredObject | null;
    try {
      stored = await this.gateway.read({
        objectId: input.storageObjectId,
        maximumBytes: input.expectedBytes,
      });
    } catch {
      throw new GcsObjectStoreError();
    }
    if (
      !stored || stored.contentType !== "application/json" ||
      stored.bytes.byteLength !== input.expectedBytes ||
      !hashesEqual(stored.sha256, input.expectedSha256) ||
      !hashesEqual(digest(stored.bytes), input.expectedSha256)
    ) throw new GcsObjectStoreError();
    return Uint8Array.from(stored.bytes);
  }

  async deleteObject(storageObjectId: string): Promise<void> {
    if (!ALLOWED_OBJECT.test(storageObjectId)) throw new GcsObjectStoreError();
    try {
      await this.gateway.delete(storageObjectId);
    } catch {
      throw new GcsObjectStoreError();
    }
  }

  private async createOrVerify(input: {
    readonly objectId: string;
    readonly bytes: Uint8Array;
    readonly contentType: GcsStoredObject["contentType"];
    readonly sha256: string;
  }): Promise<void> {
    try {
      const result = await this.gateway.create(input);
      if (result === "created") return;
      const stored = await this.gateway.read({
        objectId: input.objectId,
        maximumBytes: input.bytes.byteLength,
      });
      if (!storedObjectMatches(stored, input)) throw new GcsObjectStoreError();
    } catch (error) {
      if (error instanceof GcsObjectStoreError) throw error;
      throw new GcsObjectStoreError();
    }
  }
}
