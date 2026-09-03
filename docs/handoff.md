# 接手说明

> 生成于 2026-09-03 05:14  ·  刷新：`bun scripts/handoff.ts`
> 状态快照看 `docs/now.md`；这份讲的是**怎么接手**。

## 这是什么

`C:\aitrpg\poc` —— CoC 7e 跑团引擎。核心是「模组数据 + 规则引擎 + LLM 叙事」
跑完一局《普瑞米尔的谷仓》。**当前 HEAD**：e72fd6b docs: note that 3/3 acceptance doesn't yet show the gate has bite  ·  **测试**：2838 条 / 184 文件，全绿（基线 2838，一致）

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

4. 提交信息用英文、格式兼容 GitHub（只对新提交生效，不追溯历史）：subject 英文祈使句 + conventional 前缀（feat/fix/docs/test/refactor/chore）+ 冒号 + 空格，≤72 字符；允许在 `"..."` 或「...」内引用中文术语/原文（如 `fix: "潜行" was listed as an attack verb`）。空一行。body 每行 ≤72 字符手动换行——正文长不是问题，不换行才是（GitHub 不折行，会横向滚动）。**body 不用 markdown 粗体/斜体**：GitHub 提交消息不渲染 markdown，`**x**` 会原样显示成星号；「」中文引号没问题，继续用。模板见 `.gitmessage`（生效需手动 `git config commit.template .gitmessage`，这条配置不随提交走，新 clone 默认不生效）。实测最近 80 条：英文标题 55 条平均 82 字符、超 72 的 30 条（55%），说明「英文」不等于「兼容 GitHub」，是两件事，这条约定对两者都管。已有 347 条英文历史提交（含切到中文前那 320+ 条）与 28 条中文提交（`9afbe9e` 起）都不按这条约定判违规——切换点 `0880f75`（最后一条英文）→`9afbe9e`（第一条中文）是有意决策，不是事故，中文提交保留原样不重写。机器判据见 `.githooks/commit-msg` + `core.hooksPath`，preflight 第 12 项检查是否真的装上；未装上时这条只能靠人遵守。

5. 先想再写：不确定就问，把多种理解都列出来再动手。pendingConfirm 统一成单字段时没想过多 PC 场景——跨 PC 泄漏拖了一整轮才现形（5f01296）。

6. 只改必须改的：顺手做的事一旦超出任务范围，副作用大概率不会被自己发现。索引轮静默把 index-world-model.md 从 348 行精简到 178 行，留下两处悬空引用（aca5d68）。

7. 答案已经确定就用代码，别再问模型一遍。模组名里的「检查」把「加载模组」判成技能检定，改成前缀直接判定（src/llm/intent.ts:457-467）。

8. token 预算是硬约束，加一条先考虑删一条。index-program.md 曾 2152 行/每次读约 40k token，拆成 JSON + 只追加的 log（f6f5a7a）。

9. 先读再写，别只看片段就断言。「两套世界状态」读了字段才发现是一份状态两半实现，四处同一事实各存一份（todo-03）。

10. 测试要验意图，不是验现状。32 态穷举发现声明式结局数据与硬编码 if 链有 10 态不一致，修的是数据不是判据（4f68eda）。

11. 长流程要设检查点。模拟写死「跑满 30 回合」，第 6 回合已经脱轨，后面 23 回合都是在噪音里空转（docs/notes/engine.md:780）。

12. 惯例优先于个人品味。提交信息在 0880f75→9afbe9e 之间无声从英文切到中文，354 条对 21 条一直没人察觉（todo-40）。

13. 失败要主动喊出来，别指望别人从"零条 warn"里猜。围栏解析静默回落 regex 两轮模拟没定性（todo-29）；同一个"零"曾表示两种相反状态（0dbd2b8）；本轮启动挂起 8 分半没有任何信号（ebe9b95）。

