# Built with CodeBuddy · 用 CodeBuddy 开发

Screenshots of our CodeBuddy conversation on 9 Oct 2026 (01:21 to 06:30 SGT, Craft mode), in which CodeBuddy built the first milestones of the Challenge 2 web app from our task cards. The conversation is in Chinese.

我们 2026 年 10 月 9 日（新加坡时间 01:21 到 06:30，Craft 模式）和 CodeBuddy 的对话截图：CodeBuddy 按我们的任务单，做出了题 2 网页应用最早的几个里程碑。对话是中文的。

| | English | 中文 |
|---|---|---|
| [01](01-codebuddy-reads-the-project-rules.jpg) | CodeBuddy reads the project: `CODEBUDDY.md`, the three rules in `.codebuddy/rules/` (never cross into clinical advice; keys only in `web/.env`; follow the design direction) and the task cards M0 to M9, then proposes to start with M0. | CodeBuddy 读项目：`CODEBUDDY.md`、`.codebuddy/rules/` 里的三条规则（绝不越界给临床建议；密钥只放 `web/.env`；按设计方向做）和 M0 到 M9 的任务单，然后提出从 M0 开始。 |
| [02](02-codebuddy-connects-deepseek-and-plans-m0-m7.jpg) | It connects the DeepSeek model, the language model we used until 16 Oct 2026 (now Tencent Cloud Hunyuan), through `web/.env` (the key is read from the file, never printed), updates `.env.example` and `CODEBUDDY.md`, and plans task cards M0 to M7. | 通过 `web/.env` 接入 DeepSeek（10 月 16 日之前用的语言模型，现在换成了腾讯云混元；密钥从文件读，不打印出来），更新 `.env.example` 和 `CODEBUDDY.md`，排好 M0 到 M7。 |
| [03](03-codebuddy-builds-and-runs-the-tests.jpg) | It edits the code and checks each change: production build, type check, lint, the evaluation set, unit tests and Playwright end-to-end tests. | 改代码，并且每次改动都检查：生产构建、类型检查、lint、评测集、单元测试和 Playwright 端到端测试。 |
| [04](04-codebuddy-finishes-m1-safety-layer.jpg) | M1 (the safety layer and the question API) done: task list 6/6, unit tests 50/50, the 51-question evaluation 51/51 with the stub and with DeepSeek (the model at the time), end-to-end 8/8. | M1（安全层和问答接口）完成：任务 6/6，单元测试 50/50，51 题评测用替身和 DeepSeek（当时的模型）都是 51/51，端到端 8/8。 |
| [05](05-codebuddy-m1-results-closeup.jpg) | A close-up of the M1 results. | M1 结果的特写。 |
