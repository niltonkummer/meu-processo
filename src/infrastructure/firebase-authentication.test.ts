import { describe, expect, it, vi } from "vitest";

import {
  firebaseAdminConfiguration,
  FirebaseIdentityTokenDecoder,
  InvalidFirebaseIdentityError,
  type FirebaseAuthClient,
} from "./firebase-authentication.js";

describe("Firebase Admin runtime configuration", () => {
  it("uses the synthetic project without cloud credentials for the emulator", () => {
    expect(
      firebaseAdminConfiguration({
        FIREBASE_AUTH_EMULATOR_HOST: "auth-emulator:9099",
        GOOGLE_CLOUD_PROJECT: "demo-meu-processo",
      }),
    ).toEqual({
      projectId: "demo-meu-processo",
      useApplicationDefaultCredentials: false,
    });
  });

  it("requires application default credentials outside the emulator", () => {
    expect(firebaseAdminConfiguration({ GOOGLE_CLOUD_PROJECT: "cloud-project" })).toEqual({
      projectId: "cloud-project",
      useApplicationDefaultCredentials: true,
    });
  });
});

describe("FirebaseIdentityTokenDecoder", () => {
  it("verifies revocation and maps only the minimum identity claims", async () => {
    const client: FirebaseAuthClient = {
      verifyIdToken: vi.fn().mockResolvedValue({
        uid: "firebase_user",
        email: "pessoa@example.test",
        email_verified: true,
        organizationId: "untrusted_client_claim",
      }),
    };
    const decoder = new FirebaseIdentityTokenDecoder(client);

    await expect(decoder.decode("signed-token")).resolves.toEqual({
      userId: "firebase_user",
      email: "pessoa@example.test",
      emailVerified: true,
    });
    expect(client.verifyIdToken).toHaveBeenCalledWith("signed-token", true);
  });

  it.each([
    {},
    { uid: "firebase_user" },
    { uid: "firebase_user", email: "pessoa@example.test" },
  ])("rejects incomplete Firebase claims", async (claims) => {
    const decoder = new FirebaseIdentityTokenDecoder({
      verifyIdToken: vi.fn().mockResolvedValue(claims),
    });

    await expect(decoder.decode("signed-token")).rejects.toBeInstanceOf(
      InvalidFirebaseIdentityError,
    );
  });
});
