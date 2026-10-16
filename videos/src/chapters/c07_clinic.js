// Chapter 7 · Dr Lim (v5: source 1127 s on, see T0 below; it was film 127–187). The clinic door opens with a bell; in
// the consulting room Mr Tan shows Dr Lim the consent card, lays his phone on the desk (REC), and the visit plays out as
// 3D singles and three-shots between his phone (left panel) and Wei Ling's phone (right panel). v5 (VOICE_SYNC.md):
// every speech bubble is one complete voiced line of audio/voices-v5.json, on screen exactly while its voice plays
// (the bubble's first frame is where the sound build puts the voice). The panels still run 1:1; their windows are cut
// so each line's live caption lands about 2–3 s after the line starts. Seven lines carry the visit: hello, 152/94,
// "I take amlodipine every morning", "you missed it on Sunday" (a full-frame shot while the panels step out), 10 mg,
// the tai chi question and Dr Lim's answer. He taps Finished, confirms Ripple's summary ("Yes, the doctor did"), and
// they high-five into white.
import * as THREE from "three";
import { shot } from "../timeline.js";
import { STAGE } from "../stage.js";
import { kf, seg, wob, ease, easeOut, easeIn, clamp, lerp, hash, backOut, twos } from "../core.js";
import { timeCard, sfx, bubble, panel, ring, flashHit, INK, YEL } from "../overlay.js";
import { frame } from "../media.js";
import { makeTanBot, makeWeiBot, makeLimBot } from "../bots.js";
import { buildClinicFront, buildConsultRoom, c07Phone } from "../sets/c07_clinic.js";

// ===============================================================================================================
// The app recordings: the story-time re-recording of the visit (s1-his / s1-her, one shared clock; his Today reads
// 10:29, the recording starts at 20.0 = 10:30). Every source time lives here; a re-recording only changes numbers.
// Caption times were measured on the frames (the frame where the line shows up on both phones), not taken from the
// script. Windows only move forward: a jump on a cut skips recording, never repeats it.
// ===============================================================================================================
const HIS = "s1-his", HER = "s1-her";
/** one source window per shot, in film order (panels play 1:1 inside a window and jump only on cuts; `hold` keeps the
 *  window's last frame on screen that much longer) */
const WIN = {
  consent:  { in: 15.6, out: 18.4 },    // Visits > Start the visit 16.1 > the consent card
  nod:      { in: 18.4, out: 19.9 },    // "The doctor agreed: record" 19.8. Frames f599-f613 (19.93-20.40) read "-1:-7": the
                                        // last frame painted (src out - 1/30) must stay on f598 or earlier, so out <= 19.9
                                        // (v5: in 18.35 -> 18.4, so the recording never steps back across the cut)
  rec:      { in: 20.5, out: 22.8 },    // recording; her banner (20.0), Watch live 22.2
  hello:    { in: 24.1, out: 29.3 },    // lim-hello from 24.8; "Good morning, Mr tan." + "Please have a seat." land 27.3 (+2.5)
  // (30.0 "Your daughter came with you today."; 32.83-47.4 show Wei Ling's "Good morning, doctor." labelled as Dad on
  //  both phones, so no window opens there and her intro line is not in the film)
  cuff:     { in: 43.62, out: 45.9 },   // the summary enlarges by itself 43.4-43.6 (back 47.43); opens on it settled
  squeeze:  { in: 45.9, out: 49.4 },    // lim-bp from 46.57; "Let me check your blood pressure." 48.87 (+2.3)
  reading:  { in: 51.43, out: 54.6 },   // "It is 152 over 94 higher than last time." 53.6 (+5.0: a forward jump on the cut)
  proud:    { in: 58.65, out: 63.42 },  // the summary enlarges 58.8; tan-amlo from 59.93; it shrinks 62.83 onto his line (+2.9)
  // (63.42: the panels step out for a full-frame shot while he finishes and Wei Ling starts, and come back on this frame)
  sunday:   { in: 63.42, out: 65.9 },   // "Dad, you missed it On Sunday, remember." 63.77 (wei-sunday +2.6)
  sheepish: { in: 65.9, out: 68.0 },    // "You went to the market early." 66.37 (just after her voice ends)
  ten:      { in: 73.65, out: 76.6 },   // the 10 mg caption flashes at 73.23 and the summary covers it (73.23-73.6), so the
                                        // window opens on the enlarged summary; lim-10mg from 74.3
  tenNod:   { in: 76.6, out: 80.0 },    // the summary shrinks 77.3 onto "Mr tan, we will increase the amlodipine to 10 milligrams
                                        // every morning." (+3.0); his unvoiced "10mg/d早上吃一粒对吗?" lands 80.13: stop before it
  ask:      { in: 91.7, out: 95.4 },    // the summary is large (from 89.17); tan-taichi from 92.2; shrinks 93.2; his question 95.2 (+3.0)
  ask2:     { in: 95.4, out: 99.1 },
  answer:   { in: 100.8, out: 103.6 },  // lim-answer from 101.0
  answer2:  { in: 103.6, out: 106.3, hold: 1.23 }, // "On tai CHI mornings, ... before you measure." 104.2 (+3.2); the last frame
                                        // is held 1.23 s (the timer pauses a tick) so the next caption cannot land before he says it
  answer3:  { in: 106.3, out: 108.4, hold: 0.4 },  // "Write it down and show me in two weeks." 106.47 (+6.7; he says it from +6.15);
                                        // 108.43 is Wei Ling's unvoiced "I can help him...": the window stops before it
  finish:   { in: 134.1, out: 138.6 },  // the summary enlarged 133.77 (settled 134.07) with the 10 mg and tai chi advice; back
                                        // 137.77; Finished 138.0 (the screen turns at 137.9-138.13; the taps sheet's 2:16.6 is off)
  review:   { in: 148.65, out: 152.4 }, // Ripple's summary with "Did the doctor say this?" from 148.57
};
/** cues on the same clock */
const CUE = {
  tapStart: 16.1, tapAgree: 19.8, tapWatch: 22.2, capHello: 27.3,
  zoom1: 43.4, capCheck: 48.87, capBP: 53.6, zoom2: 58.8, capHis: 62.83, capSunday: 63.77, capMarket: 66.37,
  showTen: 77.3, capAsk: 95.2, capAnswer: 104.2, capWrite: 106.47, tapFinished: 138.0,
  tapYes: 150.3, // staged: the recording shows no change when "Yes, the doctor did" is tapped (nothing moves 148.6-169.5)
};
/** where each voiced line starts, on the recording's clock (its caption lands 2.3-3.2 s later, see WIN) */
const VSRC = { hello: 24.8, bp: 46.57, amlo: 59.93, ten: 74.3, taichi: 92.2, answer: 101.0 };
/** tap targets in source pixels (585 x 1266) */
const TAPXY = { start: [292, 1090], agree: [292, 973], finished: [292, 1167], yes: [292, 964], watch: [453, 180] };

// ===============================================================================================================
// The voiced lines (audio/voices-v5.json; durations are fixed). `lines`: the bubble's text, each with the second (from
// the voice's start) it joins the bubble, so a two-sentence line grows as it is spoken. `env`: the voice's loudness,
// 15 steps a second (0-9), measured on the wav; it drives the speaker's head bob and squash, so the acting follows
// the syllables and stops with the voice.
// ===============================================================================================================
const L = { hello: "c07-lim-hello", bp: "c07-lim-bp", amlo: "c07-tan-amlo", sunday: "c07-wei-sunday", ten: "c07-lim-10mg",
  taichi: "c07-tan-taichi", answer: "c07-lim-answer" };
const VOX = {
  "c07-lim-hello": { dur: 3.46, lines: [["Good morning, Mr Tan. Please have a seat.", 0], ["Your daughter came with you today.", 1.8]],
    env: "499999827256431185153422311100787956515654334212421" },
  "c07-lim-bp": { dur: 5.69, lines: [["Let me check your blood pressure.", 0], ["It is 152 over 94, higher than last time.", 1.84]],
    env: "1199995893895695266344210100889538993887986368282299475787663631784126773554554124321" },
  "c07-tan-amlo": { dur: 4.53, size: 27, lines: [["Doctor, I take amlodipine every morning.", 0], ["I haven't forgotten!", 0], ["医生，amlodipine 我每天早上都有吃，没有忘记。", 0]],
    env: "6899985100001999899945236531037777516678468529985268664479979523542" },
  "c07-wei-sunday": { dur: 4.62, lines: [["Dad, you missed it on Sunday, remember?", 0], ["You went to the market early.", 2.3]],
    env: "698822019956875419943775596499659689569989968973468666784383349947740" },
  "c07-lim-10mg": { dur: 4.93, lines: [["Mr Tan, we will increase the amlodipine", 0], ["to 10 milligrams every morning.", 0]],
    env: "1149493896421799986535721469899542246524412776532322210000000049366554322" },
  "c07-tan-taichi": { dur: 6.66, size: 27, lines: [["On tai chi mornings I skip breakfast", 0], ["and my pressure is higher. What should I do?", 0], ["医生，我打太极的早上没吃早餐，血压就比较高，要怎么安排？", 0]],
    env: "467797300000000006991943379824493954894573586832687400000002499999859233551685300000079935325533421" },
  "c07-lim-answer": { dur: 8.48, size: 27, lines: [["On tai chi mornings, have a small breakfast first,", 0], ["then rest five minutes before you measure.", 3.4], ["Write it down and show me in two weeks.", 6.15]],
    env: "1111111699796399999953138463199729521841199311111111399859841167588751554765675332111111101397979994576367784463244311111110111" },
};
/** the film second each voice starts (its bubble's first frame), set as the shots are laid out */
const VO = {};
const snap = (t) => Math.round(t * 30) / 30;
function cue(id, t) { VO[id] = snap(t); }
/** seconds since a voice started, or null when it is not playing (frame-accurate: no twos here) */
function vs(id, T) { const V = VO[id]; if (V == null) return null; const s = T - V; return s >= -1e-6 && s <= VOX[id].dur + 0.02 ? s : null; }
/** how loud a voice is now, 0..1 (0 outside it) */
function loud(id, T) { const V = VO[id]; if (V == null) return 0; const i = Math.floor((T - V) * 15 + 1e-6), e = VOX[id].env; return i >= 0 && i < e.length ? +e[i] / 9 : 0; }

// ===============================================================================================================
// Sets, cast, props
// ===============================================================================================================
const front = STAGE.set("c07.front", buildClinicFront());
const room = STAGE.set("c07.room", buildConsultRoom());
const props = new THREE.Group();
const tanPhone = c07Phone(), weiPhone = c07Phone();
props.add(tanPhone, weiPhone);
STAGE.set("c07.props", props);
const TAN = STAGE.need("tan", makeTanBot), WEI = STAGE.need("wei", makeWeiBot), LIM = STAGE.need("lim", makeLimBot);
const door = front.userData.door, bell = front.userData.bell;
const bp = room.userData.bp, cuff = room.userData.cuff, TOP = room.userData.top;

