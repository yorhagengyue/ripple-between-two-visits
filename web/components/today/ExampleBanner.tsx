"use client";

/**
 * Today · the example account's banner (the "banner" slot of TodayLayout; real-app 2.2, 4.7). Owner: C.
 *
 *   ExampleLine      one quiet line, always there on his screens while the account runs on Mr Tan's example data:
 *                    「示例资料：陈先生（虚构人物）」 and 「这是什么」 (/p/me/example: where the data comes from, lay it out
 *                    again, start from his own). Not a card, not red. It is mounted once for every account screen:
 *                    app/p/layout.tsx hands ExampleHeaderLine to the header provider and MetaBar draws it right
 *                    under the top line (real-app 4.7 「页头下面一直有一行小字」). ExampleLine, which pages and this
 *                    banner still place themselves, draws nothing where the header already shows the line.
 *   the intro        shown once: what the example is and what he can try; 「知道了」 puts it away for good
 *                    (POST /api/me/example { action: "dismiss_intro" }).
 *   可以这样问        three example sentences, marked 「示例」: a tap only puts the words into the ask box (it asks nothing
 *                    by itself); he sends it as he would his own words. The box is found by its data-testid
 *                    "ask-input"; a page whose box works differently listens for the "rp:ask-prefill" window event
 *                    ({ detail: { text } }) instead. In the timeline draft the three sentences are on the ask screen
 *                    (22-2; components/today/AskSection.tsx draws them there with EXAMPLE_ASKS and fillAskBox), so
 *                    Today keeps one row that leads there: 「可以这样问」, the first sentence under it as a taste, 「示例」.
 * Fixed words only (lib/profile/copy.ts); the sentences are the example's own questions, not advice.
 */
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Box } from "@/components/ui/Box";
import { SecondaryButton } from "@/components/ui/Buttons";
import { Icon } from "@/components/ui/icons";
import { ListCard, ListItem } from "@/components/ui/List";
import { Tag } from "@/components/ui/Tag";
import { UiLink } from "@/components/ui/UiLink";
import { useHeaderUnder } from "@/components/ui/AccountHeader";
import { sendJson } from "@/lib/profile/client";
import { exampleCopy, type CLocale } from "@/lib/profile/copy";
import type { UiLocale } from "@/lib/ui/tokens";

/** The three 「可以这样问」 sentences (the hero question, a log-only remark, an emergency word). */
export const EXAMPLE_ASKS: Record<CLocale, readonly string[]> = {
  "zh-Hans": ["今天 150/95，我能不能多吃一粒？", "我今天好累", "胸口痛"],
  en: ["My reading is 150/95 today. Can I take one more tablet?", "I'm so tired today", "Chest pain"],
};

/** Put the words into the ask box on this page (and tell any box that listens). True when a box took them. */
export function fillAskBox(text: string): boolean {
  window.dispatchEvent(new CustomEvent("rp:ask-prefill", { detail: { text } }));
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-testid="ask-input"]');
  if (!input) return false;
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.scrollIntoView({ block: "center", behavior: "smooth" });
  input.focus({ preventScroll: true });
  return true;
}

/**
 * The quiet line where a page places it itself. Inside an account's header provider the header already shows it on
 * every screen, so this draws nothing there (the line never doubles).
 */
export function ExampleLine({ locale }: { locale: UiLocale }) {
  const inHeader = useHeaderUnder();
  return inHeader ? null : <ExampleHeaderLine locale={locale} />;
}

/** The quiet line itself: under the header of every screen while the account runs on the example data. */
export function ExampleHeaderLine({ locale }: { locale: UiLocale }) {
  const c = exampleCopy(locale);
  // the page the line leads to does not carry it (owner's tidy of 10-13); every other screen does. Today has it again
  // since the owner's decision of 10-14: its top is now his month of records, which on this account are made up
  const path = usePathname();
  if (path === "/p/me/example") return null;
  // one line, the whole of it the way in (real-app 4.7: 点开说明资料从哪来): it is on every screen, so it stays one line
  return (
    <UiLink
      href="/p/me/example"
      nav="forward"
      className="rpu rpu-banner"
      data-rp="example-line"
      data-action="example-about"
      aria-label={`${c.banner} · ${c.bannerMore}`}
      style={{ alignItems: "center", color: "var(--rp-ink-2)", textDecoration: "none", minHeight: "var(--rp-hit)" }}
    >
      <Icon name="info" />
      <span style={{ flex: 1 }}>{c.banner}</span>
      <Icon name="chevron" stroke={2.4} />
    </UiLink>
  );
}

function Intro({ locale }: { locale: UiLocale }) {
  const c = exampleCopy(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <section className="rpu rpu-btns" data-rp="example-intro">
      {/* the draft's 22-1: what this is, in the tinted box; 「知道了」 under it puts it away for good */}
      <Box variant="tint" title={c.introTitle}>
        {c.introBody}
      </Box>
      <SecondaryButton
        pending={busy}
        data-action="example-intro-dismiss"
        onClick={async () => {
          setBusy(true);
          await sendJson("POST", "/api/me/example", { action: "dismiss_intro" });
          router.refresh();
        }}
      >
        {c.gotIt}
      </SecondaryButton>
    </section>
  );
}

/**
 * The way from Today to 「可以这样问」: one row, the first of the three sentences under it as a taste. The sentences
 * themselves are on the ask screen (/p/ask), where a tap puts one into the field.
 */
function TryAsking({ locale }: { locale: UiLocale }) {
  const c = exampleCopy(locale);
  return (
    <section data-rp="example-asks-entry">
      <ListCard>
        <ListItem mark="me" title={c.tryAsking} sub={EXAMPLE_ASKS[locale][0]} right={<Tag tone="neutral">{c.exampleTag}</Tag>} chevron href="/p/ask" attrs={{ "data-action": "example-asks-open" }} />
      </ListCard>
    </section>
  );
}

/**
 * Today's banner for an example account: the line, the intro until he puts it away, and the way to the example
 * sentences. Keep the export name and `locale` (TodayLayout's banner slot).
 */
export function ExampleBanner({ locale, introDismissed = false, asks = true }: { locale: UiLocale; introDismissed?: boolean; asks?: boolean }) {
  return (
    <div className="rpu rpu-stack" data-rp="example-banner" data-section="banner" style={{ gap: 12, marginBottom: 6 }}>
      <ExampleLine locale={locale} />
      {!introDismissed && <Intro locale={locale} />}
      {asks && <TryAsking locale={locale} />}
    </div>
  );
}