14. 提交信息的语言在 `0880f75`（最后一条英文）→ `9afbe9e`（第一条中文）之间无声切换，此后（2026-08-30 实测，`git rev-list --count 9afbe9e..HEAD`=20，加 9afbe9e 本身共 21）21 条全中文，之前 354 条全英文（含 7 条在英文句子里用 `"..."`/「...」引用中文术语，如 `fix: "潜行" was listed as an attack verb`——那 7 条整体仍算英文，不是例外）。**已裁决保留这 21 条中文提交原样，不重写历史**：正文信息密度很高（根因链条、变异检验记录、实测数字），重写的收益是"好看"，风险是"弄坏一批高质量记录"。往后新提交按 rule-04 用英文——这是两件独立的事："保留旧的"和"新的怎么写"不冲突，也不代表旧的违反了当时不存在的规则。免得后人翻 git log 时以为切换点是一次事故。

15. 语义矛盾探针（`scripts/diag/probe-semantic-contradiction.ts`）是非确定性判据（LLM 驱动），只能告警、不能当 preflight 门禁——不接入 `bun test`，产物落 `analysis/`（gitignored），任何候选都需要人工核对原文后裁决。引用它的结论（准确率、误判数）时必须记模型名/日期/样本数，不能当常量用：实测 ecnu-plus 即使 temperature=0，同一批校准样本连跑 3 轮结果都有波动（校准命中率 15/21，两个已知阳性均在多数轮次里被正确标出），单轮结果不足以判断探针灵不灵。

16. `end-narration-32-states.test.ts` 里的旧 `oldIfChainOracle` 32 态穷举已 `describe.skip` 退役（开发·摄取管线校准 阶段3，`966f9e0`）——它冻结的是「if 链 → 声明式求值器」那次重构的行为基准，这一轮 True End 条件被故意改变，继续拿它当基准等于用上一次的契约阻止这一次的变更。文件里保留但跳过（不删除），是为了让后人知道这段历史存在、不是被随手抹掉。`bun test` 报的 32 条 skip 均来自这里，是有意为之，不是被跳过的失败——回归核查时看到 32 skip 不必追查，看到这个数字变化（无论增减）才需要关注。

## 启动后端做实跑（模拟局/手动测试）

**不要**用 `start "" /b bun run server > out.log 2> err.log`——这条写法
两个毛病占全了：`bun run server` 是包装脚本，会再 spawn 一个子进程，
杀掉包装脚本后真正监听端口的那个变成孤儿；`start /b` 不脱离控制台，
子孙进程继承调用者的 stdout/stderr 句柄，等的是"管道关闭"不是"进程退出"，
工具会永远等不到 EOF、空转。正确用法已经写进仓库（这条已经在模拟 prompt
里丢过一次，模拟 prompt 每轮重写不算数，脚本才算）：

```
bun run dev-server:start     启动，PID 落 .dev-server.pid，日志落 server-out.log / server-err.log
bun run dev-server:stop      按 PID 干净地杀掉，不留孤儿
bun run dev-server:status    看还在不在
```

服务端口默认 **3099**（不是 3000），见 `src/api/server.ts:1037`，用环境变量
`PORT` 覆盖。脚本本体：`scripts/dev-server.ps1`。

## 提交信息（rule-04，只对新提交生效，不追溯历史）

subject 英文祈使句 + conventional 前缀（feat/fix/docs/test/refactor/chore）+
冒号 + 空格，**≤72 字符**；允许在 `"..."` 或「...」内引用中文术语/原文
（如 `fix: "潜行" was listed as an attack verb`）。空一行。body 每行 ≤72
字符手动换行——正文长不是问题，不换行才是（GitHub 不折行会横向滚动）。
**body 不用 markdown 粗体/斜体**：GitHub 提交消息不渲染 markdown，
`**x**` 会原样显示成星号；「」中文引号没问题。模板：`.gitmessage`
（生效需手动 `git config commit.template .gitmessage`，不随提交走）。

⚠ 「回到英文」不等于「兼容 GitHub」：已有 347 条英文历史提交里，最近
80 条的英文标题平均 82 字符、超 72 的占 55%——本身就不兼容这条规则，
只是没人量过。这条约定不追溯：历史提交（含 28 条中文，切换点
`0880f75`→`9afbe9e`，有意决策不是事故）一律不重写。

