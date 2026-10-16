/**
 * Small helpers the family routes share (C2 track D). Server-only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, toLocale, type Locale } from "@/lib/i18n";
import type { Subject } from "@/lib/subject";
import type { CareFailure } from "./links";

/** The caller's screen language (rp_lang), for the consent text a record points at. */
export function careLocale(req: NextRequest): Locale {
  return toLocale(req.cookies.get(LOCALE_COOKIE)?.value, "zh-Hans");
}

export function failureResponse(f: CareFailure): NextResponse {
  return NextResponse.json({ error: f.code }, { status: f.status });
}

/** He, on his own account (self mode, with his user id); null for anyone else (the route answers 404). */
export function himOf(subject: Subject): { userId: string } | null {
  return subject.kind === "account" && subject.relation === "self" && subject.userId ? { userId: subject.userId } : null;
}

/** She, through her active link (family mode); null for anyone else. */
export function herOf(subject: Subject): { userId: string; linkId: string; label: string | null; patientLabel: string | null } | null {
  if (subject.kind !== "account" || subject.relation !== "family" || !subject.userId || !subject.link) return null;
  return { userId: subject.userId, linkId: subject.link.id, label: subject.link.family_label, patientLabel: subject.link.patient_label };
}

export const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

/** A dynamic route's [id], decoded. */
export async function routeId(ctx: { params: Promise<{ id: string }> }): Promise<string> {
  return decodeURIComponent((await ctx.params).id);
}
