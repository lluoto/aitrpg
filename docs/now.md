# 现在在哪

> 每个会话开头读这一份就够。刷新：`bun scripts/now.ts`
> 生成于 2026-08-30 14:06

## 状态

| | |
|---|---|
| 分支 | `master` |
| HEAD | 09b4d2b feat: generate AGENTS.md from todo.json rule-* entries |
| 测试 | 2476 条 / 160 文件  全绿 |
| 工作树 | **6 个文件未提交** |

未提交：
- `M docs/handoff.md`
- `M docs/test-baseline.json`
- `M docs/todo.json`
- `M src/api/game-session.ts`
- `M src/api/server.ts`
- `?? src/__tests__/scene-suggestions.test.ts`

## 开工前

```
bun scripts/preflight.ts     # 改动前后各跑一次，机器判据挡住反复犯的错
bun scripts/now.ts           # 收工前刷新这份文件
```

## 已定位未修（13）

- ️ 「引擎别再替玩家挪窝」这一步单独做不成立（2026-08-20）
  `docs/notes/engine.md:514`
- ️ 引擎的移动是「给选项 + 不选就替你选」（2026-08-20）
  `docs/notes/engine.md:590`
- 载荷文档陈述反向传播进生产代码——这是第二次（2026-08-26）
  `docs/notes/engine.md:612`
- 改了被判据观测的行为，没同步检查观测者的失败分类——这是第三次（2026-08-27）
  `docs/notes/engine.md:636`
- 已知语义：activePlayerId 是粘性的，多端下会互相踩（2026-08-28）
  `docs/notes/engine.md:682`
- 可观测性复制了它要消除的歧义——这是第四次（2026-08-29）
  `docs/notes/engine.md:702`
- 防线装在让它永远通过的动作下游（2026-08-29）
  `docs/notes/engine.md:727`
- 声明式数据是装饰品——这是第五次（2026-08-29）
  `docs/notes/engine.md:747`
- 模拟换了输入分布，把唯一没结论的问题绕过去了（2026-08-29）
  `docs/notes/engine.md:767`
- 固定回合数把第 6 回合的发现埋进 24 回合噪音（2026-08-29）
  `docs/notes/engine.md:780`
- 外部模型的根因推测四条全错（2026-08-29）
  `docs/notes/engine.md:794`
- 整理索引的那一轮自己制造了悬空引用（2026-08-29）
  `docs/notes/engine.md:818`
- ️ 一直在报的那个数不衡量目标：可运行性是 1/27（2026-08-20）
  `docs/notes/ingest.md:745`

## 动手前先扫一眼的坑（31）

