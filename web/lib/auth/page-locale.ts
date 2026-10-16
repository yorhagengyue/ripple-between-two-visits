/**
 * Which language an account page opens in (track A): ?lang= when the page was asked for one, then the rp_lang cookie
 * (written at sign-in from the account's own language, and by 「我 › 语言」), else English (the owner, 10-15: 「每次登录都默
 * 认英文，除非用户自己修改」; the browser's own languages no longer choose). Server-only.
 */
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/i18n";
import type { AccountLocale } from "./copy";

export function asAccountLocale(v: string | null | undefined): AccountLocale | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s === "en" || s.startsWith("en-")) return "en";
  if (s === "zh-hans" || s.startsWith("zh")) return "zh-Hans";
  return null;
}

export async function pageLocale(query?: string | string[] | null): Promise<AccountLocale> {
  const q = asAccountLocale(Array.isArray(query) ? query[0] : query);
  if (q) return q;
  const jar = await cookies();
  return asAccountLocale(jar.get(LOCALE_COOKIE)?.value) ?? "en";
}

/** His own pages (/p/me/*): ?lang=, then rp_lang, then English (owner 10-15). */
export async function patientPageLocale(query?: string | string[] | null): Promise<AccountLocale> {
  const q = asAccountLocale(Array.isArray(query) ? query[0] : query);
  if (q) return q;
  const jar = await cookies();
  return asAccountLocale(jar.get(LOCALE_COOKIE)?.value) ?? "en";
}

/** The other language, for the chip. */
export function otherLocale(l: AccountLocale): AccountLocale {
  return l === "en" ? "zh-Hans" : "en";
}
