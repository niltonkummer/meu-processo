import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedWebSession } from "./auth-client";
import { BillingPanel } from "./BillingPanel";

const session: AuthenticatedWebSession = {
  email: "person@example.test",
  getIdToken: vi.fn().mockResolvedValue("private-token"),
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

describe("billing panel", () => {
  it("loads the free plan and opens the test Checkout", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({
        plan: "free", status: "free", entitled: false,
        currentPeriodEnd: null, cancelAtPeriodEnd: false,
      }))
      .mockResolvedValueOnce(json({
        url: "https://checkout.stripe.com/c/pay/test-safe",
        expiresAt: "2026-08-31T15:30:00.000Z",
      }, 201));
    const openPage = vi.fn();
    render(<BillingPanel
      fetcher={fetcher} session={session}
      createId={() => "10000000-0000-7000-8000-000000000703"}
      openPage={openPage}
    />);
    const action = await screen.findByRole("button", { name: "Conhecer o Plano Pessoa" });
    fireEvent.click(action);
    await waitFor(() => expect(openPage).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/pay/test-safe",
    ));
  });

  it("opens the portal for a paid plan and shows safe load failures", async () => {
    const paidFetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({
        plan: "person", status: "active", entitled: true,
        currentPeriodEnd: "2026-09-30T00:00:00.000Z", cancelAtPeriodEnd: false,
      }))
      .mockResolvedValueOnce(json({ url: "https://billing.stripe.com/p/session/test-safe" }, 201));
    const openPage = vi.fn();
    const { unmount } = render(<BillingPanel fetcher={paidFetcher} session={session} openPage={openPage} />);
    fireEvent.click(await screen.findByRole("button", { name: "Gerenciar assinatura" }));
    await waitFor(() => expect(openPage).toHaveBeenCalled());
    unmount();

    render(<BillingPanel
      fetcher={vi.fn<typeof fetch>().mockResolvedValue(json({ message: "Temporariamente indisponível." }, 503))}
      session={session}
    />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Temporariamente indisponível.");
  });

  it("does not describe an expired subscription as active", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({
        plan: "person", status: "canceled", entitled: false,
        currentPeriodEnd: "2026-08-01T00:00:00.000Z", cancelAtPeriodEnd: false,
      }))
      .mockResolvedValueOnce(json({
        url: "https://checkout.stripe.com/c/pay/test-renew",
        expiresAt: "2026-08-31T15:30:00.000Z",
      }, 201));
    const openPage = vi.fn();
    render(<BillingPanel
      fetcher={fetcher} session={session}
      createId={() => "10000000-0000-7000-8000-000000000704"}
      openPage={openPage}
    />);

    expect(await screen.findByRole("heading", { name: "Plano Pessoa inativo" })).toBeVisible();
    const action = screen.getByRole("button", { name: "Assinar novamente" });
    fireEvent.click(action);
    await waitFor(() => expect(openPage).toHaveBeenCalledWith(
      "https://checkout.stripe.com/c/pay/test-renew",
    ));
  });
});
