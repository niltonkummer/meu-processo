import { describe, expect, it, vi } from "vitest";
import {
  AccountDataControlsValidationError, AccountDataExportUnavailableError,
  AccountDataRequestNotFoundError, PersonalAccountDataControls,
  RecentAuthenticationRequiredError, type TenantExportReader,
} from "./account-data-controls.js";
import { TenantDataLifecycleService, type TenantDataLifecycleRequestRepository } from "./tenant-data-lifecycle.js";

const context = { userId: "00000000-0000-7000-8000-000000000001", tenantId: "10000000-0000-7000-8000-000000000001" };
const requestId = "20000000-0000-7000-8000-000000000001";
const now = new Date("2026-08-31T12:00:00.000Z");
const base = { requestId, requestType: "export" as const, state: "completed" as const, requestedAt: new Date("2026-08-31T11:59:00.000Z"), completedAt: new Date("2026-08-31T11:59:30.000Z"), artifactSizeBytes: 3, artifactExpiresAt: new Date("2026-09-01T12:00:00.000Z"), artifactObjectId: `exports/${context.tenantId}/${requestId}/30000000-0000-7000-8000-000000000001.json`, artifactSha256: `sha256:${"a".repeat(64)}` };

const setup = (details: typeof base | null = base) => {
  const repository: TenantDataLifecycleRequestRepository = {
    requestExport: vi.fn().mockResolvedValue({ ...base, state: "pending" }),
    requestDeletion: vi.fn().mockResolvedValue({ ...base, requestType: "deletion", state: "pending" }),
    get: vi.fn().mockResolvedValue(details),
  };
  const reader: TenantExportReader = { readExport: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) };
  const resolver = { resolve: vi.fn().mockResolvedValue(context) };
  return { repository, reader, resolver, service: new PersonalAccountDataControls(resolver, new TenantDataLifecycleService(repository), reader, () => requestId, () => now) };
};

describe("PersonalAccountDataControls", () => {
  it("uses the system clock when one is not injected", async () => {
    const { repository, reader, resolver } = setup();
    const service = new PersonalAccountDataControls(
      resolver, new TenantDataLifecycleService(repository), reader, () => requestId,
    );
    await service.requestExport("firebase-user");
    expect(vi.mocked(repository.requestExport).mock.calls[0]?.[1].requestedAt)
      .toBeInstanceOf(Date);
  });
  it("requests and reads exports in the resolved personal tenant", async () => {
    const { service, repository, resolver } = setup();
    await expect(service.requestExport("firebase-user")).resolves.toMatchObject({ state: "pending" });
    await expect(service.get("firebase-user", requestId)).resolves.toEqual(base);
    expect(resolver.resolve).toHaveBeenCalledWith("firebase-user");
    expect(repository.requestExport).toHaveBeenCalledWith(context, { requestId, requestedAt: now });
  });

  it("does not reveal an absent request", async () => {
    await expect(setup(null).service.get("firebase-user", requestId)).rejects.toBeInstanceOf(AccountDataRequestNotFoundError);
  });

  it("downloads only a complete, live and fully projected export", async () => {
    const { service, reader } = setup();
    await expect(service.download("firebase-user", requestId)).resolves.toEqual({ bytes: new Uint8Array([1, 2, 3]), fileName: `meu-processo-exportacao-${requestId}.json` });
    expect(reader.readExport).toHaveBeenCalledWith({ storageObjectId: base.artifactObjectId, expectedBytes: 3, expectedSha256: base.artifactSha256 });
  });

  it.each([
    { requestType: "deletion" }, { state: "pending" }, { artifactObjectId: null },
    { artifactSha256: null }, { artifactSizeBytes: null }, { artifactExpiresAt: null },
    { artifactExpiresAt: now },
  ])("rejects an unavailable export projection", async (change) => {
    const details = { ...base, ...change } as typeof base;
    await expect(setup(details).service.download("firebase-user", requestId)).rejects.toBeInstanceOf(AccountDataExportUnavailableError);
  });

  it("requires exact confirmation and recent authentication for deletion", async () => {
    const { service, repository } = setup();
    await expect(service.requestDeletion({ providerSubject: "firebase-user", authenticatedAt: new Date(now.getTime() - 60_000), confirmation: "EXCLUIR MINHA CONTA" })).resolves.toMatchObject({ requestType: "deletion", state: "pending" });
    expect(repository.requestDeletion).toHaveBeenCalledWith(context, { requestId, requestedAt: now, confirmed: true });
    await expect(service.requestDeletion({ providerSubject: "firebase-user", authenticatedAt: now, confirmation: "excluir" })).rejects.toBeInstanceOf(AccountDataControlsValidationError);
  });

  it.each([
    undefined, new Date("invalid"), new Date(now.getTime() - 300_001),
    new Date(now.getTime() + 60_001),
  ])("rejects missing, invalid, old or future authentication", async (authenticatedAt) => {
    await expect(setup().service.requestDeletion({ providerSubject: "firebase-user", authenticatedAt, confirmation: "EXCLUIR MINHA CONTA" })).rejects.toBeInstanceOf(RecentAuthenticationRequiredError);
  });
});
