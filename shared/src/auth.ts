/** `GET /api/auth/config`: what the login screen should offer. */
export interface AuthConfig {
  /** Anyone may create a tutor account (the hosted service). */
  signups: boolean;
  /** One tutor and no sign-ups: ask for the password alone. */
  passwordOnly: boolean;
  /** The Pro plan is sold here (Stripe is configured). */
  billing: boolean;
  /** `/demo` is open. */
  demo: boolean;
  /** "Forgot password" sends an email; otherwise the admin resets it. */
  resetByEmail: boolean;
}

export type Plan = 'free' | 'pro';

/** `GET /api/auth/me` and the answer to a sign-in. */
export type AuthMe =
  | { authenticated: false }
  | { authenticated: true; name: string; email: string; plan: Plan; isAdmin: boolean };
