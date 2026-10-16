# post_check.py: the caption check sheet for version 4, from the FINAL frames (out/frames-v4), at 720p.
#   python -I post_check.py [captions-v4.json] [out/frames-v4] [out/check/v4_captions.jpg] [--settled]
# Two tiles per caption: its first and its last visible frame (round(start*30) and round(end*30) - 1), each 1280 x 720,
# with a label strip (id, frame, final time, text). Also checks that every frame f00000..f(N-1) exists in the folder.
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

cap_path = sys.argv[1] if len(sys.argv) > 1 else "captions-v4.json"
src = sys.argv[2] if len(sys.argv) > 2 else "out/frames-v4"
out = sys.argv[3] if len(sys.argv) > 3 else "out/check/v4_captions.jpg"
# --settled: the frames just after the pop-in and just before the pop-out (first + 5, last - 5) instead, where the caption
# is at full size and opacity (the first and last frames are mid-pop, faint and small by design)
settled = "--settled" in sys.argv
if settled and len(sys.argv) <= 3: out = "out/check/v4_captions_settled.jpg"
spec = json.load(open(cap_path, encoding="utf-8"))
fps = spec.get("fps", 30)
total = json.load(open("out/frames-v4-raw/map.json", encoding="utf-8"))["frames"]
missing = [i for i in range(total) if not os.path.exists(f"{src}/f{i:05d}.jpg")]
extra = sorted(f for f in os.listdir(src) if f.startswith("f") and f.endswith(".jpg") and int(f[1:6]) >= total)
print(f"{total} frames expected, {len(missing)} missing{(' (first ' + str(missing[:5]) + ')') if missing else ''}, {len(extra)} beyond the end")

W, H, LAB = 1280, 720, 34
try:
    font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 22)
except OSError:
    font = ImageFont.load_default()
caps = sorted(spec["captions"], key=lambda c: c["start"])
sheet = Image.new("RGB", (2 * W + 8, len(caps) * (H + LAB + 8)), (17, 17, 17))
d = ImageDraw.Draw(sheet)
for r, c in enumerate(caps):
    fa, fb = int(c["start"] * fps + 0.5), int(c["end"] * fps + 0.5) - 1
    if settled: fa, fb = fa + 5, fb - 5
    for k, f in enumerate((fa, fb)):
        x, y = k * (W + 8), r * (H + LAB + 8)
        im = Image.open(f"{src}/f{f:05d}.jpg").convert("RGB").resize((W, H), Image.LANCZOS)
        sheet.paste(im, (x, y + LAB))
        label = f"{c['id']} {('settled ' if settled else '') + ('first' if k == 0 else 'last')}  f{f}  {f / fps:.2f} s   {c['text']}"
        d.text((x + 8, y + 5), label[:110], fill=(255, 217, 74), font=font)
os.makedirs(os.path.dirname(out), exist_ok=True)
sheet.save(out, quality=82)
print(out, sheet.size)
