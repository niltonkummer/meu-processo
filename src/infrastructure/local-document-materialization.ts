import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  DocumentMaterializationSourceError,
  type DocumentMalwareScanner,
  type DocumentMaterializationSourceAdapter,
  type DocumentMaterializationStore,
} from "../application/document-materialization-worker.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAXIMUM_BYTES = 25 * 1024 * 1024;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export class LocalDocumentMaterializationConfigurationError extends Error {
  constructor() {
    super("Local document materialization configuration is invalid.");
    this.name = "LocalDocumentMaterializationConfigurationError";
  }
}

export class LocalDocumentMaterializationStorageError extends Error {
  constructor() {
    super("Local document materialization storage failed.");
    this.name = "LocalDocumentMaterializationStorageError";
  }
}

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const contained = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

const resolveSafeRoot = async (root: string): Promise<string> => {
  if (!isAbsolute(root)) throw new LocalDocumentMaterializationConfigurationError();
  try {
    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new LocalDocumentMaterializationConfigurationError();
    }
    return await realpath(root);
  } catch (error) {
    if (error instanceof LocalDocumentMaterializationConfigurationError) throw error;
    throw new LocalDocumentMaterializationConfigurationError();
  }
};

const ensureDirectory = async (
  root: string,
  segments: readonly string[],
): Promise<string> => {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const metadata = await lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new LocalDocumentMaterializationStorageError();
    }
    const canonical = await realpath(current);
    if (!contained(root, canonical)) {
      throw new LocalDocumentMaterializationStorageError();
    }
    current = canonical;
  }
  return current;
};

const readRegularFile = async (
  path: string,
  maximumBytes: number,
): Promise<Uint8Array> => {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximumBytes) {
      throw new LocalDocumentMaterializationStorageError();
    }
    const content = await handle.readFile();
    const after = await handle.stat();
    if (
      content.byteLength !== before.size ||
      after.size !== before.size ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw new LocalDocumentMaterializationStorageError();
    }
    return new Uint8Array(content);
  } finally {
    await handle?.close();
  }
};

export class LocalDocumentFixtureSource
  implements DocumentMaterializationSourceAdapter
{
  private constructor(
    private readonly sourceRoot: string,
    readonly sourceCode: string,
    private readonly maximumBytes: number,
  ) {}

  static async create(
    root: string,
    sourceCode: string,
    maximumBytes: number,
  ): Promise<LocalDocumentFixtureSource> {
    if (
      !SOURCE_PATTERN.test(sourceCode) ||
      !Number.isInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > MAXIMUM_BYTES
    ) {
      throw new LocalDocumentMaterializationConfigurationError();
    }
    const canonicalRoot = await resolveSafeRoot(root);
    const sourcePath = resolve(canonicalRoot, sourceCode);
    try {
      const metadata = await lstat(sourcePath);
      const canonicalSource = await realpath(sourcePath);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        !contained(canonicalRoot, canonicalSource)
      ) {
        throw new LocalDocumentMaterializationConfigurationError();
      }
      return new LocalDocumentFixtureSource(
        canonicalSource, sourceCode, maximumBytes,
      );
    } catch (error) {
      if (error instanceof LocalDocumentMaterializationConfigurationError) throw error;
      throw new LocalDocumentMaterializationConfigurationError();
    }
  }

  async fetch(input: {
    readonly executionId: string;
    readonly documentId: string;
    readonly externalDocumentId: string;
    readonly maximumBytes: number;
  }): Promise<unknown> {
    if (
      !UUID_PATTERN.test(input.executionId) ||
      !UUID_PATTERN.test(input.documentId) ||
      !UUID_PATTERN.test(input.externalDocumentId) ||
      !Number.isInteger(input.maximumBytes) ||
      input.maximumBytes < 1 ||
      input.maximumBytes > this.maximumBytes
    ) {
      throw new DocumentMaterializationSourceError(
        "SOURCE_FIXTURE_REJECTED", false,
      );
    }
    const fixturePath = join(this.sourceRoot, `${input.externalDocumentId}.pdf`);
    try {
      const bytes = await readRegularFile(fixturePath, input.maximumBytes);
      return { mediaType: "application/pdf", bytes };
    } catch (error) {
      if (error instanceof DocumentMaterializationSourceError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      const policyFailure =
        error instanceof LocalDocumentMaterializationStorageError ||
        code === "ENOENT" || code === "ELOOP" || code === "ENOTDIR";
      throw new DocumentMaterializationSourceError(
        policyFailure ? "SOURCE_FIXTURE_REJECTED" : "SOURCE_FIXTURE_READ_FAILED",
        !policyFailure,
      );
    }
  }
}

