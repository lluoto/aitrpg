// 装备合法性校验 — 基于世界模型资源模式
// 审卡时 KP 检查玩家携带物品是否超出等级合理范围

import type { WorldModelLoader } from "../world/world-model-loader";
import { getArchetype, type GeneratedCharacter } from "../character/character-factory";

// ============================================================
// 校验结果
// ============================================================

export interface ItemCheckResult {
  itemName: string;
  severity: "ok" | "caution" | "warning" | "flag";
  reason: string;
  /** 建议的替代物品 */
  suggestion?: string;
}

export interface LoadoutReview {
  character: string;
  level: number;
  archetype: string;
  items: ItemCheckResult[];
  /** 综合评定：是否可以批准 */
  approved: boolean;
  /** KP 备注 */
  kpNotes: string;
}

// ============================================================
// 稀有度判断规则（从世界模型提取的模式）
// ============================================================

// 关键词 → 等级门槛
const ITEM_TIER_MAP: Record<string, { minLevel: number; note: string }> = {
  // 神级/唯一性物品
  "神": { minLevel: 17, note: "神器级物品，支线任务奖励级别" },
  "唯一": { minLevel: 17, note: "唯一性物品，应为剧情核心奖励" },
  "传奇": { minLevel: 13, note: "传奇级，高等级团本掉落" },
  "龙": { minLevel: 10, note: "龙类相关物品，成年龙至少需要10级团队" },
  "龙皮": { minLevel: 10, note: "龙皮装备，猎龙等级" },
  "龙鳞": { minLevel: 10, note: "龙鳞装备，猎龙等级" },
  "圣": { minLevel: 8, note: "带有神圣属性的物品，中高级" },
  "禁咒": { minLevel: 13, note: "禁咒级法术/物品，战役级消耗" },
  // 稀有级
  "史诗": { minLevel: 7, note: "史诗级装备，冒险者公会稀有任务奖励" },
  "稀有": { minLevel: 5, note: "稀有物资，需要特定来源或专业商人" },
  "秘银": { minLevel: 5, note: "秘银物品，比普通金属贵5-10倍" },
  // 常规级
  "精良": { minLevel: 3, note: "精良品质，正规渠道可购得" },
  "附魔": { minLevel: 3, note: "附魔物品，低等级可携带低级附魔" },
};

// 身份/来源限制
const SOURCE_CHECKS: Array<{
  keywords: string[];
  check: (level: number) => string | null;
}> = [
  {
    keywords: ["军队", "军用", "制式"],
    check: (lv) => lv < 3 ? "军用品，低级角色需有合理背景（退伍军人/偷窃/购买黑市）" : null,
  },
  {
    keywords: ["皇室", "王室", "皇帝"],
    check: (lv) => lv < 7 ? "皇室物品，需有贵族血统或特殊任务背景" : null,
  },
  {
    keywords: ["深渊", "地狱", "恶魔"],
    check: (lv) => lv < 5 ? "深渊/地狱物品，可能带有诅咒或阵营隐患" : null,
  },
  {
    keywords: ["冥", "死亡", "亡灵"],
    check: (lv) => lv < 3 ? "亡灵相关物品，低级角色接触可能导致san值/腐化问题" : null,
  },
];

// ============================================================
// CoC 场景类型推断（基于玩家装备）
// ============================================================

interface ScenarioHint {
  weapons: string[];
  scenario: string;
  kpAdvice: string;
  difficulty: "narrative" | "combat_light" | "combat_heavy" | "cosmic";
}

