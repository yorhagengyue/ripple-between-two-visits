/**
 * The plan documents that describe the system to the team, CodeBuddy and the Ripple integration (CODEBUDDY.md,
 * docs/plan/web-app.md, spec.md, ripple-integration.md, tasks/) checked against the code they describe. A code
 * change that makes one of these sentences stale fails here, with the file and line to update.
 *   - The layer-3 checker is the same vendor as the main model (deepseek-v4-pro next to deepseek-flash); no document
 *     says it is another vendor's model today, and a second vendor appears only as the future.
 *   - Wei Ling's phone: every route that turns her away in its own code (denyFamily, denyNonPatient,
 *     reminderAuthorFor) and every entry of her allow-list (lib/family/gate.ts FAMILY_API, FAMILY_PAGES) is named
 *     in spec.md section 2 and in ripple-integration.md 5.3 ("本 app 现在").
 *   - TTS_PROVIDER=mock is the placeholder tone labelled "test voice" (lib/tts/mock.ts), never recorded audio; and
 *     keys alone never switch read-aloud to TRTC (C2 track T: the adapter, lib/tts/trtc.ts, is written and unverified;
 *     the plan documents still say "stub" until the documentation pass).
 *   - spec.md section 5 step 4 names layer 1's rules as lib/safety does them: real sentence ends, the ending mark
 *     compared by class, a sentence that leans on its neighbour, relevance (every reason code relevanceReasons can
 *     give; R1, R2, R4 exempt and R3 checked; labels and leaflet restatements checked), and the plain-label Mandarin
 *     template; the M13 paragraph says any answer near crisis words gets the safety line when no crisis screen
 *     vouched for it, with the helplines after it near self-harm words, and everyday idioms do not count.
 *   - A failing Whisper service: no document says the visit falls back to mock; CODEBUDDY.md and web-app.md say what
 *     lib/asr/whisper.ts does (the replay only with ASR_REPLAY_FALLBACK on, the record from the visit's own live lines).
 *   - hosting.md quotes EdgeOne's rule order from the row about several rules (46151), and says what preflight's
 *     model lines check (scripts/preflight.ts checkModels, 10-10: the configured provider as lib/llm reads it, one
 *     GET /models for the main model and the checker); so does web/.env.example.
 *   - ripple-integration.md cites this repo only as `本仓/<path>:N` (the form its citation check reads), and every
 *     cited file and line exists.
 *   - (B1 and B2 wrap-up, 10-10) spec.md section 2 names every identity kind of lib/family/identity.ts, every
 *     ANONYMOUS_API route and every refusal of the join route (lib/family/join.ts), and GET /api/session's member
 *     shape; ripple-integration.md 5.3 says the same and no longer calls the closed gaps open; spec.md section 5 names
 *     the whole-line rule and the transcript neighbours (verify.ts sourceQuote, wholeSourceBlock, candidates.ts
 *     lineContext), the rules-only crisis cue and someone else's templates (pipeline.ts applyRulesOnlyCue, classify.ts
 *     emergencyCue, aboutSomeoneElse) and screen_none; section 6 lists her stream's session fields.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { et } from "@/lib/explain/i18n";
import { FAMILY_SESSION_FIELDS } from "@/lib/family/events";
import { ANONYMOUS_API, FAMILY_API, FAMILY_PAGES } from "@/lib/family/gate";
import { PATIENT_EXISTS, ROLE_NOT_JOINABLE } from "@/lib/family/join";
import { DEEPSEEK_CHECKER_MODEL, DEEPSEEK_MAIN_MODEL } from "@/lib/llm";
import { crisisCue, selfHarmCue } from "@/lib/safety/classify";
import { MEMBER_VIEW_FIELDS } from "@/lib/session/members";

const WEB = process.cwd();
const REPO = path.join(WEB, "..");
/**
 * docs/plan and CODEBUDDY.md live only in the main checkout (they are not in git); a worktree without them skips this file.
 * During the C2 build (10-10) the plan documents describe the demo and are rewritten at the end, so this file runs only
 * with DOCS_SYNC=1 (the final documentation pass turns it back on).
 */
const HAVE_DOCS =
  process.env.DOCS_SYNC === "1" && existsSync(path.join(REPO, "docs", "plan")) && existsSync(path.join(REPO, "CODEBUDDY.md"));
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");
const lines = (rel: string) => read(rel).split(/\r?\n/);
const where = (rel: string, i: number) => `${rel}:${i + 1}`;

