# 录屏脚本

每条路一段录屏脚本。它同时是这条路的端到端测试：每一步都有检查，有一步没过就不出录屏。通过了，就得到一段手机尺寸的 mp4：每一步一行中文字幕，有声音的地方带声音，两个人之间的事两台手机并排。录屏放进进度库 `recordings/`，主文档那一节挂最新一段。

现成的两段示范：`07-ask.journey.ts`（一台手机，带医生原话的声音）和 `02-dose.journey.ts`（两台手机并排，带女儿提醒的声音和一条通知横幅）。

## 跑一条路

**1. 起 app。** 只用生产构建（`next build` 加 `next start`）；开发模式在 Playwright 下会反复刷新，录不了。

```
node scripts/record/serve.mjs --port 3430 --build --detach
```

- 一律带 `RIPPLE_DEV_TOOLS=1`：地基的开发工具（测试时钟、开发账号、转写替身）在生产构建上只有这样才开。
- 默认全离线：`STORE=memory`、`AUTH_PROVIDER=memory`、`LLM_PROVIDER=mock`、`CHECKER_PROVIDER=mock`、`SPEECH_PROVIDER=mock`、`TTS_PROVIDER=mock`、本地文件存储。环境里已经设了的变量优先，例如 `SPEECH_PROVIDER=devfake`、`BLOB_LOCAL_DIR=D:/ripple-c2/blob/<线>`。
- 集成版本要用 `web/.env` 里的真配置时加 `--no-offline`。
- `--detach` 在后台起，日志在 `D:/ripple-c2/rec/serve-<端口>.log`；停用 `--stop`。不加 `--detach` 就在当前终端里跑。
- 代理在 Windows 上起服务：会话结束时后台任务可能跟着死，用 PowerShell 的 `Start-Process node -ArgumentList 'scripts/record/serve.mjs','--port','3430' -WorkingDirectory <web> -RedirectStandardOutput <日志>` 起一个独立进程。
- 代码改了要重新 `--build`（`.next` 每个 checkout 一份）。

**2. 录。**

```
node scripts/record/run.mjs 07 [--base-url http://localhost:3430] [--out D:/ripple-c2/rec/out] [--pace 1]
```

stdout 只有一段 JSON，Playwright 的输出走 stderr：

```json
{ "journey": "07", "name": "ask", "passed": true,
  "steps": [{ "n": 1, "t": "0:00.3", "phone": "陈先生的手机", "text": "……" }],
  "duration": 50.3, "file": "D:/ripple-c2/rec/out/07-ask/2026-10-10-1.mp4",
  "doc": "recordings/07-ask/2026-10-10-1.mp4",
  "video": { "width": 844, "height": 2008, "audio": true, "sizeMB": 1.38, "mbPerMinute": 1.64 },
  "clips": [...], "notifications": [...], "warnings": [], "raw": "D:/ripple-c2/rec/raw/07-ask/20261010-073130" }
```

退出码：0 通过并且 mp4 已写好；1 没通过（`error` 写着哪一步的哪个检查没过，`steps` 是走到的那几步，不出 mp4）；2 用法不对或 app 没起来。

**3. 放进进度库，更新主文档。** 把 mp4 复制到进度库的 `recordings/<编号>-<短名>/`（或者录的时候直接 `--out <进度库>/recordings`），再：

```
node scripts/record/update-doc.mjs --doc "<进度库>/主文档.md" --journey 07 --status 走得通 \
  --video recordings/07-ask/2026-10-10-1.mp4 [--issues "……"] [--now "……"] [--dry-run]
```

只改这条路那一节的「状态」「录屏」「已知问题」三行、「一览」表里这一行的状态和最新录屏、加 `--now` 时最上面「现在做到哪」那一行；别的字节一个不动。「录屏」一行是 Obsidian 能直接播的 `![[…]]`，后面跟一个 GitHub 上能点开的普通链接。「走得通」必须有录屏。`--dry-run` 只打印要改的行。

## 文件放哪

