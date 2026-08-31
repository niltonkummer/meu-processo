import { createHash } from "node:crypto";
import {
  lstat, mkdir, mkdtemp, readFile, symlink, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalTenantLifecycleObjectStore,
  TenantLifecycleObjectStoreConfigurationError,
  TenantLifecycleObjectStoreError,
} from "./local-tenant-lifecycle-object-store.js";

const TENANT = "10000000-0000-7000-8000-000000000001";
const REQUEST = "20000000-0000-7000-8000-000000000001";
const ARTIFACT = "30000000-0000-8000-8000-000000000001";
const DOCUMENT = "50000000-0000-7000-8000-000000000001";
const BYTES = new TextEncoder().encode('{"schemaVersion":1}\n');
const HASH = `sha256:${createHash("sha256").update(BYTES).digest("hex")}`;
const EXPORT = `exports/${TENANT}/${REQUEST}/${ARTIFACT}.json`;
const DOCUMENT_OBJECT =
  `documents/tenant/${TENANT}/${DOCUMENT}/${ARTIFACT}.pdf`;
const roots: string[] = [];

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "meu-processo-lifecycle-store-"));
  roots.push(root);
  return root;
};

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("LocalTenantLifecycleObjectStore", () => {
  it("reads only the allowlisted export with matching size and digest", async () => {
    const root = await makeRoot();
    const writer = await LocalTenantLifecycleObjectStore.create(root, 1024);
    await writer.writeExport({ tenantId: TENANT, requestId: REQUEST,
      artifactId: ARTIFACT, bytes: BYTES, sha256: HASH });
    const reader = LocalTenantLifecycleObjectStore.reader(root, 1024);
    await expect(reader.readExport({ storageObjectId: EXPORT,
      expectedBytes: BYTES.byteLength, expectedSha256: HASH }).then(
        (value) => Array.from(value),
      )).resolves.toEqual(Array.from(BYTES));
    await expect(reader.readExport({ storageObjectId: EXPORT,
      expectedBytes: BYTES.byteLength + 1, expectedSha256: HASH })).rejects
      .toBeInstanceOf(TenantLifecycleObjectStoreError);
    await expect(reader.readExport({ storageObjectId: DOCUMENT_OBJECT,
      expectedBytes: BYTES.byteLength, expectedSha256: HASH })).rejects
      .toBeInstanceOf(TenantLifecycleObjectStoreError);
    expect(() => LocalTenantLifecycleObjectStore.reader("relative", 1024))
      .toThrow(TenantLifecycleObjectStoreConfigurationError);
  });
  it("publishes a private export atomically and accepts an identical retry", async () => {
    const root = await makeRoot();
    const store = await LocalTenantLifecycleObjectStore.create(root, 1024);
    await expect(store.writeExport({
      tenantId: TENANT, requestId: REQUEST, artifactId: ARTIFACT,
      bytes: BYTES, sha256: HASH,
    })).resolves.toBe(EXPORT);
    await expect(store.writeExport({
      tenantId: TENANT, requestId: REQUEST, artifactId: ARTIFACT,
      bytes: BYTES, sha256: HASH,
    })).resolves.toBe(EXPORT);
    const target = join(root, ...EXPORT.split("/"));
    expect(Array.from(await readFile(target))).toEqual(Array.from(BYTES));
    expect((await lstat(target)).mode & 0o777).toBe(0o600);
    expect((await lstat(join(root, "exports", TENANT))).mode & 0o777).toBe(0o700);
  });

  it("rejects divergent overwrite, invalid digest and unsafe identifiers", async () => {
    const root = await makeRoot();
    const store = await LocalTenantLifecycleObjectStore.create(root, 1024);
    await store.writeExport({
      tenantId: TENANT, requestId: REQUEST, artifactId: ARTIFACT,
      bytes: BYTES, sha256: HASH,
    });
    const divergent = new TextEncoder().encode("divergent\n");
    await expect(store.writeExport({
      tenantId: TENANT, requestId: REQUEST, artifactId: ARTIFACT,
      bytes: divergent,
      sha256: `sha256:${createHash("sha256").update(divergent).digest("hex")}`,
    })).rejects.toBeInstanceOf(TenantLifecycleObjectStoreError);
    await expect(store.writeExport({
      tenantId: "../outside", requestId: REQUEST, artifactId: ARTIFACT,
      bytes: BYTES, sha256: HASH,
    })).rejects.toBeInstanceOf(TenantLifecycleObjectStoreError);
    await expect(store.writeExport({
      tenantId: TENANT, requestId: REQUEST, artifactId: ARTIFACT,
      bytes: BYTES, sha256: `sha256:${"0".repeat(64)}`,
    })).rejects.toBeInstanceOf(TenantLifecycleObjectStoreError);
  });

  it("idempotently deletes export and document objects", async () => {
    const root = await makeRoot();
    const store = await LocalTenantLifecycleObjectStore.create(root, 1024);
    await store.writeExport({
      tenantId: TENANT, requestId: REQUEST, artifactId: ARTIFACT,
      bytes: BYTES, sha256: HASH,
    });
    const documentPath = join(root, ...DOCUMENT_OBJECT.split("/"));
    await mkdir(join(documentPath, ".."), { recursive: true, mode: 0o700 });
    await writeFile(documentPath, "%PDF-synthetic", { mode: 0o600, flag: "wx" });
    await store.deleteObject(EXPORT);
    await store.deleteObject(DOCUMENT_OBJECT);
    await expect(store.deleteObject(EXPORT)).resolves.toBeUndefined();
    await expect(readFile(join(root, ...EXPORT.split("/")))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(documentPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects non-allowlisted paths and symlink traversal without touching targets", async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    const outsideFile = join(outside, `${ARTIFACT}.pdf`);
    await writeFile(outsideFile, "private");
    await mkdir(join(root, "documents", "tenant", TENANT), { recursive: true });
    await symlink(outside, join(root, "documents", "tenant", TENANT, DOCUMENT));
    const store = await LocalTenantLifecycleObjectStore.create(root, 1024);
    await expect(store.deleteObject("../outside"))
      .rejects.toBeInstanceOf(TenantLifecycleObjectStoreError);
    await expect(store.deleteObject(DOCUMENT_OBJECT))
      .rejects.toBeInstanceOf(TenantLifecycleObjectStoreError);
    await expect(readFile(outsideFile)).resolves.toBeDefined();
  });

  it("requires a real absolute directory and a bounded maximum", async () => {
    await expect(LocalTenantLifecycleObjectStore.create("relative", 1024))
      .rejects.toBeInstanceOf(TenantLifecycleObjectStoreConfigurationError);
    const root = await makeRoot();
    await expect(LocalTenantLifecycleObjectStore.create(root, 0))
      .rejects.toBeInstanceOf(TenantLifecycleObjectStoreConfigurationError);
    const linked = join(root, "linked");
    await symlink(root, linked);
    await expect(LocalTenantLifecycleObjectStore.create(linked, 1024))
      .rejects.toBeInstanceOf(TenantLifecycleObjectStoreConfigurationError);
  });
});
