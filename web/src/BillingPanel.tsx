import { useEffect, useState } from "react";

import type { AuthenticatedWebSession } from "./auth-client";
import {
  createBillingCheckout,
  createBillingPortal,
  getBillingSubscription,
  type BillingSubscription,
} from "./billing-client";

const openHostedPage = (url: string) => window.location.assign(url);

export function BillingPanel({
  fetcher,
  session,
  createId = () => crypto.randomUUID(),
  openPage = openHostedPage,
}: {
  fetcher: typeof fetch;
  session: AuthenticatedWebSession;
  createId?: () => string;
  openPage?: (url: string) => void;
}) {
  const [subscription, setSubscription] = useState<BillingSubscription>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    void getBillingSubscription(fetcher, session)
      .then((value) => { if (current) setSubscription(value); })
      .catch((caught: unknown) => {
        if (current) setError(caught instanceof Error ? caught.message : "Não foi possível carregar a assinatura.");
      });
    return () => { current = false; };
  }, [fetcher, session]);

  const run = async (operation: "checkout" | "portal") => {
    setBusy(operation); setError("");
    try {
      openPage(operation === "checkout"
        ? await createBillingCheckout(fetcher, session, createId())
        : await createBillingPortal(fetcher, session));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível abrir a assinatura.");
      setBusy("");
    }
  };

  const subscribed = subscription?.plan === "person";
  const paid = subscribed && subscription.entitled;
  const title = paid
    ? "Plano Pessoa ativo"
    : subscribed
      ? "Plano Pessoa inativo"
      : "Comece no essencial. Evolua quando fizer sentido.";
  return (
    <section className="billing-panel" aria-labelledby="billing-title">
      <div className="billing-stripe" aria-hidden="true" />
      <div className="billing-copy">
        <span className="eyebrow">Plano e continuidade</span>
        <h2 id="billing-title">{title}</h2>
        <p>
          A consulta permanece transparente: fonte, cobertura e limitações são mostradas antes de qualquer decisão.
          A gestão do pagamento acontece na página segura da Stripe.
        </p>
        <span className="billing-validation-chip">Ambiente de validação · sem cobrança real</span>
      </div>
      <div className="billing-action-card">
        <span className="billing-plan-label">{paid ? "Sua assinatura" : "Plano Pessoa"}</span>
        <strong>{subscription ? (paid ? "Ativo" : subscribed ? "Inativo" : "Gratuito") : "Consultando…"}</strong>
        <ul>
          <li>Monitoramento pessoal organizado</li>
          <li>Documentos e histórico em um só lugar</li>
          <li>Cancelamento e dados sob seu controle</li>
        </ul>
        {error ? <p className="billing-error" role="alert">{error}</p> : null}
        <button
          type="button"
          disabled={!subscription || Boolean(busy)}
          onClick={() => void run(paid ? "portal" : "checkout")}
        >
          {busy
            ? "Abrindo ambiente seguro…"
            : paid
              ? "Gerenciar assinatura"
              : subscribed
                ? "Assinar novamente"
                : "Conhecer o Plano Pessoa"}
        </button>
        <small>Nenhum acesso é liberado pelo retorno do navegador; somente pelo evento assinado do provedor.</small>
      </div>
    </section>
  );
}
