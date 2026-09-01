import { type FormEvent, useState } from "react";
import type { AuthenticatedWebSession } from "./auth-client";
import {
  downloadAccountExport, getAccountExport, requestAccountDeletion,
  requestAccountExport, type AccountDataRequest,
} from "./account-data-client";

const stateLabel: Record<AccountDataRequest["state"], string> = {
  pending: "Na fila", running: "Preparando", completed: "Pronta",
  failed: "Não concluída", expired: "Expirada",
};

export function AccountDataControls({
  fetcher, session, saveFile,
}: {
  fetcher: typeof fetch;
  session: AuthenticatedWebSession;
  saveFile: (blob: Blob, fileName: string) => void;
}) {
  const [request, setRequest] = useState<AccountDataRequest>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");

  const run = async (operation: string, work: () => Promise<void>) => {
    setBusy(operation); setError("");
    try { await work(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível concluir a operação."); }
    finally { setBusy(""); }
  };

  const deleteAccount = (event: FormEvent) => {
    event.preventDefault();
    void run("delete", async () => {
      if (confirmation !== "EXCLUIR MINHA CONTA" || !session.reauthenticate) {
        throw new Error("Digite a frase exata e confirme sua senha.");
      }
      const currentPassword = password;
      setPassword("");
      await session.reauthenticate(currentPassword);
      await requestAccountDeletion(fetcher, session);
      await session.terminate?.();
    });
  };

  return (
    <section className="data-controls" aria-labelledby="data-controls-title">
      <div className="data-controls-heading">
        <div><span className="eyebrow">Privacidade e portabilidade</span><h2 id="data-controls-title">Seus dados, sob seu controle</h2></div>
        <p>Prepare uma cópia estruturada da sua conta ou solicite sua exclusão definitiva.</p>
      </div>
      {error ? <p className="account-error" role="alert">{error}</p> : null}
      <div className="data-control-grid">
        <article>
          <span className="data-control-index">01</span><h3>Exportar meus dados</h3>
          <p>O pedido entra em uma fila segura. Você pode atualizar o estado sem criar outro pedido.</p>
          {request ? <div className="export-status" aria-live="polite"><strong>{stateLabel[request.state]}</strong><span>Solicitada em {new Date(request.requestedAt).toLocaleString("pt-BR")}</span></div> : null}
          <div className="data-control-actions">
            <button type="button" disabled={Boolean(busy)} onClick={() => void run("export", async () => setRequest(await requestAccountExport(fetcher, session)))}>{request ? "Solicitar novamente" : "Preparar exportação"}</button>
            {request ? <button type="button" className="button-secondary" disabled={Boolean(busy)} onClick={() => void run("refresh", async () => setRequest(await getAccountExport(fetcher, session, request.requestId)))}>Atualizar estado</button> : null}
            {request?.downloadReady ? <button type="button" className="button-secondary" disabled={Boolean(busy)} onClick={() => void run("download", async () => saveFile(await downloadAccountExport(fetcher, session, request.requestId), `meu-processo-exportacao-${request.requestId}.json`))}>Baixar JSON</button> : null}
          </div>
        </article>
        <article className="danger-zone">
          <span className="data-control-index">02</span><h3>Excluir minha conta</h3>
          <p>Interrompe monitoramentos e remove os dados privados. Esta ação não pode ser desfeita.</p>
          {!dangerOpen ? <button type="button" className="danger-button" onClick={() => setDangerOpen(true)}>Revisar exclusão</button> : (
            <form onSubmit={deleteAccount}>
              <label htmlFor="delete-confirmation">Digite EXCLUIR MINHA CONTA</label>
              <input id="delete-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required />
              <label htmlFor="delete-password">Confirme sua senha</label>
              <input id="delete-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
              <div className="data-control-actions"><button className="danger-button" type="submit" disabled={busy === "delete" || confirmation !== "EXCLUIR MINHA CONTA"}>Excluir definitivamente</button><button type="button" className="button-secondary" onClick={() => { setDangerOpen(false); setPassword(""); setConfirmation(""); }}>Cancelar</button></div>
            </form>
          )}
        </article>
      </div>
    </section>
  );
}