| 什么 | 哪里 |
|---|---|
| 脚本 | `e2e/journeys/<编号>-<英文短名>.journey.ts`，编号和主文档一致。一个文件一条路、一个 `journey(...)`。后缀是 `.journey.ts`，不是 `.spec.ts`：默认的 `playwright.config.ts` 因此不会把录屏脚本当普通 e2e 跑 |
| 录屏 | `D:/ripple-c2/rec/out/<编号>-<短名>/YYYY-MM-DD-<序号>.mp4`，日期按新加坡时间，序号是当天下一个空号。没通过不出 mp4 |
| 原始文件 | `D:/ripple-c2/rec/raw/<编号>-<短名>/<时间>/`：每台手机的 webm、抓到的声音、字幕图、ffmpeg 参数、`journey.json`、`transcript.md`（每一步的字幕和它在录屏里的时间），没通过时还有 Playwright 的 trace |
| 设置 | `playwright.journeys.config.ts`：手机 390×844、2 倍清晰度、zh-CN、Asia/Singapore、录像、点按前的停顿 |
| 工具 | `e2e/journeys/_kit/`；`scripts/record/` 里的 `serve.mjs`、`run.mjs`、`update-doc.mjs` |

## 模板

```ts
import { at, createSession } from "../helpers";
import { expect, journey } from "./_kit";

journey("07 问一句（含「能不能多吃一粒」）", async ({ kit, request }) => {
  // 1. 准备数据：用现成的 helpers，不进录屏
  const s = await createSession(request, { story_day: 29, story_time: "20:15" });

  // 2. 开手机，在第一步之前放到要拍的页面（录屏从第一步前 0.3 秒开始）
  const { elder } = await kit.phones({ elder: "陈先生的手机" });
  await elder.join(s.join_code, "patient", "/p/today");
  const pp = elder.page;

  // 3. 一步一步：字幕，动作，检查
  await kit.step(pp, "他在「今天」页的输入框里问一句");
  await kit.type(pp.getByTestId("ask-input"), "今天 150/95，我能不能多吃一粒？");
  await pp.getByTestId("ask-send").click();
  await expect(pp.getByTestId("ask-answer")).toHaveAttribute("data-complete", "true");

  await kit.step(pp, "点原话下面的播放键，听 Dr Lim 自己说这句（代录音）");
  await pp.getByTestId("answer-clip").first().click();
  await kit.waitForAudio("v2-u08", { until: "ended" });

  // 4. 最后一行
  await kit.finish();
});
```

两台手机：`const { elder, daughter } = await kit.phones({ elder: "陈先生的手机", daughter: "女儿的手机" })`，在录屏里从左到右就是这个顺序。`kit.step(daughter.page, "…")` 的字幕属于女儿的手机，录屏里她那台的名字会亮起来。

## kit 一览

| 用法 | 做什么 |
|---|---|
| `kit.phones({ 名字: "标签" })` | 开几台录像的手机（每台一个浏览器上下文），只调一次 |
| `phone.join(code, role, path?)` | 用加入码进演示场次，打开 `path` 或这个身份的首页，等事件流连上。拍进录屏的手机用它，不用 helpers 的 `joinAs`（那个开的浏览器不录像） |
| `phone.open(path)` | 打开一页并等事件流连上（演示页面）；没有事件流的页面直接 `phone.page.goto` |
| `kit.step(page, "字幕")` | 从现在到下一步，字幕条显示这句；记进 transcript；停够读完的时间再往下走 |
| `kit.type(输入框, 文字)` | 一个字一个字打进去（录屏里看得到在打字），再检查值 |
| `kit.show(元素)` | 平滑滚到屏幕中间，停一下 |
| `kit.pause(ms)` | 多停一会儿（乘以节奏系数） |
| `kit.showNotification(page, { title, body })` | 在这台手机顶上画一条手机通知横幅，滑进来、停几秒、滑出去。app 什么也没收到 |
| `kit.waitForAudio("网址的一段", { until })` | 等 app 放出这段声音（`until: "ended"` 等它放完）；没放就失败 |
| `kit.cornerLabel("转写：测试替身")` | 整段录屏右上角一个标签 |
| `await kit.finish()` | 最后一行：合成、混声音、压成 mp4，返回文件、时长、尺寸、有没有声音 |

