"use client";

/**
 * 「AI 处理」 on his phone (journey 15; C2 track H; the timeline draft's 15-5): one switch in a white card, with 开 or 关
 * written under it, a line saying what just changed, when he last changed it, and the AI-processing text he agrees to
 * (what goes to DeepSeek, processed in China, and what changes when it is off). One tap, no confirm dialog: the switch
 * records a new consent decision (POST /api/me/consent) that the next ask already follows. A second switch at the foot
 * says someone is helping him with the phone: the decision is still his tap, and the record then carries
 * assisted = true with the note (real-app 3.11 「家人代操作时，同意必须由他本人点」).
 */
import { useState } from "react";
import { ConsentText, P, Said } from "@/components/me/parts";
import { FamilySwitchRow, SectionTitle, ToggleList } from "@/components/ui";
import { hCopy, type HLocale } from "@/lib/privacy/copy";
import { momentWords } from "@/lib/privacy/words";
import { ApiError, postJson } from "@/lib/session/client";

export function AiSwitch({
  locale,
  on: initialOn,
  since: initialSince,
  textTitle,
  paragraphs,
  version,
  tz = "Asia/Singapore",
}: {
  locale: HLocale;
  on: boolean;
  /** worded moment of his last decision, or null when he never made one */
  since: string | null;
  textTitle: string;
  paragraphs: string[];
  version: string;
  tz?: string;
}) {
  const c = hCopy(locale);
  const [on, setOn] = useState(initialOn);
  const [since, setSince] = useState(initialSince);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"on" | "off" | null>(null);
  const [failed, setFailed] = useState(false);
  const [helped, setHelped] = useState(false);

  async function change(next: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      const r = await postJson<{ ai: { on: boolean; at: string | null } }>("/api/me/consent", null, { kind: "ai_processing", on: next, locale, ...(helped ? { assisted: true } : {}) });
      setOn(r.ai.on);
      if (r.ai.at) setSince(momentWords(r.ai.at, locale, tz));
      setNotice(r.ai.on ? "on" : "off");
    } catch (err) {
      setFailed(err instanceof ApiError || err instanceof Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rpu-stack" data-testid="page-ai" data-on={on ? "true" : "false"}>
      <ToggleList>
        <FamilySwitchRow locale={locale} name="ai_processing" title={c.aiSwitchTitle} description={c.aiSwitchDesc} on={on} pending={busy} onChange={(next) => void change(next)} />
      </ToggleList>
      {notice && (
        <Said tone="done" testId="ai-notice">
          {notice === "on" ? c.aiNowOn : c.aiNowOff}
        </Said>
      )}
      {failed && (
        <Said tone="problem" testId="ai-failed">
          {c.aiFailed}
        </Said>
      )}
      <P quiet size="small" testId="ai-since">
        {since ? c.aiSince(since) : c.aiNever}
      </P>
      <SectionTitle>{c.aiTextHeading}</SectionTitle>
      <div data-testid="ai-text" data-version={version}>
        <ConsentText title={textTitle} paragraphs={paragraphs} />
      </div>
      <div data-testid="ai-helped" data-on={helped ? "true" : "false"}>
        <ToggleList>
          <FamilySwitchRow locale={locale} name="assisted" title={c.aiHelpedTitle} description={c.aiHelpedDesc} on={helped} onChange={setHelped} />
        </ToggleList>
      </div>
    </div>
  );
}
