// CoC 7e 信用评级 / 初始物品 / 商店系统
// Credit Rating: 0-99, 决定初始资产、社交地位、购买权限

/** CR 等级定义 */
export interface CreditTier {
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

export const CR_TIERS: CreditTier[] = [
  { range: [0, 5],    label: "赤贫",     monthlyIncome: "$0-25",    equipmentTier: "destitute",  socialModifier: -20, description: "流浪汉、破产者、被社会遗弃的人" },
  { range: [6, 20],   label: "贫困",     monthlyIncome: "$50-150",  equipmentTier: "poor",       socialModifier: -10, description: "临时工、底层体力劳动者" },
  { range: [21, 50],  label: "普通",     monthlyIncome: "$200-400", equipmentTier: "average",    socialModifier: 0,   description: "职员、技工、普通中产" },
  { range: [51, 70],  label: "小康",     monthlyIncome: "$500-800", equipmentTier: "wealthy",    socialModifier: +5,  description: "专业人士、小企业主" },
  { range: [71, 90],  label: "富裕",     monthlyIncome: "$1,000-3,000", equipmentTier: "rich",    socialModifier: +10, description: "高级律师、名医、成功商人" },
  { range: [91, 99],  label: "富豪",     monthlyIncome: "$5,000+",  equipmentTier: "super_rich", socialModifier: +15, description: "产业巨头、贵族、顶级收藏家" },
];

/** 初始物品表 CR → 物品列表 */
export const CR_STARTING_ITEMS: Record<string, string[]> = {
  destitute:  ["破旧衣物", "硬面包", "空的酒瓶"],
  poor:       ["普通衣物", "小刀", "手电筒", "$20现金"],
  average:    ["体面衣物", "小刀", "手电筒", "笔记本+钢笔", "打火机", "$50现金", "怀表"],
  wealthy:    ["高档衣物", "左轮手枪×6发", "手电筒", "金笔+皮质笔记本", "银制打火机", "$200现金", "汽车钥匙"],
  rich:       ["定制西装", "左轮手枪×12发", "高档手电筒", "金表", "雪茄盒", "$500现金", "跑车钥匙", "移动电话(早期)"],
  super_rich: ["顶级定制衣物", "左轮手枪×24发", "高级相机", "金表+袖扣", "私人俱乐部会员卡", "$2,000现金", "豪华轿车+司机", "游艇钥匙"],
};

/** CR 对应的商店购买权限标签 */
export const CR_SHOP_LIMITS: Record<string, string[]> = {
  destitute:  ["食品", "廉价酒水"],
  poor:       ["食品", "廉价工具", "普通衣物"],
  average:    ["食品", "工具", "衣物", "普通武器", "弹药", "基础医疗"],
  wealthy:    ["食品", "工具", "品牌衣物", "武器+弹药", "医疗", "交通工具", "相机"],
  rich:       ["奢侈品", "高档武器", "高档交通工具", "精密仪器", "古董", "不动产"],
  super_rich: ["一切合法物品", "稀有古董", "私人交通工具", "大型不动产", "艺术品"],
};

export function getCrTier(creditRating: number): CreditTier {
  for (const tier of CR_TIERS) {
    if (creditRating >= tier.range[0] && creditRating <= tier.range[1]) return tier;
  }
  return CR_TIERS[2]; // default average
}

export function getCrLabel(creditRating: number): string {
  return getCrTier(creditRating).label;
}

export function getStartingItems(creditRating: number): string[] {
  const tier = getCrTier(creditRating);
  return CR_STARTING_ITEMS[tier.equipmentTier] ?? CR_STARTING_ITEMS.average;
}

export function getShopAccess(creditRating: number): string[] {
  const tier = getCrTier(creditRating);
  return CR_SHOP_LIMITS[tier.equipmentTier] ?? CR_SHOP_LIMITS.average;
}

export function canBuyItem(creditRating: number, itemCategory: string): boolean {
  const allowed = getShopAccess(creditRating);
  return allowed.some(a => a === "一切合法物品" || a.includes(itemCategory) || itemCategory.includes(a));
}

// ============================================================
// 商店物品价格表
// ============================================================

export interface ShopItem {
  name: string;
  category: string;
  price: number; // 美元 $
  /** 可否在商店中找到 (0-1 概率) */
  availability: number;
}

export const SHOP_CATALOG: ShopItem[] = [
  // 食品
  { name: "罐头食品", category: "食品", price: 2, availability: 0.9 },
  { name: "威士忌",   category: "廉价酒水", price: 5, availability: 0.8 },
  { name: "咖啡豆",   category: "食品", price: 3, availability: 0.7 },
  // 工具
  { name: "手电筒",   category: "工具", price: 8, availability: 0.9 },
  { name: "绳索(15m)", category: "工具", price: 10, availability: 0.8 },
  { name: "折叠刀",   category: "工具", price: 12, availability: 0.8 },
  { name: "打火机",   category: "工具", price: 2, availability: 0.95 },
  { name: "照相机",   category: "相机", price: 50, availability: 0.5 },
  // 武器
  { name: "左轮手枪", category: "普通武器", price: 75, availability: 0.4 },
  { name: "手枪弹药(6发)", category: "弹药", price: 8, availability: 0.6 },
  { name: "猎刀",     category: "普通武器", price: 20, availability: 0.7 },
  { name: "棒球棍",   category: "普通武器", price: 10, availability: 0.6 },
  { name: "霰弹枪",   category: "普通武器", price: 120, availability: 0.3 },
  { name: "霰弹(5发)", category: "弹药", price: 10, availability: 0.5 },
  // 医疗
  { name: "急救包",   category: "基础医疗", price: 15, availability: 0.7 },
  { name: "绷带",     category: "基础医疗", price: 3, availability: 0.9 },
  // 高档
  { name: "金表",            category: "奢侈品", price: 500, availability: 0.2 },
  { name: "雪茄盒(12支)",    category: "奢侈品", price: 60,  availability: 0.3 },
  { name: "古董罗盘",        category: "古董",   price: 200, availability: 0.1 },
  { name: "首版《死灵之书》", category: "稀有古董", price: 5000, availability: 0.01 },
];

// ============================================================
// 羁绊系统 (Bonds)
// ============================================================

export interface Bond {
  name: string;
  relationship: string;
  description: string;
  /** 当前羁绊值 (0-100)，影响 SAN 恢复和社交 */
  currentScore: number;
  /** 是否存活 */
  alive: boolean;
  /** 地点（用于剧情触发） */
  location?: string;
}

export function createDefaultBonds(occupation: string): Bond[] {
  const defaults: Bond[] = [
    { name: "家人", relationship: "直系亲属", description: "你的家人，你愿意为他们付出一切", currentScore: 60, alive: true },
    { name: "挚友", relationship: "好友", description: "从小一起长大的朋友，知道你的过去", currentScore: 50, alive: true },
  ];

  if (occupation === "professor" || occupation === "antiquarian") {
    defaults.push({ name: "导师", relationship: "学术导师", description: "你的学术引路人，在学术界有影响力", currentScore: 40, alive: true });
  }
  if (occupation === "physician_coc") {
    defaults.push({ name: "病人", relationship: "长期病患", description: "一位信任你的病人，依赖你的专业判断", currentScore: 45, alive: true });
  }
  if (occupation === "journalist_coc") {
    defaults.push({ name: "线人", relationship: "情报源", description: "你在某个圈子里的秘密线人", currentScore: 35, alive: true });
  }
  if (occupation === "dilettante") {
    defaults.push({ name: "俱乐部同伴", relationship: "社交圈", description: "同一家高级俱乐部里的富家子弟", currentScore: 40, alive: true });
  }
  if (occupation === "clergy") {
    defaults.push({ name: "教区居民", relationship: "信众", description: "你照顾的教区居民，信任你的信仰指引", currentScore: 55, alive: true });
  }

  return defaults;
}

/** 羁绊消耗 SAN 恢复：投入羁绊点数换取 SAN 恢复 */
export function bondSanRecovery(bondScore: number): number {
  if (bondScore >= 80) return 4;
  if (bondScore >= 60) return 3;
  if (bondScore >= 40) return 2;
  if (bondScore >= 20) return 1;
  return 0;
}

/** 调查员在调查中可能忽视羁绊 → 扣分 */
export function rollBondNeglect(): boolean {
  return Math.random() < 0.15; // 每次调查有15%概率忽视羁绊
}
