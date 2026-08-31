import { describe, expect, it } from "vitest";

import type {
  FoundationRepository,
  RepositoryContext,
} from "../application/foundation-repository.js";
import {
  RepositoryAccessDeniedError,
  RepositoryConflictError,
  RepositoryValidationError,
} from "../application/foundation-repository.js";

interface RepositoryFixture {
  repository: FoundationRepository;
  close(): Promise<void>;
}

const identifier = (namespace: number, value: number): string =>
  `${namespace}0000000-0000-7000-8000-${String(value).padStart(12, "0")}`;

const context = (userId: string, tenantId: string): RepositoryContext => ({
  userId,
  tenantId,
});

const djenSourceId = identifier(4, 1);
const subjectProtection = (value: number) => ({
  protectedReference: `hmac-sha256:v1:${String(value).padStart(43, "A")}`,
  encryptedValue: `aes-256-gcm:v1:${"B".repeat(16)}:${String(value)}:${"C".repeat(22)}`,
  keyVersion: "v1",
});

export const foundationRepositoryContract = (
  adapterName: string,
  createFixture: () => Promise<RepositoryFixture>,
) => {
  describe(`${adapterName} foundation repository contract`, () => {
    it("provisions a personal tenant and paginates subjects by cursor", async () => {
      const fixture = await createFixture();
      const userAlpha = identifier(0, 101);
      const tenantAlpha = identifier(1, 101);
      try {
        await Promise.all([
          fixture.repository.provisionPersonalTenant({
            userId: userAlpha,
            tenantId: tenantAlpha,
            providerSubject: "provider-contract-alpha",
          }),
          fixture.repository.provisionPersonalTenant({
            userId: userAlpha,
            tenantId: tenantAlpha,
            providerSubject: "provider-contract-alpha",
          }),
        ]);
        await fixture.repository.createMonitoredSubject(
          context(userAlpha, tenantAlpha),
          {
            subjectId: identifier(2, 101),
            subjectType: "name",
            displayLabel: "Synthetic Subject One",
            ...subjectProtection(101),
          },
        );
        await fixture.repository.createMonitoredSubject(
          context(userAlpha, tenantAlpha),
          {
            subjectId: identifier(2, 101),
            subjectType: "name",
            displayLabel: "Synthetic Subject One",
            ...subjectProtection(101),
          },
        );
        await fixture.repository.createMonitoredSubject(
          context(userAlpha, tenantAlpha),
          {
            subjectId: identifier(2, 102),
            subjectType: "name",
            displayLabel: "Synthetic Subject Two",
            ...subjectProtection(102),
          },
        );

        const first = await fixture.repository.listMonitoredSubjects(
          context(userAlpha, tenantAlpha),
          { limit: 1 },
        );
        const second = await fixture.repository.listMonitoredSubjects(
          context(userAlpha, tenantAlpha),
          {
            limit: 1,
            ...(first.nextCursor
              ? { afterSubjectId: first.nextCursor }
              : {}),
          },
        );

        expect(first.items.map(({ subjectId }) => subjectId)).toEqual([
          identifier(2, 101),
        ]);
        expect(first.items[0]).not.toHaveProperty("protectedReference");
        expect(first.items[0]).not.toHaveProperty("encryptedValue");
        expect(first.items[0]).not.toHaveProperty("keyVersion");
        expect(first.nextCursor).toBe(
          identifier(2, 101),
        );
        expect(second.items.map(({ subjectId }) => subjectId)).toEqual([
          identifier(2, 102),
        ]);
        expect(second.nextCursor).toBeNull();

        await expect(
          Promise.resolve().then(() =>
            fixture.repository.listMonitoredSubjects(
              context(userAlpha, tenantAlpha),
              { limit: 0 },
            ),
          ),
        ).rejects.toBeInstanceOf(RepositoryValidationError);
        await expect(
          Promise.resolve().then(() =>
            fixture.repository.listMonitoringTargets(
              context(userAlpha, tenantAlpha),
              { limit: 101 },
            ),
          ),
        ).rejects.toBeInstanceOf(RepositoryValidationError);
        await expect(
          Promise.resolve().then(() =>
            fixture.repository.listMonitoredSubjects(
              context(userAlpha, tenantAlpha),
              { limit: 1.5 },
            ),
          ),
        ).rejects.toBeInstanceOf(RepositoryValidationError);
      } finally {
        await fixture.close();
      }
    });

    it("fails closed for a user without an active tenant membership", async () => {
      const fixture = await createFixture();
      const userAlpha = identifier(0, 121);
      const userBeta = identifier(0, 122);
      const tenantAlpha = identifier(1, 121);
      try {
        await fixture.repository.provisionPersonalTenant({
          userId: userAlpha,
          tenantId: tenantAlpha,
          providerSubject: "provider-membership-alpha",
        });

        await expect(
          Promise.resolve().then(() =>
            fixture.repository.listMonitoredSubjects(
              context(userBeta, tenantAlpha),
              { limit: 20 },
            ),
          ),
        ).rejects.toBeInstanceOf(RepositoryAccessDeniedError);
      } finally {
        await fixture.close();
      }
    });

    it("uses optimistic concurrency and hides archived subjects by default", async () => {
      const fixture = await createFixture();
      const userAlpha = identifier(0, 141);
      const tenantAlpha = identifier(1, 141);
      const subjectAlpha = identifier(2, 141);
      try {
        await fixture.repository.provisionPersonalTenant({
          userId: userAlpha,
          tenantId: tenantAlpha,
          providerSubject: "provider-lifecycle-alpha",
        });
        await fixture.repository.createMonitoredSubject(
          context(userAlpha, tenantAlpha),
          {
            subjectId: subjectAlpha,
            subjectType: "name",
            displayLabel: "Synthetic Lifecycle Subject",
            ...subjectProtection(141),
          },
        );

        const concurrentWrites = await Promise.allSettled([
          Promise.resolve().then(() =>
            fixture.repository.updateMonitoredSubject(
              context(userAlpha, tenantAlpha),
              {
                subjectId: subjectAlpha,
                expectedVersion: 1,
                displayLabel: "Synthetic Concurrent Subject A",
              },
            ),
          ),
          Promise.resolve().then(() =>
            fixture.repository.updateMonitoredSubject(
              context(userAlpha, tenantAlpha),
              {
                subjectId: subjectAlpha,
                expectedVersion: 1,
                displayLabel: "Synthetic Concurrent Subject B",
              },
            ),
          ),
        ]);
        const fulfilled = concurrentWrites.filter(
          (result) => result.status === "fulfilled",
        );
        const rejected = concurrentWrites.filter(
          (result) => result.status === "rejected",
        );
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(fulfilled[0]?.value).toMatchObject({
          status: "active",
          version: 2,
        });
        expect(rejected[0]?.reason).toBeInstanceOf(RepositoryConflictError);

        const archived = await fixture.repository.archiveMonitoredSubject(
          context(userAlpha, tenantAlpha),
          subjectAlpha,
          2,
        );
        expect(archived).toMatchObject({ status: "inactive", version: 3 });

        const active = await fixture.repository.listMonitoredSubjects(
          context(userAlpha, tenantAlpha),
          { limit: 20 },
        );
        const includingInactive =
          await fixture.repository.listMonitoredSubjects(
            context(userAlpha, tenantAlpha),
            { limit: 20, includeInactive: true },
          );
        expect(active.items).toEqual([]);
        expect(includingInactive.items).toEqual([archived]);
      } finally {
        await fixture.close();
      }
    });

    it("registers the monitoring graph atomically and archives its target", async () => {
      const fixture = await createFixture();
      const userAlpha = identifier(0, 171);
      const tenantAlpha = identifier(1, 171);
      const subjectAlpha = identifier(2, 171);
      const targetAlpha = identifier(3, 171);
      const stateAlpha = identifier(5, 171);
      const eventAlpha = identifier(7, 171);
      const profile = {
        subjectId: subjectAlpha,
        subjectType: "name" as const,
        displayLabel: "Synthetic Scheduled Subject",
        ...subjectProtection(171),
        targetId: targetAlpha,
        stateId: stateAlpha,
        eventId: eventAlpha,
        sourceCode: "djen",
        scheduledAt: new Date("2026-08-31T12:00:00.000Z"),
      };
      try {
        await fixture.repository.provisionPersonalTenant({
          userId: userAlpha,
          tenantId: tenantAlpha,
          providerSubject: "provider-scheduled-alpha",
        });

        const registrations = await Promise.all([
          fixture.repository.createScheduledMonitoringProfile(
            context(userAlpha, tenantAlpha),
            profile,
          ),
          fixture.repository.createScheduledMonitoringProfile(
            context(userAlpha, tenantAlpha),
            profile,
          ),
        ]);
        expect(registrations[1]).toEqual(registrations[0]);

        const updated = await fixture.repository.updateMonitoredSubject(
          context(userAlpha, tenantAlpha),
          {
            subjectId: subjectAlpha,
            expectedVersion: 1,
            displayLabel: "Synthetic Scheduled Subject Renamed",
          },
        );
        const targetsAfterRename =
          await fixture.repository.listMonitoringTargets(
            context(userAlpha, tenantAlpha),
            { limit: 20 },
          );
        expect(targetsAfterRename.items).toHaveLength(1);
        expect(targetsAfterRename.items[0]).toMatchObject({
          targetId: targetAlpha,
          status: "active",
        });

        await fixture.repository.archiveMonitoredSubject(
          context(userAlpha, tenantAlpha),
          subjectAlpha,
          updated.version,
        );
        const activeTargets = await fixture.repository.listMonitoringTargets(
          context(userAlpha, tenantAlpha),
          { limit: 20 },
        );
        const allTargets = await fixture.repository.listMonitoringTargets(
          context(userAlpha, tenantAlpha),
          { limit: 20, includeInactive: true },
        );
        expect(activeTargets.items).toEqual([]);
        expect(allTargets.items).toHaveLength(1);
        expect(allTargets.items[0]).toMatchObject({
          targetId: targetAlpha,
          status: "inactive",
          version: 2,
        });
      } finally {
        await fixture.close();
      }
    });

    it("updates and archives monitoring targets with the expected version", async () => {
      const fixture = await createFixture();
      const userAlpha = identifier(0, 161);
      const tenantAlpha = identifier(1, 161);
      const targetAlpha = identifier(3, 161);
      try {
        await fixture.repository.provisionPersonalTenant({
          userId: userAlpha,
          tenantId: tenantAlpha,
          providerSubject: "provider-target-lifecycle-alpha",
        });
        await fixture.repository.createMonitoringTarget(
          context(userAlpha, tenantAlpha),
          {
            targetId: targetAlpha,
            targetType: "cnj",
            displayLabel: "Synthetic Target Before Update",
            protectedReference: "opaque:lifecycle:target:alpha",
            jurisdiction: "BR",
          },
        );

        const updated = await fixture.repository.updateMonitoringTarget(
          context(userAlpha, tenantAlpha),
          {
            targetId: targetAlpha,
            expectedVersion: 1,
            displayLabel: "Synthetic Target After Update",
          },
        );
        expect(updated).toMatchObject({
          displayLabel: "Synthetic Target After Update",
          status: "active",
          version: 2,
        });

        await expect(
          Promise.resolve().then(() =>
            fixture.repository.updateMonitoringTarget(
              context(userAlpha, tenantAlpha),
              {
                targetId: targetAlpha,
                expectedVersion: 1,
                displayLabel: "Synthetic Stale Target",
              },
            ),
          ),
        ).rejects.toBeInstanceOf(RepositoryConflictError);

        const archived = await fixture.repository.archiveMonitoringTarget(
          context(userAlpha, tenantAlpha),
          targetAlpha,
          2,
        );
        const active = await fixture.repository.listMonitoringTargets(
          context(userAlpha, tenantAlpha),
          { limit: 20 },
        );
        const includingInactive =
          await fixture.repository.listMonitoringTargets(
            context(userAlpha, tenantAlpha),
            { limit: 20, includeInactive: true },
          );
        expect(archived).toMatchObject({ status: "inactive", version: 3 });
        expect(active.items).toEqual([]);
        expect(includingInactive.items).toEqual([archived]);
        await expect(
          Promise.resolve().then(() =>
            fixture.repository.createTargetSourceState(
              context(userAlpha, tenantAlpha),
              {
                stateId: identifier(5, 161),
                targetId: targetAlpha,
                sourceId: djenSourceId,
              },
            ),
          ),
        ).rejects.toBeInstanceOf(RepositoryConflictError);
      } finally {
        await fixture.close();
      }
    });

    it("keeps target source state idempotent and preserves the last success", async () => {
      const fixture = await createFixture();
      const userAlpha = identifier(0, 151);
      const tenantAlpha = identifier(1, 151);
      const targetAlpha = identifier(3, 151);
      const stateAlpha = identifier(5, 151);
      const firstAttempt = new Date("2026-08-30T10:00:00.000Z");
      const secondAttempt = new Date("2026-08-30T11:00:00.000Z");
      const nextAttempt = new Date("2026-08-31T10:00:00.000Z");
      try {
        await fixture.repository.provisionPersonalTenant({
          userId: userAlpha,
          tenantId: tenantAlpha,
          providerSubject: "provider-source-state-alpha",
        });
        await fixture.repository.createMonitoringTarget(
          context(userAlpha, tenantAlpha),
          {
            targetId: targetAlpha,
            targetType: "name",
            displayLabel: "Synthetic Source Target",
            protectedReference: "opaque:source:target:alpha",
            jurisdiction: "BR",
          },
        );

        const initial = await fixture.repository.createTargetSourceState(
          context(userAlpha, tenantAlpha),
          {
            stateId: stateAlpha,
            targetId: targetAlpha,
            sourceId: djenSourceId,
          },
        );
        const repeated = await fixture.repository.createTargetSourceState(
          context(userAlpha, tenantAlpha),
          {
            stateId: stateAlpha,
            targetId: targetAlpha,
            sourceId: djenSourceId,
          },
        );
        expect(repeated).toEqual(initial);

        const succeeded = await fixture.repository.updateTargetSourceState(
          context(userAlpha, tenantAlpha),
          {
            stateId: stateAlpha,
            expectedVersion: 1,
            status: "ready",
            attemptedAt: firstAttempt,
            succeededAt: firstAttempt,
            nextAttemptAt: nextAttempt,
            consecutiveFailures: 0,
          },
        );
        const backedOff = await fixture.repository.updateTargetSourceState(
          context(userAlpha, tenantAlpha),
          {
            stateId: stateAlpha,
            expectedVersion: 2,
            status: "backoff",
            attemptedAt: secondAttempt,
            nextAttemptAt: nextAttempt,
            consecutiveFailures: 1,
          },
        );
        expect(succeeded.lastSuccessAt).toEqual(firstAttempt);
        expect(backedOff).toMatchObject({
          lastAttemptAt: secondAttempt,
          lastSuccessAt: firstAttempt,
          consecutiveFailures: 1,
          version: 3,
        });

        await expect(
          Promise.resolve().then(() =>
            fixture.repository.updateTargetSourceState(
              context(userAlpha, tenantAlpha),
              {
                stateId: stateAlpha,
                expectedVersion: 2,
                status: "ready",
                attemptedAt: secondAttempt,
                nextAttemptAt: nextAttempt,
                consecutiveFailures: 0,
              },
            ),
          ),
        ).rejects.toBeInstanceOf(RepositoryConflictError);
      } finally {
        await fixture.close();
      }
    });

    it("isolates tenants and rejects cross-tenant subject-target links", async () => {
      const fixture = await createFixture();
      const userAlpha = identifier(0, 131);
      const userBeta = identifier(0, 132);
      const tenantAlpha = identifier(1, 131);
      const tenantBeta = identifier(1, 132);
      try {
        await fixture.repository.provisionPersonalTenant({
          userId: userAlpha,
          tenantId: tenantAlpha,
          providerSubject: "provider-isolation-alpha",
        });
        await fixture.repository.provisionPersonalTenant({
          userId: userBeta,
          tenantId: tenantBeta,
          providerSubject: "provider-isolation-beta",
        });
        await fixture.repository.createMonitoredSubject(
          context(userAlpha, tenantAlpha),
          {
            subjectId: identifier(2, 131),
            subjectType: "name",
            displayLabel: "Synthetic Tenant Alpha",
            ...subjectProtection(131),
          },
        );
        await fixture.repository.createMonitoredSubject(
          context(userBeta, tenantBeta),
          {
            subjectId: identifier(2, 132),
            subjectType: "name",
            displayLabel: "Synthetic Tenant Beta",
            ...subjectProtection(132),
          },
        );
        await fixture.repository.createMonitoringTarget(
          context(userBeta, tenantBeta),
          {
            targetId: identifier(3, 132),
            targetType: "name",
            displayLabel: "Synthetic Target Beta",
            protectedReference: "opaque:isolation:target:beta",
            jurisdiction: "BR",
          },
        );

        const visible = await fixture.repository.listMonitoredSubjects(
          context(userAlpha, tenantAlpha),
          { limit: 20 },
        );
        expect(visible.items.map(({ subjectId }) => subjectId)).toEqual([
          identifier(2, 131),
        ]);

        await expect(
          Promise.resolve().then(() =>
            fixture.repository.linkSubjectTarget(
              context(userAlpha, tenantAlpha),
              identifier(2, 131),
              identifier(3, 132),
            ),
          ),
        ).rejects.toBeInstanceOf(RepositoryConflictError);

        await expect(
          Promise.resolve().then(() =>
            fixture.repository.createTargetSourceState(
              context(userAlpha, tenantAlpha),
              {
                stateId: identifier(5, 131),
                targetId: identifier(3, 132),
                sourceId: djenSourceId,
              },
            ),
          ),
        ).rejects.toBeInstanceOf(RepositoryConflictError);
      } finally {
        await fixture.close();
      }
    });
  });
};
