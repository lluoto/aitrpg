# AI KP 工具面评估与 apply_action 迁移计划

日期：2026-08-12
范围：`poc/` 的 KP/LLM 调用面与状态修改路径
依据：`C:\aitrpg\消弭\AI_KP与TTRPG相关学术工作备忘录_v1.docx`（下称备忘录）

---

## 一、结论

提案「6 个强类型只读/提议工具 + 单一 `apply_action()` + 程序侧校验」方向正确，且与备忘录 §三.2 划定的职责边界几乎逐条对应。

但有一个前提需要先纠正：**本项目当前并没有在用 tool calling**。因此「不给 4B 开放 30 个工具」目前不是待修复的现状，而是待守住的约束。真正的缺口在另一处——状态修改没有统一的合法性校验入口。

---

## 二、现状核实

以下为代码实测，非推断。

| 事实 | 证据 |
|---|---|
| 全链路无 tool calling | `src/llm/intent.ts`、`src/agent/kp-agent.ts` 均不含 `tools` / `function_call` / `tool_choice` |
| LLM 只产出单个结构体 | `parseIntentLLM()` 用 `jsonMode` 返回一个 `ActionIntent`，解析失败退化到 `parseIntentRegex()` |
| 分派由代码完成 | `act()` → `parseIntent()` → `handleIntent()` → 25 个 `handleXxx` |
| 意图处理器数量 | 25：Attack, Buy, Cast, Chase, CreateCharacter, FirstAid, Flee, GenerateStory, Help, Inventory, Legacy, ListOccupations, LoadModule, Move, PoliticoEconomy, Push, Read, Reload, Rest, SanCheck, SavingThrow, SkillAdvancement, SkillCheck, Sell, Status |
| 状态修改方法 | 9：`addMessage`, `applyDamage`, `registerModuleNPCPersonality`, `setDifficulty`, `setPlayerHp`, `setPlayerInventory`, `setPlayerSan`, `setPlayerWeapons`, `setScene` |
| 对外 KP 操作 | 6：`apply-damage`, `send-message`, `set-difficulty`, `set-hp`, `set-san`, `set-scene`（`src/api/server.ts`） |
| 状态转移无合法性校验 | `setPlayerSan()` 直接写入，不判断该转移在当前剧情状态下是否允许 |
| 已有真相源，但被绕过 | `WorldStateManager` 头注释即写明「Bun 原生 SQLite 真相源／LLM 只看不写」，但 7 个状态写入中只有 `setPlayerHp`、`applyDamage` 真正落到它；SAN 在 `sanityEngines`、物品在 `inventoryMap`、武器在 `equippedWeaponsMap`，均为进程内状态 |
| 真相源写入曾整条失效 | `setScene()` 与 `handleGenerateStory()` 都写 `world.getCurrentState().scene = id`，而该方法每次新建对象返回，赋值落在临时对象上（已修复，见 §八） |

**读法**：`ActionIntent` 已经在扮演 `propose_action()`，代码分派已经在扮演 `apply_action()` 的位置，`WorldStateManager` 已经在扮演真相源——三者都不缺。缺的是**让写入必须经过真相源的强制**，以及真相源之上的**校验层**。

---

## 三、与备忘录的对照

备忘录 §三.2《函数或工具边界》原文划分：

- **程序负责**：骰点与成功等级；状态变更是否合法；角色是否知道某条信息；当前节点是否达到结束条件；事件是否已发生（避免重复触发）；SAN 奖励是否已经结算
- **模型负责**：描述；NPC 台词；对非预设行动的语义理解；在已确认结果范围内生成后果

这与提案一致。当前代码满足「模型负责」一侧，**「状态变更是否合法」「事件是否已发生」「奖励是否已结算」三条尚无对应实现**。

其余相关依据：

