import { describe, expect, it, vi } from "vitest";

import { MemoryFoundationRepository } from "../infrastructure/memory-foundation-repository.js";
import { MemoryPersistedCasePortfolioRepository } from "../infrastructure/memory-persisted-case-portfolio-repository.js";
import type { FoundationRuntimeConfig } from "../configuration/runtime-config.js";
import type { PersistedCaseDocumentRepository } from "../application/persisted-case-documents.js";
import type { DocumentDeliveryRepository } from "../application/individual-document-delivery.js";
import type { TenantExportReader } from "../application/account-data-controls.js";
import type { DocumentMaterializationRequestRepository } from
  "../application/document-materialization-request.js";
import { composeFoundation } from "./foundation-composition-root.js";

type EnabledFoundationRuntimeConfig = Extract<
  FoundationRuntimeConfig,
  { mode: "postgres" }
>;

const enabledConfig = (): EnabledFoundationRuntimeConfig => ({
  mode: "postgres",
  databaseUrl: "postgresql://runtime:password@postgres/meu_processo",
  poolMax: 3,
  activeKeyVersion: "v1",
  encryptionKeys: new Map([["v1", Buffer.alloc(32, 1)]]),
  blindIndexVersion: "v1",
  blindIndexKey: Buffer.alloc(32, 2),
});

describe("foundation composition root", () => {
  it("keeps the feature unavailable when its runtime mode is disabled", async () => {
    const openRepository = vi.fn();
    const foundation = composeFoundation(
      { mode: "disabled" },
      { mode: "disabled" },
      { openRepository },
    );

    expect(foundation.monitoringProfiles).toBeUndefined();
    expect(foundation.casePortfolio).toBeUndefined();
    expect(foundation.caseDocuments).toBeUndefined();
    expect(foundation.documentDelivery).toBeUndefined();
    expect(foundation.documentMaterializationRequests).toBeUndefined();
    expect(openRepository).not.toHaveBeenCalled();
    await expect(foundation.close()).resolves.toBeUndefined();
  });

  it("wires tenant resolution, protected identifiers and repository lifecycle", async () => {
    const repository = new MemoryFoundationRepository();
    const close = vi.fn(() => Promise.resolve());
    const caseDocumentRepository: PersistedCaseDocumentRepository = {
      list: vi.fn().mockResolvedValue({ caseFound: true, items: [], next: null }),
    };
    const documentDeliveryRepository: DocumentDeliveryRepository = {
      authorize: vi.fn(),
      recordOutcome: vi.fn(),
    };
    const documentMaterializationRequestRepository:
      DocumentMaterializationRequestRepository = {
        request: vi.fn().mockResolvedValue(null),
      };
    const openRepository = vi.fn(() => ({
      repository,
      casePortfolioRepository: new MemoryPersistedCasePortfolioRepository(),
      caseDocumentRepository,
      documentDeliveryRepository,
      documentMaterializationRequestRepository,
      close,
    }));
    const openObjectStore = vi.fn(() => ({ read: vi.fn() }));
    const foundation = composeFoundation(
      enabledConfig(),
      {
        mode: "local",
        objectRoot: "/private/documents",
        quotaPerMinute: 20,
        maximumBytes: 25 * 1024 * 1024,
      },
      {
        openRepository,
        openObjectStore,
        createId: () => "00000000-0000-4000-8000-000000000901",
      },
    );

    const created = await foundation.monitoringProfiles!.create(
      "firebase-synthetic-user",
      { subjectType: "name", value: "Maria da Silva" },
    );
    const page = await foundation.monitoringProfiles!.list(
      "firebase-synthetic-user",
      { limit: 20 },
    );

    expect(openRepository).toHaveBeenCalledWith({
      databaseUrl: enabledConfig().databaseUrl,
      poolMax: 3,
    });
    expect(openObjectStore).toHaveBeenCalledWith("/private/documents");
    expect(foundation.documentDelivery).toBeDefined();
    expect(foundation.documentMaterializationRequests).toBeDefined();
    expect(created.displayLabel).toBe("M. S.");
    expect(page.items).toEqual([created]);
    await expect(
      foundation.casePortfolio!.list("firebase-synthetic-user", { limit: 20 }),
    ).resolves.toEqual({ cases: [], nextCursor: null });
    await expect(foundation.caseDocuments!.list(
      "firebase-synthetic-user",
      "83000000-0000-7000-8000-000000000901",
      { limit: 20 },
    )).resolves.toEqual({ items: [], nextCursor: null });
    expect(created).not.toHaveProperty("encryptedValue");
    await foundation.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("wires the GCS reader only for explicit GCS delivery", async () => {
    const repository = new MemoryFoundationRepository();
    const documentDeliveryRepository: DocumentDeliveryRepository = {
      authorize: vi.fn(), recordOutcome: vi.fn(),
    };
    const tenantDataLifecycleRepository = {
      requestExport: vi.fn(), requestDeletion: vi.fn(), get: vi.fn(),
    };
    const close = vi.fn(() => Promise.resolve());
    const openRepository = vi.fn(() => ({
      repository,
      documentDeliveryRepository,
      tenantDataLifecycleRepository,
      close,
    }));
    const gcsReader = {
      read: vi.fn<(storageObjectId: string, maximumBytes: number) =>
        Promise<Uint8Array>>(),
      readExport: vi.fn<TenantExportReader["readExport"]>(),
    };
    const openGcsObjectStore = vi.fn(() => gcsReader);
    const foundation = composeFoundation(
      enabledConfig(),
      {
        mode: "gcs",
        bucketName: "meu-processo-validation",
        quotaPerMinute: 20,
        maximumBytes: 25 * 1024 * 1024,
      },
      { openRepository, openGcsObjectStore },
    );
    expect(openGcsObjectStore).toHaveBeenCalledWith({
      bucketName: "meu-processo-validation",
      maximumDocumentBytes: 25 * 1024 * 1024,
      maximumExportBytes: 10 * 1024 * 1024,
    });
    expect(foundation.documentDelivery).toBeDefined();
    expect(foundation.accountDataControls).toBeDefined();
    await foundation.close();
  });
});
