/**
 * finish() -> one mp4: line the phone videos up on one clock, put them side by side under the caption band, lay the
 * captured sound in at the moments it played, encode H.264 (ffmpeg on PATH).
 *
 * The clock. A Playwright video starts at its first captured frame, which comes a little after the page is created,
 * and the webm keeps no wall-clock time for it. So when the kit opens a phone it paints the blank page black once and
 * notes Date.now() at that moment (the sync mark); here the first dark frame of the webm is found, which ties video
 * time to wall time within about one frame (40 ms). Steps, sounds and the other phones are all placed with it.
 *
 * The cut. The mp4 starts 0.3 s before the first step (the phones are already on their pages by then) and ends at
 * finish() plus the hold (the last screen stays a moment).
 */
import { spawn } from "node:child_process";
import { existsSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser } from "@playwright/test";
import type { AudioClip } from "./audio";
import { fitCaption, frameSvg, headerHtml, layoutFor, THEME } from "./render";

export interface ComposePhone {
  name: string;
  label: string;
  video: string;
  /** Date.now() when the blank page turned black */
  markWall: number;
  /** Date.now() right after the page was created (fallback when the mark is not found) */
  openedWall: number;
}

export interface ComposeStep {
  n: number;
  text: string;
  phone: string;
  wall: number;
}

export interface ComposeInput {
  browser: Browser;
  workDir: string;
  outFile: string;
  kicker: string;
  phones: ComposePhone[];
  steps: ComposeStep[];
  clips: AudioClip[];
  cornerLabel: string | null;
  endWall: number;
  viewport: { width: number; height: number };
  dsf: number;
  fps?: number;
  crf?: number;
}

export interface ComposeResult {
  file: string;
  /** seconds */
  duration: number;
  width: number;
  height: number;
  sizeBytes: number;
  hasAudio: boolean;
  /** each step's time in the mp4, seconds */
  steps: { n: number; text: string; phone: string; t: number }[];
  /** each sound's place in the mp4, seconds */
  clips: { phone: string; src: string; t: number; duration: number }[];
  /** how each phone was put on the clock */
  sync: { phone: string; method: "mark" | "estimate"; offset: number }[];
  warnings: string[];
}

export interface ProbeStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
}

export interface Probe {
  duration: number;
  size: number;
  streams: ProbeStream[];
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new Error(`${cmd} is not on PATH: the journey kit needs ffmpeg and ffprobe (https://ffmpeg.org)`) : err),
    );
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function ffprobe(file: string): Promise<Probe> {
  const r = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels", "-of", "json", file]);
  if (r.code !== 0) throw new Error(`ffprobe ${file}: ${r.stderr.trim()}`);
  const j = JSON.parse(r.stdout) as { format: { duration?: string; size?: string }; streams: ProbeStream[] };
  return { duration: Number(j.format.duration ?? 0), size: Number(j.format.size ?? 0), streams: j.streams };
}

/**
 * The time (s) of the first frame that is clearly darker than the first frame, within the first few seconds, and
 * whether that frame is dark edge to edge (it is not when the page was captured smaller than the video).
 */
