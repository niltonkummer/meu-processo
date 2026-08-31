import { createHash } from "node:crypto";
import {
  chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DocumentMaterializationSourceError,
} from "../application/document-materialization-worker.js";
import {
  DeterministicFixturePdfScanner,
  LocalDocumentFixtureSource,
  LocalDocumentMaterializationConfigurationError,
  LocalDocumentMaterializationStore,
  LocalDocumentMaterializationStorageError,
} from "./local-document-materialization.js";

const executionId = "71000000-0000-7000-8000-000000000001";
const tenantId = "11000000-0000-7000-8000-000000000001";
const documentId = "88000000-0000-7000-8000-000000000001";
const artifactId = "89000000-0000-8000-8000-000000000001";
const externalDocumentId = "90000000-0000-7000-8000-000000000001";
const pdf = new Uint8Array(Buffer.from("%PDF-1.7\nlocal synthetic fixture\n%%EOF\n"));
const sha256 = `sha256:${createHash("sha256").update(pdf).digest("hex")}`;
const roots: string[] = [];

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "meu-processo-materialization-"));
  roots.push(root);
  return root;
};

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("LocalDocumentFixtureSource", () => {
  it("reads only the exact UUID fixture from an allowlisted source directory", async () => {
    const root = await makeRoot();
    const sourceRoot = join(root, "synthetic-worker");
    await mkdir(sourceRoot);
    await writeFile(join(sourceRoot, `${externalDocumentId}.pdf`), pdf, { mode: 0o600 });
    const source = await LocalDocumentFixtureSource.create(
      root, "synthetic-worker", 25 * 1024 * 1024,
    );

    await expect(source.fetch({
      executionId, documentId, externalDocumentId, maximumBytes: pdf.byteLength,
    })).resolves.toEqual({ mediaType: "application/pdf", bytes: pdf });
  });

  it.each(["../secret", "/tmp/secret", "not-a-uuid", `${externalDocumentId}\u0000`])(
    "rejects an unsafe external identifier without resolving a path: %s",
    async (unsafe) => {
      const root = await makeRoot();
      await mkdir(join(root, "synthetic-worker"));
      const source = await LocalDocumentFixtureSource.create(
        root, "synthetic-worker", 1024,
      );
      await expect(source.fetch({
        executionId, documentId, externalDocumentId: unsafe, maximumBytes: 1024,
      })).rejects.toMatchObject({
        name: "DocumentMaterializationSourceError",
        code: "SOURCE_FIXTURE_REJECTED",
        retryable: false,
      });
    },
  );

  it("rejects a symlink and an oversized fixture", async () => {
    const root = await makeRoot();
    const sourceRoot = join(root, "synthetic-worker");
    await mkdir(sourceRoot);
    const outside = join(root, "outside.pdf");
    await writeFile(outside, pdf);
    await symlink(outside, join(sourceRoot, `${externalDocumentId}.pdf`));
    const source = await LocalDocumentFixtureSource.create(
      root, "synthetic-worker", 32,
    );
    await expect(source.fetch({
      executionId, documentId, externalDocumentId, maximumBytes: 32,
    })).rejects.toBeInstanceOf(DocumentMaterializationSourceError);

    const secondId = "90000000-0000-7000-8000-000000000002";
    await writeFile(join(sourceRoot, `${secondId}.pdf`), new Uint8Array(33));
    await expect(source.fetch({
      executionId, documentId, externalDocumentId: secondId, maximumBytes: 32,
    })).rejects.toMatchObject({ code: "SOURCE_FIXTURE_REJECTED" });
  });

  it("rejects relative, symlinked or malformed source roots", async () => {
    const root = await makeRoot();
    const real = join(root, "real");
    await mkdir(real);
    const linked = join(root, "linked");
    await symlink(real, linked);
    await expect(LocalDocumentFixtureSource.create(
      "relative", "synthetic-worker", 1024,
    )).rejects.toBeInstanceOf(LocalDocumentMaterializationConfigurationError);
    await expect(LocalDocumentFixtureSource.create(
      linked, "synthetic-worker", 1024,
    )).rejects.toBeInstanceOf(LocalDocumentMaterializationConfigurationError);
    await expect(LocalDocumentFixtureSource.create(
      real, "INVALID/SOURCE", 1024,
    )).rejects.toBeInstanceOf(LocalDocumentMaterializationConfigurationError);
  });
});