- **§4 Song et al., Wordplay 2024**（arXiv 2409.06949）：将掷骰、场景状态、游戏专用操作封装为函数，人评与单元测试显示叙事质量与状态更新一致性均改善。→ 支持保留少量强类型函数，而非退回纯提示词。
- **§5 PAYADOR**（arXiv 2504.07304）：不预先穷举玩家可执行的全部动作，只定义关键状态如何变化。→ 直接支持「单一 `apply_action` + 状态机」，反对为每种动作各开一个 mutator。
- **§6 Static vs Agentic**（arXiv 2502.19519）：不应无限增加智能体，多智能体增加调试复杂度，不能仅凭 "agentic" 标签假设更可靠。→ 支持压小工具面。
- **§7 RPGBENCH**（arXiv 2502.00595）：先进模型仍常在长程、复杂状态与可验证规则上失败。→ 状态权威必须在程序侧，不能寄望模型自持。
- **§三.1 最小世界状态**：备忘录已为《璀璨欢宴》列出 8 个状态变量及其取值域（顾绍棠：存活／重伤／死亡；主托座：沈滨控制／调查员控制／失活；检验片：同前；药物覆盖：完整／削弱／中止；地下供养：完整／受损；服务入口：掌握／部分掌握／未掌握；许佩华：合作／有限合作／拒绝；沈滨警觉：低／高）。这是 `apply_action` 校验目标类型的**范式示例**——但须注意：**《璀璨欢宴》并不在本仓库内**。全仓检索该剧本的 5 个专名（璀璨欢宴／顾绍棠／沈滨／许佩华／托座），仅命中本文件自身。项目实际加载的模组是 `premiers_barn`《首演之夜的谷仓》。因此这 8 个变量只能作为建模方法的样板，不能照抄成本项目的类型。

---

## 四、对 4B 工具面的评估

BFCL-V4 数据（Qwen3.5-4B 50.3 / 9B 66.1，用户提供）指向的判断成立：工具数量与选择正确率强相关，4B 不宜承担宽工具面的路由职责。

对本项目的具体含义：

1. **不要把 25 个 `handleXxx` 升格成 25 个工具。** 这是最容易发生的一次性错误——它们已经是现成的函数签名，看起来"顺手就能暴露"。一旦暴露，4B 的选择错误率会直接成为叙事错误率。
2. **提案的 6 工具面是合理上限。** `get_scene_context` / `get_character` / `search_memory` 是只读取数，`roll_check` 是纯函数，`propose_action` / `apply_action` 是唯一写入通道。错误模式从"选错工具"降级为"参数校验失败"——后者可恢复、可重试、可日志化。
3. **但要注意退化路径。** 当前 `parseIntentLLM` 失败时退回 regex，这个兜底在工具调用形态下不再天然存在。迁移时必须显式保留一条非模型兜底路径，否则 4B 的一次格式错误就会变成一次无响应回合。
4. **JSON mode 与 tool calling 并非必须二选一。** 当前 JSON mode 已经能表达 `propose_action` 的语义，且对小模型格式约束更强。若无多轮工具编排需求，**保持 JSON mode、只补校验层**是成本更低的路径；tool calling 的收益主要在需要模型主动取数（`get_*` / `search_memory`）时才体现。

---

## 五、真实缺口

按影响排序：

1. **真相源存在，但不被强制。** `WorldStateManager` 已声明为唯一真相源，实际只有 HP 与伤害写入它；SAN、物品、武器停留在进程内 Map——重启即失，KP 与规则引擎都看不到。校验层必须先有一个「所有写入都必须经过的地方」，才谈得上校验转移是否合法。
2. **没有统一写入口。** 9 个 mutation 方法 + 6 个 HTTP KP 操作各自直写，`apply_action` 没有落点。
3. **没有幂等/重复触发防护。** 备忘录 §三.2 明确要求「事件是否已发生，避免重复触发」「SAN 奖励是否已经结算」，当前无对应记录。
4. **`game-session.ts` 已 2022 行。** 25 个 handler 与 9 个 mutator 同处一文件，是上述三点的物理成因。`apply_action` 收敛与该文件拆分是同一件事。

---

## 六、迁移计划

分四阶段，每阶段独立可验证、可回滚。

### 阶段 1：让所有状态写入都到达真相源（无对外行为变更）

> 本阶段已相对初稿改写。初稿写的是「为备忘录 §三.1 的 8 个变量建类型」，但那套变量属于不在本仓库的《璀璨欢宴》，照建等于写一批无数据可投影的推测代码。真正该做的是把已声明的真相源坐实。

