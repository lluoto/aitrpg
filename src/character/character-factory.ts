// 角色创建系统 — 职业模板 + 属性约束 + 自动补齐
// 解决"老兵没有合理敏捷/体质"的问题

import type { WorldEntity } from "../types";

// ============================================================
// 类型定义
// ============================================================

export type ArchetypeId = string;

export type ArchetypeRole =
  | "striker" | "leader" | "controller" | "defender"
  | "healer" | "face" | "skill_monkey" | "blaster";

export type Skill5e =
  | "acrobatics" | "animal_handling" | "arcana" | "athletics"
  | "deception" | "history" | "insight" | "intimidation"
  | "investigation" | "medicine" | "nature" | "perception"
  | "performance" | "persuasion" | "religion" | "sleight_of_hand"
  | "stealth" | "survival";

export type SaveType5e =
  | "strength" | "dexterity" | "constitution"
  | "intelligence" | "wisdom" | "charisma";

export type SkillSource = "class" | "background" | "feat";

export type AttackModifier = { type: "flat" | "ability" | "proficiency"; value: number; };
export type DamageModifier = { dice: string; ability?: string; damageType?: string; };
export type ArmorModifier = { base?: number; bonus?: number; maxDex?: number; };
export type SaveModifier = { type: "proficiency" | "advantage" | "flat"; value: number; };
export type AbilityBonus = { ability: string; bonus: number; };
export type SaveAdvantage = { abilities: string[]; };
export type SkillBonus = { skills: string[]; bonus: number; };
export type ExtraAttack = { count: number; };
export type CustomTag = string;

export interface LevelFeature {
  level: number;
  name: string;
  description: string;
}

export interface FeatChoice {
  level: number;
  count: number;
  options: string[];
}

export interface Prerequisite {
  minLevel?: number;
  minBAB?: number;
  skills?: Record<string, number>;
  minAttributes?: Record<string, number>;
  feats?: string[];
  alignment?: string[];
}

export interface SubclassChoice {
  level: number;
  options: string[];
}

/** D&D 5e / CoC 7e 角色职业模板 */
export interface CharacterArchetype {
  id: string;
  label: string;
  description?: string;
  role?: ArchetypeRole;
  archetypes?: CharacterArchetype[];

  /** 属性门槛（D&D: 至少 13，CoC: 至少 60 等） */
  minAttributes?: Record<string, number>;
  /** 推荐加点优先级 */
  priorityAttributes?: string[];

  /** 职业技能列表（D&D 用英文 skillId，CoC 用中文名） */
  skills?: string[];
  /** 技能来源 */
  skillsSource?: SkillSource;
  /** 可选技能数量（玩家从 skills 中选 N 个） */
  skillCount?: number;

  /** 基础 HP */
  baseHp?: number;
  /** 适用规则集 */
  rulesets: string[];
  /** 豁免熟练 */
  saveProficiencies?: SaveType5e[];

  /** 施法能力 */
  spellcaster?: boolean;
  spellcastingType?: "full" | "half" | "pact" | "third";

  /** 满级 */
  maxLevel?: number;
  /** 等级特性（自动特性） */
  levelFeatures?: LevelFeature[];
  /** 专长选择（可选） */
  featChoices?: FeatChoice[];

  /** 进阶前置 */
  prerequisites?: Prerequisite;

  /** 子职选择 */
  subclassChoices?: SubclassChoice[];

  /** 是否为进阶/扩展职业 */
  isPrestige?: boolean;
  /** 是否为乾坤子职 */
  isSubclass?: boolean;
  /** 子职所属基础职业 ID */
  baseClassId?: string;
  /** 是否随等级自动解锁 */
  autoUnlock?: boolean;

  // ── CoC 7e 扩展字段 ──

  /** 职业技能列表（英文 skill ID，用于技能分配计算） */
  occupationSkills?: string[];
  /** 信用评级范围 */
  creditRatingRange?: [number, number];
  /** 属性最大值的段约束（覆盖全局 90 上限） */
  maxAttributeValue?: number;
  /** 职业技能点来源属性（默认 education） */
  skillSourceAttribute?: "education" | "intelligence" | "dexterity";
  /** 职业技能点倍率（默认 1） */
  skillPointMultiplier?: number;
  /** 强制初始技能（英文 skillId） */
  mandatorySkills?: string[];
}

/** 完整 GeneratedCharacter 接口（兼容 D&D + CoC） */
export interface GeneratedCharacter {
  name: string;
  archetype: string;
  attributes: Record<string, number>;
  hp: number;
  maxHp: number;
  ac: number;
  skills: string[];
  ruleset: string;
  valid: boolean;
  warnings: string[];

  classLevels: Map<string, number>;
  totalLevel: number;
  baseAttackBonus: number;
  activeFeatures: LevelFeature[];
  selectedFeats: string[];
  startingItems?: string[];

  // CoC 7e 字段
  damageBonus?: string;
  build?: number;
  move?: number;
  luck?: number;
  creditRating?: number;
  occupationSkillPoints?: number;
  interestSkillPoints?: number;
  occupationSkills?: string[];
  /** 技能值（英文 key → 百分比），由分配器生成 */
  skillValues?: Record<string, number>;
}

