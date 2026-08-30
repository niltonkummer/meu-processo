export type VerificationDelivery =
  | { kind: "email" }
  | { kind: "emulator"; actionUrl?: string };

export interface AuthUser {
  email: string;
  emailVerified: boolean;
  verificationDelivery?: VerificationDelivery;
  getIdToken(): Promise<string>;
  sendVerification(): Promise<VerificationDelivery>;
}

export interface AuthClient {
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
}

export interface AuthenticatedWebSession {
  email: string;
  getIdToken(): Promise<string>;
}

export class SafeAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeAuthenticationError";
  }
}
