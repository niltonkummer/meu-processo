import { createHash } from "node:crypto";

import { decodeHTML } from "entities";
import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
  StandardFonts,
} from "pdf-lib";

import type { PublicationCopyPdfGenerator } from "../application/publication-copy.js";
import type { DjenPublication } from "../application/types.js";

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 48;
const FOOTER_HEIGHT = 34;
const DEFAULT_MAX_TEXT_CHARACTERS = 500_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

export class PublicationCopyGenerationError extends Error {
  constructor() {
    super("Não foi possível gerar a cópia desta publicação.");
    this.name = "PublicationCopyGenerationError";
  }
}

const decodeRepeatedHtml = (value: string): string =>
  Array.from({ length: 3 }).reduce<string>(
    (decoded) => decodeHTML(decoded),
    value,
  );

export const publicationTextToPlainText = (value: string): string =>
  decodeRepeatedHtml(value)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\f\v\u00a0 ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

const exactCnj = (value: string | undefined): string | undefined => {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 20 ? value : undefined;
};

const boundedMetadata = (value: string | undefined): string | undefined => {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length > 500) throw new PublicationCopyGenerationError();
  return normalized;
};

const safeForFont = (value: string, font: PDFFont): string => {
  const support = new Map<string, boolean>();
  return [...value]
    .map((character) => {
      const cached = support.get(character);
      if (cached !== undefined) return cached ? character : "?";
      try {
        font.encodeText(character);
        support.set(character, true);
        return character;
      } catch {
        support.set(character, false);
        return "?";
      }
    })
    .join("");
};

