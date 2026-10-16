# Shared helpers for the promo's sound track: sample rate, the output timeline from edl-v3.json, filters, envelopes,
# panning, a reverb, and the onset detector the checks use. Run everything with D:/AI/seed-vc/.venv/Scripts/python.exe
# (numpy, scipy, soundfile, librosa, pyloudnorm are installed there).
import json, math, os, sys
import numpy as np
from scipy import signal

SR = 48000
FPS = 30
PROMO = "D:/ripple-c2/film/promo"
AUD = f"{PROMO}/audio"
sys.path.insert(0, PROMO)
import edl  # noqa: E402  (the shared cut loader; only read, never changed)

EDL_PATH = f"{PROMO}/edl-v3.json"


def timeline():
    """segments with output start/end in seconds, and the total length in frames"""
    e, segs, total = edl.load(EDL_PATH)
    out = []
    for s in segs:
        out.append({"name": s["name"], "a": s["a"], "b": s["b"], "fa": s["fa"], "fb": s["fb"],
                    "oa": s["oa"] / FPS, "ob": s["ob"] / FPS, "dir": s["dir"]})
    return out, total


def total_samples():
    _, total = timeline()
    return total * SR // FPS


def src_to_out(src, segs, slack=0.0):
    """output time of a source film time, or None when the source time is not in the cut"""
    for s in segs:
        if s["a"] - 1e-6 - slack <= src < s["b"] - 1e-6:
            return s["oa"] + max(src, s["a"]) - s["a"], s
    return None, None


# ---- small DSP kit ---------------------------------------------------------------------------------------------------
def n_(d):
    return max(1, int(round(d * SR)))


def tt(d):
    return np.arange(n_(d)) / SR


def butter(x, kind, f, order=2):
    nyq = SR / 2
    if kind == "band":
        lo, hi = max(10, f[0]), min(nyq * 0.98, f[1])
        sos = signal.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    else:
        sos = signal.butter(order, min(nyq * 0.98, max(10, f)), btype=kind, fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lp(x, f, order=2): return butter(x, "low", f, order)
def hp(x, f, order=2): return butter(x, "high", f, order)
def bp(x, lo, hi, order=2): return butter(x, "band", (lo, hi), order)


def peaking(x, f, gain_db, q=1.0):
    A = 10 ** (gain_db / 40); w = 2 * np.pi * f / SR; al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]; a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def sweep_bp(x, fc, q=2.0, block=64):
    """band-pass whose centre follows the curve fc (Hz per sample); RBJ biquad re-designed every block, state carried"""
    y = np.zeros_like(x); zi = np.zeros(2)
    for i in range(0, len(x), block):
        f = float(np.clip(fc[min(i, len(fc) - 1)], 30, SR * 0.45))
        w = 2 * np.pi * f / SR; al = np.sin(w) / (2 * q)
        b = np.array([al, 0, -al]); a = np.array([1 + al, -2 * np.cos(w), 1 - al])
        y[i:i + block], zi = signal.lfilter(b / a[0], a / a[0], x[i:i + block], zi=zi)
    return y


def sweep_lp(x, fc, q=0.707, block=64):
    y = np.zeros_like(x); zi = np.zeros(2)
    for i in range(0, len(x), block):
        f = float(np.clip(fc[min(i, len(fc) - 1)], 30, SR * 0.45))
        w = 2 * np.pi * f / SR; al = np.sin(w) / (2 * q); c = np.cos(w)
        b = np.array([(1 - c) / 2, 1 - c, (1 - c) / 2]); a = np.array([1 + al, -2 * c, 1 - al])
        y[i:i + block], zi = signal.lfilter(b / a[0], a / a[0], x[i:i + block], zi=zi)
    return y


def pink(n, rng):
    w = rng.standard_normal(n)
    F = np.fft.rfft(w); f = np.arange(len(F)); f[0] = 1
    y = np.fft.irfft(F / np.sqrt(f), n)
    return y / (np.std(y) + 1e-12)


def brown(n, rng):
    y = np.cumsum(rng.standard_normal(n)); y = hp(y, 20, 1)
    return y / (np.std(y) + 1e-12)


def env_ad(n, a, d, curve=1.0):
    """attack a seconds (linear), then exponential decay with time constant d"""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-6), np.exp(-(t - a) / max(d, 1e-6)))
    return e ** curve


def fade(x, fin=0.003, fout=0.01):
    x = x.copy(); a, b = n_(fin), n_(fout)
    if x.ndim == 1:
        x[:a] *= np.linspace(0, 1, a)[: len(x)]; x[-b:] *= np.linspace(1, 0, b)[-len(x):]
    else:
        x[:a] *= np.linspace(0, 1, a)[: len(x), None]; x[-b:] *= np.linspace(1, 0, b)[-len(x):, None]
    return x


def sine_f(freq):
    """sine following a per-sample frequency curve"""
    return np.sin(2 * np.pi * np.cumsum(freq) / SR)


def partials(f0, ratios, amps, decays, dur, attack=0.002):
    t = tt(dur); y = np.zeros_like(t)
    for r, a, d in zip(ratios, amps, decays):
        if f0 * r < SR * 0.45:
            y += a * np.sin(2 * np.pi * f0 * r * t) * np.exp(-t / d)
    y *= np.minimum(1, t / attack)
    return y


