"use client";

/**
 * Her own account's three small screens under 「我的」 (the fe-d track; D:/ripple-c2/frontend/known-ui-gaps.md, FE 4):
 * a new password, the devices she signed in on, a new recovery code. 「我的」 has one row for them, 「登录和设备」; the
 * other two are opened from that screen (owner's tidy of 10-13). She could not reach his (/p/me/password,
 * /p/me/devices, /p/me/recovery): app/p/layout.tsx sends an account without a space of its own back to /f.
 *
 * The routes are the account's own (track A) and know the person by the sign-in, not by a space, so they serve her as
 * they serve him: POST /api/auth/password, POST /api/auth/devices/sign-out, POST /api/auth/logout,
 * POST /api/auth/recovery-code. What each screen does, what it checks before it asks the server, and every word are
 * his three flows' (app/p/me/password/PasswordFlow.tsx, app/p/me/devices/DevicesScreen.tsx,
 * app/p/me/recovery/RecoveryCodeFlow.tsx, through the same lib/auth/copy.ts, lib/auth/passwords.ts and
 * lib/auth/read-aloud-text.ts); the look is hers (components/family-ui). His three files are not touched.
 *
 * Not on hers: the card to print and 「读给我听」 on the new code, which are his (a paper card in his drawer, the screen
 * read to him).
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { DayMark, FactRow, FactRows, FamilyButton, FamilyDock, FamilyHero, FamilyNote, FamilyScreen, FamilySection, FamilyTop } from "@/components/family-ui";
import type { DeviceView, RecoveryCodeAnswer } from "@/lib/auth/api";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, clockTime, dayAndTime, errorWords, type AccountCopy } from "@/lib/auth/copy";
import { passwordProblem } from "@/lib/auth/passwords";
import { readAloudLines } from "@/lib/auth/read-aloud-text";
import { hc } from "@/lib/care/her-copy";
import type { Locale } from "@/lib/i18n";
import { forgetThisPhone } from "@/lib/offline/forget";
import { forgetPushOnSignOut } from "@/lib/push/client";

/** A password field in her look: the name above, the field, and 「显示密码」 / 「隐藏密码」 at its right (his field's own words). */
function PasswordInput({ c, label, value, onChange, fresh = false, testId }: { c: AccountCopy; label: string; value: string; onChange: (v: string) => void; /** a new password is being chosen */ fresh?: boolean; testId: string }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="rpf rpf-field">
      <label className="rpf-label" htmlFor={id}>
        {label}
      </label>
      <div className="rpf-inputwrap">
        <input
          id={id}
          className="rpf-input"
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={fresh ? "new-password" : "current-password"}
          autoCapitalize="none"
          spellCheck={false}
          data-testid={testId}
        />
        <button type="button" className="rpf-inputact" onClick={() => setShown(!shown)} aria-pressed={shown} data-testid={`${testId}-show`}>
          {shown ? c.hidePassword : c.showPassword}
        </button>
      </div>
    </div>
  );
}

/** A thing that is done: the teal tick, the sentence, the line under it (as the saved recording's screen). */
function Done({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rpf rpf-empty" style={{ gap: 18 }}>
      <p className="rpf-empty-mark" data-kind="done" style={{ margin: 0 }}>
        <DayMark mark="taken" size={32} />
      </p>
      <h1 className="rpf-h1" data-testid="family-headline">
        {title}
      </h1>
      {detail && (
        <p className="rpf-sub" data-testid="family-lede">
          {detail}
        </p>
      )}
    </div>
  );
}

interface ScreenProps {
  locale: Locale;
  /** 「我的」 */
  back: string;
  langHref: string;
}

