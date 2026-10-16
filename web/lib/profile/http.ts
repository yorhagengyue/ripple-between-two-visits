/**
 * What track C's routes share (/api/questions, /api/profile, /api/me/example): who may call them and how their errors
 * read. Server-only.
 */
import type { NextRequest } from "next/server";
import { denyFamily } from "@/lib/family/role";
import { DEFAULT_PATIENT_LOCALE, LOCALE_COOKIE, toLocale, type Locale } from "@/lib/i18n";
import { jsonError, storeErrorResponse } from "@/lib/session/http";
import { requireSubject, type SubjectFound } from "@/lib/subject";
import type { ResolveOptions } from "@/lib/subject/resolve";
import { ProfileInputError } from "./facts";
import { QuestionInputError } from "./questions";

/**
 * His own subject, or the refusal: a scheduled job never comes through a route; a family subject (her care link) only
 * where `allowFamily` says so (proposing a profile fact); in a demo session her phone gets 403 patient_only.
 */
export async function hisSubject(req: NextRequest, opts: ResolveOptions = {}): Promise<SubjectFound> {
  const found = await requireSubject(req, opts);
  if (!found.ok) return found;
  if (found.subject.relation === "system") return { ok: false, res: jsonError(403, "patient_only") };
  if (found.subject.relation === "family" && !opts.allowFamily) return { ok: false, res: jsonError(403, "patient_only") };
  const denied = await denyFamily(req, found.session);
  if (denied) return { ok: false, res: denied };
  return found;
}

/** An account's own subject only (the example account's buttons, his profile page's account-only parts). */
export async function accountSelf(req: NextRequest): Promise<SubjectFound> {
  const found = await requireSubject(req);
  if (!found.ok) return found;
  if (found.subject.kind !== "account" || found.subject.relation !== "self") return { ok: false, res: jsonError(404, "not_found") };
  return found;
}

/** The request's UI language: ?locale=, else the rp_lang cookie, else 华语. */
export function requestLocale(req: NextRequest): Locale {
  return toLocale(req.nextUrl.searchParams.get("locale") ?? req.cookies.get(LOCALE_COOKIE)?.value, DEFAULT_PATIENT_LOCALE);
}

/** 400 with the input problem's code; store errors as everywhere else. */
export function inputErrorResponse(err: unknown): Response {
  if (err instanceof QuestionInputError || err instanceof ProfileInputError) return jsonError(400, err.code);
  return storeErrorResponse(err);
}
