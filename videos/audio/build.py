# Builds the promo's sound track for the v3 cut:
#   python audio/build.py      (with D:/AI/seed-vc/.venv/Scripts/python.exe; music.py first)
# reads every out/log-A-B.json (the sound pass), places a synthesised effect on the first frame of every sound word,
# places the app-scene voices 1:1 with their panels, ducks the music under the voices, masters to -16 LUFS with true
# peak under -1 dBTP, and writes out/audio-v3.wav, out/audio-v3-cues.json and the stems in audio/stems/.
import json, math, os, re
import numpy as np, soundfile as sf, pyloudnorm as pyln
from scipy import signal, ndimage
from common import (SR, FPS, PROMO, AUD, n_, lp, hp, undb, db, add_at, make_ir, reverb, timeline, total_samples, src_to_out,
                    first_onset)
import sfxlib, voices

OUT_WAV = f"{PROMO}/out/audio-v3.wav"
OUT_CUES = f"{PROMO}/out/audio-v3-cues.json"
STEMS = f"{AUD}/stems"
TARGET_LUFS, CEILING_DBTP = -16.0, -1.3
SFX_REF = -12.0      # peak short-window level (dB, K-weighted, 50 ms) of a base-0 effect before the master gain
VOICE_LEVEL = -20.0  # active-speech RMS the voices are set to (dBFS) before the master gain
DUCK_DB, SFX_UNDER_VOICE_DB = -9.0, -3.0
CREST_MAX = 14.0      # dB: sample peak over the 50 ms loudness a sound is allowed before its level is set by its peak
MUSIC_GAIN_DB = -3.0   # the music bed under the effects and voices (story bed about -21.5 LUFS before the master gain)


def load_logs():
    sfx, frames, files = [], [], []
    for f in sorted(os.listdir(f"{PROMO}/out")):
        if re.fullmatch(r"log-[\d.]+-[\d.]+\.json", f):
            d = json.load(open(f"{PROMO}/out/{f}", encoding="utf-8"))
            sfx += d["sfx"]; frames += d["frames"]; files.append(f)
    uniq = []
    for w in sorted(sfx, key=lambda w: w["hit"]):
        if not any(w["txt"] == v["txt"] and abs(w["hit"] - v["hit"]) < 0.05 for v in uniq): uniq.append(w)
    return uniq, frames, files


def kweight(x):
    y = hp(x, 60, 2)
    return y + 0.585 * hp(y, 1500, 1)


def peak_mom(x):
    m = x if x.ndim == 1 else x.mean(1)
    y = kweight(m); w = n_(0.05)
    c = np.cumsum(np.concatenate([[0], y ** 2])); p = (c[w:] - c[:-w]) / w
    return 10 * np.log10(p.max() + 1e-12)


def panned(y, pan):
    a = (pan + 1) * np.pi / 4
    if y.ndim == 1: return np.stack([y * np.cos(a), y * np.sin(a)], 1) * math.sqrt(2)
    return np.stack([y[:, 0] * np.cos(a) * math.sqrt(2), y[:, 1] * np.sin(a) * math.sqrt(2)], 1)


def make_cues(words, segs):
    cues, unplaced, silent = [], [], []
    for w in words:
        ff = math.ceil(w["hit"] * FPS - 1e-3) / FPS  # the word's first painted frame
        o, s = src_to_out(ff, segs)
        how = "first frame"
        if o is None:  # landed just before a cut-in and still fresh on the segment's first frame: play it there
            for sg in segs:
                if w["hit"] < sg["a"] <= w["hit"] + 0.07:
                    o, s, how = sg["oa"], sg, f"segment start (landed {sg['a'] - w['hit']:.3f} s before the cut-in)"
        if o is None:
            unplaced.append({"word": w["txt"], "src_hit": w["hit"], "why": "lands outside the cut (between segments)"}); continue
        if s["name"].startswith("t "): continue
        c = sfxlib.classify(w["txt"], w["hit"])
        if c is None: silent.append({"word": w["txt"], "src_hit": w["hit"], "out": round(o, 3), "why": "vocal word: no sound by design"}); continue
        if c == "unknown": unplaced.append({"word": w["txt"], "src_hit": w["hit"], "why": "no sound class"}); continue
        cues.append({"word": w["txt"], "src_hit": w["hit"], "src_first_frame": round(ff, 4), "out": round(o, 4), "segment": s["name"],
                     "x": round(w["x"], 1), "size": w["size"], "placed_at": how, "cls": c})
    # a stamp and its THUNK! word land together: one thump, on the word
    drop = set()
    for i, c in enumerate(cues):
        if c["word"] in sfxlib.STAMPS and any(d["word"] == "THUNK!" and abs(d["out"] - c["out"]) < 0.25 for d in cues):
            drop.add(i); silent.append({"word": c["word"], "src_hit": c["src_hit"], "out": c["out"], "why": "stamp: its THUNK! word carries the sound"})
    return [c for i, c in enumerate(cues) if i not in drop], unplaced, silent


