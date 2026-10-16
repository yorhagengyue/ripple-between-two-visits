"use client";

/**
 * 「爸爸在重设密码，要帮他吗？」 on her phone (C2 track A, a small section of its own in track D's folder; real-app 2.4
 * steps 3 and 4, 3.6). Only while he has switched her on as his helper AND he is asking right now.
 *
 *   useResetHelp(linkId, active)   asks GET /api/family/links/[id]/reset-code every few seconds while her page is in
 *                                  front (it reads nothing of his records). `show` is true while he asks and she has
 *                                  not put this request aside.
 *   <ResetHelpScreen>              one thing on the screen: the question, 「帮」 and 「现在不帮」. 「帮」 asks the server
 *                                  for the 6-digit code (POST, in that answer only) and shows it large, with what to do:
 *                                  read it to him; he types it on his own phone. She never sees his password.
 *
 * Daughter side: components/family-ui only (the v3 draft's look; this screen is not in the draft), her 16px text and 44px targets. The words are fixed copy and
 * live here (her other copy is track D's lib/care/her-copy.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FamilyButton, FamilyDock, FamilyHero, FamilyNote, FamilyScreen, FamilyTop } from "@/components/family-ui";
import type { FamilyCodeAnswer, FamilyHelpState } from "@/lib/auth/api";
import { elderWords, type ElderWords } from "@/lib/care/copy";
import type { Locale } from "@/lib/i18n";

const POLL_MS = 5_000;
const IDLE_POLL_MS = 60_000;

// `w`: how her screens say him (lib/care/copy.ts elderWords: her word, and 他 / 她 by it, or the word itself for a name)
const WORDS = {
  "zh-Hans": {
    ask: (w: ElderWords) => `${w.dad}在重设密码，要帮${w.him}吗？`,
    askBody: (w: ElderWords) => `点「帮」以后，这里会出现一个 6 位数。把它念给${w.dad}，${w.he}在自己的手机上输入。你看不到${w.his}密码。`,
    help: "帮",
    notNow: "现在不帮",
    codeTitle: (w: ElderWords) => `把这 6 个数字念给${w.dad}`,
    codeBody: (w: ElderWords, time: string) => `${w.dad}要在${w.he}点「请家人帮忙」的那台手机上输入。${time} 以前有效，只能用一次。`,
    codeNote: "不要把这个数发给别人。",
    done: "好了",
    codeLabel: "6 位数",
    tooMany: (w: ElderWords) => `今天帮的次数用完了，明天再试。也可以请${w.him}用恢复码。`,
    gone: (w: ElderWords) => `${w.dad}现在没有在重设密码了。`,
    failed: "没拿到，再试一次。",
  },
  en: {
    ask: (w: ElderWords) => `${w.dad} is resetting ${w.his} password. Help ${w.him}?`,
    askBody: (w: ElderWords) => `After you tap Help, a 6-digit number appears here. Read it to ${w.dad}; ${w.he} types it on ${w.his} own phone. You never see ${w.his} password.`,
    help: "Help",
    notNow: "Not now",
    codeTitle: (w: ElderWords) => `Read these 6 digits to ${w.dad}`,
    codeBody: (w: ElderWords, time: string) => `${w.dad} types them on the phone where ${w.he} tapped “Ask family to help”. They work until ${time}, once.`,
    codeNote: "Do not send this number to anyone else.",
    done: "Done",
    codeLabel: "6-digit number",
    tooMany: (w: ElderWords) => `No more help today. Try again tomorrow, or ${w.he} can use ${w.his} recovery code.`,
    gone: (w: ElderWords) => `${w.dad} is not resetting ${w.his} password any more.`,
    failed: "That did not work. Try again.",
  },
} as const;

export interface ResetHelp {
  /** he is asking and she has not put it aside: show the question instead of her home */
  show: boolean;
  expiresAt: string | null;
  /** 「现在不帮」 / 「好了」: this request is put aside (a new request asks again) */
  dismiss: () => void;
}

/** Is he asking her for help right now? Polls her own route while the page is visible. */
export function useResetHelp(linkId: string, active: boolean): ResetHelp {
  const [state, setState] = useState<FamilyHelpState | null>(null);
  const [aside, setAside] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async (): Promise<FamilyHelpState | null> => {
    try {
      const res = await fetch(`/api/family/links/${encodeURIComponent(linkId)}/reset-code`, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return null;
      const next = (await res.json()) as FamilyHelpState;
      setState(next);
      return next;
    } catch {
      return null;
    }
  }, [linkId]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const loop = async () => {
      const next = document.visibilityState === "visible" ? await check() : null;
      if (stopped) return;
      // while he has not switched her on there is nothing to wait for: look again once a minute
      timer.current = setTimeout(() => void loop(), next && !next.enabled ? IDLE_POLL_MS : POLL_MS);
    };
    void loop();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, check]);

  const expiresAt = state?.pending ? state.expires_at : null;
  return {
    show: active && !!state?.enabled && !!state.pending && !!expiresAt && aside !== expiresAt,
    expiresAt,
    dismiss: () => setAside(expiresAt ?? "none"),
  };
}

const clock = (iso: string, locale: Locale, tz: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-SG" : "zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(d);
};

/** The one screen: the question, then the code. */
export function ResetHelpScreen({ locale, linkId, dad, tz, langHref, onDone }: { locale: Locale; linkId: string; dad: string; tz: string; langHref?: string; onDone: () => void }) {
  const w = WORDS[locale === "en" ? "en" : "zh-Hans"];
  const him = elderWords(dad, locale === "en" ? "en" : "zh-Hans");
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState<FamilyCodeAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function help() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/family/links/${encodeURIComponent(linkId)}/reset-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as Partial<FamilyCodeAnswer> & { error?: string };
      if (res.ok && body.code && body.expires_at) setCode({ code: body.code, expires_at: body.expires_at });
      else setError(res.status === 429 ? w.tooMany(him) : body.error === "no_request" || body.error === "helper_off" || res.status === 403 || res.status === 404 ? w.gone(him) : w.failed);
    } catch {
      setError(w.failed);
    } finally {
      setPending(false);
    }
  }

  if (code) {
    return (
      <FamilyScreen locale={locale}>
        <FamilyTop brand locale={locale} langHref={langHref} />
        <FamilyHero tone="quiet" title={w.codeTitle(him)} detail={w.codeBody(him, clock(code.expires_at, locale, tz))} />
        <p className="rpf rpf-code" data-size="big" data-testid="reset-help-code" aria-label={`${w.codeLabel}: ${code.code.split("").join(" ")}`}>
          {code.code}
        </p>
        <FamilyNote>{w.codeNote}</FamilyNote>
        <FamilyDock foot="c">
          <FamilyButton onClick={onDone} data-testid="reset-help-done">
            {w.done}
          </FamilyButton>
        </FamilyDock>
      </FamilyScreen>
    );
  }
  return (
    <FamilyScreen locale={locale}>
      <FamilyTop locale={locale} langHref={langHref} />
      <FamilyHero tone="quiet" title={w.ask(him)} detail={w.askBody(him)} />
      {error && (
        <p className="rpf rpf-error" role="alert" data-testid="reset-help-error">
          {error}
        </p>
      )}
      <FamilyDock foot="b">
        <FamilyButton onClick={() => void help()} pending={pending} data-testid="reset-help-yes">
          {w.help}
        </FamilyButton>
        <FamilyButton variant="quiet" onClick={onDone} data-testid="reset-help-no">
          {w.notNow}
        </FamilyButton>
      </FamilyDock>
    </FamilyScreen>
  );
}
