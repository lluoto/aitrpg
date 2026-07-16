// D&D 进阶职业注册表 — 仅识别层，构筑细节在玩家规则书中
// 每职业只存：名 + 描述 + 属性倾向 + 技能推荐 + 先决条件标签
// 等级表/特性数值/每日次数 → 翻阅对应规则书

import type { CharacterArchetype } from "./character-factory";

export const PRESTIGE_CLASSES: CharacterArchetype[] = [
  {
    id: "warmaster",
    label: "战争巨匠",
    description: "战争学院的精英毕业生，担当军队的高级将领。以领导力和战术鼓舞全军",
    minAttributes: { strength: 13, charisma: 13 },
    priorityAttributes: ["charisma", "strength", "constitution"],
    skills: ["persuasion", "intimidation", "insight"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    isPrestige: true,
    maxLevel: 10,
    prerequisites: {
      minLevel: 5,
      minBAB: 7,
      skills: { persuasion: 5 },
      feats: ["leadership", "martial_weapon_proficiency", "weapon_specialization"],
      alignment: ["lawful_good", "lawful_neutral", "neutral_good", "true_neutral"],
    },
    levelFeatures: [],  // 详见规则书：10级特性表
  },
];