/** The one line that starts with `start` (the paragraphs below are each one line of markdown). */
function lineStarting(rel: string, start: string): string {
  const found = lines(rel).filter((l) => l.startsWith(start));
  expect(found, `${rel}: one line starting with ${start}`).toHaveLength(1);
  return found[0];
}

describe.skipIf(!HAVE_DOCS)("the layer-3 checker is the same vendor as the main model, wherever the plan describes it", () => {
  const DOCS = ["CODEBUDDY.md", "docs/plan/web-app.md", "docs/plan/spec.md", "docs/plan/ripple-integration.md", "docs/plan/tasks/M8-backstage.md"];

  it("no document says the checker is another vendor's model today; a second vendor is only ever the future", () => {
    for (const rel of DOCS) {
      lines(rel).forEach((l, i) => {
        expect(l, where(rel, i)).not.toMatch(/另一家模型|「第二家模型」|跨模型核对/);
        if (l.includes("第二家")) expect(l, where(rel, i)).toMatch(/以后|商业版/);
      });
    }
  });

  it("each document that describes the checker names it next to the main model and says it is the same vendor", () => {
    for (const rel of ["CODEBUDDY.md", "docs/plan/web-app.md", "docs/plan/spec.md", "docs/plan/tasks/M8-backstage.md"]) {
      expect(
        lines(rel).some((l) => l.includes(DEEPSEEK_CHECKER_MODEL) && l.includes(DEEPSEEK_MAIN_MODEL) && l.includes("同一家")),
        `${rel}: a line with ${DEEPSEEK_CHECKER_MODEL}, ${DEEPSEEK_MAIN_MODEL} and 同一家`,
      ).toBe(true);
    }
    // web-app.md 6.3 item 3 said "another vendor's model" until the 10-09 round 2 fix
    const item3 = lineStarting("docs/plan/web-app.md", "3. **核对模型**");
    expect(item3).toContain(`同一家（DeepSeek）的 \`${DEEPSEEK_CHECKER_MODEL}\``);
    expect(item3).toContain("独立性比两家弱");
  });
});

// ------------------------------------------------------------------ Wei Ling's phone

type Guard = "denyFamily" | "denyNonPatient" | "reminderAuthorFor";

/** "METHOD /api/path" for every exported handler under app/api whose own code calls the guard. */
function routesCalling(guard: Guard): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n === "route.ts") {
        const text = readFileSync(p, "utf8");
        const call = new RegExp(`\\b${guard}\\(`);
        if (!call.test(text.replace(/\/\*[\s\S]*?\*\//g, ""))) continue;
        const route = "/" + path.relative(path.join(WEB, "app"), path.dirname(p)).split(path.sep).join("/");
        // [before, METHOD, body, METHOD, body, ...]: a body runs to the next exported handler
        const parts = text.split(/^export (?:async )?function (GET|POST|PATCH|PUT|DELETE)\b/m);
        const found: string[] = [];
        for (let i = 1; i < parts.length; i += 2) if (call.test(parts[i + 1])) found.push(`${parts[i]} ${route}`);
        expect(found.length, `${route}: ${guard} is called, but not inside an exported handler this test can read`).toBeGreaterThan(0);
        out.push(...found);
      }
    }
  };
  walk(path.join(WEB, "app", "api"));
  return out.sort();
}

