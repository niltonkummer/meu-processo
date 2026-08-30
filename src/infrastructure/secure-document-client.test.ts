import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { DocumentReference } from "../application/document-gateway.js";
import {
  DocumentChallengeAnswerInvalidError,
  DocumentChallengeExpiredError,
  DocumentChallengeRequiredError,
  DocumentIntegrityError,
  DocumentSourceRejectedError,
  DocumentSourceUnavailableError,
  SecureDocumentClient,
  isPublicIp,
  type DocumentTransport,
  type HostResolver,
} from "./secure-document-client.js";

const pdfBytes = new TextEncoder().encode("%PDF-1.7 synthetic fixture");
const pdfHash = createHash("sha256").update(pdfBytes).digest("hex");
const pngBytes = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x28,
]);

const reference = (sourceUrl: string): DocumentReference => ({
  documentId: "doc_alpha",
  caseId: "case_alpha",
  scope: { kind: "personal", userId: "user_alpha" },
  sourceId: "DJEN",
  title: "Certidão",
  fileName: "certidao.pdf",
  mediaType: "application/pdf",
  sourceUrl,
  collectedAt: "2026-08-29T12:00:00.000Z",
});

const publicResolver: HostResolver = {
  resolve: vi.fn().mockResolvedValue([{ address: "8.8.8.8", family: 4 }]),
};

const pdfTransport = (): DocumentTransport => ({
  get: vi.fn().mockResolvedValue({
    statusCode: 200,
    headers: {
      "content-type": "application/pdf; charset=binary",
      "content-length": String(pdfBytes.byteLength),
    },
    bytes: pdfBytes,
  }),
});

