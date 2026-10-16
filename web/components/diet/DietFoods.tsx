"use client";

/**
 * 「我常吃的」: the hawker dishes he picks himself (journey 13; M16; design 13-2), the diet screen's second screen
 * (/p/diet?view=foods, an account only). The dishes of the knowledge base as chips (kb/diet.json foods): a tap picks or
 * unpicks one and saves at once (POST /api/diet/foods), then the page's server data is read again. Under the chips, a
 * section per dish he picked with the official eating-out lines for it, each with its page (OfficialEntry); a dish the
 * official pages say nothing particular about says so on a dashed entry. Nothing he eats is judged: a chip is only
 * chosen or not, and no line here is Ripple's own.
 *
 * Test hooks: diet-foods, diet-food (data-food, aria-pressed), diet-picked (data-food), diet-line (data-line,
 * data-url), diet-picked-none, diet-error.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Box, SectionTitle, Timeline, TimelineItem } from "@/components/ui";
import type { DietView } from "@/lib/diet/view";
import type { Locale } from "@/lib/i18n";
import { DIET_WORDS } from "./copy";
import { OfficialEntry } from "./OfficialEntry";
import "./diet.css";

export function DietFoods({ view, locale }: { view: DietView; locale: Locale }) {
  const router = useRouter();
  const w = DIET_WORDS[locale];
  const [picked, setPicked] = useState<string[]>(view.foods.all.filter((f) => f.picked).map((f) => f.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function toggle(id: string) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setBusy(id);
    setFailed(false);
    const res = await fetch("/api/diet/foods", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ foods: next }) }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setFailed(true);
    setPicked(next);
    router.refresh();
  }

  return (
    <div className="rpu-stack" data-testid="diet-foods">
      {/* the foundation's chip (its look and its pressed state); drawn here because each one carries the dish's id */}
      <div className="rpu rpu-chips" data-rp="chips" role="group" aria-label={w.foods}>
        {view.foods.all.map((f) => {
          const on = picked.includes(f.id);
          return (
            <button key={f.id} type="button" className="rpu-chip" data-rp="chip" aria-pressed={on} aria-busy={busy === f.id ? true : undefined} disabled={busy !== null} onClick={() => void toggle(f.id)} data-testid="diet-food" data-food={f.id}>
              {f.name}
            </button>
          );
        })}
      </div>
      {failed && (
        <div role="alert" data-testid="diet-error">
          <Box variant="red" title={w.failed} />
        </div>
      )}

      {view.foods.picked.map((f) => (
        <div key={f.id} className="fe13-section" data-testid="diet-picked" data-food={f.id}>
          <SectionTitle>{f.name}</SectionTitle>
          <Timeline>{f.lines.length ? f.lines.map((l) => <OfficialEntry key={l.id} line={l} locale={locale} />) : <TimelineItem node="miss" title={w.pickedNone} testId="diet-picked-none" />}</Timeline>
        </div>
      ))}
    </div>
  );
}