export interface FeatureEffect {
  id: string;
  name: string;
  description: string;
  type: "class_feature" | "feat" | "item" | "spell" | "condition";
  source?: string;
  modifiers?: {
    attack?: AttackModifier[];
    damage?: DamageModifier[];
    armor?: ArmorModifier;
    saves?: SaveModifier[];
    skills?: SkillBonus[];
    extraAttack?: ExtraAttack;
    abilities?: AbilityBonus[];
    saveAdvantage?: SaveAdvantage[];
  };
  tags?: string[];
}

// ============================================================
// D&D 5e 职业模板
// ============================================================

const DND_ARCHETYPES: CharacterArchetype[] = [
  // ═══ 蛮族 Barbarian — Path of the Berserker ═══
  {
    id: "barbarian", label: "蛮族·狂战士道路",
    description: "愤怒驱动的战士，进入狂暴后无所畏俱",
    minAttributes: { strength: 13, constitution: 12 },
    priorityAttributes: ["strength", "constitution", "dexterity"],
    skills: ["athletics", "intimidation", "survival"],
    baseHp: 14, rulesets: ["dnd5e"], saveProficiencies: ["strength", "constitution"],
  },
  // ═══ 吟游诗人 Bard — College of Lore ═══
  {
    id: "bard", label: "吟游诗人·学识学院",
    description: "用音乐和语言施展魔法的多面手",
    minAttributes: { charisma: 13, dexterity: 12 },
    priorityAttributes: ["charisma", "dexterity", "intelligence"],
    skills: ["persuasion", "performance", "history"],
    baseHp: 10, rulesets: ["dnd5e"], saveProficiencies: ["dexterity", "charisma"],
    spellcaster: true, spellcastingType: "full",
  },
  // ═══ 牧师 Cleric — Life Domain ═══
  {
    id: "cleric", label: "牧师·生命领域",
    description: "侍奉神祇的治疗者，拥有强大的恢复魔力",
    minAttributes: { wisdom: 13, charisma: 10 },
    priorityAttributes: ["wisdom", "charisma", "constitution"],
    skills: ["medicine", "persuasion", "religion"],
    baseHp: 10, rulesets: ["dnd5e"], saveProficiencies: ["wisdom", "charisma"],
    spellcaster: true, spellcastingType: "full",
  },
  // ═══ 德鲁伊 Druid — Circle of the Land ═══
  {
    id: "druid", label: "德鲁伊·大地结界",
    description: "自然力量的守护者，可变身野兽",
    minAttributes: { wisdom: 13, intelligence: 10 },
    priorityAttributes: ["wisdom", "constitution", "intelligence"],
    skills: ["nature", "survival", "perception"],
    baseHp: 10, rulesets: ["dnd5e"], saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true, spellcastingType: "full",
  },
  // ═══ 战士 Fighter — Champion ═══
  {
    id: "fighter", label: "战士·冠军",
    description: "精通各种武器的战斗大师，暴击范围扩大",
    minAttributes: { strength: 13, dexterity: 12 },
    priorityAttributes: ["strength", "dexterity", "constitution"],
    skills: ["athletics", "intimidation", "perception"],
    baseHp: 12, rulesets: ["dnd5e"], saveProficiencies: ["strength", "constitution"],
  },
  // ═══ 武僧 Monk — Way of the Open Hand ═══
  {
    id: "monk", label: "武僧·散打道",
    description: "以徒手和内力作战的修行者",
    minAttributes: { dexterity: 13, wisdom: 13 },
    priorityAttributes: ["dexterity", "wisdom", "constitution"],
    skills: ["acrobatics", "stealth", "religion"],
    baseHp: 10, rulesets: ["dnd5e"], saveProficiencies: ["strength", "dexterity"],
  },
  // ═══ 圣武士 Paladin — Oath of Devotion ═══
  {
    id: "paladin", label: "圣武士·奉献之誓",
    description: "受誓言约束的神圣骑士，正义的捍卫者",
    minAttributes: { strength: 13, charisma: 13 },
    priorityAttributes: ["strength", "charisma", "constitution"],
    skills: ["athletics", "persuasion", "religion"],
    baseHp: 12, rulesets: ["dnd5e"], saveProficiencies: ["wisdom", "charisma"],
    spellcaster: true, spellcastingType: "half",
  },
  // ═══ 游侠 Ranger — Hunter ═══
  {
    id: "ranger", label: "游侠·猎人",
    description: "荒野中的追踪者，擅长远程战斗",
    minAttributes: { dexterity: 13, wisdom: 13 },
    priorityAttributes: ["dexterity", "wisdom", "constitution"],
    skills: ["survival", "stealth", "perception"],
    baseHp: 12, rulesets: ["dnd5e"], saveProficiencies: ["strength", "dexterity"],
    spellcaster: true, spellcastingType: "half",
  },
  // ═══ 游荡者 Rogue — Thief ═══
  {
    id: "rogue", label: "游荡者·盗贼",
    description: "阴影中的刺客与宝藏猎人",
    minAttributes: { dexterity: 13, intelligence: 10 },
    priorityAttributes: ["dexterity", "intelligence", "charisma"],
    skills: ["stealth", "sleight_of_hand", "perception"],
    baseHp: 10, rulesets: ["dnd5e"], saveProficiencies: ["dexterity", "intelligence"],
  },
  // ═══ 术士 Sorcerer — Draconic Bloodline ═══
  {
    id: "sorcerer", label: "术士·龙族血统",
    description: "天生拥有魔法力量的施法者",
    minAttributes: { charisma: 13, constitution: 12 },
    priorityAttributes: ["charisma", "constitution", "dexterity"],
    skills: ["deception", "persuasion", "arcana"],
    baseHp: 8, rulesets: ["dnd5e"], saveProficiencies: ["constitution", "charisma"],
    spellcaster: true, spellcastingType: "full",
  },
  // ═══ 邪术师 Warlock — The Fiend ═══
  {
    id: "warlock", label: "邪术师·魔能宗主",
    description: "与异界存在签订契约的施法者",
    minAttributes: { charisma: 13, dexterity: 12 },
    priorityAttributes: ["charisma", "constitution", "dexterity"],
    skills: ["deception", "arcana", "investigation"],
    baseHp: 10, rulesets: ["dnd5e"], saveProficiencies: ["wisdom", "charisma"],
    spellcaster: true, spellcastingType: "pact",
  },
  // ═══ 法师 Wizard — Evocation ═══
  {
    id: "wizard", label: "法师·塑能学派",
    description: "通过研习奥术掌握魔法奥秘的智者",
    minAttributes: { intelligence: 13, dexterity: 12 },
    priorityAttributes: ["intelligence", "dexterity", "constitution"],
    skills: ["arcana", "investigation", "history"],
    baseHp: 8, rulesets: ["dnd5e"], saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true, spellcastingType: "full",
  },
];

