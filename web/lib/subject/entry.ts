/**
 * The way into the demo before any subject exists (C2 F1). Server-only.
 *
 * Opening a judge's sandbox (POST /api/session) and joining a session with its code (POST /api/session/join) happen
 * before the request belongs to any scope, so they cannot use a scoped store. They get this one instead: it creates
 * demo sessions, finds a demo session by its code or id, and lists and adds the member rows of demo sessions, and does
 * nothing else. An account's space is invisible to it (a code never names one; an id that names one reads as missing),
 * so the joining code can never lead into a real account.
 */
import { getStore } from "@/lib/store";
import { isAccount } from "@/lib/store/scope";
import type { Store } from "@/lib/store/types";
import { ScopeViolation } from "./scoped-store";

/** The methods the demo's way in may use. */
export type DemoEntryStore = Pick<Store, "kind" | "createSession" | "getSessionByJoinCode" | "getSession" | "addMember" | "listMembers">;

const ALLOWED = new Set(["createSession", "getSessionByJoinCode", "getSession", "addMember", "listMembers"]);

/** The demo entry over a given store (tests) or the process-wide one. */
export function demoEntryStore(base: Store = getStore()): DemoEntryStore {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || typeof value !== "function") return value;
      if (!ALLOWED.has(prop)) {
        return () => {
          throw new ScopeViolation(prop, "is not part of the demo's way in");
        };
      }
      return async (...args: unknown[]) => {
        if (prop === "getSessionByJoinCode" || prop === "getSession") {
          const row = (await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args)) as { kind?: string } | null;
          return row && isAccount(row as never) ? null : row;
        }
        if (prop === "listMembers") {
          const row = await target.getSession(String(args[0]));
          if (row && isAccount(row)) return [];
        }
        return (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
      };
    },
  }) as DemoEntryStore;
}

const entries = new WeakMap<Store, DemoEntryStore>();

/**
 * The member rows of demo sessions, for the demo's device identity (lib/family/role.ts, identity.ts): one reader per
 * store for the whole process, so the member cache (lib/family/member-cache.ts) keeps its hits under STORE=supabase.
 */
export function demoMembers(base: Store = getStore()): DemoEntryStore {
  let e = entries.get(base);
  if (!e) {
    e = demoEntryStore(base);
    entries.set(base, e);
  }
  return e;
}
