/**
 * The family links' way in before a link binds anyone (C2 track D; real-app 3.10). Server-only.
 *
 * Most of the care flow runs on a scoped store (lib/subject/scoped-store.ts): he invites, confirms, changes switches and
 * stops sharing from his own space (self mode); she reads his space and leaves through her active link (family mode).
 * A few steps happen before or outside any such binding, and only they use this narrow store:
 *
 *   her opening an invitation    the link is found by the id in the invitation and the token's hash is compared; she is
 *                                not a party yet (family_id is null), maybe not even signed in
 *   her accepting it             acceptInvite matches the token's hash across scopes (global on every scoped store)
 *   his confirm card             her login name and display name (her account row, not his)
 *   a scheduled notice           whether her link is still active (the job's system store has no user)
 *   an account being deleted     every link the person is party to, his side and hers, ends with an event first
 *   a consent record's words     the family text a record points at is published to consent_text first (one table for
 *                                everyone, insert only: lib/privacy/consents.ts recordConsent)
 *
 * It exposes those methods and nothing else (the demo's way in, lib/subject/entry.ts, is built the same way). Pages
 * also get the signed-in person here (getPageUser): a family member has no space of her own, so getPageSubject() is
 * null for her unless a link is named.
 */
import { cookies } from "next/headers";
import { cache } from "react";
import { getAuthProvider } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { isAccount } from "@/lib/store/scope";
import type { SessionRow, Store } from "@/lib/store/types";
import { selfSubject, signedInUser, type SignedInUser } from "./resolve";
import { scopedStore, ScopeViolation, type ScopedStore } from "./scoped-store";

/** The methods the care flow may use outside a scope binding. */
export type CareEntryStore = Pick<Store, "kind" | "getCareLink" | "listCareLinks" | "acceptInvite" | "revokeLink" | "getAccount" | "getFamilyGrant" | "putConsentText">;

const ALLOWED = new Set(["getCareLink", "listCareLinks", "acceptInvite", "revokeLink", "getAccount", "getFamilyGrant", "putConsentText"]);

/** The narrow care store over a given store (tests) or the process-wide one. */
export function careEntryStore(base: Store = getStore()): CareEntryStore {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (!ALLOWED.has(prop)) {
        return () => {
          throw new ScopeViolation(prop, "is not part of the care flow's way in");
        };
      }
      return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
    },
  }) as CareEntryStore;
}

export interface PageUser {
  user: SignedInUser;
  /** his own space; null for a family member who has none */
  scope: SessionRow | null;
  /** bound to his own space (self mode), or to no space at all: only his own account rows and links are reachable */
  store: ScopedStore;
}

/** The signed-in person on a page (React cache: once per request), with a store bound to their own space; null when signed out. */
export const getPageUser = cache(async (): Promise<PageUser | null> => {
  const jar = await cookies();
  const base = getStore();
  const user = await signedInUser(jar.get("rp_at")?.value?.trim() || null, { store: base, auth: () => getAuthProvider() });
  if (!user) return null;
  const row = await base.getSession(user.userId);
  const scope = row && isAccount(row) ? row : null;
  const store = scope ? selfSubject(base, scope, user.userId).store : scopedStore(base, { id: `no-scope:${user.userId}` }, "self", { userId: user.userId, maskSessionId: true });
  return { user, scope, store };
});