// layout of the two phone panels and the 3D gap between them
const PW = 406, PH = 880, PY = 500;
const PX_HIS = 241, PX_HER = 1679, MID = [470, 1462];
const PTOP = PY - PH / 2 - 12;

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
/** pin a prop to a bone (a hand, an arm) with a local offset; the prop lives in an identity-transform set */
function stick(obj, bone, pos = [0, 0, 0], rot = [0, 0, 0], sc = 1) {
  bone.updateWorldMatrix(true, false);
  _m.compose(_p.set(...pos), _q.setFromEuler(_e.set(...rot)), _s.setScalar(sc));
  obj.matrixAutoUpdate = false; obj.matrix.multiplyMatrices(bone.matrixWorld, _m); obj.matrixWorldNeedsUpdate = true; obj.visible = true;
}
function cam(pos, tgt, fov) { STAGE.cam(pos, tgt, fov); STAGE.camera.updateMatrixWorld(); }
function toScr(v) { const p = v.clone().project(STAGE.camera); return { x: ((p.x + 1) / 2) * 1920, y: ((1 - p.y) / 2) * 1080 }; }
/** screen position of an actor's visor (or a point above it) */
function headScr(a, up = 0) { a.head.updateWorldMatrix(true, false); return toScr(_v.set(0, 0.27 + up, 0.25).applyMatrix4(a.head.matrixWorld)); }
function objScr(o, off = [0, 0, 0]) { o.updateWorldMatrix(true, false); return toScr(_v.set(...off).applyMatrix4(o.matrixWorld)); }

/** visor face from a timed list [[t, face], ...]: one blink frame at every change, and a blink every few seconds */
function face(t, seq, seed = 0) {
  let f = seq[0][1];
  for (const [a, n] of seq) if (t >= a) f = n;
  for (let i = 1; i < seq.length; i++) if (t >= seq[i][0] - 0.07 && t < seq[i][0]) return "blink";
  const per = 2.7 + hash(seed) * 1.2, ph = (t + hash(seed * 3) * 2) % per;
  if (ph < 0.07 && !["blink", "sleepy", "happy", "love"].includes(f)) return "blink";
  return f;
}
const breathe = (t, s = 0) => wob(t, 0.42, s) * 0.03;
const sway = (t, s = 0) => wob(t, 0.27, s * 2.1) * 0.05;
/** a stepped nod while a character talks */
const talk = (t, a, b) => (t > a && t < b ? Math.abs(Math.sin(Math.floor(t * 7.5) * 1.9)) * 0.06 : 0);
const hop = (t, a, b, h = 0.16) => (t > a && t < b ? Math.sin(((t - a) / (b - a)) * Math.PI) * h : 0);
/** squash after a landing at time a (decays over 0.3 s) */
const land = (t, a, amt = 0.35) => (t > a && t < a + 0.3 ? amt * (1 - (t - a) / 0.3) : 0);

// seats in the consulting room
const SEAT = {
  tan: { x: -0.72, z: -0.86, rotY: 1.1, dy: 0.2, sit: 1 },
  wei: { x: -1.25, z: -0.42, rotY: 0.8, dy: 0.2, sit: 1 },
  lim: { x: 0.28, z: -1.42, rotY: -0.45, dy: 0.227, sit: 1 },
};
const seat = (name, p = {}) => STAGE.pose(name, { ...SEAT[name], ...p });

/** reset everything movable in the room (every room shot calls this first: frames are pure functions of t) */
function roomDefaults() {
  STAGE.show("c07.room", "c07.props");
  STAGE.lights("day", { sky: "#e9fff6", ground: "#5b4f9a", hemi: 1.05, key: "#fff0d6", keyI: 2.3, rim: "#ff8fd0", rimI: 0.8, bg: "#bfeee0",
    keyPos: [-2.2, 6, 4.2], keyTarget: [0, 0, -0.8] });
  bp.userData.setBP();
  cuff.matrixAutoUpdate = true; cuff.position.copy(room.userData.cuffRest.pos); cuff.rotation.set(0, room.userData.cuffRest.rotY, 0); cuff.scale.set(1, 1, 1);
  cuff.userData.wrap(false);
  tanPhone.visible = false; weiPhone.visible = false; tanPhone.userData.setRec(false); weiPhone.userData.setRec(false);
  tanPhone.userData.setScreen(null, "#efeef8"); weiPhone.userData.setScreen(null, "#15121c"); // nothing carried over from another frame; shots that show the app redraw it
  for (const a of [TAN, WEI, LIM]) for (const h of a.hands) h.children.forEach((c) => (c.visible = false)); // other chapters' hand props
}
/** lay the BP tube from the monitor to wherever the cuff is now */
function tube() { cuff.updateWorldMatrix(true, false); room.userData.setTube(room.userData.bpPort, _v.set(0, 0.03, 0).applyMatrix4(cuff.matrixWorld).clone()); }
/** Mr Tan's phone flat on the desk (screen up, top toward Dr Lim) */
const DESK_PHONE = [-0.36, TOP + 0.009, -0.81]; // where his left hand lands when he leans in (v1: -0.25, -0.8, out of his reach)
const PHONE_SC = 1.05; // the c07 phone at 1.05 is 0.14 x 0.28 m, the size his phone has in c05 and c06 (v1 held it at 1.3-1.45)
const deskM = (lift = 0) => placeM([DESK_PHONE[0], DESK_PHONE[1] + lift, DESK_PHONE[2]], [-Math.PI / 2, 0, 0.5], PHONE_SC);
function phoneOnDesk(lift = 0, rec = false, img = null) {
  setM(tanPhone, deskM(lift));
  tanPhone.userData.setRec(rec); if (img) tanPhone.userData.setScreen(img);
}
const SHOW_YAW = -0.1; // his phone held out toward Dr Lim, its face cheated halfway to camera so the card reads
/** his left hand holding his phone up to read it, the screen tipped between his visor and the camera (as Wei Ling's) */
const TAN_LOOK = { a: 1.45, out: -0.3, yaw: -0.9, pitch: -0.75 };
/** his left arm laid on the desk at the phone (with lean 0.15): to put it down, tap it, pick it up */
const TAN_DESK = { a: 1.45, out: -0.5 };
/** where an arm's hand point sits in body space for a forward raise a and a sideways swing out (negative = across the
 *  chest); hand 0 is the bot's left arm (at +x), hand 1 its right (at -x), as in actor.hands */
function handAt(hand, a, out) {
  const s = hand === 0 ? 1 : -1, co = Math.cos(out);
  return new THREE.Vector3(s * 0.29 + 0.3 * s * Math.sin(out), 0.34 - 0.3 * co * Math.cos(a) + 0.02 * Math.sin(a), 0.3 * co * Math.sin(a) + 0.02 * Math.cos(a));
}
/** a phone standing in a hand. The arm must be posed with the same raise a and swing out (armL/armOutL for hand 0,
 *  armR/armOutR for hand 1); the screen is tipped by pitch (negative tips it up) and then turned by yaw (0 faces forward,
 *  PI faces the holder), in the holder's body space, so the phone follows lean and turns */
function grip(phone, actor, hand, a, out, yaw, pitch, roll = 0, sc = PHONE_SC) {
  setM(phone, gripM(new THREE.Matrix4(), actor, hand, a, out, yaw, pitch, roll, sc));
}
/** the world matrix of a phone in a hand (see grip) */
function gripM(M, actor, hand, a, out, yaw, pitch, roll = 0, sc = PHONE_SC) {
  const p = handAt(hand, a, out), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"));
  p.addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(q), 0.135 * sc - 0.035);  // the hand closes on the phone's lower end
  p.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(q), 0.05);                 // from behind, so the screen stays clear
  actor.body.updateWorldMatrix(true, false);
  return M.multiplyMatrices(actor.body.matrixWorld, new THREE.Matrix4().compose(p, q, new THREE.Vector3(sc, sc, sc)));
}
/** a world matrix for a prop that is not held (e.g. a phone lying on the desk) */
const placeM = (pos, rot, sc) => new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(sc, sc, sc));
/** blend two world matrices (position lerp, rotation slerp): a prop handed from one place to another */
function blendM(A, B, k) {
  const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
  A.decompose(pa, qa, sa); B.decompose(pb, qb, sb);
  return new THREE.Matrix4().compose(pa.lerp(pb, k), qa.slerp(qb, k), sa.lerp(sb, k));
}
function setM(obj, M) { obj.matrixAutoUpdate = false; obj.matrix.copy(M); obj.matrixWorldNeedsUpdate = true; obj.visible = true; }
const armOf = (hand, a, out) => (hand === 0 ? { armL: a, armOutL: out } : { armR: a, armOutR: out });
/** Wei Ling in her chair, her phone in her left hand, its screen tipped up halfway between her visor and the camera (a
 *  cheat: she reads it and we see it); her right arm is free for taps and gestures. p is her pose, g overrides the grip */
const WEI_GRIP = { a: 1.3, out: -0.3, yaw: -0.77, pitch: -0.78 };
function weiSeat(t, p = {}, g = {}) {
  const G = { ...WEI_GRIP, ...g };
  seat("wei", { squash: breathe(t, 6), tilt: sway(t, 6), armR: 0.25, armOutR: 0.12, ...p, ...armOf(0, G.a, G.out) });
  grip(weiPhone, WEI, 0, G.a, G.out, G.yaw, G.pitch);
}