export async function findMark(video: string): Promise<{ t: number; full: boolean } | null> {
  const r = await run("ffmpeg", ["-hide_banner", "-nostats", "-t", "6", "-i", video, "-vf", "scale=32:32,showinfo", "-f", "null", "-"]);
  let first: number | null = null;
  for (const line of r.stderr.split(/\r?\n/)) {
    const m = /pts_time:\s*([\d.]+).*?mean:\[(\d+)/.exec(line);
    if (!m) continue;
    const y = Number(m[2]);
    if (first === null) {
      first = y;
      continue;
    }
    if (y < first - 40) return { t: Number(m[1]), full: y < 60 };
  }
  return null;
}

/** "1:05.3" */
export function clock(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const even = (x: number) => Math.round(x / 2) * 2;

async function renderPngs(input: ComposeInput, layout: ReturnType<typeof layoutFor>): Promise<{ frame: string; headers: string[] }> {
  const context = await input.browser.newContext({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: input.dsf });
  try {
    const page = await context.newPage();
    const frame = path.join(input.workDir, "frame.png");
    await page.setContent(frameSvg(layout.width, layout.height, layout.boxes));
    await page.locator("#frame").screenshot({ path: frame, omitBackground: true });
    const headers: string[] = [];
    const total = input.steps.length;
    for (const [i, step] of input.steps.entries()) {
      await page.setContent(
        headerHtml({
          width: layout.width,
          kicker: input.kicker,
          count: `${i + 1} / ${total}`,
          caption: step.text,
          corner: input.cornerLabel,
          labels: input.phones.map((p, k) => ({ text: p.label, active: p.name === step.phone, box: layout.boxes[k] })),
        }),
      );
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.evaluate(fitCaption);
      const file = path.join(input.workDir, `step-${String(i + 1).padStart(2, "0")}.png`);
      await page.locator("#hdr").screenshot({ path: file });
      headers.push(file);
    }
    return { frame, headers };
  } finally {
    await context.close();
  }
}

export async function composeJourney(input: ComposeInput): Promise<ComposeResult> {
  const fps = input.fps ?? 25;
  const crf = input.crf ?? 28;
  const warnings: string[] = [];
  if (!input.steps.length) throw new Error("the journey has no steps: call kit.step() before finish()");

  // 1. every phone on the wall clock: wall time of its video's t=0
  const sync: ComposeResult["sync"] = [];
  const origins: number[] = [];
  for (const p of input.phones) {
    const mark = await findMark(p.video);
    if (mark) {
      origins.push(p.markWall - mark.t * 1000);
      sync.push({ phone: p.name, method: "mark", offset: r3(mark.t) });
      if (!mark.full) {
        warnings.push(
          `${p.name}: the page fills only part of the video frame; launch Chromium with --force-device-scale-factor equal to deviceScaleFactor (playwright.journeys.config.ts)`,
        );
      }
    } else {
      origins.push(p.openedWall);
      sync.push({ phone: p.name, method: "estimate", offset: 0 });
      warnings.push(`${p.name}: sync mark not found in the video; timing estimated from page creation (may be off by a few frames)`);
    }
  }
  const t0 = Math.min(...origins);
  const at = (wall: number) => (wall - t0) / 1000;
  const start = Math.max(0, at(input.steps[0].wall) - 0.3);
  const duration = r3(at(input.endWall) - start);
  if (duration <= 0.5) throw new Error(`nothing to record: ${duration}s between the first step and finish()`);

  // 2. the picture: canvas, phones, frame, caption band per step
  const layout = layoutFor(input.phones.length, input.viewport);
  const W = even(layout.width * input.dsf);
  const H = even(layout.height * input.dsf);
  const { frame, headers } = await renderPngs(input, layout);
  const stepT = input.steps.map((s) => r3(Math.max(0, at(s.wall) - start)));

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${THEME.background.replace("#", "0x")}:s=${W}x${H}:r=${fps}:d=${duration}`];
  for (const p of input.phones) args.push("-i", p.video);
  const frameIn = 1 + input.phones.length;
  args.push("-i", frame);
  const headerIn = frameIn + 1;
  for (const h of headers) args.push("-i", h);
  const audioIn = headerIn + headers.length;

  const graph: string[] = [];
  input.phones.forEach((p, i) => {
    const pad = r3((origins[i] - t0) / 1000);
    const chain = [
      ...(pad > 0 ? [`tpad=start_duration=${pad}:start_mode=clone`] : []),
      `trim=start=${r3(start)}`,
      "setpts=PTS-STARTPTS",
      `tpad=stop_mode=clone:stop_duration=${Math.ceil(duration) + 2}`,
      `fps=${fps}`,
    ];
    graph.push(`[${i + 1}:v]${chain.join(",")}[p${i}]`);
  });
  let last = "0:v";
  input.phones.forEach((_, i) => {
    const box = layout.boxes[i];
    graph.push(`[${last}][p${i}]overlay=x=${box.left * input.dsf}:y=${box.top * input.dsf}:eof_action=repeat[b${i}]`);
    last = `b${i}`;
  });
  graph.push(`[${last}][${frameIn}:v]overlay=0:0[fr]`);
  last = "fr";
  headers.forEach((_, i) => {
    const from = i === 0 ? null : stepT[i];
    const to = i + 1 < headers.length ? stepT[i + 1] : null;
    const cond = [from === null ? null : `gte(t,${from})`, to === null ? null : `lt(t,${to})`].filter(Boolean).join("*");
    graph.push(`[${last}][${headerIn + i}:v]overlay=0:0${cond ? `:enable='${cond}'` : ""}[h${i}]`);
    last = `h${i}`;
  });
  graph.push(`[${last}]format=yuv420p[vout]`);

  // 3. the sound: each stretch trimmed to what played, delayed to when it played
  const placed: ComposeResult["clips"] = [];
  const audioLabels: string[] = [];
  let nextAudio = audioIn;
  for (const clip of input.clips) {
    if (!clip.file || !existsSync(clip.file)) {
      warnings.push(`no audio file for ${clip.src}: left out of the mp4`);
      continue;
    }
    if (clip.muted || clip.volume <= 0) continue;
    let t = at(clip.startWall) - start;
    let from = clip.startPos;
    const wallLen = ((clip.endWall ?? input.endWall) - clip.startWall) / 1000;
    let to = clip.endPos !== null && clip.endPos > from ? clip.endPos : from + wallLen * clip.rate;
    if (t < 0) {
      from += -t * clip.rate;
      t = 0;
    }
    if (to <= from + 0.02 || t >= duration) continue;
    to = Math.min(to, from + (duration - t) * clip.rate);
    args.push("-i", clip.file);
    const k = audioLabels.length;
    const filters = [
      `atrim=start=${r3(from)}:end=${r3(to)}`,
      "asetpts=PTS-STARTPTS",
      ...(clip.rate !== 1 ? [`atempo=${clip.rate}`] : []),
      ...(clip.volume !== 1 ? [`volume=${clip.volume}`] : []),
      `adelay=delays=${Math.round(t * 1000)}:all=1`,
    ];
    graph.push(`[${nextAudio}:a]${filters.join(",")}[a${k}]`);
    audioLabels.push(`[a${k}]`);
    placed.push({ phone: clip.phone, src: clip.src, t: r3(t), duration: r3((to - from) / clip.rate) });
    nextAudio++;
  }
  if (audioLabels.length === 1) graph.push(`${audioLabels[0]}apad[aout]`);
  else if (audioLabels.length > 1) graph.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:normalize=0:dropout_transition=0,apad[aout]`);

  const part = `${input.outFile}.part.mp4`;
  args.push("-filter_complex", graph.join(";"), "-map", "[vout]");
  if (audioLabels.length) args.push("-map", "[aout]");
  args.push("-t", String(duration), "-r", String(fps), "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p");
  if (audioLabels.length) args.push("-c:a", "aac", "-b:a", "96k", "-ar", "48000", "-ac", "1");
  args.push("-movflags", "+faststart", part);
  writeFileSync(path.join(input.workDir, "ffmpeg-args.json"), JSON.stringify(args, null, 1));

  const r = await run("ffmpeg", args);
  if (r.code !== 0) {
    rmSync(part, { force: true });
    throw new Error(`ffmpeg failed (${r.code}): ${r.stderr.trim().slice(-2000)}\n(arguments in ${path.join(input.workDir, "ffmpeg-args.json")})`);
  }
  renameSync(part, input.outFile);
  const probe = await ffprobe(input.outFile);
  const v = probe.streams.find((s) => s.codec_type === "video");
  return {
    file: input.outFile,
    duration: r3(probe.duration),
    width: v?.width ?? W,
    height: v?.height ?? H,
    sizeBytes: statSync(input.outFile).size,
    hasAudio: probe.streams.some((s) => s.codec_type === "audio"),
    steps: input.steps.map((s, i) => ({ n: s.n, text: s.text, phone: s.phone, t: stepT[i] })),
    clips: placed,
    sync,
    warnings,
  };
}
