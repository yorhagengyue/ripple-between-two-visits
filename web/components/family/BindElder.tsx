"use client";

/**
 * 「填长辈的账号」 (line bind): what /f shows a signed-in family member who follows nobody yet. She types the account
 * her elder signed up with, says how she calls him, and 「绑定」 links the two at once (POST /api/family/bind,
 * lib/care/bind.ts): her home opens with what the four default switches show, and his phone is told. In
 * FAMILY_BIND_MODE=confirm the same tap leaves the link waiting for his 「是她」, and the page that opens is the waiting
 * screen she would see after accepting an invitation.
 *
 * Drawn with the v3 pieces as her short sign-up is (components/family/HerAccount.tsx): 「Ripple」 at the top, one
 * sentence with its line, the field, three choices in a row, the one solid button, a note, 「退出登录」. The quiet line
 * above the sentence is where she stands (「你还没有在看谁的 Ripple。」: the screen's sentence before there was a form).
 *
 *   「用他的名字」 is the default and sends no label: the link then carries his own name. 「爸爸」 and 「妈妈」 send the word.
 *   A refusal is said in words under the field and changes nothing.
 *
 * Round two: the same form at /f?bind=1 for someone who already follows an elder, or did (from the screens of a link
 * that is over, and from 「我的」): the quiet line reads 「再绑定一位长辈」 and the top bar leads back. An elder who
 * removed her is refused in words: 「他已经解除了和你的绑定。想再绑定，请他在自己的手机上填你的账号。」
 */
import { useId, useState, type FormEvent } from "react";
import { FamilyButton, FamilyDock, FamilyHero, FamilyNote, FamilyScreen, FamilyTop } from "@/components/family-ui";
import { clockTime } from "@/lib/auth/copy";
import { bc, bindRefusal } from "@/lib/care/bind-copy";
import type { Locale } from "@/lib/i18n";
import { LogoutButton } from "./HerBits";
import "./her-bind.css";

type Calls = "dad" | "mum" | "name";
const CALLS: readonly { key: Calls; word: "callsDad" | "callsMum" | "callsName" }[] = [
  { key: "dad", word: "callsDad" },
  { key: "mum", word: "callsMum" },
  { key: "name", word: "callsName" },
];

export function BindElder({
  locale,
  langHref,
  testState,
  title,
  back,
}: {
  locale: Locale;
  langHref: string;
  /** the page's state for the tests (data-state on the wrapper): "no_link", or "bind_again" (/f?bind=1) */
  testState: string;
  /** where she stands, said quietly above the form's own sentence */
  title: string;
  /**
   * Round two: she opened the form from a screen of her own (an ended link, 「我的」): the top bar is the way back in
   * the place of 「Ripple」, and 「退出登录」 is left to 「我的」.
   */
  back?: { href: string; label: string };
}) {
  const ids = useId();
  const [account, setAccount] = useState("");
  const [calls, setCalls] = useState<Calls>("name");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const typed = account.trim();
    if (!typed) return setError(bc(locale, "herEmpty"));
    setPending(true);
    const label = calls === "dad" ? bc(locale, "callsDad") : calls === "mum" ? bc(locale, "callsMum") : undefined;
    let status = 0;
    let body: { next?: unknown; error?: string; until?: string } = {};
    try {
      const res = await fetch("/api/family/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(label ? { account: typed, label } : { account: typed }),
        credentials: "same-origin",
        cache: "no-store",
      });
      status = res.status;
      body = (await res.json().catch(() => ({}))) as typeof body;
    } catch {
      // offline: said below like any other failure
    }
    if (status === 200 && typeof body.next === "string" && body.next.startsWith("/f")) {
      // her home for this link (or, in confirm mode, the screen that waits for him)
      window.location.assign(body.next);
      return;
    }
    setPending(false);
    // her chip's word says him in the refusal too (「她已经解除了…」); 「用他的名字」 sends none: the plain 他
    setError(bindRefusal(locale, "family", body.error, clockTime(body.until, locale), label));
  }

  return (
    <div className="contents" data-testid="family-app" data-state={testState}>
      <FamilyScreen locale={locale}>
        {back ? <FamilyTop back={back} locale={locale} langHref={langHref} /> : <FamilyTop brand locale={locale} langHref={langHref} />}
        <form onSubmit={submit} className="rpf-col" noValidate data-testid="bind-form">
          <p className="rpf rpfb-kicker" data-testid="bind-where">
            {title}
          </p>
          <FamilyHero tone="quiet" title={bc(locale, "herTitle")} detail={bc(locale, "herBody")} />
          <label className="rpf rpf-field">
            <span className="rpf-label">{bc(locale, "herField")}</span>
            <input
              className="rpf-input"
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                if (error) setError(null);
              }}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={254}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${ids}-err` : undefined}
              data-testid="bind-account"
            />
          </label>
          {error && (
            <p className="rpf rpf-error" role="alert" id={`${ids}-err`} data-testid="bind-error">
              {error}
            </p>
          )}
          <div className="rpf rpf-field">
            <span className="rpf-label" id={`${ids}-calls`}>
              {bc(locale, "herCalls")}
            </span>
            <div className="rpfb-choices" role="radiogroup" aria-labelledby={`${ids}-calls`} data-testid="bind-calls">
              {CALLS.map((c) => (
                <button key={c.key} type="button" role="radio" aria-checked={calls === c.key} data-choice={c.key} onClick={() => setCalls(c.key)}>
                  {bc(locale, c.word)}
                </button>
              ))}
            </div>
          </div>
          <FamilyDock foot="b">
            <FamilyButton type="submit" pending={pending} data-testid="bind-submit">
              {bc(locale, "bind")}
            </FamilyButton>
            <FamilyNote>{bc(locale, "herNoAccount")}</FamilyNote>
            {!back && <LogoutButton locale={locale} />}
          </FamilyDock>
        </form>
      </FamilyScreen>
    </div>
  );
}