def pan_st(x, pan, width=0.0):
    """equal-power pan: pan -1 (left) .. +1 (right)"""
    if x.ndim == 2: return x
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], 1) * math.sqrt(2)


def db(x): return 20 * np.log10(np.maximum(x, 1e-12))
def undb(d): return 10 ** (d / 20)


def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)


def add_at(buf, x, t0):
    """mix x (stereo) into buf at time t0 seconds; clips at the buffer ends"""
    i0 = int(round(t0 * SR)); j0 = 0
    if i0 < 0: j0 = -i0; i0 = 0
    n = min(len(x) - j0, len(buf) - i0)
    if n > 0: buf[i0:i0 + n] += x[j0:j0 + n]


def make_ir(rt=1.6, pre=0.012, seed=7, lp_hz=6000, early=True):
    """a synthetic stereo room: decorrelated decaying noise, darkening as it decays"""
    rng = np.random.default_rng(seed)
    n = n_(rt * 1.2); t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for ch in range(2):
        w = rng.standard_normal(n) * np.exp(-6.9 * t / rt)
        # darker tail: blend a low-passed copy in as time goes on
        dark = lp(w, 2500, 2); k = np.clip(t / rt, 0, 1)
        ir[:, ch] = lp((1 - k) * w + k * dark, lp_hz, 2)
    if early:
        for d, g in [(0.007, 0.5), (0.013, 0.35), (0.021, 0.3), (0.029, 0.22)]:
            for ch in range(2):
                ir[n_(d + ch * 0.0017), ch] += g
    ir = np.vstack([np.zeros((n_(pre), 2)), ir])
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


def reverb(x, ir, wet=0.2):
    """x stereo; returns the wet signal only (to be added), scaled by wet"""
    y = np.stack([signal.oaconvolve(x[:, 0], ir[:, 0])[: len(x)] + signal.oaconvolve(x[:, 1], ir[:, 0])[: len(x)] * 0.3,
                  signal.oaconvolve(x[:, 1], ir[:, 1])[: len(x)] + signal.oaconvolve(x[:, 0], ir[:, 1])[: len(x)] * 0.3], 1)
    return y * wet / 1.3


# ---- onset detection (for the checks and for each sound's own hit point) ----------------------------------------------
def onset_env(x, hop=48, win=512, floor_db=50):
    """positive spectral flux of a mono signal, one value per hop (1 ms at 48 kHz)"""
    if x.ndim == 2: x = x.mean(1)
    x = np.concatenate([np.zeros(win), x, np.zeros(win)])
    nfr = (len(x) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(nfr)[:, None]
    S = np.abs(np.fft.rfft(x[idx] * np.hanning(win), axis=1))
    floor = S.max() * 10 ** (-floor_db / 20) + 1e-12  # anything 50 dB below the loudest bin counts as silence
    S = np.log10(np.maximum(S, floor))
    flux = np.maximum(0, np.diff(S, axis=0)).sum(1)
    flux = np.concatenate([[0], flux])
    # frame k is centred at sample k*hop + win/2 - win (the padding) = k*hop - win/2
    times = (np.arange(nfr) * hop - win / 2) / SR
    return times, flux


def first_onset(x, rel=0.35):
    """time of the first strong rise of x (seconds from its start): the first flux peak above rel x the max"""
    t, f = onset_env(x)
    if f.max() <= 0: return 0.0
    thr = rel * f.max()
    i = int(np.argmax(f > thr))
    while i + 1 < len(f) and f[i + 1] >= f[i]: i += 1
    return float(max(0.0, t[i]))


def onsets(x, delta=0.08, min_gap=0.02):
    """peak-picked onsets of a signal (seconds) with their strength"""
    t, f = onset_env(x)
    if f.max() <= 0: return []
    f = f / f.max()
    k = max(1, int(0.03 * SR / 48))
    out = []
    loc = signal.argrelmax(f, order=k)[0]
    for i in loc:
        base = np.median(f[max(0, i - 200): i + 1])
        if f[i] - base > delta:
            if not out or t[i] - out[-1][0] > min_gap: out.append((float(t[i]), float(f[i])))
    return out


def compress(y, thr_db, ratio=3.0, attack=0.005, release=0.06, knee=6.0):
    """a gentle feed-forward compressor on a 1 ms control grid (peak detector, soft knee); y mono or stereo"""
    m = np.abs(y) if y.ndim == 1 else np.abs(y).max(1)
    hop = SR // 1000; n = len(m) // hop + 1
    ctl = np.pad(m, (0, n * hop - len(m))).reshape(n, hop).max(1)
    lv = 20 * np.log10(ctl + 1e-9)
    over = lv - thr_db
    red = np.where(over <= -knee / 2, 0.0, np.where(over >= knee / 2, over * (1 - 1 / ratio), (1 - 1 / ratio) * (over + knee / 2) ** 2 / (2 * knee)))
    g = np.zeros(n); cur = 0.0
    ka, kr = 1 - math.exp(-1 / max(1e-6, attack * 1000)), 1 - math.exp(-1 / (release * 1000))
    for i in range(n):
        cur += (red[i] - cur) * (ka if red[i] > cur else kr); g[i] = cur
    gs = 10 ** (-np.interp(np.arange(len(m)) / hop, np.arange(n), g) / 20)
    return y * (gs if y.ndim == 1 else gs[:, None])
