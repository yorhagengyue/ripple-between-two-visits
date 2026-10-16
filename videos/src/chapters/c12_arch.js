// Chapter 12 · Architecture (film 370–400 s). The trio stand around a lab table; Wei Ling presses the button and an
// "infographic sandbox" pops up out of the board: his phone, the EdgeOne gate, the Lighthouse server (a little
// lighthouse on its roof, Next.js on its front), and behind it the speech tower, the DeepSeek tower and the Supabase
// tower. The camera dives in: mini Mr Tan rides the first packet from his phone through the gate to the server, then
// each tower lights up as its label pops in. Then three trade-off cards, each staged on the board, and a pull-out.
// Facts: D:/ripple-c2/film/research/second-half-facts.md sections 1.1 to 1.3 and 6.10. No database region anywhere.
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, pop, ease, easeOut, easeIn, clamp, lerp, backOut, hash, boil, twos } from "../core.js";
import { sfx, banner, flashHit } from "../overlay.js";
import { caption } from "../overlay2.js";
import { frame } from "../media.js";
import { buildArchRoom, buildDiorama, BOARD, W } from "../sets/c12_diorama.js";
import { toScreen, pin } from "../sets/c12_pins.js";
import { makeTanBot, makeWeiBot, makeLimBot } from "../bots.js";

// clip windows: the two phone screens on the board play the visit recording 1:1 from these points (film 370 = in)
const WIN = {
  his: { clip: "old-s1-his", in: 42.0 }, // recording, live summary, the last two lines
  her: { clip: "old-s1-her", in: 42.0 }, // her phone following live: Dad's visit, live captions
};
const T0 = 370;
// the on-screen words, in one place (wording from facts 1.1 and STORYBOARD-2 c12; no region for the database)
const TXT = {
  banner: "ARCHITECTURE",
  his: { title: "His phone" },
  her: { title: "Her phone" },
  edge: { title: "Tencent Cloud EdgeOne" },
  server: { title: "Tencent Cloud Lighthouse · Singapore", chip: "Next.js" },
  speech: { title: "Tencent Cloud speech recognition · Singapore", chip: "16k_zh_en" },
  deepseek: { title: "DeepSeek", sub: "answer model + a second model that checks" },
  supabase: { title: "Supabase", sub: "database, storage, live sync" },
  card1: "Always-on server: the live visit stream needs it.",
  card2: "Sources first: his doctor's words, the label, reviewed leaflet lines.",
  card3: "If the checker can't say yes, the sentence is blocked.",
};
// when each label pops in (film seconds); they stay until the trade-off cards start
const PIN_AT = { his: 372.75, edge: 374.55, server: 376.0, speech: 379.0, deepseek: 381.8, supabase: 384.85 };
const PIN_OFF = 387.4;

const room = STAGE.set("c12.room", buildArchRoom());
const board = STAGE.set("c12.board", buildDiorama());
board.position.set(BOARD.x, BOARD.y, BOARD.z); board.scale.setScalar(BOARD.s);
const D = board.userData.D, A = board.userData.A;
STAGE.need("tan", makeTanBot); STAGE.need("wei", makeWeiBot); STAGE.need("lim", makeLimBot);

// where on the "his" pipe the gate sits (u), found once
const GATE_U = (() => { let best = 0, bd = 1e9; for (let i = 0; i <= 200; i++) { const p = D.at("his", i / 200); const d = Math.abs(p.x + 1.7); if (d < bd) { bd = d; best = i / 200; } } return best; })();

// where the barrier arm crosses the "out" pipe (u), found once
const BAR_U = (() => { let best = 0, bd = 1e9; for (let i = 0; i <= 200; i++) { const p = D.at("out", i / 200); const d = Math.hypot(p.x - 1.97, p.z + 1.17); if (d < bd) { bd = d; best = i / 200; } } return best; })();

// the speech tower's worker stands at the tower's left side, where the high camera of shot D sees him
const WS = [-2.75, -1.35];
// Wei Ling's spot at the table once the sandbox is up (left of the speech tower as the table camera sees it)
const WEI_X = -1.28;
// the checker stands on the DeepSeek tower's roof (top of the CHECK floor), where the close shots of the check see him
const CK = [1.12, 1.7, -1.55]; // at the roof's right edge, next to where each sentence waits to be checked

// ---- helpers ----
/** camera in board units: position and target on the board, fov */
const camL = (pos, tgt, fov = 34, roll = 0) => STAGE.cam(W(pos), W(tgt), fov, roll);
/** a point orbiting tgt: azimuth (0 = from the front, + = from the right), elevation, distance (board units) */
const orb = (tgt, az, el, dist) => [tgt[0] + dist * Math.sin(az) * Math.cos(el), tgt[1] + dist * Math.sin(el), tgt[2] + dist * Math.cos(az) * Math.cos(el)];
const scr = (p) => toScreen(W(p));
function screens(t, wait) {
  wait(frame(WIN.his.clip, WIN.his.in + (t - T0)).then((i) => D.hisScreen(i)));
  wait(frame(WIN.her.clip, WIN.her.in + (t - T0)).then((i) => D.herScreen(i)));
}
function stage(t) {
  STAGE.show("c12.room", "c12.board");
  STAGE.lights("lab", { keyPos: [3.5, 6.5, 4.5], keyTarget: [0, 0.6, 0], key: "#ffe2c0", keyI: 2.2, hemi: 1.05, bg: "#2a1a66" });
  D.reset(); D.idle(t);
  room.userData.button.position.y = 0.65; // the console button at rest (shot A presses it)
}
const mini = (b, p) => { b.g.visible = true; b.pose(p); return b; };
/** the three tower workers at their posts. Each one stays posed in every shot after the shot that introduces him
 *  (speech worker from D, checker from E, database worker from F), so nobody pops in or out between shots; before
 *  that he is simply not on the board (in B and C he would only peek in at the frame's edge). A shot that gives one
 *  of them acting poses him again after this call. */