const splitWideToken = (
  token: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] => {
  const parts: string[] = [];
  let current = "";
  for (const character of token) {
    const candidate = `${current}${character}`;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      parts.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
};

const wrapParagraph = (
  paragraph: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] => {
  if (!paragraph) return [""];
  const lines: string[] = [];
  let current = "";
  for (const token of paragraph.split(/ +/u)) {
    const pieces =
      font.widthOfTextAtSize(token, size) > maxWidth
        ? splitWideToken(token, font, size, maxWidth)
        : [token];
    for (const piece of pieces) {
      const candidate = current ? `${current} ${piece}` : piece;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
};

const drawFooter = (
  page: PDFPage,
  font: PDFFont,
  pageNumber: number,
  pageCount: number,
) => {
  const note = "Reprodução DJEN - não substitui o documento original do tribunal";
  page.drawLine({
    start: { x: MARGIN, y: 34 },
    end: { x: A4_WIDTH - MARGIN, y: 34 },
    thickness: 0.5,
    color: rgb(0.72, 0.75, 0.78),
  });
  page.drawText(note, {
    x: MARGIN,
    y: 20,
    size: 7,
    font,
    color: rgb(0.32, 0.35, 0.38),
  });
  const pagination = `Página ${pageNumber}/${pageCount}`;
  page.drawText(pagination, {
    x: A4_WIDTH - MARGIN - font.widthOfTextAtSize(pagination, 7),
    y: 20,
    size: 7,
    font,
    color: rgb(0.32, 0.35, 0.38),
  });
};

export class DjenPublicationPdfGenerator
  implements PublicationCopyPdfGenerator
{
  readonly #now: () => Date;
  readonly #maxTextCharacters: number;

  constructor({
    now = () => new Date(),
    maxTextCharacters = DEFAULT_MAX_TEXT_CHARACTERS,
  }: {
    now?: () => Date;
    maxTextCharacters?: number;
  } = {}) {
    this.#now = now;
    this.#maxTextCharacters = maxTextCharacters;
  }

  async generate(publication: DjenPublication): Promise<{
    bytes: Uint8Array;
    mediaType: "application/pdf";
    sha256: string;
  }> {
    try {
      const cnjNumber = exactCnj(publication.numeroProcesso);
      const communicationNumber = publication.numeroComunicacao;
      const text = publicationTextToPlainText(publication.texto ?? "");
      if (
        !cnjNumber ||
        !Number.isSafeInteger(communicationNumber) ||
        (communicationNumber ?? 0) <= 0 ||
        !text ||
        text.length > this.#maxTextCharacters
      ) {
        throw new PublicationCopyGenerationError();
      }

      const metadata = [
        ["Processo", boundedMetadata(cnjNumber)],
        ["Tribunal", boundedMetadata(publication.tribunal)],
        ["Comunicação", String(communicationNumber)],
        ["Disponibilização", boundedMetadata(publication.dataDisponibilizacao)],
        ["Órgão", boundedMetadata(publication.orgao)],
        ["Classe", boundedMetadata(publication.classe)],
        ["Tipo", boundedMetadata(publication.tipoComunicacao)],
        ["Meio", boundedMetadata(publication.meio)],
        ["Documento", boundedMetadata(publication.tipoDocumento)],
      ].filter((entry): entry is [string, string] => Boolean(entry[1]));

      const document = await PDFDocument.create();
      const regular = await document.embedFont(StandardFonts.Helvetica);
      const bold = await document.embedFont(StandardFonts.HelveticaBold);
      const generatedAt = this.#now();
      document.setTitle("Reprodução de publicação oficial - DJEN");
      document.setAuthor("Meu Processo");
      document.setSubject(
        "Reprodução do texto oficial do DJEN; não substitui o documento original do tribunal.",
      );
      document.setCreator("Meu Processo");
      document.setProducer("Meu Processo - cópia DJEN");
      document.setCreationDate(generatedAt);
      document.setModificationDate(generatedAt);

      const pages: PDFPage[] = [];
      let page = document.addPage([A4_WIDTH, A4_HEIGHT]);
      pages.push(page);
      let y = A4_HEIGHT - MARGIN;
      const usableWidth = A4_WIDTH - MARGIN * 2;
      const addPage = () => {
        page = document.addPage([A4_WIDTH, A4_HEIGHT]);
        pages.push(page);
        y = A4_HEIGHT - MARGIN;
        page.drawText(safeForFont(`Reprodução DJEN - ${cnjNumber}`, regular), {
          x: MARGIN,
          y,
          size: 8,
          font: regular,
          color: rgb(0.32, 0.35, 0.38),
        });
        y -= 22;
      };
      const ensureSpace = (height: number) => {
        if (y - height < FOOTER_HEIGHT + 8) addPage();
      };

      page.drawText("REPRODUÇÃO DE PUBLICAÇÃO OFICIAL", {
        x: MARGIN,
        y,
        size: 15,
        font: bold,
        color: rgb(0.07, 0.16, 0.25),
      });
      y -= 21;
      page.drawText("Diário de Justiça Eletrônico Nacional - DJEN", {
        x: MARGIN,
        y,
        size: 10,
        font: regular,
        color: rgb(0.2, 0.42, 0.58),
      });
      y -= 24;

      for (const [label, value] of metadata) {
        const lines = wrapParagraph(
          safeForFont(`${label}: ${value}`, regular),
          regular,
          9,
          usableWidth,
        );
        for (const line of lines) {
          ensureSpace(13);
          page.drawText(line, {
            x: MARGIN,
            y,
            size: 9,
            font: regular,
            color: rgb(0.12, 0.15, 0.18),
          });
          y -= 13;
        }
      }

      ensureSpace(54);
      y -= 8;
      page.drawRectangle({
        x: MARGIN,
        y: y - 35,
        width: usableWidth,
        height: 43,
        color: rgb(0.96, 0.94, 0.86),
        borderColor: rgb(0.73, 0.63, 0.31),
        borderWidth: 0.7,
      });
      page.drawText(
        "Esta é uma reprodução do texto disponibilizado pelo DJEN.",
        { x: MARGIN + 10, y: y - 7, size: 8, font: bold },
      );
      page.drawText(
        "Não substitui documento original, certidão, assinatura ou consulta ao tribunal.",
        { x: MARGIN + 10, y: y - 22, size: 8, font: regular },
      );
      y -= 57;

      ensureSpace(28);
      page.drawText("Conteúdo da publicação", {
        x: MARGIN,
        y,
        size: 11,
        font: bold,
        color: rgb(0.07, 0.16, 0.25),
      });
      y -= 20;

      for (const paragraph of text.split("\n")) {
        const lines = wrapParagraph(
          safeForFont(paragraph, regular),
          regular,
          9.5,
          usableWidth,
        );
        for (const line of lines) {
          ensureSpace(14);
          if (line) {
            page.drawText(line, {
              x: MARGIN,
              y,
              size: 9.5,
              font: regular,
              color: rgb(0.08, 0.1, 0.12),
            });
          }
          y -= 14;
        }
        y -= 4;
      }

      pages.forEach((currentPage, index) =>
        drawFooter(currentPage, regular, index + 1, pages.length),
      );
      const bytes = await document.save({ useObjectStreams: true });
      if (bytes.byteLength > MAX_PDF_BYTES) {
        throw new PublicationCopyGenerationError();
      }
      return {
        bytes,
        mediaType: "application/pdf",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    } catch (error) {
      if (error instanceof PublicationCopyGenerationError) throw error;
      throw new PublicationCopyGenerationError();
    }
  }
}
