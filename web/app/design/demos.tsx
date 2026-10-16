"use client";

/** Live specimens for the /design gallery: tap them to see the state change. Not app code. */
import { useEffect, useState } from "react";
import { ReminderRecorder, type RecorderState } from "@/components/family-ui";
import { AskVoice, BpKeypad, FamilySwitchRow, PageHeader, type VoiceState } from "@/components/ui";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * A header whose way back is a button (the second step of a flow goes back to its first, in place) and that carries
 * no 「我」: tap 「‹ 返回」 and the step changes without a navigation.
 */
export function BackDemo({ locale }: { locale: UiLocale }) {
  const [step, setStep] = useState<1 | 2>(2);
  const en = locale === "en";
  return step === 2 ? (
    <PageHeader title={en ? "A new password" : "换密码"} subtitle={en ? "Step 2 of 2" : "第 2 步，共 2 步"} back={{ onClick: () => setStep(1), testId: "demo-back" }} me={false} locale={locale} />
  ) : (
    <PageHeader title={en ? "A new password" : "换密码"} subtitle={en ? "Step 1 of 2" : "第 1 步，共 2 步"} right={<button type="button" className="rpu-chip-btn" onClick={() => setStep(2)}>{en ? "Next" : "下一步"}</button>} me={false} locale={locale} />
  );
}

/** The keypad, live: type, delete, move rows, save. */
export function KeypadDemo({ locale, initial }: { locale: UiLocale; initial?: { sys?: string; dia?: string; pul?: string; active?: "sys" | "dia" | "pul" } }) {
  const [saved, setSaved] = useState("");
  const en = locale === "en";
  return (
    <div>
      <BpKeypad
        locale={locale}
        initial={initial}
        onSubmit={(r) => setSaved(`${en ? "Would save" : "会记下"} ${r.systolic}/${r.diastolic}${r.pulse ? ` · ${en ? "pulse" : "心跳"} ${r.pulse}` : ""}`)}
      />
      <p className="rpd-demo-note" aria-live="polite">
        {saved}
      </p>
    </div>
  );
}

export interface SwitchSpec {
  name: string;
  title: string;
  description: string;
  on: boolean;
}

/** His switches, live (controlled: each tap flips one). */
export function SwitchesDemo({ locale, items, pendingName }: { locale: UiLocale; items: readonly SwitchSpec[]; pendingName?: string }) {
  const [state, setState] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.name, i.on])));
  return (
    <div className="rpu-toggles">
      {items.map((i) => (
        <FamilySwitchRow
          key={i.name}
          name={i.name}
          locale={locale}
          title={i.title}
          description={i.description}
          on={state[i.name]}
          pending={i.name === pendingName}
          onChange={(next) => setState((s) => ({ ...s, [i.name]: next }))}
        />
      ))}
    </div>
  );
}

/** Asking by voice, live: tap the mic (listening), tap again (heard), 重新说 starts over. */
export function VoiceDemo({ locale, heard }: { locale: UiLocale; heard: string }) {
  const [state, setState] = useState<VoiceState>("idle");
  return (
    <AskVoice
      locale={locale}
      state={state}
      heard={heard}
      showPrompt={false}
      onMic={() => setState((s) => (s === "listening" ? "heard" : "listening"))}
      onAgain={() => setState("listening")}
      onAsk={() => setState("idle")}
    />
  );
}

/** Her recorder, live with a fake clock: record, stop, listen, again, delete, use. */
export function RecorderDemo({ locale }: { locale: UiLocale }) {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (state !== "recording" && state !== "playing" && state !== "saving") return;
    const t = window.setInterval(() => {
      if (state === "recording") setSeconds((s) => s + 1);
      if (state === "playing")
        setProgress((p) => {
          if (p >= 1) {
            setState("recorded");
            return 0;
          }
          return Math.min(1, p + 0.25);
        });
      if (state === "saving") setState("saved");
    }, 1000);
    return () => window.clearInterval(t);
  }, [state]);
  return (
    <ReminderRecorder
      locale={locale}
      state={state}
      playsAt="8:45"
      elapsed={`0:${String(seconds).padStart(2, "0")}`}
      progress={progress}
      onStart={() => {
        setSeconds(0);
        setState("recording");
      }}
      onStop={() => setState("recorded")}
      onListen={() => {
        setProgress(0);
        setState("playing");
      }}
      onPause={() => setState("recorded")}
      onAgain={() => {
        setSeconds(0);
        setState("recording");
      }}
      onDelete={() => setState("deleted")}
      onUse={() => setState("saving")}
    />
  );
}
