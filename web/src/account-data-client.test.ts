import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedWebSession } from "./auth-client";
import {
  downloadAccountExport, getAccountExport, requestAccountDeletion,
  requestAccountExport, SafeAccountDataError,
} from "./account-data-client";

const session: AuthenticatedWebSession = {
  email: "person@example.test",
  getIdToken: vi.fn().mockResolvedValue("private-token"),
};
const request = { requestId: "20000000-0000-7000-8000-000000000001", requestType: "export", state: "pending", requestedAt: "2026-08-31T12:00:00.000Z" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("account data client", () => {
  it("requests, reads and deletes through fixed same-origin endpoints", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ request }, 202))
      .mockResolvedValueOnce(json({ request }))
      .mockResolvedValueOnce(json({ request: { ...request, requestType: "deletion" } }, 202));
    await expect(requestAccountExport(fetcher, session)).resolves.toEqual(request);
    await expect(getAccountExport(fetcher, session, request.requestId)).resolves.toEqual(request);
    await expect(requestAccountDeletion(fetcher, session)).resolves.toMatchObject({ requestType: "deletion" });
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/v1/account/data-exports", { method: "POST", headers: { authorization: "Bearer private-token" } });
    expect(fetcher).toHaveBeenNthCalledWith(3, "/api/v1/account/deletion-requests", expect.objectContaining({ method: "POST", body: JSON.stringify({ confirmation: "EXCLUIR MINHA CONTA" }) }));
  });

  it("downloads the private response as a blob", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}\n", { status: 200, headers: { "content-type": "application/json" } }));
    const blob = await downloadAccountExport(fetcher, session, request.requestId);
    expect(await blob.text()).toBe("{}\n");
  });

  it.each([
    [null],
    [{}],
    [{ request: {} }],
    [{ request: { ...request, requestId: 1 } }],
    [{ request: { ...request, requestType: "other" } }],
    [{ request: { ...request, state: "other" } }],
    [{ request: { ...request, requestedAt: 1 } }],
  ])("rejects malformed successful responses", async (body) => {
    await expect(requestAccountExport(vi.fn<typeof fetch>().mockResolvedValue(json(body, 202)), session)).rejects.toBeInstanceOf(SafeAccountDataError);
  });

  it("maps structured and unstructured API failures without leaking details", async () => {
    await expect(requestAccountExport(vi.fn<typeof fetch>().mockResolvedValue(json({ code: "DENIED", message: "Operação negada." }, 403)), session)).rejects.toEqual(new SafeAccountDataError("DENIED", "Operação negada."));
    await expect(requestAccountExport(vi.fn<typeof fetch>().mockResolvedValue(json({}, 500)), session)).rejects.toEqual(new SafeAccountDataError("REQUEST_FAILED", "Não foi possível concluir a solicitação."));
    await expect(downloadAccountExport(vi.fn<typeof fetch>().mockResolvedValue(json({ code: "NOT_READY", message: "Ainda não." }, 409)), session, request.requestId)).rejects.toEqual(new SafeAccountDataError("NOT_READY", "Ainda não."));
    await expect(downloadAccountExport(vi.fn<typeof fetch>().mockResolvedValue(json({}, 500)), session, request.requestId)).rejects.toEqual(new SafeAccountDataError("DOWNLOAD_FAILED", "Não foi possível baixar a exportação."));
  });
});
