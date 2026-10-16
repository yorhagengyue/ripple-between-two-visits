/**
 * M14 real transcription through the real /p/visit page: Chromium's fake microphone plays a whole stand-in
 * visit (services/whisper/bench/audio/<visit>.wav, built by build_visit_audio.py from the script) into the
 * recorder; live captions come from the local Whisper service (large-v3-turbo) and the formal transcript
 * from large-v3 after "End visit". Measured per visit and reported (JSON in the test output, or in
 * M14_REPORT_DIR):
 *   - caption: from the end of each spoken line to its whole caption on screen (target <= 1.5 s), and to the
 *     first moment its last words were on screen;
 *   - card: from the end of the line a card hangs under to the card on screen (target <= 5 s);
 *   - WER of the formal transcript against the script, English (words) and Mandarin (characters) apart.
 *
 * Needs the server started with SPEECH_PROVIDER=whisper and the service running; otherwise every test skips:
 *   SPEECH_PROVIDER=whisper PW_PORT=3212 npx playwright test e2e/m14-live.spec.ts --output <dir>
 *
 * Timing: one clock, the recording's. window.__rpRecorder.t0Wall is the wall time of the recording's sample 0 (the
 * earliest "now - audio received" over every recorder block, from the first). The live client is fed every
 * recorder block from sample 0 (the page hands over the blocks recorded before it started), so live line spans are
 * on the recording's clock too; the spec gates that (the live client saw exactly the recorder's samples, and its
 * own clock agrees within 15 ms). Round 1 took the live client's clock instead, which started 24-56 ms after the
 * recorder (it waited for /api/asr/realtime-token), so its latencies came out that much too low.
 * "Said" is where each line's energy ends in the WAV (the last 10 ms frame within 30 dB of the line's loudest), not
 * the script timeline's end, which carries the voice's trailing silence. Where the fake file was at the recording's
 * sample 0 comes from the audio itself: the uploaded recording is cross-correlated with the WAV (log-energy
 * envelopes, 10 ms then 1 ms), so the clock does not lean on the page's own speech detection. Matching the live
 * lines' speech ends to the energy ends is kept as a cross-check.
 *
 * Honesty gates: no asr.fallback in the session (a fallback to the replay would score the script against
 * itself), every line of the record comes from this recording (no replay ids, a clip cut from the recording,
 * never a stand-in), caption p50 and p90 within the 1.5 s target, cards within 5 s.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test, type Page } from "@playwright/test";
import { percentile, scoreByLanguage, type RefLine } from "../lib/asr/wer";
import { parseWav } from "../lib/visit/wav";
import { BASE_URL, cookieHeader, createSession, waitLive } from "./helpers";

const BENCH = path.resolve(__dirname, "..", "..", "services", "whisper", "bench", "audio");
const VISITS = [
  { visit: "v1", day: 0 },
  { visit: "v2", day: 8 },
  { visit: "v3", day: 42 },
];

interface Timeline {
  visit: string;
  duration_ms: number;
  lines: RefLine[];
}

interface LiveLineTrace {
  startMs: number;
  endMs?: number;
  speechEndMs?: number;
  closedAt?: number;
  finalAt?: number;
  finalText?: string;
  captions: { at: number; text: string }[];
}

interface LiveTrace {
  t0Wall: number | null;
  inputSamples: number;
  attachedAt: number | null;
  bufferedSamples: number;
  samples: number;
  lines: Record<string, LiveLineTrace>;
  requests: { kind: string; line: string; offsetMs: number; durMs: number; sentAt: number; doneAt?: number; status?: number }[];
  fallback: { reason: string; at: number } | null;
}

interface ViewData {
  lines: { id: string; text: string; tStartMs: number; tEndMs: number; role: string; clip: { url: string; standIn: boolean } | null }[];
  cards: { kind: string; anchor: string; rows?: { requiredLine?: string | null }[] }[];
}

interface VisitTrace {
  cards: Record<string, number>;
  anchors?: Record<string, string>;
}

const round = (x: number) => Math.round(x);
const stats = (xs: number[]) => ({ n: xs.length, p50: round(percentile(xs, 50)), p90: round(percentile(xs, 90)), max: xs.length ? round(Math.max(...xs)) : null });

/** The fake file's position (ms) at recording sample 0: the shift most live lines agree on. */
function findOffset(lines: LiveLineTrace[], ref: RefLine[]): { offset: number; matched: number; spread: number } {
  const ends = lines.filter((l) => l.speechEndMs !== undefined && l.finalText).map((l) => l.speechEndMs!);
  let best = { offset: 0, matched: 0, spread: Infinity };
  for (const e of ends) {
    for (const r of ref) {
      const d = r.t_end_ms - e;
      const diffs: number[] = [];
      for (const e2 of ends) {
        const near = ref.reduce((a, x) => Math.min(a, Math.abs(x.t_end_ms - (e2 + d))), Infinity);
        if (near <= 150) diffs.push(near);
      }
      const spread = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : Infinity;
      if (diffs.length > best.matched || (diffs.length === best.matched && spread < best.spread)) best = { offset: d, matched: diffs.length, spread };
    }
  }
  // refine: median of the matched differences
  const ds: number[] = [];
  for (const e of ends) {
    const r = ref.reduce((a, x) => (Math.abs(x.t_end_ms - (e + best.offset)) < Math.abs(a.t_end_ms - (e + best.offset)) ? x : a), ref[0]);
    if (Math.abs(r.t_end_ms - (e + best.offset)) <= 150) ds.push(r.t_end_ms - e);
  }
  return { offset: ds.length ? percentile(ds, 50) : best.offset, matched: best.matched, spread: best.spread };
}

