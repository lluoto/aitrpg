# 被源码引用的实跑证据

这里放的是**代码注释点名引用过**的原文——不只是跑局原文，还有摄取管线
的产物（见下）。

## 为什么要单独存一份

`play-logs/` 在 `.gitignore` 里 —— 它是本机跑局的产物，一天能攒几十个。
但有**六处**源码注释拿其中的文件当证据：

| 引用处 | 引用的文件 |
|---|---|
| `src/__tests__/dialogue-lead.test.ts:15` | `run-2026-08-18T06-06-34.txt` |
| `src/play/npc-text.ts:146` | `run-2026-08-18T06-06-34.txt` |
| `src/__tests__/speech-plan.test.ts:59` | `run-2026-08-18T03-41-30.txt` |
| `src/llm/generate-llm-expanded.ts:117` | `run-2026-08-18T06-50-07.txt` |
| `src/ingest/calibrate.ts:4` | `CALIBRATION_REPORT.md` |
| `src/ingest/scoring-key.ts:15` | `key-worksheet.txt` |

被引用的是 **5 个文件**（3 份跑局原文 + `key-worksheet.txt` +
`CALIBRATION_REPORT.md`），不全是「跑局原文」——`key-worksheet.txt` 出自
`tools/_gen-key-worksheet.ts`，`CALIBRATION_REPORT.md` 是
`tools/calibrate.mjs` 的 stdout dump，两个都是摄取管线的产物，不是某一
局对话记录。加上这份 README 自己，目录里共 6 个文件入库。

那些注释写的是「实跑原文见 …」/「工作表在 …」—— 可**克隆下来的人根本
打不开那个文件**。一句指向不存在之物的证据，读起来像有据可查，实际
等于没有。

这和这个仓库反复修过的是同一类问题：
摄取入口曾躺在 gitignored 的 `tools/` 里、tsconfig 曾编译 `tools/`、
测试曾读机器本地的 `data/npc.db` —— **仓库状态与本机状态分叉**。

所以：被引用的那几份复制进来入库（5 个文件共 165 KB，其中 3 份跑局原文
合计 134 KB），其余日志仍旧不入库——不追平具体条数，那是 gitignored 的
`play-logs/`（见 `.gitignore:16`），新克隆里本来就看不到，写死一个数字
只会跟着本机的日志堆积速度漂移。
判据很简单 —— **代码里引用了哪一份，哪一份就得进得来**。

## 加新证据的规矩

先问自己：这句注释是不是真的需要一份原文才能成立？
需要，就把那一份拷进来；不需要，就别在注释里点文件名。
不要整目录往里倒 —— 这里是证据，不是日志归档。
