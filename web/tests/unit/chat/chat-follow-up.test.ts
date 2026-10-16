/**
 * The day's record (/p/chat, components/chat/ChatScreen.tsx) with the guided harness's follow-up question (2026-10-16): the
 * question Ripple asked stays in the record under its answer, read only (he answers it on the ask screen): answered, with
 * what he chose marked (his next turn was his tap, lib/chat/view.ts keeps the reply), or closed. A test-only question.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatScreen } from "@/components/chat/ChatScreen";
import { turnsOf, type ChatDayView } from "@/lib/chat/view";
import type { FollowUp } from "@/lib/safety/risk/types";
import type { AskTurn, StoredAnswer } from "@/lib/safety/turns";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const CHEST: FollowUp = {
  id: "fu-test-chest-1",
  pathway: "chest",
  step: 1,
  of: 3,
  templateId: "fu_chest_now",
  en: "Is the chest pain still happening now?",
  zh: "胸口现在还痛吗？",
  options: [
    { id: "yes", en: "Yes", zh: "还在痛", tone: "danger" },
    { id: "gone", en: "No, it's gone", zh: "不痛了", tone: "calm" },
    { id: "unsure", en: "Not sure", zh: "说不清", tone: "neutral" },
  ],
};
const NEXT: FollowUp = { ...CHEST, id: "fu-test-chest-2", step: 2, templateId: "fu_chest_long", en: "How long has it gone on?", zh: "痛了多久？" };

const answer = (followUp?: FollowUp): StoredAnswer => ({ route: "emergency", sentences: [], locale: "en", ...(followUp ? { followUp } : {}) });

describe("the day's record keeps Ripple's follow-up question, read only", () => {
  it("turnsOf carries his tap's reply; the record draws the answered question with his choice marked, the newer one closed", () => {
    const turns: AskTurn[] = [
      { id: "t1", day: 29, at: "2026-10-16T01:00:00.000Z", text: "My chest feels tight", lang: "en", answer: answer(CHEST) },
      { id: "t2", day: 29, at: "2026-10-16T01:01:00.000Z", text: "Yes", lang: "en", answer: answer(NEXT), reply: { followUpId: CHEST.id, optionIds: ["yes"] } },
    ];
    const base = turnsOf(turns, "Asia/Singapore");
    expect(base.map((t) => t.reply?.followUpId ?? null)).toEqual([null, CHEST.id]);
    const view: ChatDayView = { day: 29, date: "2026-10-16", dateWords: "16 Oct", isToday: true, days: [], turns: base.map((t) => ({ ...t, related: null, added: null })) };
    const out = renderToStaticMarkup(createElement(ChatScreen, { view, locale: "en" }));
    const states = [...out.matchAll(/data-testid="ask-followup" data-followup="([^"]+)"[^>]*data-state="([a-z]+)"/g)].map((m) => [m[1], m[2]]);
    expect(states).toEqual([
      [CHEST.id, "answered"],
      [NEXT.id, "closed"],
    ]);
    // nothing here can be tapped: his choice is the only button not disabled, and it is aria-disabled
    const buttons = [...out.matchAll(/<button[^>]*data-testid="ask-followup-option"[^>]*>/g)].map((m) => m[0]);
    expect(buttons).toHaveLength(6);
    expect(buttons.filter((b) => !b.includes('disabled=""'))).toEqual([expect.stringContaining('aria-disabled="true"')]);
    expect(buttons[0]).toContain('data-variant="on"');
    // the question stands after the answer's own entries of its turn, before the next turn
    expect(out.indexOf(CHEST.en)).toBeLessThan(out.indexOf(">Yes</p>"));
  });
});
