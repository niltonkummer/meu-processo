import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  GoogleCloudStorageGateway,
  GoogleCloudStorageGatewayConfigurationError,
  GoogleCloudStorageGatewayError,
  type GoogleStorageClient,
} from "./google-cloud-storage-gateway.js";

const OBJECT =
  "documents/tenant/10000000-0000-7000-8000-000000000001/" +
  "10000000-0000-7000-8000-000000000002/" +
  "10000000-0000-7000-8000-000000000003.pdf";
const BYTES = new Uint8Array(Buffer.from("%PDF-1.7\n%%EOF\n"));
const HASH = `sha256:${createHash("sha256").update(BYTES).digest("hex")}`;

const fixture = () => {
  const liveFile = {
    save: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn().mockResolvedValue([{
      size: String(BYTES.byteLength),
      generation: "123456",
      contentType: "application/pdf",
      metadata: { sha256: HASH },
    }]),
    download: vi.fn().mockResolvedValue([Buffer.from(BYTES)]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const generationFile = {
    save: vi.fn(), getMetadata: vi.fn(),
    download: vi.fn().mockResolvedValue([Buffer.from(BYTES)]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const bucket = {
    file: vi.fn((_: string, options?: { generation?: string }) =>
      options?.generation ? generationFile : liveFile),
  };
  const storage = {
    bucket: vi.fn(() => bucket),
  } satisfies GoogleStorageClient;
  return { storage, bucket, liveFile, generationFile };
};

describe("Google Cloud Storage gateway", () => {
  it("rejects bucket names outside the dedicated lowercase convention", () => {
    for (const name of ["", "ab", "Uppercase", "gs://bucket", "bucket/name"] ) {
      expect(() => new GoogleCloudStorageGateway(name, fixture().storage))
        .toThrow(GoogleCloudStorageGatewayConfigurationError);
    }
    expect(() => new GoogleCloudStorageGateway(
      "meu-processo-validation",
      { bucket: () => { throw new Error("credential"); } },
    )).toThrow(GoogleCloudStorageGatewayConfigurationError);
    expect(() => new GoogleCloudStorageGateway("meu-processo-validation"))
      .not.toThrow();
  });

  it("rejects malformed create requests before calling the provider", async () => {
    const { storage, liveFile } = fixture();
    const gateway = new GoogleCloudStorageGateway("meu-processo-validation", storage);
    const valid = {
      objectId: OBJECT, bytes: BYTES,
      contentType: "application/pdf" as const, sha256: HASH,
    };
    for (const change of [
      { objectId: "arbitrary/object" },
      { bytes: "invalid" as unknown as Uint8Array },
      { bytes: new Uint8Array() },
      { contentType: "text/plain" as "application/pdf" },
      { sha256: "invalid" },
    ]) {
      await expect(gateway.create({ ...valid, ...change }))
        .rejects.toThrow(GoogleCloudStorageGatewayError);
    }
    expect(liveFile.save).not.toHaveBeenCalled();
  });

  it("creates immutable private objects with integrity metadata", async () => {
    const { storage, liveFile } = fixture();
    const gateway = new GoogleCloudStorageGateway("meu-processo-validation", storage);
    await expect(gateway.create({
      objectId: OBJECT,
      bytes: BYTES,
      contentType: "application/pdf",
      sha256: HASH,
    })).resolves.toBe("created");
    expect(liveFile.save).toHaveBeenCalledWith(Buffer.from(BYTES), {
      resumable: false,
      validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        cacheControl: "private, no-store",
        contentDisposition: "attachment",
        contentType: "application/pdf",
        metadata: { sha256: HASH },
      },
    });
  });

  it("maps only precondition conflicts to an existing object", async () => {
    const { storage, liveFile } = fixture();
    const gateway = new GoogleCloudStorageGateway("meu-processo-validation", storage);
    liveFile.save.mockRejectedValueOnce({ code: 412 });
    await expect(gateway.create({
      objectId: OBJECT, bytes: BYTES,
      contentType: "application/pdf", sha256: HASH,
    })).resolves.toBe("exists");
    liveFile.save.mockRejectedValueOnce({ code: 403, message: "credential detail" });
    const failure = await gateway.create({
      objectId: OBJECT, bytes: BYTES,
      contentType: "application/pdf", sha256: HASH,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GoogleCloudStorageGatewayError);
    expect(String(failure)).not.toContain("credential detail");
    liveFile.save.mockRejectedValueOnce(new Error("no numeric code"));
    await expect(gateway.create({
      objectId: OBJECT, bytes: BYTES,
      contentType: "application/pdf", sha256: HASH,
    })).rejects.toThrow(GoogleCloudStorageGatewayError);
    liveFile.save.mockRejectedValueOnce({ code: "not-a-number" });
    await expect(gateway.create({
      objectId: OBJECT, bytes: BYTES,
      contentType: "application/pdf", sha256: HASH,
    })).rejects.toThrow(GoogleCloudStorageGatewayError);
  });

  it("pins an immutable generation before downloading", async () => {
    const { storage, bucket, generationFile } = fixture();
    const gateway = new GoogleCloudStorageGateway("meu-processo-validation", storage);
    await expect(gateway.read({
      objectId: OBJECT, maximumBytes: BYTES.byteLength,
    })).resolves.toEqual({
      bytes: BYTES, contentType: "application/pdf", sha256: HASH,
    });
    expect(bucket.file).toHaveBeenNthCalledWith(1, OBJECT);
    expect(bucket.file).toHaveBeenNthCalledWith(2, OBJECT, {
      generation: "123456",
    });
    expect(generationFile.download).toHaveBeenCalledOnce();
  });

  it("rejects oversized or malformed metadata before download", async () => {
    const { storage, liveFile, generationFile } = fixture();
    const gateway = new GoogleCloudStorageGateway("meu-processo-validation", storage);
    for (const metadata of [
      { size: "100", generation: "1", contentType: "application/pdf",
        metadata: { sha256: HASH } },
      { size: String(BYTES.byteLength), generation: "not-a-number",
        contentType: "application/pdf", metadata: { sha256: HASH } },
      { size: String(BYTES.byteLength), generation: "1",
        contentType: "text/plain", metadata: { sha256: HASH } },
      { size: String(BYTES.byteLength), generation: "1",
        contentType: "application/pdf", metadata: { sha256: "invalid" } },
      { size: String(BYTES.byteLength), generation: undefined,
        contentType: "application/pdf", metadata: { sha256: HASH } },
    ]) {
      liveFile.getMetadata.mockResolvedValueOnce([metadata]);
      await expect(gateway.read({
        objectId: OBJECT, maximumBytes: BYTES.byteLength,
      })).rejects.toThrow(GoogleCloudStorageGatewayError);
    }
    expect(generationFile.download).not.toHaveBeenCalled();
  });

  it("rejects unsafe read inputs and corrupted immutable downloads", async () => {
    const { storage, liveFile, generationFile } = fixture();
    const gateway = new GoogleCloudStorageGateway("meu-processo-validation", storage);
    await expect(gateway.read({ objectId: "arbitrary", maximumBytes: 1 }))
      .rejects.toThrow(GoogleCloudStorageGatewayError);
    await expect(gateway.read({ objectId: OBJECT, maximumBytes: 0 }))
      .rejects.toThrow(GoogleCloudStorageGatewayError);

    generationFile.download.mockResolvedValueOnce(["not-bytes"]);
    await expect(gateway.read({ objectId: OBJECT, maximumBytes: BYTES.byteLength }))
      .rejects.toThrow(GoogleCloudStorageGatewayError);
    generationFile.download.mockResolvedValueOnce([
      Buffer.from(BYTES.subarray(0, BYTES.byteLength - 1)),
    ]);
    await expect(gateway.read({ objectId: OBJECT, maximumBytes: BYTES.byteLength }))
      .rejects.toThrow(GoogleCloudStorageGatewayError);
    const corrupted = Buffer.from(BYTES);
    corrupted[corrupted.byteLength - 1] = corrupted.at(-1)! ^ 1;
    generationFile.download.mockResolvedValueOnce([corrupted]);
    await expect(gateway.read({ objectId: OBJECT, maximumBytes: BYTES.byteLength }))
      .rejects.toThrow(GoogleCloudStorageGatewayError);

    liveFile.getMetadata.mockRejectedValueOnce(new Error("provider detail"));
    const failure = await gateway.read({
      objectId: OBJECT, maximumBytes: BYTES.byteLength,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GoogleCloudStorageGatewayError);
    expect(String(failure)).not.toContain("provider detail");
  });

  it("maps absent reads and generation-pinned deletes idempotently", async () => {
    const { storage, liveFile, generationFile } = fixture();
    const gateway = new GoogleCloudStorageGateway("meu-processo-validation", storage);
    liveFile.getMetadata.mockRejectedValueOnce({ code: 404 });
    await expect(gateway.read({
      objectId: OBJECT, maximumBytes: BYTES.byteLength,
    })).resolves.toBeNull();
    await expect(gateway.delete(OBJECT)).resolves.toBe("deleted");
    expect(generationFile.delete).toHaveBeenCalledWith({
      preconditionOpts: { ifGenerationMatch: "123456" },
    });
    liveFile.getMetadata.mockRejectedValueOnce({ code: 404 });
    await expect(gateway.delete(OBJECT)).resolves.toBe("missing");
    await expect(gateway.delete("arbitrary/object"))
      .rejects.toThrow(GoogleCloudStorageGatewayError);

    liveFile.getMetadata.mockResolvedValueOnce([{
      size: String(BYTES.byteLength), generation: undefined,
      contentType: "application/pdf", metadata: { sha256: HASH },
    }]);
    await expect(gateway.delete(OBJECT))
      .rejects.toThrow(GoogleCloudStorageGatewayError);
    liveFile.getMetadata.mockRejectedValueOnce(new Error("provider detail"));
    await expect(gateway.delete(OBJECT))
      .rejects.toThrow(GoogleCloudStorageGatewayError);
    generationFile.delete.mockRejectedValueOnce({ code: 404 });
    await expect(gateway.delete(OBJECT)).resolves.toBe("missing");
    generationFile.delete.mockRejectedValueOnce(new Error("provider detail"));
    await expect(gateway.delete(OBJECT))
      .rejects.toThrow(GoogleCloudStorageGatewayError);
  });
});
