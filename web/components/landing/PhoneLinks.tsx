"use client";

/**
 * Under the phone on /demo (real-status: "首页没有给手机的链接和二维码"): open Mr Tan's phone of this copy full size in its
 * own tab (the same copy: rp_view=demo and the copy's cookie travel with this browser), and the address that starts the
 * real app on a judge's own phone, where sign-up offers Mr Tan's example data laid out on today's dates
 * (lib/crew/demo-view.ts PHONE_APP_PATH), as a QR code to scan (made on the server, lib/crew/qr.ts) and as text with a
 * button that copies it.
 */
import { useState } from "react";

export function PhoneLinks({ phoneAppUrl, qr }: { phoneAppUrl: string; qr?: { d: string; width: number } | null }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(phoneAppUrl);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  }

  return (
    <section className="rp-card flex w-full max-w-[432px] flex-col gap-3" data-testid="phone-links" aria-label="Open the phone">
      <a className="rp-btn rp-btn-ghost flex min-h-12 items-center justify-center text-[18px]" href="/p/today" target="_blank" rel="noopener" data-testid="open-phone-tab">
        Open Mr Tan&apos;s phone in its own tab
      </a>
      <div className="flex flex-col gap-1">
        <p className="text-[18px] font-semibold">Try the app on your own phone</p>
        <p className="text-[18px] text-ink-2">Scan the code or open this address on your phone, and choose Mr Tan&apos;s example data when you sign up:</p>
        {qr ? (
          <svg
            viewBox={`0 0 ${qr.width} ${qr.width}`}
            className="h-[168px] w-[168px] self-start bg-white"
            role="img"
            aria-label={`QR code of ${phoneAppUrl}`}
            shapeRendering="crispEdges"
            data-testid="phone-app-qr"
          >
            <rect width={qr.width} height={qr.width} fill="#ffffff" />
            <path d={qr.d} fill="#000000" />
          </svg>
        ) : null}
        <p className="font-mono text-[18px] break-all" data-testid="phone-app-url">
          {phoneAppUrl}
        </p>
        <button type="button" className="rp-btn rp-btn-ghost min-h-12 self-start px-4 text-[18px]" onClick={() => void copy()} data-testid="copy-phone-app-url">
          {copied === "yes" ? "Copied" : "Copy the address"}
        </button>
        {copied === "no" ? (
          <p className="text-[18px] text-ink-2" role="status">
            This browser did not let the page copy it; select the address above instead.
          </p>
        ) : null}
      </div>
    </section>
  );
}