const DB0 = [3.75, -0.1], DB1 = [3.4, -0.55];
function workers(lt, who, o = {}) {
  if (who.includes("speech")) mini(D.wSpeech, { x: WS[0], z: WS[1], rotY: 0.55, face: "code", tilt: wob(lt, 0.5, 1) * 0.08, ...(o.speech || {}) });
  if (who.includes("check")) mini(D.wCheck, { x: CK[0], z: CK[2], dy: CK[1], rotY: 0.35, armR: 1.2, armOutR: 0.2, headPitch: 0.3, face: "code", tilt: wob(lt, 0.45, 2) * 0.08, ...(o.check || {}) });
  if (who.includes("db")) mini(D.wDb, { x: DB1[0], z: DB1[1], rotY: -2.4, armL: 1.2, armR: 1.2, face: "code", ...(o.db || {}) });
}
const ALL = ["speech", "check", "db"];
/** the trio around the table, watching; `react` adds per-shot acting */
function trio(t, o = {}) {
  const b = (t * 1.3) % 1;
  STAGE.pose("wei", { x: -1.0, z: -1.35, rotY: 0.3, headPitch: 0.35, tilt: wob(t, 0.4) * 0.06, face: o.wei ?? "code", squash: wob(t, 0.7) * 0.03, ...(o.weiP || {}) });
  STAGE.pose("tan", { x: -0.38, z: -1.45, rotY: 0.05, headPitch: 0.38, tilt: wob(t, 0.33, 1) * 0.05, face: o.tan ?? "code", squash: wob(t, 0.6, 2) * 0.03, ...(o.tanP || {}) });
  STAGE.pose("lim", { x: 1.2, z: -1.3, rotY: -0.4, headPitch: 0.32, tilt: wob(t, 0.37, 2) * 0.05, face: o.lim ?? "code", squash: wob(t, 0.65, 4) * 0.03, ...(o.limP || {}) });
}
/** label pins for the components that have popped in by film time t (fading out at PIN_OFF). The pin a shot
 *  introduces is drawn big (place[key].big): title 42 px, sub 36 px at 1080p, so 28 and 24 px at 720p; a pin carried
 *  over from the previous shot is drawn at 32 px. place[key] may also move the box (dx, dy, maxW) or give the pin
 *  its own entrance time (at). */
const PIN_BIG = 42, PIN_SMALL = 32;
function pins(t, c, show = Object.keys(PIN_AT), place = {}) {
  const fade = 1 - seg(t, PIN_OFF, PIN_OFF + 0.3);
  if (fade <= 0) return;
  const anchors = { his: A.his, edge: A.gate, server: A.lighthouse, speech: A.speech, deepseek: A.deepseek, supabase: A.supabase };
  const defaults = { his: { dx: -70, dy: -110 }, edge: { dx: -60, dy: -140 }, server: { dx: 70, dy: -150 }, speech: { dx: -60, dy: -130 }, deepseek: { dx: 60, dy: -150 }, supabase: { dx: 60, dy: -120 } };
  for (const key of show) {
    const P = place[key] || {}, at = P.at ?? PIN_AT[key];
    const k = seg(t, at, at + 0.45);
    if (k <= 0) continue;
    const a = scr(P.pt ?? anchors[key]);
    if (!a.ok || a.x < 10 || a.x > 1910 || a.y < 10 || a.y > 1070) continue;
    const L = TXT[key], big = !!P.big, size = P.size ?? (big ? PIN_BIG : PIN_SMALL);
    pin(c, a, L.title, k, { sub: L.sub, chip: L.chip, alpha: fade, size, maxW: Math.round((key === "server" || key === "speech" ? 640 : 520) * size / 36), ...defaults[key], ...P });
  }
}

