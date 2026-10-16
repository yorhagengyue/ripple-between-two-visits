// Part 3 · How Ripple works: the technical and safety summary (film 600–TIMES end). A sober, flat 2D section after the
// comic: navy ground, off-white type, one teal accent, amber only for 995. Every shot returns { plain: true, bg } so
// main.js skips the 3D scene and the comic pass; everything is drawn on `ov`.
// Every fact is from D:/ripple-c2/film/research/second-half-facts.md (its 6.10 wording where it exists; nothing from
// its section 6 avoid list) or from the owner's PART3_V7.md. All on-screen words live in COPY; slide times in TIMES.
// v5 (16 Oct, the owner: "figures with short text, not lists"): the title draws Ripple's own logo; the challenge is six
// icon tiles; the two diagrams keep their shape with fewer, larger words and light one part at a time; trade-offs,
// privacy and next are icon figures. Body type is 28 px or more, small lines 22 px or more (1080p).
// v7 (16 Oct, PART3_V7.md): results and limits is out; the web app is called a demo, the product an iOS app; the visit
// steps and the "one more tablet" question play the real app recordings (media/s1-his, s1-her, s4-his, 1:1, in a plain
// phone frame); the emergency lane says what happens at once; next adds the App Store review. Nothing about family
// permissions is shown.
//   title · 01 challenge · 02 architecture · 02 the visit (recordings) · 03 trust boundary · 03 the question
//   (recording) · 04 trade-offs · 05 privacy · 06 how we built it (BUILD, 6.5 s) · 07 next (holds to the end)
// Each slide holds at least 4 s after its last element lands and about 0.35 s per on-screen word.
// Between slides: the old slide fades out over its last 0.3 s, the new one's elements fade and rise in (0.4–0.45 s).
import { shot } from "../timeline.js";
import { image, frame } from "../media.js";
import { seg, ease, easeOut, clamp, TAU } from "../core.js";
import {
  COL, L, R, inK, enter, text, measure, lineCount, box, hrule, arrow, head, progress, icon, caps, badge, chip,
  drawLogo, phoneFrame,
} from "../sets/t_draw.js";

// ================================ BUILD: the owner fills this ================================
// Slide 06 "How we built it" (14 s; see TIMES). Until both lists are filled, the slide shows a plain placeholder
// ("CodeBuddy / WorkBuddy · notes and screenshots to come"), never invented content.
//   lines: two or three short sentences on how CodeBuddy / WorkBuddy were used (about 12–18 words each; they wrap in a
//          700-px column at 30 px).
//   shots: up to three screenshot paths RELATIVE TO THE PROMO FOLDER (D:/ripple-c2/film/promo), for example
//          "assets/build/codebuddy-1.png". The render server serves only files inside that folder. A path that fails to
//          load shows an empty frame marked "screenshot to come".
// v8 (owner 16 Oct): from the CodeBuddy conversation of 9 Oct, 01:21–06:30 (D:/ripple-c2/submission/codebuddy/)
export const BUILD = {
  lines: [
    "We set up CodeBuddy with our rules first: never cross into medical advice, keys only in .env.",
    "In Craft mode it built the first task cards: the app skeleton, the model wiring, the safety layer.",
    "Tip: have it run types, lint, unit tests, the eval and Playwright after each change.",
  ],
  shots: [
    "assets/build/codebuddy-results.png", // M1 done in CodeBuddy: task list 6/6, unit tests 50/50, eval 51/51, e2e 8/8
  ],
};
// ==============================================================================================

// title, 01 challenge, 02 architecture, 02 the visit, 03 trust boundary, 03 the question, 04 trade-offs, 05 privacy,
// 06 build (14 s), 07 next → end
export const TIMES = [600, 607.5, 619, 636.5, 658.5, 690, 707, 724, 735.5, 749.5, 762.5];
const BG = COL.bg;
// the outgoing slide fades over [b - 0.3, b + 0.1]; its last 0.1 s is painted under the next slide's first frames
const OUT_A = 0.3, OUT_B = 0.1;
const outAlpha = (t, b) => 1 - ease(seg(t, b - OUT_A, b + OUT_B));