async function serviceReady(page: Page): Promise<{ ok: boolean; why: string }> {
  const h = (await (await page.request.get(`${BASE_URL}/api/asr/health`)).json()) as { provider: string; whisper?: { healthy?: boolean; reason?: string } };
  if (h.provider !== "whisper") return { ok: false, why: `the server runs SPEECH_PROVIDER=${h.provider}; start it with SPEECH_PROVIDER=whisper` };
  if (!h.whisper?.healthy) return { ok: false, why: `the Whisper service is not usable (${h.whisper?.reason ?? "loading"}); run services/whisper/start.ps1` };
  return { ok: true, why: "" };
}

/** Each script line's end where its energy really ends in the WAV (10 ms frames, within 30 dB of its peak). */
function energyEnds(wav: Buffer, lines: RefLine[]): Map<string, number> {
  const bytes = new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength);
  const info = parseWav(bytes);
  if (!info || info.sampleRate !== 16_000 || info.channels !== 1 || info.bitsPerSample !== 16) throw new Error("bench WAV is not 16 kHz mono 16-bit");
  const view = new DataView(bytes.buffer, bytes.byteOffset + info.dataOffset, info.dataLength);
  const n = Math.floor(info.dataLength / 2);
  const frame = 160; // 10 ms
  const rms = (i0: number) => {
    let acc = 0;
    for (let i = i0; i < Math.min(n, i0 + frame); i++) {
      const v = view.getInt16(i * 2, true) / 32768;
      acc += v * v;
    }
    return Math.sqrt(acc / frame);
  };
  const out = new Map<string, number>();
  for (const l of lines) {
    const a = Math.floor((l.t_start_ms * 16_000) / 1000);
    const b = Math.min(n, Math.floor(((l.t_end_ms + 300) * 16_000) / 1000));
    const frames: [number, number][] = [];
    for (let i = a; i < b; i += frame) frames.push([i, rms(i)]);
    const peak = Math.max(...frames.map((f) => f[1]), 0);
    const last = [...frames].reverse().find((f) => f[1] >= peak * 0.0316);
    out.set(l.id, last ? Math.round(((last[0] + frame) * 1000) / 16_000) : l.t_end_ms);
  }
  return out;
}

