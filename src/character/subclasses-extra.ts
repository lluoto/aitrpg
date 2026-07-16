// 子职扩展 — 非 SRD 来源，按需导入
// 
// 导入方式（在 index.ts 中）：
//   import { PHB_SUBCLASSES } from "./character/subclasses/phb-extra";
//   import { XGE_SUBCLASSES } from "./character/subclasses/xge-extra";  
//   import { TCE_SUBCLASSES } from "./character/subclasses/tce-extra";
//   CharacterFactory.registerExtra(PHB_SUBCLASSES);
//   CharacterFactory.registerExtra(XGE_SUBCLASSES);
//
// 正常跑团：玩家持有对应规则书即可选用，无需"导入"
// 本系统：SRD 仅含每职1个子职，其余需显式加载

import type { CharacterArchetype } from "../character-factory";

// ============================================================
// PHB 非 SRD 子职（玩家手册，Wizards of the Coast ©）
// 包含 SRD 未收录的 PHB 子职
// ============================================================

export const PHB_SUBCLASSES: CharacterArchetype[] = [
  { id:"barbarian_totem",      label:"蛮族·图腾道途",     description:"与动物精魂结盟，获得熊/鹰/狼之力",    minAttributes:{strength:13,constitution:12,wisdom:12}, priorityAttributes:["strength","constitution","wisdom"],    skills:["nature","survival","perception"], baseHp:14, rulesets:["dnd5e"], baseClassId:"barbarian" },
  { id:"bard_valor",           label:"吟游诗人·勇气学院", description:"战斗型诗人，边战斗边施法",            minAttributes:{charisma:13,strength:12,dexterity:12},   priorityAttributes:["charisma","strength","dexterity"],    skills:["athletics","intimidation","persuasion"], baseHp:10, rulesets:["dnd5e"], baseClassId:"bard" },
  { id:"cleric_tempest",       label:"牧师·风暴领域",     description:"侍奉风暴之神，掌控雷电",              minAttributes:{wisdom:13,strength:12},                    priorityAttributes:["wisdom","strength","constitution"],  skills:["nature","intimidation","athletics"], baseHp:10, rulesets:["dnd5e"], baseClassId:"cleric" },
  { id:"cleric_war",           label:"牧师·战争领域",     description:"战斗牧者，身着重甲冲锋陷阵",          minAttributes:{wisdom:13,strength:13,constitution:12},    priorityAttributes:["strength","wisdom","constitution"],   skills:["athletics","intimidation","religion"], baseHp:10, rulesets:["dnd5e"], baseClassId:"cleric" },
  { id:"druid_moon",           label:"德鲁伊·月亮结社",   description:"专注野兽变形，可变强兽战斗",          minAttributes:{wisdom:13,constitution:14},                 priorityAttributes:["wisdom","constitution","strength"],  skills:["nature","athletics","survival"], baseHp:10, rulesets:["dnd5e"], baseClassId:"druid" },
  { id:"fighter_battlemaster", label:"战士·战术大师",     description:"精通缴械/绊摔/精准等多种战斗技巧",    minAttributes:{strength:13,dexterity:13,intelligence:12}, priorityAttributes:["strength","dexterity","intelligence"],skills:["athletics","intimidation","insight"], baseHp:12, rulesets:["dnd5e"], baseClassId:"fighter" },
  { id:"fighter_eldritch",     label:"战士·奥法骑士",     description:"同时掌握剑术和防护/塑能魔法",          minAttributes:{strength:13,intelligence:13},               priorityAttributes:["strength","intelligence","constitution"],skills:["arcana","athletics","investigation"], baseHp:12, rulesets:["dnd5e"], baseClassId:"fighter" },
  { id:"monk_shadow",          label:"武僧·暗影宗",       description:"在阴影中行动的忍者型武僧",            minAttributes:{dexterity:13,wisdom:13},                   priorityAttributes:["dexterity","wisdom","stealth"],      skills:["stealth","acrobatics","perception"], baseHp:10, rulesets:["dnd5e"], baseClassId:"monk" },
  { id:"monk_elements",        label:"武僧·四象宗",       description:"操控地风水火四种元素的武僧",          minAttributes:{dexterity:13,wisdom:14},                   priorityAttributes:["wisdom","dexterity","constitution"], skills:["arcana","acrobatics","nature"], baseHp:10, rulesets:["dnd5e"], baseClassId:"monk" },
  { id:"paladin_vengeance",    label:"圣武士·复仇之誓",   description:"以消灭邪恶为己任的黑暗圣武士",        minAttributes:{strength:13,charisma:13,constitution:12},  priorityAttributes:["strength","charisma","constitution"], skills:["intimidation","athletics","persuasion"], baseHp:12, rulesets:["dnd5e"], baseClassId:"paladin" },
  { id:"paladin_ancients",     label:"圣武士·古贤之誓",   description:"守护自然与光明的古老誓约",            minAttributes:{strength:13,charisma:13,wisdom:12},        priorityAttributes:["charisma","strength","wisdom"],       skills:["nature","persuasion","religion"], baseHp:12, rulesets:["dnd5e"], baseClassId:"paladin" },
  { id:"ranger_beastmaster",   label:"游侠·兽王",         description:"与一头野兽伙伴并肩作战",              minAttributes:{dexterity:13,wisdom:14},                   priorityAttributes:["wisdom","dexterity","constitution"], skills:["animal_handling","survival","nature"], baseHp:12, rulesets:["dnd5e"], baseClassId:"ranger" },
  { id:"rogue_assassin",       label:"游荡者·刺客",       description:"精通暗杀和伪装的致命杀手",            minAttributes:{dexterity:14,intelligence:10,charisma:10}, priorityAttributes:["dexterity","intelligence","charisma"],skills:["stealth","deception","persuasion"], baseHp:10, rulesets:["dnd5e"], baseClassId:"rogue" },
  { id:"rogue_arcane",         label:"游荡者·诡术师",     description:"使用有限魔法的盗贼，法术辅助偷窃",    minAttributes:{dexterity:13,intelligence:13},              priorityAttributes:["dexterity","intelligence","charisma"],skills:["arcana","stealth","sleight_of_hand"], baseHp:10, rulesets:["dnd5e"], baseClassId:"rogue" },
  { id:"sorcerer_wild",        label:"术士·狂野魔法",     description:"魔力源自混沌，施法可能产生随机效果",  minAttributes:{charisma:13,constitution:14},               priorityAttributes:["charisma","constitution","dexterity"],skills:["arcana","intimidation","persuasion"], baseHp:8, rulesets:["dnd5e"], baseClassId:"sorcerer" },
  { id:"wizard_necromancy",    label:"法师·死灵学派",     description:"操控生死之力，可唤起亡灵仆从",        minAttributes:{intelligence:14,constitution:12},            priorityAttributes:["intelligence","constitution","wisdom"],skills:["arcana","medicine","religion"], baseHp:8, rulesets:["dnd5e"], baseClassId:"wizard" },
  { id:"wizard_illusion",      label:"法师·幻术学派",     description:"精通幻象和欺骗的法师",                minAttributes:{intelligence:14,charisma:12},               priorityAttributes:["intelligence","charisma","dexterity"],skills:["arcana","deception","stealth"], baseHp:8, rulesets:["dnd5e"], baseClassId:"wizard" },
  { id:"wizard_divination",    label:"法师·预言学派",     description:"能窥见未来，可修改命运骰子",          minAttributes:{intelligence:14,wisdom:13},                 priorityAttributes:["intelligence","wisdom","dexterity"],  skills:["arcana","investigation","insight"], baseHp:8, rulesets:["dnd5e"], baseClassId:"wizard" },
];

