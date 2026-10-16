"use client";

/**
 * Her 「删除我的账号」 in her dark UI (C2 track H; laid out as the v3 draft's G5 by the fe-d track): the sentence, what
 * goes and what stays as short lines, an outlined button and a plain one. Kept from before the draft: the second screen
 * that asks for her password (POST /api/me/delete with confirm: true; a wrong password and the device lock read as
 * track A words them) and the last one, after which this phone is signed out.
 *
 * Every word is track H's (lib/privacy/copy.ts), not the draft's: 「删除我的账号」, 「删掉以后不能恢复。」, 「会删掉：」,
 * 「会留下：」, 「继续」, 「不删了」. The draft also says her recordings are deleted with her account, and they are not (they
 * stay in his Ripple as his records, with only her name on them).
 */
import { useState, type FormEvent } from "react";
import { DashList, EmptyBlock, FamilyButton, FamilyDock, FamilyHero, FamilyNote, FamilyScreen, FamilySection, FamilyTop } from "@/components/family-ui";
import { callAccount } from "@/lib/auth/client-api";
import { clockTime, errorWords } from "@/lib/auth/copy";
import { hc } from "@/lib/care/her-copy";
import { hCopy, type HLocale } from "@/lib/privacy/copy";

export function HerDeleteFlow({ locale, names, back, langHref }: { locale: HLocale; names: string[]; back: string; langHref: string }) {
  const c = hCopy(locale);
  const [step, setStep] = useState<"what" | "password" | "done">("what");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = names.join(locale === "zh-Hans" ? "、" : ", ");
  const backTop = { href: back, label: hc(locale, "meBack") };

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!password) return setError(errorWords("wrong_password", locale));
    setPending(true);
    const r = await callAccount<{ ok?: boolean }>("/api/me/delete", { password, confirm: true });
    setPending(false);
    if (r.ok) return setStep("done");
    setPassword("");
    const code = r.body.error ?? "unavailable";
    if (code === "wrong_password" || code === "locked" || code === "not_signed_in") return setError(errorWords(code, locale, clockTime(r.body.until, locale)));
    setError(c.delFailed);
  }

  if (step === "done") {
    return (
      <div className="contents" data-testid="her-delete-done">
        <FamilyScreen locale={locale}>
          <FamilyTop brand locale={locale} />
          <EmptyBlock title={c.herDelDoneTitle} detail={c.herDelDoneLede} />
          <FamilyDock foot="e">
            <FamilyButton href="/" variant="secondary" data-testid="her-delete-home">
              {c.delDoneHome}
            </FamilyButton>
          </FamilyDock>
        </FamilyScreen>
      </div>
    );
  }

  if (step === "password") {
    return (
      <div className="contents" data-testid="her-delete-password">
        <FamilyScreen locale={locale}>
          <FamilyTop locale={locale} back={backTop} />
          <form onSubmit={submit} className="rpf-col" noValidate>
            <FamilyHero tone="quiet" title={c.herDelStepTitle} detail={c.herDelStepLede} />
            <label className="rpf rpf-field">
              <span className="rpf-label">{c.delPassword}</span>
              <input className="rpf-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" data-testid="her-delete-input" />
            </label>
            {error && (
              <p className="rpf rpf-error" role="alert" data-testid="her-delete-error">
                {error}
              </p>
            )}
            <FamilyDock foot="b">
              <FamilyButton type="submit" variant="secondary" pending={pending} data-testid="her-delete-submit">
                {pending ? c.delWorking : c.herDelButton}
              </FamilyButton>
              <FamilyButton href={back} nav="back" variant="quiet" data-testid="her-delete-cancel">
                {c.delCancel}
              </FamilyButton>
            </FamilyDock>
          </form>
        </FamilyScreen>
      </div>
    );
  }

  const goes = [...c.herDelItems, ...(names.length ? [c.herDelLinks(who)] : [])];
  const stays = names.length ? [c.herDelClips(who), c.herDelLooks(who)] : [];
  return (
    <div className="contents" data-testid="her-delete-what">
      <FamilyScreen locale={locale}>
        <FamilyTop locale={locale} back={backTop} langHref={langHref} />
        <FamilyHero tone="quiet" title={c.herDelTitle} detail={c.herDelLede} />
        <FamilySection>{c.herDelWhat}</FamilySection>
        <DashList items={goes} data-testid="her-delete-goes" />
        {stays.length > 0 && (
          <>
            <FamilySection>{c.herDelStays}</FamilySection>
            <DashList items={stays} data-testid="her-delete-stays" />
          </>
        )}
        <FamilyNote style={{ marginTop: 16 }}>{c.delBackups}</FamilyNote>
        <FamilyDock foot="b">
          <FamilyButton variant="secondary" onClick={() => setStep("password")} data-testid="her-delete-continue">
            {c.delContinue}
          </FamilyButton>
          <FamilyButton href={back} nav="back" variant="quiet" data-testid="her-delete-keep">
            {c.delCancel}
          </FamilyButton>
        </FamilyDock>
      </FamilyScreen>
    </div>
  );
}