const COC_SCENARIO_HINTS: ScenarioHint[] = [
  {
    weapons: ["霰弹枪", "猎枪", "步枪", "手枪", "左轮", "冲锋枪"],
    scenario: "高强度战斗",
    kpAdvice: "准备战斗遭遇：深潜者、食尸鬼、邪教徒。子弹消耗=资源管理压力。",
    difficulty: "combat_heavy",
  },
  {
    weapons: ["炸药", "手榴弹", "燃烧瓶", "雷管"],
    scenario: "可能需要炸开某些东西",
    kpAdvice: "准备可摧毁的场景元素：封死的门、需要爆破的墙壁。爆炸会引来人。",
    difficulty: "combat_light",
  },
  {
    weapons: ["手电筒", "相机", "笔记本", "放大镜", "证据袋"],
    scenario: "标准调查",
    kpAdvice: "调查员准备充分。SAN检定和知识检定是主线。战斗最多一场。",
    difficulty: "narrative",
  },
  {
    weapons: ["圣水", "十字架", "银匕首", "护身符", "经文"],
    scenario: "超自然对抗——但子弹没用",
    kpAdvice: "子弹穿不过星之彩。考虑神话生物免疫物理伤害的设定。",
    difficulty: "cosmic",
  },
  {
    weapons: ["旧印", "《死灵书》", "驱魔仪式"],
    scenario: "神话知识型",
    kpAdvice: "调查员知道自己在面对什么。可以给更多SAN奖励，但意味着他们已看过不该看的东西。",
    difficulty: "cosmic",
  },
];

export function analyzeCoCLoadout(items: string[]): string {
  if (items.length === 0) return "无携带物品——CoC角色的装备清单是角色塑造的一部分。";
  const hints: string[] = [];
  for (const hint of COC_SCENARIO_HINTS) {
    if (hint.weapons.some((w) => items.some((i) => i.includes(w)))) {
      hints.push(`${hint.scenario}: ${hint.kpAdvice}`);
    }
  }
  if (hints.length === 0) return "无法判定场景类型。建议与玩家讨论角色背景后再定。";
  return hints.join("\n");
}

// ============================================================
// 装备堆载限制 — 防无限堆军备
// ============================================================

interface CarryLimit {
  category: string;
  keywords: string[];
  limit: number;
  reasoning: string;
}

const CARRY_LIMITS: CarryLimit[] = [
  {
    category: "大型武器",  keywords: ["霰弹枪","猎枪","步枪","冲锋枪","机枪","十字弩","长弓","大剑","战斧","长矛","戟","巨剑","战锤"],
    limit: 1, reasoning: "大型武器需双手操作，最多一把。第二把背背上——反应减半。",
  },
  {
    category: "小型武器",  keywords: ["手枪","匕首","短剑","手斧","警棍","刀","指虎"],
    limit: 2, reasoning: "腰间一把、靴子一把。超过需要解释放哪。",
  },
  {
    category: "爆炸物",    keywords: ["炸药","手榴弹","燃烧瓶","雷管","炸弹","火药"],
    limit: 3, reasoning: "携带大量爆炸物不仅重，走火风险上升。超过三个KP要求幸运检定。",
  },
  {
    category: "护甲",      keywords: ["护甲","甲胄","防弹衣","盾牌","鳞甲","链甲","板甲","皮甲"],
    limit: 1, reasoning: "穿两层甲=自废武功——移动-4，潜行强制劣势。",
  },
  {
    category: "弹药",      keywords: ["子弹","箭","弩矢","散弹","弹匣"],
    limit: 5, reasoning: "每单位=标准弹药盒。超过5盒重量影响移动。",
  },
  {
    category: "神秘物品",  keywords: ["旧印","《死灵书》","护身符","圣水","经文","驱魔","仪式刀","银"],
    limit: 4, reasoning: "合理的信仰背景可携带多个。超过四个=囤积圣物——教会不允许。",
  },
];

export function checkCarryLimit(items: string[]): { passed: boolean; warnings: string[] } {
  const warnings: string[] = [];
  for (const limit of CARRY_LIMITS) {
    const matches = items.filter(i => limit.keywords.some(kw => i.includes(kw)));
    if (matches.length > limit.limit) {
      warnings.push(`[${limit.category}] ${matches.length}件(限${limit.limit}): ${matches.join("、")}。${limit.reasoning}`);
    }
  }
  return { passed: warnings.length === 0, warnings };
}

