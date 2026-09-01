import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

import {
  VerifiedTokenAuthenticator,
  type IdentityTokenDecoder,
  type MembershipDirectory,
  type TokenVerifier,
  type VerifiedIdentity,
} from "../application/authentication.js";

interface FirebaseDecodedToken {
  uid?: unknown;
  email?: unknown;
  email_verified?: unknown;
  auth_time?: unknown;
}

export interface FirebaseAuthClient {
  verifyIdToken(
    token: string,
    checkRevoked: boolean,
  ): Promise<FirebaseDecodedToken>;
}

export class InvalidFirebaseIdentityError extends Error {
  constructor() {
    super("Firebase token does not contain the required identity claims.");
    this.name = "InvalidFirebaseIdentityError";
  }
}

export class FirebaseIdentityTokenDecoder implements IdentityTokenDecoder {
  constructor(private readonly client: FirebaseAuthClient) {}

  async decode(token: string): Promise<VerifiedIdentity> {
    const decoded = await this.client.verifyIdToken(token, true);
    if (
      typeof decoded.uid !== "string" ||
      typeof decoded.email !== "string" ||
      typeof decoded.email_verified !== "boolean" ||
      typeof decoded.auth_time !== "number" ||
      !Number.isSafeInteger(decoded.auth_time) ||
      decoded.auth_time < 0
    ) {
      throw new InvalidFirebaseIdentityError();
    }

    return {
      userId: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified,
      authenticatedAt: new Date(decoded.auth_time * 1000),
    };
  }
}

export const firebaseAdminConfiguration = (
  environment: Record<string, string | undefined>,
): {
  projectId: string | undefined;
  useApplicationDefaultCredentials: boolean;
} => ({
  projectId: environment.GOOGLE_CLOUD_PROJECT,
  useApplicationDefaultCredentials:
    environment.FIREBASE_AUTH_EMULATOR_HOST === undefined,
});

const emptyMembershipDirectory: MembershipDirectory = {
  listActiveForUser: () => Promise.resolve([]),
};

export const createFirebaseTokenVerifier = (): TokenVerifier => {
  const configuration = firebaseAdminConfiguration(process.env);
  if (!configuration.useApplicationDefaultCredentials && !configuration.projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT is required with the Auth emulator.");
  }
  const projectOptions = configuration.projectId
    ? { projectId: configuration.projectId }
    : {};
  const options = configuration.useApplicationDefaultCredentials
    ? {
        credential: applicationDefault(),
        ...projectOptions,
      }
    : projectOptions;
  const app =
    getApps()[0] ?? initializeApp(options);
  return new VerifiedTokenAuthenticator(
    new FirebaseIdentityTokenDecoder(getAuth(app)),
    emptyMembershipDirectory,
  );
};