// ---------------------------------------------------------------------------------------------------------------
// the comic layer for this chapter
// ---------------------------------------------------------------------------------------------------------------
const CARD = (k) => (c) => timeCard(c, "10:30 AM", "Dr Lim · follow-up", k);
function tag(c, txt, x, y, k) {
  if (k <= 0) return;
  c.save(); c.font = '800 22px "Segoe UI", sans-serif'; const w = c.measureText(txt).width + 22, h = 32;
  c.translate(x, y); const s = backOut(clamp(k), 1.6); c.scale(s, s); c.transform(1, 0, -0.08, 1, 0, 0);
  c.fillStyle = INK; c.fillRect(-w / 2 + 4, -h / 2 + 4, w, h); c.fillStyle = YEL; c.fillRect(-w / 2, -h / 2, w, h);
  c.lineWidth = 3; c.strokeStyle = INK; c.strokeRect(-w / 2, -h / 2, w, h);
  c.fillStyle = INK; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, 0, 1); c.restore();
}
/** both phone panels at one source time (and the same frames on the two 3D phones); o.pop pops them in */
function phones(x, src, o = {}) {
  const { lt, ov, wait } = x;
  let his = null, her = null;
  // the 3D phones mirror the panels: his (on the desk or in his hand) and hers (in her hand)
  wait(frame(HIS, src).then((i) => { his = i; tanPhone.userData.setScreen(i); }));
  wait(frame(HER, src).then((i) => { her = i; weiPhone.userData.setScreen(i); }));
  const k1 = o.pop ? seg(twos(lt), 0, 0.3) : 1, k2 = o.pop ? seg(twos(lt), 0.07, 0.37) : 1;
  ov.push((c) => {
    panel(c, his, PX_HIS, PY, PW, PH, k1, { noPop: !o.pop, rot: -0.012 });
    panel(c, her, PX_HER, PY, PW, PH, k2, { noPop: !o.pop, rot: 0.012 });
    // the tags sit on the panels' top bezels (v1: 16 px higher, 8 px from the frame's top edge)
    tag(c, "MR TAN'S PHONE", PX_HIS, PTOP - 6, k1); tag(c, "WEI LING'S PHONE", PX_HER, PTOP - 6, k2);
  });
}
/** a point on a panel from source pixels */
const onPanel = (cx, [sx, sy]) => [cx - PW / 2 + (sx * PW) / 585, PY - PH / 2 + (sy * PH) / 1266];
function tapRing(ov, cx, key, age) {
  const [x, y] = onPanel(cx, TAPXY[key]);
  ov.push((c) => { ring(c, x, y, 64, age, { life: 0.7 }); ring(c, x, y, 40, age - 0.12, { life: 0.6, col: "#ffffff" }); });
}
/** a caption has just landed on both phones */
function blip(ov, age) {
  ov.push((c) => {
    sfx(c, "BLIP!", MID[0] + 78, 700, 44, age, { burst: false, life: 0.8, fill: ["#e8fdff", "#39d3ff"], rot: -0.18 });
    sfx(c, "BLIP!", MID[1] - 78, 700, 44, age, { burst: false, life: 0.8, fill: ["#e8fdff", "#39d3ff"], rot: 0.18 });
  });
}
/** the live summary enlarged by itself on both phones */
function zoom(ov, age, zy = 250) {
  ov.push((c) => {
    for (const [x, s] of [[MID[0] + 120, -1], [MID[1] - 120, 1]]) {
      if (age >= 0 && age < 0.5) { // speed lines toward the panel
        c.save(); c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = 5; c.lineCap = "round";
        for (let i = 0; i < 6; i++) { const y = zy - 100 + i * 46 + hash(i) * 20, k = Math.floor(age * 15) / 7;
          c.beginPath(); c.moveTo(x - s * (40 + k * 60), y); c.lineTo(x + s * (60 - k * 30), y); c.stroke(); }
        c.restore();
      }
      sfx(c, "ZOOM!", x, zy, 62, age, { burst: "#bff6ff", dots: "rgba(57,211,255,.45)", rot: s * 0.12, life: 1.1 });
    }
  });
}
/** a speech bubble kept inside the gap between the panels (or anywhere with o.full) */
function say(ov, lines, head, k, o = {}) {
  if (k <= 0) return;
  ov.push((c) => {
    const size = o.size ?? 30;
    c.save(); let w = 0;
    lines.forEach((l) => { c.font = /[㐀-鿿]/.test(l) ? `700 ${size * 0.9}px "Microsoft YaHei", sans-serif` : `800 ${size}px "Segoe UI", sans-serif`; w = Math.max(w, c.measureText(l).width); });
    c.restore();
    w += size * 1.4; const h = lines.length * size * 1.25 + size * 0.7;
    const lo = (o.full ? 30 : MID[0] + 14) + w / 2, hi = (o.full ? 1890 : MID[1] - 14) - w / 2;
    const x = clamp(head.x + (o.dx ?? 0), lo, Math.max(lo, hi));
    // v5: `above` is the gap from the head to the bubble's lower edge, so a bubble that grows by a sentence grows upward
    const y = clamp(o.y ?? head.y - (o.above ?? 170) - h / 2, h / 2 + 32, 900); // 32: clear of the 30 px frame margin (v1: 22)
    bubble(c, lines, x, y, head.x + (o.tx ?? 0), head.y - (o.ty ?? 80), k, { size, voice: o.voice }); // the voice id goes to the sound pass
  });
}
/** a flash over the 3D gap only (so it never covers the phone panels) */
function midFlash(ov, age, col = "#fff3b0") {
  ov.push((c) => { if (age < 0 || age > 0.1) return; c.save(); c.globalAlpha = 0.7 * (1 - age / 0.1); c.fillStyle = col; c.fillRect(MID[0], 0, MID[1] - MID[0], 1080); c.restore(); });
}
const bk = (t, a) => seg(t, a, a + 0.25); // bubble pop-in

// ---------------------------------------------------------------------------------------------------------------
// the schedule: shots follow each other from T0; window shots last as long as their source windows (plus any hold).
// v5: the chapter grew from 60 s to about 73.7 s, so it moved from 127 to 1127 (VOICE_SYNC.md: 1000 + its start).
// ---------------------------------------------------------------------------------------------------------------
const T0 = 1127;
let CUR = T0;
/** a shot of d seconds from the current point; shot edges sit on frames. Returns the shot's start */
function take(name, d, fn) { const a = CUR; CUR = snap(CUR + d); shot(name, a, CUR, fn); return a; }
function takeWin(name, w, fn) { return take(name, w.out - w.in + (w.hold ?? 0), (x) => fn({ ...x, src: Math.min(w.out, w.in + x.lt) })); }
/** a voice's start in a shot's own time (lt): negative when the line began in an earlier shot */
const vAt = (x, id) => VO[id] - (x.t - x.lt);

/** the bubble of a voiced line, drawn from its voice's first frame to its last; across a cut the next shot draws it
 *  again (same id, k = 1, no second pop). A sentence joining the bubble gives it a small bounce. */
function line(x, id, actor, o = {}) {
  const s = vs(id, x.t); if (s == null) return;
  const v = VOX[id], shown = v.lines.filter((l) => s >= l[1] - 1e-6), last = Math.max(...shown.map((l) => l[1])), q = twos(s);
  const k = last > 0 && q - last < 0.2 ? 0.55 + 0.45 * seg(q - last, 0, 0.13) : 0.3 + 0.7 * seg(q, 0, 0.15); // k > 0 on the first frame
  say(x.ov, shown.map((l) => l[0]), headScr(actor, 0.1), k, { size: v.size ?? 30, ...o, voice: id });
}
/** the speaker's talking: a head bob and a squash that follow the voice's loudness */
const nodTalk = (id, T) => -0.09 * loud(id, T);
const sqTalk = (id, T) => 0.05 * loud(id, T);

// camera spots in the consulting room: an orbit around a subject point (yaw 0 looks from +z)
const orbit = (S, yaw, pitch, dist, fov) => ({ pos: [S[0] + Math.sin(yaw) * Math.cos(pitch) * dist, S[1] + Math.sin(pitch) * dist, S[2] + Math.cos(yaw) * Math.cos(pitch) * dist], tgt: S, fov });
const CAM = {
  three: orbit([-0.55, 0.85, -0.95], 0.3, 0.12, 4.2, 38),
  tan: orbit([-0.72, 0.86, -0.86], 0.72, 0.08, 2.7, 34),
  tanClose: orbit([-0.72, 0.92, -0.86], 0.78, 0.06, 2.0, 32),
  lim: orbit([0.28, 0.93, -1.42], -0.12, 0.07, 2.7, 34),
  limCuff: orbit([0.06, 0.88, -1.26], -0.02, 0.1, 2.6, 34), // Dr Lim and the cuff by his right hand (v1 used lim: the cuff sat under his panel)
  wei: orbit([-0.98, 0.86, -0.64], 0.4, 0.08, 2.7, 34),   // a two-shot: Wei Ling left, Mr Tan right
  bp: orbit([-0.25, 0.8, -1.05], 0.12, 0.2, 2.7, 38),
  desk: { pos: [0.5, 1.32, -0.02], tgt: [-0.38, 0.76, -0.8], fov: 36 }, // over the desk corner: the phone, his hand and his face
  pair: orbit([-0.3, 0.86, -1.08], 0.22, 0.12, 3.0, 38),
  wide2: orbit([-0.98, 0.84, -0.66], 0.22, 0.1, 2.65, 40),   // full frame, no panels: Wei Ling and Mr Tan face to face
};
/** a camera spot with a slow push of `push` (fraction of the distance) over `dur` and a small sideways drift */
function camAt(spot, lt, dur, push = 0.07, drift = 0.05) {
  const k = easeOut(seg(lt, 0, dur)) * 0.6 + seg(lt, 0, dur) * 0.4;
  const P = new THREE.Vector3(...spot.pos), T = new THREE.Vector3(...spot.tgt);
  const d = P.clone().sub(T), side = new THREE.Vector3(d.z, 0, -d.x).normalize();
  P.addScaledVector(d, -push * k).addScaledVector(side, drift * (k - 0.5));
  cam(P.toArray(), T.toArray(), spot.fov);
}
const blinkRec = (lt) => Math.floor(lt * 2.2) % 3 !== 2;

// ===============================================================================================================
// 7a · the clinic front: the door swings open, the bell rings (DING), they go in
// ===============================================================================================================
take("c07 door", 3.2, ({ lt, ov }) => {
  const t = twos(lt);
  STAGE.show("c07.front");
  STAGE.lights("day", { bg: "#ffe2b8", keyPos: [3.5, 7, 7], keyTarget: [0, 0, 0.6], hemi: 1.15, keyI: 2.2 });
  front.userData.setQueue(t < 2.1 ? 1030 : 1031, !(t > 2.0 && t < 2.2));
  // the door starts shut (out of c06's closing doors) and swings out; Wei Ling pulls it by the handle, lets go, steps back
  door.rotation.y = -1.32 * backOut(seg(t, 0.03, 0.45), 2.2);
  const ba = t - 0.13; const sw = ba > 0 ? 0.55 * Math.exp(-ba * 2.4) * Math.sin(ba * 21) : 0;
  bell.rotation.set(sw * 0.4, 0, sw);
  door.updateWorldMatrix(true, false);
  const handle = new THREE.Vector3(0.9, 0.82, 0.06).applyMatrix4(door.matrixWorld);
  const turn = ease(seg(t, 0.35, 0.8)), hold = 1 - ease(seg(t, 0.14, 0.55));
  const weiP = { rotY: lerp(-2.2, 0.45, turn), armR: kf(t, [[0, 2.25], [0.14, 2.25], [0.55, 0.2], [0.8, 0.5]]), armL: kf(t, [[0, 1.0], [0.3, 0.9], [0.55, 0.1]]),
    armOutR: kf(t, [[0.7, 0.1], [0.95, 1.15], [2.7, 1.05], [3.1, 0.4]], easeOut), lean: kf(t, [[0, -0.1], [0.18, -0.2], [0.45, 0.06], [0.7, 0]]),
    face: face(t, [[0, "code"], [0.75, "happy"]], 2), ear: seg(t, 0.75, 0.95), headYaw: kf(t, [[1.0, 0], [2.4, -0.45]]), tilt: sway(t, 1), squash: breathe(t) + land(t, 0.45, 0.2) };
  STAGE.pose("wei", { ...weiP, x: 0, z: 0 }); // where her right hand is relative to her feet in this pose
  WEI.hands[1].updateWorldMatrix(true, false); const hw = new THREE.Vector3().setFromMatrixPosition(WEI.hands[1].matrixWorld);
  STAGE.pose("wei", { ...weiP, x: lerp(1.08, handle.x - hw.x, hold), z: lerp(0.6, handle.z - hw.z, hold), walk: t > 0.14 && t < 0.6 ? t * 15 : 0 }); // steps back as she lets go
  // Mr Tan walks along the walkway, nods to her, turns into the doorway and goes in
  const w1 = seg(t, 0, 1.55), w2 = seg(t, 1.55, 3.2);
  const x = t < 1.55 ? lerp(-2.1, -0.1, w1) : lerp(-0.1, 0.02, w2), z = t < 1.55 ? lerp(1.35, 1.15, w1) : lerp(1.15, -0.95, easeIn(w2) * 0.4 + w2 * 0.6);
  STAGE.pose("tan", { x, z, rotY: t < 1.45 ? 1.35 : lerp(1.35, Math.PI - 0.05, ease(seg(t, 1.45, 1.85))), walk: t * 9,
    headYaw: kf(t, [[0.5, 0], [0.9, -0.55], [1.5, -0.55], [1.8, 0]]), face: face(t, [[0, "code"], [0.8, "happy"]], 5), ear: seg(t, 0.8, 1.0), tilt: sway(t, 3) });
  const k = easeOut(seg(lt, 0, 3.2));
  cam([lerp(2.6, 2.1, k), lerp(1.75, 1.68, k), lerp(5.9, 5.1, k)], [lerp(-0.2, -0.05, k), lerp(1.42, 1.38, k), 0], 44);
  const b = objScr(bell, [0, -0.08, 0]);
  ov.push((c) => flashHit(c, lt - 0.1, "#fff3b0", 2));
  ov.push((c) => sfx(c, "DING!", b.x + 215, b.y + 10, 96, t - 0.17, { burst: "#fff3a0", dots: "rgba(255,154,46,.35)", life: 1.1 }));
  ov.push(CARD(seg(t, 0.35, 0.65)));
  return { bloom: 0.55 };
});