interface StagedFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export class LocalDocumentMaterializationStore
  implements DocumentMaterializationStore
{
  private readonly stages = new Map<string, StagedFile>();

  private constructor(
    private readonly root: string,
    private readonly quarantineRoot: string,
    private readonly maximumBytes: number,
  ) {}

  static async create(
    root: string,
    maximumBytes: number,
  ): Promise<LocalDocumentMaterializationStore> {
    if (
      !Number.isInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > MAXIMUM_BYTES
    ) {
      throw new LocalDocumentMaterializationConfigurationError();
    }
    const canonicalRoot = await resolveSafeRoot(root);
    const quarantineRoot = await ensureDirectory(canonicalRoot, [".quarantine"]);
    await ensureDirectory(canonicalRoot, ["documents", "tenant"]);
    return new LocalDocumentMaterializationStore(
      canonicalRoot, quarantineRoot, maximumBytes,
    );
  }

  async stage(input: {
    readonly executionId: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  }): Promise<{ readonly token: string }> {
    if (
      !UUID_PATTERN.test(input.executionId) ||
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > this.maximumBytes ||
      !HASH_PATTERN.test(input.sha256) ||
      sha256(input.bytes) !== input.sha256
    ) {
      throw new LocalDocumentMaterializationStorageError();
    }
    const token = randomUUID();
    const path = join(this.quarantineRoot, `${token}.part`);
    let handle;
    try {
      handle = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
        0o600,
      );
      await handle.writeFile(input.bytes);
      await handle.sync();
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size !== input.bytes.byteLength) {
        throw new LocalDocumentMaterializationStorageError();
      }
      this.stages.set(token, {
        path,
        sizeBytes: input.bytes.byteLength,
        sha256: input.sha256,
      });
      return { token };
    } catch (error) {
      try { await unlink(path); } catch { /* no partial path to expose */ }
      if (error instanceof LocalDocumentMaterializationStorageError) throw error;
      throw new LocalDocumentMaterializationStorageError();
    } finally {
      await handle?.close();
    }
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
      !stage ||
      !UUID_PATTERN.test(input.tenantId) ||
      !UUID_PATTERN.test(input.documentId) ||
      !UUID_PATTERN.test(input.artifactId) ||
      !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength !== stage.sizeBytes ||
      input.sha256 !== stage.sha256 ||
      sha256(input.bytes) !== stage.sha256
    ) {
      throw new LocalDocumentMaterializationStorageError();
    }
    try {
      const stagedBytes = await readRegularFile(stage.path, this.maximumBytes);
      if (stagedBytes.byteLength !== stage.sizeBytes || sha256(stagedBytes) !== stage.sha256) {
        throw new LocalDocumentMaterializationStorageError();
      }
      const targetRoot = await ensureDirectory(this.root, [
        "documents", "tenant", input.tenantId, input.documentId,
      ]);
      const fileName = `${input.artifactId}.pdf`;
      const target = join(targetRoot, fileName);
      try {
        await link(stage.path, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const targetBytes = await readRegularFile(target, this.maximumBytes);
      if (targetBytes.byteLength !== stage.sizeBytes || sha256(targetBytes) !== stage.sha256) {
        throw new LocalDocumentMaterializationStorageError();
      }
      return {
        storageObjectId:
          `documents/tenant/${input.tenantId}/${input.documentId}/${fileName}`,
      };
    } catch (error) {
      if (error instanceof LocalDocumentMaterializationStorageError) throw error;
      throw new LocalDocumentMaterializationStorageError();
    }
  }

  async discard(stageToken: string): Promise<void> {
    const stage = this.stages.get(stageToken);
    if (!stage) return;
    this.stages.delete(stageToken);
    try {
      await unlink(stage.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new LocalDocumentMaterializationStorageError();
      }
    }
  }
}

const EICAR_MARKER = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  "ascii",
);

export class DeterministicFixturePdfScanner implements DocumentMalwareScanner {
  scan(input: {
    readonly stageToken: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
  }): Promise<unknown> {
    return Promise.resolve({
      status: Buffer.from(input.bytes).includes(EICAR_MARKER)
        ? "infected"
        : "clean",
    });
  }
}
