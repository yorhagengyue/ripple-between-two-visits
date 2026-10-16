"use client";

/**
 * Her small screen for adding a line to his details (C2 track D, round two; real-app 3.10 补档案, 2.5): what the line is
 * about (the kinds the design's 建档 asks a family member: a condition a doctor named, an allergy, his usual clinic, when
 * he has breakfast, or something else), her words (a time for breakfast), and one button: 「发给爸爸确认」. It posts to
 * track C's route through her link (POST /api/profile/facts?link=): the fact is hers, unconfirmed, and used nowhere
 * until he taps 「对」 on his own phone. Below it, what she wrote before and how each stands.
 *
 *   FactComposer   the form
 *   FactsLive      her stream on this screen: his answer about one of her lines re-reads the list at once, and her
 *                  link's end sends her back to /f, which says what happened
 * She proposes; only he confirms. Nothing here explains a condition or gives advice.
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/icons";
import { FamilyButton, FamilyDock } from "@/components/family-ui";
import { hc, type HerKey } from "@/lib/care/her-copy";
// line bind (only add): the sentence for a link he has not acknowledged yet
import { bc } from "@/lib/care/bind-copy";
import type { Locale } from "@/lib/i18n";
import { clockWords } from "@/lib/profile/dates";
import { useFamilyStream } from "./useFamilyStream";

/** The kinds her screen offers, in this order (lib/care/facts.ts HER_FACT_KINDS; the route refuses any other from her). */
const KINDS = ["condition", "allergy", "clinic", "routine", "other"] as const;
type Kind = (typeof KINDS)[number];
const TEXT_MAX = 200;

const ERRORS: Record<string, HerKey> = {
  text_empty: "factEmpty",
  text_too_long: "factTooLong",
  text_clinical: "factClinical",
  routine_invalid: "factTime",
  time_invalid: "factTime",
};

export function FactComposer({ locale, linkId, dad }: { locale: Locale; linkId: string; dad: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("condition");
  const [text, setText] = useState("");
  const [time, setTime] = useState("08:00");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSent(false);
    const words = text.replace(/\s+/g, " ").trim();
    if (kind !== "routine" && !words) return setError(hc(locale, "factEmpty"));
    if (kind !== "routine" && [...words].length > TEXT_MAX) return setError(hc(locale, "factTooLong"));
    if (kind === "routine" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return setError(hc(locale, "factTime"));
    setPending(true);
    setError(null);
    // breakfast: the same entry and words his own set-up writes; the route accepts the entry only with exactly these
    // words (lib/care/facts.ts breakfastProposal), so what he reads is what his 「对」 sets
    const body = kind === "routine" ? { kind, text: `早饭 · ${clockWords(time, "zh-Hans")}`, data: { entry: { label: "Breakfast", label_zh: "早饭", days: "daily", time } } } : { kind, text: words };
    try {
      const res = await fetch(`/api/profile/facts?link=${encodeURIComponent(linkId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", cache: "no-store" });
      if (res.status === 201) {
        setText("");
        setSent(true);
        router.refresh();
        return;
      }
      // her link ended while she was writing: /f says what happened
      if (res.status === 403 || res.status === 404) return window.location.assign(`/f?link=${encodeURIComponent(linkId)}`);
      const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "";
      // line bind (only add): she bound his account herself and he has not answered yet (lib/care/ack.ts): trying again
      // will not help, so the screen says what she is waiting for
      if (code === "link_not_acknowledged") return setError(bc(locale, "lockedFact", { dad }));
      setError(hc(locale, ERRORS[code] ?? "factFailed"));
    } catch {
      setError(hc(locale, "factFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", flex: 1 }} data-testid="fact-form" data-kind={kind}>
      <fieldset style={{ border: 0, margin: "18px 0 0", padding: 0, minWidth: 0 }}>
        <legend className="rpf rpf-label" style={{ padding: 0 }}>
          {hc(locale, "factsAbout")}
        </legend>
        {KINDS.map((k) => (
          <label key={k} className="rpf rpf-check" style={{ marginTop: 0 }} data-testid={`fact-kind-${k}`}>
            <input
              type="radio"
              name="fact-kind"
              value={k}
              checked={kind === k}
              onChange={() => {
                setKind(k);
                setError(null);
                setSent(false);
              }}
            />
            <span className="rpf-checkbox" aria-hidden="true" style={{ borderRadius: "50%" }}>
              <Icon name="check" stroke={3.4} />
            </span>
            <span>{hc(locale, `factKind_${k}`, { dad })}</span>
          </label>
        ))}
      </fieldset>
      <label className="rpf rpf-field">
        <span className="rpf-label">{hc(locale, `factField_${kind}`, { dad })}</span>
        {kind === "routine" ? (
          <input className="rpf-input" type="time" value={time} onChange={(e) => (setTime(e.target.value), setError(null))} data-testid="fact-time" />
        ) : (
          <input className="rpf-input" value={text} onChange={(e) => (setText(e.target.value), setError(null), setSent(false))} maxLength={TEXT_MAX} autoComplete="off" data-testid="fact-text" />
        )}
      </label>
      {error && (
        <p className="rpf rpf-error" role="alert" data-testid="fact-error">
          {error}
        </p>
      )}
      {sent && !error && (
        <p className="rpf rpf-sub" role="status" data-testid="fact-sent">
          {hc(locale, "factSent", { dad })}
        </p>
      )}
      <FamilyDock>
        <FamilyButton type="submit" pending={pending} data-testid="fact-send">
          {hc(locale, "factSend", { dad })}
        </FamilyButton>
      </FamilyDock>
    </form>
  );
}

/** Her stream while this screen is open: his answer re-reads the list; her link's end goes back to /f. */
export function FactsLive({ linkId, since }: { linkId: string; since: number }) {
  const router = useRouter();
  const live = useFamilyStream(linkId, since, {
    onEvent: (e) => {
      if (e.type === "profile.fact_confirmed" || e.type === "profile.fact_changed") router.refresh();
    },
    onEnd: () => window.location.assign(`/f?link=${encodeURIComponent(linkId)}`),
  });
  return <span hidden data-testid="facts-live" data-live={live} />;
}
