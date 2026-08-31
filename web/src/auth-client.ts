export type VerificationDelivery =
  | { kind: "email" }
  | { kind: "emulator"; actionUrl?: string };

export interface AuthUser {
  email: string;
  emailVerified: boolean;
  verificationDelivery?: VerificationDelivery;
  getIdToken(): Promise<string>;
  sendVerification(): Promise<VerificationDelivery>;
  reauthenticate?(password: string): Promise<void>;
}

export interface AuthClient {
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
}

export interface AuthenticatedWebSession {
  email: string;
  getIdToken(): Promise<string>;
  reauthenticate?(password: string): Promise<void>;
  terminate?(): Promise<void>;
}

export class SafeAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeAuthenticationError";
  }
}
