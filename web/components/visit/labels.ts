/**
 * Who-said-it labels for the visit screens. A source label ("Doctor said", lib/i18n source.*) appears only
 * when he confirmed the speaker, or for a clinician's medicine sentence that agrees with a confirmed label.
 * Otherwise the label says the speaker is inferred ("Inferred: doctor" / 推断：医生) or unknown.
 * Client-safe.
 */
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import type { UtteranceRole } from "@/lib/store/types";
import { shortDate, vt, type VisitKey } from "@/lib/visit/strings";
import type { DocRow, RoleDisplay } from "@/lib/visit/types";

const SOURCE_KEY: Partial<Record<UtteranceRole, MessageKey>> = {
  doctor: "source.doctor",
  dispenser: "source.dispenser",
  pharmacist: "source.pharmacist",
  patient: "source.self",
  family: "source.family",
};

export function roleName(locale: Locale, role: UtteranceRole): string {
  return vt(locale, `role.${role}` as VisitKey);
}

export function avatar(locale: Locale, role: UtteranceRole): string {
  return vt(locale, `avatar.${role}` as VisitKey);
}

/** The source chip: "Doctor said" / "Doctor said · matches your label" / "Inferred: doctor" / "Speaker not known". */
export function chipText(locale: Locale, role: UtteranceRole, display: RoleDisplay): string {
  const source = SOURCE_KEY[role];
  if ((display === "confirmed" || display === "label") && source) {
    return display === "label" ? `${t(locale, source)} · ${vt(locale, "chip.label")}` : t(locale, source);
  }
  if (display === "inferred" && role !== "unknown") {
    const name = roleName(locale, role);
    return vt(locale, "chip.inferred", { role: locale === "en" ? name.toLowerCase() : name });
  }
  return vt(locale, "chip.unknown");
}

/** The speaker label above a transcript line. */
export function whoText(locale: Locale, role: UtteranceRole, display: RoleDisplay): string {
  if (display === "confirmed") return role === "unknown" ? vt(locale, "chip.unknown") : roleName(locale, role);
  if (display === "label") return `${roleName(locale, role)} · ${vt(locale, "chip.label")}`;
  return chipText(locale, role, display);
}

/** Card heading prefix: a medicine sentence whose speaker is only inferred is "To confirm", never "Doctor's note". */
export function cardPrefix(locale: Locale, role: UtteranceRole, display: RoleDisplay, medication: boolean): string {
  const confirmed = display === "confirmed" || display === "label";
  if (medication && !confirmed) return vt(locale, "card.toConfirm");
  if (role === "doctor") return vt(locale, "card.doctor");
  if (role === "dispenser") return vt(locale, "card.dispenser");
  if (role === "pharmacist") return vt(locale, "card.pharmacist");
  return vt(locale, "card.heard");
}

/**
 * The small line under a doctor's-note row. A follow-up or test date is the app's own arithmetic (visit date
 * plus the weeks the doctor said), so it is always written as approximate ("About 6 Oct" / 大约 10月6日, like
 * v3's "Around 19 Nov"); the doctor's own words are in the quote on the same card.
 */
export function rowDesc(locale: Locale, r: Pick<DocRow, "variant" | "confirmedBy" | "dueDate">): string | null {
  if (r.variant === "new_med" || r.variant === "med") return r.confirmedBy === "label" ? null : vt(locale, "card.awaitLabel");
  if (r.dueDate) return vt(locale, "card.due", { date: shortDate(r.dueDate, locale) });
  return null;
}