// ============================================================
// Xanathar's Guide to Everything（Wizards of the Coast ©）
// ============================================================

export const XGE_SUBCLASSES: CharacterArchetype[] = [
  { id:"barbarian_zealot",     label:"蛮族·狂热者道途",   description:"被神祇赐福的战士，濒死时仍能战斗",    minAttributes:{strength:13,constitution:14,charisma:10}, priorityAttributes:["constitution","strength","charisma"], skills:["religion","intimidation","athletics"], baseHp:14, rulesets:["dnd5e"], baseClassId:"barbarian" },
  { id:"druid_spores",         label:"德鲁伊·孢子结社",   description:"操控真菌和腐朽之力",                  minAttributes:{wisdom:13,constitution:12,intelligence:10},priorityAttributes:["wisdom","constitution","intelligence"],skills:["nature","medicine","survival"], baseHp:10, rulesets:["dnd5e"], baseClassId:"druid" },
  { id:"ranger_gloom",         label:"游侠·幽暗追猎者",   description:"在黑暗中狩猎，暗影即是盟友",          minAttributes:{dexterity:13,wisdom:13,constitution:12},   priorityAttributes:["dexterity","wisdom","constitution"],  skills:["stealth","survival","perception"], baseHp:12, rulesets:["dnd5e"], baseClassId:"ranger" },
  { id:"rogue_swashbuckler",   label:"游荡者·剑客",       description:"以魅力和剑术周旋的优雅决斗者",        minAttributes:{dexterity:13,charisma:14},                  priorityAttributes:["charisma","dexterity","constitution"],skills:["acrobatics","persuasion","performance"], baseHp:10, rulesets:["dnd5e"], baseClassId:"rogue" },
  { id:"sorcerer_divine",      label:"术士·天界血脉",     description:"魔力源自天界祖先，可施展治疗法术",    minAttributes:{charisma:13,wisdom:12},                    priorityAttributes:["charisma","wisdom","constitution"],  skills:["religion","persuasion","medicine"], baseHp:8, rulesets:["dnd5e"], baseClassId:"sorcerer" },
  { id:"warlock_hexblade",     label:"邪术师·魔刃宗主",   description:"与暗影武器订契，以魅力代替力量战斗",  minAttributes:{charisma:14,dexterity:12},                  priorityAttributes:["charisma","dexterity","constitution"],skills:["arcana","intimidation","athletics"], baseHp:10, rulesets:["dnd5e"], baseClassId:"warlock" },
  { id:"warlock_celestial",    label:"邪术师·天界宗主",   description:"与天界存在订契，获得治疗与光耀之力",  minAttributes:{charisma:13,wisdom:12},                    priorityAttributes:["charisma","wisdom","constitution"],  skills:["religion","persuasion","medicine"], baseHp:10, rulesets:["dnd5e"], baseClassId:"warlock" },
];

