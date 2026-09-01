import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedPrincipal } from "../domain/access-control.js";
import {
  createAuthorizedPublicationCopy,
  PublicationTextUnavailableError,
  type PublicationCopyPdfGenerator,
} from "./publication-copy.js";
import {
  PublicationNotFoundError,
  type DjenPublicationLocator,
} from "./publication-proxy.js";

const principal: AuthenticatedPrincipal = {
  userId: "user_alpha",
  memberships: [],
};

const publication = {
  numeroProcesso: "0000001-23.2026.8.99.0001",
  numeroComunicacao: 98765,
  tribunal: "TJEX",
  texto: "Decisão oficial",
};

describe("createAuthorizedPublicationCopy", () => {
  it("re-resolves the exact DJEN communication and generates its labelled PDF", async () => {
    const locator: DjenPublicationLocator = {
      findCommunication: vi.fn().mockResolvedValue(publication),
    };
    const generator: PublicationCopyPdfGenerator = {
      generate: vi.fn().mockResolvedValue({
        bytes: new TextEncoder().encode("%PDF-copy"),
        mediaType: "application/pdf",
        sha256: "a".repeat(64),
      }),
    };

    await expect(
      createAuthorizedPublicationCopy(
        principal,
        "00000012320268990001",
        "98765",
        locator,
        generator,
      ),
    ).resolves.toMatchObject({
      mediaType: "application/pdf",
      sha256: "a".repeat(64),
      fileName:
        "0000001-23.2026.8.99.0001-comunicacao-98765-publicacao-djen.pdf",
    });
    expect(locator.findCommunication).toHaveBeenCalledWith({
      cnjNumber: "00000012320268990001",
      communicationNumber: 98765,
    });
    expect(generator.generate).toHaveBeenCalledWith(publication);
  });

  it("fails closed when identity or official text does not match", async () => {
    const generator: PublicationCopyPdfGenerator = { generate: vi.fn() };
    const mismatch: DjenPublicationLocator = {
      findCommunication: vi.fn().mockResolvedValue({
        ...publication,
        numeroProcesso: "0000002-23.2026.8.99.0001",
      }),
    };
    await expect(
      createAuthorizedPublicationCopy(
        principal,
        "00000012320268990001",
        "98765",
        mismatch,
        generator,
      ),
    ).rejects.toBeInstanceOf(PublicationNotFoundError);

    const withoutText: DjenPublicationLocator = {
      findCommunication: vi.fn().mockResolvedValue({
        ...publication,
        texto: "   ",
      }),
    };
    await expect(
      createAuthorizedPublicationCopy(
        principal,
        "00000012320268990001",
        "98765",
        withoutText,
        generator,
      ),
    ).rejects.toBeInstanceOf(PublicationTextUnavailableError);
    expect(generator.generate).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    { ...publication, numeroProcesso: undefined },
    { ...publication, numeroComunicacao: 98766 },
  ])("does not generate for every incomplete or divergent identity", async (value) => {
    const generator: PublicationCopyPdfGenerator = { generate: vi.fn() };
    await expect(
      createAuthorizedPublicationCopy(
        principal,
        "00000012320268990001",
        "98765",
        { findCommunication: vi.fn().mockResolvedValue(value) },
        generator,
      ),
    ).rejects.toBeInstanceOf(PublicationNotFoundError);
    expect(generator.generate).not.toHaveBeenCalled();
  });
});