// ---- A · the table: Wei Ling presses the button, the sandbox pops up out of the board (370–372.5) ----
shot("c12 open", T0, T0 + 2.5, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw); // poses, props and words on twos; the camera on plain time
  stage(t); screens(t, wait);
  const press = 0.35, up = 0.55;
  D.rise(lt - up);
  room.userData.button.position.y = 0.65 - (lt > press && lt < press + 0.2 ? 0.02 : 0);
  const reach = kf(lt, [[0.05, 0], [0.3, 1], [0.55, 1], [0.85, 0.2]]);
  trio(t, {
    wei: lt < 0.55 ? "code" : lt < 0.63 ? "blink" : "happy",
    tan: lt < 0.9 ? "code" : lt < 0.98 ? "blink" : "wow",
    lim: lt < 1.2 ? "think" : lt < 1.28 ? "blink" : "happy",
    // after the press she hops back half a step as the blocks pop up, so the speech tower does not hide her visor
    weiP: { x: lerp(-1.0, WEI_X, easeOut(seg(lt, 0.7, 1.0))), dy: Math.sin(seg(lt, 0.7, 1.0) * Math.PI) * 0.07, armL: reach * 1.1, lean: reach * 0.25, headPitch: lerp(0.45, 0.32, seg(lt, 0.7, 1.0)), squash: lt > 1.0 && lt < 1.12 ? 0.2 : 0 },
    // in this wider, lower opening he stands a little right of his I2 spot, so Wei Ling's head does not cover his visor
    tanP: { x: -0.2, squash: lt > 0.9 && lt < 1.1 ? -0.3 : 0, ear: seg(lt, 0.9, 1.1), headPitch: 0.3 },
    limP: { armR: kf(lt, [[1.2, 0], [1.6, 0.9], [2.5, 0.8]]), armOutR: 0.3 },
  });
  const k = ease(seg(ltRaw, 0, 2.5));
  STAGE.cam([lerp(0.9, 0.35, k), lerp(2.0, 2.3, k), lerp(3.6, 2.85, k)], [lerp(0.05, -0.05, k), lerp(0.85, 0.82, k), lerp(-0.5, -0.45, k)], 36);
  ov.push((c) => banner(c, TXT.banner, 960, 74, seg(lt, 0.15, 0.5), { size: 44 }));
  ov.push((c) => sfx(c, "CLICK", 700, 560, 64, lt - press, { life: 0.8, burst: false, fill: ["#bffcff", "#4ff3ff"] }));
  ov.push((c) => flashHit(c, lt - 0.78, "#fff3b0", 3));
  ov.push((c) => sfx(c, "POP! POP! POP!", 1390, 560, 92, lt - 0.88, { life: 1.4, burst: "#ffd94a" })); // over the board's right end, clear of the visors
  return { bloom: 0.5 };
});

// ---- B · his phone: mini Mr Tan taps it, hops on a packet and rides through the EdgeOne gate (372.5–375.5) ----
shot("c12 phone", T0 + 2.5, T0 + 5.5, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw); // poses, props and words on twos; the camera on plain time
  stage(t); screens(t, wait);
  const hop = 0.75, go = 1.0;
  const u = kf(lt, [[go, 0], [3.0, 0.82]], (x) => x * x * (3 - 2 * x) * 0.6 + x * 0.4);
  const rp = lt >= hop - 0.25 ? D.at("his", u) : null;
  if (rp) { D.rider.visible = true; D.rider.position.copy(rp); D.rider.scale.setScalar(backOut(seg(lt, hop - 0.25, hop), 2)); D.rider.children[1].rotation.z = t * 3; }
  // the gate scans as the rider passes
  const gateAt = 1.0 + (GATE_U / 0.82) * 2.0;
  D.scan(lt > gateAt - 0.25 && lt < gateAt + 0.3 ? lt : 0);
  // mini Tan: tap, then a hop onto the rider, then sit and ride
  const base = [-2.45, 0, 1.45];
  if (lt < hop) {
    const tap = kf(lt, [[0.1, 0], [0.3, 1], [0.45, 0.6], [0.6, 0]]);
    mini(D.miniTan, { x: base[0], z: base[2], rotY: -0.9 + tap * 0.1, armR: tap * 1.5, face: lt < 0.45 ? "code" : "happy", squash: lt > hop - 0.2 ? 0.25 : 0 });
  } else if (lt < go) {
    const k = seg(lt, hop, go), p0 = base, p1 = D.at("his", 0);
    mini(D.miniTan, { x: lerp(p0[0], p1.x, k), z: lerp(p0[2], p1.z, k), dy: lerp(0, p1.y + 0.145, k) + Math.sin(k * Math.PI) * 0.35, rotY: 0.8, sit: k, face: "happy", armL: 2.4 * (1 - k), armR: 2.4 * (1 - k) });
  } else {
    const d = D.dir("his", u);
    mini(D.miniTan, { x: rp.x, z: rp.z, dy: rp.y + 0.145, rotY: -0.15 + Math.atan2(d.x, d.z) * 0.15, sit: 1, face: lt > gateAt - 0.2 && lt < gateAt + 0.3 ? "wow" : "happy", armL: 0.4, armR: 2.6 + wob(lt, 3) * 0.2, armOutR: 0.3, tilt: wob(lt, 1.5) * 0.1 });
  }
  // camera: low over the board at the phone, tracking right with the rider to the gate
  const k = ease(seg(ltRaw, 0, 3));
  const tgt = [lerp(-2.6, -1.55, k), lerp(0.95, 0.88, k), lerp(0.95, 0.45, k)];
  camL(orb(tgt, lerp(-0.42, -0.12, k), lerp(0.42, 0.34, k), lerp(3.6, 3.95, k)), tgt, 34);
  ov.push((c) => pins(t, c, ["his", "edge"], { his: { big: true, dx: 70, dy: -170 }, edge: { big: true, abs: [940, 105] } }));
  ov.push((c) => sfx(c, "TAP", 560, 470, 58, lt - 0.3, { life: 0.7, burst: false, fill: ["#ffffff", "#ffd94a"] }));
  ov.push((c) => { const a = scr(A.gate); sfx(c, "ZIP!", a.x + 40, a.y + 160, 96, lt - gateAt, { life: 0.9, burst: "#bffcff", dots: "rgba(57,211,255,.35)" }); });
  return { bloom: 0.55 };
});

