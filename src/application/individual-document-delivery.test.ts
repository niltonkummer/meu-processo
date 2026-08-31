import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";
import {
  DocumentContentUnavailableError,
  DocumentDownloadQuotaExceededError,
  DocumentDeliveryValidationError,
  PersistedDocumentNotFoundError,
  PersonalDocumentDelivery,
  PrivateObjectNotFoundError,
  type DocumentDeliveryRepository,
  type PrivateObjectStore,
} from "./individual-document-delivery.js";

const USER = "00000000-0000-7000-8000-000000000941";
const TENANT = "10000000-0000-7000-8000-000000000941";
const CASE = "83000000-0000-7000-8000-000000000941";
const DOCUMENT = "88000000-0000-7000-8000-000000000941";
const ARTIFACT = "89000000-0000-7000-8000-000000000941";
const AUTHORIZATION = "8a000000-0000-7000-8000-000000000941";
const REQUEST = "8b000000-0000-7000-8000-000000000941";
const OBJECT = `documents/tenant/${TENANT}/${DOCUMENT}/${ARTIFACT}.pdf`;
const BYTES = new TextEncoder().encode("%PDF-1.7\nsynthetic\n%%EOF");
const HASH = `sha256:${createHash("sha256").update(BYTES).digest("hex")}`;

const resolver = {
  resolve: vi.fn().mockResolvedValue({ userId: USER, tenantId: TENANT }),
} as unknown as PersonalTenantContextResolver;

const authorization = {
  authorizationId: AUTHORIZATION,
  tenantId: TENANT,
  userId: USER,
  caseId: CASE,
  documentId: DOCUMENT,
  artifactId: ARTIFACT,
  storageObjectId: OBJECT,
  title: "Intimação para manifestação",
  mediaType: "application/pdf" as const,
  sizeBytes: BYTES.byteLength,
  sha256: HASH,
};

const ids = [AUTHORIZATION, REQUEST];
const createId = vi.fn(() => ids.shift() ?? REQUEST);

const repository = (result: unknown = { kind: "authorized", authorization }) => ({
  authorize: vi.fn().mockResolvedValue(result),
  recordOutcome: vi.fn().mockResolvedValue(true),
}) as unknown as DocumentDeliveryRepository;

const store = (bytes: Uint8Array = BYTES): PrivateObjectStore => ({
  read: vi.fn().mockResolvedValue(bytes),
});

