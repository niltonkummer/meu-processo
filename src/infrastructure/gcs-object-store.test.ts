import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { PrivateObjectNotFoundError } from
  "../application/individual-document-delivery.js";
import {
  GcsObjectStore,
  GcsObjectStoreConfigurationError,
  GcsObjectStoreError,
  type GcsObjectGateway,
  type GcsStoredObject,
} from "./gcs-object-store.js";

const EXECUTION = "10000000-0000-7000-8000-000000000001";
const TENANT = "10000000-0000-7000-8000-000000000002";
const DOCUMENT = "10000000-0000-7000-8000-000000000003";
const REQUEST = "10000000-0000-7000-8000-000000000004";
const ARTIFACT = "10000000-0000-7000-8000-000000000005";
const TOKEN = "10000000-0000-7000-8000-000000000006";
const PDF = new Uint8Array(Buffer.from("%PDF-1.7\n%%EOF\n"));
const JSON_BYTES = new Uint8Array(Buffer.from('{"schemaVersion":1}\n'));
const digest = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const PDF_HASH = digest(PDF);
const JSON_HASH = digest(JSON_BYTES);
const PDF_OBJECT =
  `documents/tenant/${TENANT}/${DOCUMENT}/${ARTIFACT}.pdf`;
const EXPORT_OBJECT = `exports/${TENANT}/${REQUEST}/${ARTIFACT}.json`;

const gateway = (): GcsObjectGateway => ({
  create: vi.fn().mockResolvedValue("created"),
  read: vi.fn().mockResolvedValue(null),
  delete: vi.fn().mockResolvedValue("deleted"),
});

const stored = (
  bytes: Uint8Array,
  contentType: "application/pdf" | "application/json",
): GcsStoredObject => ({
  bytes,
  contentType,
  sha256: digest(bytes),
});

const store = (
  client = gateway(),
  overrides: Partial<ConstructorParameters<typeof GcsObjectStore>[1]> = {},
): GcsObjectStore =>
  new GcsObjectStore(client, {
    maximumDocumentBytes: 25 * 1024 * 1024,
    maximumExportBytes: 10 * 1024 * 1024,
    createStageToken: () => TOKEN,
    ...overrides,
  });

