# The voices recorded with the app scenes, placed 1:1 with the app panels that show them.
# A panel "plays" a recording where its source second advances 1:1 from frame to frame (from the sound-pass logs).
# Each voice file has an anchor: the clip second its sample 0 belongs to (checked against the taps sheets below).
# Inside a run the voice is exactly in sync; at the run's edges a slice is trimmed to whole words: a word cut at the
# start is dropped (or faded in if long), a word cut at the end is let ring to its end if that is at most 0.3 s away,
# otherwise cut back to the word before (or faded out over 80 ms when the phrase has no gap to cut at).
import json, os
import numpy as np, soundfile as sf
from scipy import signal
from common import SR, FPS, PROMO, hp, lp, peaking, timeline, src_to_out, onsets, compress

FLOW = "D:/ripple-c2/film"
CLIPS = "D:/repos/_wt/c2-jc/web/fixtures/visits/clips"

# name: (file, clip group, how the anchor is set, phone playback?)
SOURCES = {
    # 16 Oct night (owner: 「够好，用 Voicebox 这三个声音把片子里的人声全部换掉」): every voice is Voicebox now: Wei Ling = qsy,
    # Mr Tan = gy (the owner's own voice), Dr Lim = lim (cloned from the doctor reading the owner sent). Made by
    # audio/vb_voices.py on the same clocks as the TTS files they replace (the old config is in voices-v3-tts.py.bak).
    "s1-conversation": {"file": f"{PROMO}/audio/voicebox/scene1-conversation-vb.wav", "group": ("s1-his", "s1-her"),
                        "first_line_at": 20.9, "phone": False,
                        "check": [(8.935, 28.8), (16.435, 36.3), (23.835, 43.7), (32.535, 52.4), (39.035, 58.9), (45.335, 65.2), (52.135, 72.0), (57.435, 77.3), (64.135, 84.0), (72.935, 92.8), (83.735, 103.6), (89.435, 109.3), (97.135, 117.0), (104.335, 124.2)]},
    "s2-his-words": {"file": f"{PROMO}/audio/voicebox/s2-his-words-vb.wav", "group": ("s2-his",),
                     "first_line_at": 15.9, "phone": False, "check": []},
    "s4-his-words": {"file": f"{PROMO}/audio/voicebox/s4-his-words-vb.wav", "group": ("s4-his",),
                     "first_line_at": 2.2 + 0.75, "phone": False, "check": []},
    # Dr Lim's recording played from the phone in scene 3: two lim takes joined ("Over the years, high pressure damages the
    # heart, the brain and the kidneys." + "So you take it every day, even when you feel fine."); the second starts on the
    # c05 bubble's first frame (106.1), the first just after the Play tap (101.55).
    "s3-doctor-recording": {"file": f"{PROMO}/audio/voicebox/s3-doctor-recording-vb.wav", "group": ("s3-his",), "anchor": 22.2, "phone": True, "check": [],
                            "place": {"from": 0.23, "to": 7.435, "align_file": 4.62, "align_out": 106.1, "tap_out": 101.55,
                                      "panel_close_out": 109.65},
                            "note": "placed by the coordinator's rule, not 1:1: the last sentence starts with the c05 bubble"},
    # "Please don't change the dose yourself." (lim): the file has 0.3 s of lead-in, so file 0 sits 0.3 s before 16.9
    "s4-doctor-recording": {"file": f"{PROMO}/audio/voicebox/s4-doctor-vb.wav", "group": ("s4-his",), "anchor": 16.6, "phone": True, "check": [], "upto": 2.45,
                            "note": "Play tapped 16.7, Dr Lim's sentence plays from about 16.9 (taps sheet; the panel shows Playing until about 19.3)"},
}


def load(src):
    x, sr = sf.read(src["file"], dtype="float64")
    if x.ndim > 1: x = x.mean(1)
    if "upto" in src: x = x[: int(src["upto"] * sr)]
    return x, sr


def words(x, sr, gate_db=-42, gap=0.06):
    """voiced stretches (start, end) in seconds, merged across gaps shorter than `gap`"""
    hop = int(sr * 0.005); win = hop * 4
    n = (len(x) - win) // hop
    rms = np.sqrt(np.array([np.mean(x[i * hop:i * hop + win] ** 2) for i in range(n)]) + 1e-12)
    on = 20 * np.log10(rms) > gate_db
    out = []; i = 0
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]: j += 1
            s, e = (i * hop) / sr, (j * hop + win) / sr
            if out and s - out[-1][1] < gap: out[-1] = (out[-1][0], e)
            else: out.append((s, e))
            i = j
        else: i += 1
    return out


def first_onset_s(x, sr):
    w = words(x, sr)
    return w[0][0] if w else 0.0


def anchor_of(name, src, x, sr):
    if "anchor" in src: return src["anchor"]
    return src["first_line_at"] - first_onset_s(x, sr)