describe("PersonalDocumentDelivery", () => {
  it("reauthorizes, reads the opaque object and audits a verified PDF", async () => {
    ids.splice(0, ids.length, AUTHORIZATION, REQUEST);
    const repo = repository();
    const objectStore = store();
    const service = new PersonalDocumentDelivery(
      resolver, repo, objectStore,
      { quotaPerMinute: 20, maximumBytes: 25 * 1024 * 1024 },
      createId,
    );

    await expect(service.download("firebase-subject", CASE, DOCUMENT)).resolves.toEqual({
      bytes: BYTES,
      mediaType: "application/pdf",
      sha256: HASH,
      fileName: "Intimação para manifestação.pdf",
    });
    expect(repo.authorize).toHaveBeenCalledWith(
      { userId: USER, tenantId: TENANT },
      {
        caseId: CASE,
        documentId: DOCUMENT,
        authorizationId: AUTHORIZATION,
        requestId: REQUEST,
        quotaPerMinute: 20,
      },
    );
    expect(objectStore.read).toHaveBeenCalledWith(OBJECT, BYTES.byteLength);
    expect(repo.recordOutcome).toHaveBeenCalledWith(
      { userId: USER, tenantId: TENANT }, AUTHORIZATION, "delivered",
    );
  });

  it.each([
    [{ kind: "not_found" }, PersistedDocumentNotFoundError],
    [{ kind: "quota_exceeded" }, DocumentDownloadQuotaExceededError],
  ])("maps a denied authorization without touching storage", async (result, error) => {
    const repo = repository(result);
    const objectStore = store();
    const service = new PersonalDocumentDelivery(
      resolver, repo, objectStore,
      { quotaPerMinute: 20, maximumBytes: 25 * 1024 * 1024 },
      () => AUTHORIZATION,
    );
    await expect(service.download("subject", CASE, DOCUMENT)).rejects.toBeInstanceOf(error);
    expect(objectStore.read).not.toHaveBeenCalled();
    expect(repo.recordOutcome).not.toHaveBeenCalled();
  });

  it.each([
    [new Uint8Array(BYTES.byteLength), "integrity_failed"],
    [new TextEncoder().encode("<html>not a pdf</html>"), "integrity_failed"],
    [BYTES.slice(0, -1), "integrity_failed"],
  ] as const)("fails closed and audits invalid content", async (bytes, outcome) => {
    const repo = repository();
    const service = new PersonalDocumentDelivery(
      resolver, repo, store(bytes),
      { quotaPerMinute: 20, maximumBytes: 25 * 1024 * 1024 },
      () => AUTHORIZATION,
    );
    await expect(service.download("subject", CASE, DOCUMENT))
      .rejects.toBeInstanceOf(DocumentContentUnavailableError);
    expect(repo.recordOutcome).toHaveBeenCalledWith(
      { userId: USER, tenantId: TENANT }, AUTHORIZATION, outcome,
    );
  });

  it.each([
    [new PrivateObjectNotFoundError(), "object_missing"],
    [new Error("filesystem detail"), "storage_failed"],
  ] as const)("redacts object-store failures and audits them", async (failure, outcome) => {
    const repo = repository();
    const objectStore: PrivateObjectStore = { read: vi.fn().mockRejectedValue(failure) };
    const service = new PersonalDocumentDelivery(
      resolver, repo, objectStore,
      { quotaPerMinute: 20, maximumBytes: 25 * 1024 * 1024 },
      () => AUTHORIZATION,
    );
    await expect(service.download("subject", CASE, DOCUMENT))
      .rejects.toThrow("O documento não pôde ser entregue.");
    expect(repo.recordOutcome).toHaveBeenCalledWith(
      { userId: USER, tenantId: TENANT }, AUTHORIZATION, outcome,
    );
  });

  it("rejects invalid IDs and unsafe authorization projections", async () => {
    const repo = repository({
      kind: "authorized",
      authorization: { ...authorization, tenantId: "10000000-0000-7000-8000-000000000999" },
    });
    const service = new PersonalDocumentDelivery(
      resolver, repo, store(), { quotaPerMinute: 20, maximumBytes: 1024 },
      () => AUTHORIZATION,
    );
    await expect(service.download("subject", "bad", DOCUMENT))
      .rejects.toBeInstanceOf(DocumentDeliveryValidationError);
    await expect(service.download("subject", CASE, DOCUMENT))
      .rejects.toBeInstanceOf(DocumentContentUnavailableError);
  });

  it.each([
    [() => "bad"],
    [(() => {
      const generated = [AUTHORIZATION, "bad"];
      return () => generated.shift()!;
    })()],
  ])("fails closed when an internal audit ID is invalid", async (idFactory) => {
    const repo = repository();
    const service = new PersonalDocumentDelivery(
      resolver, repo, store(),
      { quotaPerMinute: 20, maximumBytes: 25 * 1024 * 1024 },
      idFactory,
    );
    await expect(service.download("subject", CASE, DOCUMENT))
      .rejects.toBeInstanceOf(DocumentContentUnavailableError);
    expect(repo.authorize).not.toHaveBeenCalled();
  });

  it("fails closed when the delivered outcome cannot be persisted", async () => {
    const repo = repository();
    vi.mocked(repo.recordOutcome).mockResolvedValue(false);
    const service = new PersonalDocumentDelivery(
      resolver, repo, store(),
      { quotaPerMinute: 20, maximumBytes: 25 * 1024 * 1024 },
      () => AUTHORIZATION,
    );
    await expect(service.download("subject", CASE, DOCUMENT))
      .rejects.toBeInstanceOf(DocumentContentUnavailableError);
  });
});