// ===============================================================================================================
// 7b · the consulting room, wide: Dr Lim waves them in; they hop up onto their chairs (PLONK)
// ===============================================================================================================
take("c07 room", 2.6, ({ lt, dur, ov, wait }) => {
  const t = twos(lt);
  roomDefaults();
  // once seated they take their phones out; the screens run on the visit's clock, up to where the consent shot picks up
  const src = WIN.consent.in - dur + lt;
  wait(frame(HIS, src).then((i) => tanPhone.userData.setScreen(i)));
  wait(frame(HER, src).then((i) => weiPhone.userData.setScreen(i)));
  seat("lim", { face: face(t, [[0, "happy"]], 7), wave: t * 1.1, headYaw: -0.25, tilt: sway(t, 2), squash: breathe(t, 1) });
  // a hop from in front of the chair back onto the seat: dip, jump, land
  const hopOn = (name, a, s0, stand, extra = {}) => {
    const S = SEAT[name], k = ease(seg(t, a, a + 0.32));
    const x = lerp(stand[0], S.x, k), z = lerp(stand[1], S.z, k);
    const dip = t > a - 0.22 && t < a ? 0.22 : 0;
    STAGE.pose(name, { x, z, rotY: S.rotY, dy: lerp(0, S.dy, k) + hop(t, a, a + 0.32, 0.2), sit: k, squash: dip + land(t, a + 0.32, 0.38) + breathe(t, s0),
      armL: t > a && t < a + 0.32 ? 0.9 : 0.2, armR: t > a && t < a + 0.32 ? 0.9 : 0.2, armOutL: 0.15, armOutR: 0.15, ...extra,
      face: face(t, [[0, "code"], [a + 0.4, "happy"]], s0), ear: seg(t, a + 0.3, a + 0.5), tilt: sway(t, s0) });
  };
  // the phone comes up from the lap into the reading grip (it pops in low, by the knee, where the hand starts)
  const lift = (a0, g, k) => [lerp(0.35, g.a, k), lerp(0.1, g.out, k), lerp(g.yaw - 0.6, g.yaw, k), lerp(-1.2, g.pitch, k)];
  const tk = ease(seg(t, 1.65, 2.15)), wk = ease(seg(t, 1.85, 2.35));
  const tg = lift(0, TAN_LOOK, tk), wg = lift(0, WEI_GRIP, wk);
  hopOn("tan", 0.75, 3, [-0.55, -0.62], t > 1.55 ? armOf(0, tg[0], tg[1]) : {});
  hopOn("wei", 1.15, 6, [-1.15, -0.2], t > 1.75 ? armOf(0, wg[0], wg[1]) : {});
  if (t > 1.55) grip(tanPhone, TAN, 0, ...tg);
  if (t > 1.75) grip(weiPhone, WEI, 0, ...wg);
  tube();
  const k = seg(lt, 0, 2.6);
  cam([lerp(2.45, 2.15, k), lerp(1.6, 1.5, k), lerp(3.3, 2.9, k)], [lerp(-0.62, -0.5, k), 0.76, -0.95], 46);
  const p1 = headScr(TAN, -0.6), p2 = headScr(WEI, -0.6);
  ov.push((c) => sfx(c, "PLONK!", p1.x + 40, p1.y - 40, 70, t - 1.07, { burst: false, fill: ["#fff6c4", "#ff9a2e"], life: 0.9 }));
  ov.push((c) => sfx(c, "plonk", p2.x - 30, p2.y - 10, 50, t - 1.47, { burst: false, fill: ["#fff6c4", "#ff9a2e"], life: 0.8 }));
  ov.push(CARD(1));
  return { bloom: 0.5 };
});

// ===============================================================================================================
// 7c · the consent card: he taps Start the visit, turns the phone to Dr Lim (both panels pop in)
// ===============================================================================================================
takeWin("c07 consent", WIN.consent, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt);
  roomDefaults();
  const show = ease(seg(t, 1.3, 2.0));                       // turning the phone to Dr Lim
  const tapA = CUE.tapStart - WIN.consent.in;                  // his tap on "Start the visit"
  const A = lerp(TAN_LOOK.a, 1.7, show), O = lerp(TAN_LOOK.out, -0.15, show);
  seat("tan", { lean: 0.12 * show, ...armOf(0, A, O), armR: kf(t, [[0.1, 0.5], [tapA - 0.1, 1.3], [tapA + 0.05, 1.15], [tapA + 0.35, 0.4]]),
    armOutR: kf(t, [[0.1, 0.2], [tapA - 0.1, -0.6], [tapA + 0.35, 0.2]]), headPitch: lerp(0.3, 0.05, show), headYaw: lerp(0, 0.2, show), face: face(t, [[0, "think"], [1.4, "happy"]], 3), squash: breathe(t, 3), tilt: sway(t, 3) });
  // he reads it (screen to his visor), then turns it out between Dr Lim and us (a cheat to camera: the card shows)
  grip(tanPhone, TAN, 0, A, O, lerp(TAN_LOOK.yaw, SHOW_YAW, show), lerp(TAN_LOOK.pitch, -0.1, show));
  weiSeat(t, { headPitch: 0.25, headYaw: 0.25, face: face(t, [[0, "code"]], 6) });
  seat("lim", { lean: 0.22 * ease(seg(t, 1.8, 2.6)), headYaw: -0.15, headPitch: 0.1 * seg(t, 1.8, 2.6), face: face(t, [[0, "code"], [2.0, "think"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) });
  phones(x, src, { pop: true });
  tube();
  camAt(CAM.pair, lt, dur, 0.06);
  const ph = objScr(tanPhone);
  tapRing(ov, PX_HIS, "start", src - CUE.tapStart);
  ov.push((c) => sfx(c, "TAP", ph.x + 60, ph.y - 70, 50, t - tapA, { burst: false, fill: ["#e9fbff", "#5aa8ff"], life: 0.7 }));
  ov.push(CARD(1));
});

// 7d · Dr Lim reads it and nods; he taps "The doctor agreed: record" (CLICK)
takeWin("c07 nod", WIN.nod, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt);
  roomDefaults();
  const nodT = 0.4;
  const nod = t > nodT && t < nodT + 0.6 ? Math.abs(Math.sin(((t - nodT) / 0.6) * Math.PI * 2)) * 0.28 : 0;
  seat("lim", { lean: 0.18, headYaw: 0.12, headPitch: 0.06 + nod, face: face(t, [[0, "think"], [nodT, "happy"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) + 0.06 });
  seat("tan", { lean: 0.12, ...armOf(0, 1.7, -0.15), armR: kf(t, [[0.8, 0.4], [1.25, 1.3], [1.37, 1.15]]), armOutR: kf(t, [[0.8, 0.2], [1.25, -0.6]]), headYaw: 0.2, face: face(t, [[0, "happy"]], 3), squash: breathe(t, 3), tilt: sway(t, 3) });
  grip(tanPhone, TAN, 0, 1.7, -0.15, SHOW_YAW, -0.1);
  weiSeat(t, { headPitch: 0.25, headYaw: 0.25, face: face(t, [[0, "code"]], 6) });
  phones(x, src);
  tube();
  camAt(CAM.lim, lt, dur, 0.08);
  const h = headScr(LIM, 0.1);
  ov.push((c) => sfx(c, "NOD NOD", h.x - 230, h.y - 40, 52, t - nodT - 0.05, { burst: false, fill: ["#ffffff", "#9b6bff"], rot: -0.12, life: 0.9 }));
  tapRing(ov, PX_HIS, "agree", src - CUE.tapAgree);
  ov.push((c) => sfx(c, "CLICK", MID[0] + 95, 860, 52, src - CUE.tapAgree, { burst: false, fill: ["#ffffff", "#ffd94a"], rot: -0.1, life: 0.7 }));
  ov.push(CARD(1));
});

// 7e · the phone goes flat on the desk: a red dot, REC. Her phone gets the banner; she taps Watch live
takeWin("c07 rec", WIN.rec, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt);
  roomDefaults();
  const down = 0.32;                                         // the phone lands
  phones(x, src);
  // his left hand brings the phone down from where he showed it (the nod shot) and lays it on the desk, then lets go
  const A = kf(t, [[0, 1.7], [down, TAN_DESK.a], [down + 0.25, TAN_DESK.a], [0.95, 0.35]]), O = kf(t, [[0, -0.15], [down, TAN_DESK.out], [down + 0.25, TAN_DESK.out], [0.95, 0.1]]);
  seat("tan", { lean: kf(t, [[0, 0.12], [down, 0.15], [down + 0.3, 0.15], [0.9, 0]]), ...armOf(0, A, O), headPitch: 0.25, face: face(t, [[0, "happy"]], 3), squash: breathe(t, 3) + land(t, down, 0.06) });
  const recOn = t > down + 0.08 && blinkRec(lt);
  if (t < down) setM(tanPhone, blendM(gripM(new THREE.Matrix4(), TAN, 0, A, O, SHOW_YAW, -0.1), deskM(0), easeIn(seg(t, 0, down))));
  else phoneOnDesk(land(t, down, 0.012), recOn);
  seat("lim", { lean: 0.1, headPitch: 0.12, headYaw: 0.1, face: face(t, [[0, "happy"], [1.4, "code"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) });
  const tapW = CUE.tapWatch - WIN.rec.in;
  weiSeat(t, { armR: kf(t, [[tapW - 0.6, 0.3], [tapW - 0.1, 1.25], [tapW + 0.05, 1.12], [tapW + 0.45, 0.3]]), armOutR: kf(t, [[tapW - 0.6, 0.1], [tapW - 0.1, -0.55], [tapW + 0.45, 0.1]]),
    headPitch: 0.3, headYaw: 0.25, face: face(t, [[0, "code"], [tapW + 0.15, "wow"]], 6) });
  tube();
  camAt(CAM.desk, lt, dur, 0.1, 0.04);
  const ph = objScr(tanPhone);
  midFlash(ov, t - down, "#ffd0d0");
  ov.push((c) => sfx(c, "REC ●", ph.x - 230, ph.y - 170, 78, t - down - 0.07, { burst: "#ff5a6a", dots: "rgba(120,0,30,.35)", fill: ["#ffffff", "#ffd0d6"], life: 1.2, rot: -0.08 }));
  tapRing(ov, PX_HER, "watch", src - CUE.tapWatch);
  ov.push((c) => sfx(c, "TAP", MID[1] - 80, 170, 46, src - CUE.tapWatch, { burst: false, fill: ["#e9fbff", "#5aa8ff"], life: 0.7 }));
  ov.push(CARD(1));
  return { bloom: 0.3 };
});

