/**
 * The check drill on the demo (C2 follow-up, track E; real-app 12 「『某一句被第几道检查拦下』从没出现过 … 加一条能稳定触发单句
 * 被拦的演示问题和 e2e，确认后台那一行真的显示」).
 *
 * A model that only picks among its sources almost never writes a sentence the checks have to stop, so the backstage row
 * "Stopped at layer N: …" never showed in a demo. The drill makes it show on purpose, honestly:
 *
 *   - only in a demo scope (a judge's sandbox, the crew's filming session), and only for an ask sent with the drill flag
 *     (POST /api/ask?drill=1: the judges' page button "Watch the checks stop a sentence"); never on an account;
 *   - the question is answered as it always is; then ONE fixed sentence that no source says (DRILL_SENTENCE) is added to
 *     the answer, citing one of the answer's real sources, as a careless model might;
 *   - the three checks run as on every answer. Layer 1 is deterministic (the words are not in the cited source), so the
 *     sentence is stopped there every time: the backstage shows the stop, its layer and its reason, and the phone shows
 *     the referral line instead;
 *   - the backstage row that shows the stop says that the sentence was planted (components/backstage/sentences.ts
 *     recognises its words), so nobody takes it for the model's.
 *
 * Who adds the sentence (fix round of 10-11, track S). It used to be added to the model's compose reply, through a wrapper
 * around the model client. That worked with the offline model only: on the real stack the compose call of the drill's
 * ask ended at the answer's deadline, there was no reply to add anything to, nothing was stopped and the judges' page
 * said the drill did not run. The sentence is now added by the pipeline itself (lib/safety/pipeline.ts AskDeps.plant),
 * after the answer is composed and before the checks, whoever composed it: the real model, the offline composer, or the
 * rules when the model was late. No model is asked for it, and no model can keep it out.
 *
 * The planted sentence never reaches a screen of his: the checks stop it, and the route checks the finished answer once
 * more and refuses to send it if those words were anywhere in it (drillLeaked: a bug then, logged, the phone gets an
 * error and nothing else). Server-only apart from the constants and the pure helpers.
 */
import { DRILL_PARAM, DRILL_SENTENCE } from "./drill-words";

export { DRILL_PARAM, DRILL_QUESTION, DRILL_SENTENCE } from "./drill-words";

/** Was the drill asked for? (the route also requires a demo scope) */
export function drillAsked(params: URLSearchParams): boolean {
  return params.get(DRILL_PARAM) === "1";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Are the planted words anywhere in an answer that is about to be shown? (never, unless a check has a bug) */
export function drillLeaked(shown: readonly { en?: string | null; zh?: string | null; span?: string | null }[]): boolean {
  const needle = norm(DRILL_SENTENCE);
  return shown.some((s) => [s.en, s.zh, s.span].some((t) => typeof t === "string" && norm(t).includes(needle)));
}