describe("SecureDocumentClient", () => {
  it("downloads a PDF from an exact allowed host using a pinned public address", async () => {
    const transport = pdfTransport();
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport,
      now: () => 0,
    });

    await expect(
      client.download({
        ...reference("https://documentos.tribunal.example/certidao.pdf"),
        expectedSha256: pdfHash,
      }),
    ).resolves.toEqual({
      bytes: pdfBytes,
      mediaType: "application/pdf",
      sha256: pdfHash,
    });
    expect(transport.get).toHaveBeenCalledWith(
      new URL("https://documentos.tribunal.example/certidao.pdf"),
      { address: "8.8.8.8", family: 4 },
      { maxBytes: 26_214_400, timeoutMs: 15_000 },
    );
  });

  it("accepts an allowlisted PDF served as generic binary content", async () => {
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport: {
        get: vi.fn().mockResolvedValue({
          statusCode: 200,
          headers: { "content-type": "application/octet-stream" },
          bytes: pdfBytes,
        }),
      },
    });

    await expect(
      client.download(
        reference("https://documentos.tribunal.example/certidao.pdf"),
      ),
    ).resolves.toMatchObject({ mediaType: "application/pdf", sha256: pdfHash });
  });

  it("follows one static PDF frame from an allowlisted HTML wrapper", async () => {
    const transport: DocumentTransport = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
          bytes: new TextEncoder().encode(
            '<html><iframe src="/documento.pdf?publico=1&amp;download=1"></iframe></html>',
          ),
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: { "content-type": "application/pdf" },
          bytes: pdfBytes,
        }),
    };
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport,
    });

    await expect(
      client.download(
        reference("https://documentos.tribunal.example/visualizar?id=1"),
      ),
    ).resolves.toMatchObject({ mediaType: "application/pdf", sha256: pdfHash });
    expect(transport.get).toHaveBeenNthCalledWith(
      2,
      new URL(
        "https://documentos.tribunal.example/documento.pdf?publico=1&download=1",
      ),
      { address: "8.8.8.8", family: 4 },
      expect.objectContaining({ maxBytes: 26_214_400 }),
    );
  });

  it("follows one static same-host document download link", async () => {
    const transport: DocumentTransport = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: { "content-type": "text/html" },
          bytes: new TextEncoder().encode(
            '<a href="/controlador.php?acao=download_documento&amp;id=1">Baixar</a>',
          ),
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: { "content-type": "application/pdf" },
          bytes: pdfBytes,
        }),
    };
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport,
    });

    await expect(
      client.download(
        reference("https://documentos.tribunal.example/publico?id=1"),
      ),
    ).resolves.toMatchObject({ mediaType: "application/pdf", sha256: pdfHash });
  });

  it("submits one same-host hidden POST form with an ephemeral origin cookie", async () => {
    const postForm = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { "content-type": "application/pdf" },
      bytes: pdfBytes,
    });
    const transport = {
      get: vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: { "content-type": "text/html" },
        setCookies: ["EPROC=opaque-session; Path=/; Secure; HttpOnly"],
        bytes: new TextEncoder().encode(
          '<form method="post" action="/controlador.php?acao=validar_acesso"><input type="hidden" name="token" value="a&amp;b"><input type="hidden" name="documento" value="42"><input type="text" name="origem" value="publica"><input type="image" name="imagem" src="/botao.png"><input type="reset" value="Limpar"><input type="submit" name="confirmar" value="Continuar"></form>',
        ),
      }),
      postForm,
    } as unknown as DocumentTransport;
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport,
    });

    await expect(
      client.download(
        reference("https://documentos.tribunal.example/publico?id=1"),
      ),
    ).resolves.toMatchObject({ mediaType: "application/pdf", sha256: pdfHash });
    expect(postForm).toHaveBeenCalledWith(
      new URL(
        "https://documentos.tribunal.example/controlador.php?acao=validar_acesso",
      ),
      { address: "8.8.8.8", family: 4 },
      "token=a%26b&documento=42&origem=publica&confirmar=Continuar",
      {
        cookie: "EPROC=opaque-session",
        maxBytes: 26_214_400,
        timeoutMs: expect.any(Number),
      },
    );
  });

  it("returns an isolated visual challenge and completes it once for the same publication", async () => {
    const postForm = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { "content-type": "application/pdf" },
      bytes: pdfBytes,
    });
    const transport = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: { "content-type": "text/html" },
          setCookies: ["EPROC=opaque-session; Path=/; Secure; HttpOnly"],
          bytes: new TextEncoder().encode(
            '<img id="infraCaptcha" src="/captcha.png"><form method="post" action="/controlador.php"><input type="hidden" name="token" value="private"><input type="text" name="captcha" value=""><input type="submit" name="confirmar" value="Continuar"></form>',
          ),
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: { "content-type": "image/png" },
          bytes: pngBytes,
        }),
      postForm,
    } as unknown as DocumentTransport;
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport,
      now: () => Date.parse("2026-08-30T12:00:00.000Z"),
    });
    const documentReference = reference(
      "https://documentos.tribunal.example/publico?id=1",
    );

    let challenge: DocumentChallengeRequiredError | undefined;
    try {
      await client.download(documentReference);
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentChallengeRequiredError);
      challenge = error as DocumentChallengeRequiredError;
    }
    expect(challenge).toMatchObject({
      imageDataUrl: expect.stringMatching(/^data:image\/png;base64,/u),
      expiresAt: "2026-08-30T12:02:00.000Z",
    });

    await expect(
      client.completeChallenge(documentReference, {
        challengeId: challenge!.challengeId,
        answer: "A19b",
      }),
    ).resolves.toMatchObject({ mediaType: "application/pdf", sha256: pdfHash });
    expect(postForm).toHaveBeenCalledWith(
      new URL("https://documentos.tribunal.example/controlador.php"),
      { address: "8.8.8.8", family: 4 },
      "token=private&confirmar=Continuar&captcha=A19b",
      {
        cookie: "EPROC=opaque-session",
        maxBytes: 26_214_400,
        timeoutMs: expect.any(Number),
      },
    );
    await expect(
      client.completeChallenge(documentReference, {
        challengeId: challenge!.challengeId,
        answer: "A19b",
      }),
    ).rejects.toBeInstanceOf(DocumentChallengeExpiredError);
    await expect(
      client.completeChallenge(documentReference, {
        challengeId: "invalid",
        answer: "contains spaces",
      }),
    ).rejects.toBeInstanceOf(DocumentChallengeAnswerInvalidError);
  });

  it("reports only categorical counts when a challenge image is not same-host", async () => {
    const client = new SecureDocumentClient({
      allowedHosts: [
        "documentos.tribunal.example",
        "imagens.tribunal.example",
      ],
      resolver: publicResolver,
      transport: {
        get: vi.fn().mockResolvedValue({
          statusCode: 200,
          headers: { "content-type": "text/html" },
          bytes: new TextEncoder().encode(
            '<img id="infraCaptcha" src="https://imagens.tribunal.example/captcha"><form method="post" action="/controlador.php"><input type="hidden" name="token" value="private"><input type="text" name="captcha" value=""></form>',
          ),
        }),
      },
    });

    await expect(
      client.download(
        reference("https://documentos.tribunal.example/publico?id=1"),
      ),
    ).rejects.toMatchObject({
      reason: "html_wrapper_policy",
      safeContext: {
        rejectionStage: "form_empty_text",
        captchaImageCandidateCount: 1,
        captchaImageMissingSourceCount: 0,
        captchaImageDataSourceCount: 0,
        captchaImageSameHostHttpsCount: 0,
        captchaImageAllowedCrossHostHttpsCount: 1,
        captchaImageRejectedSourceCount: 0,
      },
    });
  });

  it("accepts a bounded inline raster challenge without another network request", async () => {
    const inlineImage = `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`;
    const get = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { "content-type": "text/html" },
      bytes: new TextEncoder().encode(
        `<img id="infraCaptcha" src="${inlineImage}"><form method="post" action="/controlador.php"><input type="hidden" name="token" value="private"><input type="text" name="captcha" value=""></form>`,
      ),
    });
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport: { get },
      now: () => Date.parse("2026-08-30T12:00:00.000Z"),
    });

    await expect(
      client.download(
        reference("https://documentos.tribunal.example/publico?id=1"),
      ),
    ).rejects.toMatchObject({
      imageDataUrl: inlineImage,
      expiresAt: "2026-08-30T12:02:00.000Z",
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("prefers one adjacent rendered challenge over a marked speaker icon", async () => {
    const speakerIcon = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x18, 0x00, 0x00, 0x00, 0x18,
    ]).toString("base64");
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: { "content-type": "text/html" },
        bytes: new TextEncoder().encode(
          `<form method="post" action="/controlador.php"><input type="hidden" name="token" value="private"><div data-url="/captcha-render.png"></div><img id="infraCaptchaAudio" src="data:image/png;base64,${speakerIcon}"><input type="text" name="captcha" value=""></form>`,
        ),
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: { "content-type": "image/png" },
        bytes: pngBytes,
      });
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport: { get },
    });

    await expect(
      client.download(
        reference("https://documentos.tribunal.example/publico?id=1"),
      ),
    ).rejects.toMatchObject({
      imageDataUrl: `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`,
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("reports only media categories when a static challenge resource is not raster", async () => {
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport: {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: { "content-type": "text/html" },
            bytes: new TextEncoder().encode(
              '<form method="post" action="/controlador.php"><input type="hidden" name="token" value="private"><div data-url="/captcha-audio"></div><input type="text" name="captcha" value=""></form>',
            ),
          })
          .mockResolvedValueOnce({
            statusCode: 200,
            headers: { "content-type": "audio/mpeg" },
            bytes: new TextEncoder().encode("ID3private-audio"),
          }),
      },
    });

    await expect(
      client.download(
        reference("https://documentos.tribunal.example/publico?id=1"),
      ),
    ).rejects.toMatchObject({
      reason: "document_validation",
      safeContext: {
        challengeResourceStatusCode: 200,
        challengeResourceMediaCategory: "audio",
        challengeResourceMagicCategory: "audio",
        challengeResourceByteLength: 16,
      },
    });
  });

  it.each([
    [
      "an external action",
      '<form method="post" action="https://evil.example/collect"><input type="hidden" name="token" value="private"></form>',
      "form_action_policy",
      undefined,
    ],
    [
      "a password field",
      '<form method="post" action="/controlador.php"><input type="password" name="senha"><input type="hidden" name="token" value="private"></form>',
      "form_input_type",
      "password",
    ],
    [
      "multiple forms",
      '<form method="post" action="/one"><input type="hidden" name="a" value="1"></form><form method="post" action="/two"><input type="hidden" name="b" value="2"></form>',
      "form_count",
      undefined,
    ],
    [
      "an unknown input type",
      '<form method="post" action="/controlador.php"><input type="custom-control" name="controle" value="private"><input type="hidden" name="token" value="private"></form>',
      "form_input_type",
      "other",
    ],
    [
      "an empty text field",
      '<form method="post" action="/controlador.php"><input type="text" name="codigo" value=""><input type="hidden" name="token" value="private"></form>',
      "form_empty_text",
      undefined,
    ],
  ])(
    "rejects an HTML wrapper containing %s",
    async (_case, html, stage, rejectedInputType) => {
    const postForm = vi.fn();
    const transport = {
      get: vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: { "content-type": "text/html" },
        bytes: new TextEncoder().encode(html),
      }),
      postForm,
    } as unknown as DocumentTransport;
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport,
    });

    await expect(
      client.download(
        reference("https://documentos.tribunal.example/publico?id=1"),
      ),
      ).rejects.toMatchObject({
        reason: "html_wrapper_policy",
        safeContext: {
          rejectionStage: stage,
          ...(rejectedInputType ? { rejectedInputType } : {}),
        },
      });
    expect(postForm).not.toHaveBeenCalled();
    },
  );

  it("reports only structural HTML telemetry when a wrapper cannot be resolved", async () => {
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport: {
        get: vi.fn().mockResolvedValue({
          statusCode: 200,
          headers: {
            "content-type": "text/html",
            "set-cookie": "session=private-value; Secure; HttpOnly",
          },
          bytes: new TextEncoder().encode(
            '<html><script>document.forms[0].submit()</script><p>Digite o código de segurança</p><img id="infraCaptcha" src="/captcha"><form method="post" action="/controlador.php"><input type="hidden" name="token" value="private"><input type="hidden" name="id" value="1"></form><a href="/inicio">Início</a></html>',
          ),
        }),
      },
    });

    await expect(
      client.download(
        reference("https://documentos.tribunal.example/publico?id=1"),
      ),
    ).rejects.toMatchObject({
      reason: "html_wrapper_policy",
      safeContext: {
        formCount: 1,
        postFormCount: 1,
        hiddenInputCount: 2,
        scriptCount: 1,
        anchorCount: 1,
        sameHostFormActionCount: 1,
        setsCookie: true,
        documentImplementationHintCount: 0,
        printDocumentHintCount: 0,
        ajaxHintCount: 0,
        humanChallengeTextHintCount: 3,
        challengeFieldHintCount: 1,
        captchaImageHintCount: 1,
      },
    });
  });

  it.each([
    "http://documentos.tribunal.example/doc.pdf",
    "https://documentos.tribunal.example:8443/doc.pdf",
    "https://user:password@documentos.tribunal.example/doc.pdf",
    "https://evil.example/doc.pdf",
  ])("rejects an unsafe source URL before DNS and network access: %s", async (sourceUrl) => {
    const resolver: HostResolver = { resolve: vi.fn() };
    const transport: DocumentTransport = { get: vi.fn() };
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver,
      transport,
    });

    await expect(client.download(reference(sourceUrl))).rejects.toBeInstanceOf(
      DocumentSourceRejectedError,
    );
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(transport.get).not.toHaveBeenCalled();
  });

  it("rejects a host when any resolved address is non-public", async () => {
    const resolver: HostResolver = {
      resolve: vi.fn().mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    };
    const transport: DocumentTransport = { get: vi.fn() };
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver,
      transport,
    });

    await expect(
      client.download(reference("https://documentos.tribunal.example/doc.pdf")),
    ).rejects.toBeInstanceOf(DocumentSourceRejectedError);
    expect(transport.get).not.toHaveBeenCalled();
  });

  it("revalidates every redirect and enforces the redirect limit", async () => {
    const transport: DocumentTransport = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          statusCode: 302,
          headers: { location: "https://arquivos.tribunal.example/final.pdf" },
          bytes: new Uint8Array(),
        })
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: { "content-type": "application/pdf" },
          bytes: pdfBytes,
        }),
    };
    const client = new SecureDocumentClient({
      allowedHosts: [
        "documentos.tribunal.example",
        "arquivos.tribunal.example",
      ],
      resolver: publicResolver,
      transport,
      maxRedirects: 1,
    });

    await expect(
      client.download(reference("https://documentos.tribunal.example/doc.pdf")),
    ).resolves.toMatchObject({ sha256: pdfHash });

    const loopingTransport: DocumentTransport = {
      get: vi.fn().mockResolvedValue({
        statusCode: 302,
        headers: { location: "/again.pdf" },
        bytes: new Uint8Array(),
      }),
    };
    const limitedClient = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport: loopingTransport,
      maxRedirects: 1,
    });
    await expect(
      limitedClient.download(reference("https://documentos.tribunal.example/doc.pdf")),
    ).rejects.toBeInstanceOf(DocumentSourceRejectedError);
  });

  it("rejects unexpected media type, size and hash", async () => {
    const responses = [
      {
        statusCode: 200,
        headers: { "content-type": "text/html" },
        bytes: pdfBytes,
      },
      {
        statusCode: 200,
        headers: {
          "content-type": "application/pdf",
          "content-length": "100",
        },
        bytes: pdfBytes,
      },
      {
        statusCode: 200,
        headers: { "content-type": "application/pdf" },
        bytes: pdfBytes,
      },
    ];
    const transport: DocumentTransport = {
      get: vi.fn().mockImplementation(() => Promise.resolve(responses.shift())),
    };
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport,
      maxBytes: 50,
    });
    const safeReference = reference("https://documentos.tribunal.example/doc.pdf");

    await expect(client.download(safeReference)).rejects.toBeInstanceOf(
      DocumentSourceRejectedError,
    );
    await expect(client.download(safeReference)).rejects.toBeInstanceOf(
      DocumentSourceRejectedError,
    );
    await expect(
      client.download({ ...safeReference, expectedSha256: "wrong-hash" }),
    ).rejects.toBeInstanceOf(DocumentIntegrityError);
  });

  it("caps concurrent buffered downloads", async () => {
    let release: ((value: {
      statusCode: number;
      headers: { "content-type": string };
      bytes: Uint8Array;
    }) => void) | undefined;
    const transport: DocumentTransport = {
      get: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    };
    const client = new SecureDocumentClient({
      allowedHosts: ["documentos.tribunal.example"],
      resolver: publicResolver,
      transport,
      maxConcurrentDownloads: 1,
    });
    const safeReference = reference("https://documentos.tribunal.example/doc.pdf");

    const firstDownload = client.download(safeReference);
    await vi.waitFor(() => expect(transport.get).toHaveBeenCalledTimes(1));
    await expect(client.download(safeReference)).rejects.toBeInstanceOf(
      DocumentSourceUnavailableError,
    );
    release?.({
      statusCode: 200,
      headers: { "content-type": "application/pdf" },
      bytes: pdfBytes,
    });
    await expect(firstDownload).resolves.toMatchObject({ sha256: pdfHash });
  });
});

describe("public IP validation", () => {
  it.each([
    ["8.8.8.8", true],
    ["127.0.0.1", false],
    ["10.0.0.1", false],
    ["169.254.169.254", false],
    ["192.168.1.1", false],
    ["::1", false],
    ["fc00::1", false],
    ["fe80::1", false],
    ["2606:4700:4700::1111", true],
    ["not-an-ip", false],
  ])("classifies %s", (address, expected) => {
    expect(isPublicIp(address)).toBe(expected);
  });
});
