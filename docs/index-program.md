# 代码索引 — 程序本身

> 这份文件原本 2152 行 / 151KB，每次读要 ~40k token，九成内容跟当次任务无关。
> 现在拆成三块：**架构走 JSON、待办走 JSON、log 只追加**。
> 姊妹篇 `docs/index-world-model.md`（世界模型与模组内容）。

## 先用查询，别整份读

**JSON 是给脚本读的。整份 Read 会把省下来的 token 又花回去。**

```
bun scripts/docs-index.ts arch              # 列出架构有哪些节
bun scripts/docs-index.ts arch 陷阱         # 只打印命中的行
bun scripts/docs-index.ts todo warn         # 只看踩过的坑
bun scripts/docs-index.ts log failback      # 搜 log 正文，给出 file:line
```

`log` 搜的是**正文**不只是标题——像 `failback`、`chooseConnection`
这种词多半只出现在正文里。命中后再用 Read 按 `file`+`line` 取那一段。

## 各文件

| 我想…… | 读这个 | 说明 |
|---|---|---|
| 看架构地图 / 某个模块在哪 | `docs/architecture.json` | 15 节。用 `arch <关键词>` 取，别整读（36KB） |
| 看待办 / 已知的坑 | `docs/todo.json` | 条数跑 `bun scripts/docs-index.ts todo warn` 看，`severity=warn` 的是踩过的坑。⚠ `severity` 只分 warn/info/cleanup，不代表办没办完——还有个独立的 `status` 字段：`open`(尚待处理，20)/`done`(已解决或已确认不存在，5)/`by-design`(有意为之，10)/`superseded`(被另一条覆盖，见 `mergedInto`，1)。`docs-index.ts` 目前**不支持按 status 查询**（`todo <severity>` 只按 severity 过滤），要看 status 得直接 `Read docs/todo.json` 或用 `bun -e` 过滤 |
| 查某个问题查过没有 | `docs/notes/index.json` | 元数据（标题/日期/状态/摘要/行号）；这份索引本身就是给脚本查的，别在这里写死条数 |
| 读某条记录的正文 | `docs/notes/<组>.md` | 按组分文件（ingest/engine/rules…），条数跑 `bun scripts/docs-index.ts log <关键词>` 现查 |
| 看某次事故的完整复盘 | `docs/incident-*.md` | 时点事故记录，如 `docs/incident-2026-08-07-utf8-corruption.md`（UTF-8 损坏事故：根因、修复、判据补强） |
| 看世界模型索引精简前的历史内容 | `docs/archive-world-model-2026-08.md` | 2026-08-29 从 `docs/index-world-model.md` 归档出来的旧清点/一次性核对记录/`relics/` 子工程，不在当前地图范围但入库可查 |

放 `docs/` 不放 `.opencode/`：后者被 `.gitignore` 排除，
而架构与待办是**项目知识**不是会话状态，clone 下来必须还在。

## 维护

```
bun scripts/docs-index.ts          # 追加记录后重建 notes/index.json
```

- **新增记录**：追加到 `docs/notes/<组>.md`，标题用 `### ✅/❓/⚠ 标题（日期）`，再重跑上面那条
- **改架构/待办**：直接编辑对应 JSON
- ⚠ 中文文件**不要过 PowerShell 写**（会 mojibake），用编辑器或 bun 脚本
