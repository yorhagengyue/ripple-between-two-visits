"use client";

/**
 * The visit pages could not be drawn (the timeline draft's 通用-2 「出错（看诊页）」; web/progress/fe-05.md): the visit
 * tab's own header and tab bar, a red-bordered box that says what did not open and what is still there, 「再试一次」
 * first, 「先看今天」 as the other way on. No apology, no error code, never the error's own text.
 *
 * When the reason is that the store could not be read (lib/subject/unavailable.ts StoreUnavailable, which the page's
 * subject throws; real-app 2.25 「存储读不到：照旧拒绝，不放行」) the box says that fixed sentence instead, word for word,
 * and keeps the app's hook for it (data-testid="store-unavailable"). The language follows the phone, as app/error.tsx
 * does (an error boundary gets no props from the server).
 */
import { useSyncExternalStore } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import { PageHeader, Screen, SecondaryButton, TabBar } from "@/components/ui";
import { Problem } from "@/components/visit/elder/parts";
import { vw } from "@/components/visit/elder/words";
import { STORE_UNAVAILABLE_WORDS } from "@/lib/subject/unavailable";
import { uiCopy } from "@/lib/ui/copy";

type Lang = keyof typeof STORE_UNAVAILABLE_WORDS;

function phoneLanguage(): Lang {
  if (typeof document === "undefined") return "zh-Hans";
  const cookie = /(?:^|;\s*)rp_lang=([^;]+)/.exec(document.cookie)?.[1];
  if (cookie === "en" || cookie === "zh-Hans") return cookie;
  return (navigator.language || "").toLowerCase().startsWith("en") ? "en" : "zh-Hans";
}

export default function VisitError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  // the phone's language is only known in the browser (华语 until then)
  const lang = useSyncExternalStore<Lang>(
    () => () => undefined,
    phoneLanguage,
    () => "zh-Hans",
  );
  const copy = uiCopy(lang);
  const store = error?.digest === "RIPPLE_STORE_UNAVAILABLE";
  const words = STORE_UNAVAILABLE_WORDS[lang];
  // his own account draws its screens itself; the demo's visit page sits inside the demo's frame (its own header and tabs)
  const account = useLiveSession().session.kind === "account";
  const box = (
      <div className="rpu rpu-stack" data-testid={store ? "store-unavailable" : "visit-problem"}>
        <Problem
          title={store ? words.title : vw(lang, "problem.title")}
          retryLabel={store ? words.retry : copy.retry}
          // ask the server for the page again (Next 16: `retry`; `reset` only clears the error)
          onRetry={() => (retry ?? reset)?.()}
          retryTestId={store ? "store-unavailable-retry" : "visit-problem-retry"}
          other={
            <SecondaryButton href="/p/today" data-testid="visit-problem-today">
              {vw(lang, "problem.today")}
            </SecondaryButton>
          }
        >
          {store ? words.body : vw(lang, "problem.kept")}
        </Problem>
      </div>
  );
  if (!account) return box;
  return (
    <Screen locale={lang} tabBar={<TabBar active="visit" locale={lang} />} tabBarPlacement="fixed">
      <PageHeader title={copy.tabs.visit} locale={lang} />
      {box}
    </Screen>
  );
}
