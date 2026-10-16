/**
 * A stand-in for the Whisper service, for the two whole-line journeys of track G (23 blank, 24 example): the small
 * `FakeWhisper` of e2e/f-account-whisper.spec.ts, with the port and the lines its whole-recording job answers with as
 * parameters. It listens on 127.0.0.1 only while a journey has started it (the app server is started with
 * WHISPER_URL=http://127.0.0.1:7966 and nothing listening there, so a visit recorded before `start()` waits for its
 * transcript, and the first `asr.pending` pass after `start()` sends the saved recording here).
 *
 * What it answers, in the shapes lib/asr/whisper.ts reads:
 *   GET  /health            ready, healthy (with a GPU name that says it is a stand-in)
 *   POST /v1/chunk          one caption (`liveText`) for every chunk of the live microphone
 *   POST /v1/file           202 with a job id
 *   GET  /v1/jobs/<id>      done, with `lines` as segments (no speakers: Whisper has none), or failed when `failJobs`
 *   DELETE /v1/jobs/<id>    deleted
 *
 * `fixtureLines` reads the lines of a replay file under web/fixtures/visits (text and time points as written there).
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";

export const FAKE_WHISPER_PORT = 7966;
export const FAKE_WHISPER_GPU = "Fake GPU (track G whole-line journeys)";

/** One sentence of the whole-recording transcript. */
export interface FakeLine {
  start_ms: number;
  end_ms: number;
  text: string;
  /** "en", "zh", "zh-en"; default "en" */
  lang?: string;
}

export interface FakeWhisperOptions {
  /** what the whole-recording job answers with */
  lines: FakeLine[];
  /** default 7966, the address the journeys' app server points at */
  port?: number;
  /** the caption every live chunk gets (default: the first line's text) */
  liveText?: string;
}

export class FakeWhisper {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private jobs = 0;
  /** live chunks received */
  chunks = 0;
  /** whole recordings received */
  files = 0;
  /** every whole-recording job is taken and then fails (a recording the service cannot turn into text) */
  failJobs = false;
  lines: FakeLine[];
  readonly port: number;
  private readonly liveText: string;

  constructor(opts: FakeWhisperOptions) {
    this.lines = opts.lines;
    this.port = opts.port ?? FAKE_WHISPER_PORT;
    this.liveText = opts.liveText ?? opts.lines[0]?.text ?? "";
  }

  get up(): boolean {
    return this.server !== null;
  }

  /** The service comes up. Throws when the port is taken (another journey's fake, or a real service: not ours). */
  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => this.handle(req, res));
    server.on("connection", (s) => {
      this.sockets.add(s);
      s.on("close", () => this.sockets.delete(s));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, "127.0.0.1", () => resolve());
    });
    this.server = server;
  }

  /** The service goes away: connections are refused from now on. */
  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (!s) return;
    for (const sock of this.sockets) sock.destroy();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://fake");
    const auth = req.headers.authorization;
    if (url.pathname === "/health") {
      return send(200, {
        status: "ready",
        ready: true,
        healthy: true,
        device: "cuda",
        models: { live: "large-v3-turbo", file: "large-v3" },
        gpu: { name: FAKE_WHISPER_GPU },
        ...(auth !== undefined ? { token_ok: true } : {}),
      });
    }
    if (!(auth ?? "").startsWith("Bearer ")) return send(401, { error: "unauthorized" });
    let n = 0;
    req.on("data", (c: Buffer) => (n += c.length));
    req.on("end", () => {
      if (url.pathname === "/v1/chunk") {
        this.chunks += 1;
        const dur = Math.max(200, Math.round(((n - 44) / 32_000) * 1000));
        return send(200, { text: this.liveText, lang: "en", segments: [{ start_ms: 100, end_ms: dur - 100, text: this.liveText, lang: "en", confidence: "high" }], duration_ms: dur, model: "fake-turbo", elapsed_ms: 5 });
      }
      if (url.pathname === "/v1/file") {
        this.files += 1;
        return send(202, { job_id: `fakegjob${String(++this.jobs).padStart(6, "0")}`, status: "queued", eta_ms: 300, model: "fake-large" });
      }
      if (url.pathname.startsWith("/v1/jobs/")) {
        if (req.method === "DELETE") return send(200, { deleted: true });
        if (this.failJobs) return send(200, { status: "failed", error: "decode_failed", model: "fake-large" });
        return send(200, {
          status: "done",
          model: "fake-large",
          segments: this.lines.map((l, i) => ({ start_ms: l.start_ms, end_ms: l.end_ms, text: l.text, lang: l.lang ?? "en", region: i, confidence: "high" })),
        });
      }
      send(404, { error: "not_found" });
    });
  }
}

interface FixtureUtterance {
  id: string;
  t_start_ms: number;
  t_end_ms: number;
  lang: string;
  text: string;
}

/**
 * Lines of a replay file (web/fixtures/visits/<visit>.utterances.json), text and time points as written there.
 *   ids      only these lines, in the file's order (default: every line)
 *   startAt  the first line taken starts at this moment, and the others keep their distance to it (default: the
 *            file's own time points)
 */
export function fixtureLines(visit: "v1" | "v2" | "v3" | "p1", opts: { ids?: string[]; startAt?: number } = {}): FakeLine[] {
  const file = path.join(__dirname, "..", "..", "..", "fixtures", "visits", `${visit}.utterances.json`);
  const all = (JSON.parse(readFileSync(file, "utf8")) as { utterances: FixtureUtterance[] }).utterances;
  const taken = opts.ids ? all.filter((u) => opts.ids!.includes(u.id)) : all;
  if (opts.ids && taken.length !== opts.ids.length) throw new Error(`${visit}: not every line of ${opts.ids.join(", ")} is in the file`);
  const shift = opts.startAt !== undefined && taken.length ? opts.startAt - taken[0].t_start_ms : 0;
  return taken.map((u) => ({ start_ms: u.t_start_ms + shift, end_ms: u.t_end_ms + shift, text: u.text, lang: u.lang.startsWith("zh") ? u.lang : "en" }));
}