- 改动前后各跑一次 `bun scripts/preflight.ts`。它把反复犯的几类错做成了机器判据：切割截断语义单元、搬运残渣、循环依赖、语法错。别靠记性。
- 同一类失误连着犯到第 3 次就停手，换一双眼睛（另一个模型 review diff）。本轮机械切割边界连错 5 次才自己发现——失效模式相同的人查不出自己的系统性错误。
- **判据没验过就不算数**。写完诊断脚本先确认它能区分对错两种情形：第一版「切割截断」判据出了 174 个假阳性，第一版「倒下仍行动」判据永远报警。判据本身要做变异检验。
- 提交信息用英文、格式兼容 GitHub（只对新提交生效，不追溯历史）：subject 英文祈使句 + conventional 前缀（feat/fix/docs/test/refactor/chore）+ 冒号 + 空格，≤72 字符；允许在 `"..."` 或「...」内引用中文术语/原文（如 `
- 先想再写：不确定就问，把多种理解都列出来再动手。pendingConfirm 统一成单字段时没想过多 PC 场景——跨 PC 泄漏拖了一整轮才现形（5f01296）。
- 只改必须改的：顺手做的事一旦超出任务范围，副作用大概率不会被自己发现。索引轮静默把 index-world-model.md 从 348 行精简到 178 行，留下两处悬空引用（aca5d68）。
- 答案已经确定就用代码，别再问模型一遍。模组名里的「检查」把「加载模组」判成技能检定，改成前缀直接判定（src/llm/intent.ts:457-467）。
- token 预算是硬约束，加一条先考虑删一条。index-program.md 曾 2152 行/每次读约 40k token，拆成 JSON + 只追加的 log（f6f5a7a）。
- 先读再写，别只看片段就断言。「两套世界状态」读了字段才发现是一份状态两半实现，四处同一事实各存一份（todo-03）。
- 测试要验意图，不是验现状。32 态穷举发现声明式结局数据与硬编码 if 链有 10 态不一致，修的是数据不是判据（4f68eda）。
- 长流程要设检查点。模拟写死「跑满 30 回合」，第 6 回合已经脱轨，后面 23 回合都是在噪音里空转（docs/notes/engine.md:780）。
- 惯例优先于个人品味。提交信息在 0880f75→9afbe9e 之间无声从英文切到中文，354 条对 21 条一直没人察觉（todo-40）。
- 失败要主动喊出来，别指望别人从"零条 warn"里猜。围栏解析静默回落 regex 两轮模拟没定性（todo-29）；同一个"零"曾表示两种相反状态（0dbd2b8）；本轮启动挂起 8 分半没有任何信号（ebe9b95）。
- C:\aitrpg 下只有 poc/ 有版本控制和远端，其余 3.7GB 裸奔。**已分层，不必全备**：不可再生的只有 5239 个文件 / 500MB（源材料 474MB + 脚本 13MB + 手写设计 12MB），其余 3.2GB 是能重跑的抽取产物。执行 `bun scripts/back
- `src/__tests__/coc-engine.test.ts:131`「失败时损失 = sanCost 后半部分」：用 `new SanityEngine(1)` 凑「几乎必失败」，但 `coc-engine.ts:669` 的 `regularD100()` 没有种子，判定是 `roll <
- **先例存在、本轮不修**：它早于摄取管线，属规则引擎，修它要改 d100 的注入方式，是另一轮的活。依据：同 todo-08，已在后续某轮修掉（见 todo-08 的复核记录）。
- 但它现在比以前更碍事：摄取这条线的产物是**一个数**（17/20），下一轮要重新测量， 而「`bun test` 全绿」是那个数唯一的背书。一个 1% 说谎的套件会把每一次这样的背书都打个折。依据：同 todo-08，假红条件已消除。
- 实测：同为 1156 个测试的两次跑，`expect()` 总数是 9412 与 9410；1151 个测试那次是 9443。 摆动幅度远超测试数变化能解释的范围。原因大概率就是上面那条无种子的随机测试 （断言数随分支走向变化），但无论原因如何，结论一样：**比 `expect()` 数会被噪音骗到
- 代价要说清楚：**条数管不住「断言被就地改弱」**。把 `toEqual([...])` 改成 `toContain("2")` 条数不变而测试变瞎，本仓已经因为这个吃过三次亏。持续适用的方法论提醒，不是待修条目。
- 所以改断言的轮次必须额外做两件事：看**逐文件**的 `expect()` 增量（单文件是稳定的）， 以及对新断言做**变异检验**（把实现按发现描述的方式改坏，确认测试变红，再还原）。 本轮那个 `llm-json` 的裸围栏用例就是这么抓出来的——它一开始是假绿的。持续适用的工作方法，不是待修条
- 本仓源文件**不能过 PowerShell 写**（`Set-Content` 会把中文 mojibake）。读也一样，用 Read 工具。证据来源：2026-08-07 UTF-8 损坏事故，见 docs/incident-2026-08-07-utf8-corruption.md（已闭合，全仓 
- `bash` 工具的 `workdir` 参数会卡死，用 `cd C:\aitrpg\poc; ...`。永久性环境约束。
- 精确分析写临时 `.ts` 用 bun 跑，并让脚本自己 `Bun.write` 落盘，不要经控制台。永久性环境约束。
- `PlayerSlot.currentScene` 只在 `join` 时设，之后从不更新——因为唯一能更新它的 `setPlayerScene`（见 todo-23）零调用方。这是 `scene_restricted` 可见性档位「三个独立的坑」之一（另两个坑：比的是活动玩家场景不是消息所属场景；
- `ws-handler.ts:63-70 broadcastToSession` 不按玩家过滤——线索私密（discoverer_only）在**存储的历史**层面成立（`GET /history?pcId=` 只返回该玩家可见的消息），但 live 的 WS 广播仍然把完整 narrative 推
- 摄取管线 `build-scenes.ts:99 clues: []`——摄取出来的每个场景一条线索都不产，实跑产物显示 24 场景的线索总数为 0。结局条件编译（属于另一轮「B」的范围）依赖场景能带线索，这条不修，那条无从谈起。
- 意图误判率约 20%（30 回合 6 次判错），两次模拟都没能定性根因——第二次模拟换了输入分布，判错次数从 6 次变成 0 次，但当时不能证明问题不存在。**根因已定位并修复（修A，2026-08-29）**：analysis/sim/2026-08-28-barn-a-acceptance.md
- 「经历模组: 0」这条统计是否仍然存在——未验证。`career.ts:265` 的相关逻辑挂在从不实例化的 `CareerStore` 类里（见 todo-02/todo-05），实际在用的是 `CareerFileStore`，需要先确认「经历模组」这个统计口径在 `CareerFileStor
- 开发A实测发现：`END_NARRATIONS`（barn-of-premier.ts）requiredScenes 引用的场景 id 是 ASCII（如 "maintenance_room"），而 GameSession 加载模组时经 bridgeBarnOfPremierClues() 只桥接了
- 服务端口是 **3099**，不是 3000（`src/api/server.ts:1037`，用环境变量 `PORT` 覆盖）。模拟实跑用的 prompt 模板里从来没写过这一点，容易按习惯默认成 3000 去连。启停服务器用 `bun run dev-server:start` / `:stop
- 维森酒吧的运行时在场实体只有 `酒吧保镖`，但可发现线索的 findMethods/叙述仍指向不存在的「前台」「其他人」（clue_bar_mass_booking / clue_bar_guest_identity / clue_bar_ask_around），实跑还出现保镖编造「老板锁进抽屉」—

## 最近提交

- 09b4d2b feat: generate AGENTS.md from todo.json rule-* entries
- bbdd492 docs: add rule-05..rule-13, repo-specific coding lessons
- fb46583 fix: compound-move re-ask should not fire on incidental scene mentions
- 5f01296 fix: pendingConfirm must know who asked (cross-PC leakage)
- ebe9b95 fix: stop dev-server.ps1 from hanging its caller (plan B)
- 25db89b docs: wrap up scene-id bridge and run-harness round
- 642e5a3 feat: add deterministic run harness for GameSession free-roam path
- f522b78 fix: bridge scene ids so True End is reachable (todo-34)

## 找东西

| 我想…… | 怎么做 |
|---|---|
| 看架构 | `bun scripts/docs-index.ts arch <关键词>` |
| 查某问题记录过没 | `bun scripts/docs-index.ts log <关键词>` |
| 看全部待办 | `bun scripts/docs-index.ts todo` |
| 读记录正文 | 按 `log` 给出的 `file:line` 用 Read 取 |

⚠ **不要用 `Select-String` / `Get-Content` 读仓库源码** —— UTF-8 无 BOM，
PowerShell 会退回 ANSI 码页，中文全成乱码。用 Read/Grep 工具或 `fs.readFileSync`。
