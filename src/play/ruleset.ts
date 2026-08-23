// 本局用哪套规则 —— 组合层唯一碰规则集注册表的地方。
//
// 为什么单开一个文件而不是各处直接 `getRulesetMod(...)`：
//
// `coc-ruleset-mod.ts` 自己 import 了 `coc-engine.ts`（DEFAULT_COC_HOOKS 里的
// `sanWeeklyRecovery` 要摇 1d3）。规则层反过来再 import 注册表就成环。
// 所以规则层（`coc-engine.ts`、`combat/wound-effects.ts`）**只收 hooks 类型**，
// 由这里把值注入进去。方向是单向的：组合层 → 规则层。
//
// ⚠ 这套钩子写出来之后一直没人调用 —— `coc-ruleset-mod.ts` 在依赖图上
//   只有测试引用。也就是说「支持 Pulp 等变体规则」这句话，
//   在接上之前是**只有测试知道**的一句话。

import { getRulesetMod, type RulesetModHooks } from "../rules/coc-ruleset-mod";

/** 模组声明的规则集 → 钩子。模组没写就是标准 CoC 7e */
export function activeHooks(module?: { ruleset?: string }): RulesetModHooks {
  return getRulesetMod(module?.ruleset ?? "cosmic-horror");
}
