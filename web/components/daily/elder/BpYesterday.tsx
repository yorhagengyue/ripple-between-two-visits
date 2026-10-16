"use client";

/**
 * A blood pressure reading from yesterday on an account (C2 track B, fix round 10-11). The API has taken
 * `when: "yesterday"` since the second round (real-app 6.2, line 1139; app/api/bp/route.ts). The timeline draft's
 * group 03 does not draw this screen, so it is built from the same pieces as the screens it sits between (03-1 and 03-2):
 *
 *   BpYesterdayEntry    the worded way in, under 「记一次血压」 on the week view: 「补记昨天的读数」, to /p/bp?when=yesterday
 *   BpYesterdayScreen   that page, under the header 「‹ 血压 · 补记昨天的读数」: which reading of yesterday (早上 / 晚上: the
 *                       clock cannot say it for a day that has passed, real-app 2.9), then the same keypad, then his
 *                       own entry 「记下了：138/84」 with yesterday's date and that part. A reading above the doctor's
 *                       warning line gets the same relay as today's (the 995 card, then the doctor's own words; no tab
 *                       bar then): track S, unchanged.
 *
 * One write: POST /api/bp { id, systolic, diastolic, pulse, when: "yesterday", part }. The server picks the day; the id
 * (a uuid made here, kept until the reading is saved) makes a second tap or a retry harmless. It needs a network: a
 * reading from yesterday is not put on the phone's to-send list (track O dates those by the moment of the tap, which
 * would be today). Nothing here judges a reading, and a reading from yesterday cannot be changed afterwards (PATCH and
 * DELETE are today's only): the screen says the day and the part before he types.
 *
 * Test hooks, as before: bp-yesterday-entry, bp-yesterday-open, page-bp-yesterday (data-date, data-part),
 * bp-yesterday-morning / -evening / -cancel / -typing / -other, bp-yesterday-saved (data-reading, data-part),
 * bp-yesterday-done.
 */
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { bpc } from "@/components/bp/copy";
import { BodyText, BpKeypad, Button, ButtonRow, Screen, SecondaryButton, Timeline, TimelineItem } from "@/components/ui";
import { dt, shortDay } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import type { ThresholdRelay } from "@/lib/safety/threshold";
import { fetchSignedIn } from "@/lib/session/client";
import type { BpReading } from "@/lib/ui/bp-entry";
import { uiCopy } from "@/lib/ui/copy";
import { ThresholdRelayBlock } from "./ThresholdRelayBlock";
import "@/components/bp/bp.css";

export const BP_YESTERDAY_HREF = "/p/bp?when=yesterday";

type Part = "morning" | "evening";

/** The way in from the week view: words only, under 「记一次血压」. */
export function BpYesterdayEntry({ locale }: { locale: Locale }) {
  return (
    <div data-testid="bp-yesterday-entry">
      <Button variant="link" href={BP_YESTERDAY_HREF} nav="forward" data-testid="bp-yesterday-open">
        {dt(locale, "bp.yesterday.open")}
      </Button>
    </div>
  );
}

function uuid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
}

interface Saved {
  part: Part;
  systolic: number;
  diastolic: number;
  pulse: number | null;
  relay: ThresholdRelay | null;
}