// ---- every on-screen word ----
export const COPY = {
  title: {
    h1: "How Ripple works",
    h2: "Technical and safety summary",
    line: ["NTU LKCMedicine · Challenge 2 · AI Healthier Every Day", "Team YoRHa2"],
  },
  challenge: {
    label: "01 · THE CHALLENGE", title: "The six “should solve” points",
    // [the handbook's item in two lines, the film moment that showed it (a chip with a play mark), the tile icon]
    tiles: [
      [["Medication", "understanding"], "8:30 AM", "scanbox"],
      [["Medication", "management"], "App tour", "pillcheck"],
      [["Adherence", "support"], "8:05 AM", "ask"],
      [["Health", "tracking"], "8:05 AM", "chart"],
      [["Preventive", "health"], "App tour", "shield"],
      [["Healthcare", "preparation"], "10:30 AM", "clipboard"],
    ],
    source: "Source: challenge handbook, p.33", legend: "where the film showed it",
  },
  arch: {
    label: "02 · ARCHITECTURE", title: "What runs where",
    his: "His phone", her: "Her phone", phones: "Web app / mobile app",
    // the owner (PART3_V7): every mention of the web version says it is a demo; the product ships as an iOS app
    note: "The web app is a demo built for this challenge. The product will ship as an iOS app.",
    edge: ["TENCENT CLOUD", "EdgeOne"],
    lh: ["TENCENT CLOUD", "Lighthouse", "Singapore", "NEXT.JS APP"],
    pills: ["Pages and APIs", "Safety layer", "Live event stream"],
    asr: ["TENCENT CLOUD", "Speech recognition", "Singapore · Mandarin + English"],
    llm: ["TENCENT CLOUD", "Hunyuan", "Reads the risk; a second checks"],
    db: ["SUPABASE", "Database and storage", "Row-level security · private storage"],
  },
  visit: {
    label: "02 · ARCHITECTURE", title: "A visit, step by step",
    his: "HIS PHONE", her: "HER PHONE",
    // [the step, a small line under it]; each lights while its recording window plays
    steps: [
      ["Consent, then he records", "He shows the doctor the line on his screen"],
      ["Each line is recognised", "Tencent speech recognition, about 2–3 s later"],
      ["Live captions on both phones", "Who is speaking is Ripple's guess until he checks"],
      ["He confirms each line", "“Did the doctor say this?”"],
    ],
    small: "Real app recordings · fictional patient, synthetic voices",
  },
  trust: {
    label: "03 · TRUST BOUNDARY", title: "The trust boundary",
    cols: ["HIS OWN SOURCES", "THREE CHECKS", "RESULT"],
    sources: ["Doctor's recorded words", "Confirmed label", "Reviewed leaflet lines", "Fixed templates"],
    checks: [
      ["Rules", "Every number and medicine is in the source"],
      ["Rules", "Instructions only as someone's own words"],
      ["Second model, on reworded lines", "Anything but a clear yes is blocked"],
    ],
    shown: "Shown with who said it, and when",
    blocked: "Blocked: a question on his list",
    emerg: [["995", "HELPLINES"], "Emergency and self-harm signs", "A model reads the talk; code decides"],
    // what happens when Ripple finds a problem (the owner, PART3_V7; the daughter's notification is being built in the
    // app now, so the main session may adjust this line): its own field, two lines
    emergNow: "Fact missing? Ripple asks, with buttons\n995 and helplines first · daughter notified",
    everyday: ["OUTSIDE THE THREE CHECKS", "Everyday questions", "Short general answer, labelled as Ripple's"],
    willNot: "Ripple will not",
    nots: ["Tell him to change a medicine", "Diagnose", "Judge or reassure", "Guess an unknown medicine"],
  },
  ask: {
    label: "03 · TRUST BOUNDARY", title: "“Can I take one more tablet?”",
    lead: "He asks by voice, in Mandarin: 152/96 today",
    // [icon, the result, a small line]; each lights while its recording window plays (facts 2.3, worked example)
    cards: [
      ["check", "Shown with who said it, and when", "Dr Lim's own words, 11 Sep · played only when tapped"],
      ["clipboard", "A referral, and a question on his list", "For his doctor, at the next visit"],
    ],
    small: "Real app recording · fictional patient, synthetic voices",
  },
  trade: {
    label: "04 · DESIGN TRADE-OFFS", title: "Key design trade-offs",
    // [icon, the choice, why, a small scope line or null]
    items: [
      ["server", "Always-on server", "Live streams outlast serverless limits", "Serverless request limits: 30–120 s"],
      ["wave", "Speech engine chosen by test", "Only one passed our English–Mandarin test", "16k_zh_en · one short test, not a benchmark"],
      ["quote", "Quotes before generation", "His own sources come first", null],
      ["samevendor", "Same-vendor checker", "Less independent than a second vendor", null],
      ["bolt", "Model reads, code decides", "Asks before\nit answers", "New wording: 23 of 24 caught"],
    ],
  },
  privacy: {
    label: "05 · PRIVACY AND CONSENT", title: "Privacy and consent",
    // [icon, the phrase, a small line]
    cards: [
      ["consent", "Two separate consents", "AI processing (Tencent Cloud Hunyuan) can be refused"],
      ["clock", "Recordings kept\n90 days", "Unless he keeps them"],
      ["export", "He can export or delete everything", "Account deletion removes data at once"],
    ],
  },
  // (v7: "06 · Results and limits" is out of the film, the owner's call; the build and next slides move up a number)
  build: {
    label: "06 · HOW WE BUILT IT", title: "How we built it",
    ph: ["CodeBuddy / WorkBuddy", "Notes and screenshots to come"], frame: "screenshot to come",
  },
  next: {
    label: "07 · NEXT", title: "Next steps",
    // [icon, the step, a small line or null]
    items: [
      ["phone", "The iOS app is in\nApp Store review", "It may not be on the App Store yet when you watch"],
      ["review", "Pharmacist and clinician review of the lines", null],
      ["wave", "Tencent ASR vs MERaLiON on Singapore-accented Mandarin", null],
      ["people", "A caregiver role", null],
      ["vendors", "A second-vendor checker", null],
    ],
  },
};

// ---- shared bits ----
/** 0 → 1 from a (fade in fi), 1 → 0 from b (fade out fo): a part is lit for this window. */
const win = (lt, a, b, fi = 0.3, fo = 0.45) => Math.min(ease(seg(lt, a, a + fi)), 1 - ease(seg(lt, b, b + fo)));
/** The teal light on a box, at strength k. */
function glow(c, x, y, w, h, k, r = 12, col = COL.teal, fill = COL.tealFill) {
  if (k <= 0.001) return;
  c.save(); c.globalAlpha *= k; box(c, x, y, w, h, { fill, stroke: col, lw: 2.5, r }); c.restore();
}
const card = (c, x, y, w, h, r = 14) => box(c, x, y, w, h, { fill: COL.card, stroke: COL.rule, lw: 1.5, r });
const dot = (c, x, y, r, col) => { c.save(); c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.restore(); };

// ======================================= slides =======================================