// ---- C · the server: the rider docks, mini Tan jumps onto the roof by the lighthouse (375.5–378.5) ----
shot("c12 server", T0 + 5.5, T0 + 8.5, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw); // poses, props and words on twos; the camera on plain time
  stage(t); screens(t, wait);
  const dock = 0.55;
  const u = kf(lt, [[0, 0.82], [dock, 1.0]], (x) => x);
  if (lt < dock + 0.2) {
    const rp = D.at("his", u); D.rider.visible = true; D.rider.position.copy(rp);
    D.rider.scale.setScalar(1 - seg(lt, dock, dock + 0.2)); D.rider.children[1].rotation.z = t * 3;
  }
  D.leds.forEach((l, i) => { if (lt > dock && lt < dock + 0.6 && (i + boil(lt)) % 2) l.material.color.set("#ffffff"); });
  const jump = dock, land = dock + 0.6, roof = A.serverRoof;
  if (lt < jump) {
    const rp = D.at("his", u), d = D.dir("his", u);
    mini(D.miniTan, { x: rp.x, z: rp.z, dy: rp.y + 0.145, rotY: -0.15 + Math.atan2(d.x, d.z) * 0.15, sit: 1, face: "happy", armR: 2.6, armOutR: 0.3 });
  } else {
    const k = seg(lt, jump, land), p0 = D.at("his", 1);
    const x = lerp(p0.x, roof[0], k), z = lerp(p0.z, roof[2], k);
    const y = lerp(p0.y + 0.145, roof[1], k) + Math.sin(k * Math.PI) * 0.45;
    const sq = lt > land && lt < land + 0.18 ? 0.45 : 0;
    const waveOn = lt > land + 0.4;
    mini(D.miniTan, { x, z, dy: y, rotY: lerp(1.0, 0.25, k), sit: 1 - k, squash: sq - (k > 0 && k < 1 ? 0.2 : 0), face: lt < land + 0.1 ? "wow" : "happy", armL: k < 1 ? 2.5 : 0.2, armR: k < 1 ? 2.5 : 0, wave: waveOn ? lt * 1.4 : null, ear: 1 });
  }
  // camera: orbit around the server from the front-left to the front
  const k = ease(seg(ltRaw, 0, 3));
  const tgt = [lerp(-0.5, -0.1, k), lerp(1.05, 1.15, k), lerp(0.35, 0.2, k)];
  camL(orb(tgt, lerp(-0.45, -0.05, k), lerp(0.3, 0.38, k), lerp(3.75, 4.05, k)), tgt, 34);
  ov.push((c) => pins(t, c, ["edge", "server"], { edge: { dx: -60, dy: -150 }, server: { big: true, dx: 90, dy: -130 } }));
  ov.push((c) => sfx(c, "BLEEP!", 1180, 640, 80, lt - dock, { life: 0.9, burst: false, fill: ["#bffcff", "#2ff0b0"] }));
  ov.push((c) => { const a = scr([roof[0], roof[1] + 0.55, roof[2]]); sfx(c, "BOING", a.x + 120, a.y - 20, 70, lt - land, { life: 0.8, burst: false, fill: ["#ffe37a", "#ff8a1f"] }); }); // by mini Tan, not on the lighthouse
  return { bloom: 0.55 };
});

