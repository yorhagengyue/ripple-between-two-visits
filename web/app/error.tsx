"use client";

/**
 * The app's error screen (C2 track A; docs/plan/real-app.md 2.25 「存储读不到：照旧拒绝，不放行」; relaid in the timeline
 * design by front-end line fe-12). When a page cannot be rendered, most of all when the store could not be read
 * (lib/subject getPageSubject throws StoreUnavailable; the proxy answers 503 with the same sentence when it sees it
 * first), the screen says so in one plain sentence, says that nothing was lost, and offers 「再试一次」 and a second way
 * on. It never shows a page built from a guess (an empty day, "no session") and never an error's own text. The screen
 * itself, and what it may and may not lean on, is components/site/FaultScreen.tsx.
 *
 * What a root error file is in this framework (Next.js 16; node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/error.md): a client component drawn inside the root layout (app/layout.tsx still stands: <html>,
 * <body>, the fonts, the app's CSS when it loaded) in place of everything below it: the nested layouts are gone with
 * the page (his tab bar and providers under /p, her frame under /f). A fault in the root layout itself never reaches
 * this file: app/global-error.tsx takes that one, with a document of its own.
 *
 * 「再试一次」 is the boundary's `retry` (stable since 16.3): it asks the server again and then redraws. `reset` only
 * redraws what failed, which for a fault on the server is the same fault again; it is kept as the fallback for a
 * framework that hands no `retry`.
 */
import { FaultScreen } from "@/components/site/FaultScreen";

export default function AppError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  return <FaultScreen fault={error} retry={retry ?? reset} />;
}