准备数据、拨钟、读接口照旧用 `../helpers`：`createSession`、`at`、`api`、`getJson`、`doseRows`、`waitLive` 等，传 `request` 或某台手机的 `phone.context`。不要用 Playwright 自带的 `page`、`context` 拍录屏，它们不进合成。

## 字幕怎么写

- 一步一句中文陈述句：这一步画面上发生什么、为什么要紧。不写问句，主人公自己说的话用引号。
- 15 到 30 个字，最多两行；长了字号会自动缩小，再长就该拆成两步。
- 只写画面上看得到、检查也验过的事；测出来的数可以写进去（02 的字幕里写了实测的毫秒数）。
- 示意的东西写明白：推送还没做时的通知横幅、代录音、转写替身。Whisper 接上以前，看诊相关的录屏加 `kit.cornerLabel("转写：测试替身")`。
- 人物只用合成的：陈先生、Wei Ling、Dr Lim、Auntie Mei、药剂师 Raj。

## 节奏

- `kit.step()` 先让字幕停一会儿（按字数 1.6 到 4.2 秒），再做后面的动作。
- 每次点按、输入之前，目标会被圈出来 0.65 秒（设置里的 `video.show.actions`），看的人知道手要按哪里。
- 自己发生的事（到点的提醒、通知弹出）要让人看清，就在它后面加 `kit.pause()`。
- 有声音的步骤用 `kit.waitForAudio(…, { until: "ended" })` 等它放完再走下一步。
- `--pace 0`（或 `JOURNEY_PACE=0`）不停顿，只用来快速看脚本还过不过；那样的 mp4 太快，不放进进度库。

## 检查

- 每个动作后面都跟 `expect`。录屏脚本就是这条路的测试，检查写得和 `e2e/chains/` 一样严。
- 声音：`kit.waitForAudio` 证明真的放了；`finish()` 返回的 `hasAudio` 证明它进了 mp4。
- 「一秒内」这类时间要求：在两台手机的页面里各自记 `Date.now()` 再相减（见 `02-dose.journey.ts`），不要用 Node 这边的时间，点按前那 0.65 秒的停顿会算进去。

## 工具怎么做到的

- **字幕和手机名**：结束时用浏览器把每一步的字幕条画成图，ffmpeg 按每一步的时间叠在手机画面上方；正在操作的那台手机名字亮起来。字幕不盖住 app。
- **对时间**：开手机时把空白页涂黑一次并记下时刻，合成时在录像里找到变黑的那一帧，录像时间就和墙上时间对上了（误差约一帧，40 毫秒）。字幕、声音、两台手机都按它排。
- **声音**：每台手机的页面里挂了 `HTMLMediaElement.prototype.play` 的钩子，记下每段声音的网址和开始、停止的时刻；用这台手机的 cookie 把音频取回来，按时刻混进 mp4。抓不到 Web Audio 和 `speechSynthesis`。
- **通知横幅、点按标记**：画在 Playwright 自己的覆盖层里（页面外的封闭 shadow root），app 的选择器和字号检查碰不到它们，换页以后也还在。
- **清晰度**：Chromium 带 `--force-device-scale-factor=2` 启动，录像才是 780×1688 的真 2 倍；和 `deviceScaleFactor` 一起改。
- **成片**：单台 844×2008，两台 1664×2008；H.264，CRF 28，faststart，大约每分钟 1.5 MB。从第一步前 0.3 秒开始，到 `finish()` 后 2 秒结束。需要 PATH 上有 ffmpeg 和 ffprobe。

## 常见问题

- `the app does not answer`：先起 `serve.mjs`。
- 录像里页面只占左上角一块：Chromium 没带 `--force-device-scale-factor`（`journey.json` 的 `warnings` 会提示）。
- `sync mark not found`：开手机以后、第一步之前不要立刻关掉或刷新手机；时间会按开手机的时刻估计，可能差几帧。
- 页面一打开就自己刷新：连的是 `next dev`，换成 `serve.mjs`。
- 同一天录第二遍：序号自动加一，旧的留在文件夹里，主文档只挂最新一段。
