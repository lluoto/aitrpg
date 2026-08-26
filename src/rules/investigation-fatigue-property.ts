// 世界属性注册表的第一个真实属性：调查疲劳惩罚。
//
// 来源：C:\aitrpg\forensic_rules.yaml §八「用眼过度——技能惩罚系统」
// （`visual_fatigue.fatigue_penalty_to_skill` + `visual_fatigue.environment_modifier`）。
// 该文件"尸检与世界物理规则……跨世界观通用"，是 PLAN.md:923-926 点名的、
// C 约束层缺的现成内容，目前全仓零引用——这是它第一次被接进代码。
//
// ⚠ 没有选任务示例里的"结构完整性"：源材料没有对应的结构化数据，
//   写成示范会变成凭空编数据。选这个属性是因为它满足同一份契约
//   （scale/composition/domain/ruleset 都能从真实文本推出），
//   见 docs/world-property-falsification.md「本轮选定的属性」。
//
// N×1 的"来源→属性"表：8 个独立来源，每个只声明自己对这一个属性的
// 影响是多少，不需要"来源 A 遇到来源 B 时特判"——这正是 PLAN.md:745
// 拒绝的 N² 交互表的反面。新增第 9 个来源（比如原文没写的"戴眼镜
// -5%"）只是加一行数据，不用碰这个文件之外的任何代码。

import { registerWorldProperty, type AbilityPropertyEffect } from "./world-property";

export const INVESTIGATION_FATIGUE_PROPERTY_ID = "investigation_fatigue_penalty";

registerWorldProperty({
  id: INVESTIGATION_FATIGUE_PROPERTY_ID,
  // 惩罚是负的技能百分比，正向修正（充足光线等）也走同一个属性——
  // 原文本身就是同一张表里正负都有（bright_light +10%、round_5 -20%）。
  // 上界宽松是因为原文没有给出理论上限，只有实践上不会超过技能值本身；
  // 下界同理。真要收紧，应该是"结算时钳到技能值范围"这一步的事，
  // 不该体现在属性值域本身——那样会把"数值合法性"和"检定结果合法性"
  // 这两件不同的事混进同一处校验。
  domain: { kind: "integer", min: -100, max: 100 },
  scale: "personal", // 只影响施加检定的那一名调查员，不外溢到场景/世界
  composition: "additive", // 原文原话："医学 65% -20% → 有效医学 45%"——直接相加
  ruleset: "cosmic-horror", // 百分骰技能机制是 CoC 特有形状
});

/**
 * §八 `fatigue_penalty_to_skill`：检查轮次越多，疲劳惩罚越重。
 * 原文 round_1/round_2 无惩罚，这里不为它们建条目——没有效果的来源
 * 不该占一行数据，占了就是在暗示"这里本该有内容"。
 */
export const FATIGUE_BY_ROUND: Record<string, number> = {
  round_3: -10,
  round_4: -10,
  round_5: -20,
  round_6: -20,
  round_7: -30,
  round_8: -30,
  // round_9_plus 原文是 "POW_check"（意志检定失败→强制停止），
  // 不是一个数值惩罚，不塞进这张表——塞进去会把"停止检定"这个
  // 判定伪装成一个数字，读代码的人会以为它只是更大的惩罚而已。
};

/** §八 `environment_modifier`：环境对技能的直接修正。 */
export const FATIGUE_BY_ENVIRONMENT: Record<string, number> = {
  bright_light: 10,
  dim_light: -10,
  flashlight_only: -20,
  decomposing: -10,
  bloated: -20, // 原文还带一条 "+ CON检定"（生理冲击的额外判定），不是纯数值修正，另行处理
  outdoors_daylight: 10,
  // fresh_corpse: 0 / skeletonized: 0——原文明示无影响，同样不占行
  // time_pressured: 原文是区间 "-10_30%"，不是单值，不适合塞进这张
  // 只收单值来源的表；需要用它时应该走"给定紧迫程度→取区间内具体值"
  // 这条单独的换算，不该在这里硬编一个代表值假装是原文写的
};

/** 把「轮次 + 环境列表」转成 N×1 表要的 AbilityPropertyEffect[]，供 resolvePropertyEffects 用。 */
export function buildFatigueEffects(
  round: string | undefined,
  environments: readonly string[],
): AbilityPropertyEffect[] {
  const effects: AbilityPropertyEffect[] = [];
  if (round && round in FATIGUE_BY_ROUND) {
    effects.push({
      sourceId: `round:${round}`,
      propertyId: INVESTIGATION_FATIGUE_PROPERTY_ID,
      value: FATIGUE_BY_ROUND[round]!,
      scale: "personal",
    });
  }
  for (const env of environments) {
    if (env in FATIGUE_BY_ENVIRONMENT) {
      effects.push({
        sourceId: `env:${env}`,
        propertyId: INVESTIGATION_FATIGUE_PROPERTY_ID,
        value: FATIGUE_BY_ENVIRONMENT[env]!,
        scale: "personal",
      });
    }
  }
  return effects;
}