机器判据：`.githooks/commit-msg` + `core.hooksPath`，preflight 第 12 项
检查是否真的装上——没装上时这条纯靠人遵守，装了没配置和没装看不出区别。

## 环境坑

- **PowerShell 5.1**。仓库源码 UTF-8 **无 BOM**，`Select-String`/`Get-Content`
  读中文会 mojibake → 用 Read/Grep 工具或 `fs.readFileSync`
- `bun run x.ts *> file` 会把 UTF-8 写坏。诊断脚本一律走回调在内存收，
  自己 `Bun.write` 落盘。**曾因此得出「12 局 0 次触发」的假结论**
- `git checkout <sha> -- <file>` 会**同时改索引**。变异检验后用 `Copy-Item` 还原即可，
  多跑一句 `git checkout HEAD --` 会把未提交的改动冲掉（踩过）
- 测试**只有条数是可靠回归信号**，基线在 `docs/test-baseline.json`；
  `expect()` 计数会被无种子的随机测试搅动。已知两条偶发假红：
  `coc-engine.test.ts:131`、`npc-reaction.test.ts` 的「高稳定性减少负面情绪」
- `typescript@7.0.2` 是 native preview，`require("typescript")` **没有** `createSourceFile`。
  要解析 TS 就用 `Bun.Transpiler`（`scanImports()` 是真解析器）

## 验证手段（离线，不用 API key）

| 脚本 | 量什么 | 判据在哪 | 校准测试 |
|---|---|---|---|
| `scripts/diag/diag-fuzz.ts` | 通关率（= 正常返回**且**有正式结局）、死循环 | `src/diagnostics/fuzz.ts` | `diag-fuzz.test.ts` |
| `scripts/diag/diag-wounds.ts` | 伤势分级／重伤检定／惩罚骰 | `src/diagnostics/wounds.ts` | `diag-wounds.test.ts` |
| `scripts/diag/diag-combat.ts` | Boss 还手（按攻击者身份，不按技能名）、玩家掉血 | `src/diagnostics/combat.ts` | `diag-combat.test.ts` |
| `scripts/diag/diag-downed.ts` | 昏迷期间本人是否还在**掷骰** | `src/diagnostics/downed.ts` | `diag-downed.test.ts` |
| `scripts/diag/diag-phrasing.ts` | 玩家说法能否匹配到场景 | `src/diagnostics/phrasing.ts` | `diag-phrasing.test.ts` |
| `scripts/diag/audit-backup.ts` | 哪些数据丢了不可再生 | `src/diagnostics/backup-classify.ts` | `diag-backup-classify.test.ts` |
| `scripts/diag/probe-llm.ts` | LLM 通不通（**实际发一次请求**） | — | — |
| `scripts/diag/probe-llm-move.ts` | LLM 消歧值不值得接（重点是它肯不肯说「说不准」） | — | — |

⚠ 上面五个跑局脚本都写死 `LLM_DISABLED=true` —— **它们量的是离线行为**。
这不是缺陷（要可复现），但别把结论当成「整个引擎都这样」。
判断 LLM 通不通**必须实际发一次请求**：`bun scripts/diag/probe-llm.ts`。
`bun test` 输出里那句 `[config] No LLM_API_KEY set` 是**测试在验证无 key 的降级路径**，
跟真实可用性无关，最容易被当成证据。

⚠ **这些判据本身出过六次错**（详见 `docs/review-request.md`）。已做的返工：

1. **判据与脚本分开**。判断逻辑抽成纯函数放 `src/diagnostics/`（入库、可测），
   `scripts/diag/*` 只负责跑局和排版。早先脚本本体放在 `tools/`（.gitignore
   排除），判据留在那里等于没人守——后来整批搬进了 `scripts/diag/` 并入库。
2. **每条判据三种输入都有测试**：行为正确 → 通过；目标行为错误 → 失败；
   文本相似但合法 → 不误报。少了第二种就是「永远通过」，少了第三种就是「永远报警」。
