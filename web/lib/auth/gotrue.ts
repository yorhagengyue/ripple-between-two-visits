/**
 * AUTH_PROVIDER=supabase: Supabase Auth (GoTrue) over fetch, no SDK (docs/plan/real-app.md 3.4). Server-only.
 *
 *   POST   /auth/v1/admin/users                     create a user, email_confirm true (server key; no mail)
 *   GET    /auth/v1/admin/users?filter=<address>    find a user by address (server key; recovery by login)
 *   POST   /auth/v1/token?grant_type=password       sign in (publishable key)
 *   POST   /auth/v1/token?grant_type=refresh_token  refresh (publishable key; rotation is the project's setting)
 *   POST   /auth/v1/logout?scope=local|global|others   sign out (the user's own access token)
 *   PUT    /auth/v1/admin/users/{id}                change a password (server key)
 *   DELETE /auth/v1/admin/users/{id}                delete a user (server key)
 *   GET    /auth/v1/.well-known/jwks.json           the public keys access tokens verify against
 *
 * The session registry (track A, supabase/migrations 0012_a_sessions.sql): public.account_session, read and written
 * through PostgREST with the server key. Every password sign-in enters its session (the token's session_id, the same
 * across refreshes) with the device it was opened on; sessionAlive(session) is true while that row is open. Logging out,
 * a new password, a recovery reset and signing one device out close rows, so a token Supabase would still accept (its
 * access tokens live an hour on the project) stops working at once. Answers are cached 30 s per process; this process
 * forgets a session the moment it closes one. A project without the table yet (0009 not applied) degrades to "alive"
 * with one warning, so merging the code before the migration signs nobody out.
 *
 * Config: SUPABASE_URL, SUPABASE_SERVICE_KEY (admin calls and the registry, server-side), SUPABASE_ANON_KEY (the
 * publishable key). Errors carry an AuthErrorCode, the HTTP status and a short error code only: never a key, the
 * project URL or a response body.
 */
import { createRemoteJWKSet, decodeJwt, type JWTVerifyGetKey } from "jose";
import { realNowMs } from "@/lib/time/now";
import {
  AuthError,
  type AuthErrorCode,
  type AuthProvider,
  type AuthSessionInfo,
  type AuthTokens,
  type AuthUser,
  type CreateUserInput,
  type EndSessions,
  type SignInContext,
} from "./provider";

export interface GoTrueConfig {
  url: string;
  serviceKey: string;
  anonKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** SUPABASE_URL + SUPABASE_SERVICE_KEY + SUPABASE_ANON_KEY, or null when any is missing. */
export function goTrueConfig(env: Record<string, string | undefined> = process.env): GoTrueConfig | null {
  const url = (env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const serviceKey = (env.SUPABASE_SERVICE_KEY ?? "").trim();
  const anonKey = (env.SUPABASE_ANON_KEY ?? "").trim();
  return url && serviceKey && anonKey ? { url, serviceKey, anonKey } : null;
}

const short = (v: unknown) =>
  String(v ?? "")
    .replace(/[^\w.-]/g, "")
    .slice(0, 40);

/** One key-set getter per project URL for the whole process (jose caches the keys and refetches for a new kid). */
const keySets = new Map<string, JWTVerifyGetKey>();

/** How long a "signed in" answer from the registry is trusted in this process. */
export const SESSION_ALIVE_CACHE_MS = 30_000;
/** The registry table (0012_a_sessions.sql). */
export const SESSION_TABLE = "account_session";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** GoTrue's admin list: users per page, and how many pages a lookup by address reads at most. */
const LIST_PER_PAGE = 100;
const LIST_MAX_PAGES = 20;

/** The registry could not be reached or answered with an error. `missing`: the table is not there (0009 not applied). */
class RegistryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`session registry: ${status ? `HTTP ${status}` : "no response"}${code ? ` (${code})` : ""}`);
    this.name = "RegistryError";
  }
  get missing(): boolean {
    return this.code === "PGRST205" || this.code === "42P01" || (this.status === 404 && this.code === "");
  }
}

let warnedMissing = false;
function warnMissing(): void {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn("[auth] the session registry table (public.account_session, migration 0012_a_sessions.sql) is missing: sessions count as signed in until it is applied");
}

export class GoTrueAuthProvider implements AuthProvider {
  readonly name = "supabase" as const;
  private readonly base: string;
  private readonly rest: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  /** session id -> until when (real ms) "signed in" is trusted */
  private readonly alive = new Map<string, number>();

