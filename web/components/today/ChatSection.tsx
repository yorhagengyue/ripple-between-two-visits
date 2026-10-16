import { Act, Acts, Bubble, TimelineItem } from "@/components/ui";
import type { ChatTodayData } from "@/lib/chat/view";
import type { UiLocale } from "@/lib/ui/tokens";

/**
 * Today · Today's conversation (section "chat"): one entry of the day's line. Track K (journey 04; 老人端提示词
 * 04.1-04.2); the ask flow itself is S's (the typing dock is S's AskSection).
 *
 * What he said today (his own node, his words plain) and the first line of Ripple's last reply (the tinted bubble under
 * 「Ripple」), kept for him, with the way to the whole conversation (/p/chat: today's turns in order, earlier days).
 * Nothing new is written here. When he said nothing today but did on an earlier day, only the way to those days.
 *
 * Track B's Today page passes it when there is a conversation at all:
 *
 *   import { chatToday } from "@/lib/chat/view";
 *   const chat = await chatToday(ctx.store, ctx.session, locale);       // ChatTodayData | null (never talked)
 *   chat={chat ? <ChatSection locale={locale} data={chat} /> : undefined}
 *
 * Without `data` (the /design frames gallery) it renders nothing. Test hooks: today-chat (data-count), today-chat-last.
 */
const WORDS: Record<UiLocale, { label: string; you: string; open: (n: number) => string; earlier: string; see: string }> = {
  "zh-Hans": { label: "今天说过的话", you: "你", open: (n) => `看今天说过的话（${n} 句）`, earlier: "以前说过的话", see: "去看" },
  en: { label: "Today's conversation", you: "You", open: (n) => `See today's conversation (${n})`, earlier: "Earlier conversations", see: "Open" },
};

export function ChatSection({ locale, data }: { locale: UiLocale; data?: ChatTodayData | null }) {
  if (!data) return null;
  const w = WORDS[locale];
  return (
    <TimelineItem
      node={data.last ? "me" : "dot"}
      who={data.last ? w.you : w.earlier}
      meta={data.last ? w.label : undefined}
      section="chat"
      testId="today-chat"
      attrs={{ "data-count": data.count }}
      actions={
        <Acts>
          <Act href="/p/chat">{data.last ? w.open(data.count) : w.see}</Act>
        </Acts>
      }
    >
      {data.last ? (
        <div data-testid="today-chat-last" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Bubble node="me">{data.last.text}</Bubble>
          {data.last.reply ? (
            <>
              <p className="rpu-tl-head" style={{ margin: 0 }}>
                <span className="rpu-tl-who" data-node="rip">
                  Ripple
                </span>
              </p>
              <Bubble>{data.last.reply}</Bubble>
            </>
          ) : null}
        </div>
      ) : null}
    </TimelineItem>
  );
}