/** 「我的 → 改密码」: her current password and a new one; then every other device is signed out and this phone stays signed in. */
export function HerPasswordFlow({ locale, back, langHref }: ScreenProps) {
  const c = accountCopy(locale);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const top = { href: back, label: hc(locale, "meBack") };

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!current) return setError(errorWords("wrong_password", locale));
    // a password that is too short, too long or too common is stopped here, with the reason (as on his screen)
    const problem = passwordProblem(password);
    if (problem) return setError(errorWords(problem, locale));
    setPending(true);
    const r = await callAccount<{ ok: boolean }>("/api/auth/password", { current, password });
    setPending(false);
    if (r.ok) return setDone(true);
    setCurrent("");
    setError(errorWords(r.body.error ?? "unavailable", locale, clockTime(r.body.until, locale)));
  }

  if (done) {
    return (
      <div className="contents" data-testid="her-password" data-state="done">
        <FamilyScreen locale={locale}>
          <FamilyTop back={top} locale={locale} />
          <Done title={c.passwordDoneTitle} detail={c.passwordDoneLede} />
          <FamilyDock foot="e">
            <FamilyButton href={back} nav="back" data-testid="her-password-done-ok">
              {c.done}
            </FamilyButton>
          </FamilyDock>
        </FamilyScreen>
      </div>
    );
  }

  return (
    <div className="contents" data-testid="her-password" data-state="form">
      <FamilyScreen locale={locale}>
        <FamilyTop back={top} locale={locale} langHref={langHref} />
        <form onSubmit={onSubmit} className="rpf-col" noValidate>
          <FamilyHero tone="quiet" title={c.passwordPageTitle} detail={c.passwordLede} />
          <PasswordInput c={c} label={c.currentPassword} value={current} onChange={setCurrent} testId="her-password-current" />
          <PasswordInput c={c} fresh label={c.newPassword} value={password} onChange={setPassword} testId="her-password-new" />
          {error && (
            <p className="rpf rpf-error" role="alert" data-testid="her-password-error">
              {error}
            </p>
          )}
          <FamilyDock foot="c">
            <FamilyButton type="submit" pending={pending} data-testid="her-password-save">
              {c.savePassword}
            </FamilyButton>
          </FamilyDock>
        </form>
      </FamilyScreen>
    </div>
  );
}

/**
 * 「我的 → 登录和设备」: every device she signed in on, this one first; a sign-in still open on another device can be
 * ended from here (「退出这台」), and so can every sign-in at once (「退出所有设备」, this phone too). Nothing asks "are you
 * sure": signing out is undone by signing in again. 「退出登录」 for this phone alone is a row of 「我的」.
 *
 * Above the list, two rows lead to 「改密码」 and 「换一个恢复码」, as the second card of his screen does
 * (app/p/me/devices/DevicesScreen.tsx): they were rows of 「我的」, which now has this screen's row alone (owner's tidy
 * of 10-13). They keep the testids they had there.
 */