/** 16 kHz mono 16-bit WAV -> samples (-1..1). */
function pcm(wav: Buffer): Float32Array {
  const bytes = new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength);
  const info = parseWav(bytes);
  if (!info || info.sampleRate !== 16_000 || info.channels !== 1 || info.bitsPerSample !== 16) throw new Error("not a 16 kHz mono 16-bit WAV");
  const view = new DataView(bytes.buffer, bytes.byteOffset + info.dataOffset, info.dataLength);
  const out = new Float32Array(Math.floor(info.dataLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** Log energy per frame of `step` samples. */
function envelope(x: Float32Array, step: number): Float32Array {
  const n = Math.floor(x.length / step);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let acc = 0;
    for (let i = f * step; i < (f + 1) * step; i++) acc += x[i] * x[i];
    out[f] = Math.log10(acc / step + 1e-9);
  }
  return out;
}

/** Normalised correlation of b against a shifted by `lag` frames (a[i + lag] ~ b[i]). */
function corrAt(a: Float32Array, b: Float32Array, lag: number): number {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (let i = 0; i < b.length; i++) {
    const j = i + lag;
    if (j < 0 || j >= a.length) continue;
    const x = a[j];
    const y = b[i];
    sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; n += 1;
  }
  if (n < 100) return -1;
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2;
  const vb = sbb / n - (sb / n) ** 2;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
}

/**
 * Where the WAV file was (ms) at recording sample 0: the lag that best lines the recording's energy envelope up
 * with the file's, searched over -3 s .. +5 s at 10 ms, then +-20 ms at 1 ms.
 */
function audioOffset(file: Float32Array, rec: Float32Array): { offsetMs: number; corr: number } {
  const coarseA = envelope(file, 160);
  const coarseB = envelope(rec, 160);
  let best = { lag: 0, c: -2 };
  for (let lag = -300; lag <= 500; lag++) {
    const c = corrAt(coarseA, coarseB, lag);
    if (c > best.c) best = { lag, c };
  }
  const fineA = envelope(file, 16);
  const fineB = envelope(rec, 16);
  let fine = { lag: best.lag * 10, c: -2 };
  for (let lag = best.lag * 10 - 20; lag <= best.lag * 10 + 20; lag++) {
    const c = corrAt(fineA, fineB, lag);
    if (c > fine.c) fine = { lag, c };
  }
  return { offsetMs: fine.lag, corr: Math.round(fine.c * 1000) / 1000 };
}

/**
 * Every event type the session publishes from now on (the server's event stream, read here in Node). `cookie` is the
 * device that created the session (its rp_session, rp_member, rp_role): a stream request with no device at all is
 * refused (403 member_required, lib/family/gate.ts).
 */
function watchEvents(sessionId: string, cookie: string) {
  const types: string[] = [];
  const ctrl = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/events?session=${sessionId}`, { headers: { cookie }, signal: ctrl.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame
            .split("\n")
            .filter((x) => x.startsWith("data:"))
            .map((x) => x.slice(5).trim())
            .join("\n");
          if (!data) continue;
          try {
            types.push((JSON.parse(data) as { type: string }).type);
          } catch {
            // not an event frame
          }
        }
      }
    } catch {
      // stopped
    }
  })();
  return { types, stop: () => ctrl.abort() };
}

test.describe.configure({ mode: "serial" });

for (const { visit, day } of VISITS) {
  test(`${visit}: real captions and cards from the microphone, formal transcript scored against the script`, async ({ request }, info) => {
    const wav = path.join(BENCH, `${visit}.wav`);
    const tlFile = path.join(BENCH, `${visit}.timeline.json`);
    test.skip(!existsSync(wav) || !existsSync(tlFile), `no stand-in audio: run services/whisper/bench/build_visit_audio.py`);
    const timeline = JSON.parse(readFileSync(tlFile, "utf8")) as Timeline;
    test.setTimeout(timeline.duration_ms + 240_000);
    const ends = energyEnds(readFileSync(wav), timeline.lines);
    // the script lines with their spoken ends (alignment and latency); the timeline keeps the script's text and spans for WER
    const spoken = timeline.lines.map((l) => ({ ...l, t_end_ms: ends.get(l.id) ?? l.t_end_ms }));
    const trailMs = timeline.lines.map((l) => l.t_end_ms - (ends.get(l.id) ?? l.t_end_ms));

    const browser = await chromium.launch({
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`],
    });
    try {
      const context = await browser.newContext({ baseURL: BASE_URL, permissions: ["microphone"] });
      const page = await context.newPage();
      const ready = await serviceReady(page);
      test.skip(!ready.ok, ready.why);

      const s = await createSession(request, { story_day: day });
      // the stream goes out as the device that created the session: `request` keeps the cookies its POST set
      const events = watchEvents(s.id, await cookieHeader(request));
      await context.addCookies([{ name: "rp_session", value: s.id, url: BASE_URL }]);
      const audioTypes: string[] = [];
      page.on("request", (r) => {
        const ct = r.headers()["content-type"] ?? "";
        if (ct.startsWith("audio/") || ct.startsWith("video/")) audioTypes.push(ct);
      });
      await page.goto("/p/visit");
      await waitLive(page);
      await page.getByTestId("consent-yes").click();
      await expect(page.getByTestId("visit-screen")).toBeVisible();
      await page.waitForFunction(() => window.__rpRecorder?.t0Wall != null && window.__rpLive?.t0Wall != null, null, { timeout: 20_000 });
      const t0Early = (await page.evaluate(() => window.__rpRecorder!.t0Wall))!;

      // let the whole file play (it may have started up to a second before the recorder), then wait for the
      // last line's final
      const lastEnd = timeline.lines.at(-1)!.t_end_ms;
      // (the timeline end, not the energy end: wait for the whole file)
      await page.waitForTimeout(Math.max(0, t0Early + lastEnd + 2500 - Date.now()));
      await page
        .waitForFunction(
          () => {
            const l = window.__rpLive;
            if (!l) return false;
            const lines = Object.values(l.lines);
            const busy = l.requests.some((r) => r.doneAt === undefined);
            return !busy && lines.length > 0 && lines.every((x) => x.finalAt !== undefined || x.closedAt === undefined);
          },
          null,
          { timeout: 20_000 },
        )
        .catch(() => undefined);
      // the recorder's clock and the live client's, read together (the same listener call updates both)
      const both = await page.evaluate(() => ({ rec: window.__rpRecorder!, live: window.__rpLive! }));
      const live = both.live as unknown as LiveTrace;
      const rec = both.rec;
      const t0Wall = rec.t0Wall!;
      const vis = (await page.evaluate(() => window.__rpVisit)) as unknown as VisitTrace;
      expect(live.fallback).toBeNull();
      const liveView = (await (await request.get(`/api/visits/${visit}?session=${s.id}`)).json()).view as ViewData;

      // end the visit: WAV upload, formal transcript (large-v3), review page
      // keep the uploaded recording: it fixes the clock (audioOffset)
      let recorded: Buffer | null = null;
      await page.route("**/api/blob/upload**", async (route) => {
        if (route.request().method() === "PUT") recorded = route.request().postDataBuffer();
        await route.continue();
      });
      const upload = page.waitForRequest((r) => r.url().includes("/api/blob/upload") && r.method() === "PUT");
      const endAt = Date.now();
      await page.getByTestId("visit-end").click();
      const put = await upload;
      expect(put.headers()["content-type"]).toBe("audio/wav");
      await page.waitForURL(new RegExp(`/p/visit/${visit}/review$`), { timeout: 180_000 });
      const formalMs = Date.now() - endAt;
      const view = (await (await request.get(`/api/visits/${visit}?session=${s.id}`)).json()).view as ViewData;
      expect(audioTypes.filter((t) => t.includes("webm"))).toEqual([]);
      await page.waitForTimeout(500);
      events.stop();

      // ---- timing
      const liveLines = Object.entries(live.lines).map(([id, l]) => ({ id, ...l }));
      expect(recorded, "the recording was uploaded").not.toBeNull();
      const byAudio = audioOffset(pcm(readFileSync(wav)), pcm(recorded!));
      const byLines = findOffset(liveLines, spoken);
      const { matched, spread } = byLines;
      const offset = byAudio.offsetMs;
      const wallOf = (wavMs: number) => t0Wall + (wavMs - offset);
      const captionFinal: number[] = [];
      const wordsOnScreen: number[] = [];
      const perLine: Record<string, unknown>[] = [];
      for (const r of spoken) {
        const recEnd = r.t_end_ms - offset;
        // the live line that carries the end of this script line (none: the line was not captioned)
        const cover = liveLines.find((l) => l.finalText && l.startMs <= recEnd + 300 && (l.speechEndMs ?? l.endMs ?? 0) >= recEnd - 300);
        const end = wallOf(r.t_end_ms);
        const fin = cover?.finalAt !== undefined ? cover.finalAt - end : null;
        const words = live.requests
          .filter((q) => q.line === cover?.id && q.status === 200 && q.doneAt !== undefined && q.offsetMs + q.durMs >= recEnd - 120)
          .map((q) => q.doneAt! - end);
        const first = words.length ? Math.min(...words) : null;
        if (fin !== null) captionFinal.push(fin);
        if (first !== null) wordsOnScreen.push(first);
        perLine.push({ id: r.id, lang: r.lang, line: cover?.id ?? null, caption_final_ms: fin === null ? null : round(fin), words_on_screen_ms: first === null ? null : round(first), live_text: cover?.finalText ?? null });
      }
      const cardLat: number[] = [];
      for (const [cardId, seenAt] of Object.entries(vis.cards)) {
        const anchor = vis.anchors?.[cardId];
        const l = anchor ? live.lines[anchor] : undefined;
        if (!l || l.speechEndMs === undefined) continue;
        const wavEnd = l.speechEndMs + offset;
        const ref = spoken.reduce((a, x) => (Math.abs(x.t_end_ms - wavEnd) < Math.abs(a.t_end_ms - wavEnd) ? x : a), spoken[0]);
        cardLat.push(seenAt - wallOf(ref.t_end_ms));
      }

      // ---- WER: formal transcript (recording clock -> file clock) and the live lines
      const formal = scoreByLanguage(
        timeline.lines,
        view.lines.map((l) => ({ text: l.text, t_start_ms: l.tStartMs + offset, t_end_ms: l.tEndMs + offset })),
      );
      const liveScore = scoreByLanguage(
        timeline.lines,
        liveLines.filter((l) => l.finalText).map((l) => ({ text: l.finalText!, t_start_ms: l.startMs + offset, t_end_ms: (l.speechEndMs ?? l.endMs ?? l.startMs) + offset })),
      );

      // ---- who said it (inferred from content, no diarisation) and the doctor's required lines
      const expected = (JSON.parse(readFileSync(path.join(__dirname, "..", "fixtures", "visits", `${visit}.expected.json`), "utf8")) as {
        answers: { id: string; true_role: string; required_line: string | null }[];
      }).answers;
      const roles = { right: 0, wrong: 0, unknown: 0 };
      for (const r of timeline.lines) {
        const want = expected.find((a) => a.id === r.id)?.true_role;
        const best = view.lines
          .map((l) => ({ l, ov: Math.min(l.tEndMs + offset, r.t_end_ms) - Math.max(l.tStartMs + offset, r.t_start_ms) }))
          .sort((a, b) => b.ov - a.ov)[0];
        if (!best || best.ov <= 0 || best.l.role === "unknown") roles.unknown += 1;
        else if (best.l.role === want) roles.right += 1;
        else roles.wrong += 1;
      }
      const required = (v: ViewData) =>
        [...new Set(v.cards.flatMap((c) => (c.kind === "doc" ? (c.rows ?? []).map((row) => row.requiredLine).filter((x): x is string => !!x) : [])))].sort();
      const wantRequired = [...new Set(expected.map((a) => a.required_line).filter((x): x is string => !!x))].sort();

      const fallbacks = events.types.filter((t) => t === "asr.fallback").length;
      const replayIds = view.lines.filter((l) => /^v\d-u\d+$/.test(l.id) || /^p\d-u\d+$/.test(l.id)).map((l) => l.id);
      const notFromRecording = view.lines.filter((l) => !l.clip || l.clip.standIn).map((l) => l.id);
      const report = {
        visit,
        honesty: { asr_fallback_events: fallbacks, events_seen: events.types.length, replay_line_ids: replayIds, lines_without_own_clip: notFromRecording },
        script_end_trailing_silence_ms: stats(trailMs),
        roles_after_visit: roles,
        required_lines: { expected: wantRequired, live_cards: required(liveView), record_cards: required(view) },
        audio_ms: timeline.duration_ms,
        alignment: { offset_ms: round(offset), by: "audio cross-correlation", corr: byAudio.corr, line_match_offset_ms: round(byLines.offset), matched_lines: matched, mean_abs_ms: round(spread) },
        clock: {
          by: "recorder (window.__rpRecorder)",
          live_minus_recorder_ms: round(live.t0Wall! - t0Wall),
          live_attached_after_recorder_ms: live.attachedAt === null ? null : round(live.attachedAt - t0Wall),
          handed_over_ms: round((live.bufferedSamples / Math.max(1, rec.samples)) * rec.receivedMs),
          recorder_samples: rec.samples,
          live_input_samples: live.inputSamples,
        },
        live_lines: liveLines.length,
        script_lines: timeline.lines.length,
        caption_final_ms: stats(captionFinal),
        words_on_screen_ms: stats(wordsOnScreen),
        card_ms: stats(cardLat),
        cards_live: Object.keys(vis.cards).length,
        formal_transcript_ms: formalMs,
        formal: { en_wer: formal.en.rate, en_words: formal.en.refTokens, zh_cer: formal.zh.rate, zh_chars: formal.zh.refTokens, lines: view.lines.length },
        live: { en_wer: liveScore.en.rate, zh_cer: liveScore.zh.rate },
        per_line: perLine,
        formal_per_line: formal.perLine,
      };
      const dir = process.env.M14_REPORT_DIR || info.outputDir;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `m14-${visit}.json`), JSON.stringify(report, null, 2));
      console.log(
        `[m14] ${visit}: caption final p50 ${report.caption_final_ms.p50} / p90 ${report.caption_final_ms.p90} ms; ` +
          `words on screen p50 ${report.words_on_screen_ms.p50} / p90 ${report.words_on_screen_ms.p90} ms; ` +
          `card p50 ${report.card_ms.p50} / p90 ${report.card_ms.p90} ms (${report.card_ms.n}); ` +
          `formal EN WER ${(formal.en.rate * 100).toFixed(1)}% (${formal.en.refTokens} words), ZH CER ${(formal.zh.rate * 100).toFixed(1)}% (${formal.zh.refTokens} chars); ` +
          `live EN ${(liveScore.en.rate * 100).toFixed(1)}% ZH ${(liveScore.zh.rate * 100).toFixed(1)}%; offset ${round(offset)} ms by audio (r ${byAudio.corr}; line ends say ${round(byLines.offset)} ms, ${matched}/${liveLines.length} lines, ±${round(spread)} ms); ` +
          `roles right ${roles.right} / wrong ${roles.wrong} / unknown ${roles.unknown}; R lines expected [${wantRequired}] live [${report.required_lines.live_cards}] record [${report.required_lines.record_cards}]`,
      );

      // ---- gates
      // honesty first: the record and the scores must come from this recording, not from the replay's script
      expect(events.types, "the event stream was read").toContain("asr.final");
      expect(fallbacks, "no asr.fallback in this visit").toBe(0);
      expect(replayIds, "no replay lines in the record").toEqual([]);
      expect(notFromRecording, "every line of the record has its own clip cut from this recording").toEqual([]);
      // one clock: the live client saw every recorder sample from sample 0, and its clock agrees with the recorder's
      expect(live.inputSamples, "the live client was fed every recorder sample").toBe(rec.samples);
      expect(Math.abs(live.t0Wall! - t0Wall), "the live client's clock is the recording's").toBeLessThanOrEqual(15);
      expect(matched, "live line ends line up with the script").toBeGreaterThanOrEqual(Math.ceil(timeline.lines.length * 0.6));
      expect(byAudio.corr, "the recording matches the played file").toBeGreaterThan(0.6);
      expect(Math.abs(byAudio.offsetMs - byLines.offset), "the audio clock and the line-end cross-check agree").toBeLessThanOrEqual(150);
      expect(captionFinal.length, "every spoken line got its caption").toBeGreaterThanOrEqual(Math.ceil(timeline.lines.length * 0.9));
      expect(report.caption_final_ms.p50, "caption p50 within the 1.5 s target").toBeLessThanOrEqual(1500);
      expect(report.caption_final_ms.p90, "caption p90 within the 1.5 s target").toBeLessThanOrEqual(1500);
      if (cardLat.length) expect(report.card_ms.p90, "cards within 5 s").toBeLessThanOrEqual(5000);
      expect(formal.en.rate, "formal transcript English WER").toBeLessThanOrEqual(0.12);
      if (formal.zh.refTokens) expect(formal.zh.rate, "formal transcript Mandarin CER").toBeLessThanOrEqual(0.15);
      await context.close();
    } finally {
      await browser.close();
    }
  });
}
