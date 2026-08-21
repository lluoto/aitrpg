# 现在在哪

> 每个会话开头读这一份就够。刷新：`bun scripts/now.ts`
> 生成于 2026-08-21 13:25

## 状态

| | |
|---|---|
| 分支 | `master` |
| HEAD | 38f83b1 merge: coc 7e unconscious rules |
| 测试 | （本次未跑） |
| 工作树 | **7 个文件未提交** |

未提交：
- `M docs/notes/index.json`
- `M docs/notes/rules.md`
- `M docs/todo.json`
- `M src/play-module.ts`
- `?? docs/now.md`
- `?? scripts/now.ts`
- `?? scripts/preflight.ts`

## 开工前

```
bun scripts/preflight.ts     # 改动前后各跑一次，机器判据挡住反复犯的错
bun scripts/now.ts           # 收工前刷新这份文件
```

## 已定位未修（3）

- ️ 「引擎别再替玩家挪窝」这一步单独做不成立（2026-08-20）
  `docs/notes/engine.md:514`
- ️ 引擎的移动是「给选项 + 不选就替你选」（2026-08-20）
  `docs/notes/engine.md:540`
- ️ 一直在报的那个数不衡量目标：可运行性是 1/27（2026-08-20）
  `docs/notes/ingest.md:743`

## 动手前先扫一眼的坑（12）

- 改动前后各跑一次 `bun scripts/preflight.ts`。它把反复犯的几类错做成了机器判据：切割截断语义单元、搬运残渣、循环依赖、语法错。别靠记性。
- 同一类失误连着犯到第 3 次就停手，换一双眼睛（另一个模型 review diff）。本轮机械切割边界连错 5 次才自己发现——失效模式相同的人查不出自己的系统性错误。
- **判据没验过就不算数**。写完诊断脚本先确认它能区分对错两种情形：第一版「切割截断」判据出了 174 个假阳性，第一版「倒下仍行动」判据永远报警。判据本身要做变异检验。
- `src/__tests__/coc-engine.test.ts:131`「失败时损失 = sanCost 后半部分」：用 `new SanityEngine(1)` 凑「几乎必失败」，但 `coc-engine.ts:669` 的 `regularD100()` 没有种子，判定是 `roll <
- **先例存在、本轮不修**：它早于摄取管线，属规则引擎，修它要改 d100 的注入方式，是另一轮的活。
- 但它现在比以前更碍事：摄取这条线的产物是**一个数**（17/20），下一轮要重新测量， 而「`bun test` 全绿」是那个数唯一的背书。一个 1% 说谎的套件会把每一次这样的背书都打个折。
- 实测：同为 1156 个测试的两次跑，`expect()` 总数是 9412 与 9410；1151 个测试那次是 9443。 摆动幅度远超测试数变化能解释的范围。原因大概率就是上面那条无种子的随机测试 （断言数随分支走向变化），但无论原因如何，结论一样：**比 `expect()` 数会被噪音骗到
- 代价要说清楚：**条数管不住「断言被就地改弱」**。把 `toEqual([...])` 改成 `toContain("2")` 条数不变而测试变瞎，本仓已经因为这个吃过三次亏。
- 所以改断言的轮次必须额外做两件事：看**逐文件**的 `expect()` 增量（单文件是稳定的）， 以及对新断言做**变异检验**（把实现按发现描述的方式改坏，确认测试变红，再还原）。 本轮那个 `llm-json` 的裸围栏用例就是这么抓出来的——它一开始是假绿的。
- 本仓源文件**不能过 PowerShell 写**（`Set-Content` 会把中文 mojibake）。读也一样，用 Read 工具。
- `bash` 工具的 `workdir` 参数会卡死，用 `cd C:\aitrpg\poc; ...`
- 精确分析写临时 `.ts` 用 bun 跑，并让脚本自己 `Bun.write` 落盘，不要经控制台

## 最近提交

- 38f83b1 merge: coc 7e unconscious rules
- 32d578e feat: unconscious investigators cannot act, first aid revives
- 511c575 merge: boss actually fights back
- 105a6c3 docs: boss fights back, and the downed-but-acting gap it exposed
- f8d2133 fix: boss actually fights back
- d08a681 merge: extract scene pipeline
- dc4d9c2 docs: scene pipeline extraction and the cut-in-half lesson
- a265069 refactor: extract scene pipeline and move utilities

## 找东西

| 我想…… | 怎么做 |
|---|---|
| 看架构 | `bun scripts/docs-index.ts arch <关键词>` |
| 查某问题记录过没 | `bun scripts/docs-index.ts log <关键词>` |
| 看全部待办 | `bun scripts/docs-index.ts todo` |
| 读记录正文 | 按 `log` 给出的 `file:line` 用 Read 取 |

⚠ **不要用 `Select-String` / `Get-Content` 读仓库源码** —— UTF-8 无 BOM，
PowerShell 会退回 ANSI 码页，中文全成乱码。用 Read/Grep 工具或 `fs.readFileSync`。
