import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedWebSession } from "./auth-client";
import { AccountDataControls } from "./AccountDataControls";

afterEach(cleanup);
const requestId = "20000000-0000-7000-8000-000000000001";
const response = (state: string, downloadReady = false) => new Response(JSON.stringify({ request: { requestId, requestType: "export", state, requestedAt: "2026-08-31T12:00:00.000Z", downloadReady } }), { status: state === "pending" ? 202 : 200, headers: { "content-type": "application/json" } });

describe("AccountDataControls", () => {
  it("requests, refreshes and downloads an export without browser persistence", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response("pending"))
      .mockResolvedValueOnce(response("completed", true))
      .mockResolvedValueOnce(new Response("{}\n", { status: 200, headers: { "content-type": "application/json" } }));
    const saveFile = vi.fn();
    const session: AuthenticatedWebSession = { email: "person@example.test", getIdToken: vi.fn().mockResolvedValue("token") };
    render(<AccountDataControls fetcher={fetcher} session={session} saveFile={saveFile} />);

    await user.click(screen.getByRole("button", { name: "Preparar exportação" }));
    expect(await screen.findByText("Na fila")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Atualizar estado" }));
    expect(await screen.findByText("Pronta")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Baixar JSON" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), `meu-processo-exportacao-${requestId}.json`));
  });

  it("reauthenticates, clears the password and terminates after accepted deletion", async () => {
    const user = userEvent.setup();
    const reauthenticate = vi.fn().mockResolvedValue(undefined);
    const terminate = vi.fn().mockResolvedValue(undefined);
    const session: AuthenticatedWebSession = { email: "person@example.test", getIdToken: vi.fn().mockResolvedValue("new-token"), reauthenticate, terminate };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ request: { requestId, requestType: "deletion", state: "pending", requestedAt: "2026-08-31T12:00:00.000Z" } }), { status: 202, headers: { "content-type": "application/json" } }));
    render(<AccountDataControls fetcher={fetcher} session={session} saveFile={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Revisar exclusão" }));
    await user.type(screen.getByLabelText("Digite EXCLUIR MINHA CONTA"), "EXCLUIR MINHA CONTA");
    await user.type(screen.getByLabelText("Confirme sua senha"), "senha-local-segura");
    await user.click(screen.getByRole("button", { name: "Excluir definitivamente" }));
    await waitFor(() => expect(terminate).toHaveBeenCalledOnce());
    expect(reauthenticate).toHaveBeenCalledWith("senha-local-segura");
    expect(screen.getByLabelText("Confirme sua senha")).toHaveValue("");
  });
});