3. **不再猜自然语言**。诊断读 `src/play/events.ts` 的结构化事件流，
   因为有些事实**文本里根本不存在**：重伤体质检定失败导致的昏迷没有 `HP n → 0` 那行，
   `➜ 米戈 【格斗】` 看不出攻击者是敌是我。补正则只会补出下一个假阳性。
4. **seed 现在控制整局**（`src/diagnostics/run-harness.ts` 接管 `Math.random`）。
   实测：同 seed 的事件流与播报文本**都可复现**，可作确定性回归依据。
   `scripts/diag/diag-fuzz.ts` 每次都把这条自检的结果打出来 —— 它是量出来的，不是声称的。

用它们之前仍然先确认能区分对错两种情形，别信「全绿」。
判据自己会说明三种「不算通过」的情形：
样本数为 0（没有可判的样本）、身份不可分辨（两名调查员重名）、以及本轮有异常局。

**这套判据上线后立刻报出真缺陷，都已修**（各带正/反/干扰三侧测试 + 变异检验）：

| 缺陷 | 谁报出来的 | 旧判据为什么看不见 |
|---|---|---|
| `askCounts` 模块级 Map 跨局残留 | fuzz 的复现自检 | 旧脚本没有复现自检 |
| 昏迷者还在掷「挣脱陷阱」 | downed | 那条昏迷路径没有 `HP n → 0` 播报 |
| 昏迷的同伴还在掷急救 | downed | 同上（且两人重名时无法归属） |
| 战斗攻击不读伤势惩罚 | wounds 的惩罚骰分账 | 旧判据数 `/惩罚骰/` 行数，疲劳的照样计数 |
| 两名调查员可能重名 | downed 的身份不可分辨检测 | 名字是日志里唯一的身份标记 |

用法：跑局类脚本都收 `[局数] [起始局号]`，
`bun scripts/diag/diag-downed.ts 3 4` = 第 4~6 局，便于分批跑而不重叠。

## 手上还挂着的（21）

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
- 两个运行时各持一半——这是第四次（2026-09-01）
  `docs/notes/engine.md:836`
- 引擎教了玩家一个自己不认识的词——这是第二次（2026-09-02）
  `docs/notes/engine.md:872`
- ️ 一直在报的那个数不衡量目标：可运行性是 1/27（2026-08-20）
  `docs/notes/ingest.md:747`
- 手抄本没有校验源就必然漂移（2026-09-02）
  `docs/notes/ingest.md:1584`
- 工具绿灯 ≠ 没问题——三方审计的能力边界撞上真实案例（2026-09-02）
  `docs/notes/ingest.md:1616`
- 改一处漏同文件另一处（2026-09-02）
  `docs/notes/ingest.md:1647`
- 管线继承基准 id：把命名体系差异从内容差异里摘出来（2026-09-02）
  `docs/notes/ingest.md:1679`
- 块分类几乎全灭：JSON 键带正文，不是 token 截断（2026-09-02）
  `docs/notes/ingest.md:1718`
- 展示格式渗进输出契约——这是第三次（2026-09-02）
  `docs/notes/ingest.md:1746`

## 最近做了什么

- e72fd6b docs: note that 3/3 acceptance doesn't yet show the gate has bite
- f5c7b3a docs: give the fabrication-registry's zero a real meaning
- 80abf68 fix: restore photo_farm's actual investigation beat from source
- cd028c9 docs: refresh now/handoff and log the alias-migration round baseline
- 16591b9 feat: teach the matcher instead of rejecting unrecognized aliases
- 45f604f feat: give matchTexts a landing spot instead of nowhere
- d859149 refactor: migrate hardcoded clue/scene aliases into module data
- f8516bb docs: resolve four leftover narrative-round questions (A1-A4)
- c506a2c docs: record the three real gate rejections and update todo-52
- 349c14f feat: isolate creative-layer output from the calibration diff
- a2482e0 feat: generate the pipeline's first creative-layer content (todo-52)
- e2c7a42 docs: charter the narrative-generation round (todo-52)

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
