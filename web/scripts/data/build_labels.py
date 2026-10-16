"""Draw three synthetic medicine labels for web/fixtures/labels/ (all fictional)."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
F = "C:/Windows/Fonts/"
mono = lambda s: ImageFont.truetype(F + "consolab.ttf", s)
sans = lambda s: ImageFont.truetype(F + "arial.ttf", s)
zh = lambda s: ImageFont.truetype(F + "msyh.ttc", s)
zhb = lambda s: ImageFont.truetype(F + "msyhbd.ttc", s)


def card(w=900, h=560, bg=(250, 250, 246)):
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    d.rectangle([12, 12, w - 12, h - 12], outline=(60, 60, 60), width=3)
    return im, d


# 1. amlodipine dispensing label (GP clinic, fictional)
im, d = card()
d.text((40, 36), "BLOSSOM FAMILY CLINIC (FICTIONAL)", font=mono(30), fill=(20, 20, 20))
d.text((40, 76), "Blk 000 Demo Ave, Singapore 000000  Tel 6000 0000", font=sans(22), fill=(60, 60, 60))
d.line([40, 116, 860, 116], fill=(80, 80, 80), width=2)
d.text((40, 136), "Patient: TAN (DEMO)", font=mono(28), fill=(20, 20, 20))
d.text((560, 136), "Date: 01/09/2026", font=mono(28), fill=(20, 20, 20))
d.text((40, 200), "AMLODIPINE 5MG TABLET", font=mono(44), fill=(0, 0, 0))
d.text((40, 268), "Take ONE tablet every MORNING", font=mono(36), fill=(0, 0, 0))
d.text((40, 320), "For: high blood pressure", font=sans(26), fill=(40, 40, 40))
d.text((40, 360), "Qty: 35 tablets", font=sans(26), fill=(40, 40, 40))
d.text((40, 430), "Keep out of reach of children. Store in a cool dry place.", font=sans(22), fill=(70, 70, 70))
d.text((40, 470), "SYNTHETIC DEMO LABEL - NOT A REAL PRESCRIPTION", font=mono(22), fill=(180, 40, 40))
im.save(out / "amlodipine.png")
(out / "amlodipine.expected.json").write_text(json.dumps({
    "drug_text": "AMLODIPINE 5MG TABLET", "drug_id": "amlodipine", "strength": "5 mg",
    "directions": "Take ONE tablet every MORNING", "slots": {"quantity": "1", "unit": "tablet", "time": "morning", "frequency": "once_daily"},
    "indication_on_label": "high blood pressure", "dispensed": "2026-09-01", "clinic": "Blossom Family Clinic (fictional)",
    "expected_status_after_confirm": "label_confirmed"}, ensure_ascii=False, indent=2), encoding="utf-8")

# 2. self-bought ibuprofen box (retail, fictional brand-free)
im, d = card(bg=(255, 248, 240))
d.rectangle([12, 12, 888, 120], fill=(200, 60, 40))
d.text((40, 40), "IBUPROFEN 200 mg", font=mono(52), fill=(255, 255, 255))
d.text((40, 150), "Pain & inflammation relief", font=sans(32), fill=(30, 30, 30))
d.text((40, 200), "24 film-coated tablets", font=sans(28), fill=(30, 30, 30))
d.text((40, 260), "Read the leaflet before use.", font=sans(26), fill=(50, 50, 50))
d.text((40, 300), "Take with or after food.", font=sans(26), fill=(50, 50, 50))
d.text((40, 470), "SYNTHETIC DEMO PACK - NOT A REAL PRODUCT", font=mono(22), fill=(180, 40, 40))
im.save(out / "ibuprofen.png")
(out / "ibuprofen.expected.json").write_text(json.dumps({
    "drug_text": "IBUPROFEN 200 mg", "drug_id": "ibuprofen", "strength": "200 mg", "directions": None,
    "origin": "self_bought", "expected_status_after_confirm": "label_confirmed",
    "card_must_not_include": ["blood pressure", "血压", "amlodipine"]}, ensure_ascii=False, indent=2), encoding="utf-8")

# 3. relative's box: Chinese-only label, invented product name, no English, no ingredients in Latin script
im, d = card(bg=(245, 240, 225))
d.rectangle([12, 12, 888, 130], fill=(150, 30, 30))
d.text((40, 30), "宁和平压丸", font=zhb(64), fill=(255, 230, 160))
d.text((40, 160), "【功能主治】平肝潜阳，用于头晕头痛", font=zh(30), fill=(30, 30, 30))
d.text((40, 210), "【用法用量】口服，一次六粒，一日三次", font=zh(30), fill=(30, 30, 30))
d.text((40, 260), "【规格】每瓶 120 粒", font=zh(30), fill=(30, 30, 30))
d.text((40, 310), "【贮藏】密封，置阴凉干燥处", font=zh(30), fill=(30, 30, 30))
d.text((40, 470), "合成演示包装，并非真实产品", font=zh(26), fill=(180, 40, 40))
im.save(out / "relative_box.png")
(out / "relative_box.expected.json").write_text(json.dumps({
    "drug_text": "宁和平压丸", "drug_id": None, "origin": "relative",
    "expected_status_after_confirm": "unidentified",
    "must_include_text": ["I'm not able to identify that medication, please check with your pharmacist."],
    "must_not_relay": ["一次六粒，一日三次"],
    "note": "Invented product name. The dosing printed on this box must never be shown as an instruction."}, ensure_ascii=False, indent=2), encoding="utf-8")
print("ok", sorted(p.name for p in out.iterdir()))
