"use client";

/**
 * A recording this phone keeps that is not going anywhere (./kept.ts "hold"; real-app 2.13, 2.14): the server does not
 * list its visit for this account any more, the visit is only planned, or the visit already has its record and no
 * recording (sending it would start that record again). It used to be neither shown nor removed until he signed out.
 * Now the visit tab has one block for it: that the recording is still on this phone, how long it is, why it was not
 * sent, that signing out clears it, and a play pill that plays the phone's own copy.
 *
 * Nothing is sent and nothing is deleted here (the store's rule 3: a copy leaves the phone only with the server's word,
 * or when he signs out). The copy is read from the phone once, when the block shows, a part's length at a time (a long
 * recording is several files, played through as one: components/ui ListenBar), and handed to the player as local files.
 */
import { useEffect, useState } from "react";
import { Box, ListenBar } from "@/components/ui";
import { clipTimeLabel, minSec, type AccountLocale } from "@/lib/visit/account-copy";
import { encodeWav, TARGET_SAMPLE_RATE } from "@/lib/visit/wav";
import { keptSource, type PendingRecording } from "./recording-store";
import { vw } from "./words";

/** The longest a recording gets is nine parts (lib/visit/parts.ts recordingLimit): never more files than that. */
const MAX_FILES = 9;

interface Playable {
  urls: string[];
  lengthsMs: number[];
}

/** The phone's copy as local files the player can take, each at most one part long. Null: nothing could be read. */
async function playable(owner: string, visitId: string, partMs: number): Promise<Playable | null> {
  const source = await keptSource(owner, visitId);
  if (!source) return null;
  const partSamples = Math.max(TARGET_SAMPLE_RATE, Math.floor((partMs * TARGET_SAMPLE_RATE) / 1000));
  const urls: string[] = [];
  const lengthsMs: number[] = [];
  let from = source.startSample;
  for (let i = 0; i < MAX_FILES; i++) {
    const samples = await source.read(from, partSamples);
    if (!samples.length) break;
    const wav = encodeWav(samples, TARGET_SAMPLE_RATE);
    urls.push(URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: "audio/wav" })));
    lengthsMs.push((samples.length * 1000) / TARGET_SAMPLE_RATE);
    from += samples.length;
    if (samples.length < partSamples) break;
  }
  return urls.length ? { urls, lengthsMs } : null;
}

export function HeldRecording({ owner, recording, locale, partMs }: { owner: string; recording: PendingRecording; locale: AccountLocale; partMs: number }) {
  /** null: still reading the phone; "none": it could not be read (the words stay, without a player) */
  const [audio, setAudio] = useState<Playable | "none" | null>(null);
  useEffect(() => {
    let gone = false;
    let made: string[] = [];
    playable(owner, recording.visitId, partMs)
      .then((p) => {
        if (gone) {
          for (const u of p?.urls ?? []) URL.revokeObjectURL(u);
          return;
        }
        made = p?.urls ?? [];
        setAudio(p ?? "none");
      })
      .catch(() => {
        if (!gone) setAudio("none");
      });
    return () => {
      gone = true;
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [owner, recording.visitId, partMs]);

  const length = minSec(recording.durationMs);
  const ready = audio !== null && audio !== "none" ? audio : null;
  const wholeMs = ready ? ready.lengthsMs.reduce((ms, n) => ms + n, 0) : 0;
  return (
    <div className="rpu-visit-group" style={{ gap: 10 }} data-testid="visit-held-row" data-visit={recording.visitId} data-ready={ready ? "true" : audio === "none" ? "none" : "false"}>
      <Box variant="line" title={vw(locale, "held.title", { min: length.min, sec: length.sec })}>
        {vw(locale, "held.sub")}
      </Box>
      {ready ? (
        <ListenBar src={ready.urls[0]} more={ready.urls.slice(1)} lengthsMs={ready.lengthsMs} time={clipTimeLabel(wholeMs)} locale={locale} kind="self" label={vw(locale, "held.listen")} style={{ marginTop: 0 }} />
      ) : audio === null ? (
        <p className="rpu-visit-note">{vw(locale, "held.preparing")}</p>
      ) : null}
    </div>
  );
}
