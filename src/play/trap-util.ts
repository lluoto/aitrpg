// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type { ModuleItem } from "../module/types";
/**
 * 重伤判定：单次伤害大于耐久半值。
 *
 * 模组 trap_bear 条目写的是"伤害大于耐久半值有截肢风险"——**大于**，所以用 `>`。
 *
 * ⚠ 这跟 CoC 7e 的 Major Wound **不是同一个口径**（那条是「等于或大于」，
 * 见 combat/wound-effects.ts 的 calcSeverity）。两处故意不同，别去"统一"。
 * 抽出来是为了能测 —— 边界（恰好等于半值）容易写成 >=，那会把普通擦伤也判成截肢。
 */
export function isMajorWound(damage: number, maxHp: number): boolean {
  return damage > Math.floor(maxHp / 2);
}

/**
 * 掷骰 —— CoC 伤害表达式 "1D4+1" / "1d6" / "2D6+2" / "1d3-1"。
 *
 * 没有复用 RuleEngine.roll()：那是 D&D 规则引擎上的实例方法，构造时要读 dnd5e.yaml，
 * 而且它的正则 `/(\d+)d(\d+)/` 只认小写 d —— 模组条目写的是 "1D4+1"，
 * 喂进去匹配不上，会静默返回 0。静默的 0 比抛错坏得多：
 * 捕兽夹会变成咬住了却不掉血，而日志上一个字都不会提。
 *
 * 表达式非法直接抛错，不做兜底：那是模组数据的错，该在测试里就炸出来，
 * 而不是跑到一半悄悄把伤害算成 0。rng 可注入，好让测试不靠运气。
 */
export function rollDice(expr: string, rng: () => number = Math.random): number {
  const m = expr.trim().match(/^(\d*)[dD](\d+)(?:\s*([+-])\s*(\d+))?$/);
  if (!m) throw new Error(`无法解析的骰子表达式: "${expr}"`);
  const count = m[1] === "" ? 1 : parseInt(m[1] as string, 10);
  const sides = parseInt(m[2] as string, 10);
  if (count < 1 || sides < 1) throw new Error(`骰子表达式数值非法: "${expr}"`);
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.floor(rng() * sides) + 1;
  if (m[3]) total += (m[3] === "-" ? -1 : 1) * parseInt(m[4] as string, 10);
  return Math.max(0, total);
}

/**
 * 取某场景里所有会结算的陷阱。
 *
 * 此前引擎只认 support.trapSceneId / trapClueId 这一对单数常量，一个场景只能有一个陷阱。
 * 而 farm_periphery 一个场景就挂着捕兽夹、锯短霰弹枪、音响三个条目 —— 后两个从来没被触发过，
 * 是彻头彻尾的死数据。改成按场景过滤 items 之后，模组加陷阱不必再动引擎。
 *
 * 没有 trap 字段的条目会被跳过：那表示它纯叙事（如已失效的音响陷阱），
 * 看得见、可以被描述，但不参与结算。
 */
export function trapsInScene(items: ModuleItem[], sceneId: string): ModuleItem[] {
  return items.filter((it) => it.type === "trap" && it.sceneId === sceneId && !!it.trap);
}

/**
 * 中文属性名 → CoC 角色属性字段。
 *
 * 模组条目是中文写的（"挣脱需困难成功力量"），角色卡存的是英文键。
 * 这层映射此前不存在，因为检定属性是人工挑好硬编码进引擎的；
 * 一旦改成从数据读，模组里写什么就得认什么。
 */
const ATTR_KEY_BY_CN: Record<string, string> = {
  力量: "strength",
  敏捷: "dexterity",
  体质: "constitution",
  体型: "size",
  智力: "intelligence",
  意志: "power",
  教育: "education",
  外貌: "appearance",
};

/**
 * 按中文名取属性值。认不出的名字回落到 fallback 并出声 ——
 * 静默回落会让"模组写错属性名"表现成"这个检定莫名其妙是 50%"，无从查起。
 */
export function attributeValue(
  attrs: Record<string, number | undefined>,
  cnName: string,
  fallback = 50,
): number {
  const key = ATTR_KEY_BY_CN[cnName];
  if (!key) {
    console.warn(`[trap] 未知属性名「${cnName}」，回落 ${fallback}`);
    return fallback;
  }
  const v = attrs[key];
  return typeof v === "number" ? v : fallback;
}

/** 外向/寡言的用词 —— 车卡的八项里"特质"一项就是自由文本，只能按词判 */
