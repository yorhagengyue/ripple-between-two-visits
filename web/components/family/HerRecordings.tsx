"use client";

/**
 * 「我录过的」 (/f/reminder/mine?link=; the v3 draft's E5): 「你录过的提醒。」, each of her recordings with the round play
 * key, its shape and length, when she recorded it, and which one his phone plays now (「正在放」 with the tick). Another
 * one can be put back (「换回这段」: POST /api/reminders/[id]/use) or deleted (DELETE /api/reminders/[id]); the one that
 * plays cannot be deleted while there is another to switch to, as the last line says.
 *
 * What the draft draws and the data cannot give is left out, not made up:
 *   - a clip's shape and length are not stored; they are measured from the file her phone is about to play
 *     (lib/care/clip-shape.ts). A file that cannot be read gets no shape, only its words.
 *   - the stand-in voice is no item of hers to switch back to (there is no way to choose it while a recording of hers
 *     exists). It is listed only while it is what his phone plays, marked 「代录音」 and 「正在放」.
 * Kept from before the draft: her only recording can still be deleted (his phone then plays the stand-in again), and
 * under each shape are the words his card shows for it, or only her name when the words stayed off the card.
 */
import { useEffect, useRef, useState } from "react";
import { Chip, DayMark, FamilyButton, FamilyDock, FamilyHero, FamilyNote, PlayButton, Said, Waveform } from "@/components/family-ui";
import { clipClock, clipShape, type ClipShape } from "@/lib/care/clip-shape";
import { dayWords } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import type { HerClipView, HerReminders } from "@/lib/care/reminders";
import { dateIn } from "@/lib/care/time";
import { dt } from "@/lib/daily/i18n";
import { requestJson } from "@/lib/family/fetch";
import type { Locale } from "@/lib/i18n";

const BARS = 26;