export function BpYesterdayScreen({
  locale,
  date,
  meta,
  tabBar,
}: {
  locale: Locale;
  /** yesterday, YYYY-MM-DD, as the server reads its clock */
  date: string;
  meta: ReactNode;
  tabBar: ReactNode;
}) {
  const router = useRouter();
  const [part, setPart] = useState<Part | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const id = useRef<string | null>(null);
  const day = shortDay(locale, date);
  const partWords = (p: Part) => dt(locale, p === "morning" ? "bp.slot.morning" : "bp.slot.evening");

  async function save(entry: BpReading) {
    if (!part || pending) return;
    setPending(true);
    setError(undefined);
    id.current ??= uuid();
    let ok = false;
    let json: { reading?: { systolic: number | null; diastolic: number | null; pulse?: number | null }; relay?: ThresholdRelay | null } = {};
    try {
      const res = await fetchSignedIn("/api/bp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id.current, systolic: entry.systolic, diastolic: entry.diastolic, pulse: entry.pulse, when: "yesterday", part }),
        credentials: "same-origin",
      });
      ok = res.ok;
      json = (await res.json().catch(() => ({}))) as typeof json;
    } catch {
      ok = false;
    }
    setPending(false);
    const r = json.reading;
    if (!ok || !r || r.systolic === null || r.diastolic === null) {
      setError(dt(locale, "today.error"));
      return;
    }
    id.current = null;
    setSaved({ part, systolic: r.systolic, diastolic: r.diastolic, pulse: r.pulse ?? null, relay: json.relay ?? null });
    window.scrollTo(0, 0);
    router.refresh();
  }

  let body: ReactNode;
  if (saved) {
    const reading = `${saved.systolic}/${saved.diastolic}`;
    const [before, after = ""] = dt(locale, "bp.page.saved", { s: saved.systolic, d: saved.diastolic }).split(reading);
    const entry = (
      <TimelineItem
        node="me"
        who={bpc(locale, "you")}
        meta={`${dt(locale, "bp.yesterday.saved", { date: day, part: partWords(saved.part) })}${saved.pulse ? ` · ${dt(locale, "bp.page.pulse", { n: saved.pulse })}` : ""}`}
        title={
          <>
            {before}
            <span className="rp03-num" translate="no">
              {reading}
            </span>
            {after}
          </>
        }
      />
    );
    body = (
      <div className="rpu-stack">
        <div className="rpu-stack" data-testid="bp-yesterday-saved" data-reading={reading} data-part={saved.part}>
          {/* above the doctor's warning line: 995 first, then his own sentence and his reading on one line, as for a
              reading of today */}
          {saved.relay ? (
            <ThresholdRelayBlock relay={saved.relay} locale={locale}>
              {entry}
            </ThresholdRelayBlock>
          ) : (
            <Timeline>{entry}</Timeline>
          )}
        </div>
        <div className="rpu-ind">
          <SecondaryButton href="/p/bp" nav="back" data-testid="bp-yesterday-done">
            {uiCopy(locale).back}
          </SecondaryButton>
        </div>
      </div>
    );
  } else if (!part) {
    body = (
      <div className="rpu-stack">
        <BodyText variant="lede" style={{ marginTop: 0 }}>
          {dt(locale, "bp.yesterday.which", { date: day })}
        </BodyText>
        <ButtonRow cols={2}>
          <SecondaryButton data-testid="bp-yesterday-morning" onClick={() => setPart("morning")}>
            {partWords("morning")}
          </SecondaryButton>
          <SecondaryButton data-testid="bp-yesterday-evening" onClick={() => setPart("evening")}>
            {partWords("evening")}
          </SecondaryButton>
        </ButtonRow>
        <Button variant="link" href="/p/bp" nav="back" data-testid="bp-yesterday-cancel">
          {dt(locale, "bp.yesterday.cancel")}
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="rpu-stack">
        <BodyText variant="lede" style={{ marginTop: 0 }}>
          <span data-testid="bp-yesterday-typing">{dt(locale, "bp.yesterday.typing", { date: day, part: partWords(part) })}</span>
        </BodyText>
        <BpKeypad locale={locale} onSubmit={(entry) => void save(entry)} pending={pending} error={error} style={{ marginTop: 0 }} />
        <Button
          variant="link"
          data-testid="bp-yesterday-other"
          disabled={pending}
          onClick={() => {
            setError(undefined);
            setPart(null);
          }}
        >
          {dt(locale, "bp.yesterday.otherPart")}
        </Button>
      </div>
    );
  }

  return (
    // above the doctor's warning line no other thing stands in front of his words: no tab bar then (and the draft's
    // room under the last button: `foot` only counts where no tab bar is fixed)
    <Screen locale={locale} tabBar={saved?.relay ? undefined : tabBar} tabBarPlacement="fixed" foot="plain">
      {meta}
      <div data-testid="page-bp-yesterday" data-scope="account" data-date={date} data-part={saved?.part ?? part ?? ""}>
        {body}
      </div>
    </Screen>
  );
}
