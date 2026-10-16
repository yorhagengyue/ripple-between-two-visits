"use client";

/**
 * How his one-time invitation link leaves his phone (C2 track I, follow-up, on track D's screen; real-app 2.19 step 3:
 * 「整行按钮『发给她』（系统分享，WhatsApp 等）、『复制』、二维码」; elder UI, components/ui):
 *
 *   InviteQr        the link as a QR code: she points her phone's camera at his screen (lib/crew/qr.ts draws it; no
 *                   request leaves the phone)
 *   InviteActions   「发给她」, full width: the phone's own share sheet where the browser has one (WhatsApp, Messages,
 *                   whatever she uses); where it has none, the same button is the WhatsApp link it always was. Then
 *                   「复制」, which says 「复制好了。」 when the link is on the clipboard.
 *
 * The button is a real link to WhatsApp either way (the address a browser without a share sheet follows); the share
 * sheet takes over on the tap when it exists, and a share sheet that fails falls back to that address.
 *
 * In the timeline draft's look (its 17-2; front-end line fe-fam): the two buttons are the draft's primary and secondary
 * with words only, and the code sits in the middle of a white card of its own under its one sentence.
 */
import { useMemo, useState } from "react";
import { SecondaryButton } from "@/components/ui";
import { encodeQr, qrSvgPath } from "@/lib/crew/qr";
import type { Locale } from "@/lib/i18n";
import "@/components/his-family/his-family.css";

const WORDS = {
  "zh-Hans": {
    send: "发给她",
    copy: "复制",
    copied: "复制好了。",
    copyFailed: "没复制成。可以让她扫上面的码。",
    qr: "或者让她用手机的相机扫这个码：",
    qrLabel: "邀请链接的二维码",
  },
  en: {
    send: "Send it to her",
    copy: "Copy",
    copied: "Copied.",
    copyFailed: "Could not copy. She can scan the code above instead.",
    qr: "Or let her scan this code with her phone's camera:",
    qrLabel: "QR code of the invitation link",
  },
} as const;

/**
 * The invitation link as a QR code, dark on white with its quiet zone, 200px so a camera reads it at arm's length. A
 * white card (the foundation's box) with the one sentence that says what to do with it; the code itself is styled by
 * .rph-qr (components/his-family/his-family.css).
 */
export function InviteQr({ url, locale }: { url: string; locale: Locale }) {
  const w = WORDS[locale === "en" ? "en" : "zh-Hans"];
  const qr = useMemo(() => {
    const code = encodeQr(url);
    return code ? qrSvgPath(code) : null;
  }, [url]);
  if (!qr) return null;
  return (
    <div className="rpu rpu-box rph-qr" data-variant="line" data-testid="invite-qr" data-rp="invite-qr">
      <p className="rpu-box-s">{w.qr}</p>
      <svg role="img" aria-label={w.qrLabel} viewBox={`0 0 ${qr.width} ${qr.width}`} shapeRendering="crispEdges">
        <rect width={qr.width} height={qr.width} fill="#FFFFFF" />
        <path d={qr.d} fill="#17191B" />
      </svg>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // not allowed here (an insecure address, a denied permission): the older way below
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  } catch {
    return false;
  }
}

export function InviteActions({ url, text, locale }: { url: string; text: string; locale: Locale }) {
  const w = WORDS[locale === "en" ? "en" : "zh-Hans"];
  const [copied, setCopied] = useState<boolean | null>(null);
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(text)}`;
  return (
    <>
      {copied !== null && (
        <p className="rpu rpu-banner" role={copied ? "status" : "alert"} data-testid="invite-copied" data-ok={copied ? "true" : "false"} style={{ margin: 0 }}>
          {copied ? w.copied : w.copyFailed}
        </p>
      )}
      <a
        className="rpu rpu-btn"
        data-rp="primary"
        data-variant="primary"
        data-testid="invite-whatsapp"
        href={whatsapp}
        onClick={(e) => {
          // the phone's own share sheet when there is one; otherwise the link itself (WhatsApp)
          if (typeof navigator === "undefined" || typeof navigator.share !== "function") return;
          e.preventDefault();
          navigator.share({ text }).catch((err: unknown) => {
            // he closed the sheet: nothing more. Anything else: the WhatsApp address, as without a share sheet
            if ((err as { name?: string } | null)?.name !== "AbortError") window.location.assign(whatsapp);
          });
        }}
      >
        <span>{w.send}</span>
      </a>
      <SecondaryButton data-testid="invite-copy" onClick={() => void copyText(url).then(setCopied)}>
        {w.copy}
      </SecondaryButton>
    </>
  );
}