export function HerRecordings({
  locale,
  linkId,
  playsAt,
  tz,
  initial,
  herLabel,
  dad,
}: {
  locale: Locale;
  linkId: string;
  playsAt: string;
  tz: string;
  initial: HerReminders;
  /** the name he gave her link ("Wei Ling"): his card says 「Wei Ling 的录音」 for a clip without words */
  herLabel?: string | null;
  dad: string;
}) {
  const name = herLabel?.trim() || null;
  const clipName = name ? dt(locale, "today.reminder.recording", { name }) : dt(locale, "today.reminder.recordingDefault");
  const [reminders, setReminders] = useState(initial);
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [shapes, setShapes] = useState<Record<string, ClipShape>>({});
  const el = useRef<HTMLAudioElement | null>(null);
  const q = `link=${encodeURIComponent(linkId)}`;
  const time = playsAt.replace(/^0/, "");
  const clips = reminders.mine;
  const current = reminders.current;
  // the stand-in (or another family member's recording) is listed only while it is what his phone plays
  const notHers = current && current.whose !== "yours" ? current : null;
  const sounds = clips.map((c) => `${c.id}|${c.audioUrl ?? ""}`).join(" ");

  // each recording's shape and length, measured from its own file
  useEffect(() => {
    const stop = new AbortController();
    for (const c of reminders.mine) {
      if (!c.audioUrl) continue;
      void clipShape(c.audioUrl, BARS, stop.signal).then((shape) => {
        if (shape && !stop.signal.aborted) setShapes((prev) => (prev[c.id] ? prev : { ...prev, [c.id]: shape }));
      });
    }
    return () => stop.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sounds` names every clip and its file
  }, [sounds]);

  async function reload() {
    const r = await requestJson<HerReminders>(`/api/reminders?${q}`);
    if (r.ok) setReminders(r.data);
  }

  function quiet() {
    el.current?.pause();
    setPlaying(null);
  }

  function toggle(c: HerClipView) {
    const a = el.current;
    if (!a || !c.audioUrl) return;
    if (playing === c.id) return quiet();
    a.src = c.audioUrl;
    void a.play().then(
      () => setPlaying(c.id),
      () => setPlaying(null),
    );
  }

  async function useAgain(id: string) {
    setBusy(id);
    setSaid(null);
    const r = await requestJson(`/api/reminders/${encodeURIComponent(id)}/use?${q}`, { method: "POST", json: {}, expect: "any" });
    if (r.ok) {
      await reload();
      setSaid(hc(locale, "mineUsed", { time }));
    }
    setBusy(null);
  }

  async function remove(id: string) {
    setBusy(id);
    setSaid(null);
    if (playing === id) quiet();
    const r = await fetch(`/api/reminders/${encodeURIComponent(id)}?${q}`, { method: "DELETE", credentials: "same-origin", cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      await reload();
      setSaid(hc(locale, "mineDeleted"));
    }
    setBusy(null);
  }

  const quoted = (words: string) => `「${words}」`;
  const playLabel = (id: string) => hc(locale, playing === id ? "stop" : "mineListen");
  const nowPlaying = (
    <span className="rpf-nowplaying" data-testid="rec-mine-playing">
      <DayMark mark="taken" size={20} />
      {hc(locale, "minePlaying")}
    </span>
  );

  return (
    <div className="rpf-col" data-testid="rec-mine" data-count={clips.length}>
      <FamilyHero tone="quiet" title={hc(locale, "mineTitle")} detail={clips.length || notHers ? hc(locale, "mineSub", { time }) : hc(locale, "mineNone")} />
      {(clips.length > 0 || notHers) && (
        <ul className="rpf rpf-items" data-top="true">
          {clips.map((c) => {
            const shape = shapes[c.id];
            const words = c.text ? quoted(c.text) : null;
            // her only recording can go (his phone plays the stand-in again); with another to switch to, the one
            // that plays stays until she has switched
            const canDelete = !c.current || clips.length === 1;
            return (
              <li key={c.id} className="rpf-item" data-testid="rec-mine-row" data-current={c.current ? "true" : undefined}>
                <div className="rpf-item-main">
                  {c.audioUrl && <PlayButton playing={playing === c.id} label={playLabel(c.id)} onClick={() => toggle(c)} data-testid="rec-mine-play" />}
                  {shape ? <Waveform levels={shape.levels} size="small" /> : <div>{words ? <Said>{words}</Said> : <p className="rpf-item-name">{clipName}</p>}</div>}
                  {shape && (
                    <span className="rpf-item-len" data-testid="rec-mine-length">
                      {clipClock(shape.seconds)}
                    </span>
                  )}
                </div>
                {/* under a shape: what his card shows for this recording (her words, or only her name) */}
                {shape && (words ? <Said>{words}</Said> : <p className="rpf-item-name">{clipName}</p>)}
                <div className="rpf-item-head">
                  <span>{hc(locale, "mineYours", { date: dayWords(dateIn(c.createdAt, tz), locale) })}</span>
                  {c.current && !canDelete ? (
                    nowPlaying
                  ) : (
                    <span className="rpf-item-acts">
                      {c.current && nowPlaying}
                      {!c.current && (
                        <FamilyButton size="small" variant="secondary" pending={busy === c.id} onClick={() => void useAgain(c.id)} data-testid="rec-mine-use">
                          {hc(locale, "mineUse")}
                        </FamilyButton>
                      )}
                      <FamilyButton size="small" variant="quiet" disabled={busy === c.id} onClick={() => void remove(c.id)} data-testid="rec-mine-delete">
                        {hc(locale, "mineDelete")}
                      </FamilyButton>
                    </span>
                  )}
                </div>
              </li>
            );
          })}
          {notHers && (
            <li className="rpf-item" data-testid="rec-mine-other" data-current="true">
              <div className="rpf-item-main">
                {notHers.audioUrl && <PlayButton playing={playing === notHers.id} label={playLabel(notHers.id)} onClick={() => toggle(notHers)} data-testid="rec-mine-play" />}
                <div>{notHers.text ? <Said>{quoted(notHers.text)}</Said> : <p className="rpf-item-name">{notHers.byLabel ? dt(locale, "today.reminder.recording", { name: notHers.byLabel }) : dt(locale, "today.reminder.recordingDefault")}</p>}</div>
              </div>
              <div className="rpf-item-head">
                {notHers.whose === "stand_in" ? <Chip>{hc(locale, "standIn")}</Chip> : <span />}
                {nowPlaying}
              </div>
            </li>
          )}
        </ul>
      )}
      {said && (
        <p className="rpf rpf-rec-status rpf-rise" role="status" style={{ marginTop: 16 }} data-testid="rec-mine-said">
          {said}
        </p>
      )}
      <FamilyDock foot="n" style={{ marginBottom: 20 }}>
        {clips.length > 1 && <FamilyNote>{hc(locale, "mineNote")}</FamilyNote>}
        {clips.length === 1 && <FamilyNote>{hc(locale, "mineOnlyNote", { dad })}</FamilyNote>}
      </FamilyDock>
      <audio ref={el} preload="none" onEnded={() => setPlaying(null)} data-testid="rec-mine-audio" />
    </div>
  );
}
