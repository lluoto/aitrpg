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
| 看待办 / 已知的坑 | `docs/todo.json` | 16 条。`severity=warn` 的 9 条是踩过的坑 |
| 查某个问题查过没有 | `docs/notes/index.json` | 53 条元数据（标题/日期/状态/摘要/行号） |
| 读某条记录的正文 | `docs/notes/<组>.md` | ingest 40 条 · engine 11 条 · rules 2 条 |

放 `docs/` 不放 `.opencode/`：后者被 `.gitignore` 排除，
而架构与待办是**项目知识**不是会话状态，clone 下来必须还在。

## 维护

```
bun scripts/docs-index.ts          # 追加记录后重建 notes/index.json
```

- **新增记录**：追加到 `docs/notes/<组>.md`，标题用 `### ✅/❓/⚠ 标题（日期）`，再重跑上面那条
- **改架构/待办**：直接编辑对应 JSON
- ⚠ 中文文件**不要过 PowerShell 写**（会 mojibake），用编辑器或 bun 脚本
