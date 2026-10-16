# edl.py: assemble a cut from an edit list (edl-*.json) of source film ranges, without re-rendering.
#   python -I edl.py edl-v3.json out/frames-v3      hard-links the frames in order into out/frames-v3/f%05d.jpg and writes
#                                                   out/frames-v3/map.json (output frame -> segment, source time)
#   python -I edl.py edl-v3.json --sheet out/check/v3_cuts.jpg   last and first frame around every cut
# Run from D:/ripple-c2/film/promo. Missing source frames are reported and stop the assembly.
import json, os, sys

def load(path):
    e = json.load(open(path, encoding="utf-8"))
    fps = e["fps"]; out = []; o = 0
    for s in e["segments"]:
        a, b = round(s["a"] * fps), round(s["b"] * fps)
        out.append({**s, "fa": a, "fb": b, "oa": o, "ob": o + (b - a)})
        o += b - a
    return e, out, o

def assemble(edl, dst):
    e, segs, total = load(edl)
    os.makedirs(dst, exist_ok=True)
    missing = [(s["name"], i) for s in segs for i in range(s["fa"], s["fb"]) if not os.path.exists(f"{s['dir']}/f{i:05d}.jpg")]
    if missing:
        print(f"{len(missing)} source frames missing, first: {missing[:3]}"); sys.exit(1)
    m = []
    for s in segs:
        for k, i in enumerate(range(s["fa"], s["fb"])):
            o = s["oa"] + k
            target = f"{dst}/f{o:05d}.jpg"
            if os.path.exists(target): os.replace(target, target + ".old")  # never silently reuse; keep the old one aside
            os.link(f"{s['dir']}/f{i:05d}.jpg", target)
            m.append({"o": o, "seg": s["name"], "src": i / e["fps"]})
    json.dump({"fps": e["fps"], "frames": total, "segments": [{k: s[k] for k in ("name", "a", "b", "dir", "oa", "ob")} for s in segs]},
              open(f"{dst}/map.json", "w", encoding="utf-8"), indent=1)
    print(f"{total} frames = {total / e['fps']:.1f} s in {len(segs)} segments -> {dst}")
    for s in segs: print(f"  {s['oa'] / e['fps']:7.2f}-{s['ob'] / e['fps']:7.2f}  {s['name']}")

def sheet(edl, out):
    from PIL import Image, ImageDraw
    e, segs, total = load(edl)
    tiles = []
    for p, n in zip(segs, segs[1:]):
        for (s, i) in ((p, p["fb"] - 1), (n, n["fa"])):
            f = f"{s['dir']}/f{i:05d}.jpg"
            im = Image.open(f).resize((384, 216)) if os.path.exists(f) else Image.new("RGB", (384, 216), "gray")
            d = ImageDraw.Draw(im); d.rectangle((0, 196, 384, 216), fill="black"); d.text((4, 199), f"{s['name'][:44]}", fill="yellow")
            tiles.append(im)
    cols = 4; rows = (len(tiles) + cols - 1) // cols
    sh = Image.new("RGB", (cols * 388, rows * 220), "black")
    for k, im in enumerate(tiles): sh.paste(im, ((k % cols) * 388, (k // cols) * 220))
    sh.save(out, quality=85); print(out)

if __name__ == "__main__":
    if sys.argv[2] == "--sheet": sheet(sys.argv[1], sys.argv[3])
    else: assemble(sys.argv[1], sys.argv[2])
