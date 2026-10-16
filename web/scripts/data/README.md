# 数据生成脚本

这些脚本生成 `web/kb/`、`web/fixtures/` 里的数据。改了源资料或对白脚本后重跑；跑之前先看 diff。`web/kb/patient_text.json` 和 `web/kb/glossary.json` 是手写的，不由脚本生成。都用 `python -I` 运行。

- `build_kb.py <Zicheng 的药物 JSON> <Zicheng 的出处表 MD> web/kb`：转出 drugs、referrals、screening、sources。源文件是 Zicheng 整理的《Ripple 规则库资料 · 新加坡药物单张转述与差异 v1.1》和《Ripple 规则库资料出处表 v1.1 新加坡版》（2026-10-01）。
- `build_timeline.py web/fixtures/timeline.seed.json`：按 `docs/plan/visits-script.md` 生成 Mr Tan 的时间线，随机数种子固定，结果可重现。改了读数要同步改对白脚本里的数字。
- `build_labels.py web/fixtures/labels`：画三张合成药袋图（需要 Pillow 和 Windows 自带字体）。
- `build_utterances.py docs/plan/visits-script.md web/fixtures/visits`：把对白脚本转成带时间点的看诊转写，给 `SPEECH_PROVIDER=mock` 和 M2 的测试用。时间按朗读速度估算，录了真音频后应换成实测时间。改了对白脚本要重跑。
