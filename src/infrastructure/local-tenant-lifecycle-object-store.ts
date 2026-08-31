import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link, lstat, mkdir, open, realpath, unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import type { TenantLifecycleObjectStore } from
  "../application/tenant-data-lifecycle-worker.js";

export class TenantLifecycleObjectStoreConfigurationError extends Error {
  constructor() {
    super("Tenant lifecycle object store configuration is invalid.");
    this.name = "TenantLifecycleObjectStoreConfigurationError";
  }
}

export class TenantLifecycleObjectStoreError extends Error {
  constructor() {
    super("Tenant lifecycle object store operation failed.");
    this.name = "TenantLifecycleObjectStoreError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_PART =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OBJECT_ID = new RegExp(
  `^(?:documents/tenant/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.pdf|` +
  `exports/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.json)$`,
);
const EXPORT_OBJECT_ID = new RegExp(
  `^exports/${UUID_PART}/${UUID_PART}/${UUID_PART}\\.json$`,
);
const HASH = /^sha256:[a-f0-9]{64}$/;
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

const digest = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const byteView = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) && "BYTES_PER_ELEMENT" in value &&
  value.BYTES_PER_ELEMENT === 1;
const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : undefined;
const contained = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

const safeRoot = async (root: string): Promise<string> => {
  if (!isAbsolute(root)) throw new TenantLifecycleObjectStoreConfigurationError();
  try {
    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TenantLifecycleObjectStoreConfigurationError();
    }
    return await realpath(root);
  } catch (error) {
    if (error instanceof TenantLifecycleObjectStoreConfigurationError) throw error;
    throw new TenantLifecycleObjectStoreConfigurationError();
  }
};

const ensureDirectories = async (
  root: string,
  segments: readonly string[],
): Promise<string> => {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    const metadata = await lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TenantLifecycleObjectStoreError();
    }
    const canonical = await realpath(current);
    if (!contained(root, canonical)) throw new TenantLifecycleObjectStoreError();
    current = canonical;
  }
  return current;
};

const existingParent = async (
  root: string,
  segments: readonly string[],
): Promise<string | null> => {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) return null;
      throw error;
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TenantLifecycleObjectStoreError();
    }
    const canonical = await realpath(current);
    if (!contained(root, canonical)) throw new TenantLifecycleObjectStoreError();
    current = canonical;
  }
  return current;
};