def duck_curve(voice, depth_db, attack=0.08, release=0.4, look=0.05, hold=0.25, gate_db=-45):
    """gain (linear, per sample) that dips by depth_db wherever the voice stem speaks (with look-ahead and a hold
    across the gaps between words)"""
    v = np.abs(voice).max(1); hop = SR // 1000
    n = len(v) // hop
    ctl = v[: n * hop].reshape(n, hop).max(1)
    act = (db(ctl) > gate_db).astype(float)
    H, Lk = int(hold * 1000), int(look * 1000)
    c = np.concatenate([[0], np.cumsum(act)])
    held = (c[1:] - c[np.maximum(0, np.arange(1, n + 1) - H)]) > 0           # active, or active within the last `hold`
    held = np.concatenate([held[Lk:], np.zeros(Lk, bool)]).astype(float)    # and `look` early
    tgt = held * depth_db; g = np.zeros(n); cur = 0.0
    ka, kr = 1 - math.exp(-1 / (attack * 1000)), 1 - math.exp(-1 / (release * 1000))
    for i in range(n):
        k = ka if tgt[i] < cur else kr
        cur += (tgt[i] - cur) * k; g[i] = cur
    g = np.interp(np.arange(len(v)) / hop, np.arange(n), g)
    return undb(g), held


def os_peak(x, chunk=SR * 10, pad=2000):
    """per-sample peak of the 4x-oversampled signal (all channels), computed in chunks"""
    out = np.zeros(len(x))
    for i in range(0, len(x), chunk):
        a, b = max(0, i - pad), min(len(x), i + chunk + pad)
        up = signal.resample_poly(x[a:b], 4, 1, axis=0)
        pk = np.abs(up).max(1)[: (b - a) * 4].reshape(-1, 4).max(1)
        out[i:min(len(x), i + chunk)] = pk[i - a: i - a + min(chunk, len(x) - i)]
    return out