// ---- 00 · title: Ripple's logo draws on; the words come in beside it ----
function drawTitle(c, lt) {
  const T = COPY.title, TX = 800;
  drawLogo(c, lt - 0.2, 196, 300, 1.1);
  const k = easeOut(seg(lt, 0.7, 1.6));
  if (k > 0) { c.save(); c.strokeStyle = COL.rule; c.lineWidth = 1.5; c.beginPath(); c.moveTo(700, 532 - 214 * k); c.lineTo(700, 532 + 214 * k); c.stroke(); c.restore(); }
  enter(c, inK(lt, 1.0, 0.5), () => box(c, TX, 396, 64, 5, { fill: COL.teal, r: 2.5 }), 0);
  enter(c, inK(lt, 1.1, 0.5), () => text(c, T.h1, TX - 4, 500, { size: 96, weight: 700 }), 14);
  enter(c, inK(lt, 1.4, 0.5), () => text(c, T.h2, TX, 566, { size: 44, color: COL.sub }), 12);
  enter(c, inK(lt, 1.8, 0.5), () => {
    text(c, T.line[0], TX, 664, { size: 28, weight: 600 });
    text(c, T.line[1], TX, 706, { size: 28, weight: 600, color: COL.teal });
  }, 10);
}

// ---- 01 · the challenge: six icon tiles, each with the film moment that showed it ----
function drawChallenge(c, lt) {
  const S = COPY.challenge, w = 540, h = 300, gx = 30, gy = 28, y0 = 244;
  head(c, S.label, S.title, lt);
  S.tiles.forEach(([name, when, ic], i) => {
    const x = L + (i % 3) * (w + gx), y = y0 + Math.floor(i / 3) * (h + gy), at = 0.8 + i * 0.7;
    enter(c, inK(lt, at), () => {
      card(c, x, y, w, h, 16);
      glow(c, x, y, w, h, win(lt, at, at + 0.7, 0.25, 0.5), 16);
      badge(c, ic, x + 92, y + 96, 54);
      chip(c, when, x + w - 32, y + 40, { align: "right", icon: "play" });
      text(c, name[0], x + 40, y + 212, { size: 40, weight: 600 });
      text(c, name[1], x + 40, y + 262, { size: 40, weight: 600 });
    }, 12);
  });
  enter(c, inK(lt, 5.2), () => {
    const w0 = text(c, S.source, L, 942, { size: 22, color: COL.sub }).w;
    chip(c, S.legend, L + w0 + 28, 914, { icon: "play", size: 22, h: 40, color: COL.sub, stroke: COL.rule });
  }, 6);
}

// ---- 02 · architecture: built along the data path one part at a time; then the demo note (v7: the visit steps moved
// to their own slide with the recordings) ----
const N = {
  his: { x: 120, y: 318, w: 300, h: 112 }, her: { x: 120, y: 522, w: 300, h: 112 },
  edge: { x: 500, y: 318, w: 290, h: 316 }, lh: { x: 870, y: 236, w: 420, h: 480 },
  asr: { x: 1370, y: 236, w: 430, h: 150 }, llm: { x: 1370, y: 401, w: 430, h: 150 }, db: { x: 1370, y: 566, w: 430, h: 150 },
};
const E = {
  hisEdge: [[420, 374], [500, 374]], herEdge: [[420, 578], [500, 578]], edgeLh: [[790, 476], [870, 476]],
  lhAsr: [[1290, 311], [1370, 311]], lhLlm: [[1290, 476], [1370, 476]], lhDb: [[1290, 641], [1370, 641]],
};
// the build: each part comes in along the data path and stays lit until the next one comes (one lit at a time);
// each line draws on just before the part it leads to
const ORDER = [["his", 0.6], ["edge", 1.8], ["lh", 3.0], ["asr", 5.6], ["llm", 6.8], ["db", 8.0], ["her", 9.2]];
const LEADS = { edge: "hisEdge", lh: "edgeLh", asr: "lhAsr", llm: "lhLlm", db: "lhDb", her: "herEdge" };
const PILL_AT = [3.6, 4.1, 4.6];
const NOTE_AT = 10.6; // the demo note, after the last part
const atOf = (id) => ORDER.find((o) => o[0] === id)[1];
const buildHl = (lt, id) => {
  const i = ORDER.findIndex((o) => o[0] === id), a = ORDER[i][1];
  const b = i + 1 < ORDER.length ? ORDER[i + 1][1] - 0.4 : NOTE_AT - 0.2;
  return win(lt, a, b, 0.3, 0.5);
};