  constructor(private readonly cfg: GoTrueConfig) {
    if (!cfg.url || !cfg.serviceKey || !cfg.anonKey) throw new AuthError("not_configured", "AUTH_PROVIDER=supabase needs SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_ANON_KEY");
    const root = cfg.url.replace(/\/+$/, "");
    this.base = `${root}/auth/v1`;
    this.rest = `${root}/rest/v1`;
    this.fetchImpl = cfg.fetch ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 15_000;
  }

  issuer(): string {
    return this.base;
  }

  async keySet(): Promise<JWTVerifyGetKey> {
    let ks = keySets.get(this.base);
    if (!ks) {
      ks = createRemoteJWKSet(new URL(`${this.base}/.well-known/jwks.json`), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000, timeoutDuration: 5_000 });
      keySets.set(this.base, ks);
    }
    return ks;
  }

  private async call(
    op: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { admin?: boolean; bearer?: string; body?: unknown; codes?: Partial<Record<string, AuthErrorCode>>; statusCodes?: Partial<Record<number, AuthErrorCode>> } = {},
  ): Promise<unknown> {
    const key = opts.admin ? this.cfg.serviceKey : this.cfg.anonKey;
    const headers: Record<string, string> = { apikey: key, authorization: `Bearer ${opts.bearer ?? key}`, accept: "application/json" };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AuthError("unavailable", `auth ${op}: no response`);
    }
    if (res.ok) {
      if (res.status === 204) return null;
      const text = await res.text();
      return text ? (JSON.parse(text) as unknown) : null;
    }
    let code = "";
    try {
      const body = (await res.json()) as { error_code?: unknown; code?: unknown; error?: unknown };
      code = short(body.error_code ?? (typeof body.code === "string" ? body.code : undefined) ?? body.error);
    } catch {
      /* not JSON */
    }
    const mapped = (code && opts.codes?.[code]) || opts.statusCodes?.[res.status] || "unavailable";
    throw new AuthError(mapped, `auth ${op}: HTTP ${res.status}${code ? ` (${code})` : ""}`);
  }

  private tokens(raw: unknown): AuthTokens {
    const r = raw as { access_token?: string; refresh_token?: string; expires_in?: number; expires_at?: number; user?: { id?: string } };
    if (!r?.access_token || !r.refresh_token || !r.user?.id) throw new AuthError("unavailable", "auth: an answer without tokens");
    const expiresIn = Number(r.expires_in ?? 0);
    return {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_in: expiresIn,
      expires_at: Number(r.expires_at ?? Math.floor(realNowMs() / 1000) + expiresIn),
      user_id: r.user.id,
    };
  }

  // ------------------------------------------------------------ the session registry (PostgREST, server key)

  private async registry(
    method: "GET" | "POST" | "PATCH",
    query: Record<string, string | undefined>,
    opts: { body?: unknown; prefer?: string[] } = {},
  ): Promise<unknown> {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const headers: Record<string, string> = { apikey: this.cfg.serviceKey, authorization: `Bearer ${this.cfg.serviceKey}`, accept: "application/json" };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.prefer?.length) headers.prefer = opts.prefer.join(",");
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.rest}/${SESSION_TABLE}${qs ? `?${qs}` : ""}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RegistryError(0, "network");
    }
    if (res.ok) {
      if (res.status === 204) return null;
      const text = await res.text();
      return text ? (JSON.parse(text) as unknown) : null;
    }
    let code = "";
    try {
      code = short(((await res.json()) as { code?: unknown }).code);
    } catch {
      /* not JSON */
    }
    throw new RegistryError(res.status, code);
  }

  private sessionIdOf(accessToken: string): { sessionId: string | null; userId: string | null } {
    try {
      const claims = decodeJwt(accessToken);
      return {
        sessionId: typeof claims.session_id === "string" ? claims.session_id : null,
        userId: typeof claims.sub === "string" ? claims.sub : null,
      };
    } catch {
      return { sessionId: null, userId: null };
    }
  }

  private async register(tokens: AuthTokens, ctx: SignInContext): Promise<void> {
    const { sessionId } = this.sessionIdOf(tokens.access_token);
    if (!sessionId || !UUID_RE.test(sessionId)) throw new AuthError("unavailable", "auth: a token without a session");
    const at = new Date(realNowMs()).toISOString();
    try {
      await this.registry(
        "POST",
        { on_conflict: "session_id" },
        {
          body: {
            session_id: sessionId,
            user_id: tokens.user_id,
            device_hash: ctx.deviceHash ?? null,
            device_label: ctx.deviceLabel ? ctx.deviceLabel.slice(0, 80) : null,
            ephemeral: ctx.ephemeral === true,
            created_at: at,
            last_seen_at: at,
          },
          prefer: ["return=minimal", "resolution=merge-duplicates"],
        },
      );
      this.alive.set(sessionId, realNowMs() + SESSION_ALIVE_CACHE_MS);
    } catch (err) {
      if (err instanceof RegistryError && err.missing) return warnMissing();
      // a session nobody can see is a session that cannot be signed out: end it and refuse the sign-in
      await this.call("sign out", "POST", "logout?scope=local", { bearer: tokens.access_token }).catch(() => undefined);
      throw new AuthError("unavailable", `auth sign in: ${err instanceof Error ? err.message : "the session registry failed"}`);
    }
  }

  async sessionAlive(sessionId: string | null): Promise<boolean> {
    if (!sessionId || !UUID_RE.test(sessionId)) return false;
    const now = realNowMs();
    const until = this.alive.get(sessionId);
    if (until !== undefined && until > now) return true;
    try {
      const rows = (await this.registry("GET", { session_id: `eq.${sessionId}`, select: "ended_at" })) as { ended_at: string | null }[] | null;
      const open = !!rows?.length && rows[0].ended_at === null;
      if (open) this.alive.set(sessionId, now + SESSION_ALIVE_CACHE_MS);
      else this.alive.delete(sessionId);
      return open;
    } catch (err) {
      if (err instanceof RegistryError && err.missing) {
        warnMissing();
        return true;
      }
      // could not tell: never "signed out" (a hiccup would log him out) and never "signed in"; the caller refuses
      // with 503 (lib/subject/unavailable.ts) and he tries again
      throw new AuthError("unavailable", `auth session check: ${err instanceof Error ? err.message : "the session registry failed"}`);
    }
  }

  async listSessions(userId: string): Promise<AuthSessionInfo[]> {
    if (!UUID_RE.test(userId)) return [];
    try {
      const rows = (await this.registry("GET", {
        user_id: `eq.${userId}`,
        select: "session_id,user_id,device_hash,device_label,ephemeral,created_at,last_seen_at,ended_at,ended_reason",
        order: "seq.asc",
      })) as AuthSessionInfo[] | null;
      return (rows ?? []).map((r) => ({
        ...r,
        created_at: new Date(r.created_at).toISOString(),
        last_seen_at: new Date(r.last_seen_at).toISOString(),
        ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
      }));
    } catch (err) {
      if (err instanceof RegistryError && err.missing) {
        warnMissing();
        return [];
      }
      throw new AuthError("unavailable", `auth list sessions: ${err instanceof Error ? err.message : "error"}`);
    }
  }

  async endSessions(userId: string, which: EndSessions): Promise<number> {
    if (!UUID_RE.test(userId)) return 0;
    let ids = which.sessionIds?.filter((id) => UUID_RE.test(id) && id !== which.exceptSessionId) ?? null;
    if (ids && !ids.length) return 0;
    const query: Record<string, string | undefined> = { user_id: `eq.${userId}`, ended_at: "is.null", select: "session_id" };
    if (ids) query.session_id = `in.(${ids.join(",")})`;
    else if (which.exceptSessionId) query.session_id = `neq.${which.exceptSessionId}`;
    if (which.deviceHash !== undefined) query.device_hash = `eq.${which.deviceHash}`;
    try {
      const rows = (await this.registry("PATCH", query, {
        body: { ended_at: new Date(realNowMs()).toISOString(), ended_reason: which.reason.slice(0, 40) },
        prefer: ["return=representation"],
      })) as { session_id: string }[] | null;
      ids = (rows ?? []).map((r) => r.session_id);
      for (const id of ids) this.alive.delete(id);
      return ids.length;
    } catch (err) {
      if (err instanceof RegistryError && err.missing) {
        warnMissing();
        return 0;
      }
      throw new AuthError("unavailable", `auth end sessions: ${err instanceof Error ? err.message : "error"}`);
    }
  }

  // ------------------------------------------------------------ GoTrue

  async createUser(input: CreateUserInput): Promise<AuthUser> {
    const raw = (await this.call("create user", "POST", "admin/users", {
      admin: true,
      body: { email: input.email, password: input.password, email_confirm: true, app_metadata: input.app_metadata ?? {} },
      codes: { email_exists: "user_exists", user_already_exists: "user_exists", weak_password: "weak_password", validation_failed: "invalid", email_address_invalid: "invalid" },
      statusCodes: { 422: "invalid", 400: "invalid" },
    })) as { id?: string; email?: string; app_metadata?: Record<string, unknown> } | null;
    if (!raw?.id) throw new AuthError("unavailable", "auth create user: an answer without a user");
    return { id: raw.id, email: raw.email ?? input.email, app_metadata: raw.app_metadata ?? {} };
  }

  private async passwordGrant(email: string, password: string): Promise<AuthTokens> {
    return this.tokens(
      await this.call("sign in", "POST", "token?grant_type=password", {
        body: { email, password },
        codes: { invalid_credentials: "invalid_credentials", invalid_grant: "invalid_credentials", email_not_confirmed: "invalid_credentials" },
        statusCodes: { 400: "invalid_credentials" },
      }),
    );
  }

  async signInWithPassword(email: string, password: string, ctx: SignInContext = {}): Promise<AuthTokens> {
    const tokens = await this.passwordGrant(email, password);
    await this.register(tokens, ctx);
    return tokens;
  }

  async checkPassword(email: string, password: string): Promise<boolean> {
    let tokens: AuthTokens;
    try {
      tokens = await this.passwordGrant(email, password);
    } catch (err) {
      if (err instanceof AuthError && err.code === "invalid_credentials") return false;
      throw err;
    }
    // the check opened a session at GoTrue: close it again (it was never entered in the registry)
    await this.call("sign out", "POST", "logout?scope=local", { bearer: tokens.access_token }).catch(() => undefined);
    return true;
  }

  async findUserIdByEmail(email: string): Promise<string | null> {
    const want = (email ?? "").trim().toLowerCase();
    if (!want.includes("@")) return null;
    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
      const raw = (await this.call("find user", "GET", `admin/users?page=${page}&per_page=${LIST_PER_PAGE}&filter=${encodeURIComponent(want)}`, {
        admin: true,
      })) as { users?: { id?: string; email?: string }[] } | null;
      const users = raw?.users ?? [];
      const hit = users.find((u) => (u.email ?? "").toLowerCase() === want);
      if (hit?.id) return hit.id;
      if (users.length < LIST_PER_PAGE) return null;
    }
    return null;
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokens = this.tokens(
      await this.call("refresh", "POST", "token?grant_type=refresh_token", {
        body: { refresh_token: refreshToken },
        codes: { refresh_token_not_found: "invalid_refresh", refresh_token_already_used: "invalid_refresh", session_not_found: "invalid_refresh", invalid_grant: "invalid_refresh" },
        statusCodes: { 400: "invalid_refresh", 401: "invalid_refresh", 403: "invalid_refresh" },
      }),
    );
    // last seen, for his devices page; never a reason to fail the refresh
    const { sessionId } = this.sessionIdOf(tokens.access_token);
    if (sessionId && UUID_RE.test(sessionId)) {
      await this.registry("PATCH", { session_id: `eq.${sessionId}`, ended_at: "is.null" }, { body: { last_seen_at: new Date(realNowMs()).toISOString() }, prefer: ["return=minimal"] }).catch(
        () => undefined,
      );
    }
    return tokens;
  }

  async signOut(accessToken: string, scope: "local" | "global" | "others" = "local"): Promise<void> {
    const { sessionId, userId } = this.sessionIdOf(accessToken);
    try {
      await this.call("sign out", "POST", `logout?scope=${scope}`, { bearer: accessToken, statusCodes: { 401: "invalid", 403: "invalid", 404: "invalid" } });
    } catch (err) {
      // an already ended or expired session is signed out: the cookies are cleared either way
      if (!(err instanceof AuthError && err.code === "invalid")) throw err;
    }
    if (!userId) return;
    if (scope === "local") {
      if (sessionId) await this.endSessions(userId, { sessionIds: [sessionId], reason: "logout" });
      return;
    }
    await this.endSessions(userId, { exceptSessionId: scope === "others" ? sessionId : null, reason: scope === "global" ? "logout_everywhere" : "logout_others" });
  }

  async updatePassword(userId: string, password: string): Promise<void> {
    await this.call("update password", "PUT", `admin/users/${encodeURIComponent(userId)}`, {
      admin: true,
      body: { password },
      codes: { weak_password: "weak_password", user_not_found: "not_found" },
      statusCodes: { 404: "not_found", 422: "weak_password" },
    });
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.call("delete user", "DELETE", `admin/users/${encodeURIComponent(userId)}`, { admin: true, codes: { user_not_found: "not_found" }, statusCodes: { 404: "not_found" } });
    } catch (err) {
      if (err instanceof AuthError && err.code === "not_found") return;
      throw err;
    }
    for (const [sid] of this.alive) this.alive.delete(sid); // his registry rows went with him (on delete cascade)
  }
}