describe("LocalDocumentMaterializationStore", () => {
  it("stages with 0600 and publishes atomically into the tenant namespace", async () => {
    const root = await makeRoot();
    const store = await LocalDocumentMaterializationStore.create(root, 1024);
    const staged = await store.stage({ executionId, bytes: pdf, sha256 });
    const quarantineFiles = await import("node:fs/promises").then(({ readdir }) =>
      readdir(join(root, ".quarantine")));
    expect(quarantineFiles).toHaveLength(1);
    expect((await lstat(join(root, ".quarantine", quarantineFiles[0]!))).mode & 0o777)
      .toBe(0o600);

    await expect(store.publish({
      stageToken: staged.token, tenantId, documentId, artifactId, bytes: pdf, sha256,
    })).resolves.toEqual({
      storageObjectId:
        `documents/tenant/${tenantId}/${documentId}/${artifactId}.pdf`,
    });
    const target = join(root, "documents", "tenant", tenantId, documentId,
      `${artifactId}.pdf`);
    expect(new Uint8Array(await readFile(target))).toEqual(pdf);
    expect((await lstat(target)).mode & 0o777).toBe(0o600);
    await store.discard(staged.token);
    expect(await import("node:fs/promises").then(({ readdir }) =>
      readdir(join(root, ".quarantine")))).toEqual([]);
  });

  it("accepts an identical existing target and rejects divergent overwrite", async () => {
    const root = await makeRoot();
    const store = await LocalDocumentMaterializationStore.create(root, 1024);
    const first = await store.stage({ executionId, bytes: pdf, sha256 });
    await store.publish({
      stageToken: first.token, tenantId, documentId, artifactId, bytes: pdf, sha256,
    });
    await store.discard(first.token);

    const second = await store.stage({ executionId, bytes: pdf, sha256 });
    await expect(store.publish({
      stageToken: second.token, tenantId, documentId, artifactId, bytes: pdf, sha256,
    })).resolves.toBeDefined();
    await store.discard(second.token);

    const target = join(root, "documents", "tenant", tenantId, documentId,
      `${artifactId}.pdf`);
    await chmod(target, 0o600);
    await writeFile(target, Buffer.from("%PDF-divergent"));
    const third = await store.stage({ executionId, bytes: pdf, sha256 });
    await expect(store.publish({
      stageToken: third.token, tenantId, documentId, artifactId, bytes: pdf, sha256,
    })).rejects.toBeInstanceOf(LocalDocumentMaterializationStorageError);
    await store.discard(third.token);
  });

  it("rejects invalid IDs, hash, size and unknown stage tokens", async () => {
    const root = await makeRoot();
    const store = await LocalDocumentMaterializationStore.create(root, 1024);
    await expect(store.stage({
      executionId: "invalid", bytes: pdf, sha256,
    })).rejects.toBeInstanceOf(LocalDocumentMaterializationStorageError);
    await expect(store.stage({
      executionId, bytes: new Uint8Array(1025), sha256: "sha256:" + "0".repeat(64),
    })).rejects.toBeInstanceOf(LocalDocumentMaterializationStorageError);
    const staged = await store.stage({ executionId, bytes: pdf, sha256 });
    await expect(store.publish({
      stageToken: "unknown", tenantId, documentId, artifactId, bytes: pdf, sha256,
    })).rejects.toBeInstanceOf(LocalDocumentMaterializationStorageError);
    await expect(store.publish({
      stageToken: staged.token, tenantId: "invalid", documentId, artifactId,
      bytes: pdf, sha256,
    })).rejects.toBeInstanceOf(LocalDocumentMaterializationStorageError);
    await store.discard(staged.token);
    await expect(store.discard(staged.token)).resolves.toBeUndefined();
  });

  it("rejects a symlinked object root and unsafe maximum", async () => {
    const root = await makeRoot();
    const real = join(root, "real");
    await mkdir(real);
    const linked = join(root, "linked");
    await symlink(real, linked);
    await expect(LocalDocumentMaterializationStore.create(linked, 1024))
      .rejects.toBeInstanceOf(LocalDocumentMaterializationConfigurationError);
    await expect(LocalDocumentMaterializationStore.create(real, 0))
      .rejects.toBeInstanceOf(LocalDocumentMaterializationConfigurationError);
  });
});

describe("DeterministicFixturePdfScanner", () => {
  it("marks the EICAR fixture as infected and an ordinary fixture as clean", async () => {
    const scanner = new DeterministicFixturePdfScanner();
    await expect(scanner.scan({
      stageToken: "opaque", bytes: pdf, sha256,
    })).resolves.toEqual({ status: "clean" });
    const eicar = new Uint8Array(Buffer.from(
      "%PDF-1.7\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    ));
    await expect(scanner.scan({
      stageToken: "opaque", bytes: eicar,
      sha256: `sha256:${createHash("sha256").update(eicar).digest("hex")}`,
    })).resolves.toEqual({ status: "infected" });
  });
});
