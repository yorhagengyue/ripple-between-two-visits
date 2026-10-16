"use client";

/**
 * The error screen for a fault in the root layout itself (front-end line fe-12). app/error.tsx cannot draw that one:
 * a root error file sits inside the root layout, so when the layout fails there is nothing for it to sit in, and the
 * framework would show its own English page. This file replaces the root layout while it is active (Next.js 16;
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md, "Global Error"): it brings its own
 * <html> and <body> and gets none of the app's CSS or fonts. The screen is the same one (components/site/
 * FaultScreen.tsx), which carries every size and colour itself for exactly this case.
 */
import { FaultScreen } from "@/components/site/FaultScreen";

export default function GlobalError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  return (
    <html lang="zh-Hans">
      <body style={{ margin: 0, background: "#F2F5F9" }}>
        <title>Ripple</title>
        <FaultScreen fault={error} retry={retry ?? reset} />
      </body>
    </html>
  );
}
