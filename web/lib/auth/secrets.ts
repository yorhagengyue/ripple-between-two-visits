/**
 * The account layer's three server secrets (docs/plan/real-app.md 3.12). Server-only.
 *
 *   AUTH_COOKIE_SECRET   signs rp_since (when a sign-in started; lib/auth/since.ts)
 *   RATE_LIMIT_SALT      keys the rate-limit buckets (an HMAC of the IP or the login, never the value itself)
 *   RECOVERY_PEPPER      mixed into every recovery-code hash (a leaked hash alone cannot be tried offline)
 *
 * A real deployment (RIPPLE_DEPLOYED=1) must set all three, at least 32 characters each: instrumentation.ts refuses to
 * start otherwise (lib/auth/boot.ts). Anywhere else (next dev, the tests, the recording build) a fixed development value
 * stands in, so a restart of a laptop server keeps everyone signed in; it is in the code, so it protects nothing.
 */
import { isDeployed, type Env } from "@/lib/dev/enabled";

export type AuthSecret = "AUTH_COOKIE_SECRET" | "RATE_LIMIT_SALT" | "RECOVERY_PEPPER";

export const AUTH_SECRETS: readonly AuthSecret[] = ["AUTH_COOKIE_SECRET", "RATE_LIMIT_SALT", "RECOVERY_PEPPER"];

/** The shortest secret a deployment accepts. */
export const MIN_SECRET_LENGTH = 32;

const DEV_VALUES: Record<AuthSecret, string> = {
  AUTH_COOKIE_SECRET: "ripple-dev-only-cookie-secret-not-for-deployment",
  RATE_LIMIT_SALT: "ripple-dev-only-rate-limit-salt-not-for-deployment",
  RECOVERY_PEPPER: "ripple-dev-only-recovery-pepper-not-for-deployment",
};

/** The secret's value: the environment's, or the development stand-in (refused on a deployment by the boot check). */
export function authSecret(name: AuthSecret, env: Env = process.env): string {
  const v = (env[name] ?? "").trim();
  return v || DEV_VALUES[name];
}

/** What is wrong with the secrets for a deployment (empty when it is not one, or when they are fine). */
export function secretProblems(env: Env = process.env): string[] {
  if (!isDeployed(env)) return [];
  const out: string[] = [];
  for (const name of AUTH_SECRETS) {
    const v = (env[name] ?? "").trim();
    if (!v) out.push(`${name} is not set`);
    else if (v.length < MIN_SECRET_LENGTH) out.push(`${name} is shorter than ${MIN_SECRET_LENGTH} characters`);
    else if (v === DEV_VALUES[name]) out.push(`${name} is the development value`);
  }
  return out;
}
