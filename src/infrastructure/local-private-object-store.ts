import { constants, realpathSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

import {
  PrivateObjectNotFoundError,
  type PrivateObjectStore,
} from "../application/individual-document-delivery.js";

export class PrivateObjectStoreConfigurationError extends Error {
  constructor() {
    super("Private object store configuration is invalid.");
    this.name = "PrivateObjectStoreConfigurationError";
  }
}

export class PrivateObjectStoreReadError extends Error {
  constructor() {
    super("Private object could not be read.");
    this.name = "PrivateObjectStoreReadError";
  }
}

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OBJECT_ID = new RegExp(
  `^documents/tenant/(${UUID_PART})/(${UUID_PART})/(${UUID_PART})\\.pdf$`,
  "i",
);

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : undefined;

export class LocalPrivateObjectStore implements PrivateObjectStore {
  private readonly root: string;

  constructor(root: string) {
    try {
      if (!isAbsolute(root)) throw new PrivateObjectStoreConfigurationError();
      const canonical = realpathSync.native(root);
      if (!statSync(canonical).isDirectory()) {
        throw new PrivateObjectStoreConfigurationError();
      }
      this.root = canonical;
    } catch (error) {
      if (error instanceof PrivateObjectStoreConfigurationError) throw error;
      throw new PrivateObjectStoreConfigurationError();
    }
  }

  async read(storageObjectId: string, maximumBytes: number): Promise<Uint8Array> {
    const match = OBJECT_ID.exec(storageObjectId);
    if (!match || !Number.isInteger(maximumBytes) || maximumBytes < 1 ||
        maximumBytes > 25 * 1024 * 1024) {
      if (!match) throw new PrivateObjectNotFoundError();
      throw new PrivateObjectStoreReadError();
    }
    const target = resolve(this.root, ...storageObjectId.split("/"));
    if (!target.startsWith(`${this.root}${sep}`)) {
      throw new PrivateObjectNotFoundError();
    }

    let handle;
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "ELOOP"].includes(errorCode(error) ?? "")) {
        throw new PrivateObjectNotFoundError();
      }
      throw new PrivateObjectStoreReadError();
    }
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size < 1 || before.size > maximumBytes ||
          before.size !== maximumBytes) {
        throw new PrivateObjectStoreReadError();
      }
      const bytes = Buffer.allocUnsafe(before.size);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const result = await handle.read(
          bytes, offset, bytes.byteLength - offset, offset,
        );
        if (result.bytesRead < 1) throw new PrivateObjectStoreReadError();
        offset += result.bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        throw new PrivateObjectStoreReadError();
      }
      return Uint8Array.from(bytes);
    } catch (error) {
      if (error instanceof PrivateObjectStoreReadError) throw error;
      throw new PrivateObjectStoreReadError();
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
}
