# 接手说明

> 生成于 2026-09-17 04:44  ·  刷新：`bun scripts/handoff.ts`
> 状态快照看 `docs/now.md`；这份讲的是**怎么接手**。

## 这是什么

`C:\aitrpg\poc` —— 自主 AI RPG 引擎：模组机制编译为确定性、可验证的执行结构，
规则与状态由代码管理，LLM 只提出候选与叙事。**当前 HEAD**：9354054 feat: integrate compiled artifacts with GameSession  ·  **测试**：3201 条 / 220 文件，全绿（基线 3201，一致）

三条并行的局面驱动是**有意为之**，不是重复实现：
剧本杀（`play-module.ts`）／自由跑团（`api/game-session.ts`）／命令行（`index.ts`）。

## 编译闭环检查点 I 交接

`docs/compiler-master-plan.md` 是编译链的唯一主控计划。检查点 I 是 hints → accepted
interpretations → MechanicsIR → closed_world 与 P4 执行语义，当前为**A/B/C、Checkpoint II、Checkpoint III、ModuleData projection 与隔离的 compiled GameSession proof 均已通过 `9354054` 推送至 `origin/master`**；P4、
default audit/schema substitution、图关系/location provenance、foreign policy override 和
脚本摘要/进程分类均有反例、真实生产变异和独立复核。没有
实现 artifact 保存/恢复、公开编译入口、GameSession/世界模型/模型记忆接线或外部模型探测。

正式证据为 3201 条 / 220 文件，3169 pass / 32 intentional skip / 0 fail。Checkpoint II 的 prepared/resolved envelope 使用独立 canonical artifact hash，恢复时重建 queue 和完整 resolve 结果并逐项比较；Checkpoint III 的 facade 接收 synthetic-pages/PDF bytes 并只解析验证后的 prepared artifact；projection 仅投影 presentation fields，保留 artifact/mechanics/evidence identities；GameSession 以显式动态 compiled load 在世界写入前验证，并以 `@compiled <mechanismId>` 经共享核心执行。diagnostics 的 private `WeakMap` lineage 未放宽。真实世界模型加载仍有意未验证；更广泛的 HTTP/CLI、world-model/model-memory、内容迁移、legacy loader/ScriptedSession/CLI 消费仍在本交付范围外。

定向命令：`bun test ./src/__tests__/compiler-closure.test.ts ./src/__tests__/mechanics-ir.test.ts ./src/__tests__/deterministic-template-compiler.test.ts ./src/__tests__/compiler-question-queue.test.ts ./src/__tests__/compile-hint-resolution.test.ts ./src/__tests__/mechanics-reachability.test.ts ./src/__tests__/diag-script-process.test.ts ./src/__tests__/diag-preflight-checks.test.ts`。
结果为 261 pass / 0 fail / 789 expect / 8 files；`bun run typecheck` 退出 0。
交付记录补正后的诊断回归为 179 pass / 0 fail / 511 expect / 2 files；`bun run typecheck` 退出 0。
全量 `bun test` 直接 argv 子进程退出 0：3120 pass / 32 skip / 0 fail，3152 条 / 215 文件。
baseline 从 3149/215 更新为 3152/215，并记录 pass=3120、skip=32；now/preflight 现在都会拒绝通过数下降或 skip 数变化，不能再用相同总数掩盖 pass→skip。真实变异：恢复 now 自比 baseline 时 `now: lower test count` 变红；禁用 skip 比较时 pass→skip 判据变红，均已还原。ending rule 的机制 ID 现必须不同于 `end_game.endingId`；删掉拒绝检查时对应 parser 回归变红，已还原。

最终 compiler-process closeout：plain `bun test` 为 3147 pass / 32 intentional skip / 0 fail，3179 条 / 216 文件；plain preflight 通过。共享 MechanicsIR core 的 direct action 必须先完成 terminal/automatic settlement，state budget 只暴露冻结 count/observe，resolved diagnostics bundle 必须匹配私有 in-memory lineage 并完整重解。测试 preload 默认将世界模型路径指向 UUID 缺失文件；真实世界模型加载需显式 opt-in，未在本轮验证。

