# The demo video · 演示视频

**English** · [中文在下面](#中文)

The source code of our 7:56 demo video. Every frame is drawn in code: the 3D comic scenes are three.js, rendered frame by frame in headless Chrome with a halftone and outline pass, and the phone screens are real recordings of the app. The music and sound effects are synthesised in Python; the edit is an edit list of source ranges, so a re-cut never needs a re-render.

| Path | What |
|---|---|
| `src/chapters/` | One file per chapter: c01–c08 the story (a day in Mr Tan's life), c09–c11 the problem, the app and the trust lab, `t_serious.js` the technical and safety part, `c14_tryit.js` the end card, `a_agenda.js` the opening agenda |
| `src/sets/`, `src/bots.js`, `src/look.js` | The 3D sets, the characters (the CodeBuddy mascot as Mr Tan, Wei Ling and Dr Lim) and the comic look |
| `render.mjs` | Renders frames, contact sheets, clips and the sound pass (its header lists the modes) |
| `edl.py`, `edl-v*.json` | The edit lists; `edl-v11b.json` is the final cut (v11b: part 3 names Tencent Cloud Hunyuan and the guided safety layer) |
| `post.mjs`, `post.html`, `captions-v*.json` | The yellow captions burned onto the frames |
| `audio/` | The score (`music5.py`), the effects (`sfxlib.py`), the mix and master (`build5.py`) and the checks (`verify5.py`); `voices-v5.json` lists every voiced line |
| `assets/` | Ripple's logo (SVG), the QR code, the CodeBuddy screenshot used in the film |

Not included: the app screen-recording frames (`media/`, about 2 GB), the rendered frames and outputs, and the voice recordings.

```bash
cd videos
npm ci
node render.mjs --only=t_serious --sheet=615,630,680 --out=sheet.jpg   # three slides of the technical part
```

## 中文

这是我们 7:56 演示视频的源代码。每一帧都是代码画出来的：3D 漫画场景用 three.js，在无界面的 Chrome 里逐帧渲染，再加网点和描边效果；片中手机屏幕是 App 的真实录屏。配乐和音效用 Python 合成；剪辑是一份「源片段清单」，改剪辑不需要重新渲染。

| 路径 | 内容 |
|---|---|
| `src/chapters/` | 每章一个文件：c01–c08 是故事（陈先生的一天），c09–c11 是问题、App 和信任实验室，`t_serious.js` 是技术与安全部分，`c14_tryit.js` 是片尾，`a_agenda.js` 是片头目录 |
| `src/sets/`、`src/bots.js`、`src/look.js` | 3D 场景、角色（用 CodeBuddy 吉祥物演陈先生、Wei Ling 和林医生）和漫画风格 |
| `render.mjs` | 渲染帧、样张、片段和声音采样 |
| `edl.py`、`edl-v*.json` | 剪辑清单；`edl-v11b.json` 是最终版（第十一版 b：第三段写的是腾讯云混元和引导式安全层） |
| `post.mjs`、`post.html`、`captions-v*.json` | 烧进画面的黄色字幕 |
| `audio/` | 配乐（`music5.py`）、音效（`sfxlib.py`）、混音和母带（`build5.py`）、检查（`verify5.py`）；`voices-v5.json` 列出每一句配音 |
| `assets/` | Ripple 的 logo（SVG）、二维码、片中用到的 CodeBuddy 截图 |

没有放进来的：App 录屏的帧（`media/`，约 2 GB）、渲染出来的帧和成片，以及配音录音。
