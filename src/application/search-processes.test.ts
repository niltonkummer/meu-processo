import { describe, expect, it, vi } from "vitest";

import {
  compareOptionalDatesDescending,
  searchProcesses,
} from "./search-processes.js";
import type { DjenClient, DjenPublication } from "./types.js";

const publication = (
  overrides: Partial<DjenPublication> = {},
): DjenPublication => ({
  id: 1,
  numeroProcesso: "0000001-23.2026.8.99.0001",
  tribunal: "TJEX",
  dataDisponibilizacao: "2026-08-20",
  orgao: "1ª Vara de Exemplo",
  classe: "Procedimento de Exemplo",
  tipoComunicacao: "Intimação",
  meio: "Diário de Justiça Eletrônico Nacional",
  tipoDocumento: "Despacho",
  numeroComunicacao: 98765,
  texto: "<p>Publicação de teste.</p>",
  link: "https://example.test/publicacao/1",
  ...overrides,
});

describe("searchProcesses", () => {
  it("orders present dates before absent dates in both comparison directions", () => {
    expect(compareOptionalDatesDescending(undefined, "2026-08-22")).toBeGreaterThan(
      0,
    );
    expect(compareOptionalDatesDescending("2026-08-22", undefined)).toBeLessThan(0);
  });

  it("groups only by normalized CNJ number and keeps provenance", async () => {
    const client: DjenClient = {
      search: vi.fn().mockResolvedValue({
        total: 4,
        truncated: false,
        publications: [
          publication(),
          publication({
            id: 2,
            numeroProcesso: "00000012320268990001",
            dataDisponibilizacao: "2026-08-22",
            texto: "&amp;lt;strong&amp;gt;Decis&#227;o&nbsp;recente&amp;lt;/strong&amp;gt;&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;",
          }),
          publication({
            id: 3,
            numeroProcesso: "0000002-23.2026.8.99.0001",
            dataDisponibilizacao: "2026-08-21",
            link: "javascript:alert(1)",
          }),
          publication({ id: 4, numeroProcesso: undefined }),
        ],
      }),
    };

    const result = await searchProcesses(
      { type: "name", value: "Pessoa Exemplo da Silva" },
      client,
    );

    expect(client.search).toHaveBeenCalledOnce();
    expect(client.search).toHaveBeenCalledWith({
      field: "nomeParte",
      value: "Pessoa Exemplo da Silva",
    });
    expect(result.summary).toEqual({
      publications: 4,
      processes: 2,
      ungroupedPublications: 1,
      truncated: false,
    });
    expect(result.processes.map((process) => process.cnjNumber)).toEqual([
      "0000001-23.2026.8.99.0001",
      "0000002-23.2026.8.99.0001",
    ]);
    expect(result.processes[0]).toMatchObject({
      publicationCount: 2,
      lastPublicationAt: "2026-08-22",
      tribunal: "TJEX",
    });
    expect(result.processes[0]?.publications[0]).toMatchObject({
      id: "2",
      summary: "Decisão recente",
      communicationType: "Intimação",
      medium: "Diário de Justiça Eletrônico Nacional",
      documentType: "Despacho",
      communicationNumber: 98765,
      documentAvailable: true,
    });
    expect(result.processes[1]?.publications[0]).not.toHaveProperty(
      "documentAvailable",
    );
    expect(JSON.stringify(result)).not.toContain("https://");
  });

  it("deduplicates the two experimental CPF queries", async () => {
    const search = vi
      .fn<DjenClient["search"]>()
      .mockResolvedValueOnce({
        total: 1,
        truncated: false,
        publications: [publication()],
      })
      .mockResolvedValueOnce({
        total: 2,
        truncated: true,
        publications: [publication(), publication({ id: 5 })],
      });

    const result = await searchProcesses(
      { type: "cpf", value: "123.456.789-09" },
      { search },
    );

    expect(search).toHaveBeenCalledTimes(2);
    expect(result.summary).toEqual({
      publications: 2,
      processes: 1,
      ungroupedPublications: 0,
      truncated: true,
    });
    expect(result.warnings).toContainEqual(
      expect.stringContaining("não oferece filtro próprio por CPF"),
    );
    expect(result.target).not.toHaveProperty("normalizedValue");
    expect(result.target.displayValue).toBe("***.***.***-09");
  });

  it("uses a deterministic fallback key when the source has no id", async () => {
    const item = publication({ id: undefined });
    const client: DjenClient = {
      search: vi.fn().mockResolvedValue({
        total: 2,
        truncated: false,
        publications: [item, { ...item }],
      }),
    };

    const result = await searchProcesses(
      { type: "cnpj", value: "11.222.333/0001-81" },
      client,
    );

    expect(result.summary.publications).toBe(1);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("não oferece filtro próprio por CNPJ"),
    );
  });

  it("does not expose document actions for missing or malformed source URLs", async () => {
    const client: DjenClient = {
      search: vi.fn().mockResolvedValue({
        total: 2,
        truncated: false,
        publications: [
          publication({ id: 20, link: undefined }),
          publication({ id: 21, link: "not a URL" }),
        ],
      }),
    };

    const result = await searchProcesses(
      { type: "name", value: "Pessoa Exemplo da Silva" },
      client,
    );

    expect(result.processes[0]?.publications).toHaveLength(2);
    for (const item of result.processes[0]?.publications ?? []) {
      expect(item).not.toHaveProperty("documentAvailable");
    }
  });

  it("does not invent optional fields missing from the official source", async () => {
    const client: DjenClient = {
      search: vi.fn().mockResolvedValue({
        total: 3,
        truncated: false,
        publications: [
          publication({
            id: 8,
            numeroProcesso: "0000003-23.2026.8.99.0001",
            dataDisponibilizacao: undefined,
            tribunal: undefined,
            orgao: undefined,
            classe: undefined,
            tipoComunicacao: undefined,
            meio: undefined,
            tipoDocumento: undefined,
            numeroComunicacao: undefined,
            texto: undefined,
            link: "not a url",
          }),
          publication({
            id: 7,
            tribunal: undefined,
            orgao: undefined,
            classe: undefined,
            tipoComunicacao: undefined,
            meio: undefined,
            tipoDocumento: undefined,
            numeroComunicacao: undefined,
            link: undefined,
          }),
          publication({
            id: 6,
            dataDisponibilizacao: undefined,
            tribunal: undefined,
            orgao: undefined,
            classe: undefined,
            tipoComunicacao: undefined,
            meio: undefined,
            tipoDocumento: undefined,
            numeroComunicacao: undefined,
            texto: undefined,
            link: undefined,
          }),
        ],
      }),
    };

    const result = await searchProcesses(
      { type: "name", value: "Pessoa Exemplo da Silva" },
      client,
    );

    expect(result.processes).toHaveLength(2);
    expect(result.processes[1]).toEqual({
      cnjNumber: "0000003-23.2026.8.99.0001",
      publicationCount: 1,
      publications: [{ id: "8", summary: "" }],
    });
  });
});
