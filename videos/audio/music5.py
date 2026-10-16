# The v5 score: the same instruments and themes as music.py, re-laid on the v5 cut (edl-v5.json, 477.8 s):
#   agenda    0-7        3 bars of the explainer's light colour, F | Bb | C, landing on the story's F at 7.0
#   story     7-226.2    88 bars at 96.35 BPM (c07 grew to 30 bars); chapter moods on the bar line nearest each cut
#   explainer 226.2-318.8 39 bars at 101.1 BPM; the resolving chord on the EMPOWERING stamp (318.8), ringing to 320.8
#   sober     320.8-467.8 the unpulsed bed; chords change on the slide changes 328.3 ... 459.8
#   end card  467.8-477.8 the sting on its own downbeat
# music.py's own functions are re-used with their v5 timings substituted (music.py itself, and its v3 output, are not
# changed). Writes audio/stems-v5/music.wav and music-sections.json.
#   D:/AI/seed-vc/.venv/Scripts/python.exe audio/music5.py [--v6|--v7|--v8]   (the v6 / v7 / v8 cut, into audio/stems-v6/, -v7/ or -v8/)
import inspect, json, os, sys
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
# --v6: the v6 cut (edl-v6.json, 461.2 s; c10 B5 and c11 EXP 04 removed): the explainer ends on EXP. 03's SAFE stamp
V8 = "--v8" in sys.argv   # v8 = v7 with part 3's build slide 14 s long (part 3 to 466.7, c14 466.7-476.7)
V7 = "--v7" in sys.argv or V8
V6 = "--v6" in sys.argv or V7   # v7 = v6 up to 304.2 (the same explainer); only part 3 and the end card moved
PS_V5 = '[["Fadd9"], ["Am7"], ["Fmaj7", "Dm7"], ["Bbadd9", "Gm7", "Csus4"], ["Fadd9", "Am7"], ["Bbmaj7"], ["Fadd9", "Am7"], ["Bbmaj7"], ["Csus4"]]'
PS_V7 = '[["Fadd9"], ["Am7"], ["Fmaj7", "Dm7"], ["Bbadd9", "Gm7"], ["Fadd9", "Am7", "Dm7"], ["Bbmaj7", "Gm7"], ["Fadd9", "Am7"], ["Bbmaj7"], ["Gm7"], ["Csus4"]]'
CFG = {"N": 22934400, "out": "stems-v5", "ex_t1": 318.8, "ex_bars": 39, "c11_from": 21, "per_slide": PS_V5,
       "cuts": "[t0, 328.3, 340.3, 364.3, 397.8, 416.8, 430.8, 452.8, 459.8, t1]", "sober": (320.8, 467.8), "end": 477.8}
if V6: CFG.update({"N": 22137600, "out": "stems-v6", "ex_t1": 302.9, "ex_bars": 32, "c11_from": 17,
                   "cuts": "[t0, 311.7, 323.7, 347.7, 381.2, 400.2, 414.2, 436.2, 443.2, t1]", "sober": (304.2, 451.2), "end": 461.2})
if V7: CFG.update({"N": 22521600, "out": "stems-v7", "per_slide": PS_V7,
                   "cuts": "[t0, 311.7, 323.2, 340.7, 362.7, 394.2, 411.2, 428.2, 439.7, 446.2, t1]", "sober": (304.2, 459.2), "end": 469.2})
if V8: CFG.update({"N": 22881600, "out": "stems-v8",
                   "cuts": "[t0, 311.7, 323.2, 340.7, 362.7, 394.2, 411.2, 428.2, 439.7, 453.7, t1]", "sober": (304.2, 466.7), "end": 476.7})
N5 = CFG["N"]
common.total_samples = lambda: N5          # music.py sizes its buffers from this on import
import music as M
from common import SR, AUD, hp, peaking, make_ir, reverb, compress, n_
assert M.N == N5 and len(M.DRY) == N5
OUT = f"{AUD}/{CFG['out']}"


