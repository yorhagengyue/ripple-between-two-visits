/**
 * Shown on session pages when this device is not in a (live) session. Phone variant for /p/* and /f, desktop variant for
 * /backstage and /director (the crew's pages).
 *
 * C2 (real-app 5.2): joining with a code is the film crew's (the /join page answers 404 to anyone else), so the phone
 * variant offers it only to a crew browser. Everyone else is offered signing in to their own account, or a demo copy of
 * Mr Tan's phone of their own. (A browser with no cookie at all never gets here: the proxy sends /p/* to /login.)
 */
import Link from "next/link";
import { isCrewPage } from "@/lib/crew/gate";
import { t, type Locale } from "@/lib/i18n";
import { StartSessionButton } from "./StartSession";
// the phone variant is drawn in the demo phone's look (the .rp-patient scope)
import "@/components/patient/demo-phone.css";

const PUBLIC_WORDS: Record<Locale, { title: string; body: string; signIn: string; sandbox: string }> = {
  "zh-Hans": { title: "这台手机还没有登录", body: "登录你自己的账号，或者开一份陈先生的演示资料来看看。", signIn: "登录", sandbox: "看陈先生的演示" },
  en: { title: "This phone is not signed in", body: "Sign in to your own account, or open a demo copy of Mr Tan's phone to look around.", signIn: "Sign in", sandbox: "See Mr Tan's demo" },
};

export async function NoSessionPhone({ locale }: { locale: Locale }) {
  const crew = await isCrewPage();
  if (!crew) {
    const w = PUBLIC_WORDS[locale];
    return (
      <div className="rp-patient px-5 py-10" lang={locale} data-testid="no-session">
        <h1 className="text-[26px] font-bold">{w.title}</h1>
        <p className="mt-3 text-body text-ink-2">{w.body}</p>
        <div className="mt-6 flex flex-col gap-3">
          <Link href="/login" className="rp-btn rp-btn-accent flex min-h-14 items-center justify-center text-body" data-testid="no-session-sign-in">
            {w.signIn}
          </Link>
          <StartSessionButton body={{ kind: "sandbox", role: "patient" }} label={w.sandbox} className="rp-btn rp-btn-ghost min-h-14 text-body" testId="start-sandbox" locale={locale} />
        </div>
      </div>
    );
  }
  return (
    <div className="rp-patient px-5 py-10" lang={locale} data-testid="no-session">
      <h1 className="text-[26px] font-bold">{t(locale, "noSession.title")}</h1>
      <p className="mt-3 text-body text-ink-2">{t(locale, "noSession.body")}</p>
      <div className="mt-6 flex flex-col gap-3">
        <Link href="/join" className="rp-btn rp-btn-accent flex min-h-14 items-center justify-center text-body">
          {t(locale, "noSession.join")}
        </Link>
        <StartSessionButton
          body={{ kind: "sandbox", role: "patient" }}
          label={t(locale, "noSession.sandbox")}
          className="rp-btn rp-btn-ghost min-h-14 text-body"
          testId="start-sandbox"
          locale={locale}
        />
      </div>
    </div>
  );
}

export function NoSessionDesk({ allowFilming = false }: { allowFilming?: boolean }) {
  return (
    <div className="mx-auto max-w-xl py-16" data-testid="no-session">
      <h1 className="text-3xl font-bold">No session on this device</h1>
      <p className="mt-3 text-lg text-ink-2">
        Join the filming session with its code, or start a new one. Phones then join with the code shown on the
        director screen.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        {allowFilming ? (
          <StartSessionButton
            body={{ kind: "filming", role: "director" }}
            label="New filming session"
            className="rp-btn rp-btn-accent text-lg"
            testId="new-filming-session"
          />
        ) : null}
        <Link href="/join" className="rp-btn rp-btn-ghost text-lg">
          Join with a code
        </Link>
        <StartSessionButton
          body={{ kind: "sandbox", role: "judge" }}
          label="Start a sandbox"
          className="rp-btn rp-btn-ghost text-lg"
          testId="start-sandbox"
        />
      </div>
    </div>
  );
}