// ---- D · the speech tower: a line goes up, the microphone listens, text comes back (378.5–381.5) ----
shot("c12 speech", T0 + 8.5, T0 + 11.5, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw); // poses, props and words on twos; the camera on plain time
  stage(t); screens(t, wait); workers(lt, ["speech"]);
  mini(D.miniTan, { x: A.serverRoof[0], z: A.serverRoof[2], dy: A.serverRoof[1], rotY: -0.6, face: "code", headPitch: -0.3, tilt: wob(lt, 0.8) * 0.1 });
  const send = [0.25, 1.05], back = [1.9, 2.7];
  if (lt > send[0] && lt < send[1]) D.packet(0, "asr", ease(seg(lt, send[0], send[1])), { col: "#4ff3ff" });
  if (lt > back[0] && lt < back[1]) D.packet(1, "asr", 1 - ease(seg(lt, back[0], back[1])), { col: "#ffe37a" });
  D.micPulse(lt > send[1] && lt < back[0] + 0.2 ? lt : 0);
  // the worker by the tower listens on its headphones, then cheers when the text goes back
  const listen = lt > send[1] - 0.2 && lt < back[0];
  mini(D.wSpeech, { x: WS[0], z: WS[1], rotY: 0.55, armR: listen ? 2.75 : 0.2, armOutR: listen ? 0.45 : 0.1, armL: lt > back[0] ? 2.6 : 0, headYaw: listen ? 0.25 : 0, tilt: listen ? 0.18 + wob(lt, 2) * 0.05 : 0,
    face: listen ? "think" : lt > back[0] ? (lt < back[0] + 0.08 ? "blink" : "happy") : "code", squash: lt > back[0] && lt < back[0] + 0.15 ? -0.3 : 0 });
  // camera: lift and pan up the tower
  const k = ease(seg(ltRaw, 0, 3));
  // high over the board's front, so the line of sight to the tower passes over the EdgeOne sign, then a tilt up the tower
  const tgt = [lerp(-1.35, -1.75, k), lerp(1.1, 1.45, k), lerp(-0.9, -1.35, k)];
  camL(orb(tgt, lerp(-0.08, -0.3, k), lerp(0.68, 0.55, k), lerp(5.0, 4.7, k)), tgt, 34);
  ov.push((c) => pins(t, c, ["server", "speech"], { server: { dx: 70, dy: -40 }, speech: { big: true, dx: 80, dy: -60 } }));
  ov.push((c) => { const a = scr([-1.7, 2.1, -1.5]); sfx(c, "MMM-HMM", a.x - 260, a.y - 40, 64, lt - 1.2, { life: 1.0, burst: false, fill: ["#bffcff", "#39d3ff"] }); });
  return { bloom: 0.55 };
});

// ---- E · the DeepSeek tower: the answer floor writes, the check floor says yes, the barrier lifts (381.5–384.5) ----
shot("c12 deepseek", T0 + 11.5, T0 + 14.5, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw); // poses, props and words on twos; the camera on plain time
  stage(t); screens(t, wait); workers(lt, ["speech", "check"]);
  mini(D.miniTan, { x: A.serverRoof[0], z: A.serverRoof[2], dy: A.serverRoof[1], rotY: 0.6, face: lt > 2.1 ? "happy" : "code", headPitch: -0.25 });
  const s1 = [0.2, 0.85], lift = [1.25, 1.75], ok = 2.0, out = [2.25, 2.95];
  if (lt > s1[0] && lt < s1[1]) D.packet(0, "ans", ease(seg(lt, s1[0], s1[1])));
  const writing = lt > s1[1] && lt < lift[0] + 0.1;
  D.ansWin.material.color.set(writing ? "#9fb3ff" : "#3a4fb0");
  D.ansLines.forEach((l, i) => (l.visible = !writing || (boil(lt) + i) % 3 !== 0));
  placeCard(0, "lift", lt, lift);
  if (lt >= lift[1] && lt < out[0]) placeCardAt(0, D.at("out", 0));
  placeCard(0, "out", lt, out);
  D.lamp(lt < lift[1] ? "off" : lt < ok ? "q" : "ok");
  D.barrier.rotation.z = -kf(lt, [[ok + 0.05, 0], [ok + 0.3, 1.3], [out[1], 1.3], [out[1] + 0.3, 0]], backOutE);
  mini(D.wCheck, { x: CK[0], z: CK[2], dy: CK[1], rotY: 0.35, armR: 1.7, armOutR: 0.2, headPitch: 0.3, headYaw: -0.2, face: lt < ok ? "think" : lt < ok + 0.08 ? "blink" : "happy", squash: lt > ok && lt < ok + 0.15 ? -0.25 : 0 });
  const k = ease(seg(ltRaw, 0, 3));
  const tgt = [lerp(0.6, 1.05, k), lerp(1.0, 1.05, k), lerp(-1.1, -1.4, k)];
  camL(orb(tgt, lerp(0.22, 0.42, k), lerp(0.26, 0.2, k), lerp(4.2, 3.8, k)), tgt, 34);
  ov.push((c) => pins(t, c, ["speech", "deepseek"], { speech: { dx: -60, dy: -60 }, deepseek: { big: true, dx: -150, dy: -40 } })); // the DeepSeek box sits left of the checker on the roof
  ov.push((c) => { const a = scr(A.check); sfx(c, "DING!", a.x - 230, a.y + 20, 84, lt - ok, { life: 0.9, burst: "#c9ffe9", dots: "rgba(47,240,176,.35)" }); });
  return { bloom: 0.55 };
});
function backOutE(x) { return backOut(x, 1.8); }
function placeCardAt(i, p) { const cd = D.cards[i]; cd.visible = true; cd.position.set(p.x, p.y + 0.12, p.z); cd.rotation.set(0, 0.2, 0); }
function placeCard(i, name, lt, [a, b]) { if (lt < a || lt > b) return; placeCardAt(i, D.at(name, ease(seg(lt, a, b)))); }

