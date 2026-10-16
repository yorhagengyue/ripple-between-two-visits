/**
 * The way in for binding by account (line bind; the owner, 2026-10-11: a family member types the elder's account, or
 * the elder types the family member's, and the two are linked at once). Server-only.
 *
 * A link bound this way is made for two people of whom only one is asking. Her scoped store cannot invite in his name,
 * confirm for him or write on his account, and his cannot accept for her (lib/subject/scoped-store.ts: each of those is
 * the other person's own step, and it stays that way for every other flow). So the binding flow (lib/care/bind.ts) and
 * the check that follows from it (lib/care/ack.ts) get this narrow store, and nothing else does:
 *
 *   getAccountByUsername, getAccount   the account that was typed (a username; an address through the identity provider)
 *   getSession                         which of the two has a space of his own: he is the elder
 *   listCareLinks                      a link between the two that is already there
 *   createInvite, acceptInvite,        the link, made with the store's own three steps one after the other (no new
 *   confirmLink                        store method, no migration)
 *   revokeLink                         a link that was only half made is ended
 *   setFamilyGrant                     an invitation she had accepted and this binding confirms gets the switches a
 *                                      directly bound link starts with
 *   getFamilyGrant                     the switches' version and items, for his consent record
 *   addAccountEvent                    `family_bound` on both accounts (one of them is not the caller's); on his it is
 *                                      the mark that a family member bound the link (lib/care/ack.ts)
 *   putConsentText                     the words a consent record points at (one table for everyone, insert only)
 *   listAccountEvents,                 whether he has acknowledged a link, asked from her side: that mark on his
 *   listConsentRecords                 account and his own record of sharing. Her store cannot read his rows, and
 *                                      her writes that reach his phone wait for exactly that. And whether each of the
 *                                      two has agreed to the family text in force (lib/care/reconsent.ts, owner
 *                                      10-14): his pages ask about her record, her live stream about both
 *
 * Everything else throws ScopeViolation. The consent record itself is written by the caller's own store (it is in the
 * caller's own name), and the rate limits by the account routes' store, as the invitation's acceptance does it. Built
 * like the care flow's way in (lib/subject/care.ts careEntryStore), which is left as it is.
 */
import { getStore } from "@/lib/store";
import type { Store } from "@/lib/store/types";
import { ScopeViolation } from "./scoped-store";

/** The methods binding by account may use outside a scope binding. */
export type BindEntryStore = Pick<
  Store,
  | "kind"
  | "getAccountByUsername"
  | "getAccount"
  | "getSession"
  | "listCareLinks"
  | "createInvite"
  | "acceptInvite"
  | "confirmLink"
  | "revokeLink"
  | "setFamilyGrant"
  | "getFamilyGrant"
  | "addAccountEvent"
  | "putConsentText"
  | "listAccountEvents"
  | "listConsentRecords"
>;

const ALLOWED = new Set([
  "getAccountByUsername",
  "getAccount",
  "getSession",
  "listCareLinks",
  "createInvite",
  "acceptInvite",
  "confirmLink",
  "revokeLink",
  "setFamilyGrant",
  "getFamilyGrant",
  "addAccountEvent",
  "putConsentText",
  "listAccountEvents",
  "listConsentRecords",
]);

/** The narrow binding store over a given store (tests) or the process-wide one. */
export function bindEntryStore(base: Store = getStore()): BindEntryStore {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (!ALLOWED.has(prop)) {
        return () => {
          throw new ScopeViolation(prop, "is not part of binding by account");
        };
      }
      return (...args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
    },
  }) as BindEntryStore;
}