function drawArch(c, lt) {
  const S = COPY.arch;
  head(c, S.label, S.title, lt);
  const hl = (id) => buildHl(lt, id);
  const node = (id) => { const n = N[id]; card(c, n.x, n.y, n.w, n.h, 12); glow(c, n.x, n.y, n.w, n.h, hl(id), 12); };
  const line = (id, target) => {
    const a = atOf(target) - 0.4, k = easeOut(seg(lt, a, a + 0.4));
    arrow(c, E[id], k, { color: COL.dim, lw: 2, head: true });
    const h = buildHl(lt, target);
    if (h > 0.001) { c.save(); c.globalAlpha *= h; arrow(c, E[id], k, { color: COL.teal, lw: 2.5, head: true }); c.restore(); }
  };
  for (const [target, id] of Object.entries(LEADS)) line(id, target);
  // phones
  for (const id of ["his", "her"]) enter(c, inK(lt, atOf(id)), () => {
    const n = N[id]; node(id);
    icon(c, "phone", n.x + 50, n.y + n.h / 2, 40, COL.teal);
    text(c, S[id], n.x + 90, n.y + n.h / 2 + 12, { size: 34, weight: 600 });
  });
  enter(c, inK(lt, atOf("her") + 0.4), () => text(c, S.phones, L, 682, { size: 26, color: COL.sub }), 6);
  // the edge
  enter(c, inK(lt, atOf("edge")), () => {
    const n = N.edge; node("edge");
    caps(c, S.edge[0], n.x + 28, n.y + 138);
    text(c, S.edge[1], n.x + 28, n.y + 190, { size: 40, weight: 600 });
  });
  // the server
  enter(c, inK(lt, atOf("lh")), () => {
    const n = N.lh; node("lh");
    caps(c, S.lh[0], n.x + 28, n.y + 46);
    text(c, S.lh[1], n.x + 28, n.y + 96, { size: 40, weight: 600 });
    text(c, S.lh[2], n.x + 28, n.y + 136, { size: 28, weight: 600, color: COL.teal });
    caps(c, S.lh[3], n.x + 28, n.y + 200);
  });
  S.pills.forEach((p, i) => enter(c, inK(lt, PILL_AT[i]), () => {
    const n = N.lh, y = n.y + 222 + i * 78;
    box(c, n.x + 28, y, n.w - 56, 62, { stroke: COL.rule, lw: 1.5, r: 8 });
    text(c, p, n.x + 50, y + 41, { size: 28 });
  }, 6));
  // services
  for (const id of ["asr", "llm", "db"]) enter(c, inK(lt, atOf(id)), () => {
    const n = N[id], [prov, name, note] = S[id]; node(id);
    caps(c, prov, n.x + 28, n.y + 42);
    text(c, name, n.x + 28, n.y + 86, { size: 32, weight: 600 });
    text(c, note, n.x + 28, n.y + 124, { size: 24, color: COL.sub });
  });
  // the note: the web app is a demo; the product ships as an iOS app
  enter(c, inK(lt, NOTE_AT), () => {
    box(c, L, 770, R - L, 96, { fill: COL.card, stroke: COL.rule, lw: 1.5, r: 14 });
    glow(c, L, 770, R - L, 96, win(lt, NOTE_AT, NOTE_AT + 1.6, 0.3, 0.6), 14);
    icon(c, "info", L + 52, 818, 36, COL.teal);
    text(c, S.note, L + 96, 829, { size: 31, weight: 600 });
  }, 10);
}

// ---- 02 · the visit, step by step: the four steps beside his and her phone, the real recordings playing 1:1 ----
// Source windows (seconds in the recording; app-flows-story/1-visit/*-taps.txt; both clips share one clock). A window
// plays 1:1, then holds its last frame until the next step.
const VISIT = {
  lead: 1.0,
  steps: [
    { his: ["s1-his", 17.4, 19.9], hold: 1.4 },                          // the consent card; "The doctor agreed" 19.8
    { his: ["s1-his", 26.5, 30.5], her: ["s1-her", 26.5], hold: 0.4 },   // first captions, 27.5, on both phones
    { his: ["s1-his", 100.5, 106.0], her: ["s1-her", 100.5], hold: 0.4 },// his tai chi question; Dr Lim's answer 104.3
    { his: ["s1-his", 148.6, 151.35], hold: 0 },                          // Ripple's summary; "Did the doctor say this?"
  ],
};
{ let a = VISIT.lead; for (const s of VISIT.steps) { s.at = a; s.dur = s.his[2] - s.his[1]; a += s.dur + s.hold; } }
const vStep = (lt) => { let i = 0; while (i + 1 < VISIT.steps.length && lt >= VISIT.steps[i + 1].at) i++; return i; };
/** the frames the visit slide shows at lt: { his: [clip, sec], her: [clip, sec, dim] } */
function visitMedia(lt) {
  const i = vStep(lt), s = VISIT.steps[i], d = clamp(lt - s.at, 0, s.dur);
  const out = { his: [s.his[0], s.his[1] + d] };
  if (s.her) out.her = [s.her[0], s.her[1] + d, 0];
  else { // hold her last frame, dimmed, once she has joined
    for (let j = i - 1; j >= 0; j--) { const p = VISIT.steps[j]; if (p.her) { out.her = [p.her[0], p.her[1] + p.dur, 0.45]; break; } }
  }
  return out;
}
function drawVisit(c, lt, imgs) {
  const S = COPY.visit, sx = L, sw = 700, sh = 140, gap = 22, y0 = 252, PH = 716, PY = 280, CXH = 1102, CXR = 1530;
  head(c, S.label, S.title, lt);
  const cur = vStep(lt);
  S.steps.forEach(([t1, t2], i) => {
    const st = VISIT.steps[i], y = y0 + i * (sh + gap), next = i + 1 < VISIT.steps.length ? VISIT.steps[i + 1].at : 1e9;
    const on = Math.min(ease(seg(lt, st.at, st.at + 0.35)), 1 - ease(seg(lt, next - 0.1, next + 0.25)));
    enter(c, inK(lt, st.at - 0.2), () => {
      card(c, sx, y, sw, sh, 12); glow(c, sx, y, sw, sh, on, 12);
      dot(c, sx + 50, y + 54, 22, COL.teal);
      text(c, String(i + 1), sx + 50, y + 63, { size: 26, weight: 700, color: COL.bg, align: "center" });
      text(c, t1, sx + 92, y + 64, { size: 32, weight: 600 });
      text(c, t2, sx + 92, y + 106, { size: 24, color: COL.sub });
    }, 10);
  });
  // the phones: his from the start, hers joins when she watches live (step 2)
  const m = visitMedia(lt);
  enter(c, inK(lt, 0.4), () => {
    caps(c, S.his, CXH, PY - 26, COL.teal, { align: "center" });
    phoneFrame(c, imgs.his, CXH, PY, PH, { ring: cur === 3 || cur === 0 ? COL.tealD : COL.rule });
  }, 10);
  enter(c, inK(lt, VISIT.steps[1].at - 0.3), () => {
    caps(c, S.her, CXR, PY - 26, COL.sub, { align: "center" });
    phoneFrame(c, imgs.her, CXR, PY, PH, { dim: m.her ? m.her[2] : 0 });
  }, 10);
  enter(c, inK(lt, 1.6), () => text(c, S.small, L, 942, { size: 22, color: COL.sub }), 6);
}