def panel_runs(logs, segs):
    """per clip group: runs of output frames where the panel's clip second advances 1:1 (output start, clip second, frames)"""
    per = {}
    for f in logs:
        t_src = f["t"]
        o, s = src_to_out(t_src, segs)
        if o is None or s["name"].startswith("t "): continue
        fo = int(round(o * FPS))
        for name, src in SOURCES.items():
            if f["clip"] in src["group"]:
                per.setdefault(src["group"], {}).setdefault(fo, set()).add(round(f["sec"], 3))
    runs = {}
    for grp, d in per.items():
        rs = []; cur = None
        for fo in sorted(d):
            secs = sorted(d[fo])
            if cur and fo == cur["f1"] + 1:
                want = cur["s1"] + 1 / FPS
                best = min(secs, key=lambda s: abs(s - want))
                if abs(best - want) < 0.006:
                    cur["f1"] = fo; cur["s1"] = best; continue
            if cur and cur["f1"] > cur["f0"]: rs.append(cur)
            cur = {"f0": fo, "f1": fo, "s0": secs[0], "s1": secs[0]}
        if cur and cur["f1"] > cur["f0"]: rs.append(cur)
        runs[grp] = rs
    return runs


def envelope(x, sr):
    """5 ms RMS envelope in dB (times are the window starts)"""
    hop = int(sr * 0.005); win = hop * 2; n = (len(x) - win) // hop
    c = np.concatenate([[0], np.cumsum(x ** 2)])
    r = (c[np.arange(n) * hop + win] - c[np.arange(n) * hop]) / win
    return np.arange(n) * hop / sr + win / 2 / sr, 10 * np.log10(r + 1e-12)


def dip(env, t0, t1):
    """the quietest moment (a syllable boundary) between t0 and t1"""
    tt_, d = env; k = np.where((tt_ >= t0) & (tt_ <= t1))[0]
    return float(tt_[k[np.argmin(d[k])]]) if len(k) else None


def trim_start(a, b, ws, env):
    """a clipped phrase start shorter than 0.8 s is dropped; a longer one starts at the next syllable boundary"""
    for s, e in ws:
        if s < a < e:
            if e - a < 0.8: return next((s2 for s2, e2 in ws if s2 >= e), b), 0.012, "at the next phrase (a clipped fragment dropped)"
            d = dip(env, a, min(e, a + 0.35))
            return (d if d else a), 0.03, "mid-phrase, at a syllable boundary"
    return a, 0.012, "in a pause"


def trim_end(b, ws, env, ring_max=0.3, long_fade=0.08):
    """a clipped last word rings to its end when that is close and nothing else plays there; a phrase heard for less
    than 0.4 s is dropped; otherwise the slice ends at the last syllable boundary before the panel cut"""
    for s, e in ws:
        if s < b < e:
            if e + 0.04 - b <= ring_max: return e + 0.04, 0.012, f"last word let ring {e + 0.04 - b:.2f} s past the panel cut"
            if b - s < 0.4: return s - 0.01, 0.012, "cut back to the end of the previous phrase (a clipped start dropped)"
            d = dip(env, max(s + 0.3, b - 0.5), b)
            return (d if d else b), (0.03 if d else long_fade), f"mid-phrase, at the last syllable boundary before the panel cut ({(d or b) - s:.2f} s into the phrase)"
    return b, 0.012, "in a pause"