// ---- F · Supabase: the record is stored and synced; the camera pulls up to the whole board (384.5–387.4) ----
shot("c12 supabase", T0 + 14.5, T0 + 17.4, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw); // poses, props and words on twos; the camera on plain time
  stage(t); screens(t, wait); workers(lt, ALL);
  mini(D.miniTan, { x: A.serverRoof[0], z: A.serverRoof[2], dy: A.serverRoof[1], rotY: 0.3, face: "happy", wave: lt > 1.6 ? lt * 1.4 : null });
  mini(D.wSpeech, { x: WS[0], z: WS[1], rotY: 0.55, face: "code" });
  mini(D.wCheck, { x: CK[0], z: CK[2], dy: CK[1], rotY: 0.35, armR: 1.2, face: "code" });
  const s = [0.15, 0.8];
  if (lt > s[0] && lt < s[1]) D.packet(0, "db", ease(seg(lt, s[0], s[1])), { col: "#7dffb0" });
  D.dbFlash(lt > s[1] && lt < s[1] + 0.7 ? lt - s[1] : 0);
  D.sync(lt > s[1] ? lt : 0);
  // the worker carries a crate to the discs
  const wk = seg(lt, 0.1, 1.6);
  mini(D.wDb, { x: lerp(DB0[0], DB1[0], ease(wk)), z: lerp(DB0[1], DB1[1], ease(wk)), rotY: -2.4, walk: wk > 0 && wk < 1 ? lt * 10 : 0, armL: 1.2, armR: 1.2, face: lt > 1.6 ? "happy" : "code" });
  // packets keep moving on the other pipes in the wide
  if (lt > 1.2) { D.packet(2, "his", ((lt - 1.2) * 0.6) % 1); D.packet(3, "asr", ((lt - 1.4) * 0.7) % 1, { col: "#4ff3ff" }); D.packet(4, "ans", ((lt - 1.3) * 0.8) % 1); }
  const k = ease(seg(ltRaw, 0.9, 2.9));
  const t0 = [2.6, 1.0, -1.1], t1 = [-0.1, 0.65, -0.35];
  const tgt = [lerp(t0[0], t1[0], k), lerp(t0[1], t1[1], k), lerp(t0[2], t1[2], k)];
  const az = lerp(0.38 + seg(ltRaw, 0, 0.9) * 0.08, 0.12, k);
  camL(orb(tgt, az, lerp(0.24, 0.6, k), lerp(4.0, 9.6, k)), tgt, 34);
  // Supabase is introduced here (big); the other five come back as a recap while the camera pulls out to the whole
  // board, smaller, each box parked where the final wide has room so nothing covers the thing it labels
  ov.push((c) => pins(t, c, ["supabase", "speech", "deepseek", "server", "edge", "his"], {
    supabase: { big: true, abs: [1595, 112] },
    speech: { at: T0 + 16.3, size: 30, abs: [330, 108], pt: [-1.85, 1.3, -1.5] }, deepseek: { at: T0 + 16.42, size: 30, abs: [880, 104] },
    server: { at: T0 + 16.54, size: 30, abs: [1010, 900], pt: [0.1, 0.55, 0.96] }, edge: { at: T0 + 16.66, size: 30, abs: [330, 800] },
    his: { at: T0 + 16.78, size: 30, abs: [175, 350] },
  }));
  ov.push((c) => { const a = scr(A.supabase); sfx(c, "SYNC!", a.x + 175, a.y + 150, 76, lt - s[1], { life: 0.9, burst: false, fill: ["#d9fff0", "#2ff0b0"] }); });
  return { bloom: 0.5 };
});

// ---- G · trade-off 1: an always-on server. The lighthouse keeps turning; the live stream flows to both phones ----
shot("c12 always-on", T0 + 17.4, T0 + 20.8, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw); // poses, props and words on twos; the camera on plain time
  stage(t); screens(t, wait); workers(lt, ALL);
  // he watches the stream run back to the phones (head turned left) with his visor still three-quarters to the camera
  mini(D.miniTan, { x: A.serverRoof[0], z: A.serverRoof[2], dy: A.serverRoof[1], rotY: 0.2, headYaw: -0.5, face: "happy", headPitch: -0.1, tilt: wob(lt, 0.6) * 0.1, squash: wob(lt, 1.4) * 0.05, ear: 0.6 + wob(lt, 0.8) * 0.4 });
  // the live stream: beads leave the server's port and run back through the gate to his phone and to hers
  for (let j = 0; j < 6; j++) {
    const ph = (lt * 0.55 + j / 6) % 1;
    D.packet(j, "his", 1 - ph, { s: 1.1 });
    const q = (lt * 0.5 + j / 6 + 0.08) % 1;
    if (q < 0.45) D.packet(6 + j, "his", 1 - (q / 0.45) * (1 - GATE_U), { s: 1.1, col: "#ff9fd2" });
    else D.packet(6 + j, "hers", 1 - (q - 0.45) / 0.55, { s: 1.1, col: "#ff9fd2" });
  }
  D.scan(lt);
  D.beam.rotation.y = t * 2.2;
  const k = ease(seg(ltRaw, 0, 3.4));
  const tgt = [lerp(-1.3, -1.6, k), lerp(0.6, 0.6, k), lerp(0.1, 0.0, k)];
  camL(orb(tgt, lerp(0.62, 0.5, k), lerp(0.5, 0.46, k), lerp(5.4, 5.0, k)), tgt, 34);
  ov.push((c) => caption(c, TXT.card1, 70, 64, seg(lt, 0.15, 0.5)));
  return { bloom: 0.6 };
});