// ===============================================================================================================
// 7f · three-shot. Dr Lim: "Good morning, Mr Tan. Please have a seat. Your daughter came with you today."
// He waves, offers the seat with an open hand, turns to her; she waves back. The first caption lands (+2.5)
// ===============================================================================================================
const aHello = takeWin("c07 hello", WIN.hello, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  const v = vAt(x, L.hello), capAt = CUE.capHello - WIN.hello.in, end = v + VOX[L.hello].dur;
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const offer = ease(seg(t, v + 0.8, v + 1.0)) * (1 - ease(seg(t, v + 1.65, v + 1.95)));
  seat("lim", { wave: t > v - 0.05 && t < v + 0.8 ? (t - v) * 1.4 : null, armR: lerp(0.3, 1.15, offer), armOutR: lerp(0.12, 0.75, offer),
    headYaw: kf(t, [[v + 1.6, -0.2], [v + 1.9, -0.42], [end + 0.3, -0.42], [end + 0.7, -0.25]]), headPitch: nodTalk(L.hello, T),
    face: face(t, [[0, "code"], [v, "happy"]], 7), squash: breathe(t, 7) + sqTalk(L.hello, T), tilt: sway(t, 7) });
  seat("tan", { wave: t > v + 0.7 && t < v + 1.7 ? (t - v) * 1.3 : null, headYaw: 0.15, headPitch: t > capAt ? 0.3 : 0,
    face: face(t, [[0, "code"], [v + 0.6, "happy"], [capAt + 0.1, "wow"]], 3), ear: seg(t, capAt, capAt + 0.2), squash: breathe(t, 3) + land(t, capAt + 0.05, 0.15) });
  // "Your daughter came with you today": she perks up and waves with her free right hand
  const wv = t > v + 1.9 && t < v + 2.9;
  weiSeat(t, { wave: wv ? (t - v) * 1.5 : null, headPitch: t > capAt + 0.3 ? 0.32 : 0.1, headYaw: t > capAt + 0.3 ? 0.25 : 0.55,
    face: face(t, [[0, "happy"], [v + 1.85, "love"], [capAt + 0.4, "wow"]], 6), ear: seg(t, v + 1.85, v + 2.05), squash: breathe(t, 6) + land(t, v + 1.9, 0.18) });
  tube();
  camAt(CAM.three, lt, dur, 0.06);
  line(x, L.hello, LIM, { above: 170 });
  blip(ov, src - CUE.capHello);
  ov.push(CARD(1));
});
cue(L.hello, aHello + VSRC.hello - WIN.hello.in);

// ===============================================================================================================
// 7g · 152/94. The live summary enlarges by itself (ZOOM!); Dr Lim picks up the cuff (RRRIP)
// ===============================================================================================================
takeWin("c07 cuff", WIN.cuff, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt);
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const grab = 0.95;
  // he reaches behind the BP monitor, takes the cuff and holds it up beside his head, where we can see it
  const reach = kf(t, [[0.2, 0.25], [0.45, 0.05], [grab, 1.45], [grab + 0.12, 1.45], [grab + 0.5, 2.35], [grab + 0.62, 2.25], [2.28, 2.2]]);
  seat("lim", { lean: kf(t, [[0.2, 0], [0.45, -0.06], [grab, 0.28], [grab + 0.5, 0.05]]), armR: reach, armOutR: kf(t, [[grab + 0.12, 0.1], [grab + 0.5, 0.5]]), armL: kf(t, [[grab + 0.3, 0.3], [grab + 0.7, 1.1]]),
    headYaw: kf(t, [[0, -0.2], [grab, 0.1], [grab + 0.6, -0.35]]), headPitch: 0.12, face: face(t, [[0, "code"], [grab + 0.5, "happy"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) });
  // his hand lands on the cuff, slides it off the desk into his grip and lifts it (true size: v1 held it at 1.25x)
  if (t >= grab) {
    LIM.hands[1].updateWorldMatrix(true, false);
    const handM = new THREE.Matrix4().multiplyMatrices(LIM.hands[1].matrixWorld, new THREE.Matrix4().compose(new THREE.Vector3(0, -0.07, 0.05), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1)));
    const restM = placeM(room.userData.cuffRest.pos.toArray(), [0, room.userData.cuffRest.rotY, 0], 1);
    setM(cuff, blendM(restM, handM, ease(seg(t, grab, grab + 0.2))));
  }
  seat("tan", { headYaw: 0.2, face: face(t, [[0, "code"], [grab + 0.6, "worry"]], 3), squash: breathe(t, 3) });
  weiSeat(t, { headPitch: 0.3, headYaw: 0.25, face: face(t, [[0, "code"]], 6) });
  tube();
  camAt(CAM.limCuff, lt, dur, 0.08);
  zoom(ov, src - Math.max(CUE.zoom1, WIN.cuff.in)); // the window opens on the enlarged summary: ZOOM! on the cut
  const cp = objScr(cuff);
  ov.push((c) => sfx(c, "RRRIP!", clamp(cp.x - 60, MID[0] + 110, MID[1] - 110), cp.y - 140, 60, t - grab - 0.1, { burst: false, fill: ["#ffffff", "#8fb0ff"], rot: -0.15, life: 0.9 }));
  ov.push(CARD(1));
});

// 7h · the cuff is on his arm; Dr Lim starts the monitor (PSSSHH) and says "Let me check your blood pressure."; the
// reading lands in the pause between his two sentences (BEEP: 152/94) and he reads it out: "It is 152 over 94, higher
// than last time." The first caption lands before the cut (+2.3)
const aSq = takeWin("c07 squeeze", WIN.squeeze, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const v = vAt(x, L.bp), pump = 0.3, beep = v + 1.6; // 1.51-1.84: the pause between his sentences
  const inflate = ease(seg(t, pump, beep - 0.1)) * (1 - ease(seg(t, beep, beep + 0.35)));
  seat("tan", { armR: 1.3, armOutR: -0.05, lean: 0.06 - 0.06 * seg(t, beep, beep + 0.12), headYaw: kf(t, [[0, 0.35], [beep - 0.2, 0.1]]), headPitch: 0.15,
    face: face(t, [[0, "code"], [pump + 0.3, "worry"], [beep, "wow"]], 3), squash: breathe(t, 3) + inflate * 0.1 - (t > beep && t < beep + 0.2 ? 0.15 : 0), ear: 1 - seg(t, beep, beep + 0.2) });
  cuff.userData.wrap(true);
  stick(cuff, TAN.arms[0], [0, -0.13, 0], [0, 0, 0], 1);
  cuff.matrix.multiply(_m.makeScale(1 + inflate * 0.28, 1, 1 + inflate * 0.28));
  // his right hand presses start on the monitor, then both hands steady the cuff while he talks; on the beep he reads it
  seat("lim", { lean: 0.22, armR: kf(t, [[0, 0.9], [pump - 0.12, 1.4], [pump + 0.2, 1.2]]), armL: 1.15, headYaw: kf(t, [[0, -0.25], [beep - 0.15, 0.05], [beep + 0.5, 0.05], [beep + 0.8, -0.25]]),
    headPitch: 0.15 + nodTalk(L.bp, T), face: face(t, [[0, "happy"], [pump, "code"], [beep + 0.1, "think"]], 7), squash: breathe(t, 7) + sqTalk(L.bp, T) });
  weiSeat(t, { headPitch: 0.15, headYaw: 0.4, face: face(t, [[0, "code"], [beep + 0.15, "wow"]], 6) });
  bp.userData.setBP(t >= beep ? "152" : t > pump ? String(Math.floor(inflate * 165)) : "", t >= beep ? "94" : "");
  tube();
  const punch = t >= beep && t < beep + 0.15 ? 3 : 0;
  camAt({ ...CAM.bp, fov: CAM.bp.fov - punch }, lt, dur, 0.07);
  line(x, L.bp, LIM, { above: 150 });
  const cp = objScr(cuff), lp = objScr(bp, [0, 0.16, 0]);
  ov.push((c) => sfx(c, "PSSSHH", cp.x - 20, cp.y - 110, 60, t - pump - 0.05, { burst: false, fill: ["#e8f4ff", "#7fb0ff"], rot: -0.1, life: 1.4 }));
  midFlash(ov, t - beep + 0.07, "#d8ffd8");
  ov.push((c) => sfx(c, "BEEP!", clamp(lp.x - 170, MID[0] + 110, MID[1] - 110), lp.y + 90, 66, t - beep, { burst: "#9fffb0", dots: "rgba(47,158,106,.35)", fill: ["#ffffff", "#c9ffd8"], life: 0.8, rot: -0.08 }));
  blip(ov, src - CUE.capCheck);
  ov.push(CARD(1));
});
cue(L.bp, aSq + VSRC.bp - WIN.squeeze.in);

// 7i · tight on the monitor (152/94), pulling back to the two of them: "...higher than last time." His visor: !?
// The second caption lands (a forward jump in the recording on the cut, so it lands as he finishes, +5.0)
takeWin("c07 reading", WIN.reading, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const v = vAt(x, L.bp), shock = v + 4.05, end = v + VOX[L.bp].dur; // "higher" at 4.04
  bp.userData.setBP("152", "94", true);
  cuff.userData.wrap(true);
  stick(cuff, TAN.arms[0], [0, -0.13, 0]);
  seat("tan", { armR: 1.3, armOutR: -0.05, lean: 0.06 - 0.08 * seg(t, shock, shock + 0.15), headYaw: kf(t, [[0, 0.1], [0.5, 0.2]]), headPitch: 0.2,
    face: face(t, [[0, "wow"], [shock + 0.5, "worry"]], 3), squash: breathe(t, 3) - 0.18 * (t > shock && t < shock + 0.25 ? 1 : 0), ear: 0 });
  seat("lim", { lean: 0.15, armR: 0.9, headYaw: kf(t, [[0, 0.1], [0.5, -0.3]]), headPitch: 0.08 + nodTalk(L.bp, T), face: face(t, [[0, "code"], [end, "think"]], 7), squash: breathe(t, 7) + sqTalk(L.bp, T) });
  weiSeat(t, { headPitch: 0.1, headYaw: 0.45, face: face(t, [[0, "wow"], [shock + 0.2, "worry"]], 6) });
  tube();
  // starts tight on the LCD, then pulls back to the two of them
  const k = ease(seg(lt, 0.25, 1.0)), d = seg(lt, 1.0, dur);
  const lcd = { pos: [0.18, 0.8, -0.42], tgt: [-0.05, 0.69, -0.9] };
  const P = lcd.pos.map((q, i) => lerp(q, CAM.bp.pos[i], k)), Tg = lcd.tgt.map((q, i) => lerp(q, CAM.bp.tgt[i], k));
  cam([P[0], P[1], P[2] - d * 0.08], Tg, lerp(34, 40, k));
  const h = headScr(TAN, 0.2);
  line(x, L.bp, LIM, { above: 150 });
  ov.push((c) => sfx(c, "!?", h.x - 40, h.y - 150, 70, t - shock, { burst: "#c9b6ff", dots: "rgba(155,107,255,.35)", life: 0.9 }));
  blip(ov, src - CUE.capBP);
  ov.push(CARD(1));
});

