import { MemoryFoundationRepository } from "./memory-foundation-repository.js";
import { foundationRepositoryContract } from "./foundation-repository.contract-test.js";

foundationRepositoryContract("memory", () =>
  Promise.resolve({
    repository: new MemoryFoundationRepository(),
    close: () => Promise.resolve(),
  }),
);
