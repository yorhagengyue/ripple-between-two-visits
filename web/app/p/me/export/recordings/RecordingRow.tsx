"use client";

/**
 * One visit on 「看诊录音留多久」 (journey 15; C2 track H; a row of the timeline draft's 15-4 card): the visit's date and
 * place, one grey line saying until when the recording is kept or that it is kept for good, and the 「一直保留」 switch
 * (one tap, track F's POST /api/visits/[id]/keep; the card's heading names the switch); 「听录音」 under it while the
 * recording is there. A deleted recording is a row without a switch: the day it went, and that the transcript stays.
 */
import { useState } from "react";
import { Said } from "@/components/me/parts";
import { FamilySwitchRow, ListenBar } from "@/components/ui";
import { hCopy, type HLocale } from "@/lib/privacy/copy";
import { postJson } from "@/lib/session/client";

export interface RecordingRowData {
  visitId: string;
  /** 「8月24日 · Blossom Family Clinic」 */
  title: string;
  state: "kept_forever" | "kept_until" | "deleted";
  /** worded date: the last day it is (or was) kept */
  until: string | null;
  /** worded date it was deleted */
  deletedOn: string | null;
  /** where the player gets the whole recording while it is there: GET /api/me/export/recording (a fresh 10-minute link per play) */
  listenUrl: string | null;
  /** C2 track R, a long recording kept as several files: where the player gets the files after the first, in order */
  listenMore?: string[];
  /** ... and every file's length in ms, the first one first (the bar then shows the whole recording's time) */
  lengthsMs?: number[];
}

function clipLength(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function RecordingRow({ locale, row }: { locale: HLocale; row: RecordingRowData }) {
  const c = hCopy(locale);
  const [kept, setKept] = useState(row.state === "kept_forever");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // a recording in several files: its length is on the visit (the first file alone would say less)
  const wholeMs = row.lengthsMs?.length ? row.lengthsMs.reduce((ms, n) => ms + n, 0) : null;
  const [lengthMs, setLengthMs] = useState<number | null>(wholeMs);

  if (row.state === "deleted") {
    return (
      <div className="rpm-rec rpm-rec-gone" data-testid="recording" data-visit={row.visitId} data-state="deleted">
        <p className="rpu-toggle-title">{row.title}</p>
        <p className="rpu-toggle-desc">{c.recDeleted(row.deletedOn ?? "")}</p>
      </div>
    );
  }

  async function toggle(next: boolean) {
    setBusy(true);
    setFailed(false);
    try {
      await postJson(`/api/visits/${encodeURIComponent(row.visitId)}/keep`, null, { keep: next });
      setKept(next);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rpm-rec" data-testid="recording" data-visit={row.visitId} data-state={kept ? "kept_forever" : "kept_until"}>
      <FamilySwitchRow
        locale={locale}
        name="keep_forever"
        title={row.title}
        description={kept ? c.recKeptForever : c.recKeptUntil(row.until ?? "")}
        on={kept}
        pending={busy}
        onChange={(next) => void toggle(next)}
      />
      {(row.listenUrl || failed) && (
        <div className="rpm-rec-extra">
          {row.listenUrl && (
            <>
              <ListenBar src={row.listenUrl} more={row.listenMore} lengthsMs={row.lengthsMs} time={lengthMs !== null ? clipLength(lengthMs) : "…"} locale={locale} kind="self" label={c.recListen} />
              {/* the recording's length for the bar (a recording in one file: asked from the file) */}
              {wholeMs === null ? <audio preload="metadata" src={row.listenUrl} hidden onLoadedMetadata={(e) => setLengthMs(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration * 1000 : null)} /> : null}
            </>
          )}
          {failed && (
            <Said tone="problem" testId="recording-failed">
              {c.recFailed}
            </Said>
          )}
        </div>
      )}
    </div>
  );
}