describe.skipIf(!HAVE_DOCS)("Wei Ling's phone: the documents name every route the code turns her away from, and her whole allow-list", () => {
  const SPEC = () => lineStarting("docs/plan/spec.md", "**女儿的手机按身份默认拒绝（M6）。**");
  const RIPPLE = () => lineStarting("docs/plan/ripple-integration.md", "- **本 app 现在**：女儿");

  it("the routes' own checks (denyFamily, denyNonPatient, reminderAuthorFor)", () => {
    const refused = routesCalling("denyFamily");
    // the ones the acceptance list names, and the four B1 added (ask, clock, GET notes, GET bp)
    for (const r of ["POST /api/understanding", "PATCH /api/meds/[id]", "POST /api/bp", "POST /api/notes", "POST /api/ask", "POST /api/clock", "GET /api/notes", "GET /api/bp"]) {
      expect(refused).toContain(r);
    }
    const spec = SPEC();
    const ripple = RIPPLE();
    for (const r of [...refused, ...routesCalling("denyNonPatient")]) {
      expect(spec, `spec.md section 2 should name ${r}`).toContain(`\`${r}\``);
      expect(ripple, `ripple-integration.md 5.3 should name ${r}`).toContain(`\`${r}\``);
    }
    for (const r of routesCalling("reminderAuthorFor")) expect(spec, `spec.md section 2 should name ${r}`).toContain(`\`${r}\``);
  });

  it("the deny-by-default allow-list (lib/family/gate.ts) and what is outside it", () => {
    const spec = SPEC();
    const ripple = RIPPLE();
    for (const rule of FAMILY_API) {
      const r = `${rule.method} ${rule.route}`;
      expect(spec, `spec.md section 2 should list ${r}`).toContain(`\`${r}\``);
      expect(ripple, `ripple-integration.md 5.3 should list ${r}`).toContain(`\`${r}\``);
    }
    for (const page of FAMILY_PAGES) {
      expect(spec).toContain(`\`${page.route}\``);
      expect(ripple).toContain(`\`${page.route}\``);
    }
    for (const text of [spec, ripple]) {
      expect(text).toContain("307 到 `/f`");
      expect(text).toContain("403 `patient_only`");
      expect(text).toContain("503 `role_unavailable`");
    }
    expect(ripple).toContain("商业版的授权检查要把这张默认拒绝的允许清单整张搬过去");
  });

  it("spec.md section 6 says what her live stream carries, as lib/family/events.ts does", () => {
    const s6 = lineStarting("docs/plan/spec.md", "**女儿的手机在事件流上收到什么（M6，`lib/family/events.ts`）。**");
    const events = readFileSync(path.join(WEB, "lib", "family", "events.ts"), "utf8");
    for (const type of ["family_grant.changed", "clock.changed", "session.reset", "session.filming_mode", "dose.logged", "reminder.clip_added"]) {
      expect(events, type).toContain(`"${type}"`);
      expect(s6, type).toContain(`\`${type}\``);
    }
    expect(s6).toContain("`say`（后台那句话，会引他的原话）从来不发给她");
    expect(s6).toContain("不认识的类型（以后新加的）一律丢掉");
    // B1 wrap-up 10-10: the session row reaches her cut to the fields /f uses, never the join code
    for (const f of FAMILY_SESSION_FIELDS) expect(s6, f).toContain(`\`${f}\``);
    expect(s6).toContain("没有加入码");
  });
});

