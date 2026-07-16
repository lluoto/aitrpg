// ============================================================
// 结构化状态/疾病系统
// ============================================================

export type StatusCategory =
  | "physical"   // 物理：中毒、流血
  | "mental"     // 精神：恐惧、魅惑
  | "combat"     // 战斗：潜行、专注
  | "condition"  // 疾病/诅咒
  | "buff"       // 增益
  | "debuff";    // 减益

export interface StatusEffect {
  id: string;
  name: string;
  desc: string;
  category: StatusCategory;
  /** 持续回合数，-1 = 永续 */
  duration: number;
  /** 叠层数 */
  stacks: number;
  /** 来源（施法者/物品名） */
  source?: string;
  /** 每回合效果描述 */
  tickDesc?: string;
}

export function createStatus(id: string, name: string, desc: string, category: StatusCategory, duration: number): StatusEffect {
  return { id, name, desc, category, duration, stacks: 1 };
}

export function statusTick(s: StatusEffect): StatusEffect {
  if (s.duration === -1) return s;
  return { ...s, duration: Math.max(0, s.duration - 1) };
}

export function isStatusExpired(s: StatusEffect): boolean {
  return s.duration !== -1 && s.duration <= 0;
}

export function formatStatus(s: StatusEffect): string {
  const d = s.duration === -1 ? "" : ` (${s.duration}回合)`;
  const st = s.stacks > 1 ? ` x${s.stacks}` : "";
  return `${s.name}${d}${st}`;
}

// ── 预设状态库 ──────────────────────────────────────

const STATUS_LIB: Record<string, { name: string; desc: string; category: StatusCategory; defaultDuration: number }> = {
  poisoned:      { name: "中毒",   desc: "每回合受到毒属性伤害", category: "physical", defaultDuration: 4 },
  bleeding:      { name: "流血",   desc: "持续损失体力",        category: "physical", defaultDuration: 3 },
  burning:       { name: "燃烧",   desc: "被火焰吞噬",          category: "physical", defaultDuration: 2 },
  stunned:       { name: "昏迷",   desc: "无法行动",            category: "combat",   defaultDuration: 1 },
  blinded:       { name: "致盲",   desc: "视线受阻",            category: "debuff",   defaultDuration: 2 },
  frightened:    { name: "恐惧",   desc: "意志检定劣势",        category: "mental",   defaultDuration: 3 },
  charmed:       { name: "魅惑",   desc: "受控于施法者",        category: "mental",   defaultDuration: 3 },
  prone:         { name: "倒地",   desc: "近战攻击优势，远程劣势", category: "combat", defaultDuration: -1 },
  sneaking:      { name: "潜行",   desc: "不易被察觉",          category: "combat",   defaultDuration: -1 },
  concentrating: { name: "专注",   desc: "维持法术",            category: "combat",   defaultDuration: -1 },
  inspiration:   { name: "鼓舞",   desc: "下次检定优势",        category: "buff",     defaultDuration: 2 },
  exhausted:     { name: "疲惫",   desc: "所有检定劣势",        category: "debuff",   defaultDuration: 5 },
  diseased:      { name: "染病",   desc: "持续虚弱",            category: "condition", defaultDuration: 7 },
  cursed:        { name: "诅咒",   desc: "神秘力量影响",        category: "condition", defaultDuration: -1 },
  confused:      { name: "困惑",   desc: "行动随机",            category: "mental",   defaultDuration: 2 },
  grappled:      { name: "擒抱",   desc: "失去闪避能力",       category: "combat",   defaultDuration: -1 },
  hasted:        { name: "加速",   desc: "额外行动机会",        category: "buff",     defaultDuration: 3 },
  slowed:        { name: "迟缓",   desc: "移动速度减半",        category: "debuff",   defaultDuration: 2 },
};

export function getStatusDef(id: string): { name: string; desc: string; category: StatusCategory; defaultDuration: number } | undefined {
  return STATUS_LIB[id];
}

export function listStatusDefs(): { id: string; name: string; desc: string; category: string }[] {
  return Object.entries(STATUS_LIB).map(([id, def]) => ({
    id, name: def.name, desc: def.desc, category: def.category,
  }));
}