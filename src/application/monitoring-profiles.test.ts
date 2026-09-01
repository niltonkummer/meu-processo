import { describe, expect, it } from "vitest";

import { MemoryFoundationRepository } from "../infrastructure/memory-foundation-repository.js";
import type { IdentifierProtector } from "./protected-subject-factory.js";
import { ProtectedSubjectFactory } from "./protected-subject-factory.js";
import type { PersonalTenantContextResolver } from "./personal-tenant-resolver.js";
import { MonitoringProfiles } from "./monitoring-profiles.js";

const USER_ID = "00000000-0000-8000-8000-000000000001";
const TENANT_ID = "10000000-0000-8000-8000-000000000001";
const SUBJECT_ID = "20000000-0000-8000-8000-000000000001";
const TARGET_ID = "30000000-0000-8000-8000-000000000001";
const STATE_ID = "50000000-0000-8000-8000-000000000001";
const EVENT_ID = "60000000-0000-8000-8000-000000000001";

const resolver: PersonalTenantContextResolver = {
  resolve: () => Promise.resolve({ userId: USER_ID, tenantId: TENANT_ID }),
};
const protector: IdentifierProtector = {
  protect: () => ({
    protectedReference: `hmac-sha256:v1:${"A".repeat(43)}`,
    encryptedValue: `aes-256-gcm:v1:${"B".repeat(16)}:synthetic:${"C".repeat(22)}`,
    keyVersion: "v1",
  }),
};

describe("MonitoringProfiles", () => {
  it("creates and lists only the minimized public projection", async () => {
    const repository = new MemoryFoundationRepository();
    await repository.provisionPersonalTenant({
      userId: USER_ID,
      tenantId: TENANT_ID,
      providerSubject: "provider-synthetic",
    });
    const identifiers = [SUBJECT_ID, TARGET_ID, STATE_ID, EVENT_ID];
    const profiles = new MonitoringProfiles(
      resolver,
      repository,
      new ProtectedSubjectFactory(protector),
      () => identifiers.shift()!,
      () => new Date("2026-08-31T00:00:00.000Z"),
    );

    const created = await profiles.create("provider-synthetic", {
      subjectType: "name",
      value: "Pessoa Sintética",
    });
    const initialSchedule = repository.inspectProfileSchedule(
      TENANT_ID,
      SUBJECT_ID,
    );
    const page = await profiles.list("provider-synthetic", { limit: 20 });
    const archived = await profiles.archive(
      "provider-synthetic",
      SUBJECT_ID,
      created.version,
    );
    const activePage = await profiles.list("provider-synthetic", { limit: 20 });
    const completePage = await profiles.list("provider-synthetic", {
      limit: 20,
      includeInactive: true,
    });

    expect(created).toEqual({
      tenantId: TENANT_ID,
      subjectId: SUBJECT_ID,
      subjectType: "name",
      displayLabel: "P. S.",
      status: "active",
      version: 1,
      archivedAt: null,
      processCount: 0,
      processSummary: [],
    });
    expect(page.items).toEqual([created]);
    expect(archived).toMatchObject({ status: "inactive", version: 2 });
    expect(activePage.items).toEqual([]);
    expect(completePage.items).toEqual([archived]);
    expect(created).not.toHaveProperty("protectedReference");
    expect(created).not.toHaveProperty("encryptedValue");
    expect(created).not.toHaveProperty("keyVersion");
    expect(initialSchedule).toEqual({
      targetId: TARGET_ID,
      stateId: STATE_ID,
      sourceCode: "djen",
      status: "disabled",
      nextAttemptAt: null,
      outboxEventId: EVENT_ID,
    });
    expect(repository.inspectProfileSchedule(TENANT_ID, SUBJECT_ID)).toMatchObject({
      status: "archived",
      nextAttemptAt: null,
    });
  });

  it("resolves the provider identity on every operation", async () => {
    const calls: string[] = [];
    const repository = new MemoryFoundationRepository();
    await repository.provisionPersonalTenant({
      userId: USER_ID,
      tenantId: TENANT_ID,
      providerSubject: "provider-synthetic",
    });
    const profiles = new MonitoringProfiles(
      {
        resolve: (providerSubject) => {
          calls.push(providerSubject);
          return Promise.resolve({ userId: USER_ID, tenantId: TENANT_ID });
        },
      },
      repository,
      new ProtectedSubjectFactory(protector),
      () => SUBJECT_ID,
    );

    await profiles.list("provider-synthetic", { limit: 1 });
    await expect(
      profiles.archive("provider-synthetic", SUBJECT_ID, 1),
    ).rejects.toThrow();
    expect(calls).toEqual(["provider-synthetic", "provider-synthetic"]);
  });
});