export function HerDevicesScreen({
  locale,
  back,
  langHref,
  devices,
  passwordHref,
  recoveryHref,
}: ScreenProps & { devices: DeviceView[]; /** 「改密码」 (/f/me/password) */ passwordHref: string; /** 「换一个恢复码」 (/f/me/recovery) */ recoveryHref: string }) {
  const router = useRouter();
  const c = accountCopy(locale);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signOutDevice(ref: string) {
    setBusy(ref);
    setError(null);
    const r = await callAccount<{ ended: number; current: boolean }>("/api/auth/devices/sign-out", { device: ref });
    setBusy(null);
    if (!r.ok) return setError(errorWords(r.body.error ?? "unavailable", locale));
    if (r.body.current) {
      await forgetThisPhone(); // this phone's own sign-in ended: what it kept for her goes too
      return window.location.assign("/login");
    }
    router.refresh();
  }

  async function logoutEverywhere() {
    setBusy("all");
    setError(null);
    await forgetPushOnSignOut(true); // while her sign-in still counts; never throws
    const r = await callAccount<{ next: string }>("/api/auth/logout", { everywhere: true });
    if (!r.ok) {
      setBusy(null);
      return setError(errorWords(r.body.error ?? "unavailable", locale));
    }
    await forgetThisPhone(); // Dad's number per link, the welcome marks, the page cache
    window.location.assign(r.body.next || "/login");
  }

  return (
    <div className="contents" data-testid="her-devices">
      <FamilyScreen locale={locale}>
        <FamilyTop back={{ href: back, label: hc(locale, "meBack") }} locale={locale} langHref={langHref} />
        <FamilyHero tone="quiet" title={c.devicesTitle} />
        <FactRows kind="settings">
          <FactRow label={c.changePassword} value="" href={passwordHref} data-testid="me-password" />
          <FactRow label={c.recoveryCode} value="" href={recoveryHref} data-testid="me-recovery" />
        </FactRows>
        <FamilySection>{c.devicesLabel}</FamilySection>
        {devices.length === 0 ? (
          <p className="rpf rpf-sub">{c.devicesNone}</p>
        ) : (
          <ul className="rpf rpf-items" data-kind="devices" data-testid="her-device-list">
            {devices.map((d) => (
              <li key={d.ref} className="rpf-item" data-testid="her-device-row" data-current={d.current ? "true" : undefined} data-signed-in={d.signed_in ? "true" : "false"}>
                <div className="rpf-item-main">
                  <div>
                    <p className="rpf-item-name">{d.label ?? c.deviceUnknown}</p>
                    <p className="rpf-item-sub">
                      {d.current ? c.deviceThis : d.signed_in ? c.deviceSignedIn(dayAndTime(d.last_seen_at, locale)) : c.deviceSignedOut(dayAndTime(d.last_seen_at, locale))}
                      {d.signed_in && d.ephemeral ? ` · ${c.deviceEphemeral}` : ""}
                    </p>
                  </div>
                  {!d.current && d.signed_in && (
                    <FamilyButton size="small" variant="secondary" onClick={() => void signOutDevice(d.ref)} pending={busy === d.ref} data-testid="her-device-sign-out">
                      {c.deviceSignOut}
                    </FamilyButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="rpf rpf-error" role="alert" data-testid="her-devices-error">
            {error}
          </p>
        )}
        <FamilyDock foot="b" style={{ gap: 12 }}>
          <FamilyButton variant="secondary" onClick={() => void logoutEverywhere()} pending={busy === "all"} data-testid="her-logout-everywhere">
            {c.logoutAll}
          </FamilyButton>
          <FamilyNote>{c.logoutAllNote}</FamilyNote>
        </FamilyDock>
      </FamilyScreen>
    </div>
  );
}

/** 「我的 → 换一个恢复码」: a new recovery code after her password; the old code stops working. The new one is shown once. */
export function HerRecoveryFlow({ locale, back, langHref }: ScreenProps) {
  const c = accountCopy(locale);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const top = { href: back, label: hc(locale, "meBack") };

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!password) return setError(errorWords("wrong_password", locale));
    setPending(true);
    const r = await callAccount<RecoveryCodeAnswer>("/api/auth/recovery-code", { password });
    setPending(false);
    setPassword("");
    if (r.ok) return setCode(r.body.recovery_code);
    setError(errorWords(r.body.error ?? "unavailable", locale, clockTime(r.body.until, locale)));
  }

  if (code) {
    // the same sentences as his screen after a new code (lib/auth/read-aloud-text.ts)
    const [codeTitle, codeWarning, codeLede, codeNoOther] = readAloudLines("recovery_code_new", locale);
    return (
      <div className="contents" data-testid="her-recovery" data-state="code">
        <FamilyScreen locale={locale}>
          <FamilyTop back={top} locale={locale} />
          <FamilyHero tone="quiet" title={codeTitle} />
          <p className="rpf rpf-code" data-testid="her-recovery-code" aria-label={`${c.cardCode}: ${code.split("").join(" ")}`}>
            {code}
          </p>
          <p className="rpf rpf-sub" style={{ marginTop: 22, color: "var(--rpf-ink)" }}>
            {codeWarning}
          </p>
          <p className="rpf rpf-sub">{codeLede}</p>
          <p className="rpf rpf-sub">{codeNoOther}</p>
          <FamilyDock foot="e">
            <FamilyButton href={back} nav="back" data-testid="her-recovery-kept">
              {c.codeKept}
            </FamilyButton>
          </FamilyDock>
        </FamilyScreen>
      </div>
    );
  }

  return (
    <div className="contents" data-testid="her-recovery" data-state="form">
      <FamilyScreen locale={locale}>
        <FamilyTop back={top} locale={locale} langHref={langHref} />
        <form onSubmit={onSubmit} className="rpf-col" noValidate>
          <FamilyHero tone="quiet" title={c.codePageTitle} detail={c.codePageLede} />
          <PasswordInput c={c} label={c.yourPassword} value={password} onChange={setPassword} testId="her-recovery-password" />
          {error && (
            <p className="rpf rpf-error" role="alert" data-testid="her-recovery-error">
              {error}
            </p>
          )}
          <FamilyDock foot="c">
            <FamilyButton type="submit" pending={pending} data-testid="her-recovery-new">
              {c.codePageButton}
            </FamilyButton>
          </FamilyDock>
        </form>
      </FamilyScreen>
    </div>
  );
}
