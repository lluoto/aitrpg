# Design Log — AI KP 架构决策

> 基于原文综述《基于原文的 AI Game Master 与 TTRPG 大语言模型系统研究综述》提炼的可操作设计原则。

---

## 1. 优先级约束层（硬规则）

**来源**: §十一（状态/规则优先级）、§五.2（Minari 多代理失败原因）

```
当前模组特殊规则 > 当前场景与已确认世界事实 > CoC通用规则 > LLM的一般常识
```

**当前实现**: `worldModelItemFilter()` (coc-cr.ts) 和 `worldPenetrationCheck()` (npc-dialogue-prompts.ts) 各自独立，优先级隐式。

**TODO**: 统一为 `WorldModelConstraint` 层，显式编码优先级。模组可通过声明 `"这条规则 override 通用规则"` 来提升某条约束的优先级。

---

## 2. 结构化状态 > LLM 自由生成

**来源**: §三（Function Calling: 0.461 vs 0.267）、§四（PAYADOR: 只结构化影响后续的属性）

**当前实现**: 没有专门的结构化状态层。物品通过 `getStartingItems()` 生成，但剧情关键变量（顾绍棠状态、主托座控制权等）没有作为显式字段。

**TODO**: 
- 定义 `ModuleState` 接口，包含剧情推进所需的结构化变量
- 引擎负责写入和读取，LLM 只负责根据状态生成旁白
- 旧对话压缩为事件摘要，不替代显式变量

---

## 3. 行动分类（替代 binary 接受/拒绝）

**来源**: §六（SENNA 世界内后果引导，TRPG 迎合性实验）

**当前实现**: `worldPenetrationCheck` 返回 blocked → `fallbackSilence()`（直接静默拒绝）。

**TODO**: 行动应分类为：
1. 可以直接完成（显然是当前场景允许的）
2. 需要检定（骰点决定成败）
3. 可以尝试但有代价（消耗资源/触发新事件）
4. 与世界事实冲突（直接拒绝，需附带世界内解释）
5. 超出模组边界（NPC 引导回正轨，不是硬拒绝）

---

## 4. 温度分离：检定低温度，对话高温度（✓ 已实现）

**来源**: §九（RPGBench: 低温度→机制遵守，高温度→趣味性）

**当前实现**: ✅ 已存在。
- Intent 解析 (`intent.ts`) → temperature=0.1（规则类）
- NPC 对话 (`npc-dialogue-prompts.ts`) → temperature=0.8（叙事类）
- KP 旁白 (`kp-agent.ts`) → temperature=0.6~0.8（叙事类）
- 检定/规则 → 确定性代码（CoCEngine, SanityEngine），不经过 LLM

**不需要改动**。

---

## 5. 知识边界：信息权限系统

**来源**: §一（Skill Check: 自由语言模型在状态上的不稳定）、§四（PAYADOR: 局部状态渲染）

**当前实现**: 
- `knowledgeReveals` 附带可选的 `revealConditions`（见 `ModuleNPC.llmExpanded`）
- 条件类型：`requiresClue`（必须已找到所有指定线索）、`blocksClue`（只要找到其中任一线索就不可见）
- 引擎在 `revealNpcKnowledge` 中做条件判断，LLM 不参与"这个信息能不能说"的决策

**使用示例**（模组数据中）：
```typescript
llmExpanded: {
  knowledgeReveals: [
    "我听到地下室有声音……",
    "那天晚上我看到管家进了书房。",
  ],
  revealConditions: [
    { index: 0, requiresClue: ["clue_basement_key"] },       // 拿到地下室钥匙后才reveal
    { index: 1, blocksClue: ["clue_butler_innocent"] },      // 确认管家无罪后不再提及
  ],
}
```

---

## 6. 回归测试矩阵（✓ 41 tests, all pass）

**来源**: §十一（原备忘录中的回归测试）、§三（Function Calling 单元测试）

**当前实现**: `src/__tests__/world-constraint.test.ts` 包含：

| 测试组 | 用例数 | 覆盖范围 |
|--------|--------|----------|
| ConstraintEngine 基本 | 7 | 默认约束存在性、优先级、物品匹配、对话匹配、大小写 |
| 优先级排序 | 2 | 高优先级优先、模组 override |
| 动作类型 | 4 | block / replace / redirect / allow_with_cost |
| 年代范围 | 3 | 范围内命中、范围外放过、无年份保守命中 |
| 场景作用域 | 3 | 同场景命中、异场景放过、无场景放过 |
| worldModelItemFilter 集成 | 4 | 替换、未来放过、普通物品、模组 override |
| getStartingItems 集成 | 3 | rich 替换、super_rich 不受影响、destitute 不受影响 |
| 对话穿透过滤 | 4 | 线索/ NPC/旅店拦截、自然对话通过 |
| mentionReactions 匹配 | 5 | 职业匹配、无关返回 null、大小写不敏感、多PL顺序、{name}替换 |
| revealConditions 门控 | 6 | 无条件可见、require/block/组合条件 |

**运行**: `bun test src/__tests__/world-constraint.test.ts`

---

## 7. 多代理不是解药

**来源**: §五.2（Minari: 多代理条件下规则错误+剧透反而增加）

**当前实现**: 单代理 + 确定性引擎代码。

**保持**: 引擎不做 LLM 间的语义级辩论。规则检查、状态写入、信息权限全部由确定性代码执行。LLM 只负责自然语言理解和生成。
