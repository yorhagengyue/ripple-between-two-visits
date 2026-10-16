"use client";

/**
 * 「打电话给爸爸」 and the field for his number (the v3 draft's A4a, D4, G3).
 *
 *   CallDad      the button. With his number saved on this phone it is a tel: link and dials at once. Without one it
 *                opens the bottom sheet 「先存一次爸爸的电话。」: 「存好，打给爸爸」 keeps the number on this phone
 *                (lib/care/device.ts; it never goes to the server) and dials it; 「先不存」 closes the sheet and
 *                leaves the screen as it was.
 *   PhoneField   the labelled field with 「+65」 in front. A number she types with her own 「+」 is taken as written
 *                (the prefix steps aside); anything else is read as a Singapore number.
 */
import { useEffect, useState, type FormEvent } from "react";
import { FamilyButton, FamilyDock, FamilySheet } from "@/components/family-ui";
import { cleanPhone, savedPhone, savePhone } from "@/lib/care/device";
import { hc } from "@/lib/care/her-copy";
import type { Locale } from "@/lib/i18n";
import { telHref } from "@/lib/ui/props";

const PREFIX = "+65";

/** What she typed, as the number to keep: her own 「+…」 as written, else with +65 in front; null when it is not a number. */
export function phoneFrom(typed: string): string | null {
  const t = typed.trim();
  if (!t) return null;
  return cleanPhone(t.startsWith("+") ? t : `${PREFIX} ${t}`);
}

/** A saved number as the field shows it: the +65 goes into the prefix. */
export function phoneForField(saved: string | null | undefined): string {
  const t = (saved ?? "").trim();
  return t.startsWith(PREFIX) ? t.slice(PREFIX.length).trim() : t;
}

export function PhoneField({ locale, dad, value, onChange, bad, autoFocus }: { locale: Locale; dad: string; value: string; onChange: (v: string) => void; bad?: boolean; autoFocus?: boolean }) {
  const own = value.trim().startsWith("+");
  return (
    <>
      <label className="rpf rpf-field" style={{ marginTop: 28 }}>
        <span className="rpf-label">{hc(locale, "phoneLabel", { dad })}</span>
        <span className="rpf-inputwrap">
          {!own && <span aria-hidden="true">{PREFIX}</span>}
          <input className="rpf-input" inputMode="tel" autoComplete="tel" autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} placeholder={hc(locale, "phonePlaceholder")} data-testid="phone-input" />
        </span>
      </label>
      {bad && (
        <p className="rpf rpf-error" role="alert" data-testid="phone-bad">
          {hc(locale, "phoneBad")}
        </p>
      )}
    </>
  );
}

export function CallDad({
  linkId,
  locale,
  dad,
  phone,
  variant = "secondary",
  onSaved,
}: {
  linkId: string;
  locale: Locale;
  dad: string;
  /** his number when the caller already read it; undefined: read here from this phone */
  phone?: string | null;
  variant?: "primary" | "secondary" | "warn";
  /** the number was just saved from the sheet */
  onSaved?: (phone: string) => void;
}) {
  const [own, setOwn] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);
  useEffect(() => {
    if (phone === undefined) setOwn(savedPhone(linkId));
  }, [linkId, phone]);
  const number = phone ?? own;
  const label = hc(locale, "callDad", { dad });

  if (number) {
    return (
      <FamilyButton href={telHref(number)} variant={variant} data-testid="call-dad">
        {label}
      </FamilyButton>
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = phoneFrom(value);
    if (!p) return setBad(true);
    savePhone(linkId, p);
    setOwn(p);
    setOpen(false);
    onSaved?.(p);
    // 「存好，打给爸爸」: the same tap dials
    window.location.href = telHref(p);
  }

  return (
    <>
      <FamilyButton variant={variant} onClick={() => setOpen(true)} data-testid="call-dad" aria-haspopup="dialog">
        {label}
      </FamilyButton>
      <FamilySheet open={open} onClose={() => setOpen(false)} title={hc(locale, "phoneSheetTitle", { dad })} detail={hc(locale, "phoneSheetBody", { dad })} closeLabel={hc(locale, "phoneSheetLater")} data-testid="phone-sheet">
        <form onSubmit={submit} noValidate>
          <PhoneField locale={locale} dad={dad} value={value} onChange={(v) => (setValue(v), setBad(false))} bad={bad} autoFocus />
          <FamilyDock>
            <FamilyButton type="submit" data-testid="phone-sheet-save">
              {hc(locale, "phoneSheetSave", { dad })}
            </FamilyButton>
            <FamilyButton variant="quiet" onClick={() => setOpen(false)} data-testid="phone-sheet-later">
              {hc(locale, "phoneSheetLater")}
            </FamilyButton>
          </FamilyDock>
        </form>
      </FamilySheet>
    </>
  );
}