def patched(fn, reps):
    src = inspect.getsource(fn)
    for a, b in reps:
        assert a in src, (fn.__name__, a)
        src = src.replace(a, b)
    exec(src, M.__dict__)
    return M.__dict__[fn.__name__]


story5 = patched(M.story, [
    ("g = Grid(0.0, 60 / 96)", "g = Grid(7.0, 219.2 / 88 / 4)"),
    ('c07 = ["F", "Am", "Bb", "C"] * 6', 'c07 = ["F", "Am", "Bb", "C"] * 7 + ["Bb", "C"]'),
    ('"bpm": 96,', '"bpm": round(60 / g.beat, 2),'),
    ("assert len(plan) == 82, len(plan)", "assert len(plan) == 88, len(plan)"),
    ("put(marimba(65), 0.0, 0.3, 0, send=0.3, jitter=0)", "put(marimba(65), g.t(0, 0), 0.3, 0, send=0.3, jitter=0)"),
    ("if k == 23:  # the high-five bar", "if k == 29:  # the high-five bar"),
    ("k = bar - 75", "k = bar - 81"),
])
C11_V5 = '["F", "Bb", "C", "F", "Dm", "Bb", "C", "C", "F", "Bb", "C", "Am", "Dm", "Bb", "Gm", "C", "Bb", "C"]'
C11_V6 = '["F", "Bb", "C", "F", "Dm", "Bb", "C", "C", "F", "Bb", "Gm", "C", "Dm", "Bb", "C"]'
C10_V5 = '["F", "C", "Dm", "Bb", "C", "F", "Bb", "C", "F", "C"]'
C10_V6 = '["F", "C", "Dm", "Bb", "F", "C"]'
explainer5 = patched(M.explainer, [
    ("t0, t1, bars = 205.0, 290.8, 36", f"t0, t1, bars = 226.2, {CFG['ex_t1']}, {CFG['ex_bars']}"),
    ('c09 = ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "C", "C"]', 'c09 = ["Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "C", "Dm", "Bb", "C"]'),
    ('c10 = ' + C10_V5, 'c10 = ' + (C10_V6 if V6 else C10_V5)),
    ('c11 = ["F", "Bb", "C", "F", "Dm", "Bb", "C", "C", "F", "Bb", "C", "Am", "Dm", "Bb", "Gm", "C", "C"]', 'c11 = ' + (C11_V6 if V6 else C11_V5)),
    ('[("c09", 0, 9), ("c10", 9, 19), ("c11", 19, 36)]', f'[("c09", 0, 11), ("c10", 11, {CFG["c11_from"]}), ("c11", {CFG["c11_from"]}, {CFG["ex_bars"]})]'),
    ("k = bar - 9\n", "k = bar - 11\n"),
    ("k = bar - 19\n", f"k = bar - {CFG['c11_from']}\n"),
    ("tF = g.t(36, 0)", f"tF = g.t({CFG['ex_bars']}, 0)"),
])
sober5 = patched(M.sober, [
    ("t0, t1 = 292.8, 445.8", "t0, t1 = %s, %s" % CFG["sober"]),
    ("cuts = [t0] + [292.8 + (s_ - 600) for s_ in (604, 622, 647, 677, 695, 709, 732, 745)] + [t1]", "cuts = " + CFG["cuts"]),
    ('''    per_slide = [["Fadd9"], ["Am7", "Bbmaj7"], ["Fmaj7", "Dm7"], ["Bbadd9", "Gm7", "Csus4"], ["Fadd9", "Am7"], ["Bbmaj7"],
                 ["Fadd9", "Am7"], ["Bbmaj7"], ["Csus4"]]''', "    per_slide = " + CFG["per_slide"]),
])
sting5 = patched(M.sting, [("t0 = 445.8; beat = 0.6", f"t0 = {CFG['sober'][1]}; beat = 0.6"), ('"end": 455.8', f'"end": {CFG["end"]}')])