// ---- H · trade-off 2: sources first. The doctor's words, the label and a leaflet line go in before any answer ----
shot("c12 sources", T0 + 20.8, T0 + 25.0, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw); // poses, props and words on twos; the camera on plain time
  stage(t); screens(t, wait); workers(lt, ALL);
  mini(D.miniTan, { x: A.serverRoof[0], z: A.serverRoof[2], dy: A.serverRoof[1], rotY: 0.2, face: "wow", headPitch: -0.4 });
  const slots = [[0.6, 1.3, 0.15], [1.15, 1.38, -0.05], [1.7, 1.46, -0.25]];
  const popAt = [0.35, 0.8, 1.25], flyAt = [2.3, 2.6, 2.9], fly = 0.55;
  const win = [0.7, 0.5, -1.38];
  D.sources.forEach((s, i) => {
    if (lt < popAt[i]) return;
    s.visible = true;
    const p0 = slots[i], fk = seg(lt, flyAt[i], flyAt[i] + fly);
    const e = easeIn(fk);
    const x = lerp(p0[0], win[0], e), z = lerp(p0[2], win[2], e), y = lerp(p0[1], win[1], e) + Math.sin(fk * Math.PI) * 0.6;
    s.position.set(x, y + Math.sin(lt * 3 + i) * 0.03 * (1 - fk), z);
    s.rotation.set(0, 0.45 + fk * 2, wob(lt, 0.7, i) * 0.08);
    s.scale.setScalar(pop(lt, popAt[i], 0.35) * (1 - seg(fk, 0.75, 1)));
    s.visible = fk < 1;
    const tg = D.tags[i]; tg.visible = fk < 0.15; tg.position.set(p0[0] - 0.2, p0[1] + 0.32, p0[2] + 0.05); tg.scale.setScalar(pop(lt, popAt[i] + 0.1, 0.3)); tg.rotation.y = 0.45;
  });
  const lit = lt > flyAt[0] + fly;
  D.ansWin.material.color.set(lit ? "#c9d4ff" : "#3a4fb0");
  D.ansLines.forEach((l, i) => (l.visible = !lit || lt > flyAt[i] + fly));
  const k = ease(seg(ltRaw, 0, 4.2));
  const tgt = [lerp(1.05, 0.95, k), lerp(1.25, 1.15, k), lerp(-0.6, -0.8, k)];
  camL(orb(tgt, lerp(0.5, 0.38, k), lerp(0.3, 0.26, k), lerp(4.6, 4.2, k)), tgt, 34);
  ov.push((c) => caption(c, TXT.card2, 70, 64, seg(lt, 0.1, 0.45)));
  ov.push((c) => { for (let i = 0; i < 3; i++) { const a = scr(slots[i]); sfx(c, "POP!", a.x + 70, a.y - 70, 54, lt - popAt[i], { life: 0.6, burst: false, fill: ["#ffffff", "#ffd94a"] }); } });
  return { bloom: 0.55 };
});