// ============================================================
// CoC 7e 职业模板
// ============================================================

const COC_ARCHETYPES: CharacterArchetype[] = [
  // ── 调查员 Investigator ──
  {
    id: "investigator", label: "调查员·警官",
    description: "专门处理超自然案件的特殊警探",
    minAttributes: { intelligence: 60 },
    priorityAttributes: ["intelligence", "power", "education"],
    skills: ["侦查", "图书馆使用", "心理学", "说服", "格斗(肉搏)", "射击(手枪)"],
    occupationSkills: ["spot_hidden", "library_use", "psychology", "persuade", "fighting", "firearms_pistol"],
    baseHp: 10, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 考古学家 Archaeologist ──
  {
    id: "archaeologist", label: "考古学家",
    description: "从事古代遗址发掘与文物研究的学者",
    minAttributes: { intelligence: 60 },
    priorityAttributes: ["intelligence", "education"],
    skills: ["考古学", "历史", "图书馆使用", "人类学", "估价", "语言(其他)"],
    occupationSkills: ["archaeology", "history", "library_use", "anthropology", "appraise", "language_other"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 古物学者 Antiquarian ──
  {
    id: "antiquarian", label: "古物学者",
    description: "研究古代文物与神秘知识的学者",
    minAttributes: { intelligence: 60 },
    priorityAttributes: ["intelligence", "education"],
    skills: ["估价", "考古学", "历史", "神秘学", "图书馆使用", "语言(其他)"],
    occupationSkills: ["appraise", "archaeology", "history", "occult", "library_use", "language_other"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 记者 Journalist ──
  {
    id: "journalist_coc", label: "记者",
    description: "追逐新闻真相的文字工作者",
    minAttributes: { education: 60 },
    priorityAttributes: ["intelligence", "education"],
    skills: ["侦查", "图书馆使用", "心理学", "说服", "话术", "历史"],
    occupationSkills: ["spot_hidden", "library_use", "psychology", "persuade", "fast_talk", "history"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [50, 80],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 业余艺术爱好者 Dilettante ──
  {
    id: "dilettante", label: "业余艺术爱好者",
    description: "家境殷实的艺术与社交圈人士",
    minAttributes: { appearance: 60 },
    priorityAttributes: ["appearance", "education"],
    skills: ["说服", "魅惑", "心理学", "话术", "艺术与手艺", "驾驶"],
    occupationSkills: ["persuade", "charm", "psychology", "fast_talk", "art", "drive"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [50, 90],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 医生 Doctor of Medicine ──
  {
    id: "doctor_medicine", label: "医生",
    description: "受过专业医学训练的治疗者",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["医学", "精神分析", "心理学", "急救", "科学(生物学)", "图书馆使用"],
    occupationSkills: ["medicine", "psychoanalysis", "psychology", "first_aid", "science_biology", "library_use"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [30, 80],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 工程师 Engineer ──
  {
    id: "engineer", label: "工程师",
    description: "精通机械与电气技术的专业人员",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["机械维修", "电气维修", "计算机使用", "科学(物理学)", "驾驶", "操作重型机械"],
    occupationSkills: ["mechanical_repair", "electrical_repair", "computer_use", "science_physics", "drive", "operate_heavy_machinery"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [30, 70],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 士兵 Soldier ──
  {
    id: "soldier", label: "士兵",
    description: "军队训练的战斗人员",
    minAttributes: { strength: 60, constitution: 60 },
    priorityAttributes: ["strength", "constitution", "dexterity"],
    skills: ["格斗(肉搏)", "射击(步枪/霰弹枪)", "射击(冲锋枪)", "潜行", "运动", "急救"],
    occupationSkills: ["fighting", "firearms_rifle", "firearms_smg", "stealth", "athletics", "first_aid"],
    baseHp: 12, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 图书馆管理员 Librarian ──
  {
    id: "librarian", label: "图书馆管理员",
    description: "管理图书馆藏的信息专家",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["图书馆使用", "侦查", "心理学", "历史", "语言(其他)", "神秘学"],
    occupationSkills: ["library_use", "spot_hidden", "psychology", "history", "language_other", "occult"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 神秘学家 Occultist ──
  {
    id: "occultist", label: "神秘学家",
    description: "研究超自然现象的学者",
    minAttributes: { intelligence: 60 },
    priorityAttributes: ["intelligence", "education"],
    skills: ["神秘学", "历史", "考古学", "人类学", "图书馆使用", "语言(其他)"],
    occupationSkills: ["occult", "history", "archaeology", "anthropology", "library_use", "language_other"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 超心理学家 Parapsychologist ──
  {
    id: "parapsychologist", label: "超心理学家",
    description: "用科学方法研究心灵现象的学者",
    minAttributes: { intelligence: 60 },
    priorityAttributes: ["intelligence", "education"],
    skills: ["心理学", "精神分析", "神秘学", "图书馆使用", "科学(生物学)", "说服"],
    occupationSkills: ["psychology", "psychoanalysis", "occult", "library_use", "science_biology", "persuade"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 摄影师 Photographer ──
  {
    id: "photographer", label: "摄影师",
    description: "通过镜头记录真相的视觉工作者",
    minAttributes: { education: 50 },
    priorityAttributes: ["dexterity", "education"],
    skills: ["侦查", "艺术与手艺", "心理学", "潜行", "图书馆使用", "驾驶"],
    occupationSkills: ["spot_hidden", "art", "psychology", "stealth", "library_use", "drive"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 飞行员 Pilot ──
  {
    id: "pilot", label: "飞行员",
    description: "驾驶各类航空器的专业人员",
    minAttributes: { dexterity: 60 },
    priorityAttributes: ["dexterity", "education"],
    skills: ["驾驶", "导航", "机械维修", "电气维修", "科学(物理学)", "侦查"],
    occupationSkills: ["drive", "navigate", "mechanical_repair", "electrical_repair", "science_physics", "spot_hidden"],
    baseHp: 10, rulesets: ["coc7e"], creditRatingRange: [30, 70],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 教授 Professor ──
  {
    id: "professor", label: "教授",
    description: "高等学府的学术研究者",
    minAttributes: { education: 70 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["图书馆使用", "神秘学", "历史", "说服", "人类学", "心理学"],
    occupationSkills: ["library_use", "occult", "history", "persuade", "anthropology", "psychology"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [40, 80],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 科学家 Scientist ──
  {
    id: "scientist", label: "科学家",
    description: "从事科学实验与研究的专业人员",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["科学(化学)", "科学(生物学)", "科学(物理学)", "图书馆使用", "计算机使用", "侦查"],
    occupationSkills: ["science_chemistry", "science_biology", "science_physics", "library_use", "computer_use", "spot_hidden"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [30, 70],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 精神科医生 Psychiatrist ──
  {
    id: "psychiatrist", label: "精神科医生",
    description: "专业医治精神疾病的医疗工作者",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "power"],
    skills: ["心理学", "精神分析", "医学", "说服", "话术", "图书馆使用"],
    occupationSkills: ["psychology", "psychoanalysis", "medicine", "persuade", "fast_talk", "library_use"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [30, 70],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 艺术家 Artist ──
  {
    id: "artist", label: "艺术家",
    description: "从事视觉或表演创作的文艺工作者",
    minAttributes: { dexterity: 50 },
    priorityAttributes: ["dexterity", "education"],
    skills: ["艺术与手艺", "侦查", "心理学", "话术", "潜行", "图书馆使用"],
    occupationSkills: ["art", "spot_hidden", "psychology", "fast_talk", "stealth", "library_use"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 音乐家 Musician ──
  {
    id: "musician", label: "音乐家",
    description: "以音乐表演或创作为生的艺术家",
    minAttributes: { dexterity: 50 },
    priorityAttributes: ["dexterity", "education"],
    skills: ["艺术与手艺", "聆听", "心理学", "说服", "魅惑", "潜行"],
    occupationSkills: ["art", "listen", "psychology", "persuade", "charm", "stealth"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 运动员 Athlete ──
  {
    id: "athlete", label: "运动员",
    description: "专业从事体育竞技的运动选手",
    minAttributes: { strength: 60, dexterity: 60 },
    priorityAttributes: ["strength", "dexterity", "constitution"],
    skills: ["运动", "跳跃", "游泳", "格斗(肉搏)", "投掷", "潜行"],
    occupationSkills: ["athletics", "jump", "swim", "fighting", "throw", "stealth"],
    baseHp: 11, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 拳击手 Boxer ──
  {
    id: "boxer", label: "拳击手",
    description: "专业拳击格斗运动员",
    minAttributes: { strength: 60, constitution: 60 },
    priorityAttributes: ["strength", "constitution", "dexterity"],
    skills: ["格斗(肉搏)", "运动", "跳跃", "急救", "侦查", "恐吓"],
    occupationSkills: ["fighting", "athletics", "jump", "first_aid", "spot_hidden", "intimidate"],
    baseHp: 12, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 机械师 Mechanic ──
  {
    id: "mechanic", label: "机械师",
    description: "精通机械设备的维修与改造",
    minAttributes: { education: 50 },
    priorityAttributes: ["education", "dexterity"],
    skills: ["机械维修", "电气维修", "驾驶", "操作重型机械", "锁匠", "潜行"],
    occupationSkills: ["mechanical_repair", "electrical_repair", "drive", "operate_heavy_machinery", "lockpick", "stealth"],
    baseHp: 10, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 探险家 Explorer ──
  {
    id: "explorer", label: "探险家",
    description: "深入野外探索未知区域的冒险者",
    minAttributes: { constitution: 60 },
    priorityAttributes: ["constitution", "strength", "dexterity"],
    skills: ["自然学", "导航", "生存", "运动", "潜行", "侦查"],
    occupationSkills: ["natural_history", "navigate", "survival", "athletics", "stealth", "spot_hidden"],
    baseHp: 11, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 传教士 Missionary ──
  {
    id: "missionary", label: "传教士",
    description: "传播宗教信仰的海外工作者",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "power"],
    skills: ["说服", "心理学", "语言(其他)", "历史", "急救", "图书馆使用"],
    occupationSkills: ["persuade", "psychology", "language_other", "history", "first_aid", "library_use"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 消防员 Firefighter ──
  {
    id: "firefighter", label: "消防员",
    description: "扑灭火情与紧急救援的应急人员",
    minAttributes: { strength: 60, constitution: 60 },
    priorityAttributes: ["strength", "constitution", "dexterity"],
    skills: ["运动", "格斗(肉搏)", "攀爬", "跳跃", "急救", "驾驶"],
    occupationSkills: ["athletics", "fighting", "climb", "jump", "first_aid", "drive"],
    baseHp: 12, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 殡葬师 Undertaker ──
  {
    id: "undertaker", label: "殡葬师",
    description: "处理丧葬事务的从业者",
    minAttributes: { education: 50 },
    priorityAttributes: ["education", "power"],
    skills: ["侦查", "心理学", "医学", "历史", "潜行", "驾驶"],
    occupationSkills: ["spot_hidden", "psychology", "medicine", "history", "stealth", "drive"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 古董商 Antique Dealer ──
  {
    id: "antique_dealer", label: "古董商",
    description: "经营古玩字画的商人",
    minAttributes: { education: 50 },
    priorityAttributes: ["education", "appearance"],
    skills: ["估价", "考古学", "历史", "说服", "心理学", "话术"],
    occupationSkills: ["appraise", "archaeology", "history", "persuade", "psychology", "fast_talk"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [30, 70],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 建筑师 Architect ──
  {
    id: "architect", label: "建筑师",
    description: "从事建筑设计的专业人员",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["图书馆使用", "计算机使用", "科学(物理学)", "机械维修", "驾驶", "心理学"],
    occupationSkills: ["library_use", "computer_use", "science_physics", "mechanical_repair", "drive", "psychology"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [40, 70],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 流浪者 Drifter ──
  {
    id: "drifter", label: "流浪者",
    description: "四处漂泊的无固定居所者",
    minAttributes: { constitution: 50 },
    priorityAttributes: ["constitution", "strength"],
    skills: ["侦查", "潜行", "生存", "话术", "格斗(肉搏)", "自然学"],
    occupationSkills: ["spot_hidden", "stealth", "survival", "fast_talk", "fighting", "natural_history"],
    baseHp: 10, rulesets: ["coc7e"], creditRatingRange: [10, 30],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 林务员 Forester ──
  {
    id: "forester", label: "林务员",
    description: "管理保护森林资源的专业人员",
    minAttributes: { constitution: 60 },
    priorityAttributes: ["constitution", "strength"],
    skills: ["自然学", "生存", "导航", "潜行", "侦查", "运动"],
    occupationSkills: ["natural_history", "survival", "navigate", "stealth", "spot_hidden", "athletics"],
    baseHp: 11, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 猎人/捕兽者 Hunter Trapper ──
  {
    id: "hunter_trapper", label: "猎人/捕兽者",
    description: "以狩猎和设陷阱为生的野外生存者",
    minAttributes: { dexterity: 60 },
    priorityAttributes: ["dexterity", "constitution"],
    skills: ["侦查", "潜行", "生存", "自然学", "导航", "射击(步枪/霰弹枪)"],
    occupationSkills: ["spot_hidden", "stealth", "survival", "natural_history", "navigate", "firearms_rifle"],
    baseHp: 10, rulesets: ["coc7e"], creditRatingRange: [20, 40],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 伐木工 Lumberjack ──
  {
    id: "lumberjack", label: "伐木工",
    description: "以采伐树木为生的体力劳动者",
    minAttributes: { strength: 70 },
    priorityAttributes: ["strength", "constitution"],
    skills: ["运动", "格斗(肉搏)", "攀爬", "跳跃", "机械维修", "驾驶"],
    occupationSkills: ["athletics", "fighting", "climb", "jump", "mechanical_repair", "drive"],
    baseHp: 12, rulesets: ["coc7e"], creditRatingRange: [10, 30],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 博物馆馆长 Museum Curator ──
  {
    id: "museum_curator", label: "博物馆馆长",
    description: "负责博物馆藏品管理的研究人员",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["考古学", "历史", "估价", "人类学", "图书馆使用", "心理学"],
    occupationSkills: ["archaeology", "history", "appraise", "anthropology", "library_use", "psychology"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 药剂师 Pharmacist ──
  {
    id: "pharmacist", label: "药剂师",
    description: "配制与管理药品的专业人员",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["医学", "科学(化学)", "科学(生物学)", "会计", "心理学", "图书馆使用"],
    occupationSkills: ["medicine", "science_chemistry", "science_biology", "accounting", "psychology", "library_use"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 勘探者 Prospector ──
  {
    id: "prospector", label: "勘探者",
    description: "勘探矿产资源的地质工作者",
    minAttributes: { constitution: 60 },
    priorityAttributes: ["constitution", "strength"],
    skills: ["自然学", "导航", "生存", "驾驶", "机械维修", "侦查"],
    occupationSkills: ["natural_history", "navigate", "survival", "drive", "mechanical_repair", "spot_hidden"],
    baseHp: 11, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 研究员 Researcher ──
  {
    id: "researcher", label: "研究员",
    description: "在实验室从事科学研究的学者",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["图书馆使用", "计算机使用", "心理学", "神秘学", "科学(化学)", "侦查"],
    occupationSkills: ["library_use", "computer_use", "psychology", "occult", "science_chemistry", "spot_hidden"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 走私者 Smuggler ──
  {
    id: "smuggler", label: "走私者",
    description: "非法运输货物的黑市从业者",
    minAttributes: { dexterity: 60 },
    priorityAttributes: ["dexterity", "appearance"],
    skills: ["潜行", "话术", "侦查", "驾驶", "估价", "格斗(肉搏)"],
    occupationSkills: ["stealth", "fast_talk", "spot_hidden", "drive", "appraise", "fighting"],
    baseHp: 10, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 狂热者 Zealot ──
  {
    id: "zealot", label: "狂热者",
    description: "沉迷于某种信仰或理念的偏执者",
    minAttributes: { power: 70 },
    priorityAttributes: ["power", "intelligence"],
    skills: ["神秘学", "历史", "心理学", "说服", "潜行", "话术"],
    occupationSkills: ["occult", "history", "psychology", "persuade", "stealth", "fast_talk"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [20, 40],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 学者 Scholar ──
  {
    id: "scholar", label: "学者",
    description: "专注于学术研究的大学教员",
    minAttributes: { education: 70 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["图书馆使用", "神秘学", "历史", "考古学", "人类学", "语言(其他)"],
    occupationSkills: ["library_use", "occult", "history", "archaeology", "anthropology", "language_other"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 会计师 Accountant ──
  {
    id: "accountant", label: "会计师",
    description: "企业财务管理与审计的专业人士",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["会计", "计算机使用", "法律", "心理学", "图书馆使用", "话术"],
    occupationSkills: ["accounting", "computer_use", "law", "psychology", "library_use", "fast_talk"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [30, 70],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 演员 Actor ──
  {
    id: "actor", label: "演员",
    description: "在舞台或银幕上塑造角色的表演者",
    minAttributes: { appearance: 60 },
    priorityAttributes: ["appearance", "education"],
    skills: ["艺术与手艺", "乔装", "话术", "魅惑", "心理学", "潜行"],
    occupationSkills: ["art", "disguise", "fast_talk", "charm", "psychology", "stealth"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [20, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 作家 Author ──
  {
    id: "author", label: "作家",
    description: "以文字创作为生的文学工作者",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["心理学", "历史", "图书馆使用", "神秘学", "话术", "侦查"],
    occupationSkills: ["psychology", "history", "library_use", "occult", "fast_talk", "spot_hidden"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 私家侦探 Detective ──
  {
    id: "detective", label: "私家侦探",
    description: "接受委托进行秘密调查的私人探员",
    minAttributes: { intelligence: 60 },
    priorityAttributes: ["intelligence", "power"],
    skills: ["侦查", "图书馆使用", "心理学", "话术", "格斗(肉搏)", "潜行"],
    occupationSkills: ["spot_hidden", "library_use", "psychology", "fast_talk", "fighting", "stealth"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 司机 Driver ──
  {
    id: "driver", label: "司机",
    description: "职业驾驶各类车辆的服务人员",
    minAttributes: { dexterity: 50 },
    priorityAttributes: ["dexterity", "constitution"],
    skills: ["驾驶", "机械维修", "侦查", "潜行", "话术", "格斗(肉搏)"],
    occupationSkills: ["drive", "mechanical_repair", "spot_hidden", "stealth", "fast_talk", "fighting"],
    baseHp: 10, rulesets: ["coc7e"], creditRatingRange: [10, 40],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 联邦探员 Federal Agent ──
  {
    id: "federal_agent", label: "联邦探员",
    description: "在联邦执法机构工作的特工人员",
    minAttributes: { strength: 50, intelligence: 60 },
    priorityAttributes: ["intelligence", "strength", "dexterity"],
    skills: ["侦查", "格斗(肉搏)", "射击(手枪)", "法律", "心理学", "话术"],
    occupationSkills: ["spot_hidden", "fighting", "firearms_pistol", "law", "psychology", "fast_talk"],
    baseHp: 11, rulesets: ["coc7e"], creditRatingRange: [40, 80],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 黑客 Hacker ──
  {
    id: "hacker", label: "黑客",
    description: "精通计算机系统与网络攻防的技术专家",
    minAttributes: { intelligence: 70 },
    priorityAttributes: ["intelligence", "dexterity"],
    skills: ["计算机使用", "电子学", "图书馆使用", "侦查", "电气维修", "潜行"],
    occupationSkills: ["computer_use", "electronics", "library_use", "spot_hidden", "electrical_repair", "stealth"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [20, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 律师 Lawyer ──
  {
    id: "lawyer", label: "律师",
    description: "为客户提供法律服务的专业人士",
    minAttributes: { education: 70 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["法律", "说服", "心理学", "话术", "图书馆使用", "历史"],
    occupationSkills: ["law", "persuade", "psychology", "fast_talk", "library_use", "history"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [40, 80],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 护士 Nurse ──
  {
    id: "nurse", label: "护士",
    description: "协助医生进行医疗护理的专业人员",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "power"],
    skills: ["医学", "急救", "心理学", "精神分析", "科学(生物学)", "潜行"],
    occupationSkills: ["medicine", "first_aid", "psychology", "psychoanalysis", "science_biology", "stealth"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 警察 Police Officer ──
  {
    id: "police_officer", label: "警察",
    description: "维护公共安全与治安的执法人员",
    minAttributes: { strength: 60, constitution: 50 },
    priorityAttributes: ["strength", "constitution", "dexterity"],
    skills: ["侦查", "格斗(肉搏)", "射击(手枪)", "法律", "急救", "驾驶"],
    occupationSkills: ["spot_hidden", "fighting", "firearms_pistol", "law", "first_aid", "drive"],
    baseHp: 11, rulesets: ["coc7e"], creditRatingRange: [20, 50],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 海员 Sailor ──
  {
    id: "sailor", label: "海员",
    description: "在船舶上工作的海上从业人员",
    minAttributes: { strength: 50, constitution: 60 },
    priorityAttributes: ["constitution", "strength", "dexterity"],
    skills: ["驾驶", "导航", "机械维修", "游泳", "格斗(肉搏)", "攀爬"],
    occupationSkills: ["drive", "navigate", "mechanical_repair", "swim", "fighting", "climb"],
    baseHp: 11, rulesets: ["coc7e"], creditRatingRange: [10, 40],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 罪犯 Criminal ──
  {
    id: "criminal", label: "罪犯",
    description: "从事非法活动的黑道人员",
    minAttributes: { dexterity: 50 },
    priorityAttributes: ["dexterity", "appearance"],
    skills: ["潜行", "锁匠", "估价", "格斗(肉搏)", "射击(手枪)", "话术"],
    occupationSkills: ["stealth", "lockpick", "appraise", "fighting", "firearms_pistol", "fast_talk"],
    baseHp: 10, rulesets: ["coc7e"], creditRatingRange: [10, 40],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 大学生 College Student ──
  {
    id: "college_student", label: "大学生",
    description: "在高等学府攻读学位的青年学生",
    minAttributes: { education: 50 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["图书馆使用", "侦查", "计算机使用", "心理学", "话术", "潜行"],
    occupationSkills: ["library_use", "spot_hidden", "computer_use", "psychology", "fast_talk", "stealth"],
    baseHp: 8, rulesets: ["coc7e"], creditRatingRange: [5, 30],
    skillCount: 6, skillSourceAttribute: "education",
  },
  // ── 地质学家 Geologist ──
  {
    id: "geologist", label: "地质学家",
    description: "研究地球构成与地质演变的科学工作者",
    minAttributes: { education: 60 },
    priorityAttributes: ["education", "intelligence"],
    skills: ["科学(地质学)", "自然学", "导航", "侦查", "图书馆使用", "驾驶"],
    occupationSkills: ["science_geology", "natural_history", "navigate", "spot_hidden", "library_use", "drive"],
    baseHp: 9, rulesets: ["coc7e"], creditRatingRange: [30, 60],
    skillCount: 6, skillSourceAttribute: "education",
  },
];

// ============================================================
// 全部职业合并 + 扩展注册
// ============================================================

/** 基础职业列表（D&D + CoC） */
const BASE_ARCHETYPES: CharacterArchetype[] = [
  ...DND_ARCHETYPES,
  ...COC_ARCHETYPES,
];

/** 扩展职业（通过 registerExtra 注册） */
let EXTRA_ARCHETYPES: CharacterArchetype[] = [];

/** 完整职业列表 */
export const ALL_ARCHETYPES: CharacterArchetype[] = new Proxy(BASE_ARCHETYPES, {
  get(target, prop) {
    if (prop === Symbol.iterator) return function* () { yield* target; yield* EXTRA_ARCHETYPES; };
    if (prop === "length") return target.length + EXTRA_ARCHETYPES.length;
    if (prop === "includes") return (item: any) => target.includes(item) || EXTRA_ARCHETYPES.includes(item);
    if (prop === "find") return (fn: (a: CharacterArchetype) => boolean) => target.find(fn) ?? EXTRA_ARCHETYPES.find(fn);
    if (prop === "filter") return (fn: (a: CharacterArchetype) => boolean) => [...target.filter(fn), ...EXTRA_ARCHETYPES.filter(fn)];
    if (prop === "map") return (fn: (a: CharacterArchetype) => any) => [...target.map(fn), ...EXTRA_ARCHETYPES.map(fn)];
    if (typeof prop === "string" && !isNaN(Number(prop))) return [...target, ...EXTRA_ARCHETYPES][Number(prop)];
    return (target as any)[prop];
  }
});

// ============================================================
// 辅助函数
// ============================================================

/** 根据职业 ID 查找职业模板 */
export function getArchetype(id: string): CharacterArchetype | undefined {
  return ALL_ARCHETYPES.find(a => a.id === id);
}

/** 获取指定规则集的职业 */
export function getArchetypesByRuleset(ruleset: string): CharacterArchetype[] {
  return ALL_ARCHETYPES.filter(a => a.rulesets.includes(ruleset));
}

// ============================================================
// CharacterFactory — D&D 5e 角色工厂
// ============================================================

const BASE_ATTRIBUTES = {
  strength: 10, dexterity: 10, constitution: 10,
  intelligence: 10, wisdom: 10, charisma: 10,
};

export class CharacterFactory {
  /** 已注册的额外职业/子职 */
  private static extraArchetypes: CharacterArchetype[] = [];

  /**
   * 注册扩展职业（子职/进阶/自定），按需加载
   */
  static registerExtra(archetypes: CharacterArchetype[]): void {
    CharacterFactory.extraArchetypes.push(...archetypes);
    EXTRA_ARCHETYPES.push(...archetypes);
  }

  /**
   * 列出指定规则集的所有可用职业（含已注册的扩展）
   */
  static listArchetypes(ruleset: string): CharacterArchetype[] {
    return ALL_ARCHETYPES.filter(a => a.rulesets.includes(ruleset));
  }

  /**
   * 生成角色（主入口）
   */
  static generate(
    name: string,
    archetypeId: string,
    ruleset: string = "dnd5e",
  ): GeneratedCharacter {
    const archetype = getArchetype(archetypeId);
    if (!archetype) throw new Error(`未知职业: ${archetypeId}`);

    const attributes = { ...BASE_ATTRIBUTES };
    const skills = archetype.skills ?? [];
    const level = 1;

    const hpResult = CharacterFactory.calcHP(archetype, attributes);
    const ac = 10 + Math.floor(((attributes.dexterity ?? 10) - 10) / 2);

    return {
      name,
      archetype: archetypeId,
      attributes,
      hp: hpResult.hp,
      maxHp: hpResult.hp,
      ac,
      skills,
      ruleset,
      valid: true,
      warnings: [],
      classLevels: new Map([[archetypeId, level]]),
      totalLevel: level,
      baseAttackBonus: 0,
      activeFeatures: archetype.levelFeatures?.filter(f => f.level <= level) ?? [],
      selectedFeats: [],
    };
  }

  /** 计算 HP */
  private static calcHP(archetype: CharacterArchetype, attributes: Record<string, number>): { hp: number } {
    const baseHp = archetype.baseHp ?? 10;
    const conMod = Math.floor(((attributes.constitution ?? 10) - 10) / 2);
    return { hp: Math.max(baseHp + conMod, 1) };
  }

  /** 计算 AC */
  static computeAC(character: GeneratedCharacter): number {
    const dex = character.attributes?.dexterity ?? 10;
    if (character.ruleset === "coc7e") {
      return Math.floor(dex / 20) + 10;
    }
    return 10 + Math.floor((dex - 10) / 2);
  }

  /** 累积所有效果 */
  static accumulateEffects(_character: GeneratedCharacter): FeatureEffect[] {
    return [];
  }

  /** 选择专长 */
  static chooseFeat(character: GeneratedCharacter, featName: string): { success: boolean; message: string } {
    if (character.selectedFeats.includes(featName)) {
      return { success: false, message: `已拥有专长"${featName}"` };
    }
    character.selectedFeats.push(featName);
    return { success: true, message: `获得专长"${featName}"` };
  }

  /** 检查进阶条件 */
  static canTakePrestige(character: GeneratedCharacter, _prestigeId: string): { eligible: boolean; missing: string[] } {
    return { eligible: true, missing: [] };
  }

  /** 信用评级投骰 */
  static rollCreditRating(archetype: CharacterArchetype): number {
    if (!archetype.creditRatingRange) return 0;
    const [min, max] = archetype.creditRatingRange;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

// ============================================================
// 导出
// ============================================================

export default CharacterFactory;
