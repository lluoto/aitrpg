// CoC 7e 信用评级 / 初始物品 / 商店系统
// Credit Rating: 0-99, 决定初始资产、社交地位、购买权限

import { ConstraintEngine, DEFAULT_CONSTRAINTS } from "../world/world-constraint";

/** CR 等级定义 */
interface CreditTier {
  range: [number, number];
  label: string;
  /** 每月可支配收入 ($) */
  monthlyIncome: string;
  /** 初始物品标签 */
  equipmentTier: "destitute" | "poor" | "average" | "wealthy" | "rich" | "super_rich";
  /** 社交加成/惩罚 */
  socialModifier: number;
  /** 描述 */
  description: string;
}

const CR_TIERS: CreditTier[] = [
  { range: [0, 5],    label: "赤贫",     monthlyIncome: "$0-25",    equipmentTier: "destitute",  socialModifier: -20, description: "流浪汉、破产者、被社会遗弃的人" },
  { range: [6, 20],   label: "贫困",     monthlyIncome: "$50-150",  equipmentTier: "poor",       socialModifier: -10, description: "临时工、底层体力劳动者" },
  { range: [21, 50],  label: "普通",     monthlyIncome: "$200-400", equipmentTier: "average",    socialModifier: 0,   description: "职员、技工、普通中产" },
  { range: [51, 70],  label: "小康",     monthlyIncome: "$500-800", equipmentTier: "wealthy",    socialModifier: +5,  description: "专业人士、小企业主" },
  { range: [71, 90],  label: "富裕",     monthlyIncome: "$1,000-3,000", equipmentTier: "rich",    socialModifier: +10, description: "高级律师、名医、成功商人" },
  { range: [91, 99],  label: "富豪",     monthlyIncome: "$5,000+",  equipmentTier: "super_rich", socialModifier: +15, description: "产业巨头、贵族、顶级收藏家" },
];

/** 初始物品表 CR → 物品列表 */
const CR_STARTING_ITEMS: Record<string, string[]> = {
  destitute:  ["破旧衣物", "硬面包", "空的酒瓶"],
  poor:       ["普通衣物", "小刀", "手电筒", "$20现金"],
  average:    ["体面衣物", "小刀", "手电筒", "笔记本+钢笔", "打火机", "$50现金", "怀表"],
  wealthy:    ["高档衣物", "左轮手枪×6发", "手电筒", "金笔+皮质笔记本", "银制打火机", "$200现金", "汽车钥匙"],
  rich:       ["定制西装", "左轮手枪×12发", "高档手电筒", "金表", "雪茄盒", "$500现金", "跑车钥匙", "移动电话(早期)"],
  super_rich: ["顶级定制衣物", "左轮手枪×24发", "高级相机", "金表+袖扣", "私人俱乐部会员卡", "$2,000现金", "豪华轿车+司机", "游艇钥匙"],
};

function getCrTier(creditRating: number): CreditTier {
  for (const tier of CR_TIERS) {
    if (creditRating >= tier.range[0] && creditRating <= tier.range[1]) return tier;
  }
  return CR_TIERS[2]; // default average
}

export function getStartingItems(creditRating: number): string[] {
  const tier = getCrTier(creditRating);
  const items = CR_STARTING_ITEMS[tier.equipmentTier] ?? CR_STARTING_ITEMS.average;
  // 过世界模型约束：过滤不合时代物品（使用统一约束引擎）
  return worldModelItemFilter(items, MODULE_YEAR);
}

// ============================================================
// 世界模型物品约束系统
// ============================================================

/** 当前模块设定年代 — 供世界模型约束使用 */
const MODULE_YEAR = 1921;

/**
 * 约束引擎实例（延迟初始化，允许模组在启动时注入 override）
 * 默认使用 CoC 通用约束（DESIGN-LOG.md §1）。
 */
let _constraintEngine: ConstraintEngine | null = null;

export function getConstraintEngine(): ConstraintEngine {
  if (!_constraintEngine) {
    _constraintEngine = new ConstraintEngine(DEFAULT_CONSTRAINTS);
  }
  return _constraintEngine;
}

/**
 * 设置约束引擎（供模组启动时注入 module constraintOverrides）。
 * 需在 getStartingItems() 之前调用。
 */
export function setConstraintEngine(engine: ConstraintEngine): void {
  _constraintEngine = engine;
}

/**
 * 世界模型物品过滤器：
 * 使用统一约束引擎检查每个物品是否在设定年代存在。
 * 不存在时按约束定义替换或移除。
 */
export function worldModelItemFilter(
  items: string[],
  year: number = MODULE_YEAR,
): string[] {
  const engine = getConstraintEngine();
  return items.map(item => {
    const result = engine.checkItem(item, year);
    if (!result) return item;                       // 无约束匹配 → 保留
    if (result.type === "replace") return result.replacement;
    if (result.type === "block") return "";          // 直接封锁 → 移除
    // allow_with_cost / redirect 对物品同样可以保留（由模组决定后续行为）
    return item;
  }).filter(Boolean);
}
