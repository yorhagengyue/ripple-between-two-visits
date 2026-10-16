"use client";

/**
 * The line at the top of his Today page after his password was reset (docs/plan/real-app.md 2.4, 3.6; track A):
 * 「你的密码在 10月9日 20:15 用恢复码重设过。」 or 「… 由 Wei Ling 协助重设。」, what to do if it was not him, and 「知道了」.
 * Said once: 「知道了」 tells the server (POST /api/auth/notice-seen) and the line does not come back. The sentence is
 * built on the server (lib/auth/notices.ts passwordResetNotice); this only shows it. Elder side (.rpa-*).
 */
import { useState } from "react";
import { callAccount } from "@/lib/auth/client-api";
import type { ResetNotice } from "@/lib/auth/notices";
import "./account.css";

export function ResetNoticeLine({ notice }: { notice: ResetNotice }) {
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (gone) return null;
  return (
    <div className="rpu rpa-notice" role="status" data-testid="reset-notice" data-method={notice.method}>
      <p className="rpa-notice-text" data-rp-role="body">
        {notice.text}
      </p>
      <p className="rpa-notice-hint">{notice.hint}</p>
      <button
        type="button"
        className="rpa-text-button"
        disabled={busy}
        data-testid="reset-notice-ok"
        onClick={async () => {
          setBusy(true);
          const r = await callAccount("/api/auth/notice-seen", { event: notice.event });
          setBusy(false);
          // a failed call leaves the line: it is said again next time rather than lost
          if (r.ok) setGone(true);
        }}
      >
        {notice.ok}
      </button>
    </div>
  );
}