// ===============================================================================================================
// 7j · Sunday. ZOOM! He says he never forgets: "医生，amlodipine 我每天早上都有吃，没有忘记。" (a pat on his chest; the
// summary shrinks onto his line, +2.9) ...
// ===============================================================================================================
const aProud = takeWin("c07 proud", WIN.proud, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const v = vAt(x, L.amlo);
  // "医生" he turns to Dr Lim; "amlodipine" a finger up; "我每天早上都有吃" pats his chest, chin rising
  const up = ease(seg(t, v + 0.4, v + 0.6)) * (1 - ease(seg(t, v + 1.5, v + 1.7)));
  const pat = seg(t, v + 1.75, v + 3.2), patting = pat > 0 && pat < 1 ? Math.abs(Math.sin(pat * Math.PI * 4)) * 0.15 : 0;
  const onChest = ease(seg(t, v + 1.6, v + 1.8)), chin = ease(seg(t, v + 2.6, v + 3.4));
  seat("tan", { armR: lerp(0.2, 2.5, up) + onChest * 1.0 + patting, armOutR: lerp(0.12, 0.2, up) - onChest * 0.75,
    headYaw: kf(t, [[v - 0.2, 0.15], [v + 0.2, 0.32]]), headPitch: -0.18 * chin + nodTalk(L.amlo, T), face: face(t, [[0, "code"], [v + 0.4, "happy"]], 3),
    squash: breathe(t, 3) + sqTalk(L.amlo, T) - 0.08 * chin, ear: chin, tilt: sway(t, 3) });
  weiSeat(t, { headPitch: 0.1, headYaw: 0.45, face: face(t, [[0, "code"], [v + 2.2, "think"]], 6) });
  seat("lim", { headYaw: -0.3, face: face(t, [[0, "code"], [v + 1.0, "happy"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) });
  tube();
  camAt(CAM.tan, lt, dur, 0.07);
  zoom(ov, src - CUE.zoom2);
  line(x, L.amlo, TAN, { above: 170 });
  blip(ov, src - CUE.capHis);
  ov.push(CARD(1));
});
cue(L.amlo, aProud + VSRC.amlo - WIN.proud.in);
// Wei Ling cuts in 0.3 s after he finishes; the panels come back with her caption 2.6 s into her line
cue(L.sunday, VO[L.amlo] + VOX[L.amlo].dur + 0.3);

// ... full frame, no panels (the recording waits on the frame they left): "没有忘记!" chest out (HMPH!), and Wei Ling turns
// on him with a wagging finger: "Dad, you missed it on Sunday, remember?" (TSK TSK); his puff goes flat
const SUN_CAP = 2.6; // her caption lands this long after she starts, so the panels return SUN_CAP - (63.77 - 63.42) s into her line
take("c07 busted", snap(VO[L.sunday] + SUN_CAP - (CUE.capSunday - WIN.sunday.in)) - CUR, (x) => {
  const { lt, ov, dur, wait } = x, t = twos(lt), T = x.t;
  roomDefaults();
  wait(frame(HIS, WIN.proud.out).then((i) => tanPhone.userData.setScreen(i)));
  wait(frame(HER, WIN.proud.out).then((i) => weiPhone.userData.setScreen(i)));
  phoneOnDesk(0, blinkRec(lt));
  const va = vAt(x, L.amlo), vw = vAt(x, L.sunday);
  // his boast: "没有忘记" (3.56-4.48) chest out, arms out, chin up; deflates when she says "Sunday" (1.2)
  const puff = ease(seg(t, va + 3.5, va + 3.75)) * (1 - ease(seg(t, vw + 1.15, vw + 1.45)));
  seat("tan", { lean: -0.2 * puff, armOutL: lerp(0.1, 0.75, puff), armOutR: lerp(0.1, 0.75, puff), armL: -0.35 * puff, armR: -0.35 * puff,
    headYaw: kf(t, [[vw - 0.2, 0.2], [vw + 0.2, -0.45]]), headPitch: -0.2 * puff + nodTalk(L.amlo, T) + 0.15 * seg(t, vw + 1.2, vw + 1.5),
    face: face(t, [[0, "happy"], [vw + 1.25, "wow"], [vw + 1.9, "worry"]], 3), ear: puff, squash: breathe(t, 3) + sqTalk(L.amlo, T) - 0.18 * puff + (t > va + 3.3 && t < va + 3.5 ? 0.12 : 0), tilt: sway(t, 3) });
  // she turns to him and wags her free right hand (her phone stays in her left)
  const wag = t > vw + 0.25 ? wob(t, 2.6) * 0.18 : 0;
  weiSeat(t, { armR: kf(t, [[vw - 0.1, 0.25], [vw + 0.2, 1.75]]) + wag, armOutR: kf(t, [[vw - 0.1, 0.12], [vw + 0.2, 0.35]]), headYaw: kf(t, [[vw - 0.4, 0.1], [vw, 0.5]]), lean: 0.1 * seg(t, vw - 0.2, vw + 0.2),
    headPitch: nodTalk(L.sunday, T), tilt: -0.1 * seg(t, vw, vw + 0.3) + sway(t, 6), face: face(t, [[0, "think"], [vw, "code"]], 6), squash: breathe(t, 6) + sqTalk(L.sunday, T) });
  seat("lim", { headYaw: -0.3, face: face(t, [[0, "happy"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) });
  tube();
  camAt(CAM.wide2, lt, dur, 0.08, 0.06);
  const ht = headScr(TAN, 0.1), hw = headScr(WEI, 0.1);
  line(x, L.amlo, TAN, { full: true, above: 150 });
  line(x, L.sunday, WEI, { full: true, above: 150 });
  ov.push((c) => sfx(c, "HMPH!", ht.x + 230, ht.y + 150, 64, t - va - 3.6, { burst: false, fill: ["#fff6c4", "#ff9a2e"], rot: 0.12, life: 1.0 }));
  ov.push((c) => sfx(c, "TSK TSK", hw.x - 260, hw.y + 170, 56, t - vw - 0.6, { burst: false, fill: ["#ffffff", "#ff8fb0"], rot: -0.1, life: 1.1 }));
  ov.push(CARD(1));
  return { bloom: 0.45 };
});

// ... the panels are back on the frame they left: her caption lands (+2.6); "You went to the market early."
takeWin("c07 sunday", WIN.sunday, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  const vw = vAt(x, L.sunday), mk = vw + 2.3, end = vw + VOX[L.sunday].dur;
  const wag = t < mk ? wob(t, 2.6) * 0.18 : 0, point = ease(seg(t, mk, mk + 0.25)) * (1 - ease(seg(t, end, end + 0.3)));
  // the finger wag, then a point out of the door ("the market") with her right hand
  weiSeat(t, { armR: lerp(1.75 + wag, 1.35, point), armOutR: lerp(0.35, 1.1, point), headYaw: kf(t, [[mk, -0.2], [mk + 0.3, 0.1], [end, 0.1], [end + 0.3, -0.15]]),
    headPitch: nodTalk(L.sunday, T), tilt: 0.1 + sway(t, 6), face: face(t, [[0, "code"], [end + 0.1, "happy"]], 6), squash: breathe(t, 6) + sqTalk(L.sunday, T) });
  seat("tan", { headYaw: 0.75, headPitch: 0.15, face: face(t, [[0, "worry"], [mk + 0.2, "wow"]], 3), squash: breathe(t, 3) - (t > mk + 0.2 && t < mk + 0.4 ? 0.12 : 0), tilt: sway(t, 3) });
  seat("lim", { headYaw: -0.3, face: face(t, [[0, "happy"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) });
  phoneOnDesk(0, blinkRec(lt));
  tube();
  camAt(CAM.wei, lt, dur, 0.08);
  line(x, L.sunday, WEI, { above: 170 });
  blip(ov, src - CUE.capSunday);
  ov.push(CARD(1));
});

takeWin("c07 sheepish", WIN.sheepish, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt);
  roomDefaults();
  phones(x, src);
  // blink, blink, then a sheepish grin with his hand behind his head
  const f = t < 0.12 ? "wow" : t < 0.2 ? "blink" : t < 0.32 ? "code" : t < 0.4 ? "blink" : t < 0.5 ? "code" : t < 0.58 ? "blink" : "happy";
  const sc = ease(seg(t, 0.55, 0.85));
  seat("tan", { headPitch: 0.22 * sc, tilt: -0.22 * sc + wob(t, 1.4) * 0.03 * sc, headYaw: -0.15, armR: lerp(0.2, 2.75, sc) + wob(t, 3) * 0.12 * sc, armOutR: 0.45 * sc,
    face: f, squash: breathe(t, 3) + (t > 0.55 && t < 0.75 ? 0.08 : 0), ear: 1 - sc });
  weiSeat(t, { headYaw: 0.4, face: face(t, [[0, "happy"]], 6) });
  seat("lim", { headYaw: -0.3, face: face(t, [[0, "happy"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) });
  phoneOnDesk(0, blinkRec(lt));
  tube();
  camAt(CAM.tanClose, lt, dur, 0.1);
  const h = headScr(TAN, 0.1);
  ov.push((c) => sfx(c, "blink blink", h.x + 210, h.y - 170, 44, t - 0.12, { burst: false, fill: ["#ffffff", "#9b6bff"], rot: 0.08, life: 1.0 }));
  ov.push((c) => sfx(c, "heh…", h.x - 300, h.y + 230, 50, t - 0.9, { burst: false, fill: ["#fff6c4", "#ff9a2e"], rot: -0.08, life: 1.0 }));
  blip(ov, src - CUE.capMarket);
  ov.push(CARD(1));
});

// ===============================================================================================================
// 7k · 10 mg. Dr Lim, a finger up: "Mr Tan, we will increase the amlodipine to 10 milligrams every morning." The
// summary shrinks onto the caption (+3.0); NOD NOD; he types it in (TAP TAP)
// ===============================================================================================================
const aTen = takeWin("c07 ten", WIN.ten, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const v = vAt(x, L.ten), up = ease(seg(t, v + 0.05, v + 0.3)) * (1 - ease(seg(t, v + 1.9, v + 2.2)));
  seat("lim", { lean: 0.12 + 0.06 * up, armR: lerp(0.3, 2.6, up), armOutR: 0.15, headYaw: kf(t, [[v - 0.3, -0.1], [v, -0.38]]), headPitch: nodTalk(L.ten, T),
    face: face(t, [[0, "code"], [v + 0.1, "happy"], [v + 1.3, "code"]], 7), squash: breathe(t, 7) + sqTalk(L.ten, T) + (t > v && t < v + 0.12 ? 0.1 : 0), tilt: sway(t, 7) });
  seat("tan", { headYaw: 0.25, headPitch: 0.05, face: face(t, [[0, "code"], [v + 0.4, "think"]], 3), ear: seg(t, v, v + 0.3), squash: breathe(t, 3), tilt: sway(t, 3) });
  weiSeat(t, { headYaw: 0.4, face: face(t, [[0, "code"]], 6) });
  tube();
  camAt(CAM.lim, lt, dur, 0.09, -0.05);
  line(x, L.ten, LIM, { above: 170 });
  ov.push(CARD(1));
});
cue(L.ten, aTen + VSRC.ten - WIN.ten.in);

takeWin("c07 ten nod", WIN.tenNod, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const v = vAt(x, L.ten), end = v + VOX[L.ten].dur, capAt = CUE.showTen - WIN.tenNod.in, nodT = capAt + 0.3, type = end + 0.1;
  const nod = t > nodT && t < nodT + 0.7 ? Math.abs(Math.sin(((t - nodT) / 0.7) * Math.PI * 2)) * 0.3 : 0;
  seat("tan", { headPitch: nod, headYaw: 0.2, face: face(t, [[0, "think"], [nodT + 0.75, "happy"]], 3), squash: breathe(t, 3), tilt: sway(t, 3) });
  weiSeat(t, { armR: kf(t, [[nodT + 0.2, 0.25], [nodT + 0.45, 2.4]]) + (t > nodT + 0.45 ? wob(t, 2.2) * 0.08 : 0), armOutR: 0.2, headPitch: 0.1 + nod * 0.6, headYaw: 0.3,
    face: face(t, [[0, "code"], [nodT + 0.3, "happy"]], 6) });
  // he talks on to the end of the line, then turns to his keyboard and types it in
  const typing = t > type ? (Math.floor(t * 7.5) % 2 ? 0.15 : 0) : 0, kbd = ease(seg(t, type - 0.15, type + 0.1));
  seat("lim", { lean: 0.1 + 0.08 * kbd, armR: lerp(0.4, 1.0 + typing, kbd), armL: lerp(0.3, 1.0 + (0.15 - typing), kbd), headYaw: lerp(-0.25, 0.2, kbd), headPitch: nodTalk(L.ten, T) + 0.2 * kbd,
    face: face(t, [[0, "code"], [end, "happy"]], 7), squash: breathe(t, 7) + sqTalk(L.ten, T), tilt: sway(t, 7) });
  tube();
  camAt(CAM.three, lt, dur, 0.07, 0.08);
  line(x, L.ten, LIM, { above: 170 });
  const h = headScr(TAN, 0.1), kb = toScr(new THREE.Vector3(0.46, TOP, -1.07));
  ov.push((c) => sfx(c, "NOD NOD", h.x - 150, h.y - 140, 50, t - nodT, { burst: false, fill: ["#ffffff", "#9b6bff"], rot: -0.1, life: 1.0 }));
  ov.push((c) => sfx(c, "TAP TAP", clamp(kb.x + 120, MID[0] + 110, MID[1] - 110), kb.y + 20, 48, t - type - 0.1, { burst: false, fill: ["#e9fbff", "#5aa8ff"], rot: -0.08, life: 1.0 }));
  blip(ov, src - CUE.showTen);
  ov.push(CARD(1));
});

// ===============================================================================================================
// 7l · the morning's question: "医生，我打太极的早上没吃早餐，血压就比较高，要怎么安排？" He mimes tai chi, pats his empty tummy
// (GRRUMBLE), points at the monitor and shrugs (?). The summary shrinks and his question lands (+3.0)
// ===============================================================================================================
const aAsk = takeWin("c07 ask", WIN.ask, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const v = vAt(x, L.taichi);
  // "医生" (0-0.3) a hand up to Dr Lim; "我打太极的" (0.4-2.0) arms float up and sink; "早上没吃早餐" (2.0-3.3) pats his tummy
  const m = t - v;
  const rise = kf(m, [[0.35, 0.3], [1.1, 1.75], [1.35, 1.7], [1.85, 0.35]]), sink = m > 1.35 && m < 1.9 ? Math.sin(((m - 1.35) / 0.55) * Math.PI) * 0.18 : 0;
  const pat = seg(m, 2.0, 3.2), patting = pat > 0 && pat < 1 ? Math.abs(Math.sin(pat * Math.PI * 3)) * 0.25 : 0;
  const mime = m > 0.35 && m < 1.95;
  seat("tan", { armL: mime ? rise : m > 1.95 ? 0.45 + patting : 0.2, armR: mime ? rise : m > 1.95 ? 0.45 + patting * 0.6 : m > -0.1 && m < 0.4 ? 1.2 : 0.2,
    armOutL: mime ? 0.25 : 0.05, armOutR: mime ? 0.25 : 0.05, lean: m > 2.0 && m < 3.3 ? 0.12 : 0, headPitch: (m > 2.0 && m < 3.3 ? 0.25 : -0.05) + nodTalk(L.taichi, T), headYaw: 0.2,
    face: face(t, [[0, "code"], [v, "happy"], [v + 2.0, "worry"]], 3), squash: breathe(t, 3) + sink + sqTalk(L.taichi, T), tilt: sway(t, 3) });
  weiSeat(t, { headYaw: 0.5, face: face(t, [[0, "code"], [v + 1.0, "happy"]], 6) });
  seat("lim", { headYaw: -0.3, face: face(t, [[0, "code"], [v + 2.2, "think"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) });
  tube();
  camAt(CAM.tan, lt, dur, 0.08);
  const h = headScr(TAN, 0.1);
  line(x, L.taichi, TAN, { above: 180 });
  blip(ov, src - CUE.capAsk);
  ov.push((c) => sfx(c, "whoosh~", h.x + 260, h.y + 40, 46, m - 0.6, { burst: false, fill: ["#e9fbff", "#7fd8c0"], rot: -0.1, life: 0.9 }));
  ov.push((c) => sfx(c, "GRRUMBLE", h.x - 40, h.y + 300, 50, m - 2.2, { burst: false, fill: ["#fff6c4", "#ff9a2e"], rot: -0.06, life: 1.0 }));
  ov.push(CARD(1));
});
cue(L.taichi, aAsk + VSRC.taichi - WIN.ask.in);

takeWin("c07 ask more", WIN.ask2, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const v = vAt(x, L.taichi), m = t - v, end = v + VOX[L.taichi].dur;
  // "血压就比较高" (3.4-5.1) points at the monitor; "要怎么安排？" (5.2-6.4) a shrug, palms up
  const point = ease(seg(m, 3.3, 3.55)) * (1 - ease(seg(m, 4.95, 5.15))), shrug = ease(seg(m, 5.2, 5.45)) * (1 - ease(seg(m, 6.7, 7.0)));
  seat("tan", { armR: lerp(0.25, 1.35, point) + 0.45 * shrug, armOutR: lerp(0.1, -0.35, point) + 0.6 * shrug, armL: 0.45 * shrug + 0.2, armOutL: 0.1 + 0.6 * shrug,
    lean: 0.05 * point, headYaw: 0.2, headPitch: nodTalk(L.taichi, T) + 0.1 * point, tilt: 0.16 * shrug + sway(t, 3),
    face: face(t, [[0, "worry"], [v + 5.2, "think"]], 3), squash: breathe(t, 3) + sqTalk(L.taichi, T) - 0.08 * shrug });
  weiSeat(t, { headYaw: 0.45, headPitch: 0.1, face: face(t, [[0, "happy"], [v + 3.5, "code"]], 6) });
  // Dr Lim listens, leaning in with small nods; when the question ends he has the answer
  const ln = t > v + 3.6 && t < end ? Math.abs(Math.sin(t * 2.6)) * 0.06 : 0;
  seat("lim", { lean: 0.12, headYaw: -0.3, headPitch: 0.05 + ln, face: face(t, [[0, "think"], [end - 0.1, "happy"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) });
  tube();
  camAt(CAM.pair, lt, dur, 0.07, -0.05);
  const h = headScr(TAN, 0.1);
  line(x, L.taichi, TAN, { above: 180 });
  ov.push((c) => sfx(c, "?", h.x - 190, h.y - 60, 80, m - 5.6, { burst: false, fill: ["#ffffff", "#ffd94a"], life: 1.1 }));
  ov.push(CARD(1));
});

// ===============================================================================================================
// 7m · Dr Lim's answer: "On tai chi mornings, have a small breakfast first, then rest five minutes before you measure.
// Write it down and show me in two weeks." A bite, five minutes (a flat hand), writing; AH! Both captions land
// ===============================================================================================================
const aAns = takeWin("c07 answer", WIN.answer, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const v = vAt(x, L.answer), m = t - v;
  // "On tai chi mornings" (0.4-1.2): a slow tai chi sweep; "have a small breakfast first" (1.4-3.1): a small bite
  const sweep = m > 0.3 && m < 1.3 ? Math.sin(((m - 0.3) / 1.0) * Math.PI) : 0, bite = seg(m, 1.5, 2.9);
  seat("lim", { lean: 0.12, armR: bite > 0 && bite < 1 ? 2.15 + Math.abs(Math.sin(bite * Math.PI * 3)) * 0.15 : 0.4 + sweep * 1.3, armOutR: 0.2 + sweep * 0.4,
    armL: 0.3, headPitch: nodTalk(L.answer, T), headYaw: -0.3, face: face(t, [[0, "code"], [v + 0.3, "happy"]], 7), squash: breathe(t, 7) + sqTalk(L.answer, T), tilt: sway(t, 7) });
  seat("tan", { headYaw: 0.25, face: face(t, [[0, "think"]], 3), squash: breathe(t, 3), tilt: sway(t, 3) });
  weiSeat(t, { headYaw: 0.4, face: face(t, [[0, "code"]], 6) });
  tube();
  camAt(CAM.lim, lt, dur, 0.08, 0.05);
  line(x, L.answer, LIM, { above: 170 });
  ov.push((c) => sfx(c, "nom", headScr(LIM, 0.1).x + 170, headScr(LIM, 0.1).y + 60, 44, m - 1.65, { burst: false, fill: ["#fff6c4", "#ff9a2e"], rot: 0.1, life: 0.8 }));
  ov.push(CARD(1));
});
cue(L.answer, aAns + VSRC.answer - WIN.answer.in);

takeWin("c07 answer five", WIN.answer2, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const v = vAt(x, L.answer), m = t - v, ah = v + 5.6;
  // "then rest five minutes" (3.4-4.5): a flat hand up, then down (calm); "Write it down" (6.15): he mimes writing
  const five = ease(seg(m, 3.4, 3.6)) * (1 - ease(seg(m, 4.6, 4.8))), calm = ease(seg(m, 4.7, 4.9)) * (1 - ease(seg(m, 5.5, 5.7)));
  const write = m > 6.1 ? 1 : 0, scrib = write ? (Math.floor(t * 7.5) % 2) * 0.12 : 0;
  seat("lim", { lean: 0.12, armR: 0.4 + five * 2.4 + calm * 0.8 + write * (0.85 + scrib), armOutR: 0.2 + five * 0.1 + calm * 0.3, armL: 0.3,
    headPitch: nodTalk(L.answer, T) + 0.1 * write, headYaw: -0.3, face: face(t, [[0, "happy"], [v + 3.4, "code"], [v + 5.6, "happy"]], 7), squash: breathe(t, 7) + sqTalk(L.answer, T), tilt: sway(t, 7) });
  seat("tan", { headYaw: 0.25, headPitch: t > ah && t < ah + 0.25 ? -0.15 : 0, face: face(t, [[0, "think"], [ah, "wow"], [ah + 0.4, "happy"]], 3), ear: seg(t, ah, ah + 0.15),
    squash: breathe(t, 3) - (t > ah && t < ah + 0.2 ? 0.2 : 0) });
  weiSeat(t, { headYaw: 0.4, headPitch: t > ah + 0.3 ? 0.3 : 0.1, face: face(t, [[0, "code"], [ah + 0.2, "happy"]], 6) });
  tube();
  camAt(CAM.pair, lt, dur, 0.07, -0.06);
  const ht = headScr(TAN, 0.1);
  line(x, L.answer, LIM, { above: 170 });
  blip(ov, src - CUE.capAnswer);
  ov.push((c) => sfx(c, "AH!", ht.x - 120, ht.y - 130, 84, t - ah, { burst: "#fff3a0", dots: "rgba(255,154,46,.35)", life: 0.9 }));
  ov.push(CARD(1));
});

takeWin("c07 answer weeks", WIN.answer3, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt), T = x.t;
  roomDefaults();
  phones(x, src);
  phoneOnDesk(0, blinkRec(lt));
  const v = vAt(x, L.answer), m = t - v, end = v + VOX[L.answer].dur;
  // "and show me" (6.5-7.1): a point at Mr Tan; "in two weeks" (7.1-8.2) a nod; then Mr Tan nods back
  const point = ease(seg(m, 6.45, 6.65)) * (1 - ease(seg(m, 7.6, 7.9)));
  seat("lim", { lean: 0.12, armR: 0.4 + point * 1.1, armOutR: 0.2 - point * 0.3, armL: 0.3, headPitch: nodTalk(L.answer, T), headYaw: -0.32,
    face: face(t, [[0, "happy"]], 7), squash: breathe(t, 7) + sqTalk(L.answer, T), tilt: sway(t, 7) });
  const nodT = end + 0.05, nod = t > nodT && t < nodT + 0.55 ? Math.abs(Math.sin(((t - nodT) / 0.55) * Math.PI * 2)) * 0.26 : 0;
  seat("tan", { headYaw: 0.3, headPitch: nod, face: face(t, [[0, "happy"]], 3), ear: 1, squash: breathe(t, 3), tilt: sway(t, 3) });
  weiSeat(t, { headYaw: 0.35, headPitch: 0.25, face: face(t, [[0, "happy"], [end, "love"]], 6) });
  tube();
  camAt(CAM.three, lt, dur, 0.06, 0.06);
  const ht = headScr(TAN, 0.1);
  line(x, L.answer, LIM, { above: 170 });
  blip(ov, src - CUE.capWrite);
  ov.push((c) => sfx(c, "NOD NOD", ht.x - 150, ht.y - 140, 46, t - nodT, { burst: false, fill: ["#ffffff", "#9b6bff"], rot: -0.1, life: 0.9 }));
  ov.push(CARD(1));
});

