/**
 * Who is in a session, read once per ROLE_CACHE_MS under STORE=supabase (task M6, wave B). Server-only.
 *
 * Every guarded request asks two questions about the session it names (lib/family/identity.ts):
 *   role       "which member row is this device?" (its rp_member cookie), and
 *   hasFamily  "has anyone joined this session as family?" (then a device with no row in it is a stranger, see
 *              identity.ts).
 * Each answer is a read of session_member, one round trip to the database (about 190 ms from the build machine to the
 * Tokyo project on 10-09). A member row's role never changes and rows are not deleted while their session lives (a
 * reset keeps them), so a found role and a "yes, family is here" are remembered for a minute; "no such row" and "no
 * family yet" are asked again next time (a fresh join is never missed: the moment she joins, a device without a row is
 * a stranger). The in-process store (STORE=memory) is read directly: it answers at once.
 */
import { storeKind, type MemberRole, type SessionMemberRow } from "@/lib/store";

/** The member row's role for (session, member id); null when there is no such row. Throws when it cannot tell. */
export type MemberLookup = (sessionId: string, memberId: string) => Promise<MemberRole | null>;

/** The two questions identity.ts asks about a session. Both throw when the rows cannot be read. */
export interface MemberDirectory {
  /** the role of this member id's row in the session; null: no such row (or no such session) */
  role(sessionId: string, memberId: string): Promise<MemberRole | null>;
  /** whether any device has joined the session as family (false for a session that does not exist) */
  hasFamily(sessionId: string): Promise<boolean>;
}

export const ROLE_CACHE_MS = 60_000;
const CACHE_MAX = 5_000;

export type MembersReader = { listMembers(sessionId: string): Promise<SessionMemberRow[]> };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** A store error's code, read by shape (the error may come from another bundle's StoreError class). */
function codeOf(err: unknown): string | null {
  return isObj(err) && typeof err.code === "string" ? err.code : null;
}

/** The session's member rows; a session that does not exist has none. Anything else throws. */
export function membersFrom(reader: () => MembersReader | null): (sessionId: string) => Promise<SessionMemberRow[]> {
  return async (sessionId) => {
    const store = reader();
    if (!store) return [];
    try {
      return await store.listMembers(sessionId);
    } catch (err) {
      if (codeOf(err) === "session_not_found") return [];
      throw err;
    }
  };
}

function remember<V>(map: Map<string, { value: V; until: number }>, key: string, value: V, until: number): void {
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value as string);
  map.set(key, { value, until });
}

/**
 * The directory over a way to list a session's members. `cacheMs` > 0 remembers found roles and "family is here" for
 * that long (never a miss: no row and no family are asked again). A role read also learns whether family is there, so
 * a device whose row is found pays no second read for hasFamily.
 */
export function memberDirectory(list: (sessionId: string) => Promise<SessionMemberRow[]>, cacheMs = 0, now: () => number = Date.now): MemberDirectory {
  const roles = new Map<string, { value: MemberRole; until: number }>();
  const families = new Map<string, { value: true; until: number }>();
  const familyHit = (sessionId: string): boolean => {
    const hit = families.get(sessionId);
    if (hit && hit.until > now()) return true;
    if (hit) families.delete(sessionId);
    return false;
  };
  const learn = (sessionId: string, rows: SessionMemberRow[]): boolean => {
    const has = rows.some((m) => m.role === "family");
    if (has && cacheMs > 0) remember(families, sessionId, true, now() + cacheMs);
    return has;
  };
  return {
    async role(sessionId, memberId) {
      const key = `${sessionId}\u0000${memberId}`;
      const hit = roles.get(key);
      if (hit && hit.until > now()) return hit.value;
      if (hit) roles.delete(key);
      const rows = await list(sessionId);
      learn(sessionId, rows);
      const role = rows.find((m) => m.id === memberId)?.role ?? null;
      if (role && cacheMs > 0) remember(roles, key, role, now() + cacheMs);
      return role;
    },
    async hasFamily(sessionId) {
      if (familyHit(sessionId)) return true;
      return learn(sessionId, await list(sessionId));
    },
  };
}

/** The role lookup alone (tests, and callers that only ask "which row"). */
export function cachedLookup(inner: MemberLookup, ttlMs = ROLE_CACHE_MS, now: () => number = Date.now): MemberLookup {
  const cache = new Map<string, { value: MemberRole; until: number }>();
  return async (sessionId, memberId) => {
    const key = `${sessionId}\u0000${memberId}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;
    if (hit) cache.delete(key);
    const role = await inner(sessionId, memberId);
    if (role) remember(cache, key, role, now() + ttlMs);
    return role;
  };
}

const cached = new WeakMap<MembersReader, MemberDirectory>();

function supabaseMode(): boolean {
  try {
    return storeKind() === "supabase";
  } catch {
    return false;
  }
}

/** The directory for this store: read directly in memory mode, remembered for a minute under STORE=supabase. */
export function directoryFor(store: MembersReader): MemberDirectory {
  if (!supabaseMode()) return memberDirectory(membersFrom(() => store));
  let dir = cached.get(store);
  if (!dir) {
    dir = memberDirectory(membersFrom(() => store), ROLE_CACHE_MS);
    cached.set(store, dir);
  }
  return dir;
}

/** The role of `memberId` in the session, through this store (remembered for a minute under STORE=supabase). */
export async function memberRole(store: MembersReader, sessionId: string, memberId: string): Promise<MemberRole | null> {
  return directoryFor(store).role(sessionId, memberId);
}