// ---- I1 · trade-off 3: the checker. One sentence gets a yes and passes; the next gets no yes: CLUNK (395–398.3) ----
const I_CUT = T0 + 28.3;
shot("c12 checker", T0 + 25.0, I_CUT, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw);
  stage(t); screens(t, wait); workers(lt, ALL);
  const okA = 0.85, liftA = [0.2, 0.6], outA = [1.05, 1.65];
  const liftB = [1.65, 2.05], noB = 2.45, hit = 2.78, poof = 3.05, stop = BAR_U - 0.035;
  // sentence A: yes, the barrier lifts, it goes through
  placeCard(0, "lift", lt, liftA);
  if (lt >= liftA[1] && lt < outA[0]) placeCardAt(0, D.at("out", 0));
  placeCard(0, "out", lt, outA);
  // sentence B: no clear yes; it bumps the barrier and bursts
  placeCard(1, "lift", lt, liftB);
  if (lt >= liftB[1] && lt < noB + 0.1) placeCardAt(1, D.at("out", 0));
  if (lt >= noB + 0.1 && lt < poof + 0.25) {
    const fwd = kf(lt, [[noB + 0.1, 0], [hit, stop], [hit + 0.12, stop - 0.05], [poof, stop - 0.04]], (x) => x);
    placeCardAt(1, D.at("out", fwd));
    const cd = D.cards[1]; cd.rotation.z = lt > hit ? (lt - hit) * 6 : 0; cd.scale.setScalar(lt > poof ? 1 - seg(lt, poof, poof + 0.2) : 1);
  }
  D.lamp(lt < liftA[1] ? "off" : lt < okA ? "q" : lt < liftB[1] ? "ok" : lt < noB ? (boil(lt) % 2 ? "q" : "off") : "no");
  D.barrier.rotation.z = -kf(lt, [[okA + 0.05, 0], [okA + 0.3, 1.3], [outA[1], 1.3], [outA[1] + 0.25, 0]], backOutE) + (lt > hit && lt < hit + 0.25 ? wob(lt, 14) * 0.06 : 0);
  // stars where it burst
  const bp = D.at("out", stop - 0.04);
  for (let j = 0; j < 6; j++) {
    const k = seg(lt, poof, poof + 0.6);
    if (k <= 0 || k >= 1) continue;
    const a = (j / 6) * Math.PI * 2;
    D.packet(10 + j, "out", 0.5, { s: 0.45 * (1 - k), col: "#ffd94a" });
    D.packets[10 + j].position.set(bp.x + Math.cos(a) * k * 0.45, bp.y + 0.12 + Math.sin(a) * k * 0.45, bp.z + 0.05);
  }
  mini(D.wCheck, { x: CK[0], z: CK[2], dy: CK[1], rotY: 0.35, armR: lt > noB ? 1.2 : 1.7, armOutR: 0.2, armL: lt > noB && lt < poof + 0.6 ? 1.6 : 0, armOutL: lt > noB ? 0.6 : 0.1, headPitch: lt > noB ? 0.15 : 0.3, headYaw: lt > noB ? 0.35 : -0.2,
    face: lt < okA ? "think" : lt < liftB[1] ? "happy" : lt < noB ? "think" : lt < noB + 0.08 ? "blink" : lt < poof + 0.6 ? "worry" : "code", squash: lt > hit && lt < hit + 0.15 ? 0.3 : 0 });
  mini(D.miniTan, { x: A.serverRoof[0], z: A.serverRoof[2], dy: A.serverRoof[1], rotY: 0.5, face: lt > hit ? "wow" : "code", headPitch: -0.35 });
  mini(D.wDb, { x: 3.4, z: -0.55, rotY: -2.4, armL: 1.2, armR: 1.2, face: "code" });
  // camera: close on the check floor and the barrier, a slow orbit and a punch-in on the hit
  const k = ease(seg(ltRaw, 0, 3.3)), punch = ltRaw > hit && ltRaw < hit + 0.15 ? 0.12 : 0;
  const tgt = [lerp(1.15, 1.35, k), 1.3, lerp(-1.35, -1.3, k)];
  camL(orb(tgt, lerp(0.3, 0.42, k), lerp(0.2, 0.15, k), lerp(3.0, 2.7, k) - punch), tgt, 34);
  ov.push((c) => caption(c, TXT.card3, 70, 64, seg(t, T0 + 25.1, T0 + 25.45)));
  ov.push((c) => flashHit(c, lt - hit, "#ff6fb0", 3));
  ov.push((c) => { const a = scr(A.barrier); sfx(c, "CLUNK!", a.x + 60, a.y + 190, 120, lt - hit - 0.08, { life: 1.1, burst: "#ff6fb0", dots: "rgba(255,255,255,.35)" }); });
  ov.push((c) => { const a = scr(A.check); sfx(c, "DING", a.x - 170, a.y - 110, 60, lt - okA, { life: 0.7, burst: false, fill: ["#c9ffe9", "#2ff0b0"] }); });
  return { bloom: 0.55 };
});

// ---- I2 · back at the table: the trio nods; the whole board hums (398.3–400) ----
shot("c12 table", I_CUT, T0 + 30.0, ({ t: tRaw, lt: ltRaw, ov, wait }) => {
  const t = twos(tRaw), lt = twos(ltRaw);
  stage(t); screens(t, wait); workers(lt, ALL);
  for (let j = 0; j < 3; j++) { D.packet(j, "his", ((lt * 0.6 + j / 3) % 1)); D.packet(3 + j, "out", ((lt * 0.5 + j / 3) % 1), { s: 0.8 }); }
  D.lamp("ok"); D.sync(lt);
  mini(D.miniTan, { x: A.serverRoof[0], z: A.serverRoof[2], dy: A.serverRoof[1], rotY: 0.2, face: "happy", wave: lt * 1.4 });
  mini(D.wCheck, { x: CK[0], z: CK[2], dy: CK[1], rotY: 0.35, armR: 1.7, face: "code" });
  trio(t, { tan: lt < 0.25 ? "code" : lt < 0.33 ? "blink" : "happy", lim: lt < 0.4 ? "think" : lt < 0.48 ? "blink" : "happy", wei: "happy",
    tanP: { headPitch: kf(lt, [[0.3, 0.38], [0.5, 0.1], [0.7, 0.4], [0.9, 0.12], [1.1, 0.3]]) },
    limP: { armR: kf(lt, [[0.3, 0], [0.7, 2.5], [1.7, 2.4]]), armOutR: 0.25, headPitch: 0.15 },
    weiP: { x: WEI_X, armL: 0.9, headPitch: 0.25, squash: lt > 0.5 && lt < 0.65 ? -0.25 : 0 } });
  const k = ease(seg(ltRaw, 0, 1.7));
  STAGE.cam([lerp(0.45, 0.35, k), lerp(2.4, 2.32, k), lerp(3.15, 2.9, k)], [-0.05, lerp(0.84, 0.82, k), -0.55], 36); // high enough to see the visors over the towers
  ov.push((c) => caption(c, TXT.card3, 70, 64, seg(t, T0 + 25.1, T0 + 25.45)));
  return { bloom: 0.5 };
});