describe.skipIf(!HAVE_DOCS)("who a device is, and what the joining code can make it, as lib/family says (B1 wrap-up 10-10)", () => {
  const spec = (rel = "docs/plan/spec.md") => lines(rel);
  const family = (...p: string[]) => readFileSync(path.join(WEB, "lib", "family", ...p), "utf8");

  it("spec.md section 2: every identity kind, every ANONYMOUS_API route, the join refusals and GET /api/session's member shape", () => {
    const gateLine = lineStarting("docs/plan/spec.md", "**女儿的手机按身份默认拒绝（M6）。**");
    const kinds = [...new Set([...family("identity.ts").matchAll(/\{ kind: "([a-z_]+)"/g)].map((m) => m[1]))].sort();
    expect(kinds).toEqual(["anonymous", "cookie", "family_elsewhere", "member", "none", "stranger"]);
    expect(gateLine).toContain("结果是六种之一");
    for (const k of kinds) expect(gateLine, k).toContain(`\`${k}\``);
    for (const r of ANONYMOUS_API) expect(gateLine, `${r.method} ${r.route}`).toContain(`\`${r.method} ${r.route}\``);
    expect(gateLine).toContain(`\`ANONYMOUS_API\` ${["零", "一", "二", "三", "四", "五", "六", "七"][ANONYMOUS_API.length]}个`);
    for (const fn of ["denyOutsider", "sessionCaller", "STRANGER_API", "ANONYMOUS_API"]) {
      expect(gateLine, fn).toContain(`\`${fn}\``);
    }
    expect(gateLine).toContain("403 `member_required`");
    expect(gateLine).not.toContain("还没堵上的两处");
    const joinRow = spec().find((l) => l.startsWith("| `POST /api/session/join` |")) ?? "";
    for (const code of [PATIENT_EXISTS, ROLE_NOT_JOINABLE, "crew_key_required", "crew_key_wrong", "crew_key_attempts", "patient_only", "role_unavailable"]) {
      expect(family("join.ts"), code).toContain(code);
      expect(joinRow, code).toContain(`\`${code}\``);
    }
    const sessionRow = spec().find((l) => l.startsWith("| `GET /api/session` |")) ?? "";
    // the members go through lib/session/members.ts memberView (10-10: the session.member_joined event uses it too)
    expect(readFileSync(path.join(WEB, "app", "api", "session", "route.ts"), "utf8")).toContain(".map(memberView)");
    expect([...MEMBER_VIEW_FIELDS]).toEqual(["role", "device_label", "created_at"]);
    expect(sessionRow).toContain("`{ role, device_label, created_at }`，从不回行的 `id`");
  });

  it("ripple-integration.md 5.3 says the same, and no longer calls the closed gaps open", () => {
    const ripple = lineStarting("docs/plan/ripple-integration.md", "- **本 app 现在**：女儿");
    expect(ripple).toContain("`本仓/web/lib/family/identity.ts:");
    expect(ripple).toContain("`本仓/web/lib/family/join.ts:");
    expect(ripple).toContain("403 `member_required`");
    for (const closed of ["家属身份还跨场次", "可以选任何身份", "照旧算他这边（`本仓/web/lib/family/role.ts"]) expect(ripple, closed).not.toContain(closed);
  });
});

describe.skipIf(!HAVE_DOCS)("TTS_PROVIDER=mock is described as the placeholder it is", () => {
  it("a per-character tone labelled test voice, never recorded audio", () => {
    expect(readFileSync(path.join(WEB, "lib", "tts", "mock.ts"), "utf8")).toContain('the read-aloud button says "test voice"');
    const label = `${et("zh-Hans", "read.mock")} / ${et("en", "read.mock")}`;
    expect(label).toBe("测试声音 / test voice");
    for (const rel of ["CODEBUDDY.md", "docs/plan/web-app.md", "docs/plan/spec.md", "docs/plan/hosting.md", "docs/plan/tasks/M5-explain.md"]) {
      lines(rel).forEach((l, i) => {
        if (l.includes("TTS_PROVIDER=mock")) expect(l, where(rel, i)).not.toMatch(/录好|回放音频|朗读音频|recorded/);
      });
    }
    for (const rel of ["docs/plan/web-app.md", "docs/plan/tasks/M5-explain.md"]) {
      const l = lines(rel).find((x) => x.includes("TTS_PROVIDER=mock")) ?? "";
      expect(l, rel).toContain("占位声音");
      expect(l, rel).toContain(`「${label}」`);
    }
  });

  it("keys alone do not switch read-aloud to TRTC: every line that says when it switches also speaks of the adapter", () => {
    // C2 track T (10-11): the adapter is written (lib/tts/trtc.ts) and has not been run against the real service. The
    // plan documents still call it a stub ("桩"): the documentation pass rewrites those lines (written, not verified;
    // it needs TENCENT_SECRET_ID / TENCENT_SECRET_KEY, not TRTC_SDK_SECRET_KEY) and may then tighten the pattern below.
    // the code: without a cloud API key pair lib/tts/trtc.ts answers not_configured, so POST /api/tts is 503
    expect(readFileSync(path.join(WEB, "lib", "tts", "trtc.ts"), "utf8")).toContain('throw new TtsError("not_configured"');
    const DOCS = ["CODEBUDDY.md", "docs/plan/web-app.md", "docs/plan/spec.md", "docs/plan/hosting.md", "docs/plan/tasks/M5-explain.md", "docs/plan/tasks/M8-backstage.md"];
    let checked = 0;
    for (const rel of DOCS) {
      lines(rel).forEach((l, i) => {
        if (!/TRTC/.test(l) || !/语音合成|朗读|TTS/.test(l) || !/密钥|mock/.test(l)) return;
        checked++;
        expect(l, where(rel, i)).toMatch(/适配器|桩/);
      });
    }
    // CODEBUDDY.md:30, web-app.md:36, 59, 118, 326, hosting.md 5.5, M8-backstage.md item 3
    expect(checked).toBeGreaterThanOrEqual(7);
    expect(read("web/.env.example")).toContain("has NOT been run against the real service");
    expect(read("web/.env.example")).toContain("a direct POST /api/tts answers 503");
  });
});

describe.skipIf(!HAVE_DOCS)("spec.md section 5 says what layer 1 and the safety line do (lib/safety)", () => {
  const code = (...p: string[]) => readFileSync(path.join(WEB, "lib", "safety", ...p), "utf8");

  it("step 4: sentence ends, the ending mark, leaning sentences, relevance and the label template, named as the code names them", () => {
    const step4 = lineStarting("docs/plan/spec.md", "4. 第一道（槽位和话是谁的）");
    const text = code("text.ts");
    for (const fn of ["sentenceSpans", "sameMark", "standsAlone", "matchWholeSentences"]) {
      expect(text, fn).toMatch(new RegExp(`(?:function|const) ${fn}\\b`));
      expect(step4, fn).toContain(`\`${fn}\``);
    }
    expect(step4).toContain("「?」不能当「.」");
    // relevance: every reason relevanceReasons can give is named
    const verify = code("verify.ts");
    const body = /export function relevanceReasons[\s\S]*?\n}\n/.exec(verify)?.[0] ?? "";
    // every reason it gives: pushed for a spoken line, or returned for a label or leaflet line
    const reasons = [...new Set([...body.matchAll(/(?:reasons\.push\(|return \[)"([a-z_]+)"/g)].map((m) => m[1]))];
    expect(reasons.sort()).toEqual(["answer_to_another_question", "combination_not_all_medicines", "not_about_combining", "source_about_other_medicine", "source_medicine_unknown"]);
    for (const r of reasons) expect(step4, r).toContain(`\`${r}\``);
    expect(step4).toContain("`relevanceReasons`");
    // B2 fix round 2: R1, R2, R4 exempt, R3 checked; labels and leaflet restatements checked too
    expect(verify).toContain('const STANDING_LINES = ["R1", "R2", "R4"];');
    expect(body).toContain('candidate.kind === "label" || candidate.kind === "patient_text"');
    expect(step4).not.toContain("R1–R4 除外");
    expect(step4).toContain("R1、R2、R4 是不管问什么都照转的医生原话，不查；R3 和别的看诊话一样查，`STANDING_LINES`");
    expect(step4).toContain("药袋句和单张转述各讲一种药");
    expect(step4).toContain("模板、转介和他自己的记录不查这一条");
    expect(body).toContain("candidate.cite?.requiredLine");
    // the Mandarin label template only for a plain how-to-take line
    expect(code("zh.ts")).toMatch(/function plainHowToTake\b/);
    expect(step4).toContain("`plainHowToTake`");
    expect(step4).toContain("「Do not take more than 2 tablets a day」");
  });

  it("the M13 paragraph and step 1: any non-crisis answer near crisis words gets the safety line when no screen vouched for it", () => {
    const m13 = lineStarting("docs/plan/spec.md", "**核对和日常记录（M13）。**");
    const pipeline = code("pipeline.ts");
    expect(pipeline).toMatch(/if \(gap && crisisCue\(text\)\) \{\s*safetyLine = \{ reason: gap, cue: true \}/);
    expect(m13).toContain("`crisisCue`");
    expect(m13).toContain("`{ reason, cue: true }`");
    expect(lineStarting("docs/plan/spec.md", "1. 分类：")).toContain("`crisisCue`");
    // B2 fix round 2: near self-harm words the safety line brings the helplines (pushSafetyTail); idioms do not count
    expect(pipeline).toMatch(/if \(!selfHarmCue\(text\)\) return;\s*line\.helplines = true;\s*for \(const id of selfHarmTemplateIds\(locale\)\.slice\(1\)\)/);
    expect(code("templates.ts")).toContain('const ids: TemplateId[] = [aboutSomeoneElse ? "self_harm_995_other" : "self_harm_995", "self_harm_sos", "self_harm_mindline"];');
    expect(m13).toContain("`selfHarmCue`");
    expect(m13).toContain("安全句后面再跟热线模板（`self_harm_sos`、`self_harm_mindline`，华语界面加 `self_harm_care_corner`），`safetyLine` 多记 `helplines: true`");
    expect(m13).toContain("「累死」「笑死」「dead tired」「my phone died」这类说法先去掉再看危机词");
    expect(lineStarting("docs/plan/spec.md", "1. 分类：")).toContain("`selfHarmCue`");
    for (const idiom of ["我今天累死了", "笑死我了", "I'm dead tired today", "my phone died"]) expect(crisisCue(idiom), idiom).toBe(false);
    for (const word of ["我不想活", "我是负担", "要准备后事", "goodbye everyone", "I am tired of living", "saya penat hidup"]) {
      expect(selfHarmCue(word), word).toBe(true);
    }
  });

  it("fix round 3 (10-10): step 4 names the whole-line rule and the transcript neighbours, step 1 the rules-only cue and someone else's templates, M13 screen_none", () => {
    const step4 = lineStarting("docs/plan/spec.md", "4. 第一道（槽位和话是谁的）");
    const verify = code("verify.ts");
    for (const name of ["sourceQuote", "WHOLE_SOURCE_KINDS", "wholeSourceBlock"]) {
      expect(verify, name).toMatch(new RegExp(`(?:function|const) ${name}\\b`));
      expect(step4, name).toContain(`\`${name}\``);
    }
    expect(verify).toContain('"cut_from_context"');
    expect(step4).toContain("`cut_from_context`");
    expect(code("candidates.ts")).toMatch(/export function lineContext\b/);
    expect(code("candidates.ts")).toContain("const NEIGHBOUR_GAP_MS = 5000;");
    expect(step4).toContain("`lineContext`：同一角色或同一声纹簇，间隔不超过 5 秒，不发给模型");
    expect(code("text.ts")).toContain("if (!opts.printed && NEGATED_VERB_END.test(s)) return true;");
    expect(step4).toContain("「Do not crush. Swallow whole.」照常显示");
    const step1 = lineStarting("docs/plan/spec.md", "1. 分类：");
    const pipeline = code("pipeline.ts");
    expect(pipeline).toMatch(/const applyRulesOnlyCue = \(\)/);
    expect(step1).toContain("`applyRulesOnlyCue`");
    for (const reason of ["rule:emergency_cue", "rule:self_harm_cue"]) {
      expect(pipeline, reason).toContain(`reason: "${reason}"`);
      expect(step1, reason).toContain(`\`${reason}\``);
    }
    for (const fn of ["emergencyCue", "aboutSomeoneElse"]) {
      expect(code("classify.ts"), fn).toMatch(new RegExp(`export function ${fn}\\b`));
      expect(step1, fn).toContain(`\`${fn}\``);
    }
    expect(code("templates.ts")).toContain("emergency_overdose_other: T({");
    expect(step1).toContain("`emergency_overdose_other`");
    expect(pipeline).toContain('const gap = screenGap() ?? "screen_none";');
    const m13 = lineStarting("docs/plan/spec.md", "**核对和日常记录（M13）。**");
    expect(m13).toContain("`screen_none`");
    expect(m13).not.toContain("筛查正常答 none 时不加");
  });
});

describe.skipIf(!HAVE_DOCS)("what a failing Whisper service falls back to, as lib/asr says it (B5 fix 10-09 night)", () => {
  it("no document says the visit falls back to mock; the two summary lines say what the code does", () => {
    const whisper = readFileSync(path.join(WEB, "lib", "asr", "whisper.ts"), "utf8");
    // the code: live captions fall back to the replay only with ASR_REPLAY_FALLBACK on (empty = on); the record is the
    // visit's own live Whisper lines or fails; a recorded visit never becomes the replay file's script
    expect(whisper).toContain("A recorded visit never becomes the replay file's script");
    expect(whisper).toContain("the screen showed the replay while recording (preferFixture, only with ASR_REPLAY_FALLBACK on)");
    expect(whisper).toMatch(/ASR_REPLAY_FALLBACK \(on \| off, default on\)/);
    for (const rel of ["CODEBUDDY.md", "docs/plan/web-app.md", "docs/plan/spec.md", "docs/plan/tasks/M14-whisper.md"]) {
      lines(rel).forEach((l, i) => expect(l, where(rel, i)).not.toMatch(/退回 ?`?mock`?/));
    }
    const summaries = [
      lineStarting("CODEBUDDY.md", "- 语音识别用本地 Whisper 服务"),
      lineStarting("docs/plan/web-app.md", "| 转写 |"),
    ];
    for (const l of summaries) {
      expect(l).toContain("`ASR_REPLAY_FALLBACK` 开着时（空 = 开，演示用）换成示例回放，关着时字幕停、录音照录");
      expect(l).toContain("整段正式稿做不出来时用这次看诊已有的现场 Whisper 字幕，没有就失败");
      expect(l).toContain("录音已经存在看诊上时不丢，再点「结束看诊」（服务回来后页面也会自己再试）用存着的录音重做");
      expect(l).toContain("录过音的看诊不拿回放的剧本当记录（屏上本来就在放回放的除外）");
    }
    // the code behind the saved-recording clause: the job status says deferred, the page retries on its own
    expect(readFileSync(path.join(WEB, "app", "api", "asr", "jobs", "[id]", "route.ts"), "utf8")).toContain("deferred = saved && serviceProblem(job.error, job.fallback?.used);");
    expect(readFileSync(path.join(WEB, "components", "visit", "VisitFlow.tsx"), "utf8")).toMatch(/deferred: the recording is saved and the speech service is down\. Check every RETRY_LATER_MS/);
  });
});

describe.skipIf(!HAVE_DOCS)("hosting.md cites EdgeOne's rule order from the row that is about several rules (B5 fix 10-09 night)", () => {
  const HOSTING = "docs/plan/hosting.md";

  it("5.3 item 4 quotes the multiple-rules row and its Note; the supersede sentence is named as the single-rule row", () => {
    const item4 = lineStarting(HOSTING, "4. 规则引擎。");
    expect(item4).toContain("「Multiple rules in the rule engine」那一行：「The rules are executed in relative order, from top to bottom.」");
    expect(item4).toContain("「You can place general or coarse-grained rules at the top as the default configuration and request-specific or finer-grained rules at the bottom.」");
    expect(item4).toContain("在「Single rule in the rule engine」那一行，说的是同一条规则里并列的几个 IF");
    expect(item4).toContain("以第 5.12 节第 5 条的实测为准");
    const source = lineStarting(HOSTING, "- EdgeOne · 规则引擎概述");
    expect(source).toContain("「Multiple rules in the rule engine」：「The rules are executed in relative order, from top to bottom.」");
    expect(source).toContain("「Single rule in the rule engine」：同一条规则里并列的 IF");
    expect(source).toContain("https://edgeone.ai/document/46151");
    // the supersede sentence is quoted only next to the single-rule row
    lines(HOSTING).forEach((l, i) => {
      if (l.includes("supersede")) expect(l, where(HOSTING, i)).toContain("Single rule in the rule engine");
    });
  });

  it("5.12 item 6 and .env.example say what preflight's model lines check, as scripts/preflight.ts does", () => {
    const preflight = readFileSync(path.join(WEB, "scripts", "preflight.ts"), "utf8");
    const models = /async function checkModels[\s\S]*?\n}\n/.exec(preflight)?.[0] ?? "";
    // the code since 10-10: the configured main model and checker as lib/llm reads them (its key order included), one
    // free GET /models each, and a key whose environment value differs from web/.env is FAIL without a call
    for (const used of ["mainProviderKind(process.env)", "mainModel(process.env)", "checkerConfig(process.env)", "vendorKey(VENDORS.deepseek, process.env)", "checkListed(", "note.differs"]) {
      expect(models, used).toContain(used);
    }
    expect(preflight).toContain("fetch(`${baseUrl.replace(/\\/+$/, \"\")}/models`");
    expect(models).not.toContain('provider !== "openai"');
    const item6 = lineStarting(HOSTING, "6. 本机跑 `node scripts/deploy/prod-db.mjs preflight");
    expect(item6).not.toContain("现在不算数");
    expect(item6).toContain("预检里模型那两行查的是跑预检的这台机器上的配置");
    expect(item6).toContain("`mainProviderKind`、`mainModel`、`checkerConfig` 读出主模型和核对模型");
    expect(item6).toContain("对那一家调一次 `GET /models`");
    expect(item6).toContain("环境里同名变量的值和 `web/.env` 不一样时记 FAIL、不调用");
    const example = read("web/.env.example");
    expect(example).not.toContain("do not check DeepSeek");
    expect(example).toContain("# Preflight's two model lines check the configuration where it runs, read the way the app reads it");
    expect(example).toContain("RIPPLE_DEEPSEEK_API_KEY, else DEEPSEEK_API_KEY; an environment value that differs from this file's is FAIL, not called.");
  });
});

describe.skipIf(!HAVE_DOCS)("ripple-integration.md cites this repo in the form its citation check reads", () => {
  it("only `本仓/<path>:N`, never 「同文件第 N 行」; every cited file and line exists", () => {
    const rel = "docs/plan/ripple-integration.md";
    lines(rel).forEach((l, i) => expect(l, where(rel, i)).not.toMatch(/(同文件|同一文件|同一份文档)第 ?\d+/));
    const cites = [...read(rel).matchAll(/`本仓\/([^`:\s]+?):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)`/g)];
    // 19 since 10-10: the 20 overnight-loop.md cites now quote a sentence instead of a line (the test below)
    expect(cites.length).toBeGreaterThanOrEqual(19);
    for (const [label, file, spec] of cites) {
      const p = path.join(REPO, file);
      expect(existsSync(p), label).toBe(true);
      const text = readFileSync(p, "utf8");
      const n = text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
      for (const part of spec.split(",")) {
        const [a, b = a] = part.split("-").map(Number);
        expect(a >= 1 && b >= a && b <= n, `${label}: ${file} has ${n} lines`).toBe(true);
      }
    }
  });

  it("a 「quote」 cited as `本仓/<path>:N` is on that line (overnight-loop.md moved under it twice on 10-09)", () => {
    const rel = "docs/plan/ripple-integration.md";
    const norm = (s: string) => s.replace(/[\s`*]/g, "");
    let checked = 0;
    lines(rel).forEach((l, i) => {
      for (const m of l.matchAll(/「([^「」]{4,80})」[^「」`]{0,12}`本仓\/([^`:\s]+?):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)`/g)) {
        const [, quote, file, spec] = m;
        const cited = readFileSync(path.join(REPO, file), "utf8").split(/\r?\n/);
        const got = spec.split(",").flatMap((part) => {
          const [a, b = a] = part.split("-").map(Number);
          return cited.slice(a - 1, b);
        });
        expect(norm(got.join("")), `${where(rel, i)}: 「${quote}」 is not on ${file}:${spec}`).toContain(norm(quote));
        checked++;
      }
    });
    // ripple-integration.md 146 (BP only next to R1, M12-watch.md) and the line-cited quotes of other files
    expect(checked).toBeGreaterThanOrEqual(1);
  });

  it("overnight-loop.md (a plan edited every night) is cited by a sentence of it, never by line number, and each sentence is in it once", () => {
    const rel = "docs/plan/ripple-integration.md";
    const OL = "`本仓/docs/plan/overnight-loop.md`";
    const plan = read("docs/plan/overnight-loop.md");
    const norm = (s: string) => s.replace(/[\s`*]/g, "");
    const count = (hay: string, needle: string) => hay.split(needle).length - 1;
    let cites = 0;
    lines(rel).forEach((l, i) => {
      expect(l, `${where(rel, i)}: cite overnight-loop.md by a sentence, not a line number`).not.toMatch(/`本仓\/docs\/plan\/overnight-loop\.md:\d/);
      let from = 0;
      for (let at = l.indexOf(OL, from); at >= 0; at = l.indexOf(OL, from)) {
        from = at + OL.length;
        cites++;
        // the sentence follows the path (「…」 within a few characters, several allowed) or is the quote just before it
        const after = /^[^「」`]{0,12}((?:「[^「」]{4,80}」)+)/.exec(l.slice(from));
        const before = /「([^「」]{4,80})」[^「」`]{0,12}$/.exec(l.slice(0, at));
        const quotes = before ? [before[1]] : after ? [...after[1].matchAll(/「([^「」]+)」/g)].map((m) => m[1]) : [];
        expect(quotes.length, `${where(rel, i)}: an overnight-loop.md cite with no sentence of it`).toBeGreaterThan(0);
        for (const q of quotes) expect(count(norm(plan), norm(q)), `${where(rel, i)}: 「${q}」 should be in overnight-loop.md exactly once`).toBe(1);
      }
    });
    // 21 cites: models, hosting, accounts, data region, push, privacy, Wei Ling's acceptance lines, deletion, retention
    expect(cites).toBeGreaterThanOrEqual(21);
  });
});
