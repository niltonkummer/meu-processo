import { type FormEvent, useState } from "react";

import {
  SafeAuthenticationError,
  type AuthClient,
  type AuthenticatedWebSession,
  type AuthUser,
  type VerificationDelivery,
} from "./auth-client";

type AccessMode = "sign-in" | "sign-up";

const genericUnavailable = "A autenticação não está disponível neste ambiente.";

const safeMessage = (error: unknown, fallback: string) =>
  error instanceof SafeAuthenticationError ? error.message : fallback;

const isValidSessionResponse = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const user = (value as Record<string, unknown>).user;
  if (typeof user !== "object" || user === null) return false;
  const record = user as Record<string, unknown>;
  return typeof record.userId === "string" && Array.isArray(record.memberships);
};

export function AccountAccess({
  loadClient,
  fetcher,
  onSessionChange = () => undefined,
}: {
  loadClient: () => Promise<AuthClient>;
  fetcher: typeof fetch;
  onSessionChange?: (session: AuthenticatedWebSession | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<AuthClient>();
  const [mode, setMode] = useState<AccessMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pendingVerification, setPendingVerification] = useState<AuthUser>();
  const [localVerificationLink, setLocalVerificationLink] = useState("");
  const [signedInEmail, setSignedInEmail] = useState("");

  const showVerificationDelivery = (delivery?: VerificationDelivery) => {
    if (delivery?.kind === "email") {
      setLocalVerificationLink("");
      setStatus(
        "Enviamos uma confirmação para seu e-mail. Abra a mensagem antes de entrar.",
      );
      return;
    }
    if (delivery?.kind === "emulator") {
      setLocalVerificationLink(delivery.actionUrl ?? "");
      setStatus(
        delivery.actionUrl
          ? "O emulador local não envia e-mail. Use o link de teste abaixo para confirmar."
          : "O emulador local não envia e-mail. Consulte o link de confirmação nos logs locais.",
      );
      return;
    }
    setLocalVerificationLink("");
    setStatus("Confirme seu e-mail para liberar o painel privado.");
  };

  const openPanel = async () => {
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      setClient(await loadClient());
    } catch {
      setError(genericUnavailable);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client) return;

    setBusy(true);
    setError("");
    setStatus("");
    setLocalVerificationLink("");
    try {
      const user =
        mode === "sign-up"
          ? await client.signUp(email, password)
          : await client.signIn(email, password);

      if (mode === "sign-up" || !user.emailVerified) {
        setPendingVerification(user);
        setPassword("");
        showVerificationDelivery(user.verificationDelivery);
        return;
      }

      const token = await user.getIdToken();
      const response = await fetcher("/api/v1/session", {
        headers: { authorization: `Bearer ${token}` },
      });
      const body: unknown = await response.json();
      if (!response.ok || !isValidSessionResponse(body)) {
        throw new SafeAuthenticationError(
          "Não foi possível validar sua sessão com segurança.",
        );
      }

      setSignedInEmail(user.email);
      onSessionChange({
        email: user.email,
        getIdToken: () => user.getIdToken(),
      });
      setPassword("");
      setOpen(false);
    } catch (caught) {
      setError(
        safeMessage(caught, "Não foi possível concluir a autenticação."),
      );
    } finally {
      setBusy(false);
    }
  };

  const resendVerification = async () => {
    if (!pendingVerification) return;
    setBusy(true);
    setError("");
    try {
      const delivery = await pendingVerification.sendVerification();
      showVerificationDelivery(delivery);
    } catch (caught) {
      setError(
        safeMessage(caught, "Não foi possível reenviar a confirmação."),
      );
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    if (!client) return;
    onSessionChange(undefined);
    setSignedInEmail("");
    setPendingVerification(undefined);
    setLocalVerificationLink("");
    setEmail("");
    setPassword("");
    setStatus("");
    setError("");
    try {
      await client.signOut();
    } catch {
      // The UI must fail closed even if the remote provider is unavailable.
    }
  };

  if (signedInEmail) {
    return (
      <div className="account-summary">
        <span>{signedInEmail}</span>
        <button type="button" onClick={() => void logout()}>Sair</button>
      </div>
    );
  }

  return (
    <div className="account-access">
      <button
        className="account-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => void openPanel()}
      >
        Entrar
      </button>

      {open ? (
        <section className="account-panel" aria-labelledby="account-title">
          <div className="account-panel-heading">
            <div>
              <span>Acesso privado</span>
              <h2 id="account-title">
                {mode === "sign-in" ? "Sua conta" : "Criar conta"}
              </h2>
            </div>
            <button
              className="account-close"
              type="button"
              aria-label="Fechar acesso à conta"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          {error ? <p className="account-error" role="alert">{error}</p> : null}
          {status ? <p className="account-status" role="status">{status}</p> : null}
          {localVerificationLink ? (
            <a
              className="account-verification-link"
              href={localVerificationLink}
              target="_blank"
              rel="noreferrer"
            >
              Confirmar e-mail de teste
            </a>
          ) : null}

          {client && !pendingVerification ? (
            <form onSubmit={(event) => void submit(event)}>
              <label htmlFor="account-email">E-mail</label>
              <input
                id="account-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
              <label htmlFor="account-password">Senha</label>
              <input
                id="account-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                minLength={12}
                required
              />
              <button className="account-primary" type="submit" disabled={busy}>
                {mode === "sign-in" ? "Acessar minha conta" : "Criar minha conta"}
              </button>
              <button
                className="account-secondary"
                type="button"
                onClick={() => {
                  setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                  setError("");
                  setStatus("");
                  setLocalVerificationLink("");
                }}
              >
                {mode === "sign-in" ? "Criar conta" : "Já tenho conta"}
              </button>
            </form>
          ) : null}

          {pendingVerification ? (
            <button
              className="account-primary"
              type="button"
              disabled={busy}
              onClick={() => void resendVerification()}
            >
              Reenviar confirmação
            </button>
          ) : null}

          {busy && !client ? (
            <p className="account-loading" role="status">Preparando acesso seguro…</p>
          ) : null}
          <p className="account-footnote">
            Sua sessão fica somente na memória deste navegador.
          </p>
        </section>
      ) : null}
    </div>
  );
}