- 把 SAN、物品、武器三类状态从进程内 Map 迁入 `WorldStateManager`，使 `getCurrentState()` 成为完整快照而非部分快照。
- 全仓排查「读起来像写入、实际不是」的写法，重点是对 `getCurrentState()` 返回值的赋值——已发现 2 例，均为静默失效。
- 验收：新增单测断言每类状态在会话重新读取后仍然一致；`bun test` 全绿。

### 阶段 2：建立 `applyAction()` 校验闸门
- 新建 `src/rules/apply-action.ts`，签名接受一个受判别联合约束的 `ProposedAction`，返回 `Result<StateDelta, RejectReason>`。
- 内含备忘录 §三.2 要求的四类判断：转移是否合法、角色是否知情、节点是否达成结束条件、事件/奖励是否已结算。
- 此阶段**不接线**，只做纯函数 + 表驱动测试。
- 验收：非法转移用例全部被拒绝并给出结构化原因。

### 阶段 3：把写入路径收束到闸门后
- 逐个改写 9 个 mutation 方法与 6 个 HTTP KP 操作，使其经由 `applyAction()`。
- 每改一个跑一次全量测试，单独提交，便于二分回滚。
- 顺带把 `game-session.ts` 中相关 handler 按职责迁出，缓解 2022 行问题。
- 验收：`git grep` 确认无绕过闸门的直写；全量测试保持绿。

### 阶段 4：视需要再决定是否引入 tool calling
- 若阶段 1–3 后仍需模型主动取数，再暴露 `get_scene_context` / `get_character` / `search_memory` / `roll_check` 四个只读工具 + `propose_action`。
- 写入永不暴露为工具，只能是 `applyAction()` 的服务端调用。
- 必须保留非模型兜底路径（现 `parseIntentRegex` 的等价物）。
- 验收：以真实 4B 端点跑备忘录 §三.3 的 8 条回归脚本。

---

## 七、回归测试基线

备忘录 §三.3 已给出 8 条，直接作为阶段 4 的验收脚本，且阶段 2 的闸门应能在无模型参与下静态复现其中的状态判断：

1. 玩家不检查铅封，KP 是否仍公平推进
2. 玩家提前进入鉴定室，顾绍棠是否仍有可打断动作
3. 玩家救下顾但归还托座，宴会是否仍按完整同步运行
4. 玩家控制主托座但跳过二栈，系统是否正确采用弱化备用托座
5. 玩家只去诊所，是否仍能进入宴会并识别药物风险
6. 玩家只去二栈，是否仍有非医学方式破坏地下系统
7. 玩家拒绝迎宾饮品，系统是否尊重该决定
8. 玩家采用未预写的方法破坏香露，系统是否映射到正确状态而非拒绝行动

第 8 条是 PAYADOR 的核心检验点，也是判断 `apply_action` 抽象层级是否正确的关键：如果它只能匹配预设动作名，抽象就做低了。

---

## 八、一条来自本次实跑的经验

本轮修复中出现过一次真实回归：`MythosModuleLoader` 通过 `(host.world as any).getDatabase()` 依赖了宿主契约里从未声明的能力，宿主换成窄适配器后运行时变为 `undefined`，被 `catch` 降级成一行警告，模组场景出口整段失效。类型检查与 710 个测试全绿，只有真实跑团暴露了它。

这对 `apply_action` 设计的直接含义：**闸门的能力面必须显式声明并被类型约束，任何 `as any` 形式的隐式依赖都会在替换实现时静默断裂**。同时，闸门内的失败必须结构化上报，而不是降级成一行文本警告——否则与当前 `catch` 吞异常是同一类问题。

写完本文后立即发现同类的第二例，且更严重：`setScene()` 与 `handleGenerateStory()` 都用 `world.getCurrentState().scene = id` 表达「切换场景」，而 `getCurrentState()` 每次都新建并返回一个对象，赋值全部落在临时对象上随即被丢弃。数据库中的 `scenes.is_active` 从未变更，KP 面板的「切换场景」按钮完全无效，后端却仍返回 `success: true`。类型检查与 710 个测试同样全绿。

两例合起来指向同一条设计约束：**真相源只应暴露「写入方法」，不应暴露「看起来能写的快照」**。`getCurrentState()` 返回可变对象，本身就在邀请这类错误。因此 `apply_action` 的返回值应当是不可变的 `StateDelta`，对它的任何赋值都应被类型系统拒绝，而不是静默丢弃；写入能力只经由具名方法暴露。
