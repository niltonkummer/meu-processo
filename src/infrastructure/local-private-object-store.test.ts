import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PrivateObjectNotFoundError } from "../application/individual-document-delivery.js";
import {
  LocalPrivateObjectStore,
  PrivateObjectStoreConfigurationError,
  PrivateObjectStoreReadError,
} from "./local-private-object-store.js";

const TENANT = "10000000-0000-7000-8000-000000000951";
const DOCUMENT = "88000000-0000-7000-8000-000000000951";
const ARTIFACT = "89000000-0000-7000-8000-000000000951";
const OBJECT = `documents/tenant/${TENANT}/${DOCUMENT}/${ARTIFACT}.pdf`;
const PDF = new TextEncoder().encode("%PDF-1.7\nsynthetic\n%%EOF");
const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "meu-processo-object-store-"));
  roots.push(root);
  const directory = join(root, "documents", "tenant", TENANT, DOCUMENT);
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${ARTIFACT}.pdf`);
  await writeFile(file, PDF, { flag: "wx", mode: 0o600 });
  return { root, file };
};

describe("LocalPrivateObjectStore", () => {
  it("reads one exact regular object beneath its private root", async () => {
    const { root } = await fixture();
    const store = new LocalPrivateObjectStore(root);
    const result = await store.read(OBJECT, PDF.byteLength);
    expect(Array.from(result)).toEqual(Array.from(PDF));
  });

  it.each([
    "../outside.pdf",
    "/tmp/outside.pdf",
    `documents/tenant/${TENANT}/${DOCUMENT}/../${ARTIFACT}.pdf`,
    `documents/tenant/${TENANT}/${DOCUMENT}/not-a-uuid.pdf`,
    `https://storage.example/${ARTIFACT}.pdf`,
  ])("rejects a locator outside the canonical namespace", async (locator) => {
    const { root } = await fixture();
    await expect(new LocalPrivateObjectStore(root).read(locator, PDF.byteLength))
      .rejects.toBeInstanceOf(PrivateObjectNotFoundError);
  });

  it("rejects missing objects and symlinks without exposing a path", async () => {
    const { root, file } = await fixture();
    const linkedArtifact = "89000000-0000-7000-8000-000000000952";
    await symlink(file, join(root, "documents", "tenant", TENANT, DOCUMENT, `${linkedArtifact}.pdf`));
    const store = new LocalPrivateObjectStore(root);
    await expect(store.read(
      `documents/tenant/${TENANT}/${DOCUMENT}/${linkedArtifact}.pdf`, PDF.byteLength,
    )).rejects.toThrow("Private object not found.");
    await expect(store.read(
      `documents/tenant/${TENANT}/${DOCUMENT}/89000000-0000-7000-8000-000000000999.pdf`,
      PDF.byteLength,
    )).rejects.toBeInstanceOf(PrivateObjectNotFoundError);
  });

  it("rejects size changes and invalid byte limits before buffering", async () => {
    const { root } = await fixture();
    const store = new LocalPrivateObjectStore(root);
    await expect(store.read(OBJECT, PDF.byteLength - 1))
      .rejects.toBeInstanceOf(PrivateObjectStoreReadError);
    await expect(store.read(OBJECT, 0))
      .rejects.toBeInstanceOf(PrivateObjectStoreReadError);
  });

  it("requires an existing absolute directory as root", async () => {
    expect(() => new LocalPrivateObjectStore("relative/path"))
      .toThrow(PrivateObjectStoreConfigurationError);
    const { root, file } = await fixture();
    expect(() => new LocalPrivateObjectStore(file))
      .toThrow(PrivateObjectStoreConfigurationError);
    expect(() => new LocalPrivateObjectStore(join(root, "missing")))
      .toThrow(PrivateObjectStoreConfigurationError);
  });
});