// ---- 03 · trust boundary: the checks light one at a time; one line passes, one is blocked ----
const TB = { x: 120, y: 232, w: 1680, h: 420 };
const SRC = { x: 150, w: 386, y0: 302, h: 72, gap: 14 };
const CHK = { x: 600, w: 722, y0: 302, h: 102, gap: 13 };
const BUS1 = 568, BUS2 = 1352;
const RES = { x: 1384, w: 388 };
const SHOWN = { y: 302, h: 160 }, BLOCKED = { y: 476, h: 158 };
// timings (seconds into the slide)
const TT = {
  box: 0.4, src: [1.0, 1.45, 1.9, 2.35], bus: 3.0, chk: [3.6, 5.6, 7.6], out: 9.6,
  passAt: 10.7, passStep: 0.6, shown: 12.6, blockAt: 14.3, blocked: 16.2,
  emerg: 17.9, emergNow: 19.3, everyday: 21.4, willNot: 23.6, nots: [24.0, 24.5, 25.0, 25.5],
};
function drawTrust(c, lt) {
  const S = COPY.trust;
  head(c, S.label, S.title, lt);
  const srcY = (i) => SRC.y0 + i * (SRC.h + SRC.gap), chkY = (i) => CHK.y0 + i * (CHK.h + CHK.gap);
  const chkCy = (i) => chkY(i) + CHK.h / 2;
  // the boundary
  enter(c, inK(lt, TT.box, 0.5), () => box(c, TB.x, TB.y, TB.w, TB.h, { fill: COL.tealFaint, stroke: COL.teal, lw: 2, r: 16 }), 0);
  enter(c, inK(lt, TT.box + 0.3), () => caps(c, S.cols[0], SRC.x, 284, COL.teal), 6);
  enter(c, inK(lt, TT.bus + 0.1), () => caps(c, S.cols[1], CHK.x, 284), 6);
  enter(c, inK(lt, TT.out), () => caps(c, S.cols[2], RES.x, 284), 6);
  // the two runs: a line that passes (source 1, checks 1-2-3, shown) and one the second model blocks
  const passK = (j) => win(lt, TT.passAt + j * TT.passStep, TT.passAt + (j + 1) * TT.passStep, 0.2, 0.3);
  const blockK = (j) => win(lt, TT.blockAt + j * TT.passStep, TT.blockAt + (j + 1) * TT.passStep, 0.2, 0.3);
  // sources
  S.sources.forEach((s, i) => enter(c, inK(lt, TT.src[i]), () => {
    const y = srcY(i);
    card(c, SRC.x, y, SRC.w, SRC.h, 10);
    glow(c, SRC.x, y, SRC.w, SRC.h, Math.max(win(lt, TT.src[i], TT.src[i] + 0.45, 0.2, 0.35), i === 0 ? passK(-1) : 0), 10);
    text(c, s, SRC.x + 24, y + 46, { size: 28, weight: 600 });
  }, 8));
  // the bus from the sources into the checks
  const busK = easeOut(seg(lt, TT.bus, TT.bus + 0.5));
  if (busK > 0) {
    const cy = (i) => srcY(i) + SRC.h / 2;
    c.save(); c.globalAlpha *= busK; c.strokeStyle = COL.teal; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i < 4; i++) { c.moveTo(SRC.x + SRC.w, cy(i)); c.lineTo(BUS1, cy(i)); }
    c.moveTo(BUS1, cy(0)); c.lineTo(BUS1, cy(3)); c.stroke(); c.restore();
    arrow(c, [[BUS1, chkCy(0)], [CHK.x, chkCy(0)]], easeOut(seg(lt, TT.bus + 0.3, TT.bus + 0.6)), { color: COL.teal, lw: 2, head: true });
  }
  // the stepper line through the checks' numbers
  for (let i = 0; i < 2; i++) {
    const k = easeOut(seg(lt, TT.chk[i + 1] - 0.4, TT.chk[i + 1]));
    if (k > 0) { c.save(); c.strokeStyle = COL.tealD; c.lineWidth = 2; c.beginPath(); c.moveTo(CHK.x + 46, chkCy(i) + 22); c.lineTo(CHK.x + 46, chkCy(i) + 22 + (chkCy(i + 1) - chkCy(i) - 44) * k); c.stroke(); c.restore(); }
  }
  // the three checks: each lit as it comes in, then again as each run passes through
  S.checks.forEach(([name, rule], i) => enter(c, inK(lt, TT.chk[i]), () => {
    const y = chkY(i), cy = chkCy(i), next = i < 2 ? TT.chk[i + 1] : TT.out;
    card(c, CHK.x, y, CHK.w, CHK.h, 10);
    glow(c, CHK.x, y, CHK.w, CHK.h, Math.max(win(lt, TT.chk[i], next - 0.2, 0.3, 0.4), passK(i), blockK(i)), 10);
    dot(c, CHK.x + 46, cy, 22, COL.teal);
    text(c, String(i + 1), CHK.x + 46, cy + 9, { size: 26, weight: 700, color: COL.bg, align: "center" });
    text(c, name, CHK.x + 88, y + 44, { size: 30, weight: 600 });
    text(c, rule, CHK.x + 88, y + 82, { size: 26, color: COL.sub });
    // the marks a run leaves: a tick where it passed, a cross where the second model blocked it
    const tickA = inK(lt, TT.passAt + i * TT.passStep + 0.1, 0.25) * (1 - inK(lt, TT.shown + 1.4, 0.4));
    const markB = inK(lt, TT.blockAt + i * TT.passStep + 0.1, 0.25) * (1 - inK(lt, TT.blocked + 1.4, 0.4));
    const mx = CHK.x + CHK.w - 44;
    enter(c, tickA, () => icon(c, "check", mx, cy, 30, COL.teal), 0);
    enter(c, markB, () => (i < 2 ? icon(c, "check", mx, cy, 30, COL.teal) : icon(c, "cross", mx, cy, 24, COL.text)), 0);
  }, 8));
  // results: the checks' outcome bus forks to "shown" (teal) and "blocked" (grey)
  const fk = easeOut(seg(lt, TT.out, TT.out + 0.4));
  if (fk > 0) {
    c.save(); c.globalAlpha *= fk; c.strokeStyle = COL.dim; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i < 3; i++) { c.moveTo(CHK.x + CHK.w, chkCy(i)); c.lineTo(BUS2, chkCy(i)); }
    c.moveTo(BUS2, chkCy(0)); c.lineTo(BUS2, chkCy(2)); c.stroke(); c.restore();
  }
  const sCy = SHOWN.y + SHOWN.h / 2, bCy = BLOCKED.y + BLOCKED.h / 2;
  arrow(c, [[BUS2, sCy], [RES.x, sCy]], easeOut(seg(lt, TT.shown - 0.2, TT.shown + 0.1)), { color: COL.teal, lw: 2.5, head: true, hs: 10 });
  arrow(c, [[BUS2, bCy], [RES.x, bCy]], easeOut(seg(lt, TT.blocked - 0.2, TT.blocked + 0.1)), { color: COL.sub, lw: 2.5, head: true, hs: 10 });
  const result = (y, h, ic, s, at, teal) => enter(c, inK(lt, at), () => {
    box(c, RES.x, y, RES.w, h, teal ? { fill: COL.tealFill, stroke: COL.teal, lw: 2, r: 10 } : { fill: COL.card, stroke: COL.rule, lw: 1.5, r: 10 });
    glow(c, RES.x, y, RES.w, h, win(lt, at, at + 1.4, 0.2, 0.5), 10, teal ? COL.teal : COL.sub, "rgba(159,176,198,0.08)");
    const r = lineCount(c, s, 28, 600, RES.w - 92, 1.25);
    icon(c, ic, RES.x + 40, y + h / 2 - r.h / 2, teal ? 28 : 22, teal ? COL.teal : COL.sub);
    text(c, s, RES.x + 70, y + h / 2 - r.h / 2 + 10, { size: 28, weight: 600, maxW: RES.w - 92, lh: 1.25 });
  }, 8);
  result(SHOWN.y, SHOWN.h, "check", S.shown, TT.shown, true);
  result(BLOCKED.y, BLOCKED.h, "cross", S.blocked, TT.blocked, false);
  // the two lanes under the boundary: emergencies by rules (amber), everyday answers outside the checks (dashed)
  const LY = 674, LH = 182, LW = 822;
  enter(c, inK(lt, TT.emerg), () => {
    const x = L, [tag, title, line] = S.emerg;
    box(c, x, LY, LW, LH, { fill: COL.amberFill, stroke: "rgba(242,184,75,0.85)", lw: 1.5, r: 12 });
    glow(c, x, LY, LW, LH, win(lt, TT.emerg, TT.everyday - 0.2, 0.3, 0.5), 12, COL.amber, "rgba(242,184,75,0.06)");
    // the badge says both routes: 995, and the helplines (self-harm words get the helplines)
    box(c, x + 28, LY + 22, 172, 92, { stroke: COL.amber, lw: 2, r: 10 });
    text(c, tag[0], x + 114, LY + 68, { size: 40, weight: 700, color: COL.amber, align: "center" });
    caps(c, tag[1], x + 115, LY + 98, COL.amber, { align: "center" });
    text(c, title, x + 228, LY + 50, { size: 30, weight: 600 });
    text(c, line, x + 228, LY + 86, { size: 26, color: COL.sub });
  }, 8);
  // what happens at once (its own COPY field): 995 and the helplines; his daughter's phone is notified
  enter(c, inK(lt, TT.emergNow), () => {
    const x = L + 228;
    icon(c, "bell", x + 14, LY + 121, 26, COL.amber);
    text(c, S.emergNow, x + 44, LY + 131, { size: 28, weight: 600, lh: 1.2 });
  }, 6);
  enter(c, inK(lt, TT.everyday), () => {
    const x = R - LW, [tag, title, line] = S.everyday;
    box(c, x, LY, LW, LH, { stroke: COL.sub, lw: 1.5, r: 12, dash: [8, 7] });
    glow(c, x, LY, LW, LH, win(lt, TT.everyday, TT.willNot - 0.2, 0.3, 0.5), 12, COL.sub, "rgba(159,176,198,0.06)");
    badge(c, "chat", x + 86, LY + LH / 2, 40, COL.sub, { fill: "rgba(159,176,198,0.08)", ring: COL.rule });
    const tagW = measure(c, tag, 22, 700, 2.5);
    box(c, x + 22, LY - 14, tagW + 22, 28, { fill: COL.bg, r: 4 });
    caps(c, tag, x + 33, LY + 8);
    text(c, title, x + 156, LY + LH / 2 - 8, { size: 30, weight: 600 });
    text(c, line, x + 156, LY + LH / 2 + 32, { size: 26, color: COL.sub });
  }, 8);
  // Ripple will not: four chips
  const WY = LY + LH + 54;
  enter(c, inK(lt, TT.willNot), () => text(c, S.willNot, L, WY, { size: 30, weight: 700 }), 6);
  let x = L;
  S.nots.forEach((s, i) => {
    const w = 16 + 26 + 12 + measure(c, s, 28, 600) + 18;
    const x0 = x; x += w + 16;
    enter(c, inK(lt, TT.nots[i]), () => {
      box(c, x0, WY + 18, w, 56, { stroke: COL.rule, lw: 1.5, r: 28 });
      icon(c, "cross", x0 + 16 + 13, WY + 46, 18, COL.sub);
      text(c, s, x0 + 16 + 26 + 12, WY + 56, { size: 28, weight: 600 });
    }, 6);
  });
}

