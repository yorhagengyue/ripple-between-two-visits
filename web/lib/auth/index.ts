/**
 * The identity layer's entry (docs/plan/real-app.md 3.4). Server-only.
 *
 *   import { getAuthProvider } from "@/lib/auth";
 *   const auth = getAuthProvider();     // AUTH_PROVIDER = supabase | memory (default: memory without Supabase keys)
 *
 * A real deployment (RIPPLE_DEPLOYED=1) refuses the memory provider (lib/dev/enabled.ts assertDeployable).
 */
import { assertDeployable, effectiveAuthProvider } from "@/lib/dev/enabled";
import { GoTrueAuthProvider, goTrueConfig } from "./gotrue";
import { MemoryAuthProvider } from "./memory";
import { AuthError, type AuthProvider } from "./provider";

export * from "./provider";
export { MemoryAuthProvider, MEMORY_ISSUER, hashPassword, verifyPassword } from "./memory";
export { GoTrueAuthProvider, goTrueConfig } from "./gotrue";

export type AuthProviderName = "supabase" | "memory";

export function authProviderName(env: Record<string, string | undefined> = process.env): AuthProviderName {
  const name = effectiveAuthProvider(env);
  if (name === "supabase" || name === "memory") return name;
  throw new AuthError("not_configured", `Unknown AUTH_PROVIDER=${env.AUTH_PROVIDER}; use supabase or memory`);
}

type GlobalWithAuthProvider = typeof globalThis & { __rippleAuthProvider?: { key: string; provider: AuthProvider } };

/** The process-wide provider for this environment. */
export function getAuthProvider(env: Record<string, string | undefined> = process.env): AuthProvider {
  assertDeployable(env);
  const name = authProviderName(env);
  const cfg = name === "supabase" ? goTrueConfig(env) : null;
  if (name === "supabase" && !cfg) throw new AuthError("not_configured", "AUTH_PROVIDER=supabase needs SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_ANON_KEY");
  const key = name === "supabase" ? `supabase:${cfg!.url}` : "memory";
  const g = globalThis as GlobalWithAuthProvider;
  if (g.__rippleAuthProvider?.key !== key) {
    g.__rippleAuthProvider = { key, provider: name === "supabase" ? new GoTrueAuthProvider(cfg!) : new MemoryAuthProvider() };
  }
  return g.__rippleAuthProvider.provider;
}