def build(logs, total_n, report):
    """the voice stem (stereo, centred) and the list of placements"""
    segs, _ = timeline()
    runs = panel_runs(logs, segs)
    stem = np.zeros((total_n, 2)); placed = []
    for name, src in SOURCES.items():
        if not os.path.exists(src["file"]):
            report.append(f"voice {name}: file missing ({src['file']})"); continue
        x, sr = load(src)
        anchor = anchor_of(name, src, x, sr)
        ws = words(x, sr)
        chk = [(a, b, round(anchor + a - b, 3)) for a, b in src.get("check", [])]
        # level: every source to the same active-speech level, then a gentle clean-up (and a phone speaker for playback)
        y = signal.resample_poly(x, SR // sr, 1) if SR % sr == 0 else signal.resample_poly(x, SR, sr)
        y = hp(y, 80, 2)
        if src["phone"]: y = peaking(lp(hp(y, 230, 2), 7000, 2), 2500, 2.0, 0.8)
        act = np.concatenate([y[int(s * SR):int(e * SR)] for s, e in ws]) if ws else y
        y = y * (10 ** (-20 / 20) / (np.sqrt(np.mean(act ** 2)) + 1e-12))
        y = compress(y, -12.0, ratio=3.0, attack=0.004, release=0.08)  # rounds off the hottest syllables (about 2-4 dB)
        act = np.concatenate([y[int(s * SR):int(e * SR)] for s, e in ws]) if ws else y
        y = y * (10 ** (-20 / 20) / (np.sqrt(np.mean(act ** 2)) + 1e-12))
        env = envelope(x, sr)
        if "place" in src:  # a fixed placement (see SOURCES)
            P = src["place"]; ws_f = words(x, sr, gap=0.035)
            assert any(abs(s_ - P["align_file"]) < 0.02 for s_, _ in ws_f), "align point is not a phrase start"
            assert not any(s_ < P["from"] < e_ for s_, e_ in ws_f) and not any(s_ < P["to"] < e_ for s_, e_ in ws_f), "cut inside a word"
            t_out = P["align_out"] - (P["align_file"] - P["from"]); t_end = t_out + (P["to"] - P["from"])
            assert t_out >= P["tap_out"] and t_end <= P["panel_close_out"], (t_out, t_end)
            seg = y[int(P["from"] * SR):int(P["to"] * SR)].copy()
            k1, k2 = int(0.01 * SR), int(0.03 * SR)
            seg[:k1] *= np.linspace(0, 1, k1); seg[-k2:] *= np.linspace(1, 0, k2)
            i0 = int(round(t_out * SR)); stem[i0:i0 + len(seg)] += np.stack([seg, seg], 1) * 0.7071
            heard = [(round(s_, 3), round(t_out + s_ - P["from"], 3)) for s_, e_ in ws_f if P["from"] <= s_ < P["to"]]
            placed.append({"source": name, "file": src["file"], "clip_group": "/".join(src["group"]), "anchor_clip_s": None,
                           "out": round(t_out, 3), "out_end": round(t_end, 3), "file_from": P["from"], "file_to": P["to"],
                           "clip_from": None, "clip_to": None, "panel_run_out": None, "panel_run_clip": None,
                           "first_word_out": heard[0][1] if heard else None, "phone_playback": src["phone"],
                           "starts": "at the phrase boundary before 'high pressure damages the heart' (just after the Play tap)",
                           "ends": "after 'even when you feel fine.', before the panel closes",
                           "placement": "not 1:1 (coordinator): the last sentence starts on the c05 bubble's first frame",
                           "check_starts": [[P["align_file"], P["align_out"]], [heard[0][0], heard[0][1]]] if heard else [[P["align_file"], P["align_out"]]]})
            report.append(f"voice {name}: placed by rule: file {P['from']}-{P['to']} s at output {t_out:.3f}-{t_end:.3f}; file {P['align_file']} s "
                          f"(So you take it...) at {P['align_out']} (the bubble's first frame)")
            continue
        rl = runs.get(src["group"], [])
        # first where each run's slice starts (in the output), so a ringing word never runs into the next slice
        starts = []
        for r in rl:
            a0 = r["s0"] - anchor; n = r["f1"] - r["f0"] + 1
            a1, fin, hs = trim_start(max(a0, 0.0), a0 + n / FPS, ws, env)
            starts.append((a1, fin, hs, r["f0"] / FPS + (a1 - a0)))
        for ri, r in enumerate(rl):
            out0 = r["f0"] / FPS; n = r["f1"] - r["f0"] + 1
            a0 = r["s0"] - anchor
            a2, fin, how_start, _ = starts[ri]
            nxt = starts[ri + 1][3] if ri + 1 < len(rl) else 1e9
            b0 = min(a0 + n / FPS, len(x) / sr)
            b2, fout, how_end = trim_end(b0, ws, env, ring_max=min(0.3, nxt - (out0 + n / FPS)), long_fade=0.25 if src["phone"] else 0.08)
            if b2 - a2 < 0.05 or not any(s_ < b2 and e_ > a2 for s_, e_ in ws): continue
            seg = y[int(a2 * SR):int(b2 * SR)].copy()
            k1, k2 = int(fin * SR), int(fout * SR)
            seg[:k1] *= np.linspace(0, 1, k1); seg[-k2:] *= np.linspace(1, 0, k2)
            t_out = out0 + (a2 - a0)
            i0 = int(round(t_out * SR)); m = min(len(seg), total_n - i0)
            stem[i0:i0 + m] += np.stack([seg[:m], seg[:m]], 1) * 0.7071
            spoken = [(round(t_out + max(s_, a2) - a2, 3), round(min(e_, b2) - max(s_, a2), 3)) for s_, e_ in ws if s_ < b2 and e_ > a2]
            placed.append({"source": name, "file": src["file"], "clip_group": "/".join(src["group"]), "anchor_clip_s": round(anchor, 3),
                           "out": round(t_out, 3), "out_end": round(t_out + (b2 - a2), 3), "file_from": round(a2, 3), "file_to": round(b2, 3),
                           "clip_from": round(a2 + anchor, 3), "clip_to": round(b2 + anchor, 3),
                           "panel_run_out": [round(out0, 3), round(out0 + n / FPS, 3)], "panel_run_clip": [r["s0"], round(r["s0"] + n / FPS, 3)],
                           "first_word_out": spoken[0][0] if spoken else None, "phone_playback": src["phone"],
                           "starts": how_start, "ends": how_end})
        report.append(f"voice {name}: anchor clip {anchor:.3f} s (file 0 s); taps-sheet checks (onset in the file, line time on the sheet, offset = anchor + onset - sheet): {chk}")
    return stem, placed, runs
