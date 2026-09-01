import { createHash } from "node:crypto";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  DjenPublicationPdfGenerator,
  PublicationCopyGenerationError,
} from "./djen-publication-pdf.js";

describe("DjenPublicationPdfGenerator", () => {
  it("creates a bounded, labelled and multi-page PDF from decoded DJEN text", async () => {
    const generator = new DjenPublicationPdfGenerator({
      now: () => new Date("2026-08-31T21:30:00.000Z"),
    });
    const result = await generator.generate({
      numeroProcesso: "0000001-23.2026.8.99.0001",
      numeroComunicacao: 98765,
      tribunal: "TJEX",
      dataDisponibilizacao: "2026-08-31",
      orgao: "1ª Vara Cível",
      classe: "Procedimento Comum Cível",
      tipoComunicacao: "Intimação",
      meio: "Diário de Justiça Eletrônico Nacional",
      tipoDocumento: "Decisão",
      texto: `<p>Decis&amp;atilde;o íntegra 😀</p><script>alert(1)</script>${" conteúdo oficial".repeat(1_200)}`,
    });

    expect(new TextDecoder().decode(result.bytes.subarray(0, 5))).toBe("%PDF-");
    expect(result.mediaType).toBe("application/pdf");
    expect(result.sha256).toBe(
      createHash("sha256").update(result.bytes).digest("hex"),
    );
    const document = await PDFDocument.load(result.bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
    expect(document.getTitle()).toBe("Reprodução de publicação oficial - DJEN");
    expect(document.getSubject()).toContain("não substitui o documento original");
    expect(document.getCreationDate()?.toISOString()).toBe(
      "2026-08-31T21:30:00.000Z",
    );
  });

  it("rejects missing, oversized and invalid official content", async () => {
    const generator = new DjenPublicationPdfGenerator({ maxTextCharacters: 20 });
    await expect(
      generator.generate({ texto: "", numeroComunicacao: 1 }),
    ).rejects.toBeInstanceOf(PublicationCopyGenerationError);
    await expect(
      generator.generate({ texto: "x".repeat(21), numeroComunicacao: 1 }),
    ).rejects.toBeInstanceOf(PublicationCopyGenerationError);
    await expect(
      generator.generate({ texto: "texto", numeroComunicacao: 1 }),
    ).rejects.toBeInstanceOf(PublicationCopyGenerationError);
  });

  it("renders minimal metadata and splits a token that is wider than the page", async () => {
    const result = await new DjenPublicationPdfGenerator().generate({
      numeroProcesso: "0000001-23.2026.8.99.0001",
      numeroComunicacao: 1,
      texto: `Texto\n${"A".repeat(800)}`,
    });
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBeGreaterThan(0);
  });
});
