/**
 * Numbers that must never be shown: referrals.json B4-06 ("Do not display": retired IMH helpline, old SOS
 * number). The list is read from the data; comparison ignores spaces and dashes, so "6389 2222",
 * "6389-2222" and "63892222" are all caught.
 */
import { doNotDisplayNumbers } from "@/lib/kb/load";
import { digitRuns } from "./text";

let cache: { shown: string; digits: string }[] | null = null;

function lists() {
  cache ??= doNotDisplayNumbers()
    .map((shown) => ({ shown, digits: shown.replace(/\D/g, "") }))
    .filter((n) => n.digits.length >= 6);
  return cache;
}

/** The B4-06 numbers as written in referrals.json. */
export function forbiddenNumbers(): string[] {
  return lists().map((n) => n.shown);
}

/** Forbidden numbers found in a text (as written in referrals.json). Empty = clean. */
export function findForbiddenNumbers(text: string): string[] {
  const runs = digitRuns(text);
  return lists()
    .filter((n) => runs.some((r) => r.includes(n.digits)))
    .map((n) => n.shown);
}