def agenda5():
    """0-7: three bars in the explainer's light colour (pizzicato, strum, glockenspiel, shaker), F | Bb | C, so the
    story's F lands on its own downbeat at 7.0; the agenda's TA-DA (0.23, an F chord) sits on the first bar"""
    g = M.Grid(0.0, 7.0 / 3 / 4, swing=0.55)
    M.SECTIONS.append({"section": "agenda", "start": 0.0, "end": 7.0, "bpm": round(60 / g.beat, 2), "bars": 3})
    for bar, ch in enumerate(["F", "Bb", "C"]):
        M.bassline(g, bar, ch, "pizz", gain=0.4)
        M.bassline(g, bar, ch, "whole", gain=0.12)
        M.strum(g, bar, ch, gain=0.075)
        M.drums(g, bar, "light", gain=0.5 if bar else 0.4)
        M.pad_bar(g, bar, ch, gain=0.06, cutoff=1300)
        if bar == 1: M.lead(g, bar, M.THEME_A[0], inst="glock", gain=0.08, pan=0.2)
    M.put(M.glock(84 + 5, 1.0), g.t(2, 3.5), 0.06, 0.2, send=0.5, jitter=0)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    agenda5(); story5(); explainer5(); sober5(); sting5()
    SECTIONS = M.SECTIONS
    ir = make_ir(rt=1.5, pre=0.015, seed=11, lp_hz=7000)
    mix = M.DRY + reverb(M.SEND, ir, wet=1.0) * 0.55
    mix = hp(mix.T, 30, 2).T
    mix = np.stack([peaking(mix[:, ch], 230, -2.5, 0.8) for ch in range(2)], 1)
    mix = compress(mix / max(1e-9, np.abs(mix).max()), -12.0, ratio=2.0, attack=0.004, release=0.15)
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    TARGET = {"agenda": -19.0, "story c01": -19.0, "story c02": -18.0, "story c03": -17.5, "story c04": -17.5, "story c05": -19.0,
              "story c06": -17.5, "story c07": -19.5, "story c08": -19.0, "explainer c09": -18.5, "explainer c10": -17.5,
              "explainer c11": -18.0, "sober bed": -25.5, "end card sting": -21.0}
    corr = []
    for s in SECTIONS:
        a, b = s["start"], s["end"]
        L = meter.integrated_loudness(mix[int(a * SR):int(b * SR)])
        c = float(np.clip(TARGET[s["section"]] - L, -10, 10)); s["measured_lufs"] = round(L, 2); s["trim_db"] = round(c, 2)
        corr.append((s["section"], a, b, c))
    T = np.arange(N5) / SR
    trim = np.zeros(N5)
    for _, a, b, c in corr: trim[(T >= a) & (T < b)] = c
    c11 = [c for nm, a, b, c in corr if nm == "explainer c11"][0]
    trim[(T >= CFG["ex_t1"]) & (T < CFG["sober"][0])] = c11  # the resolving chord keeps the lab's level
    trim[T >= CFG["end"] - 1e-9] = corr[-1][3]
    k = n_(0.4); cs = np.cumsum(np.pad(trim, (k, k), mode="edge")); trim = (cs[2 * k:] - cs[:-2 * k])[:N5] / (2 * k)
    mix *= (10 ** (trim / 20))[:, None]
    e = np.clip((CFG["end"] - T) / 1.6, 0, 1) ** 1.5
    mix *= e[:, None]
    assert len(mix) == N5
    pk = np.abs(mix).max(); print("music peak", round(float(pk), 3))
    sf.write(f"{OUT}/music.wav", (mix / max(1.0, pk / 0.95)).astype(np.float32), SR, subtype="FLOAT")
    json.dump(SECTIONS, open(f"{OUT}/music-sections.json", "w"), indent=1)
    for s in SECTIONS: print({k: v for k, v in s.items() if k not in ("chords",)})
