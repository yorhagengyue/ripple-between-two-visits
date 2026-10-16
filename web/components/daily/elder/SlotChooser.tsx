"use client";

/**
 * 「Amlodipine 什么时候吃？」 for a medicine whose label names no time (C2 track B; real-app 2.16: 没有时间词时，由他自己选
 * 「早上 / 中午 / 晚上 / 睡前」，标「你选的时间」). Tap the times he takes it (each a bordered button that shows it is
 * chosen), then 「就这样」: POST /api/doses/slots. From then on Ripple reminds him at those times.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BodyText, ButtonPair, PrimaryButton, SecondaryButton, StatusHeadline } from "@/components/ui";
import { dt, type DailyKey } from "@/lib/daily/i18n";
import { SLOT_ORDER } from "@/lib/daily/slots";
import type { Locale } from "@/lib/i18n";
import type { DaySlot } from "@/lib/store/types";

export function SlotChooser({ locale, meds }: { locale: Locale; meds: { id: string; name: string }[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, DaySlot[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function save(id: string) {
    const slots = picked[id] ?? [];
    if (!slots.length) return;
    setBusy(id);
    setFailed(false);
    try {
      const res = await fetch("/api/doses/slots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ medication_id: id, slots }), credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="slot-chooser">
      {meds.map((m) => {
        const mine = picked[m.id] ?? [];
        return (
          <section key={m.id} className="rpu" style={{ marginTop: 18 }} data-testid={`slot-chooser-${m.id}`}>
            <StatusHeadline variant="ask" lines={[dt(locale, "today.noSlot.ask", { name: m.name })]} />
            <BodyText variant="lede">{dt(locale, "today.noSlot.hint")}</BodyText>
            <ButtonPair>
              {SLOT_ORDER.slice(0, 2).map((s) => (
                <SlotButton key={s} locale={locale} slot={s} on={mine.includes(s)} onToggle={() => setPicked((p) => ({ ...p, [m.id]: toggle(mine, s) }))} />
              ))}
            </ButtonPair>
            <ButtonPair>
              {SLOT_ORDER.slice(2).map((s) => (
                <SlotButton key={s} locale={locale} slot={s} on={mine.includes(s)} onToggle={() => setPicked((p) => ({ ...p, [m.id]: toggle(mine, s) }))} />
              ))}
            </ButtonPair>
            <PrimaryButton disabled={!mine.length} pending={busy === m.id} onClick={() => void save(m.id)} data-testid={`slot-save-${m.id}`}>
              {dt(locale, "today.noSlot.save")}
            </PrimaryButton>
          </section>
        );
      })}
      {failed ? (
        <p className="rpu rpu-state-text" role="alert">
          {dt(locale, "today.error")}
        </p>
      ) : null}
    </div>
  );
}

function toggle(list: DaySlot[], s: DaySlot): DaySlot[] {
  return list.includes(s) ? list.filter((x) => x !== s) : [...list, s];
}

function SlotButton({ locale, slot, on, onToggle }: { locale: Locale; slot: DaySlot; on: boolean; onToggle: () => void }) {
  return (
    <SecondaryButton aria-pressed={on} icon={on ? "check" : undefined} onClick={onToggle} data-testid={`slot-${slot}`}>
      {dt(locale, `slot.${slot}` as DailyKey)}
    </SecondaryButton>
  );
}