// ---- 03 · the question, in the app: "can I take one more tablet?" (s4-his, 1:1), each result lit while it shows ----
// Source windows (app-flows-1015/4-extra-tablet/scene4-his-phone-taps.txt): the answer with Dr Lim's own words (14.5;
// Play 17.7, his recording plays about 2.4 s); then the swipe to Ripple's line, "Asked on 2 Oct · on your list", and
// his question list (in these frames from about 25.3 s).
const ASK = { lead: 0.9, gap: 0.3, segs: [["s4-his", 14.2, 20.4], ["s4-his", 21.6, 27.4]] };
{ let a = ASK.lead; for (const g of ASK.segs) { g.at = a; g.dur = g[2] - g[1]; a += g.dur + ASK.gap; } }
const aSeg = (lt) => (lt >= ASK.segs[1].at ? 1 : 0);
function askMedia(lt) {
  const g = ASK.segs[aSeg(lt)];
  return { his: [g[0], g[1] + clamp(lt - g.at, 0, g.dur)] };
}
function drawAsk(c, lt, imgs) {
  const S = COPY.ask, PH = 716, PY = 262, CX = 470, X = 790, W = R - X;
  head(c, S.label, S.title, lt);
  enter(c, inK(lt, 0.3), () => phoneFrame(c, imgs.his, CX, PY, PH), 10);
  enter(c, inK(lt, 0.5), () => text(c, S.lead, X, 330, { size: 30, color: COL.sub }), 8);
  S.cards.forEach(([ic, t1, t2], i) => {
    const g = ASK.segs[i], y = 384 + i * 232, h = 196, next = i ? 1e9 : ASK.segs[1].at;
    const on = Math.min(ease(seg(lt, g.at + 0.2, g.at + 0.55)), 1 - ease(seg(lt, next - 0.1, next + 0.25)));
    enter(c, inK(lt, g.at + 0.1), () => {
      card(c, X, y, W, h, 14); glow(c, X, y, W, h, on, 14);
      badge(c, ic, X + 78, y + h / 2, 44);
      text(c, t1, X + 150, y + 86, { size: 36, weight: 600 });
      text(c, t2, X + 150, y + 132, { size: 26, color: COL.sub });
    }, 10);
  });
  enter(c, inK(lt, 1.4), () => text(c, S.small, X, 942, { size: 22, color: COL.sub }), 6);
}

