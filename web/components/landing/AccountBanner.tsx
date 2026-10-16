"use client";

/**
 * On /demo when the browser is also signed in to an account (real-app 8.6 demo-with-account): the frame shows the demo
 * copy, never the account, and this line says so. "Back to my account" clears rp_view (DELETE /api/demo/view) and opens
 * /p/today, which is the account again, on its real date. Nothing tapped in the demo reaches the account.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AccountBanner() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function back() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/demo/view", { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      router.push("/p/today");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <section className="rp-card mb-5 flex flex-wrap items-center justify-between gap-3" data-testid="demo-account-banner" aria-label="Your own account">
      <p className="text-[18px]">
        <span className="font-semibold">
          Demo · <span lang="zh-Hans">演示中</span>
        </span>{" "}
        You are signed in to your own account. This page shows a separate copy of Mr Tan&apos;s story; nothing here touches your account.
      </p>
      <button type="button" className="rp-btn rp-btn-accent min-h-12 px-5 text-[18px]" disabled={busy} onClick={() => void back()} data-testid="demo-back-to-account">
        Back to my account · <span lang="zh-Hans">回到我的账号</span>
      </button>
      {failed ? (
        <p className="w-full text-[18px] text-ink-2" role="alert">
          That did not work. Try again.
        </p>
      ) : null}
    </section>
  );
}
