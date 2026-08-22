# 接手说明

> 生成于 2026-08-22 02:37  ·  刷新：`bun scripts/handoff.ts`
> 状态快照看 `docs/now.md`；这份讲的是**怎么接手**。

## 这是什么

`C:\aitrpg\poc` —— CoC 7e 跑团引擎。核心是「模组数据 + 规则引擎 + LLM 叙事」
跑完一局《普瑞米尔的谷仓》。**当前 HEAD**：60da428 docs: external review request for diagnostic criteria  ·  **测试**：1341 条 / 66 文件，全绿

三条并行的局面驱动是**有意为之**，不是重复实现：
剧本杀（`play-module.ts`）／自由跑团（`api/game-session.ts`）／命令行（`index.ts`）。

## 第一件事：读这三份

```
docs/now.md                          现在在哪（30 秒）
bun scripts/docs-index.ts todo warn  动手前要扫的坑
bun scripts/preflight.ts             跑一次，确认接手时是干净的
```

**不要整份读 `docs/architecture.json`**（36KB）。用查询：

```
bun scripts/docs-index.ts arch <关键词>    架构里找模块
bun scripts/docs-index.ts log <关键词>     查某问题记录过没有（搜正文）
```

## 工作纪律（踩出来的，不是规范文档）

1. 改动前后各跑一次 `bun scripts/preflight.ts`。它把反复犯的几类错做成了机器判据：切割截断语义单元、搬运残渣、循环依赖、语法错。别靠记性。

2. 同一类失误连着犯到第 3 次就停手，换一双眼睛（另一个模型 review diff）。本轮机械切割边界连错 5 次才自己发现——失效模式相同的人查不出自己的系统性错误。

3. **判据没验过就不算数**。写完诊断脚本先确认它能区分对错两种情形：第一版「切割截断」判据出了 174 个假阳性，第一版「倒下仍行动」判据永远报警。判据本身要做变异检验。

## 环境坑

- **PowerShell 5.1**。仓库源码 UTF-8 **无 BOM**，`Select-String`/`Get-Content`
  读中文会 mojibake → 用 Read/Grep 工具或 `fs.readFileSync`
- `bun run x.ts *> file` 会把 UTF-8 写坏。诊断脚本一律走回调在内存收，
  自己 `Bun.write` 落盘。**曾因此得出「12 局 0 次触发」的假结论**
- `git checkout <sha> -- <file>` 会**同时改索引**。变异检验后用 `Copy-Item` 还原即可，
  多跑一句 `git checkout HEAD --` 会把未提交的改动冲掉（踩过）
- 测试**只有条数是可靠回归信号**。已知两条偶发假红：
  `coc-engine.test.ts:131`、`npc-reaction.test.ts` 的「高稳定性减少负面情绪」

## 验证手段（离线，不用 API key）

| 脚本 | 量什么 |
|---|---|
| `tools/_diag-fuzz.ts` | 随机玩法通关率、有无死循环 |
| `tools/_diag-wounds.ts` | 伤势分级／重伤检定／惩罚骰 |
| `tools/_diag-combat.ts` | Boss 还手、玩家掉血 |
| `tools/_diag-downed.ts` | 昏迷的人有没有还在行动 |
| `tools/_diag-phrasing.ts` | 玩家说法能否匹配到场景 |

⚠ **这些判据本身出过六次错**（详见 `docs/review-request.md`）。
用它们之前先确认能区分对错两种情形，别信「全绿」。

## 手上还挂着的（3）

- ️ 「引擎别再替玩家挪窝」这一步单独做不成立（2026-08-20）
  `docs/notes/engine.md:514`
- ️ 引擎的移动是「给选项 + 不选就替你选」（2026-08-20）
  `docs/notes/engine.md:590`
- ️ 一直在报的那个数不衡量目标：可运行性是 1/27（2026-08-20）
  `docs/notes/ingest.md:743`

## 最近做了什么

- 60da428 docs: external review request for diagnostic criteria
- c8776e7 fix: tell the player when the engine picks the destination
- 06d796c chore: backup tiering shows only 500mb is irreplaceable
- ea62ae0 docs: workdir audit confirms archival is complete, flags backup risk
- 307fbae docs: mark stale conclusions in the player-agency notes
- 8c82675 fix: pass remaining investigable clues to move decision
- 9960c14 chore: preflight checks, session state file, working rules
- 38f83b1 merge: coc 7e unconscious rules
- 32d578e feat: unconscious investigators cannot act, first aid revives
- 511c575 merge: boss actually fights back
- 105a6c3 docs: boss fights back, and the downed-but-acting gap it exposed
- f8d2133 fix: boss actually fights back

## 代码地图

拆分之后 `play-module.ts` 只剩骨架（车卡／世界初始化／主 while／结局结算）：

| 文件 | 装什么 |
|---|---|
| `play/scene-pipeline.ts` | 一次进场的完整流水线（进场→NPC→对话→线索→选下一步） |
| `play/npc-dialogue.ts` | 对话生成 |
| `play/clue-check.ts` | 线索检定（skill 优先、failback 兜底） |
| `play/traps.ts` / `combat.ts` | 陷阱 / Boss 战 |
| `play/checks.ts` | 检定、伤势、伤害 |
| `play/run-state.ts` | 本局状态，按「谁在写」分组（Cast/Cursor/Dedup/WorldModelCtx） |
| `play/narration.ts` | 播报输出层 |

**依赖单向**：`play-module → play/*`。子模块反向 import 就是环，
preflight 会报（tsc 不报）。