// ---- 04 · design trade-offs: five choices, each an icon, the choice, an arrow and the reason ----
function drawTrade(c, lt) {
  const S = COPY.trade, n = S.items.length, gap = 24, w = (R - L - gap * (n - 1)) / n, y = 244, h = 610;
  head(c, S.label, S.title, lt);
  S.items.forEach(([ic, choice, why, scope], i) => {
    const x = L + i * (w + gap), cx = x + w / 2, at = 0.7 + i * 1.4, tw = w - 40;
    enter(c, inK(lt, at), () => {
      card(c, x, y, w, h, 16);
      glow(c, x, y, w, h, win(lt, at, at + 1.4, 0.25, 0.5), 16);
      badge(c, ic, cx, y + 100, 56);
      text(c, choice, cx, y + 222, { size: 32, weight: 600, align: "center", maxW: tw, lh: 1.22 });
    }, 12);
    arrow(c, [[cx, y + 296], [cx, y + 352]], easeOut(seg(lt, at + 0.45, at + 0.8)), { color: COL.teal, lw: 2.5, head: true, hs: 11 });
    enter(c, inK(lt, at + 0.7), () => {
      const r = text(c, why, cx, y + 404, { size: 29, align: "center", maxW: tw, lh: 1.25 });
      if (scope) { const q = lineCount(c, scope, 22, 400, tw, 1.3); text(c, scope, cx, y + h - 44 - q.h, { size: 22, color: COL.sub, align: "center", maxW: tw, lh: 1.3 }); }
    }, 8);
  });
}

// ---- 05 · privacy and consent: three icon cards, one phrase each (v6, the owner 16 Oct: the family-sharing card is
// out of the film for now) ----
function drawPrivacy(c, lt) {
  const S = COPY.privacy, n = S.cards.length, gap = 28, w = (R - L - gap * (n - 1)) / n, y = 266, h = 560;
  head(c, S.label, S.title, lt);
  S.cards.forEach(([ic, phrase, small], i) => {
    const x = L + i * (w + gap), cx = x + w / 2, at = 0.7 + i * 0.75;
    enter(c, inK(lt, at), () => {
      card(c, x, y, w, h, 16);
      glow(c, x, y, w, h, win(lt, at, at + 0.75, 0.25, 0.5), 16);
      badge(c, ic, cx, y + 150, 82, COL.teal, { k: 1.0 });
      const r = text(c, phrase, cx, y + 318, { size: 38, weight: 600, align: "center", maxW: w - 56, lh: 1.22 });
      text(c, small, cx, y + 318 + r.h + 72, { size: 24, color: COL.sub, align: "center", maxW: w - 64, lh: 1.32 });
    }, 12);
  });
}