// ===============================================================================================================
// 7n · Finished (CLICK); the review: Ripple's summary, "Did the doctor say this?" → "Yes, the doctor did" (CLICK)
// ===============================================================================================================
takeWin("c07 finished", WIN.finish, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt);
  roomDefaults();
  const tapF = CUE.tapFinished - WIN.finish.in, pick = tapF + 0.3;
  phones(x, src);
  // his left hand comes to the phone on the desk, taps Finished, and lifts it to read (the pick-up runs over the cut)
  const up = ease(seg(t, pick, pick + 0.35));
  const nodR = t > 1.3 && t < 2.1 ? Math.abs(Math.sin(((t - 1.3) / 0.8) * Math.PI * 2)) * 0.18 : 0;
  const reachA = kf(t, [[0, 0.45], [tapF - 0.6, 0.55], [tapF - 0.2, TAN_DESK.a + 0.12], [tapF, TAN_DESK.a], [tapF + 0.15, TAN_DESK.a + 0.06], [pick, TAN_DESK.a]]);
  const reachO = kf(t, [[tapF - 0.6, 0.1], [tapF - 0.2, TAN_DESK.out]]);
  const A = lerp(reachA, TAN_LOOK.a, up), O = lerp(reachO, TAN_LOOK.out, up);
  seat("tan", { lean: lerp(kf(t, [[0, 0.22], [tapF - 0.4, 0.22], [tapF - 0.1, 0.15]]), 0.05, up), ...armOf(0, A, O),
    headPitch: lerp(0.35, 0.3, up) + nodR, headYaw: 0.15, face: face(t, [[0, "wow"], [1.2, "happy"]], 3), ear: 1, squash: breathe(t, 3) + land(t, tapF, 0.1), tilt: sway(t, 3) });
  if (t < pick) phoneOnDesk(0, src < CUE.tapFinished && blinkRec(lt));
  else setM(tanPhone, blendM(deskM(0), gripM(new THREE.Matrix4(), TAN, 0, A, O, TAN_LOOK.yaw, TAN_LOOK.pitch), up));
  weiSeat(t, { headPitch: 0.3, headYaw: 0.25, face: face(t, [[0, "wow"], [1.5, "love"]], 6), ear: 1 });
  seat("lim", { headYaw: -0.3, face: face(t, [[0, "happy"]], 7), squash: breathe(t, 7) });
  tube();
  camAt(orbit([-0.5, 0.8, -0.9], 0.5, 0.18, 2.5, 38), lt, dur, 0.08);
  zoom(ov, src - WIN.finish.in); // the window opens on the enlarged summary (it enlarged 0.33 s before): ZOOM! on the cut
  tapRing(ov, PX_HIS, "finished", src - CUE.tapFinished);
  midFlash(ov, src - CUE.tapFinished, "#fff3b0");
  ov.push((c) => sfx(c, "CLICK", MID[0] + 120, 820, 60, src - CUE.tapFinished - 0.07, { burst: "#ffffff", life: 0.8, rot: -0.1 }));
  ov.push(CARD(1));
});