describe("GCS object store", () => {
  it("rejects unsafe capacity and stage-token configuration", () => {
    const client = gateway();
    expect(() => new GcsObjectStore(client, {
      maximumDocumentBytes: 0,
      maximumExportBytes: 1,
      createStageToken: () => TOKEN,
    })).toThrow(GcsObjectStoreConfigurationError);
    expect(() => new GcsObjectStore(client, {
      maximumDocumentBytes: 1,
      maximumExportBytes: 10 * 1024 * 1024 + 1,
      createStageToken: () => TOKEN,
    })).toThrow(GcsObjectStoreConfigurationError);
    expect(() => new GcsObjectStore(null as unknown as GcsObjectGateway, {
      maximumDocumentBytes: 1,
      maximumExportBytes: 1,
    })).toThrow(GcsObjectStoreConfigurationError);
    expect(() => new GcsObjectStore({
      create: undefined,
      read: vi.fn(),
      delete: vi.fn(),
    } as unknown as GcsObjectGateway, {
      maximumDocumentBytes: 1,
      maximumExportBytes: 1,
    })).toThrow(GcsObjectStoreConfigurationError);
    expect(() => new GcsObjectStore(client, {
      maximumDocumentBytes: 25 * 1024 * 1024 + 1,
      maximumExportBytes: 1,
    })).toThrow(GcsObjectStoreConfigurationError);
    expect(() => new GcsObjectStore(client, {
      maximumDocumentBytes: 1,
      maximumExportBytes: 1,
      createStageToken: "invalid" as unknown as () => string,
    })).toThrow(GcsObjectStoreConfigurationError);
  });

  it("rejects every malformed stage field and unsafe stage token", async () => {
    const client = gateway();
    const small = store(client, { maximumDocumentBytes: PDF.byteLength });
    const valid = { executionId: EXECUTION, bytes: PDF, sha256: PDF_HASH };
    for (const change of [
      { executionId: "invalid" },
      { bytes: new Uint8Array() },
      { bytes: new Uint8Array(PDF.byteLength + 1) },
      { sha256: "invalid" },
      { sha256: `sha256:${"0".repeat(64)}` },
    ]) {
      await expect(Promise.resolve().then(() =>
        small.stage({ ...valid, ...change })))
        .rejects.toThrow(GcsObjectStoreError);
    }
    await expect(Promise.resolve().then(() => store(client, {
      createStageToken: () => { throw new Error("random failed"); },
    }).stage(valid))).rejects.toThrow(GcsObjectStoreError);
    await expect(Promise.resolve().then(() =>
      store(client, { createStageToken: () => "invalid" }).stage(valid)))
      .rejects.toThrow(GcsObjectStoreError);
    const duplicate = store(client);
    await duplicate.stage(valid);
    await expect(Promise.resolve().then(() => duplicate.stage(valid)))
      .rejects.toThrow(GcsObjectStoreError);

    const defaultTokenStore = new GcsObjectStore(client, {
      maximumDocumentBytes: 25 * 1024 * 1024,
      maximumExportBytes: 10 * 1024 * 1024,
    });
    await expect(defaultTokenStore.stage(valid)).resolves.toEqual({
      token: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("stages and conditionally publishes a tenant-bound PDF", async () => {
    const client = gateway();
    const objectStore = store(client);
    await expect(objectStore.stage({
      executionId: EXECUTION, bytes: PDF, sha256: PDF_HASH,
    })).resolves.toEqual({ token: TOKEN });
    await expect(objectStore.publish({
      stageToken: TOKEN,
      tenantId: TENANT,
      documentId: DOCUMENT,
      artifactId: ARTIFACT,
      bytes: PDF,
      sha256: PDF_HASH,
    })).resolves.toEqual({ storageObjectId: PDF_OBJECT });
    expect(client.create).toHaveBeenCalledWith({
      objectId: PDF_OBJECT,
      bytes: PDF,
      contentType: "application/pdf",
      sha256: PDF_HASH,
    });
    await expect(objectStore.discard(TOKEN)).resolves.toBeUndefined();
    await expect(objectStore.publish({
      stageToken: TOKEN,
      tenantId: TENANT,
      documentId: DOCUMENT,
      artifactId: ARTIFACT,
      bytes: PDF,
      sha256: PDF_HASH,
    })).rejects.toThrow(GcsObjectStoreError);
  });

  it("accepts an existing object only after complete integrity verification", async () => {
    const client = gateway();
    vi.mocked(client.create).mockResolvedValue("exists");
    vi.mocked(client.read).mockResolvedValue(stored(PDF, "application/pdf"));
    const objectStore = store(client);
    await objectStore.stage({
      executionId: EXECUTION, bytes: PDF, sha256: PDF_HASH,
    });
    await expect(objectStore.publish({
      stageToken: TOKEN,
      tenantId: TENANT,
      documentId: DOCUMENT,
      artifactId: ARTIFACT,
      bytes: PDF,
      sha256: PDF_HASH,
    })).resolves.toEqual({ storageObjectId: PDF_OBJECT });
    expect(client.read).toHaveBeenCalledWith({
      objectId: PDF_OBJECT,
      maximumBytes: PDF.byteLength,
    });

    vi.mocked(client.read).mockResolvedValue(stored(
      new Uint8Array(Buffer.from("%PDF-wrong")), "application/pdf",
    ));
    await expect(objectStore.publish({
      stageToken: TOKEN,
      tenantId: TENANT,
      documentId: DOCUMENT,
      artifactId: ARTIFACT,
      bytes: PDF,
      sha256: PDF_HASH,
    })).rejects.toThrow(GcsObjectStoreError);

    for (const mismatch of [
      { ...stored(PDF, "application/json") },
      { ...stored(PDF, "application/pdf"), sha256: "invalid" },
      { ...stored(PDF, "application/pdf"), bytes: PDF.subarray(0, PDF.byteLength - 1) },
    ]) {
      vi.mocked(client.read).mockResolvedValue(mismatch);
      await expect(objectStore.publish({
        stageToken: TOKEN,
        tenantId: TENANT,
        documentId: DOCUMENT,
        artifactId: ARTIFACT,
        bytes: PDF,
        sha256: PDF_HASH,
      })).rejects.toThrow(GcsObjectStoreError);
    }
    vi.mocked(client.read).mockResolvedValue(null);
    await expect(objectStore.publish({
      stageToken: TOKEN,
      tenantId: TENANT,
      documentId: DOCUMENT,
      artifactId: ARTIFACT,
      bytes: PDF,
      sha256: PDF_HASH,
    })).rejects.toThrow(GcsObjectStoreError);
  });

  it("rejects every malformed publish field before storage", async () => {
    const client = gateway();
    const objectStore = store(client);
    await objectStore.stage({
      executionId: EXECUTION, bytes: PDF, sha256: PDF_HASH,
    });
    const valid = {
      stageToken: TOKEN, tenantId: TENANT, documentId: DOCUMENT,
      artifactId: ARTIFACT, bytes: PDF, sha256: PDF_HASH,
    };
    for (const change of [
      { stageToken: "missing" },
      { tenantId: "invalid" },
      { documentId: "invalid" },
      { artifactId: "invalid" },
      { bytes: "invalid" as unknown as Uint8Array },
      { bytes: PDF.subarray(0, PDF.byteLength - 1) },
      { sha256: "invalid" },
      { bytes: new Uint8Array(Buffer.from("%PDF-other-data")) },
    ]) {
      await expect(objectStore.publish({ ...valid, ...change }))
        .rejects.toThrow(GcsObjectStoreError);
    }
    expect(client.create).not.toHaveBeenCalled();
  });

  it("reads only exact private PDF locators and maps absence without details", async () => {
    const client = gateway();
    vi.mocked(client.read).mockResolvedValue(stored(PDF, "application/pdf"));
    const objectStore = store(client);
    await expect(objectStore.read(PDF_OBJECT, PDF.byteLength)).resolves.toEqual(PDF);
    expect(client.read).toHaveBeenCalledWith({
      objectId: PDF_OBJECT, maximumBytes: PDF.byteLength,
    });

    await expect(objectStore.read("exports/wrong.json", 10))
      .rejects.toThrow(PrivateObjectNotFoundError);
    expect(client.read).toHaveBeenCalledTimes(1);
    vi.mocked(client.read).mockResolvedValue(null);
    await expect(objectStore.read(PDF_OBJECT, PDF.byteLength))
      .rejects.toThrow(PrivateObjectNotFoundError);
    await expect(objectStore.read(PDF_OBJECT, 0))
      .rejects.toThrow(GcsObjectStoreError);
    vi.mocked(client.read).mockRejectedValue(new Error("provider"));
    await expect(objectStore.read(PDF_OBJECT, PDF.byteLength))
      .rejects.toThrow(GcsObjectStoreError);
  });

  it("rejects content type, size and hash mismatches on PDF reads", async () => {
    const client = gateway();
    const objectStore = store(client);
    for (const value of [
      stored(PDF, "application/json"),
      { ...stored(PDF, "application/pdf"), sha256: `sha256:${"0".repeat(64)}` },
      stored(new Uint8Array(Buffer.from("%PDF-other")), "application/pdf"),
    ]) {
      vi.mocked(client.read).mockResolvedValue(value);
      await expect(objectStore.read(PDF_OBJECT, PDF.byteLength))
        .rejects.toThrow(GcsObjectStoreError);
    }
  });

  it("writes and reads exports idempotently with exact integrity", async () => {
    const client = gateway();
    const objectStore = store(client);
    await expect(objectStore.writeExport({
      tenantId: TENANT,
      requestId: REQUEST,
      artifactId: ARTIFACT,
      bytes: JSON_BYTES,
      sha256: JSON_HASH,
    })).resolves.toBe(EXPORT_OBJECT);
    expect(client.create).toHaveBeenCalledWith({
      objectId: EXPORT_OBJECT,
      bytes: JSON_BYTES,
      contentType: "application/json",
      sha256: JSON_HASH,
    });

    vi.mocked(client.read).mockResolvedValue(stored(JSON_BYTES, "application/json"));
    await expect(objectStore.readExport({
      storageObjectId: EXPORT_OBJECT,
      expectedBytes: JSON_BYTES.byteLength,
      expectedSha256: JSON_HASH,
    })).resolves.toEqual(JSON_BYTES);

    vi.mocked(client.create).mockResolvedValue("exists");
    await expect(objectStore.writeExport({
      tenantId: TENANT,
      requestId: REQUEST,
      artifactId: ARTIFACT,
      bytes: JSON_BYTES,
      sha256: JSON_HASH,
    })).resolves.toBe(EXPORT_OBJECT);
  });

  it("rejects malformed exports and every read-integrity failure", async () => {
    const client = gateway();
    const objectStore = store(client, {
      maximumExportBytes: JSON_BYTES.byteLength,
    });
    const validWrite = {
      tenantId: TENANT, requestId: REQUEST, artifactId: ARTIFACT,
      bytes: JSON_BYTES, sha256: JSON_HASH,
    };
    for (const change of [
      { tenantId: "invalid" },
      { requestId: "invalid" },
      { artifactId: "invalid" },
      { bytes: "invalid" as unknown as Uint8Array },
      { bytes: new Uint8Array() },
      { sha256: "invalid" },
      { sha256: `sha256:${"0".repeat(64)}` },
    ]) {
      await expect(objectStore.writeExport({ ...validWrite, ...change }))
        .rejects.toThrow(GcsObjectStoreError);
    }

    const validRead = {
      storageObjectId: EXPORT_OBJECT,
      expectedBytes: JSON_BYTES.byteLength,
      expectedSha256: JSON_HASH,
    };
    for (const change of [
      { storageObjectId: "exports/invalid.json" },
      { expectedBytes: 0 },
      { expectedSha256: "invalid" },
    ]) {
      await expect(objectStore.readExport({ ...validRead, ...change }))
        .rejects.toThrow(GcsObjectStoreError);
    }
    vi.mocked(client.read).mockRejectedValueOnce(new Error("provider"));
    await expect(objectStore.readExport(validRead))
      .rejects.toThrow(GcsObjectStoreError);
    for (const mismatch of [
      null,
      stored(JSON_BYTES, "application/pdf"),
      stored(JSON_BYTES.subarray(0, JSON_BYTES.byteLength - 1), "application/json"),
      { ...stored(JSON_BYTES, "application/json"), sha256: `sha256:${"0".repeat(64)}` },
      { ...stored(JSON_BYTES, "application/json"),
        bytes: new Uint8Array(Buffer.from('{"schemaVersion":2}\n')) },
    ]) {
      vi.mocked(client.read).mockResolvedValue(mismatch);
      await expect(objectStore.readExport(validRead))
        .rejects.toThrow(GcsObjectStoreError);
    }
  });

  it("deletes only allowed locators and treats missing objects idempotently", async () => {
    const client = gateway();
    const objectStore = store(client);
    await expect(objectStore.deleteObject(PDF_OBJECT)).resolves.toBeUndefined();
    vi.mocked(client.delete).mockResolvedValue("missing");
    await expect(objectStore.deleteObject(EXPORT_OBJECT)).resolves.toBeUndefined();
    expect(client.delete).toHaveBeenNthCalledWith(1, PDF_OBJECT);
    expect(client.delete).toHaveBeenNthCalledWith(2, EXPORT_OBJECT);
    await expect(objectStore.deleteObject("documents/tenant/../../secret"))
      .rejects.toThrow(GcsObjectStoreError);
    expect(client.delete).toHaveBeenCalledTimes(2);
    vi.mocked(client.delete).mockRejectedValue(new Error("provider"));
    await expect(objectStore.deleteObject(PDF_OBJECT))
      .rejects.toThrow(GcsObjectStoreError);
  });

  it("never exposes provider errors", async () => {
    const client = gateway();
    vi.mocked(client.create).mockRejectedValue(new Error("token=secret"));
    const objectStore = store(client);
    await objectStore.stage({
      executionId: EXECUTION, bytes: PDF, sha256: PDF_HASH,
    });
    const failure = await objectStore.publish({
      stageToken: TOKEN,
      tenantId: TENANT,
      documentId: DOCUMENT,
      artifactId: ARTIFACT,
      bytes: PDF,
      sha256: PDF_HASH,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GcsObjectStoreError);
    expect(String(failure)).not.toContain("secret");
  });
});