// ---- 06 · how we built it (the owner's BUILD block, or a plain placeholder) ----
function drawBuild(c, lt, imgs) {
  const S = COPY.build;
  head(c, S.label, S.title, lt);
  const lines = BUILD.lines.filter(Boolean);
  if (lines.length) {
    let y = 300;
    lines.slice(0, 3).forEach((s, i) => {
      const yy = y; y += lineCount(c, s, 30, 400, 690, 1.32).h + 70; // positions come from the text, never from the fade
      enter(c, inK(lt, 0.7 + i * 0.6), () => {
        box(c, L, yy - 22, 4, 28, { fill: COL.teal, r: 2 });
        text(c, s, L + 26, yy, { size: 30, maxW: 690, lh: 1.32 });
      }, 8);
    });
  } else {
    enter(c, inK(lt, 0.7), () => {
      text(c, S.ph[0], L, 330, { size: 38, weight: 600 });
      text(c, S.ph[1], L, 384, { size: 30, color: COL.sub });
    }, 10);
  }
  // up to three screenshots on the right (x 900–1800, y 252–940): one large on top, two below; the placeholder
  // shows the three-frame layout
  const n = Math.max(1, Math.min(3, BUILD.shots.length || 3));
  const cells = n === 1 ? [[900, 252, 900, 688]] : n === 2 ? [[900, 252, 900, 332], [900, 608, 900, 332]]
    : [[900, 252, 900, 400], [900, 676, 438, 264], [1362, 676, 438, 264]];
  cells.forEach(([x, y, fw, fh], i) => {
    const img = imgs[i];
    enter(c, inK(lt, 1.0 + i * 0.4), () => {
      if (img) {
        const s = Math.min(fw / img.width, fh / img.height), w = img.width * s, h = img.height * s;
        c.drawImage(img, x + (fw - w) / 2, y + (fh - h) / 2, w, h);
        box(c, x + (fw - w) / 2, y + (fh - h) / 2, w, h, { stroke: COL.rule, lw: 1.5, r: 2 });
      } else {
        box(c, x, y, fw, fh, { stroke: COL.dim, lw: 1.5, r: 12, dash: [10, 8] });
        text(c, S.frame, x + fw / 2, y + fh / 2 + 8, { size: 22, color: COL.dim, align: "center" });
      }
    }, 10);
  });
}

// ---- 07 · next: a roadmap of five steps (holds to the end) ----
function drawNext(c, lt) {
  const S = COPY.next, x0 = 250, x1 = 1670, ly = 500, n = S.items.length, dx = (x1 - x0) / (n - 1), t0 = 0.5, per = 0.8;
  head(c, S.label, S.title, lt);
  // the road draws on from the first step to the last; each step comes in as the road reaches it
  const k = easeOut(seg(lt, t0, t0 + per * (n - 1)));
  hrule(c, x0, x1, ly, 1, COL.rule, 3);
  hrule(c, x0, x1, ly, k, COL.tealD, 3);
  S.items.forEach(([ic, s, small], i) => {
    const x = x0 + i * dx, at = t0 + i * per;
    enter(c, inK(lt, at), () => {
      caps(c, String(i + 1).padStart(2, "0"), x, ly - 92, COL.teal, { align: "center" });
      c.save(); c.fillStyle = COL.bg; c.beginPath(); c.arc(x, ly, 60, 0, TAU); c.fill(); c.restore();
      badge(c, ic, x, ly, 60, COL.teal, { fill: COL.card, ring: COL.teal, k: 1.18 });
      const r = text(c, s, x, ly + 122, { size: 30, align: "center", maxW: 320, lh: 1.25 });
      if (small) text(c, small, x, ly + 122 + r.h + 46, { size: 23, color: COL.sub, align: "center", maxW: 320, lh: 1.3 });
    }, 10);
  });
}

// ======================================= shots =======================================
const DRAW = [drawTitle, drawChallenge, drawArch, drawVisit, drawTrust, drawAsk, drawTrade, drawPrivacy, drawBuild, drawNext];
const NAMES = ["title", "challenge", "architecture", "the visit", "trust boundary", "the question", "trade-offs", "privacy", "build", "next"];
const BUILD_SLIDE = 8;
// the slides that play app recordings: their frames at local time lt, as { key: [clip, sec, ...] }
const MEDIA = { 3: visitMedia, 5: askMedia };

const buildImgs = (wait) => {
  const imgs = [];
  BUILD.shots.slice(0, 3).forEach((p, j) => wait(image(p).then((im) => (imgs[j] = im))));
  return imgs;
};
/** the images slide i needs at its local time lt (build screenshots, or recording frames), loaded through wait() */
function loadImgs(i, lt, wait) {
  if (i === BUILD_SLIDE) return buildImgs(wait);
  if (!MEDIA[i]) return [];
  const imgs = {};
  for (const [key, [clip, sec]] of Object.entries(MEDIA[i](lt))) wait(frame(clip, sec).then((im) => (imgs[key] = im)));
  return imgs;
}
DRAW.forEach((draw, i) => {
  const a = TIMES[i], b = TIMES[i + 1], last = i === DRAW.length - 1;
  shot(`t ${NAMES[i]}`, a, b, ({ t, wait, ov }) => {
    const imgs = loadImgs(i, Math.min(t, b) - a, wait);
    const tail = i > 0 && t - a < OUT_B, prevImgs = tail ? loadImgs(i - 1, a - TIMES[i - 1], wait) : [];
    const lt = Math.min(t, b) - a;
    ov.push((c) => {
      if (tail) { c.save(); c.globalAlpha = outAlpha(t, a); DRAW[i - 1](c, a - TIMES[i - 1], prevImgs); c.restore(); }
      c.save(); c.globalAlpha = last ? 1 : outAlpha(t, b); draw(c, lt, imgs); c.restore();
      // the bar fills with time; on the last slide it completes within 4 s, so the closing hold is still
      progress(c, last ? a + (b - a) * seg(t, a, a + 4) : Math.min(t, b), TIMES);
    });
    return { plain: true, bg: BG };
  });
});
