/**
 * The doctor's words never play by themselves (owner 10-15: they are shown as words, and he chooses to play them). From
 * 10-14 to 10-15 the first recorded line of an answer that had just come started by itself (AnswerCard's askedAt ->
 * PlayClip's autoPlaySince). Read from the shipped source: a sound that starts by itself is a useEffect that plays, so
 * the three places that play a doctor's recorded line are held to playing it from his tap only.
 *
 * Still starting by itself, on purpose and not touched here: Wei Ling's recorded reminder at its reminder time
 * (components/daily/elder/HerReminder.tsx on an account; the demo's components/daily/ClipPlay.tsx autoPlayKey), each
 * with its own tap fallback.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(__dirname, "..", "..", "..");
/** A source file without its comments: only what it does is read. */
const code = (file: string) =>
  readFileSync(path.join(WEB, ...file.split("/")), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Each useEffect(...) of a source, as written (balanced parentheses from the call). */
function effects(src: string): string[] {
  const out: string[] = [];
  for (let at = src.indexOf("useEffect("); at >= 0; at = src.indexOf("useEffect(", at + 1)) {
    let depth = 0;
    for (let i = at + "useEffect".length; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) {
        out.push(src.slice(at, i + 1));
        break;
      }
    }
  }
  return out;
}

describe("a doctor's recorded line plays only when he taps it", () => {
  it("PlayClip (the answer's play button): no effect plays, its one play() is in the button's click", () => {
    const src = code("components/chat/PlayClip.tsx");
    expect(src).not.toMatch(/autoPlay/i);
    expect(effects(src).filter((e) => /\.play\(/.test(e))).toEqual([]);
    expect(src.match(/\.play\(/g)).toHaveLength(1);
    const click = src.indexOf("onClick=");
    expect(click).toBeGreaterThan(-1);
    expect(src.indexOf(".play(")).toBeGreaterThan(click);
  });

  it("AnswerCard hands no line a moment to start by itself", () => {
    const src = code("components/daily/AnswerCard.tsx");
    expect(src).not.toMatch(/autoPlay/i);
    // the prop is kept for the callers and read nowhere
    expect(src.match(/\baskedAt\b/g)).toHaveLength(1);
  });

  it("the scan sheet (「拍药盒，看怎么吃」): the doctor's line plays from 「▶ 播放」 only", () => {
    const src = code("components/meds/elder/ScanBox.tsx");
    expect(src).not.toMatch(/autoPlay|autoplay/);
    expect(effects(src).filter((e) => /\.play\(/.test(e))).toEqual([]);
    expect(src.match(/\.play\(/g)).toHaveLength(1);
    const toggle = src.indexOf("function toggle()");
    expect(toggle).toBeGreaterThan(-1);
    expect(src.indexOf(".play(")).toBeGreaterThan(toggle);
    expect(src).toMatch(/onClick=\{toggle\}/);
  });
});