const verifyRegularFile = async (
  path: string,
  expectedBytes: number,
  expectedHash: string,
): Promise<void> => {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expectedBytes || before.size < 1 ||
        before.size > MAX_EXPORT_BYTES) {
      throw new TenantLifecycleObjectStoreError();
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      bytes.byteLength !== before.size || after.size !== before.size ||
      after.ino !== before.ino || after.mtimeMs !== before.mtimeMs ||
      digest(bytes) !== expectedHash
    ) throw new TenantLifecycleObjectStoreError();
  } catch (error) {
    if (error instanceof TenantLifecycleObjectStoreError) throw error;
    throw new TenantLifecycleObjectStoreError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

export class LocalTenantLifecycleObjectStore
implements TenantLifecycleObjectStore {
  private constructor(
    private readonly root: string,
    private readonly maximumExportBytes: number,
  ) {}

  static async create(
    root: string,
    maximumExportBytes: number,
  ): Promise<LocalTenantLifecycleObjectStore> {
    if (
      !Number.isInteger(maximumExportBytes) || maximumExportBytes < 1 ||
      maximumExportBytes > MAX_EXPORT_BYTES
    ) throw new TenantLifecycleObjectStoreConfigurationError();
    const canonical = await safeRoot(root);
    await ensureDirectories(canonical, ["exports"]);
    return new LocalTenantLifecycleObjectStore(canonical, maximumExportBytes);
  }

  static reader(
    root: string,
    maximumExportBytes: number,
  ): LocalTenantLifecycleObjectStore {
    if (!isAbsolute(root) || !Number.isInteger(maximumExportBytes) ||
        maximumExportBytes < 1 || maximumExportBytes > MAX_EXPORT_BYTES) {
      throw new TenantLifecycleObjectStoreConfigurationError();
    }
    return new LocalTenantLifecycleObjectStore(root, maximumExportBytes);
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
      !UUID.test(input.artifactId) || !byteView(input.bytes) ||
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > this.maximumExportBytes ||
      !HASH.test(input.sha256) || digest(input.bytes) !== input.sha256
    ) throw new TenantLifecycleObjectStoreError();
    const objectId =
      `exports/${input.tenantId}/${input.requestId}/${input.artifactId}.json`;
    let temporary: string | undefined;
    let handle;
    try {
      const directory = await ensureDirectories(this.root, [
        "exports", input.tenantId, input.requestId,
      ]);
      const target = join(directory, `${input.artifactId}.json`);
      temporary = join(directory, `.${input.artifactId}.${randomUUID()}.part`);
      handle = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
        0o600,
      );
      await handle.writeFile(input.bytes);
      await handle.sync();
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size !== input.bytes.byteLength) {
        throw new TenantLifecycleObjectStoreError();
      }
      await handle.close();
      handle = undefined;
      try {
        await link(temporary, target);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      await verifyRegularFile(target, input.bytes.byteLength, input.sha256);
      await unlink(temporary);
      temporary = undefined;
      return objectId;
    } catch (error) {
      if (error instanceof TenantLifecycleObjectStoreError) throw error;
      throw new TenantLifecycleObjectStoreError();
    } finally {
      await handle?.close().catch(() => undefined);
      if (temporary) await unlink(temporary).catch(() => undefined);
    }
  }

  async deleteObject(storageObjectId: string): Promise<void> {
    if (!OBJECT_ID.test(storageObjectId)) {
      throw new TenantLifecycleObjectStoreError();
    }
    const segments = storageObjectId.split("/");
    const fileName = segments.pop()!;
    try {
      const root = await safeRoot(this.root);
      const parent = await existingParent(root, segments);
      if (!parent) return;
      const target = join(parent, fileName);
      let metadata;
      try {
        metadata = await lstat(target);
      } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) return;
        throw error;
      }
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new TenantLifecycleObjectStoreError();
      }
      try {
        await unlink(target);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    } catch (error) {
      if (error instanceof TenantLifecycleObjectStoreError) throw error;
      throw new TenantLifecycleObjectStoreError();
    }
  }

  async readExport(input: {
    readonly storageObjectId: string;
    readonly expectedBytes: number;
    readonly expectedSha256: string;
  }): Promise<Uint8Array> {
    if (
      !EXPORT_OBJECT_ID.test(input.storageObjectId) ||
      !Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 1 ||
      input.expectedBytes > this.maximumExportBytes ||
      !HASH.test(input.expectedSha256)
    ) throw new TenantLifecycleObjectStoreError();
    const segments = input.storageObjectId.split("/");
    const fileName = segments.pop()!;
    let handle;
    try {
      const root = await safeRoot(this.root);
      const parent = await existingParent(root, segments);
      if (!parent) throw new TenantLifecycleObjectStoreError();
      const target = join(parent, fileName);
      handle = await open(target, constants.O_RDONLY | NOFOLLOW);
      const before = await handle.stat();
      if (!before.isFile() || before.size !== input.expectedBytes) {
        throw new TenantLifecycleObjectStoreError();
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (
        bytes.byteLength !== input.expectedBytes || after.size !== before.size ||
        after.ino !== before.ino || after.mtimeMs !== before.mtimeMs ||
        digest(bytes) !== input.expectedSha256
      ) throw new TenantLifecycleObjectStoreError();
      return bytes;
    } catch (error) {
      if (error instanceof TenantLifecycleObjectStoreError) throw error;
      throw new TenantLifecycleObjectStoreError();
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}