def tp_limit(x, ceiling_db, look=0.0015, release=0.12):
    """a look-ahead limiter on 4x-oversampled peaks, so the true peak stays under the ceiling"""
    c = undb(ceiling_db)
    need = np.minimum(1.0, c / np.maximum(os_peak(x), 1e-9))
    L = max(2, n_(look))
    g = ndimage.minimum_filter1d(need, 2 * L + 1)
    k = L; cs = np.cumsum(np.concatenate([[0], np.pad(g, (k // 2, k - k // 2), mode="edge")])); g = (cs[k:] - cs[:-k])[: len(x)] / k
    idx = np.where(g < 0.9999)[0]
    if len(idx):  # release: recover slowly after each reduction
        a = 1 - math.exp(-1 / (release * SR))
        for run in np.split(idx, np.where(np.diff(idx) > n_(release * 6))[0] + 1):
            i0, i1 = run[0], min(len(g), run[-1] + n_(release * 6))
            seg = g[i0:i1].copy(); cur = seg[0]
            for j in range(len(seg)):
                cur = min(seg[j], cur + (1 - cur) * a); seg[j] = cur
            g[i0:i1] = seg
    tp_limit.last = g
    return x * g[:, None], float(g.min())


def softclip(x, c, knee=0.6):
    """sample-wise soft clipper: linear up to knee x c, then bends smoothly toward c (never past it)"""
    a = knee * c; m = np.abs(x)
    y = np.where(m <= a, m, a + (c - a) * np.tanh((m - a) / (c - a)))
    return np.sign(x) * y


def true_peak_db(x):
    return float(db(os_peak(x).max()))


def main():
    os.makedirs(STEMS, exist_ok=True)
    segs, total_f = timeline(); N = total_f * SR // FPS
    assert N == total_samples() == 21878400, N
    words, frames, files = load_logs()
    report = [f"logs read: {', '.join(files)}"]
    cues, unplaced, silent = make_cues(words, segs)

    # ---- effects
    SFX = np.zeros((N, 2)); placed = []
    for i, c in enumerate(cues):
        name, fn, kw, base, soft = c["cls"]
        rng = np.random.default_rng(7000 + i)
        y, hit = fn(rng, **kw); y = sfxlib.finish(y)
        if hit is None: hit = first_onset(y)
        # level by the 50 ms loudness, but never let a very peaky sound (a click) reach more than CREST_MAX above it
        pm, sp = peak_mom(y), float(db(np.abs(y).max()))
        y = y * undb(SFX_REF - max(pm, sp - CREST_MAX))
        size_db = float(np.clip(6 * math.log2(c["size"] / 90), -4, 4)) * 0.75
        lvl = base + size_db
        pan = float(np.clip((c["x"] / 1920 - 0.5) * 0.7, -0.35, 0.35))
        add_at(SFX, panned(y * undb(lvl), pan), c["out"] - hit)
        placed.append({"type": "sfx", "out": c["out"], "word": c["word"], "class": name, "segment": c["segment"], "src_hit": c["src_hit"],
                       "src_first_frame": c["src_first_frame"], "placed_at": c["placed_at"], "hit_offset_in_sound": round(hit, 4),
                       "level_db_rel": round(lvl, 2), "pan": round(pan, 3), "x": c["x"], "size": c["size"], "soft_onset": soft,
                       "params": {k: v for k, v in kw.items() if not callable(v)}})
    room = make_ir(rt=0.45, pre=0.006, seed=5, lp_hz=8000)
    SFX = SFX + reverb(SFX, room, wet=0.12)

    # ---- voices
    VOICE, vplaced, runs = voices.build(frames, N, report)
    VOICE *= undb(VOICE_LEVEL + 20)  # voices.build sets active speech to -20 dBFS

    # ---- music
    MUS, sr = sf.read(f"{STEMS}/music.wav", dtype="float64"); assert sr == SR and len(MUS) == N
    MUS *= undb(MUSIC_GAIN_DB)
    gd, act = duck_curve(VOICE, DUCK_DB)
    gs, _ = duck_curve(VOICE, SFX_UNDER_VOICE_DB)
    meter = pyln.Meter(SR)
    # bus peak control first, each bus on its own (so an effect's transient never pumps the music or a voice): the
    # ceiling is where the master gain this mix needs will put the target true peak
    G = TARGET_LUFS - meter.integrated_loudness(MUS * gd[:, None] + SFX * gs[:, None] + VOICE)
    bus_ceiling = CEILING_DBTP - G - 1.5
    SFX = softclip(SFX, undb(bus_ceiling))  # the first millisecond of a snap or a clap is shaved, its body is not
    SFX, g1 = tp_limit(SFX, bus_ceiling, release=0.05); sfx_gr = tp_limit.last.copy()
    VOICE, g2 = tp_limit(VOICE, bus_ceiling, release=0.08)
    MUSD, g3 = tp_limit(MUS * gd[:, None], bus_ceiling, release=0.15)
    report.append(f"bus limiters at {bus_ceiling:.2f} dBTP before the master gain ({G:+.2f} dB): deepest reduction effects "
                  f"{20 * math.log10(g1):.2f} dB, voices {20 * math.log10(g2):.2f} dB, music {20 * math.log10(g3):.2f} dB")
    mix = MUSD + SFX * gs[:, None] + VOICE

    # ---- master: gain to the target, true-peak limit, measure again, trim, limit
    L0 = meter.integrated_loudness(mix)
    g = undb(TARGET_LUFS - L0); mix *= g
    gall = 1.0; pre_tp = true_peak_db(mix); mgr = np.ones(N)
    for it in range(3):
        mix, gmin = tp_limit(mix, CEILING_DBTP); gall = min(gall, gmin); mgr *= tp_limit.last
        L = meter.integrated_loudness(mix)
        if abs(L - TARGET_LUFS) < 0.05: break
        mix *= undb(TARGET_LUFS - L)
    mix, gmin = tp_limit(mix, CEILING_DBTP); gmin = min(gall, gmin); mgr *= tp_limit.last
    grd = -db(mgr)
    report.append(f"master limiter: gain reduction over 1 dB for {np.mean(grd > 1) * 100:.2f} % of the time, over 2 dB {np.mean(grd > 2) * 100:.2f} %, over 3 dB {np.mean(grd > 3) * 100:.3f} %")
    L = meter.integrated_loudness(mix); tp = true_peak_db(mix)
    report.append(f"true peak before the limiter (after the master gain): {pre_tp:.2f} dBTP; deepest limiter gain reduction {20 * math.log10(max(gmin, 1e-9)):.2f} dB")
    assert len(mix) == N
    sf.write(OUT_WAV, mix, SR, subtype="PCM_24")
    master_gain_db = 20 * math.log10(g) + 0.0
    for nm, x in [("music-ducked", MUSD), ("sfx", SFX * gs[:, None]), ("voice", VOICE)]:
        sf.write(f"{STEMS}/{nm}.wav", (x * g).astype(np.float32), SR, subtype="FLOAT")
    sf.write(f"{STEMS}/sfx-dry-unducked.wav", (SFX * g).astype(np.float32), SR, subtype="FLOAT")

    # ---- how far each effect sits above the music around it (K-weighted, 50 ms peak vs 400 ms music)
    mk = kweight(MUSD.mean(1)) ** 2
    for p in placed:
        i0 = int(p["out"] * SR); w = n_(0.4)
        mus = 10 * np.log10(np.mean(mk[max(0, i0 - w // 2): i0 + w // 2]) + 1e-12)
        seg = SFX[max(0, i0 - n_(0.01)): i0 + n_(0.3)] * gs[max(0, i0 - n_(0.01)): i0 + n_(0.3), None]
        p["over_music_db"] = round(peak_mom(seg) - mus, 1) if len(seg) > n_(0.06) else None
        p["level_dbfs_peak_after_master"] = round(float(db(np.abs(seg).max() * g)), 1) if len(seg) else None
        p["effects_bus_limiter_db"] = round(float(-db(sfx_gr[i0: i0 + n_(0.3)].min())), 1)
        p["master_limiter_db"] = round(float(-db(mgr[i0: i0 + n_(0.3)].min())), 1)

    for v in vplaced: v["type"] = "voice"
    music_secs = json.load(open(f"{STEMS}/music-sections.json"))
    cues_out = {
        "about": "Every placed sound of out/audio-v3.wav. Times are output seconds of the v3 cut (edl-v3.json, 30 fps, 455.8 s). "
                 "sfx 'out' is the word's first painted frame mapped to the output; the sound's transient sits there "
                 "(hit_offset_in_sound is the time from the sound's start to its transient). level_db_rel is relative to the "
                 "library reference before the master gain; over_music_db is the effect's 50 ms K-weighted peak over the "
                 "ducked music's 400 ms level at that moment.",
        "length_samples": N, "sample_rate": SR, "loudness_lufs": round(L, 2), "true_peak_dbtp": round(tp, 2),
        "master_gain_db": round(master_gain_db, 2), "limiter_min_gain_db": round(20 * math.log10(max(gmin, 1e-9)), 2),
        "segments": [{k: s[k] for k in ("name", "a", "b", "oa", "ob")} for s in segs],
        "music_sections": music_secs,
        "sfx": placed, "voices": vplaced,
        "voice_panel_runs": {"/".join(k): [{"out": round(r["f0"] / FPS, 3), "frames": r["f1"] - r["f0"] + 1, "clip_from": r["s0"]} for r in v]
                             for k, v in runs.items()},
        "no_sound_by_design": silent, "unplaced": unplaced, "notes": report,
        "ducking": {"music_db": DUCK_DB, "sfx_db": SFX_UNDER_VOICE_DB, "attack_s": 0.08, "release_s": 0.4, "lookahead_s": 0.05},
    }
    json.dump(cues_out, open(OUT_CUES, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote {OUT_WAV}: {N} samples, {L:.2f} LUFS, true peak {tp:.2f} dBTP, limiter min gain {20*math.log10(max(gmin,1e-9)):.2f} dB, pre-master {L0:.2f} LUFS")
    print(f"{len(placed)} effects, {len(vplaced)} voice slices, {len(unplaced)} unplaced, {len(silent)} silent by design")
    for r in report: print(" ", r)
    from collections import Counter
    for k, v in sorted(Counter(p["class"] for p in placed).items()): print(f"   {v:3d}  {k}")
    for u in unplaced: print("  UNPLACED", u)
    for v in vplaced:
        clip = f"clip {v['clip_from']:7.3f}-{v['clip_to']:7.3f}" if v['clip_from'] is not None else f"file {v['file_from']}-{v['file_to']} (placed by rule)"
        print(f"  voice {v['source']:20} out {v['out']:8.3f}-{v['out_end']:8.3f}  {clip}  run {v['panel_run_out']}")
    byc = {}
    for p in placed:
        if p["over_music_db"] is not None: byc.setdefault(p["class"], []).append(p["over_music_db"])
    for k, v in sorted(byc.items()): print(f"   over music {k:34} median {np.median(v):6.1f} dB  min {min(v):6.1f}")


if __name__ == "__main__":
    main()
