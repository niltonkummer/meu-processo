import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AuthClient,
  AuthenticatedWebSession,
  AuthUser,
} from "./auth-client";
import { AccountAccess } from "./AccountAccess";

afterEach(cleanup);

const verifiedUser: AuthUser = {
  email: "pessoa@example.test",
  emailVerified: true,
  getIdToken: vi.fn().mockResolvedValue("firebase-id-token"),
  sendVerification: vi.fn().mockResolvedValue({ kind: "email" }),
};

const createClient = (user: AuthUser = verifiedUser): AuthClient => ({
  signIn: vi.fn().mockResolvedValue(user),
  signUp: vi.fn().mockResolvedValue(user),
  signOut: vi.fn().mockResolvedValue(undefined),
});

describe("AccountAccess", () => {
  it("validates a verified login with the backend and clears it on logout", async () => {
    const user = userEvent.setup();
    const client = createClient();
    const onSessionChange = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { userId: "firebase_user", memberships: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    render(
      <AccountAccess
        loadClient={vi.fn().mockResolvedValue(client)}
        fetcher={fetcher}
        onSessionChange={onSessionChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Entrar" }));
    await user.type(screen.getByLabelText("E-mail"), "pessoa@example.test");
    await user.type(screen.getByLabelText("Senha"), "uma-senha-segura");
    await user.click(screen.getByRole("button", { name: "Acessar minha conta" }));

    expect(client.signIn).toHaveBeenCalledWith(
      "pessoa@example.test",
      "uma-senha-segura",
    );
    expect(fetcher).toHaveBeenCalledWith("/api/v1/session", {
      headers: { authorization: "Bearer firebase-id-token" },
    });
    expect(await screen.findByText("pessoa@example.test")).toBeVisible();
    expect(onSessionChange).toHaveBeenLastCalledWith({
      email: "pessoa@example.test",
      getIdToken: expect.any(Function),
    });
    const session = onSessionChange.mock.lastCall?.[0] as AuthenticatedWebSession;
    await expect(session.getIdToken()).resolves.toBe("firebase-id-token");

    await user.click(screen.getByRole("button", { name: "Sair" }));
    expect(client.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
    expect(onSessionChange).toHaveBeenLastCalledWith(undefined);
  });

  it("clears the local session even when the provider logout fails", async () => {
    const user = userEvent.setup();
    const client = createClient();
    client.signOut = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { userId: "firebase_user", memberships: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    render(
      <AccountAccess
        loadClient={vi.fn().mockResolvedValue(client)}
        fetcher={fetcher}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Entrar" }));
    await user.type(screen.getByLabelText("E-mail"), "pessoa@example.test");
    await user.type(screen.getByLabelText("Senha"), "uma-senha-segura");
    await user.click(screen.getByRole("button", { name: "Acessar minha conta" }));
    expect(await screen.findByText("pessoa@example.test")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Sair" }));

    expect(client.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeVisible();
  });

  it("creates an account, requests verification and does not call the private API", async () => {
    const user = userEvent.setup();
    const unverified: AuthUser = {
      ...verifiedUser,
      emailVerified: false,
      verificationDelivery: { kind: "email" },
    };
    const client = createClient(unverified);
    const fetcher = vi.fn<typeof fetch>();
    render(
      <AccountAccess
        loadClient={vi.fn().mockResolvedValue(client)}
        fetcher={fetcher}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Entrar" }));
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    await user.type(screen.getByLabelText("E-mail"), "nova@example.test");
    await user.type(screen.getByLabelText("Senha"), "senha-com-12-caracteres");
    await user.click(screen.getByRole("button", { name: "Criar minha conta" }));

    expect(client.signUp).toHaveBeenCalledWith(
      "nova@example.test",
      "senha-com-12-caracteres",
    );
    expect(await screen.findByText(/enviamos uma confirmação/i)).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shows the safe local verification link instead of claiming an email was sent", async () => {
    const user = userEvent.setup();
    const client = createClient({
      ...verifiedUser,
      emailVerified: false,
      verificationDelivery: {
        kind: "emulator",
        actionUrl:
          "http://127.0.0.1:9099/emulator/action?mode=verifyEmail&oobCode=local",
      },
    });
    render(
      <AccountAccess
        loadClient={vi.fn().mockResolvedValue(client)}
        fetcher={vi.fn<typeof fetch>()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Entrar" }));
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    await user.type(screen.getByLabelText("E-mail"), "local@example.test");
    await user.type(screen.getByLabelText("Senha"), "senha-com-12-caracteres");
    await user.click(screen.getByRole("button", { name: "Criar minha conta" }));

    expect(await screen.findByText(/emulador local não envia e-mail/i)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Confirmar e-mail de teste" }),
    ).toHaveAttribute(
      "href",
      "http://127.0.0.1:9099/emulator/action?mode=verifyEmail&oobCode=local",
    );
  });

  it("blocks an unverified login and allows resending verification", async () => {
    const user = userEvent.setup();
    const sendVerification = vi.fn().mockResolvedValue({ kind: "email" });
    const client = createClient({
      ...verifiedUser,
      emailVerified: false,
      sendVerification,
    });
    const fetcher = vi.fn<typeof fetch>();
    render(
      <AccountAccess
        loadClient={vi.fn().mockResolvedValue(client)}
        fetcher={fetcher}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Entrar" }));
    await user.type(screen.getByLabelText("E-mail"), "pessoa@example.test");
    await user.type(screen.getByLabelText("Senha"), "uma-senha-segura");
    await user.click(screen.getByRole("button", { name: "Acessar minha conta" }));
    await user.click(
      await screen.findByRole("button", { name: "Reenviar confirmação" }),
    );

    expect(sendVerification).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Enviamos uma confirmação");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("shows a safe error when configuration or backend validation fails", async () => {
    const user = userEvent.setup();
    render(
      <AccountAccess
        loadClient={vi.fn().mockRejectedValue(new Error("Firebase secret detail"))}
        fetcher={vi.fn<typeof fetch>()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A autenticação não está disponível neste ambiente.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
  });
});