takeWin("c07 confirm", WIN.review, (x) => {
  const { lt, ov, src, dur } = x, t = twos(lt);
  roomDefaults();
  phones(x, src);
  const yes = CUE.tapYes - WIN.review.in, look = 0.6, nodT = 0.95;
  const nod = t > nodT && t < nodT + 0.55 ? Math.abs(Math.sin(((t - nodT) / 0.55) * Math.PI * 2)) * 0.26 : 0;
  // he reads Ripple's summary on the phone in his left hand; his right hand taps "Yes, the doctor did"
  seat("tan", { ...armOf(0, TAN_LOOK.a, TAN_LOOK.out), armR: kf(t, [[yes - 0.35, 0.3], [yes - 0.05, 1.3], [yes + 0.1, 1.15], [yes + 0.4, 0.3]]), armOutR: kf(t, [[yes - 0.35, 0.15], [yes - 0.05, -0.6], [yes + 0.4, 0.15]]),
    headPitch: kf(t, [[0, 0.3], [look, 0.0], [yes - 0.4, 0.3]]), headYaw: kf(t, [[0, 0.1], [look, 0.45], [yes - 0.4, 0.1]]),
    face: face(t, [[0, "think"], [look, "code"], [yes + 0.15, "happy"]], 3), ear: seg(t, yes + 0.1, yes + 0.3), squash: breathe(t, 3) + land(t, yes, 0.12) });
  grip(tanPhone, TAN, 0, TAN_LOOK.a, TAN_LOOK.out, TAN_LOOK.yaw, TAN_LOOK.pitch);
  weiSeat(t, { lean: 0.15, headYaw: 0.7, headPitch: 0.15, face: face(t, [[0, "code"], [yes + 0.25, "love"]], 6) });
  seat("lim", { lean: 0.08, headPitch: nod, headYaw: -0.25, face: face(t, [[0, "code"], [nodT, "happy"]], 7), squash: breathe(t, 7), tilt: sway(t, 7) });
  tube();
  camAt(CAM.three, lt, dur, 0.08, -0.06);
  const hl = headScr(LIM, 0.1);
  ov.push((c) => sfx(c, "NOD", hl.x + 120, hl.y - 120, 50, t - nodT, { burst: false, fill: ["#ffffff", "#9b6bff"], rot: 0.1, life: 0.8 }));
  tapRing(ov, PX_HIS, "yes", src - CUE.tapYes);
  midFlash(ov, src - CUE.tapYes, "#fff3b0");
  ov.push((c) => sfx(c, "CLICK!", MID[0] + 130, 800, 66, src - CUE.tapYes - 0.07, { burst: "#ffffff", life: 0.9, rot: -0.1 }));
  ov.push(CARD(1));
});

// ===============================================================================================================
// 7o · the high-five (CLAP) into white: the hand-off to c08
// ===============================================================================================================
take("c07 high-five", 3.45, ({ lt, dur, ov, wait }) => {
  const t = twos(lt);
  roomDefaults();
  // no panels now, but the phones in their hands keep the same clock (his review, her ended visit)
  wait(frame(HIS, WIN.review.out + lt).then((i) => tanPhone.userData.setScreen(i)));
  wait(frame(HER, WIN.review.out + lt).then((i) => weiPhone.userData.setScreen(i)));
  const clap = dur - 1.45, off = 0.25, landT = 0.62, up = clap - 0.95;
  // hop down from the chair, turn half toward each other, cock the inner arm up and out, slap at chest height between them
  const hopDown = (name, to, rot, s0, A, O, extra) => {
    const S = SEAT[name], k = ease(seg(t, off, landT));
    const raise = ease(seg(t, up, up + 0.3)), swing = easeIn(seg(t, clap - 0.14, clap));
    const after = t > clap ? 0.12 * (1 - seg(t, clap, clap + 0.4)) : 0; // a little recoil
    const arm = t < up ? {} : { [A]: lerp(lerp(0.2, 2.7, raise), 1.25, swing) + after, [O]: lerp(lerp(0.15, 0.4, raise), 0.3, swing) };
    STAGE.pose(name, { x: lerp(S.x, to[0], k), z: lerp(S.z, to[1], k), rotY: lerp(S.rotY, rot, k), dy: lerp(S.dy, 0, k) + hop(t, off, landT, 0.22) + hop(t, clap - 0.05, clap + 0.35, 0.12),
      sit: 1 - k, ...extra, ...arm, squash: (t > off - 0.2 && t < off ? 0.2 : 0) + land(t, landT, 0.35) + (t > up + 0.3 && t < clap - 0.14 ? 0.12 : 0) + land(t, clap + 0.35, 0.25) + breathe(t, s0),
      face: face(t, [[0, "happy"], [clap + 0.03, "love"]], s0), ear: 1, tilt: sway(t, s0) });
  };
  // his phone stays in his left (outer) hand, lowered as he hops; he slaps with his right
  const hk = ease(seg(t, off, landT + 0.2));
  const tA = lerp(TAN_LOOK.a, 0.75, hk), tO = lerp(TAN_LOOK.out, 0.2, hk);
  hopDown("tan", [-0.48, -0.2], -0.95, 3, "armR", "armOutR", armOf(0, tA, tO));
  grip(tanPhone, TAN, 0, tA, tO, lerp(TAN_LOOK.yaw, 0.5, hk), lerp(TAN_LOOK.pitch, -0.2, hk)); // standing, its face half to us
  // hers is in her left (inner) hand: on the hop she passes it to her right, so the left is free for the slap
  const sw0 = 0.12, swap = 0.36, sw1 = 0.7, g = WEI_GRIP;
  const toMid = ease(seg(t, sw0, swap)), away = ease(seg(t, swap, sw1));
  const wL = t < swap ? [lerp(g.a, 1.4, toMid), lerp(g.out, -0.9, toMid)] : [lerp(1.4, 0.2, away), lerp(-0.9, 0.15, away)];
  const wR = t < swap ? [lerp(0.25, 1.4, toMid), lerp(0.12, -0.9, toMid)] : [lerp(1.4, 0.85, away), lerp(-0.9, 0.1, away)];
  hopDown("wei", [-1.38, -0.2], 0.95, 6, "armL", "armOutL", { ...armOf(0, ...wL), ...armOf(1, ...wR) });
  if (t < swap) grip(weiPhone, WEI, 0, ...wL, lerp(g.yaw, -0.68, toMid), lerp(g.pitch, -0.3, toMid)); // its face stays to us as it changes hands
  else grip(weiPhone, WEI, 1, ...wR, lerp(-0.68, -0.3, away), lerp(-0.3, -0.2, away));
  const cl = t > clap ? (Math.floor(t * 7.5) % 2) * 0.3 : 0;
  seat("lim", { face: face(t, [[0, "happy"]], 7), armL: t > clap ? 1.3 + cl : 0.3, armR: t > clap ? 1.6 - cl : 0.3, armOutL: 0.3, armOutR: 0.3, headYaw: -0.4, squash: breathe(t, 7) });
  tube();
  const k = easeOut(seg(lt, 0, dur)), punch = lt > clap && lt < clap + 0.15 ? 4 : 0;
  const C = orbit([-0.93, 0.66, -0.3], 0.1, 0.03, lerp(2.9, 2.5, k), 40 - punch);
  cam(C.pos, C.tgt, C.fov);
  const hm = (a, h) => { a.hands[h].updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(a.hands[h].matrixWorld); };
  const meet = toScr(hm(TAN, 1).add(hm(WEI, 0)).multiplyScalar(0.5)); // where the two hands meet
  ov.push(CARD(1));
  ov.push((c) => flashHit(c, lt - clap + 0.07, "#fff3b0", 2));
  ov.push((c) => sfx(c, "CLAP!", meet.x, meet.y + 150, 130, t - clap, { burst: "#ff6fb0", dots: "rgba(255,255,255,.35)", life: 1.4 }));
  // into white
  const white = easeIn(seg(lt, clap + 0.5, dur - 0.04));
  ov.push((c) => { if (white <= 0) return; c.save(); c.globalAlpha = Math.min(1, white); c.fillStyle = "#fffaf0"; c.fillRect(0, 0, 1920, 1080); c.restore(); });
  return { bloom: 0.6 + white * 0.8 };
});
/** the chapter's end (the source range is T0..T1) */
export const T1 = CUR;
