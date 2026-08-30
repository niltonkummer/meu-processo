import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedPrincipal } from "../domain/access-control.js";
import type { DocumentClient } from "./document-gateway.js";
import {
  completeAuthorizedPublicationChallenge,
  openAuthorizedPublication,
  PublicationChallengeUnavailableError,
  PublicationReferenceInvalidError,
  PublicationNotFoundError,
  type DjenPublicationLocator,
} from "./publication-proxy.js";
import type { DjenPublication } from "./types.js";

const principal: AuthenticatedPrincipal = {
  userId: "user_alpha",
  memberships: [],
};

const publication = {
  id: 42,
  numeroProcesso: "0000001-23.2026.8.99.0001",
  numeroComunicacao: 98765,
  link: "https://eproc1g.tjrs.jus.br/eproc/documento.pdf",
  tipoDocumento: "Despacho",
};

const locator = (
  found: DjenPublication | undefined | null = publication,
): DjenPublicationLocator => ({
  findCommunication: vi.fn().mockResolvedValue(found ?? undefined),
});

const documentClient = (): DocumentClient => ({
  download: vi.fn().mockResolvedValue({
    bytes: new Uint8Array(Buffer.from("%PDF-test")),
    mediaType: "application/pdf",
    sha256: "hash_alpha",
  }),
});

describe("authenticated publication proxy", () => {
  it("re-resolves an exact official communication before downloading", async () => {
    const source = locator();
    const downloader = documentClient();

    const result = await openAuthorizedPublication(
      principal,
      "00000012320268990001",
      "98765",
      source,
      downloader,
    );

    expect(source.findCommunication).toHaveBeenCalledWith({
      cnjNumber: "00000012320268990001",
      communicationNumber: 98765,
    });
    expect(downloader.download).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "communication_98765",
        caseId: "00000012320268990001",
        scope: { kind: "personal", userId: "user_alpha" },
        sourceId: "DJEN",
        sourceUrl: publication.link,
      }),
    );
    expect(result).toEqual({
      bytes: expect.any(Uint8Array),
      mediaType: "application/pdf",
      sha256: "hash_alpha",
      fileName: "0000001-23.2026.8.99.0001-comunicacao-98765.pdf",
    });
  });

  it("uses a neutral title when the official source omits the document type", async () => {
    const downloader = documentClient();

    await openAuthorizedPublication(
      principal,
      "00000012320268990001",
      "98765",
      locator({ ...publication, tipoDocumento: undefined }),
      downloader,
    );

    expect(downloader.download).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Publicação oficial" }),
    );
  });

  it("re-resolves the publication and binds a challenge answer to the same user", async () => {
    const source = locator();
    const completeChallenge = vi.fn().mockResolvedValue({
      bytes: new Uint8Array(Buffer.from("%PDF-assisted")),
      mediaType: "application/pdf",
      sha256: "hash_assisted",
    });
    const downloader: DocumentClient = {
      download: vi.fn(),
      completeChallenge,
    };

    const result = await completeAuthorizedPublicationChallenge(
      principal,
      "00000012320268990001",
      "98765",
      { challengeId: "challenge_alpha", answer: "A19b" },
      source,
      downloader,
    );

    expect(source.findCommunication).toHaveBeenCalledOnce();
    expect(completeChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: "00000012320268990001",
        scope: { kind: "personal", userId: "user_alpha" },
        sourceUrl: publication.link,
      }),
      { challengeId: "challenge_alpha", answer: "A19b" },
    );
    expect(result.fileName).toBe(
      "0000001-23.2026.8.99.0001-comunicacao-98765.pdf",
    );
  });

  it("fails closed when the document client has no assisted challenge support", async () => {
    await expect(
      completeAuthorizedPublicationChallenge(
        principal,
        "00000012320268990001",
        "98765",
        { challengeId: "challenge_alpha", answer: "A19b" },
        locator(),
        documentClient(),
      ),
    ).rejects.toBeInstanceOf(PublicationChallengeUnavailableError);
  });

  it.each([
    ["short CNJ", "123", "98765"],
    ["formatted CNJ in path", "0000001-23.2026.8.99.0001", "98765"],
    ["zero communication", "00000012320268990001", "0"],
    ["decimal communication", "00000012320268990001", "98.765"],
    ["unsafe communication", "00000012320268990001", "9007199254740992"],
  ])("rejects a %s before consulting the source", async (_label, cnj, number) => {
    const source = locator();
    const downloader = documentClient();

    await expect(
      openAuthorizedPublication(principal, cnj, number, source, downloader),
    ).rejects.toBeInstanceOf(PublicationReferenceInvalidError);
    expect(source.findCommunication).not.toHaveBeenCalled();
    expect(downloader.download).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["foreign process", { ...publication, numeroProcesso: "9999999-99.2026.8.99.9999" }],
    ["process without CNJ", { ...publication, numeroProcesso: undefined }],
    ["foreign communication", { ...publication, numeroComunicacao: 12345 }],
    ["missing URL", { ...publication, link: undefined }],
    ["non-HTTPS URL", { ...publication, link: "http://eproc1g.tjrs.jus.br/documento" }],
    ["malformed URL", { ...publication, link: "not a URL" }],
  ])("hides a %s official reference without downloading", async (_label, found) => {
    const source = locator(found);
    const downloader = documentClient();

    await expect(
      openAuthorizedPublication(
        principal,
        "00000012320268990001",
        "98765",
        source,
        downloader,
      ),
    ).rejects.toBeInstanceOf(PublicationNotFoundError);
    expect(downloader.download).not.toHaveBeenCalled();
  });
});