本轮 compiler 修复：默认项先用原始 source symbols 做完整 schema/结构/audit 校验再替代，
绑定核对 canonical clue/scene/mechanic/interpretation 身份、实际子关系及 review evidence。
只从 retained provenance 取得默认位置，显式位置必须 playable；外模块和非 gameplay-domain
不能压掉本模块 policy，合法本地 explicit 优先级保留。返回 accepted provenance 做深拷贝快照。

脚本修复：只解析完整的独立 Bun 摘要行；decoy、缺失或多份确切摘要不能报绿。
unwired/hooks 先看进程结果，stderr 错误不冒充真正 unset；生成失败快照仍沿用生成器退出契约。
handoff 刷新保留手写 checkpoint 及子标题，EOF 无换行也不会与后续标题粘连。
新测试执行实际脚本体但只替换局部 IO/process 绑定，负例不写真实 docs、不开子进程、不泄漏全局 mock。

新增真实变异（分别变红并还原）：替代前 audit/结构旁路、图关系和 canonical 身份旁路、
已移除 default 的 ID-only 位置回流、外模块 override filter 移除、返回 snapshot clone 移除、
摘要 guard/非锚定 decoy parser 回流、unwired/hooks 进程 guard 移除、EOF separator 移除、stderr filter 移除。
compiler 过滤用例包括 `audits substituted defaults: schema`、`genuine but unrelated`、`lend removed`、
`scopes policy overrides: foreign`、`structurally audits`、`complete subtree.*review=true`、`snapshots returned`。
script 过滤用例包括 `missing failed|positive failed`、`unwired nonzero|hooks nonzero.*githooks`、
`decoy failures|decoy failure and count`、`checkpoint EOF separator`、`empty stdout with stderr`。
所有变异失败原因对应目标断言；独立第一轮发现的残余路径已补反例和修复，第二轮复核未发现约定范围问题。
最终 typecheck 曾指出可选值/联合类型未收窄，已补正常类型守卫后重新通过；未削弱验证或断言。

此前 P4 局部验收证据保留：action→automatic→ending 的四状态在预算 3 拒绝、4 成功，
core 前缀在预算 2 成功；合法两状态循环重复重放只计两个 hash，预算 1 拒绝、2 成功，
重复调用各自重置预算。另补显式 `__proto__` discovery 的真实 resolver-location 集成，
强化 own counter=2、failback witness JSON round-trip 后重放。输入特殊键使用 own data property。

真实生产变异与恢复命令：
- `bun test ./src/__tests__/mechanics-reachability.test.ts -t "charges the player-action state"`：仅删除 action replay observation 时退出 1（预算 3 错误放行）；恢复后 1 pass / 6 expect。
- `bun test ./src/__tests__/mechanics-reachability.test.ts -t "deduplicates revisited replay states"`：按观察次数而非不同 hash 收费时退出 1（在 replay 的预算 2 错误超限）；恢复后 1 pass / 5 expect。
- `bun test ./src/__tests__/mechanics-reachability.test.ts -t "prototype-named method IDs"`：恢复不安全 counter 赋值时退出 1（own `__proto__` failback witness 消失）；恢复后通过，随后增加 JSON-restored witness 重放并纳入最终全量。

生产文件 `git hash-object` 在变异前后均为 `00b4dddbcc3fc8f01b9068ccf471d5d5ed54728d`。
未保留生产变异，未覆盖并行改动，未暂存、提交或推送。preflight 子进程当前正常；旧 PDF/EPERM
报告不是本轮阻塞，不能据此变更依赖或 Git 配置。`docs/notes/index.json` 有并行改动，故未重建；
新增的 engine note 尚未进入索引，
依赖索引的 open/warn 列表可能滞后，留待拥有该并行改动的一方刷新。















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

- 9354054 feat: integrate compiled artifacts with GameSession
- 107c99f feat: project compiler artifacts to ModuleData
- c0d3cb4 feat: add public compiler artifact API
- 4c1f08d feat: persist validated compiler artifacts
- 5095efe feat: add deterministic compiler process simulation
- 1fea0b4 fix: harden compiler delivery verification
- 906ef06 test: make Barn source audit reproducible
- bb42ef4 feat: complete evidence-bound compiler checkpoint
- 9cf3b7f docs: retire ignored legacy tool reference
- 038134c fix: align Cthulhu dataset manifest paths
- 60f7061 test: reject unsupported compile hint kinds
- abc6747 fix: bind policy substitutions to discovery location

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
