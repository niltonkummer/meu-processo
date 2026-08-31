import { describe, expect, it, vi } from "vitest";

import type { FoundationRepository } from "./foundation-repository.js";
import {
  PersonalTenantIdentityError,
  PersonalTenantResolver,
  type IdentityIdDeriver,
} from "./personal-tenant-resolver.js";

const USER_ID = "10000000-0000-8000-8000-000000000001";
const TENANT_ID = "20000000-0000-8000-8000-000000000001";

const repository = () =>
  ({
    provisionPersonalTenant: vi.fn().mockResolvedValue(undefined),
  }) as unknown as FoundationRepository;

const deriver = (): IdentityIdDeriver => ({
  derive: vi.fn((purpose) =>
    purpose === "user" ? USER_ID : TENANT_ID,
  ),
});

describe("PersonalTenantResolver", () => {
  it("derives separated internal ids and provisions the exact context", async () => {
    const foundationRepository = repository();
    const identityIdDeriver = deriver();
    const resolver = new PersonalTenantResolver(
      foundationRepository,
      identityIdDeriver,
    );

    await expect(resolver.resolve("firebase-synthetic-subject")).resolves.toEqual({
      userId: USER_ID,
      tenantId: TENANT_ID,
    });
    expect(identityIdDeriver.derive).toHaveBeenNthCalledWith(
      1,
      "user",
      "firebase-synthetic-subject",
    );
    expect(identityIdDeriver.derive).toHaveBeenNthCalledWith(
      2,
      "personal-tenant",
      "firebase-synthetic-subject",
    );
    expect(foundationRepository.provisionPersonalTenant).toHaveBeenCalledWith({
      userId: USER_ID,
      tenantId: TENANT_ID,
      providerSubject: "firebase-synthetic-subject",
    });
  });

  it.each(["", "x".repeat(256)])(
    "rejects an invalid provider subject before derivation",
    async (providerSubject) => {
      const foundationRepository = repository();
      const identityIdDeriver = deriver();
      const resolver = new PersonalTenantResolver(
        foundationRepository,
        identityIdDeriver,
      );

      await expect(resolver.resolve(providerSubject)).rejects.toBeInstanceOf(
        PersonalTenantIdentityError,
      );
      expect(identityIdDeriver.derive).not.toHaveBeenCalled();
      expect(
        foundationRepository.provisionPersonalTenant,
      ).not.toHaveBeenCalled();
    },
  );

  it("propagates a provisioning failure without returning a context", async () => {
    const foundationRepository = repository();
    vi.mocked(foundationRepository.provisionPersonalTenant).mockRejectedValue(
      new Error("synthetic repository failure"),
    );
    const resolver = new PersonalTenantResolver(
      foundationRepository,
      deriver(),
    );

    await expect(
      resolver.resolve("firebase-synthetic-subject"),
    ).rejects.toThrow("synthetic repository failure");
  });
});