// ============================================================
// Tasha's Cauldron of Everything（Wizards of the Coast ©）
// ============================================================

export const TCE_SUBCLASSES: CharacterArchetype[] = [
  { id:"bard_eloquence",       label:"吟游诗人·雄辩学院", description:"言辞即是武器，话语无可辩驳",          minAttributes:{charisma:14,intelligence:12},              priorityAttributes:["charisma","intelligence","dexterity"],skills:["persuasion","deception","insight"], baseHp:10, rulesets:["dnd5e"], baseClassId:"bard" },
  { id:"wizard_bladesinger",   label:"法师·剑咏者",       description:"将魔法融入剑术的精灵战法",            minAttributes:{intelligence:13,dexterity:14},              priorityAttributes:["dexterity","intelligence","constitution"],skills:["acrobatics","arcana","performance"], baseHp:8, rulesets:["dnd5e"], baseClassId:"wizard" },
  // 工匠师（艾伯伦设定，Tasha's 重印）
  { id:"artificer",            label:"工匠师·炼金术士",   description:"用科学和魔法制造神奇装置的发明家",    minAttributes:{intelligence:13,dexterity:12},              priorityAttributes:["intelligence","dexterity","constitution"],skills:["arcana","investigation","science_chemistry"], baseHp:10, rulesets:["dnd5e"], baseClassId:"artificer" },
  { id:"artificer_battlesmith",label:"工匠师·战锻师",     description:"制造构装体伙伴，可用智力代替力量攻击",minAttributes:{intelligence:14,strength:10,constitution:12}, priorityAttributes:["intelligence","constitution","strength"],skills:["arcana","athletics","investigation"], baseHp:10, rulesets:["dnd5e"], baseClassId:"artificer" },
  { id:"artificer_armorer",    label:"工匠师·装甲师",     description:"穿戴自制魔法装甲的前线战斗工匠",      minAttributes:{intelligence:13,strength:12},               priorityAttributes:["intelligence","strength","constitution"],skills:["arcana","athletics","investigation"], baseHp:10, rulesets:["dnd5e"], baseClassId:"artificer" },
];

// ============================================================
// 公共领域子职（Lovecraft Cthulhu Mythos — Public Domain）
// 旧日支配者概念源自 H.P. Lovecraft 1920-1937 作品，非 WotC 原创
// ============================================================

export const PD_SUBCLASSES: CharacterArchetype[] = [
  { id:"warlock_oldone",       label:"邪术师·旧日支配者", description:"与不可名状的古神订契，获得精神力量",  minAttributes:{charisma:13,intelligence:12},               priorityAttributes:["charisma","intelligence","wisdom"],  skills:["arcana","occult","investigation"], baseHp:10, rulesets:["dnd5e"], baseClassId:"warlock" },
];

// 向后兼容：合并导出
export const EXTRA_SUBCLASSES: CharacterArchetype[] = [
  ...PD_SUBCLASSES,
  ...PHB_SUBCLASSES,
  ...XGE_SUBCLASSES,
  ...TCE_SUBCLASSES,
];
