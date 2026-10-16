/**
 * The film crew's way to the filming accounts (C2 track J; real-app 5.4). Server-only.
 *
 * The director's laptop is not signed in to the account it moves: the crew acts on an account only after its owner
 * marked it as a filming account on his own phone (his own scoped store, self mode: app/api/crew/filming-account). Then
 * the director needs exactly this, and nothing else:
 *
 *   filmingScopes()          every account scope marked as a filming account (the director's list)
 *   accountRow(userId)       the account row behind one of them (its name on the list): only for a filming scope
 *   filmingSubject(scopeId)  the scope's subject in system mode (its store may reseed the scope, set its clock offset,
 *                            settle and record its reminders, like a scheduled job), or null when the scope is not a
 *                            filming account: an ordinary account is never reachable through here, whoever asks
 *
 * The crew gate (lib/crew/gate.ts) is checked by the routes and pages before any of this is called. Built like the care
 * flow's and the push sender's narrow ways in (lib/subject/care.ts, lib/subject/push.ts). lib/subject is one of the
 * places that may use the process-wide store (tests/unit/subject/store-allowlist.test.ts).
 */
import { getStore } from "@/lib/store";
import { isAccount } from "@/lib/store/scope";
import type { AccountRow, SessionRow, Store } from "@/lib/store/types";
import { systemSubject } from "./resolve";
import type { Subject } from "./types";

export interface FilmingEntry {
  filmingScopes(): Promise<SessionRow[]>;
  accountRow(userId: string): Promise<AccountRow | null>;
  filmingSubject(scopeId: string): Promise<Subject | null>;
}

/** An account scope the crew may act on: an account's own space, marked as a filming account. */
export function isFilmingScope(row: Pick<SessionRow, "kind" | "filming"> | null | undefined): row is SessionRow {
  return !!row && isAccount(row) && row.filming === true;
}

/** The crew's narrow way in, over a given store (tests) or the process-wide one. */
export function filmingEntry(base: Store = getStore()): FilmingEntry {
  return {
    async filmingScopes() {
      return (await base.listAccountScopes()).filter(isFilmingScope);
    },
    async accountRow(userId) {
      const row = await base.getSession(userId);
      if (!isFilmingScope(row)) return null;
      return base.getAccount(userId);
    },
    async filmingSubject(scopeId) {
      const row = await base.getSession(scopeId);
      return isFilmingScope(row) ? systemSubject(base, row) : null;
    },
  };
}