// ============================================================
// 校验引擎
// ============================================================

export class ItemValidator {
  private worldModel: WorldModelLoader | null;

  constructor(worldModel: WorldModelLoader | null = null) {
    this.worldModel = worldModel;
  }

  /**
   * 审卡——检查角色的全部携带物品
   */
  reviewLoadout(character: GeneratedCharacter, items: string[]): LoadoutReview {
    const results: ItemCheckResult[] = [];
    const level = character.totalLevel;
    // character.archetype 存的是职业 id（如 "investigator"），不是职业对象。
    // 原写法取 .label 恒为 undefined，KP 备注里会直接出现 "undefined"。
    const archetypeLabel = getArchetype(character.archetype)?.label ?? character.archetype;

    for (const item of items) {
      const check = this.checkItem(item, level);
      results.push(check);
    }

    const flagged = results.filter((r) => r.severity === "flag" || r.severity === "warning");
    const approved = flagged.length === 0;

    let kpNotes = "";
    if (!approved) {
      const criticalItems = flagged.map((f) => f.itemName).join("、");
      kpNotes = `[物品警告] ${criticalItems} 超出${archetypeLabel} Lv${level}的合理携带范围。建议调整或补充背景说明。`;
    } else {
      kpNotes = "物品清单在合理范围内，可以批准。";
    }

    // CoC 场景推断
    kpNotes += "\n\n[场景推断] " + analyzeCoCLoadout(items);

    // 装备堆载限制
    const carry = checkCarryLimit(items);
    if (carry.warnings.length > 0) {
      kpNotes += "\n\n[堆载警告]\n" + carry.warnings.join("\n");
    }

    return {
      character: character.name,
      level,
      archetype: archetypeLabel,
      items: results,
      approved,
      kpNotes,
    };
  }

  private checkItem(item: string, level: number): ItemCheckResult {
    // Step 1: 稀有度关键字匹配
    for (const [kw, rule] of Object.entries(ITEM_TIER_MAP)) {
      if (item.includes(kw)) {
        if (level < rule.minLevel) {
          return {
            itemName: item,
            severity: level < rule.minLevel - 5 ? "flag" : "warning",
            reason: `${rule.note}——建议等级 ${rule.minLevel}+，当前 ${level}`,
            suggestion: `等待 Lv${rule.minLevel} 后获取，或用${this.suggestDowngrade(kw)}替代`,
          };
        }
        return { itemName: item, severity: "ok", reason: `${rule.note} — 等级匹配` };
      }
    }

    // Step 2: 来源合法性检查
    for (const sc of SOURCE_CHECKS) {
      if (sc.keywords.some((kw) => item.includes(kw))) {
        const issue = sc.check(level);
        if (issue) {
          return {
            itemName: item,
            severity: "caution",
            reason: issue,
            suggestion: "在背景故事中说明获取来源",
          };
        }
      }
    }

    // Step 3: 世界模型交叉验证（如果已加载）
    if (this.worldModel) {
      const matches = this.worldModel.queryBehavior([item], 1);
      if (matches.length > 0) {
        const wf = matches[0].world_fit;
        if (wf >= 4 && level < 5) {
          return {
            itemName: item,
            severity: "caution",
            reason: `世界模型标记此物品为高世界契合度(${wf}/5)，低等级角色携带可能破坏平衡`,
            suggestion: "限制使用次数或设定为'损坏/未激活'状态",
          };
        }
      }
    }

    return { itemName: item, severity: "ok", reason: "无异常" };
  }

  private suggestDowngrade(keyword: string): string {
    const map: Record<string, string> = {
      "龙": "蜥蜴/飞龙幼崽材料",
      "龙皮": "厚皮/岩蜥皮",
      "龙鳞": "铁鳞/硬化鳞片",
      "圣": "受祝福",
      "史诗": "优秀品质",
      "传奇": "精良品质",
      "禁咒": "高级魔法",
      "神": "大师级",
    };
    return map[keyword] || "同级普通物品";
  }
}
