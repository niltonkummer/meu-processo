import type {
  FoundationRepository,
  RepositoryContext,
} from "./foundation-repository.js";

export type IdentityIdPurpose = "user" | "personal-tenant";

export interface IdentityIdDeriver {
  derive(purpose: IdentityIdPurpose, providerSubject: string): string;
}

export interface PersonalTenantContextResolver {
  resolve(providerSubject: string): Promise<RepositoryContext>;
}

export class PersonalTenantIdentityError extends Error {
  constructor() {
    super("Authenticated identity is invalid.");
    this.name = "PersonalTenantIdentityError";
  }
}

export class PersonalTenantResolver implements PersonalTenantContextResolver {
  constructor(
    private readonly repository: FoundationRepository,
    private readonly idDeriver: IdentityIdDeriver,
  ) {}

  async resolve(providerSubject: string): Promise<RepositoryContext> {
    if (providerSubject.length < 1 || providerSubject.length > 255) {
      throw new PersonalTenantIdentityError();
    }

    const context = {
      userId: this.idDeriver.derive("user", providerSubject),
      tenantId: this.idDeriver.derive("personal-tenant", providerSubject),
    };
    await this.repository.provisionPersonalTenant({
      ...context,
      providerSubject,
    });
    return context;
  }
}
