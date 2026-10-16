"use client";

/**
 * The buttons on his question list (track C), in the timeline design (design group 14): under a question of the line
 * a row of buttons, 「改一下字」 and 「这条不问了」 side by side, 「合并」 under them when the same words are on the list
 * twice. 「不问了」 and 「合并」 act at once and the bar at the bottom undoes them for 12 seconds (no confirm dialog);
 * 「放回去」 puts a set-aside question back. Each change is one PATCH /api/questions/[id]; the page then re-renders from
 * the server with what happened in its address (?done=skip&q=<id>), so the undo bar stays up while the row it is about
 * leaves the list. The list is one list since the owner's decision of 10-14 (no 问医生 / 问药剂师 sides to stay on).
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Tag } from "@/components/ui/Tag";
import { PlayGlyph } from "@/components/ui/Timeline";
import { UiLink } from "@/components/ui/UiLink";
import { UndoToast } from "@/components/ui/UndoToast";
import { uiCopy } from "@/lib/ui/copy";
import { sendJson } from "@/lib/profile/client";
import { questionsCopy, type CLocale } from "@/lib/profile/copy";

/** The list's address, with what just happened. */
function listHref(query = ""): string {
  return query ? `/p/questions?${query}` : "/p/questions";
}

export function RowActions({ id, locale, canEdit, duplicateOf, editHref }: { id: string; locale: CLocale; canEdit: boolean; duplicateOf: string | null; editHref: string }) {
  const router = useRouter();
  const c = questionsCopy(locale);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function act(body: unknown, done: "skip" | "merge") {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const r = await sendJson("PATCH", `/api/questions/${encodeURIComponent(id)}`, body);
    if (!r.ok) {
      setBusy(false);
      setFailed(true);
      return;
    }
    router.replace(listHref(`done=${done}&q=${encodeURIComponent(id)}`), { scroll: false });
    router.refresh();
  }

  return (
    <div className="rpu rpu-acts rp14q-acts" data-rp="question-actions" data-question={id} style={{ ["--rpu-cols" as string]: canEdit ? 2 : 1 }}>
      {canEdit && (
        <UiLink className="rpu-act" data-rp="act" data-variant="secondary" href={editHref} data-action="edit">
          {c.change}
        </UiLink>
      )}
      <button type="button" className="rpu-act" data-rp="act" data-variant="secondary" onClick={() => void act({ status: "skipped" }, "skip")} disabled={busy} aria-busy={busy || undefined} data-action="skip">
        {c.skip}
      </button>
      {duplicateOf && (
        <button type="button" className="rpu-act" data-rp="act" data-variant="secondary" data-wide="true" onClick={() => void act({ merge_into: duplicateOf }, "merge")} disabled={busy} aria-busy={busy || undefined} data-action="merge">
          {c.merge}
        </button>
      )}
      {failed && (
        <p role="alert" className="rpu-f-error" data-wide="true">
          {c.failed}
        </p>
      )}
    </div>
  );
}

/** The undo bar for the change just made (skip or merge): 「撤销」 puts the question back. */
export function UndoBar({ id, kind, locale }: { id: string; kind: "skip" | "merge"; locale: CLocale }) {
  const router = useRouter();
  const c = questionsCopy(locale);
  return (
    <UndoToast
      locale={locale}
      message={kind === "skip" ? c.toastSkipped : c.toastMerged}
      onUndo={async () => {
        await sendJson("PATCH", `/api/questions/${encodeURIComponent(id)}`, { status: "open" });
        router.replace(listHref(), { scroll: false });
        router.refresh();
      }}
      onExpire={() => router.replace(listHref(), { scroll: false })}
    />
  );
}

/** 「放回去」 on a set-aside question: one button of the entry's row. */
export function PutBack({ id, locale }: { id: string; locale: CLocale }) {
  const router = useRouter();
  const c = questionsCopy(locale);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rpu rpu-acts" data-rp="question-actions" data-question={id} style={{ ["--rpu-cols" as string]: 1 }}>
      <button
        type="button"
        className="rpu-act"
        data-rp="act"
        data-variant="secondary"
        data-action="put-back"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={async () => {
          setBusy(true);
          const r = await sendJson("PATCH", `/api/questions/${encodeURIComponent(id)}`, { status: "open" });
          if (r.ok) {
            router.replace(`/p/questions?done=put_back&q=${encodeURIComponent(id)}`, { scroll: false });
            router.refresh();
          } else setBusy(false);
        }}
      >
        {c.putBack}
      </button>
    </div>
  );
}

/**
 * Plays a clinician's recorded answer: the play pill (outlined with a triangle, filled with two bars while it plays),
 * and 「代录音」 in a square tag next to it when the voice is a stand-in. `time`, when given, follows the words.
 */
export function ListenButton({ src, label, time, standIn, locale }: { src: string; label: string; time?: string; standIn?: boolean; locale: CLocale }) {
  const [playing, setPlaying] = useState(false);
  // C2 track B (one sound at a time, app/p/layout.tsx OneAudio): the sound this button started last
  const current = useRef<HTMLAudioElement | null>(null);
  return (
    <div className="rpu rpu-tl-ctl" data-kind="doctor">
      <button
        type="button"
        className="rpu-src"
        data-rp="source"
        data-kind="doctor"
        data-action="listen"
        aria-pressed={playing}
        onClick={() => {
          const audio = new Audio(src);
          current.current = audio;
          setPlaying(true);
          // C2 track B: only the sound started last may say "not playing" (an earlier one paused by this tap must not)
          const stopped = () => {
            if (current.current === audio) setPlaying(false);
          };
          audio.addEventListener("ended", stopped);
          audio.addEventListener("error", stopped);
          // another sound started somewhere on the page and this one was paused: the button says so
          audio.addEventListener("pause", stopped);
          void audio.play().catch(stopped);
        }}
      >
        <PlayGlyph playing={playing} />
        <span>{playing ? uiCopy(locale).playing : label}</span>
        {time && <span className="rpu-src-time">{time}</span>}
      </button>
      {standIn && <Tag>{uiCopy(locale).standIn}</Tag>}
    </div>
  );
}
