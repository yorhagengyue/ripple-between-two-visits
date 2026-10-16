/**
 * Small pieces of track I's follow-up round (real-app 2.6, 2.19, 2.24) that need no browser:
 *
 *   - the manual's lines (/how) are the phone's own sentences: the iPhone's three steps come from the same copy as
 *     「我 › 提醒和通知」, in both languages, and say that iOS only delivers to a web app on the Home Screen;
 *   - the install offer's catch script is self-contained (no imports, runs once, holds the browser's banner back,
 *     tells the pages) and the root layout puts it before any page code;
 *   - an invitation link fits the QR encoder (lib/crew/qr.ts takes up to 213 bytes), with room for a long host name;
 *   - every kind his phone can get has its line in his list of recent reminders, and the opened route's kinds are
 *     split into his and hers with no overlap;
 *   - no notice kind asks the push service to hold it longer than the hour the design gives (the sender caps it).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { INVITE_MS, invitePath, newInviteToken } from "@/lib/care/tokens";
import { encodeQr, qrSvgPath } from "@/lib/crew/qr";
import { installManual, pushPageCopy } from "@/lib/push/copy";
import { HER_KIND, HIS_KINDS, OPENED_LOOKBACK_DAYS } from "@/lib/push/deliveries";
import { INSTALL_CATCH_SCRIPT, INSTALL_EVENT } from "@/lib/push/install-script";
import { MAX_HOLD_S } from "@/lib/push/sender";

const WEB = process.cwd();
const src = (...p: string[]) => readFileSync(path.join(WEB, ...p), "utf8");

describe("the manual's lines on reminders and the Home Screen", () => {
  it("are the phone's own three steps, in both languages, and say why an iPhone needs the Home Screen", () => {
    for (const locale of ["zh-Hans", "en"] as const) {
      const c = pushPageCopy(locale);
      const m = installManual(locale);
      expect(m.iphoneSteps).toEqual([c.iosStep1, c.iosStep2, c.iosStep3]);
      for (const line of [m.title, m.why, m.android, m.iphoneLead, m.then, ...m.iphoneSteps]) expect(line.trim().length).toBeGreaterThan(5);
      // nothing a manual page must not print (m8-backstage: no file paths, addresses or ports)
      expect(JSON.stringify(m)).not.toMatch(/127\.0\.0\.1|localhost|web\/|lib\/|\.json\b/);
    }
    expect(installManual("zh-Hans").why).toContain("苹果手机只给放在主屏幕上的网页 app 发通知");
    expect(installManual("en").why).toContain("iPhones only deliver notifications to a web app that was added to the Home Screen");
    expect(installManual("zh-Hans").android).toContain(pushPageCopy("zh-Hans").install);
    expect(installManual("en").android).toContain(pushPageCopy("en").install);
    expect(installManual("zh-Hans").then).toContain("提醒已经开好了");
  });

  it("/how mounts that section once and writes none of its sentences itself", () => {
    const page = src("app", "how", "page.tsx");
    expect(page.match(/<InstallManual \/>/g)).toHaveLength(1);
    expect(page).not.toContain("Add to Home Screen");
    expect(page).not.toContain("添加到主屏幕");
    expect(src("components", "push", "InstallManual.tsx")).toContain('from "@/lib/push/copy"');
  });
});

describe("Android's install offer is caught once for the whole app", () => {
  function run() {
    const listeners = new Map<string, ((e: unknown) => void)[]>();
    const told: string[] = [];
    const w: Record<string, unknown> = {
      addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      dispatchEvent: (e: { type: string }) => told.push(e.type),
    };
    const context = vm.createContext({ window: w, Event: class { constructor(readonly type: string) {} } });
    const fire = (type: string, e: unknown) => (listeners.get(type) ?? []).forEach((fn) => fn(e));
    return { w, told, listeners, fire, exec: () => vm.runInContext(INSTALL_CATCH_SCRIPT, context) };
  }

  it("keeps the offer on window, holds the browser's own banner back and tells the pages; installed clears it", () => {
    const { w, told, fire, exec } = run();
    exec();
    expect(w.__rpInstall).toEqual({ event: null, installed: false });
    let prevented = 0;
    const offer = { preventDefault: () => (prevented += 1) };
    fire("beforeinstallprompt", offer);
    expect(prevented).toBe(1);
    expect((w.__rpInstall as { event: unknown }).event).toBe(offer);
    expect(told).toEqual([INSTALL_EVENT]);
    fire("appinstalled", {});
    expect(w.__rpInstall).toEqual({ event: null, installed: true });
    expect(told).toEqual([INSTALL_EVENT, INSTALL_EVENT]);
  });

  it("runs once however often the script is on the page", () => {
    const { listeners, exec } = run();
    exec();
    exec();
    expect(listeners.get("beforeinstallprompt")).toHaveLength(1);
    expect(listeners.get("appinstalled")).toHaveLength(1);
  });

  it("is in the root layout before any page code, from a module with no imports", () => {
    const layout = src("app", "layout.tsx");
    expect(layout).toContain('strategy="beforeInteractive"');
    expect(layout).toContain("{INSTALL_CATCH_SCRIPT}");
    expect(layout.indexOf("{INSTALL_CATCH_SCRIPT}")).toBeLessThan(layout.indexOf("{children}"));
    expect(src("lib", "push", "install-script.ts")).not.toMatch(/^import /m);
    // the one place that listens: no page listens for the offer by itself any more
    expect(src("app", "p", "me", "notifications", "NotificationsScreen.tsx")).not.toContain("beforeinstallprompt");
  });
});

describe("his invitation link as a QR code", () => {
  it("fits the encoder with room for a long host name, and draws", () => {
    const t = newInviteToken();
    const p = invitePath(t.token);
    expect(INVITE_MS).toBe(7 * 24 * 3600 * 1000);
    for (const origin of ["http://localhost:3600", "https://ripple.example.sg", "https://a-rather-long-host-name-for-a-hackathon-demo.tail1234.ts.net"]) {
      const url = `${origin}${p}`;
      expect(Buffer.byteLength(url)).toBeLessThanOrEqual(213);
      const qr = encodeQr(url);
      expect(qr, url).not.toBeNull();
      const drawn = qrSvgPath(qr!);
      expect(drawn.width).toBe(qr!.size + 8);
      expect(drawn.d.split("M").length).toBeGreaterThan(300);
    }
  });
});

describe("the notice kinds", () => {
  it("his kinds and her alert do not overlap; a tap may still be recorded a week later", () => {
    expect([...HIS_KINDS].sort()).toEqual(["bp_due", "dose_first", "dose_second", "family_accepted", "visit_ready"]);
    expect(HIS_KINDS.has(HER_KIND)).toBe(false);
    expect(HER_KIND).toBe("family_no_reply");
    expect(OPENED_LOOKBACK_DAYS).toBe(7);
  });

  it("every kind his phone can get has its own words in his list of recent reminders", () => {
    const page = src("app", "p", "me", "notifications", "page.tsx");
    for (const kind of [...HIS_KINDS].filter((k) => !k.startsWith("dose_"))) expect(page, kind).toContain(`      ${kind}: `);
    // a kind without a medicine time is never looked up by its slot
    expect(page).toContain("named[r.kind] ??");
    for (const locale of ["zh-Hans", "en"] as const) {
      expect(pushPageCopy(locale).accepted.length).toBeGreaterThan(4);
      expect(pushPageCopy(locale).bp.length).toBeGreaterThan(4);
    }
  });

  it("the push service may hold a notice for an hour at most (real-app 2.24: 推送有效期 1 小时)", () => {
    expect(MAX_HOLD_S).toBe(3600);
    expect(src("lib", "push", "sender.ts")).toContain("Math.min(notice.ttlS, MAX_HOLD_S)");
  });
});
