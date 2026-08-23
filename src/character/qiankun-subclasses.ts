import type { CharacterArchetype, LegendaryTemplate } from "./character-factory";

/**
 * 《网游之亡者征途》（乾坤）职业系统
 * D&D 5e 子职业映射
 */
export const QIANKUN_SUBCLASSES: CharacterArchetype[] = [
  // ========== 基础特色职业 ==========

  // 蛮荒猎手 - 野蛮人子职
  {
    id: "barbarian_wild_hunter",
    label: "野蛮人·蛮荒猎手",
    description: "在蛮荒秘境中成长的猎人，精通追踪与猎杀，在恶劣环境中如鱼得水",
    minAttributes: { strength: 16, constitution: 14, dexterity: 14 },
    priorityAttributes: ["strength", "constitution", "dexterity"],
    skills: ["survival", "perception", "athletics"],
    baseHp: 14,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "constitution"],
    baseClassId: "barbarian",
    levelFeatures: [
      { level: 3,  name: "蛮荒追踪", description: "在荒野中可精准追踪猎物痕迹，追踪检定时获得优势，且不会因移动速度而承受侦查惩罚", type: "passive", effects: { skillAdvantage: ["survival"] } },
      { level: 6,  name: "狂野之力", description: "狂暴状态下力量检定和力量豁免额外获得+2加值，且近战攻击可附加力量调整值双倍伤害", type: "passive", effects: { saveBonus: { strength: 2 }, damageBonus: 0, tags: ["rage_enhance"] } },
      { level: 10, name: "荒野主宰", description: "在自然环境（森林、山地、沙漠、沼泽、冻土）中获得全域优势，隐藏、先攻、察觉均获得加值", type: "supernatural", effects: { skillAdvantage: ["stealth", "perception"] } },
      { level: 14, name: "致命猎杀", description: "指定一个目标为猎杀对象，对其攻击检定获得+10加值且重击范围扩大至17-20，持续1分钟", type: "active", usesPerDay: "1次/长休", effects: { attackBonus: 10, tags: ["crit_range_up"] } },
      { level: 18, name: "洪荒之怒", description: "狂暴状态下免疫魅惑和恐惧，且每回合可额外进行一次近战攻击", type: "supernatural", effects: { immunities: ["charmed", "frightened"], extraAttack: 1 } }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "追踪专精", description: "追踪检定获得优势，可同时追踪两个不同目标", type: "passive" },
          { name: "猛扑", description: "冲锋攻击命中后附加击倒效果，DC等于力量DC", type: "passive" },
          { name: "兽血沸腾", description: "狂暴状态下每回合获得5点临时生命值", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "场景精通", description: "依当前环境（森林/火山/沼泽/冻土）获得对应属性伤害抗性", type: "passive" },
          { name: "战利品剥取", description: "击杀大型猎物后可提取稀有材料用于制作", type: "active" },
          { name: "蛮荒之握", description: "擒抱检定获得优势，可擒抱体型比你大一级的生物", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "完美猎手", description: "猎杀目标的重击范围扩大至15-20", type: "passive" },
          { name: "蛮荒之心", description: "自然环境中攻击检定与伤害掷骰获得优势", type: "supernatural" },
        ],
      },
    ],
  },

  // 轻骑兵 - 战士子职
  {
    id: "fighter_light_cavalier",
    label: "战士·轻骑兵",
    description: "机动性极强的骑兵，擅长冲锋与快速作战，在战场上如疾风般来去自如",
    minAttributes: { strength: 16, dexterity: 14, constitution: 14 },
    priorityAttributes: ["strength", "dexterity", "constitution"],
    skills: ["athletics", "animal handling", "tactics"],
    baseHp: 12,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "constitution"],
    baseClassId: "fighter",
    levelFeatures: [
      { level: 3,  name: "冲锋陷阵", description: "使用冲锋攻击时额外造成等同于移动距离的伤害，且目标必须通过力量豁免否则被击倒", type: "passive" },
      { level: 6,  name: "人马合一", description: "骑乘时攻击检定和敏捷豁免获得优势，坐骑移动速度+20尺", type: "passive" },
      { level: 10, name: "狂风突袭", description: "以迅捷动作发起疾风连击，本回合内可发动三次近战攻击", type: "active", usesPerDay: "2次/短休" },
      { level: 14, name: "纵横无敌", description: "冲锋不受困难地形影响，移动期间不会触发借机攻击", type: "passive" },
      { level: 18, name: "万军取首", description: "对生命值低于一半的单一目标发起致命冲锋，若击中则伤害翻倍且目标须通过体质豁免否则即死", type: "supernatural", usesPerDay: "1次/长休" },
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "长枪突刺", description: "使用长柄武器冲锋时额外造成1d8穿刺伤害", type: "passive" },
          { name: "轻装上阵", description: "未着中甲或重甲时移动速度+10尺，先攻获得优势", type: "passive" },
          { name: "疾风骑术", description: "以附赠动作使坐骑移动速度翻倍，持续1分钟", type: "active", usesPerDay: "2次/短休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "战马之友", description: "召来一匹忠诚的战马坐骑，生命值为你等级×6", type: "supernatural", usesPerDay: "1次/长休" },
          { name: "破阵先锋", description: "冲锋时击退路径上所有敌人5尺，被击退者须力量豁免否则倒地", type: "passive" },
          { name: "骑射精通", description: "骑乘时远程攻击无劣势，且可附赠动作进行一次远程攻击", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "铁蹄震击", description: "骑乘冲锋命中时目标须通过力量豁免否则被震慑1回合", type: "active", usesPerDay: "1次/短休" },
          { name: "纵横驰骋", description: "冲锋移动距离每20尺额外造成1d6点伤害，上不封顶", type: "passive" },
        ],
      },
    ],
  },

  // 黄昏剑士 - 战士子职
  {
    id: "fighter_dusk_blade",
    label: "战士·黄昏剑士",
    description: "精通剑技与魔法的双重战士，能够在战斗中灵活运用法术与剑术",
    minAttributes: { strength: 14, intelligence: 16, dexterity: 14 },
    priorityAttributes: ["strength", "intelligence", "dexterity"],
    skills: ["athletics", "arcana", "swordsmanship"],
    baseHp: 12,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "intelligence"],
    spellcaster: true,
    spellcastingType: "third",
    baseClassId: "fighter",
    levelFeatures: [
      { level: 3,  name: "暮刃咒剑", description: "以附赠动作在武器上注入黄昏魔力，攻击额外附带1d6黯蚀伤害，持续1分钟", type: "supernatural", usesPerDay: "3次/长休" },
      { level: 6,  name: "暮光斗篷", description: "以反应动作召唤暮光帷幕包裹自身，获得对黯蚀伤害的抗性，直到你的下回合开始", type: "supernatural", usesPerDay: "2次/短休" },
      { level: 10, name: "黄昏领域", description: "以动作释放暮光结界，20尺内敌人进行感知豁免，失败则陷入迟缓状态，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 14, name: "剑魔法环", description: "以动作释放一道魔法剑环，对周围15尺内所有敌人造成一次武器伤害+3d6黯蚀伤害", type: "active", usesPerDay: "1次/长休" },
      { level: 18, name: "永暮降临", description: "将黄昏领域增强为永暮结界，范围内的敌人每回合受黯蚀伤害且无法获得光源和火焰效果", type: "supernatural", usesPerDay: "1次/长休" },
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "暮刃共鸣", description: "暮刃咒剑的黯蚀伤害骰提升为1d8，且命中后目标感知豁免劣势", type: "passive" },
          { name: "咒剑延伸", description: "习得一个一环法术，可用智力作为施法属性每日免费施放2次", type: "passive" },
          { name: "暮光学徒", description: "获得60尺黑暗视觉，且在微光中隐匿检定获得优势", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "暗影步", description: "以附赠动作传送至30尺内一处微光或黑暗区域，不受借机攻击", type: "supernatural", usesPerDay: "2次/短休" },
          { name: "暮刃汲取", description: "暮刃咒剑造成伤害时，回复伤害值一半的生命值", type: "supernatural" },
          { name: "剑魔同体", description: "武器攻击命中后可用附赠动作释放一个已准备的一环法术", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "黄昏审判", description: "黄昏领域内敌人每回合额外受2d6光耀伤害且不能获得任何增益", type: "passive" },
          { name: "永夜共鸣", description: "获得黯蚀伤害抗性，且每当你受黯蚀伤害时回复1点已消耗的暮刃咒剑", type: "supernatural" },
        ],
      },
    ],
  },

  // 死灵工程师 - 工匠子职
  {
    id: "artificer_necro_engineer",
    label: "工匠·死灵工程师",
    description: "将死灵魔法与工程技术结合的创造者，能够制造与操控各种死灵机械",
    minAttributes: { intelligence: 16, wisdom: 14, dexterity: 14 },
    priorityAttributes: ["intelligence", "wisdom", "dexterity"],
    skills: ["arcana", "crafting", "tinkering"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["constitution", "intelligence"],
    spellcaster: true,
    spellcastingType: "half",
    baseClassId: "artificer",
    levelFeatures: [
      { level: 3,  name: "骨械组装", description: "可花费1小时将骨骼与机械零件组装成骨械仆从，同时只能控制一台骨械为你作战", type: "passive" },
      { level: 6,  name: "死灵引擎", description: "骨械仆从获得扩展火力模式，以附赠动作释放死灵能量冲击波，对15尺锥形内敌人造成2d8黯蚀伤害", type: "passive" },
      { level: 10, name: "血肉魔像", description: "以动作制造一台大型血肉魔像为你作战，魔像持续1小时或直到被摧毁", type: "active", usesPerDay: "1次/长休" },
      { level: 14, name: "机械死域", description: "展开机械死域光环，60尺内骨械和魔像攻击附带1d6黯蚀伤害且移动速度+20尺，持续10分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "魂炉过载", description: "以动作超载所有构装仆从的核心，60尺内构装体AC+2、伤害骰翻倍、获得30点临时生命值，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "骨械专精", description: "骨械仆从AC+2，最大生命值+10", type: "passive" },
          { name: "亡者亲和", description: "与构装体相邻时，黯蚀伤害抗性", type: "passive" },
          { name: "紧急制造", description: "1动作组装临时骨械，持续1分钟", type: "active", usesPerDay: "1次/短休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "超载指令", description: "构装体伤害翻倍但每回合损失5HP", type: "active" },
          { name: "骸骨献祭", description: "牺牲30尺内骨械抵消一次伤害", type: "active" },
          { name: "亡者强化", description: "所有构装仆从攻击附带1d6黯蚀伤害", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "灵魂锁链", description: "你与构装仆从共享生命值池", type: "supernatural" },
          { name: "军团统帅", description: "骨械操控上限+1，可同时操控两台", type: "passive" },
        ],
      },
    ],
  },

  // 灵魂法师 - 法师子职
  {
    id: "wizard_soul_mage",
    label: "法师·灵魂法师",
    description: "专注于灵魂本质的研究，能够感知、操控和抽取灵魂力量",
    minAttributes: { intelligence: 16, wisdom: 16, charisma: 12 },
    priorityAttributes: ["intelligence", "wisdom", "charisma"],
    skills: ["arcana", "religion", "insight"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3, name: "灵魂感知", description: "能够感知周围60尺范围内的灵魂存在，识破隐形与灵体生物", type: "passive" },
      { level: 6, name: "生命汲取", description: "对目标造成暗蚀伤害并回复等量生命值，对亡灵无效", type: "active", usesPerDay: "感知调整值次/长休" },
      { level: 10, name: "灵魂形态", description: "化为灵魂形态，可穿越实体障碍，对非魔法物理伤害获得抗性，持续1分钟", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 14, name: "灵魂链接", description: "与一个自愿生物建立灵魂链接，分担伤害并共享感知", type: "active", usesPerDay: "1次/长休" },
      { level: 18, name: "灵魂主宰", description: "可强行抽取目标灵魂，目标需进行感知豁免，失败则灵魂被暂时剥离", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "魂能感知", description: "被动探测60尺内生物情绪状态，对魅惑与恐惧豁免获得优势", type: "passive" },
          { name: "蚀魂之触", description: "触碰攻击使目标灵魂受创，智力豁免失败则陷入呆滞1轮", type: "active" },
          { name: "魂焰护盾", description: "以灵魂碎片环绕自身，受到攻击时对攻击者反弹心灵伤害", type: "passive" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "灵魂共鸣", description: "与友方灵魂共鸣，双方伤害加成共享但一人受伤另一人也同步受伤", type: "passive" },
          { name: "灵魂虹吸", description: "击败敌人时吸取其残魂，恢复一个已消耗的低环法术位", type: "passive" },
          { name: "魂力过载", description: "消耗自身生命值，使下一次灵魂法术的伤害翻倍", type: "active" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "魂域扩散", description: "展开灵魂领域，领域内敌人无法隐藏且每回合受到心灵伤害", type: "supernatural" },
          { name: "灵魂镜像", description: "创造自身灵魂镜像，敌人攻击你时需通过感知豁免否则攻击镜像", type: "active" },
          { name: "蚀骨之魂", description: "灵魂之力渗透骨髓，灵魂法术额外降低目标1点体质属性", type: "passive" },
        ]
      },
    ],
  },

  // 附魔师 - 法师子职
  {
    id: "wizard_enchanter",
    label: "法师·附魔师",
    description: "精通附魔魔法的大师，能够为武器装备注入强大的魔力",
    minAttributes: { intelligence: 16, charisma: 14, dexterity: 12 },
    priorityAttributes: ["intelligence", "charisma", "dexterity"],
    skills: ["arcana", "crafting", "persuasion"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "charisma"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3, name: "初级附魔", description: "为一把武器或一件护甲临时附加元素伤害或防护效果，持续1小时", type: "active", usesPerDay: "智力调整值次/长休" },
      { level: 6, name: "魔力灌注", description: "将自身法术能量注入武器，使其在命中时额外释放储存的法术效果", type: "active", usesPerDay: "1次/短休" },
      { level: 10, name: "多重附魔", description: "可同时为一套装备进行附魔，每件装备获得不同的附魔效果", type: "passive" },
      { level: 14, name: "传奇附魔", description: "制造出堪比传奇品质的附魔效果，属性加成大幅提升，持续24小时", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "永恒附魔", description: "为一件装备施加永久附魔，效果永不消退，同一时间只能维持一件永恒附魔", type: "supernatural" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "元素铭刻", description: "附魔时可附加元素伤害，武器攻击附带火焰、冰霜或雷电之一", type: "passive" },
          { name: "魔力共鸣", description: "穿戴附魔装备时产生共鸣，每件附魔装备提供+1法术豁免DC", type: "passive" },
          { name: "快速附魔", description: "附魔施法时间缩短为1回合，可在战斗中紧急为武器附魔", type: "active" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "反魔附魔", description: "为护甲附上反魔法涂层，穿戴者对抗法术时豁免获得优势", type: "passive" },
          { name: "链式附魔", description: "同时为两把武器附上相同效果，双持时获得额外攻击优势", type: "passive" },
          { name: "诅咒铭文", description: "附魔同时施加诅咒，武器命中时目标需通过豁免否则受到随机减益", type: "active" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "魂缚附魔", description: "将部分灵魂注入装备，装备获得自主意识且效果翻倍", type: "supernatural" },
          { name: "附魔大师", description: "所有附魔持续时间翻倍，每件装备可同时承受两种附魔效果", type: "passive" },
          { name: "破魔铭刻", description: "附魔武器对魔法护盾和元素生物造成额外伤害，无视法术抗性", type: "passive" },
        ]
      },
    ],
  },

  // 剑刃舞者 - 战士子职
  {
    id: "fighter_blade_dancer",
    label: "战士·剑刃舞者",
    description: "将剑术与舞蹈艺术结合的优雅战士，战斗如同一场精彩的表演",
    minAttributes: { strength: 14, dexterity: 16, charisma: 14 },
    priorityAttributes: ["dexterity", "strength", "charisma"],
    skills: ["performance", "athletics", "swordsmanship"],
    baseHp: 12,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "dexterity"],
    baseClassId: "fighter",
    levelFeatures: [
      { level: 3,  name: "剑舞步伐", description: "你每回合首次命中敌人后可立即向任意方向移动10尺而不触发借机攻击", type: "passive" },
      { level: 6,  name: "刀刃华尔兹", description: "以动作发起优雅的剑舞连击，对周围10尺内所有敌人各进行一次攻击", type: "active", usesPerDay: "3次/短休" },
      { level: 10, name: "流影闪避", description: "以反应动作进行一次敏捷豁免，成功则完全闪避一次攻击或范围效果", type: "active", usesPerDay: "1次/短休" },
      { level: 14, name: "死亡华尔兹", description: "进入全神贯注的剑舞状态，每回合可发动两次反应攻击，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "终幕绝剑", description: "以动作对单一目标发动致命一击，目标需通过DC20体质豁免否则受到10d10力场伤害，豁免成功则受到半额伤害", type: "supernatural", usesPerDay: "1次/长休" },
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "舞者灵巧", description: "未着甲时AC=10+敏捷调整值+魅力调整值，且敏捷豁免获得优势", type: "passive" },
          { name: "炫技步法", description: "剑舞步伐触发时可移动15尺而非10尺，且可选择任意方向", type: "passive" },
          { name: "魅惑之舞", description: "以动作进行一段魅惑剑舞，30尺内敌人须感知豁免否则被魅惑1分钟", type: "active", usesPerDay: "1次/短休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "反击之舞", description: "敌人对你近战攻击失手时，可立即发动一次近战攻击作为反应", type: "active" },
          { name: "醉心剑舞", description: "刀刃华尔兹命中时附带1d6心灵伤害，被击中者对你攻击劣势至其下回合", type: "passive" },
          { name: "柔韧身姿", description: "以附赠动作进入柔韧状态，一回合内敏捷豁免自动成功", type: "active", usesPerDay: "1次/短休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "绝命独舞", description: "死亡华尔兹状态下攻击额外附加魅力调整值伤害，且重击范围扩至18-20", type: "passive" },
          { name: "魅影分身", description: "以附赠动作创造两个镜像分身，敌人攻击时需掷骰判定真实目标", type: "supernatural", usesPerDay: "1次/短休" },
        ],
      },
    ],
  },

  // 傀儡师 - 法师子职
  {
    id: "wizard_puppeteer",
    label: "法师·傀儡师",
    description: "操控傀儡作战的法师，能够创造和操纵多个傀儡同时行动",
    minAttributes: { intelligence: 16, wisdom: 14, dexterity: 14 },
    priorityAttributes: ["intelligence", "wisdom", "dexterity"],
    skills: ["arcana", "crafting", "sleight of hand"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3, name: "傀儡操控", description: "操控一具人形傀儡进行战斗，傀儡使用你的智力调整值进行攻击", type: "active" },
      { level: 6, name: "傀儡强化", description: "为傀儡注入魔力，使其获得额外护甲等级和攻击力，持续10分钟", type: "active", usesPerDay: "智力调整值次/长休" },
      { level: 10, name: "双重操控", description: "可同时操控两具傀儡，且傀儡之间可进行战术配合获得夹击优势", type: "passive" },
      { level: 14, name: "傀儡军团", description: "短时间内制造并操控最多五具简易傀儡，形成小型军团压制敌人", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "灵魂傀儡", description: "将敌人灵魂封印入傀儡中，傀儡获得该敌人的全部战斗能力", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "精密操控", description: "傀儡攻击检定获得+2加值，且可执行更复杂的战术指令", type: "passive" },
          { name: "自爆傀儡", description: "可命令傀儡自爆对周围造成范围伤害，傀儡需1分钟重构", type: "active" },
          { name: "傀儡感知", description: "透过傀儡感官观察世界，傀儡获得黑暗视觉和察觉熟练", type: "passive" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "分心操控", description: "傀儡以附赠动作佯攻，为你的下一次攻击提供优势", type: "active" },
          { name: "傀儡装甲", description: "傀儡变形为护甲包裹自身，获得临时生命值和伤害减免", type: "active" },
          { name: "魔力连线", description: "与傀儡之间形成魔力连线，你的法术可通过傀儡作为施法起点", type: "passive" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "无限傀儡", description: "傀儡被摧毁后可瞬间重构新傀儡，无需消耗额外资源", type: "passive" },
          { name: "巨大傀儡", description: "合体多具傀儡制造巨型傀儡，体型增大伤害翻倍但操控时间减半", type: "active" },
          { name: "生命链接", description: "傀儡与你共享生命值，傀儡受伤可由你承受反之亦然", type: "passive" },
        ]
      },
    ],
  },

  // ========== 法师子类职业 ==========

  // 鬼杖法师 - 法师子职
  {
    id: "wizard_ghost_staff",
    label: "法师·鬼杖法师",
    description: "拥有诅咒魔杖的死灵法师，改造方案被黑暗教会照搬用于强化人类",
    minAttributes: { intelligence: 16, wisdom: 14, charisma: 12 },
    priorityAttributes: ["intelligence", "wisdom", "charisma"],
    skills: ["arcana", "religion", "intimidation"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3, name: "诅咒之杖", description: "法杖攻击附加诅咒效果，目标下一次攻击检定具有劣势", type: "active", usesPerDay: "感知调整值次/长休" },
      { level: 6, name: "鬼魂附杖", description: "召唤幽灵附于法杖之上，法杖获得额外暗蚀伤害，命中时可恐惧目标", type: "active", usesPerDay: "1次/短休" },
      { level: 10, name: "杖灵觉醒", description: "法杖产生自主意识，可独立施展一个戏法，并警告持有者周围的危险", type: "passive" },
      { level: 14, name: "死亡波纹", description: "以法杖为中心释放死亡能量波，对周围所有敌人造成暗蚀伤害并施加诅咒", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 18, name: "万鬼朝宗", description: "召唤5只幽灵附着于法杖形成鬼魂风暴，每只幽灵每回合可攻击一次造成2d6黯蚀伤害，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "噬魂杖击", description: "法杖近战攻击命中时吸取1d6+智力调整值点生命值回复自身", type: "passive" },
          { name: "鬼火环绕", description: "法杖周围萦绕三团鬼火，可发射鬼火对敌人造成暗蚀伤害", type: "active" },
          { name: "幽灵斥候", description: "从法杖中释放幽灵侦察前方区域，持续10分钟", type: "active" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "多重诅咒", description: "诅咒效果可叠加至两层，目标检定劣势覆盖多种类型", type: "passive" },
          { name: "亡魂风暴", description: "消耗击败敌人的灵魂碎片，在法杖周围形成亡魂风暴造成范围伤害", type: "active" },
          { name: "鬼杖化身", description: "法杖化为人形分身，独立施法并承受伤害，分身被毁不影响本体", type: "supernatural" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "诅咒连锁", description: "诅咒目标被击败时诅咒自动跳转至最近的下一个敌人", type: "passive" },
          { name: "万魂归一", description: "将击败的所有灵魂融入法杖，永久提升法杖攻击力和法术强度", type: "passive" },
          { name: "鬼域主宰", description: "在鬼魂领域内法杖施法无需消耗法术位，每回合限一次", type: "supernatural" },
        ]
      },
    ],
  },

  // 魔导师 - 法师子职
  {
    id: "wizard_magister",
    label: "法师·魔导师",
    description: "走出自己道路的正统高阶法师，掌握死灵魔法的精粹",
    minAttributes: { intelligence: 18, wisdom: 14, charisma: 14 },
    priorityAttributes: ["intelligence", "wisdom", "charisma"],
    skills: ["arcana", "religion", "history"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3, name: "死灵精粹", description: "死灵系法术的豁免DC提高2点，且死灵法术造成额外伤害", type: "passive" },
      { level: 6, name: "法术增幅", description: "消耗额外法术位提高法术效果，法术伤害骰获得优势", type: "active", usesPerDay: "智力调整值次/长休" },
      { level: 10, name: "魔导领域", description: "在自身周围展开魔力领域，领域内所有友方法术效果增强，敌人法术效果减弱", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 14, name: "禁术精通", description: "可施展一道被遗忘的禁忌法术，效果极其强大但需付出生命值代价", type: "active", usesPerDay: "1次/长休" },
      { level: 18, name: "大魔导师", description: "获得超凡魔力，所有法术射程加倍，且每天可免费施展一个5环及以下法术", type: "passive" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "法术穿透", description: "法术忽略目标5点法术抗性，对抗法术豁免时目标具有劣势", type: "passive" },
          { name: "法术储备", description: "可额外准备两个法术，每日可替换准备法术的种类", type: "passive" },
          { name: "魔力回流", description: "施展法术时有概率回收已消耗的法术位，概率随等级提升", type: "passive" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "死灵专精", description: "死灵系法术不再消耗材料成分，且施法时间缩短一档", type: "passive" },
          { name: "双重专注", description: "可同时维持两个需专注的法术，但专注豁免具有劣势", type: "passive" },
          { name: "魔力爆发", description: "消耗所有剩余法术位进行毁灭性爆发，伤害等于消耗法术位等级和×d6", type: "active" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "不朽巫妖", description: "死亡时可自动以灵魂形态复活一次，1小时内免疫死亡效果", type: "supernatural" },
          { name: "魔导真理", description: "领悟魔法终极真理，每天可免费施展一个8环及以下任意法术", type: "passive" },
          { name: "死灵之主", description: "永久控制一个不死生物作为仆从，仆从获得你一半的属性加成", type: "supernatural" },
        ]
      },
    ],
  },

  // 召唤魔导师 - 法师子职
  {
    id: "wizard_summoner",
    label: "法师·召唤魔导师",
    description: "精擅召唤魔法的召唤魔导师，以卡牌式契约召唤异界生物",
    minAttributes: { intelligence: 16, charisma: 14, wisdom: 12 },
    priorityAttributes: ["intelligence", "charisma", "wisdom"],
    skills: ["arcana", "nature", "animal handling"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3, name: "召唤契约", description: "与一个异界生物签订临时契约，召唤其为你作战，持续1小时", type: "active", usesPerDay: "魅力调整值次/长休" },
      { level: 6, name: "强化召唤", description: "召唤生物获得额外生命值和攻击力，且持续时间延长至8小时", type: "passive" },
      { level: 10, name: "契约召唤", description: "从契约卡牌中召唤强大异界生物为你而战，持续至战斗结束", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 14, name: "军团召唤", description: "同时召唤多个低阶异界生物组成小型军团，最多召唤5只", type: "active", usesPerDay: "1次/短休" },
      { level: 18, name: "异界之门", description: "开启通往异界的永久传送门，可召唤传奇级异界生物跨越门扉为你而战", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "元素亲和", description: "召唤元素生物持续时间翻倍，可同时召唤两个低阶元素", type: "passive" },
          { name: "契约精通", description: "召唤生物获得你的熟练加值，忠诚度提升不会反叛", type: "passive" },
          { name: "召唤印记", description: "可提前布置召唤法阵，需要时瞬间触发无需施法时间", type: "active" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "共享视野", description: "与召唤生物共享视觉和听觉，可远程指挥完成精细任务", type: "passive" },
          { name: "魔力喂养", description: "消耗法术位为召唤生物临时提升等级和属性，每环法术提升1级", type: "active" },
          { name: "召唤护盾", description: "召唤生物被击败时化为护盾保护你，吸收等同于其生命值的伤害", type: "passive" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "跨界召唤", description: "召唤来自不同位面的混合生物，同时拥有两种异界生物特性", type: "active" },
          { name: "永恒契约", description: "与一个召唤生物签订永久契约成为永久同伴，不消耗法术位", type: "supernatural" },
          { name: "万兽奔腾", description: "一次性召唤5只野兽践踏战场，对直线60尺内所有敌人造成4d10钝击伤害（敏捷豁免减半）", type: "active" },
        ]
      },
    ],
  },

  // 空间法师 - 法师子职
  {
    id: "wizard_space_mage",
    label: "法师·空间法师",
    description: "精通空间魔法的法师，负责辅助和空间操控",
    minAttributes: { intelligence: 18, wisdom: 14, dexterity: 12 },
    priorityAttributes: ["intelligence", "wisdom", "dexterity"],
    skills: ["arcana", "knowledge", "tactics"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3, name: "短程传送", description: "以附赠动作传送到30尺内可见的未占据空间", type: "active", usesPerDay: "智力调整值次/长休" },
      { level: 6, name: "空间裂隙", description: "在两点之间撕开空间裂隙，可通过裂隙瞬间移动或让敌人落入裂隙受到力场伤害", type: "active", usesPerDay: "1次/短休" },
      { level: 10, name: "次元口袋", description: "创造一个小型次元空间储存物品，容量随等级提升而增大", type: "passive" },
      { level: 14, name: "空间折叠", description: "扭曲一片区域的空间，使其距离感混乱，敌人移动消耗加倍且攻击具有劣势", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 18, name: "虚空放逐", description: "将目标放逐至虚空维度，目标需进行魅力豁免，失败则被放逐1分钟", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "空间感知", description: "被动感知60尺内所有空间异常和传送波动，不会被突袭", type: "passive" },
          { name: "微型虫洞", description: "创造微型虫洞传递小型物品或窃取敌人身上的小物件", type: "active" },
          { name: "空间护盾", description: "在身边创造空间褶皱，远程攻击穿过时命中概率减半", type: "passive" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "群体传送", description: "可携带至多四名自愿生物一起传送，传送距离不减", type: "active" },
          { name: "空间锚定", description: "标记一个位置作为锚点，可随时传送回锚点每天限3次", type: "active" },
          { name: "裂隙陷阱", description: "设下空间裂隙陷阱，踏入的第一个敌人被吸入并受到力场伤害", type: "active" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "维度切割", description: "以空间裂隙斩断目标与现实的联系，目标部分身体暂时消失受到8d10力场伤害", type: "supernatural" },
          { name: "空间镜像", description: "创造多个空间镜像分身，可在任意分身之间瞬间切换位置", type: "active" },
          { name: "虚空领域", description: "将战场拖入虚空夹层，所有生物无法传送离开而你获得全域传送自由", type: "supernatural" },
        ]
      },
    ],
  },

  // 气象法师 - 法师子职
  {
    id: "wizard_weather_mage",
    label: "法师·气象法师",
    description: "能够精确预报并操控天气，拥有强大的元素控制能力",
    minAttributes: { intelligence: 16, wisdom: 14, charisma: 12 },
    priorityAttributes: ["intelligence", "wisdom", "charisma"],
    skills: ["arcana", "survival", "nature"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3, name: "天气预报", description: "精准预知未来24小时天气变化，战斗中可呼唤小雨或微风辅助作战", type: "passive" },
      { level: 6, name: "元素操控", description: "操控火、冰、雷、风四种元素之一攻击敌人，每回合可用附赠动作切换元素类型", type: "active" },
      { level: 10, name: "风暴召唤", description: "召唤一片雷暴云覆盖战场，每回合随机对敌人造成雷电或强风伤害", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 14, name: "天灾降临", description: "引发小型自然灾害（暴风雪、陨石雨、飓风任选其一），覆盖大片区域", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "气候主宰", description: "完全掌控战场天气，可随意切换各种气候效果，每回合可改变一次", type: "supernatural" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "顺风而行", description: "在风中移动速度+20尺，跳跃距离翻倍且不受坠落伤害", type: "passive" },
          { name: "微气候盾", description: "在自身周围维持微气候，无视极端天气影响并获得元素抗力", type: "passive" },
          { name: "雷霆之眼", description: "雷暴天气下法术伤害骰取最大值，雷电法术获得额外射程", type: "passive" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "冰火两重", description: "同时操控两种对立元素，每次攻击造成冰与火双重元素伤害", type: "passive" },
          { name: "台风眼", description: "在自身周围创造小型台风，推开接近的敌人并阻挡远程投射物", type: "active" },
          { name: "酸雨腐蚀", description: "召唤的雨水变为酸雨，对区域内敌人每回合造成强酸伤害并腐蚀护甲", type: "active" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "四季轮转", description: "切换四种季节增益：春暖（治疗加成）、夏炎（火焰加成）、秋收（收割效果）、冬霜（冰霜护盾）", type: "active" },
          { name: "灭世风暴", description: "召唤毁灭性超级风暴，同时触发雷电、飓风、冰雹和洪水", type: "supernatural" },
          { name: "气候武装", description: "将气候元素化为武器形态，获得冰剑、雷枪或风弓进行近战格斗", type: "active" },
        ]
      },
    ],
  },

  // 灵语法师 - 法师子职
  {
    id: "wizard_spirit_chant",
    label: "法师·灵语法师",
    description: "吟唱施法速度极快的法师",
    minAttributes: { intelligence: 16, charisma: 14, dexterity: 12 },
    priorityAttributes: ["intelligence", "charisma", "dexterity"],
    skills: ["arcana", "performance", "persuasion"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "charisma"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3, name: "快速吟唱", description: "吟唱施法时间减少一档，动作施法降为附赠动作，附赠动作降为反应动作", type: "passive" },
      { level: 6, name: "双重施法", description: "每回合可使用附赠动作额外施展一个施法时间为1动作的法术", type: "active", usesPerDay: "魅力调整值次/长休" },
      { level: 10, name: "无声施法", description: "不需语言成分即可施法，且施法时不会引发借机攻击", type: "passive" },
      { level: 14, name: "灵言增幅", description: "吟唱类法术的效果翻倍，伤害骰数量加倍，持续时间加倍", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 18, name: "言出法随", description: "说出的语言直接化为法术效果，一回合内可连续施展三个法术", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "回音施法", description: "施展的法术在下一回合自动重复一次（伤害减半），不消耗法术位", type: "passive" },
          { name: "魔音贯耳", description: "吟唱声附带心灵伤害，周围敌人每回合受到1d4心灵伤害且专注检定具有劣势", type: "passive" },
          { name: "群体咒文", description: "单目标法术在快速吟唱时可改为影响两个相邻目标", type: "passive" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "咒文编织", description: "可同时吟唱两个法术的咒文，在同一回合完成两次施法", type: "active" },
          { name: "禁言领域", description: "展开沉默光环内所有生物无法发声，但你的心灵施法不受影响", type: "supernatural" },
          { name: "咒文共鸣", description: "吟唱时与魔力产生共鸣，所有法术的豁免DC在吟唱期间+2", type: "passive" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "真言术", description: "说出词语化为绝对律令（死亡、臣服、静止三选一），目标须通过豁免", type: "supernatural" },
          { name: "永恒吟唱", description: "一个吟唱法术的效果永久持续直到你主动结束", type: "supernatural" },
          { name: "言灵化身", description: "自身化为纯粹的言灵能量体，对非魔法物理伤害获得抗性，所有法术施法时间缩短为附赠动作（每回合限一次）", type: "supernatural" },
        ]
      },
    ],
  },

  // 阴天歌者 - 法师子职
  {
    id: "wizard_overcast_singer",
    label: "法师·阴天歌者",
    description: "能够催生高浓度死气的死灵法师，死气浓度极高，能够创造特殊的死灵乐园",
    minAttributes: { intelligence: 16, wisdom: 14, charisma: 14 },
    priorityAttributes: ["intelligence", "wisdom", "charisma"],
    skills: ["arcana", "religion", "performance"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3, name: "死气之歌", description: "唱出哀歌使周围产生死气迷雾，阻碍敌人视线并赋予亡灵生物优势", type: "active", usesPerDay: "魅力调整值次/长休" },
      { level: 6, name: "阴云笼罩", description: "召唤死气阴云笼罩一片区域，在阴云下的亡灵每回合恢复生命值", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 10, name: "死灵乐园", description: "将战场转化为死灵乐园，在乐园内所有死灵法术效果提升，亡灵获得强化", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 14, name: "死气领域", description: "以自身为中心展开高浓度死气领域，敌人进入后每回合受到暗蚀伤害并积累疲劳", type: "active" },
      { level: 18, name: "永夜之歌", description: "唱出现世与冥界的交界之歌，将整片区域暂时转化为死者国度，召唤冥界大军", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "死气汲取", description: "在死气范围内每回合恢复生命值，亡灵生物对你态度改善", type: "passive" },
          { name: "暗影亲和", description: "在黑暗和阴影中获得隐匿加值和黑暗视觉，黑暗中对敌人攻击具有优势", type: "passive" },
          { name: "亡者低语", description: "可与死者残留意念沟通，获取其生前最后所见的信息", type: "supernatural" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "死气爆发", description: "引爆死气区域，对区域内所有生物造成暗蚀伤害并施加恐慌", type: "active" },
          { name: "亡魂侍者", description: "召唤两个亡魂侍者环绕自身，自动拦截指向你的单目标攻击", type: "supernatural" },
          { name: "冥界通道", description: "打开临时冥界通道，将指定区域内濒死生物直接送往冥界", type: "supernatural" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "亡者大军", description: "死灵乐园内击败的敌人自动转化为亡灵为你作战，持续到战斗结束", type: "passive" },
          { name: "冥月当空", description: "在空中召唤一轮冥月，冥月照耀下所有盟友死灵生物攻击检定获得+2加值、伤害骰+1d6黯蚀，持续1分钟", type: "supernatural" },
          { name: "死之绝唱", description: "消耗50点生命值释放死亡冲击波，60尺内敌人需通过DC20体质豁免否则受到10d10黯蚀伤害，豁免成功减半", type: "supernatural" },
        ]
      },
    ],
  },

  // 龙炎霸者 - 野蛮人子职（原著为近战狂战士，龙炎吐息为其招牌能力）
  {
    id: "barbarian_dragon_fire",
    label: "野蛮人·龙炎霸者",
    description: "三转职业，再生型龙炎战士，以双头剑近战配合龙息著称",
    minAttributes: { strength: 16, constitution: 18, charisma: 14 },
    priorityAttributes: ["strength", "constitution", "charisma"],
    skills: ["athletics", "intimidation", "survival"],
    baseHp: 14,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "constitution"],
    baseClassId: "barbarian",
    levelFeatures: [
      { level: 3, name: "龙炎吐息", description: "喷吐龙炎对前方锥形区域造成火焰伤害，伤害随等级提升", type: "active", usesPerDay: "体质调整值次/长休" },
      { level: 6, name: "烈焰再生", description: "每回合开始时恢复3+体质调整值点生命值，获得火焰伤害抗性", type: "passive" },
      { level: 10, name: "龙鳞护体", description: "皮肤覆盖龙鳞，获得额外护甲等级，且每回合可吸收一定量的伤害", type: "passive" },
      { level: 14, name: "龙化", description: "部分化为龙形，获得飞行能力、龙爪攻击和恐惧光环，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "龙神降临", description: "以动作转化为远古龙神形态1分钟，获得50点临时生命值，龙息对60尺锥形造成12d10火焰伤害（敏捷豁免减半），获得60尺飞行速度", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "龙炎护体", description: "身体被龙炎环绕，近战攻击你的敌人受到火焰伤害并获得火焰抗性提升", type: "passive" },
          { name: "炎龙之翼", description: "生长出火焰龙翼获得飞行能力，飞行时留下火焰尾迹灼烧下方敌人", type: "supernatural" },
          { name: "烈焰打击", description: "火焰法术有概率点燃目标，使目标每回合持续受到燃烧伤害", type: "passive" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "再生加速", description: "每回合恢复的生命值翻倍，可附赠动作消耗生命骰额外恢复", type: "passive" },
          { name: "龙威压迫", description: "释放龙族威压，周围敌人需通过感知豁免否则陷入恐慌", type: "active" },
          { name: "浴火重生", description: "受到致命伤害时可消耗所有未使用生命骰以半血状态复活", type: "supernatural" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "永恒龙炎", description: "火焰无视火焰抗性和免疫，对火免疫生物造成半额伤害", type: "passive" },
          { name: "龙神之躯", description: "永久获得龙族体质，生命值上限+30，对毒素和疾病豁免获得优势，不再衰老", type: "supernatural" },
          { name: "焚天灭地", description: "消耗所有法术位释放终极龙炎吐息覆盖超大面积，伤害无法被减免", type: "supernatural" },
        ]
      },
    ],
  },

  // 死灵炼金术士 - 工匠子职
  {
    id: "artificer_necro_alchemist",
    label: "工匠·死灵炼金术士",
    description: "精通死灵炼金的专家，能制作青碧之梦等强力药剂，将灵魂宝石与鬼狼磷粉混合制成迷幻药",
    minAttributes: { intelligence: 16, dexterity: 14, wisdom: 12 },
    priorityAttributes: ["intelligence", "dexterity", "wisdom"],
    skills: ["arcana", "medicine", "crafting"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["constitution", "intelligence"],
    spellcaster: true,
    spellcastingType: "half",
    baseClassId: "artificer",
    levelFeatures: [
      { level: 3,  name: "尸体炼成", description: "可从尸体中提炼特殊炼金材料，制作炼金药剂时品质自动+1阶", type: "passive" },
      { level: 6,  name: "青碧之梦", description: "投掷迷幻毒气瓶，15尺半径内敌人需通过DC15体质豁免否则陷入沉睡1分钟", type: "active", usesPerDay: "2次/长休" },
      { level: 10, name: "灵魂精华", description: "击杀敌人时可提取灵魂精华，用于强化下一次炼金药剂，使效果翻倍", type: "passive" },
      { level: 14, name: "亡灵大釜", description: "召唤炼金大釜将尸体投入炼制强力亡灵生物，亡灵生物持续作战1小时", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "贤者之石", description: "以动作消耗灵魂精华制造贤者之石，60尺内所有盟友恢复4d10+智力调整值生命值并移除一项负面状态，敌人受6d10黯蚀伤害（感知豁免减半）", type: "supernatural", usesPerDay: "1次/长休" },
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "猛毒炼成", description: "炼金药剂命中后附加中毒状态，DC13", type: "passive" },
          { name: "尸体回收", description: "每具尸体额外提炼一份炼金材料", type: "passive" },
          { name: "药剂射程", description: "投掷类药剂射程翻倍至30尺", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "灵魂炸弹", description: "消耗灵魂精华制造爆炸，15尺5d6黯蚀", type: "active", usesPerDay: "3次/长休" },
          { name: "腐尸抗体", description: "获得毒素免疫和黯蚀伤害抗性", type: "passive" },
          { name: "战场炼金", description: "附赠动作在战斗中完成一次炼金调配", type: "active" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "大釜强化", description: "亡灵大釜召唤物属性提升30%", type: "passive" },
          { name: "药剂批量", description: "每次炼金操作同时产出2份药剂", type: "passive" },
        ],
      },
    ],
  },

  // ========== 战士子类职业 ==========

  // 猎魔人 - 战士子职
  {
    id: "fighter_demon_hunter",
    label: "战士·猎魔人",
    description: "专门猎杀超自然生物的战士，精通道具使用与怪物习性",
    minAttributes: { strength: 16, wisdom: 14, dexterity: 14 },
    priorityAttributes: ["strength", "dexterity", "wisdom"],
    skills: ["survival", "religion", "investigation"],
    baseHp: 12,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "wisdom"],
    baseClassId: "fighter",
    levelFeatures: [
      { level: 3,  name: "恶魔学识", description: "你熟知超自然生物的弱点，对异怪、恶魔和不死生物的攻击检定和伤害掷骰获得优势", type: "passive" },
      { level: 6,  name: "圣化武器", description: "以附赠动作在武器上附加神圣之力，对邪魔和不死生物额外造成2d6光耀伤害，持续1分钟", type: "supernatural", usesPerDay: "3次/长休" },
      { level: 10, name: "邪恶侦测", description: "你能够感知60尺内的邪魔、亡灵和异怪的存在，如同恒定侦测善恶法阵", type: "supernatural" },
      { level: 14, name: "恶魔克星", description: "对邪魔和不死生物造成重击时立刻驱散目标，目标须通过感知豁免否则被放逐回原生位面", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "圣裁之印", description: "以动作对单个邪魔或不死生物烙下圣裁之印，目标每回合受4d6光耀伤害且无法隐形，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "弱点洞察", description: "攻击邪魔、亡灵和异怪时重击范围扩大至19-20", type: "passive" },
          { name: "猎魔印记", description: "标记一个敌为猎杀目标，标记期间攻击+2伤害且目标无法隐形", type: "supernatural", usesPerDay: "3次/长休" },
          { name: "净罪之焰", description: "攻击邪魔和不死生物时附加1d4火焰伤害，重击时改为2d6", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "圣油涂抹", description: "每日准备3瓶圣油，涂抹武器后1小时内额外造成1d6光耀伤害", type: "active", usesPerDay: "3次/长休" },
          { name: "驱魔结界", description: "以动作展开10尺驱魔光环，范围内邪魔不死生物攻击和豁免劣势", type: "supernatural", usesPerDay: "1次/短休" },
          { name: "猎魔之盾", description: "对邪魔和不死生物的攻击获得全伤害抗性，持续至你下回合开始", type: "supernatural", usesPerDay: "2次/短休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "猎魔专家", description: "恶魔克星使用次数+1，且目标豁免检定具有劣势", type: "passive" },
          { name: "圣痕烙印", description: "圣裁之印持续期间你对该目标攻击检定获得优势且每回合额外2d6伤害", type: "passive" },
        ],
      },
    ],
  },

  // 铁蹄骑士 - 战士子职（注：原著中"铁蹄骑士"为骑士团名，成员职业为审判骑士。
  // 此处作为审判骑士的重装冲锋特化变体保留，非原著独立职业。）
  {
    id: "fighter_iron_hoof",
    label: "战士·铁蹄骑士（审判骑士·重装特化）",
    description: "教廷铁蹄骑士团的重装冲锋特化分支，以骑阵与钢铁防线著称",
    minAttributes: { strength: 16, dexterity: 14, constitution: 16 },
    priorityAttributes: ["strength", "constitution", "dexterity"],
    skills: ["athletics", "tactics", "animal handling"],
    baseHp: 12,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "constitution"],
    baseClassId: "fighter",
    levelFeatures: [
      { level: 3,  name: "铁壁装甲", description: "穿着重甲时获得+1额外AC，且受到的非魔法钝击、穿刺和挥砍伤害减少3点", type: "passive" },
      { level: 6,  name: "不可阻挡", description: "冲锋时可穿过敌人所在空间，被穿过的敌人须通过力量豁免否则被击退10尺并倒地", type: "passive" },
      { level: 10, name: "移动要塞", description: "你和你坐骑周围10尺内的盟友获得+2AC，且对恐惧豁免获得优势", type: "supernatural" },
      { level: 14, name: "铁蹄践踏", description: "以动作指挥坐骑发起践踏冲锋，直线60尺内所有敌人受6d10钝击伤害且须通过敏捷豁免否则倒地（DC=8+力量调整值+熟练加值）", type: "active", usesPerDay: "1次/短休" },
      { level: 18, name: "不朽防线", description: "以动作化为战场上的铜墙铁壁，自身和30尺内盟友获得临时生命值等于你的战士等级×5，持续10分钟", type: "supernatural", usesPerDay: "1次/长休" },
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "重装磐石", description: "穿着重甲时AC额外+1，被推撞或击倒时可用力量取代敏捷进行对抗", type: "passive" },
          { name: "护卫骑术", description: "冲锋经过的路径变为困难地形直至你下回合开始，盟友不受影响", type: "passive" },
          { name: "坚守阵地", description: "以附赠动作进入防御姿态，本回合受到所有伤害减半", type: "active", usesPerDay: "2次/短休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "坚不可摧", description: "受到暴击时可用反应将其转为普通命中", type: "active", usesPerDay: "1次/短休" },
          { name: "盾墙铁壁", description: "装备盾牌时相邻盟友获得与你相同的盾牌AC加成", type: "passive" },
          { name: "不屈意志", description: "生命值降至0时改为降至1且获得临时生命值=你的等级×3", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "钢铁洪流", description: "铁蹄践踏范围扩至120尺直线，且造成额外2d8伤害", type: "passive" },
          { name: "不灭防线", description: "不朽防线提供的临时生命值变为战士等级×8且期间自身免疫暴击", type: "passive" },
        ],
      },
    ],
  },

  // 神罚骑士 - 圣武士子职
  {
    id: "paladin_divine_punisher",
    label: "圣骑士·神罚骑士",
    description: "教廷的精锐圣武士，铁蹄骑士团团长圣琼尼的职业，以光之制裁与圣链守护著称",
    minAttributes: { strength: 16, charisma: 16, wisdom: 14 },
    priorityAttributes: ["strength", "charisma", "wisdom"],
    skills: ["religion", "athletics", "intimidation"],
    baseHp: 12,
    rulesets: ["dnd5e"],
    saveProficiencies: ["wisdom", "charisma"],
    spellcaster: true,
    spellcastingType: "half",
    baseClassId: "paladin",
    levelFeatures: [
      { level: 3,  name: "神圣制裁", description: "至圣斩额外造成1d8光耀伤害，对邪魔和不死生物伤害骰提升为d12", type: "supernatural" },
      { level: 6,  name: "惩罚光环", description: "以附赠动作展开惩罚光环，10尺内敌人攻击你的盟友时受到等同于你魅力调整值的光耀伤害", type: "supernatural", usesPerDay: "3次/长休" },
      { level: 10, name: "天谴之锤", description: "以动作召唤神圣战锤轰击目标，造成6d10光耀伤害，目标为邪恶阵营时伤害直接取最大值", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 14, name: "净化烈焰", description: "以自身为中心爆发神圣烈焰，30尺内所有敌人受8d6光耀伤害，范围内盟友恢复等量生命值", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "神罚化身", description: "化为神罚天使形态1分钟，获得60尺飞行速度、对非魔法物理伤害获得抗性，每次攻击附带额外4d8光耀伤害", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "神圣裁决者", description: "神圣制裁的光耀伤害提升至2d8，对邪恶阵营目标提升至4d8", type: "passive" },
          { name: "神恩共鸣", description: "魅力调整值+1且魅力上限提升至22，至圣斩可多消耗1环法术位增伤", type: "passive" },
          { name: "净罪圣言", description: "以动作宣告净罪祷文，30尺内盟友移除一项负面状态", type: "supernatural", usesPerDay: "2次/长休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "惩戒光环强化", description: "惩罚光环触发时恢复盟友等同于伤害值的生命值", type: "passive" },
          { name: "信仰壁垒", description: "对邪恶生物的攻击获得全伤害抗性且免疫恐惧，持续至下回合开始", type: "supernatural", usesPerDay: "2次/短休" },
          { name: "神怒之拳", description: "以附赠动作蓄力神怒，下一至圣斩额外造成2d8光耀伤害", type: "active", usesPerDay: "3次/长休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "神威如狱", description: "天谴之锤伤害骰提升为d12，对邪恶目标伤害直接取最大值", type: "passive" },
          { name: "炽天使之翼", description: "神罚化身形态下额外获得30尺飞行速度且周围15尺火焰光环灼烧敌人", type: "passive" },
        ],
      },
    ],
  },

  // 审判骑士 - 战士子职
  {
    id: "fighter_judgment_knight",
    label: "战士·审判骑士",
    description: "铁蹄骑士团的职业名称，圣骑士偏防守治疗，审判骑士偏进攻",
    minAttributes: { strength: 16, dexterity: 14, wisdom: 14 },
    priorityAttributes: ["strength", "wisdom", "dexterity"],
    skills: ["religion", "athletics", "intimidation"],
    baseHp: 12,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "constitution"],
    baseClassId: "fighter",
    levelFeatures: [
      { level: 3,  name: "审判之眼", description: "你的攻击命中时有概率揭示目标的阵营弱点和抗性，对邪恶阵营目标额外造成1d6光耀伤害", type: "passive" },
      { level: 6,  name: "神圣裁决", description: "以附赠动作宣告对一名敌人的审判，你对目标的攻击获得优势且目标无法对你隐藏，持续1分钟", type: "supernatural", usesPerDay: "3次/长休" },
      { level: 10, name: "净化圣焰", description: "以动作召唤圣焰焚烧周围15尺内的敌人，造成4d6光耀伤害，邪恶生物豁免劣势", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 14, name: "律法之缚", description: "以动作释放神圣律令锁链，目标须通过感知豁免否则被束缚并每回合受光耀伤害，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "天罚降临", description: "以动作降下天界审判之光，对60尺内单一目标造成10d10光耀伤害，邪恶生物直接取最高伤害值", type: "supernatural", usesPerDay: "1次/长休" },
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "审判印记", description: "审判之眼揭示弱点的概率翻倍，且额外光耀伤害提升为1d8", type: "passive" },
          { name: "裁决冲锋", description: "对神圣裁决标记的目标冲锋时，伤害骰取最大值", type: "passive" },
          { name: "信仰之证", description: "每日一次，在攻击掷骰失败后可将其重掷并取较高值", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "罪孽锁链", description: "净化圣焰命中时额外附加束缚效果，目标力量豁免失败则被束缚1回合", type: "passive" },
          { name: "裁决之盾", description: "对邪恶阵营生物攻击获得全伤害抗性，持续至你下回合开始", type: "supernatural", usesPerDay: "2次/短休" },
          { name: "公证裁决", description: "神圣裁决的持续时间内，你对该目标的重击范围扩至18-20", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "天谴鞭笞", description: "天罚降临的伤害骰提升为d12，且对中立阵营目标也造成全额伤害", type: "passive" },
          { name: "末日审判", description: "消灭一个邪恶阵营生物后刷新神圣裁决使用次数至上限", type: "passive" },
        ],
      },
    ],
  },

  // 冥土骑士 - 战士子职
  {
    id: "fighter_underworld_knight",
    label: "战士·冥土骑士",
    description: "由英雄尸体置换诞生的死灵骑士，拥有准英雄级实力",
    minAttributes: { strength: 16, constitution: 16, intelligence: 12 },
    priorityAttributes: ["strength", "constitution", "intelligence"],
    skills: ["athletics", "religion", "intimidation"],
    baseHp: 12,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "constitution"],
    baseClassId: "fighter",
    levelFeatures: [
      { level: 3,  name: "冥土之力", description: "你的近战攻击附加1d8黯蚀伤害，使用近战武器杀死敌人时回复等同于伤害量的生命值", type: "supernatural" },
      { level: 6,  name: "亡者之触", description: "以动作触碰一个生物，目标须通过体质豁免否则受到4d6黯蚀伤害且无法回复生命值，持续1分钟", type: "supernatural", usesPerDay: "2次/短休" },
      { level: 10, name: "灵魂收割", description: "每当你杀死一个生物，其灵魂在1分钟内为你战斗，最多同时控制3个灵魂", type: "supernatural" },
      { level: 14, name: "冥界门扉", description: "以动作打开通往冥界的裂隙，15尺锥形范围内的生物须通过感知豁免否则被拖入冥界一回合，返回时承受5d10心灵伤害", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "不死骑士", description: "生命值降至0时不会死亡，改为获得等同于战士等级×10的临时生命值且获得不死生物特性，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "亡者甲胄", description: "AC+1，近战攻击你的敌人受到1d4黯蚀反伤", type: "passive" },
          { name: "灵魂盛宴", description: "每吸收一个灵魂回复等同于战士等级的HP且获得+1攻击加值1分钟", type: "passive" },
          { name: "冥土召唤", description: "以动作从冥土召来一具骷髅战士为你作战1小时", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "死亡凋零", description: "亡者之触伤害提升至6d6，且目标在持续时间内无法受到任何治疗", type: "passive" },
          { name: "幽灵战马", description: "召唤幽灵坐骑，无视地形可穿越实体，每回合首次攻击附带1d8寒冷伤害", type: "supernatural", usesPerDay: "1次/长休" },
          { name: "灵魂屏障", description: "消耗一个被控制的灵魂以吸收一次攻击的全部伤害", type: "active" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "冥王庇佑", description: "不死骑士触发时临时生命值变为战士等级×15且持续2分钟", type: "passive" },
          { name: "灵魂支配", description: "灵魂收割控制上限提升至5个，灵魂获得+2攻击和伤害加值", type: "passive" },
        ],
      },
    ],
  },

  // 通武将军 - 战士子职
  {
    id: "fighter_martial_general",
    label: "战士·通武将军",
    description: "身负武曲星模板，精通一切武器",
    minAttributes: { strength: 16, dexterity: 14, constitution: 16 },
    priorityAttributes: ["strength", "constitution", "dexterity"],
    skills: ["athletics", "tactics", "weaponsmithing"],
    baseHp: 12,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "constitution"],
    baseClassId: "fighter",
    levelFeatures: [
      { level: 3,  name: "武曲星临", description: "精通所有武器类型，无视任何武器的熟练要求且使用任意武器时攻击检定获得+1加值", type: "passive" },
      { level: 6,  name: "军令如山", description: "以附赠动作下达战术命令，30尺内最多3名盟友可立即使用反应动作进行一次攻击或移动", type: "active", usesPerDay: "3次/短休" },
      { level: 10, name: "万兵归宗", description: "你可以在自己回合内以附赠动作切换手持武器，本轮剩余攻击不受武器切换影响", type: "passive" },
      { level: 14, name: "阵型指挥", description: "以动作展开战术阵型，60尺内所有盟友获得AC+1和攻击检定优势，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "军神降世", description: "以动作化身战场军神，自身和60尺内所有盟友获得额外攻击动作且移动速度翻倍，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "武器宗师", description: "武曲星临的攻击和伤害加值提升至+2", type: "passive" },
          { name: "扩编号令", description: "军令如山每次可影响的盟友数提升至5名", type: "passive" },
          { name: "战术速攻", description: "以附赠动作下达速攻令，自身和一名盟友各额外攻击一次", type: "active", usesPerDay: "1次/短休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "战术洞察", description: "以附赠动作分析战场，下一回合自身攻击获得优势且无视掩体", type: "active", usesPerDay: "1次/短休" },
          { name: "千兵万刃", description: "万兵归宗切换武器时可附赠进行一次额外攻击", type: "passive" },
          { name: "战阵老兵", description: "与盟友相邻时AC+1，且每个相邻盟友使你的攻击骰额外+1", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "铁壁军阵", description: "阵型指挥的AC加成提升至+2且范围扩大至120尺，盟友豁免也获优势", type: "passive" },
          { name: "战神附体", description: "军神降世状态下自身每回合可多行动一次，盟友伤害+5", type: "passive" },
        ],
      },
    ],
  },

  // 扶桑剑豪 - 武僧子职
  {
    id: "monk_kensei",
    label: "武僧·扶桑剑豪",
    description: "剑术举世无双的剑道宗师",
    minAttributes: { wisdom: 16, dexterity: 16, strength: 14 },
    priorityAttributes: ["dexterity", "wisdom", "strength"],
    skills: ["swordsmanship", "insight", "meditation"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "dexterity"],
    baseClassId: "monk",
    levelFeatures: [
      { level: 3,  name: "剑道之眼", description: "消耗2点气以附赠动作进入剑道专注状态，近战攻击检定获得优势且重击范围扩大至19-20，持续1分钟", type: "active", usesPerDay: "3次/长休" },
      { level: 6,  name: "居合斩", description: "消耗1点气以反应动作在被攻击前先发制人，对攻击者进行一次武器攻击，若命中则目标攻击失手", type: "active", usesPerDay: "2次/短休" },
      { level: 10, name: "剑气外放", description: "你的近战攻击可延伸至15尺，视作远程武器攻击，使用敏捷调整值进行攻击和伤害掷骰", type: "passive" },
      { level: 14, name: "无明三段突", description: "消耗3点气以动作发动三段连续突刺，每段造成武器伤害+3d6力场伤害，第三段无视目标伤害抗性", type: "active", usesPerDay: "1次/长休" },
      { level: 18, name: "剑圣降临", description: "消耗5点气进入剑圣境界1分钟，攻击检定获得优势，重击范围扩至18-20，对非魔法物理伤害获得抗性，移动速度+30尺", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "剑道护体", description: "使用剑类武器时AC+1，敏捷豁免检定获得+1加值", type: "passive" },
          { name: "残心之术", description: "武器攻击重击时额外追加一次攻击，每回合最多触发一次", type: "passive" },
          { name: "明镜止水", description: "先攻检定获得优势，且无法被突袭", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "拔刀斩", description: "先攻回合的首次武器攻击额外造成2d6力场伤害", type: "passive" },
          { name: "心眼通明", description: "无法被夹击或偷袭，感知检定获得+2加值", type: "passive" },
          { name: "气合斩", description: "消耗1点气在攻击命中时额外造成3d6力场伤害", type: "active" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "剑压天下", description: "重击时目标需力量豁免否则被击倒且失去反应动作", type: "passive" },
          { name: "无想剑域", description: "以反应动作招架一次近战攻击，成功后可用附赠反击", type: "active", usesPerDay: "1次/短休" },
        ],
      },
    ],
  },

  // ========== 盗贼子类职业 ==========

  // 潜行暗杀者 - 盗贼子职
  {
    id: "rogue_silent_assassin",
    label: "盗贼·潜行暗杀者",
    description: "精通潜行与暗杀，是暗夜中的致命杀手",
    minAttributes: { dexterity: 16, charisma: 14, wisdom: 12 },
    priorityAttributes: ["dexterity", "charisma", "wisdom"],
    skills: ["stealth", "deception", "sleight of hand"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["dexterity", "intelligence"],
    baseClassId: "rogue",
    levelFeatures: [
      { level: 3,  name: "暗杀术", description: "在目标未察觉你时发动的攻击重击范围扩至15-20，且偷袭伤害骰提升为d8", type: "passive" },
      { level: 6,  name: "剧毒淬刃", description: "以附赠动作在武器上涂抹剧毒，下一次命中额外造成3d6毒素伤害，目标须通过体质豁免否则中毒1分钟", type: "active", usesPerDay: "3次/长休" },
      { level: 10, name: "死亡标记", description: "以附赠动作为目标施加死亡标记，你对标记目标的攻击忽略抗性和免疫力，持续1分钟", type: "active", usesPerDay: "1次/短休" },
      { level: 14, name: "一击必杀", description: "对生命值低于最大值一半的目标，你的偷袭伤害直接取满值", type: "passive" },
      { level: 18, name: "无声死神", description: "以动作进入完美潜行状态，获得高等隐形术效果（无法被通常方式侦测），下一次攻击造成5倍偷袭伤害后将解除隐形", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "影步潜行", description: "潜行移动不触发借机攻击，潜行中移动速度不受减值", type: "passive" },
          { name: "致命毒药", description: "毒素伤害骰由d6提升至d8，无视目标毒素抗性", type: "passive" },
          { name: "无声处决", description: "击杀目标后不引发周边敌人警觉，保持潜行状态", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "双重暗杀", description: "成功偷袭后可用附赠动作对另一目标再次发动偷袭", type: "active" },
          { name: "死亡绽放", description: "击杀敌人后15尺内释放毒雾，范围内目标中毒1分钟", type: "passive" },
          { name: "影中潜伏", description: "在昏暗或黑暗环境中能以附赠动作进入隐藏", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "死亡精准", description: "死亡标记的持续时间延长至10分钟，冷却不变", type: "passive" },
          { name: "致命本能", description: "对生命值高于最大值75%的目标，偷袭伤害翻倍", type: "passive" },
        ],
      },
    ],
  },

  // 无影神偷 - 盗贼子职
  {
    id: "rogue_shadow_thief",
    label: "盗贼·无影神偷",
    description: "三只手无影神偷，擅长偷窃",
    minAttributes: { dexterity: 18, charisma: 14, intelligence: 12 },
    priorityAttributes: ["dexterity", "charisma", "intelligence"],
    skills: ["sleight of hand", "stealth", "deception"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["dexterity", "intelligence"],
    baseClassId: "rogue",
    levelFeatures: [
      { level: 3,  name: "无影手", description: "偷窃检定时获得优势，且偷窃失败时目标不会察觉你的尝试", type: "passive" },
      { level: 6,  name: "暗影遁形", description: "在昏暗或黑暗环境中，以附赠动作融入阴影获得隐形效果，持续至你攻击或施法", type: "supernatural" },
      { level: 10, name: "顺手牵羊", description: "近战攻击命中时可同时进行一次偷窃检定，成功则从目标身上窃取一件未持有的物品", type: "passive" },
      { level: 14, name: "黑夜之主", description: "在黑暗中获得盲视30尺，且你的所有移动不受困难地形影响", type: "supernatural" },
      { level: 18, name: "偷天换日", description: "以动作与视野内一个生物瞬间交换位置，目标需通过魅力豁免，失败还可被偷取一件穿戴中的装备", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "妙手空空", description: "偷窃检定失败后可重投一次，取较高的检定结果", type: "active", usesPerDay: "1次/短休" },
          { name: "暗影疾行", description: "在阴影或黑暗环境中移动速度额外增加10尺", type: "passive" },
          { name: "易容大师", description: "易容工具熟练项且检定优势，伪装时间缩短一半", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "影之束缚", description: "偷袭命中后目标须通过敏捷豁免否则被暗影束缚1回合", type: "passive" },
          { name: "远程窃取", description: "可对30尺内目标进行一次远程偷窃，无距离惩罚", type: "active", usesPerDay: "1次/短休" },
          { name: "夜视精通", description: "若无黑暗视觉则获得60尺，已有则延伸至120尺", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "窃取大师", description: "顺手牵羊可于每次近战攻击命中时触发，无次数限制", type: "passive" },
          { name: "影中漫步", description: "在阴影中以附赠动作传送至30尺内另一处阴影", type: "supernatural", usesPerDay: "2次/长休" },
        ],
      },
    ],
  },

  // 皇家刺客 - 盗贼子职
  {
    id: "rogue_royal_assassin",
    label: "盗贼·皇家刺客",
    description: "皇家刺客团的刺客",
    minAttributes: { dexterity: 18, wisdom: 14, charisma: 12 },
    priorityAttributes: ["dexterity", "wisdom", "charisma"],
    skills: ["stealth", "deception", "intimidation"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["dexterity", "intelligence"],
    baseClassId: "rogue",
    levelFeatures: [
      { level: 3,  name: "宫廷伪装", description: "可花费10分钟进行完美易容，易容检定获得优势，且可完美模仿目标的声音和举止", type: "active" },
      { level: 6,  name: "社交暗杀", description: "在社交场合中对毫无戒备的目标发动攻击时，攻击检定获得优势且偷袭伤害翻倍", type: "passive" },
      { level: 10, name: "身份窃取", description: "杀死目标后可在1小时内完美冒充其身份，获得其全部记忆片段", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 14, name: "弑君一击", description: "对贵族、领袖或CR高于你等级的生物造成偷袭时，额外附加5d10力场伤害", type: "passive" },
      { level: 18, name: "王朝颠覆", description: "以动作在一个组织或王国中散播颠覆性谣言，所有针对你的攻击和检定自动具有劣势，持续24小时", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "贵族风度", description: "所有魅力类社交检定获得优势，身份伪装不被识破", type: "passive" },
          { name: "宫廷毒师", description: "可配制无味无色毒药，目标饮用后DC15体质豁免否则中毒", type: "active", usesPerDay: "1次/长休" },
          { name: "情报网络", description: "进入城市后1小时可获取目标人物的关键情报信息", type: "active", usesPerDay: "1次/长休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "千面之人", description: "无需准备时间即可完美易容，且可随时切换伪装", type: "passive" },
          { name: "致命暗器", description: "隐藏武器攻击+3命中且重击范围扩大至19-20", type: "passive" },
          { name: "魅惑细语", description: "对话中可对目标施放魅惑，感知豁免DC等于熟练加值加魅力调整值", type: "active", usesPerDay: "1次/短休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "弑君专家", description: "对贵族或领袖目标的偷袭伤害额外附加3d8伤害", type: "passive" },
          { name: "宫廷之影", description: "王朝颠覆效果持续48小时，且可同时影响两个组织", type: "passive" },
        ],
      },
    ],
  },

  // 骨刃刺客 - 盗贼子职
  {
    id: "rogue_bone_blade",
    label: "盗贼·骨刃刺客",
    description: "骨刃武器的刺客",
    minAttributes: { dexterity: 18, strength: 14, wisdom: 12 },
    priorityAttributes: ["dexterity", "strength", "wisdom"],
    skills: ["stealth", "athletics", "intimidation"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["dexterity", "intelligence"],
    baseClassId: "rogue",
    levelFeatures: [
      { level: 3,  name: "骨刃淬炼", description: "可使用骨骼材料锻造独特的骨刃武器，骨刃命中时额外造成1d6黯蚀伤害", type: "passive" },
      { level: 6,  name: "蚀骨之触", description: "骨刃攻击命中后伤口无法被普通方式治疗，目标每回合受到持续黯蚀伤害，持续至通过体质豁免", type: "supernatural" },
      { level: 10, name: "白骨风暴", description: "以动作投掷多把骨刃，对15尺锥形区域造成武器伤害+3d6黯蚀伤害", type: "active", usesPerDay: "2次/短休" },
      { level: 14, name: "骨骼再生", description: "骨刃被摧毁后可立即从自身骨骼再生，同时每回合恢复生命值，等于体质调整值+熟练加值", type: "passive" },
      { level: 18, name: "万骨穿心", description: "以动作从地下召唤骨刺林，30尺范围内所有敌人受8d10穿刺伤害且被束缚，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "骨刃共鸣", description: "骨刃命中后额外造成1d4黯蚀伤害并削弱目标AC1", type: "passive" },
          { name: "骨质硬铠", description: "骨骼硬化护甲等级+1，钝击和穿刺伤害减少2点", type: "passive" },
          { name: "掷骨术", description: "骨刃获得投掷属性射程30尺，投掷后自动返回手中", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "骨牢术", description: "以动作从地面召唤骨牢，目标需敏捷豁免否则被束缚", type: "active", usesPerDay: "1次/短休" },
          { name: "蚀骨之毒", description: "蚀骨之触持续伤害提升至1d8，且每回合额外损失体质", type: "passive" },
          { name: "双刃乱舞", description: "可双持骨刃，副手攻击不承受减值且可各触发一次", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "万骨之铠", description: "以动作全身覆盖骨甲1分钟，获得伤害减免5除钝击外", type: "supernatural", usesPerDay: "1次/长休" },
          { name: "白骨风暴", description: "白骨风暴范围扩大至20尺锥形，伤害提升至5d6", type: "passive" },
        ],
      },
    ],
  },

  // 神隐上忍 - 盗贼子职
  {
    id: "rogue_divine_shinobi",
    label: "盗贼·神隐上忍",
    description: "最神秘的大神，擅长易容伪装",
    minAttributes: { dexterity: 18, wisdom: 14, charisma: 14 },
    priorityAttributes: ["dexterity", "wisdom", "charisma"],
    skills: ["stealth", "deception", "disguise"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["dexterity", "intelligence"],
    baseClassId: "rogue",
    levelFeatures: [
      { level: 3,  name: "忍术·影分身", description: "以附赠动作制造2个影分身，分身拥有你1/4生命值并可与你交换位置，持续1分钟", type: "supernatural", usesPerDay: "3次/长休" },
      { level: 6,  name: "忍术·遁地", description: "以动作潜入地下，在地下可以半速移动，且地面上的生物无法感知你的存在", type: "supernatural", usesPerDay: "2次/短休" },
      { level: 10, name: "忍术·瞬身", description: "以反应动作在被攻击或受到范围效果前瞬间移动到60尺内可见的未占据空间", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 14, name: "忍术·千变", description: "以动作完美伪装成任何你见过的生物，体型可以在中体型和小体型之间变化，持续8小时", type: "supernatural" },
      { level: 18, name: "禁术·神隐", description: "以动作进入完全隐身状态1分钟，隐身期间无法被通常方式侦测，但仍可受到范围效果影响和感知检定对抗，不能攻击或施法", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "手里剑雨", description: "每回合投掷武器可额外攻击一次，最多投掷三枚", type: "passive" },
          { name: "烟雾遁术", description: "以附赠动作投掷烟雾弹制造15尺重度遮蔽区域", type: "active", usesPerDay: "3次/短休" },
          { name: "水上行走", description: "可在水面、垂直墙面和天花板上自由行走和站立", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "火遁之术", description: "受攻击时反应引爆火烟掩护遁形，传送至30尺内", type: "supernatural", usesPerDay: "1次/短休" },
          { name: "麻痹毒镖", description: "投掷暗器附加麻痹毒素，目标需体质豁免否则麻痹", type: "active", usesPerDay: "2次/长休" },
          { name: "分身强化", description: "影分身生命值提升至你的一半，且可发动借机攻击", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "封喉之术", description: "偷袭命中后目标需体质豁免否则沉默，无法施法和呼喊", type: "passive" },
          { name: "奥义皆传", description: "消耗所有气以一次攻击对周围所有敌人施加偷袭伤害", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
    ],
  },

  // 偷猎专家 - 盗贼子职
  {
    id: "rogue_poacher",
    label: "盗贼·偷猎专家",
    description: "擅长放冷枪，打一枪换一个地方，森林是偷袭者的主场",
    minAttributes: { dexterity: 16, wisdom: 14, intelligence: 12 },
    priorityAttributes: ["dexterity", "wisdom", "intelligence"],
    skills: ["stealth", "survival", "perception"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["dexterity", "intelligence"],
    baseClassId: "rogue",
    levelFeatures: [
      { level: 3,  name: "远程狙击", description: "远程武器的短射程和长射程各增加50%，且攻击检定获得+2加值", type: "passive" },
      { level: 6,  name: "陷阱大师", description: "以动作布置捕兽陷阱、绊绳或毒镖陷阱，触发时造成3d6伤害并附加对应控制效果", type: "active", usesPerDay: "3次/长休" },
      { level: 10, name: "森林亲和", description: "在自然环境中可以附赠动作隐藏，即使没有完全遮蔽也可尝试，且自然环境中移动速度+10尺", type: "passive" },
      { level: 14, name: "致命冷枪", description: "在隐藏状态下的远程偷袭伤害取最大值，且目标无法通过豁免减少伤害", type: "passive" },
      { level: 18, name: "万兽无缰", description: "你在荒野中的远程攻击无视全掩蔽和全遮蔽，攻击可以反弹一次命中第二个目标", type: "supernatural" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "鹰眼狙击", description: "远程攻击无视半掩蔽，四分之三掩蔽视为半掩蔽处理", type: "passive" },
          { name: "先发制人", description: "第一回合可额外进行一次远程攻击，无需消耗动作", type: "active" },
          { name: "营地警戒", description: "长休期间自动布置警戒陷阱，触发后发出警报并伤害", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "连环陷阱", description: "每次可同时布置两处陷阱，陷阱触发DC+2", type: "passive" },
          { name: "巨兽猎手", description: "对大体型及以上生物的偷袭伤害额外+3d6", type: "passive" },
          { name: "踪迹追踪", description: "追踪检定额外优势，且追踪时移动速度不受减值", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "陷阱连锁", description: "陷阱被触发时自动在10尺内生成一个同类型陷阱", type: "passive" },
          { name: "致命狙击", description: "远程攻击暴击范围扩大至18-20，暴击伤害翻倍", type: "passive" },
        ],
      },
    ],
  },

  // ========== 牧师子类职业 ==========

  // 神恩祭司 - 牧师子职
  {
    id: "cleric_divine_grace",
    label: "牧师·神恩祭司",
    description: "拥有感化光环，神圣之血，能够使用神术",
    minAttributes: { wisdom: 16, charisma: 16, strength: 14 },
    priorityAttributes: ["wisdom", "charisma", "strength"],
    skills: ["religion", "persuasion", "insight"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["wisdom", "charisma"],
    spellcaster: true,
    spellcastingType: "full",
    baseClassId: "cleric",
    levelFeatures: [
      { level: 3,  name: "感化光环", description: "以附赠动作展开感化光环，20尺内敌对生物必须通过感知豁免否则无法对你发动攻击，持续1分钟", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 6,  name: "神圣之血", description: "你的血液蕴含神圣力量，受到伤害时血液溅射对周围敌人造成光耀伤害，且可为盟友恢复生命值", type: "passive" },
      { level: 10, name: "群体赐福", description: "以动作为30尺内最多6个盟友施加神恩赐福，使其攻击检定和豁免检定获得优势，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 14, name: "圣言术·愈", description: "以附赠动作释放强大治愈圣言，为60尺内所有盟友恢复8d8+感知调整值点生命值，并移除所有毒素和疾病", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 18, name: "神恩降临", description: "以动作呼唤神恩降临，自身化为神圣容器1分钟，每回合为30尺内盟友恢复3d8生命值，即死效果豁免获得优势", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "净化光环", description: "光环范围内盟友每回合自动移除一项负面状态", type: "passive" },
          { name: "信仰之盾", description: "以反应动作为30尺内一名盟友挡下致命一击", type: "active", usesPerDay: "1次/短休" },
          { name: "虔诚印记", description: "标记一名友军，其受到的所有治疗骰取最大值", type: "active", usesPerDay: "1次/短休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "圣光回响", description: "你的治疗法术溅射恢复30尺内盟友1d4生命值", type: "passive" },
          { name: "牺牲祷言", description: "消耗自身20点生命值使下一次治疗法术效果翻倍", type: "active" },
          { name: "恩典之躯", description: "战斗外每10分钟自动恢复1点生命值上限损失", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "逆转恩典", description: "将一次受到的伤害转化为等量的生命值恢复", type: "supernatural", usesPerDay: "1次/长休" },
          { name: "恩典共鸣", description: "光环内盟友受到致命伤害时自动以1HP存活一次", type: "supernatural" },
        ],
      },
    ],
  },

  // 神使 - 牧师子职
  {
    id: "cleric_divine_messenger",
    label: "牧师·神使",
    description: "天使代言人，灵魂受到裁决天使庇护",
    minAttributes: { wisdom: 16, charisma: 16, dexterity: 14 },
    priorityAttributes: ["wisdom", "charisma", "dexterity"],
    skills: ["religion", "performance", "persuasion"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["wisdom", "charisma"],
    spellcaster: true,
    spellcastingType: "full",
    baseClassId: "cleric",
    levelFeatures: [
      { level: 3,  name: "天使庇护", description: "以反应动作召唤天使虚影庇护一名盟友，使其获得AC+2加值且受到的下一次攻击伤害减半", type: "supernatural", usesPerDay: "感知调整值次/长休" },
      { level: 6,  name: "天启之眼", description: "获得看穿隐形和幻象的能力，且可感知60尺内生物的真实阵营", type: "passive" },
      { level: 10, name: "天使降临", description: "以动作召唤一位天使为你作战，天使拥有独立的行动回合，持续1小时", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 14, name: "圣光审判", description: "以动作释放审判之光对60尺内所有敌人造成6d8光耀伤害，邪恶生物豁免劣势且受到额外伤害", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 18, name: "神之代言", description: "获得天使形态1分钟，期间飞行速度为90尺，所有治疗和增益法术效果翻倍", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "光翼", description: "以附赠动作召唤天使光翼获得30尺飞行速度", type: "supernatural", usesPerDay: "2次/长休" },
          { name: "天启之音", description: "可听到1里范围内呼唤你神名的任何声音", type: "supernatural" },
          { name: "裁决之矛", description: "远程攻击投掷光矛，造成1d8+感知光耀伤害", type: "active" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "天使共鸣", description: "天使在场时你的法术DC获得感知调整值加成", type: "passive" },
          { name: "天堂烈焰", description: "圣光审判的有效范围扩大至90尺", type: "passive" },
          { name: "威仪", description: "30尺内敌对生物攻击你时攻击检定具有劣势", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "天使军团", description: "天使降临效果升级为同时召唤两位天使", type: "supernatural" },
          { name: "天堂之门", description: "开启通往天堂位面的裂缝放逐或召唤天界生物", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
    ],
  },

  // 红莲巫女 - 牧师子职
  {
    id: "cleric_red_lotus",
    label: "牧师·红莲巫女",
    description: "能够操控红莲业火，擅长群体伤害与净化",
    minAttributes: { wisdom: 16, charisma: 14, constitution: 12 },
    priorityAttributes: ["wisdom", "charisma", "constitution"],
    skills: ["religion", "nature", "healing"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["wisdom", "charisma"],
    spellcaster: true,
    spellcastingType: "full",
    baseClassId: "cleric",
    levelFeatures: [
      { level: 3,  name: "红莲之火", description: "你的火焰法术额外附带光耀伤害，且被红莲之火击中的敌人无法隐形，持续至你的下回合结束", type: "passive" },
      { level: 6,  name: "业火净罪", description: "以动作释放扇形红莲业火，15尺锥形范围内敌人受4d6火焰+4d6光耀伤害，盟友则被治愈等量生命值", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 10, name: "火焰净化", description: "以动作为盟友移除诅咒、附身和魔法控制效果，并使其在1分钟内免疫此类效果", type: "supernatural", usesPerDay: "2次/长休" },
      { level: 14, name: "红莲绽放", description: "以自身为中心释放红莲花瓣风暴，30尺内所有敌人受8d8火焰伤害且每回合持续燃烧1d8，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "净世红莲", description: "召唤巨大红莲从天而降，60尺半径内净化一切邪恶，造成12d10光耀伤害并放逐所有邪魔和不死生物", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "莲华护罩", description: "火焰编织护盾提供AC+1且近战攻击者受1d4火焰反击", type: "passive" },
          { name: "焚罪之触", description: "近战接触造成2d6火焰伤害并施加忏悔状态", type: "active", usesPerDay: "感知调整值次/长休" },
          { name: "灰烬治愈", description: "从敌方尸体中汲取生命灰烬为盟友治疗3d6", type: "active", usesPerDay: "2次/长休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "业火烙印", description: "被红莲之火击中的敌人每回合额外承受1d6光耀伤害", type: "passive" },
          { name: "净罪之风", description: "火焰净化效果由单体升级为30尺范围效果", type: "passive" },
          { name: "莲华步", description: "以附赠动作在任意可见的火焰之间瞬移30尺", type: "supernatural" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "涅槃红莲", description: "受到致命伤害时化作红莲原地重生恢复一半生命值", type: "supernatural", usesPerDay: "1次/长休" },
          { name: "永恒业火", description: "红莲之火无法被任何方式熄灭或抗性减免", type: "passive" },
        ],
      },
    ],
  },

  // 稻荷神主 - 牧师子职
  {
    id: "cleric_inari_shrine",
    label: "牧师·稻荷神主",
    description: "擅长召唤、辅助、幻术，拥有紫色狐火",
    minAttributes: { wisdom: 16, charisma: 16, dexterity: 14 },
    priorityAttributes: ["wisdom", "charisma", "dexterity"],
    skills: ["religion", "nature", "performance"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["wisdom", "charisma"],
    spellcaster: true,
    spellcastingType: "full",
    baseClassId: "cleric",
    levelFeatures: [
      { level: 3,  name: "狐火召唤", description: "以附赠动作召唤3团紫色狐火围绕自身，每团狐火可为一次攻击提供伤害加成或阻挡一次远程攻击", type: "supernatural", usesPerDay: "3次/长休" },
      { level: 6,  name: "稻荷神咒", description: "以动作释放稻荷神咒祝福盟友，30尺内所有盟友的下一次攻击检定获得优势且额外造成2d6光耀伤害", type: "supernatural", usesPerDay: "2次/短休" },
      { level: 10, name: "狐化身", description: "以附赠动作变形为九尾狐形态，获得敏捷优势、额外移动速度和黑暗视觉，持续1小时", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 14, name: "丰收恩赐", description: "以动作使30尺半径内的土地瞬间恢复生机，盟友恢复6d8+感知调整值点生命值并移除力竭等级，敌方亡灵受到驱散效果", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 18, name: "稻荷显圣", description: "以动作召唤稻荷神虚影降临，60尺内盟友获得全豁免优势且每回合恢复生命值，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "狐隐", description: "以附赠动作进入隐身状态持续至你的下回合结束", type: "active", usesPerDay: "3次/短休" },
          { name: "丰收印记", description: "标记区域使植物快速生长形成困难地形掩护", type: "supernatural", usesPerDay: "1次/短休" },
          { name: "狐之狡黠", description: "欺骗和表演检定获得优势", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "幻狐分身", description: "制造两个幻影分身迷惑敌人为你承受攻击", type: "supernatural", usesPerDay: "2次/短休" },
          { name: "狐火爆裂", description: "消耗一团狐火对15尺范围造成3d6火焰爆炸伤害", type: "active" },
          { name: "稻荷结界", description: "展开结界内部敌人无法传送且移速减半", type: "supernatural", usesPerDay: "1次/短休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "九尾觉醒", description: "狐化身时获得9团狐火上限及全部属性+2加值", type: "supernatural" },
          { name: "神使召唤", description: "召唤一只稻荷神使白狐为你作战持续1小时", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
    ],
  },

  // ========== 德鲁伊子类职业 ==========

  // 海龙王 - 德鲁伊子职
  {
    id: "druid_water_sovereign",
    label: "德鲁伊·澜沧龙王",
    description: "护国神兽澜沧龙王，水元素形态，能够操控海洋力量",
    minAttributes: { wisdom: 16, constitution: 14, charisma: 12 },
    priorityAttributes: ["wisdom", "constitution", "charisma"],
    skills: ["nature", "survival", "athletics"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["wisdom", "constitution"],
    spellcaster: true,
    spellcastingType: "full",
    baseClassId: "druid",
    levelFeatures: [
      { level: 3,  name: "水元素形态", description: "以附赠动作化为水元素形态，免疫毒素和溺水，可在水中自由呼吸并以游泳速度移动", type: "supernatural", usesPerDay: "2次/短休" },
      { level: 6,  name: "浪潮召唤", description: "以动作召唤巨浪冲击30尺锥形区域，造成4d8冷冻伤害并将目标击退15尺", type: "active", usesPerDay: "2次/短休" },
      { level: 10, name: "深渊漩涡", description: "以动作在水域或地面创造巨大漩涡，20尺半径内所有敌人必须通过力量豁免否则被卷入中心并每回合受到伤害", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 14, name: "龙王真身", description: "以附赠动作化为澜沧龙王形态，获得庞大体型和龙息攻击，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "汪洋主宰", description: "以动作将战场变为汪洋，所有敌人移动速度减半且每回合受冷冻伤害，你可在水元素和龙王形态间自由切换", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "潮汐之力", description: "你的水属性和冷冻伤害骰自动取最大值", type: "passive" },
          { name: "水雾遮蔽", description: "以附赠动作制造浓雾区域提供重度遮蔽", type: "active", usesPerDay: "3次/长休" },
          { name: "深海亲和", description: "水元素形态时可将水下呼吸能力赋予一名盟友", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "水龙弹", description: "射出高压水弹造成3d8钝击伤害并将目标击退15尺", type: "active", usesPerDay: "2次/短休" },
          { name: "治愈之泉", description: "创造一眼治愈泉水，饮用可恢复3d8生命值", type: "active", usesPerDay: "1次/短休" },
          { name: "冰冻血脉", description: "你的冷冻伤害附带目标移速减半的减速效果", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "龙王降临", description: "龙王真身形态持续时间延长至10分钟", type: "supernatural" },
          { name: "深渊召唤", description: "从漩涡中召唤两只深海生物为你作战", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
    ],
  },

  // 北风使者 - 德鲁伊子职
  {
    id: "druid_north_wind",
    label: "德鲁伊·北风使者",
    description: "能够操控冰雪与北风",
    minAttributes: { wisdom: 16, intelligence: 14, charisma: 12 },
    priorityAttributes: ["wisdom", "intelligence", "charisma"],
    skills: ["nature", "survival", "arcana"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["wisdom", "constitution"],
    spellcaster: true,
    spellcastingType: "full",
    baseClassId: "druid",
    levelFeatures: [
      { level: 3,  name: "北风凛冽", description: "你的寒冷法术伤害骰提升为d8，且目标无法通过抗性减免", type: "passive" },
      { level: 6,  name: "冰霜护甲", description: "以附赠动作在身上覆盖冰霜护甲，获得AC+2加值且攻击你的敌人受到1d4冷冻伤害，持续1小时", type: "active", usesPerDay: "2次/短休" },
      { level: 10, name: "暴风雪", description: "以动作召唤暴风雪覆盖60尺半径区域，范围内的敌人每回合受冷冻伤害且移动减半，持续1分钟", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 14, name: "冰封禁锢", description: "以动作将目标完全冰封，目标必须通过体质豁免否则被冰冻1分钟，期间无法行动但获得伤害减免", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "永冻领域", description: "以自身为中心展开永冻领域，30尺内所有敌人移动速度降为0且每回合受到严重冷冻伤害，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "冰霜之触", description: "近战攻击附加1d4冷冻伤害并使目标移速减半", type: "passive" },
          { name: "冬之足迹", description: "行走过的地面自动结冰成为困难地形", type: "passive" },
          { name: "霜寒抗性", description: "获得冷冻伤害抗性且无视寒冷环境的不良影响", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "冰锥连射", description: "以动作射出三枚冰锥各造成2d6穿刺伤害", type: "active", usesPerDay: "3次/短休" },
          { name: "极寒之风", description: "你的风可吹散云雾、毒气和魔法黑暗区域", type: "passive" },
          { name: "冰盾术", description: "以反应动作在面前生成冰盾吸收一次攻击伤害", type: "active", usesPerDay: "2次/短休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "冰霜巨人", description: "永冻领域中可变形为冰霜巨人获得力量+6、体质+4的属性加成，持续1分钟", type: "supernatural" },
          { name: "极光庇护", description: "极光笼罩下盟友获得隐身和全部伤害抗性", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
    ],
  },

  // 兽魂萨满 - 野蛮人子职
  {
    id: "barbarian_beast_shaman",
    label: "野蛮人·兽魂萨满",
    description: "能够与兽魂沟通并借用其力量",
    minAttributes: { strength: 16, wisdom: 16, constitution: 14 },
    priorityAttributes: ["strength", "wisdom", "constitution"],
    skills: ["survival", "nature", "religion"],
    baseHp: 14,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "wisdom"],
    baseClassId: "barbarian",
    levelFeatures: [
      { level: 3,  name: "兽魂图腾", description: "以附赠动作立下蕴含自然魔法的兽魂图腾柱，20尺内盟友获得你所选兽魂的一种增益（熊之力+2力量、鹰之眼+5先攻、狼之速+10移动速度），不可与法术叠加", type: "supernatural", usesPerDay: "感知调整值次/长休" },
      { level: 6,  name: "兽灵附体", description: "狂暴时可选择一个兽魂附体，获得对应能力：熊魂（AC+2）、鹰魂（飞行30尺）、狼魂（攻击优势）", type: "supernatural" },
      { level: 10, name: "先祖召唤", description: "以动作召唤兽灵先祖为你作战，先祖拥有你一半属性且每回合可进行一次攻击，持续1分钟", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 14, name: "兽神变", description: "狂暴时可变形为所选兽魂的完全体形态（巨熊、巨鹰、恐狼），获得对应巨兽的全部属性", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "万兽之灵", description: "同时获得所有兽魂的增益效果，狂暴时对魅惑和恐惧豁免获得优势，AC+1", type: "supernatural" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "兽魂低语", description: "可与野兽和自然精魂沟通获取情报与指引", type: "supernatural" },
          { name: "图腾扎根", description: "放置图腾柱后免疫推撞和击倒效果", type: "passive" },
          { name: "灵视", description: "获得30尺黑暗视觉并可看到灵体生物", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "魂铸武器", description: "将兽魂之力注入武器，获得1d6额外元素伤害", type: "active" },
          { name: "兽群之护", description: "盟友在图腾范围内获得对恐惧和魅惑的豁免优势", type: "passive" },
          { name: "自然之怒", description: "狂暴时可号令周围自然环境攻击敌人", type: "supernatural" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "魂兽合一", description: "兽魂附体后可同时获得两种兽魂的能力", type: "supernatural" },
          { name: "先祖之怒", description: "先祖召唤持续期间你每回合可额外攻击一次", type: "supernatural" },
        ],
      },
    ],
  },

  // ========== 游侠子类职业 ==========

  // 瞑目射手 - 游侠子职
  {
    id: "ranger_blind_sight",
    label: "游侠·瞑目射手",
    description: "用死灵生物眼球替换人眼的特殊射手，拥有灵魂之眼，能在黑暗中视物",
    minAttributes: { dexterity: 16, wisdom: 16, constitution: 12 },
    priorityAttributes: ["dexterity", "wisdom", "constitution"],
    skills: ["perception", "survival", "stealth"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "dexterity"],
    spellcaster: true,
    spellcastingType: "half",
    baseClassId: "ranger",
    levelFeatures: [
      { level: 3,  name: "灵魂之眼", description: "获得盲视60尺，可看穿非魔法黑暗和隐形生物，且不会被目盲", type: "passive" },
      { level: 6,  name: "回声定位", description: "以附赠动作释放声波脉冲，感知120尺内所有生物和物体的精确位置，持续1分钟", type: "active", usesPerDay: "3次/长休" },
      { level: 10, name: "瞑目狙击", description: "闭眼状态下远程攻击检定获得优势，且你的攻击无视半掩蔽和四分之三掩蔽", type: "passive" },
      { level: 14, name: "心眼通", description: "获得对周围环境的绝对感知，无法被突袭，且可预感30尺内的陷阱和埋伏", type: "supernatural" },
      { level: 18, name: "死亡凝视", description: "睁开灵魂之眼凝视一个目标，目标必须通过感知豁免否则灵魂被暂时剥离，陷入麻痹1分钟", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "黑暗面纱", description: "以附赠动作制造黑暗帷幕隐藏自身位置", type: "active", usesPerDay: "2次/短休" },
          { name: "魂视印记", description: "灵魂之眼标记的目标无法获得掩蔽加值", type: "passive" },
          { name: "静谧之步", description: "潜行时移动不发出任何声音且不会触发震动感知", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "音波感知", description: "可精确感知墙壁和障碍物后方30尺内的生物", type: "passive" },
          { name: "无形箭矢", description: "远程攻击无视魔法护盾和防护法术效果", type: "passive" },
          { name: "暗袭", description: "从完全黑暗中发动的首次远程攻击视为重击", type: "active", usesPerDay: "1次/短休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "虚无之眼", description: "可短暂预知未来一秒免疫突袭且先攻获得优势", type: "supernatural" },
          { name: "灵魂狙击", description: "死亡凝视有效范围扩大至120尺且目标陷入麻痹", type: "supernatural" },
        ],
      },
    ],
  },

  // 魔弓手 - 游侠子职
  {
    id: "ranger_magic_archer",
    label: "游侠·魔弓手",
    description: "精通远程攻击的魔法弓箭手",
    minAttributes: { dexterity: 16, wisdom: 14, intelligence: 12 },
    priorityAttributes: ["dexterity", "wisdom", "intelligence"],
    skills: ["perception", "survival", "arcana"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "dexterity"],
    spellcaster: true,
    spellcastingType: "half",
    baseClassId: "ranger",
    levelFeatures: [
      { level: 3,  name: "魔箭术", description: "以附赠动作在箭矢上附加元素之力（火、冰、雷、毒任选），额外造成1d6对应元素伤害", type: "active", usesPerDay: "智力调整值次/长休" },
      { level: 6,  name: "符文箭", description: "可在箭矢上铭刻符文，命中时触发特殊效果：爆炸（对10尺半径造成2d6火焰伤害）、束缚（目标需力量豁免否则束缚）、追踪（攻击检定获得优势）", type: "active", usesPerDay: "1次/短休" },
      { level: 10, name: "箭雨风暴", description: "以动作射出魔法箭雨，60尺半径内所有敌人受到武器伤害+3d8力场伤害", type: "active", usesPerDay: "1次/短休" },
      { level: 14, name: "次元箭", description: "射出穿透空间的次元箭，无视掩蔽和距离限制，可攻击同一纬度内的任何可见目标", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "终焉之箭", description: "以动作射出一支蕴含毁灭魔力的终极箭矢，命中后造成20d8力场伤害，目标为邪恶阵营时伤害翻倍", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "元素共鸣", description: "魔箭术元素伤害骰提升为d10", type: "passive" },
          { name: "追踪之箭", description: "未命中时箭矢可折返并再次进行攻击检定", type: "passive" },
          { name: "魔力弦", description: "远程攻击无视非魔法弹药的消耗", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "双重魔箭", description: "魔箭术可同时附加两种不同元素之力", type: "active", usesPerDay: "感知调整值次/长休" },
          { name: "符文强化", description: "符文箭可同时铭刻两种组合符文效果", type: "passive" },
          { name: "爆散箭", description: "箭矢命中后分裂碎片对周围5尺内敌人造成伤害", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "魔弓具现", description: "以动作召唤魔力凝结的长弓箭矢自动生成", type: "supernatural" },
          { name: "时空裂隙", description: "次元箭可攻击过去一回合内曾被标记的目标", type: "supernatural" },
        ],
      },
    ],
  },

  // 靛蓝射手 - 游侠子职
  {
    id: "ranger_indigo",
    label: "游侠·靛蓝射手",
    description: "远程射手，与瞑目射手有同样的射击精度",
    minAttributes: { dexterity: 16, wisdom: 14, constitution: 12 },
    priorityAttributes: ["dexterity", "wisdom", "constitution"],
    skills: ["perception", "survival", "stealth"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "dexterity"],
    spellcaster: true,
    spellcastingType: "half",
    baseClassId: "ranger",
    levelFeatures: [
      { level: 3,  name: "靛蓝弹药", description: "可花费短休时间制作三种靛蓝特种箭矢：穿透箭（无视AC加值）、爆裂箭（范围2d6火焰）、标记箭（命中后追踪目标位置）", type: "passive" },
      { level: 6,  name: "精准射击", description: "远程攻击鉴定若超过目标AC 5点以上，则额外造成2d6精准伤害", type: "passive" },
      { level: 10, name: "弹幕射击", description: "以动作对30尺锥形区域发射弹幕，区域内所有敌人受到普通远程攻击伤害", type: "active", usesPerDay: "2次/短休" },
      { level: 14, name: "定点爆破", description: "以动作瞄准目标的弱点，下一发射击造成双倍武器伤害且目标必须通过体质豁免否则被震慑1轮", type: "active", usesPerDay: "1次/长休" },
      { level: 18, name: "靛蓝星落", description: "以动作向天空射出信号箭，引导靛蓝箭雨覆盖100尺半径，每回合对所有敌人造成远程攻击伤害，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "连射", description: "攻击动作后可进行一次额外的远程攻击", type: "passive" },
          { name: "穿甲箭", description: "靛蓝穿甲弹药无视目标所有非魔法护甲AC加值", type: "passive" },
          { name: "弹药储备", description: "每次制作靛蓝特种弹药数量翻倍", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "烟雾箭", description: "发射烟雾箭提供15尺半径重度遮蔽区域", type: "active", usesPerDay: "3次/短休" },
          { name: "麻痹箭", description: "使用特种箭命中后附加麻痹效果1回合", type: "passive" },
          { name: "精准直觉", description: "远程攻击未命中后可重掷一次攻击检定", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "靛蓝领域", description: "展开狙击领域范围内友军远程伤害+2d6", type: "supernatural", usesPerDay: "1次/短休" },
          { name: "必中之矢", description: "一次远程攻击无视AC自动命中但伤害减半", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
    ],
  },

  // 鸣笛射手 - 游侠子职
  {
    id: "ranger_whistling",
    label: "游侠·鸣笛射手",
    description: "交响箭雨",
    minAttributes: { dexterity: 16, wisdom: 14, charisma: 12 },
    priorityAttributes: ["dexterity", "wisdom", "charisma"],
    skills: ["perception", "performance", "survival"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "dexterity"],
    spellcaster: true,
    spellcastingType: "half",
    baseClassId: "ranger",
    levelFeatures: [
      { level: 3,  name: "口哨号令", description: "以附赠动作吹响口哨，指挥你的动物伙伴进行一次额外攻击或移动动作", type: "active" },
      { level: 6,  name: "交响连射", description: "以附赠动作进入射箭韵律，本回合内每次远程攻击命中后，下一次攻击获得+1累积加值", type: "active", usesPerDay: "3次/短休" },
      { level: 10, name: "动物传讯", description: "可通过口哨与120尺内所有动物进行无声沟通，获得情报并指挥它们协助作战", type: "supernatural" },
      { level: 14, name: "战歌号角", description: "吹响战歌号角，60尺内所有盟友获得攻击检定优势和移动速度+15尺，持续1分钟", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 18, name: "万兽齐鸣", description: "吹响传奇号角召唤方圆1里内所有野生动物为你而战，持续10分钟", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "双兽号令", description: "口哨号令可同时指挥两只动物伙伴行动", type: "passive" },
          { name: "治愈旋律", description: "吹奏治愈之音恢复一名盟友1d8+感知生命值", type: "supernatural", usesPerDay: "3次/短休" },
          { name: "疾风曲", description: "吹奏疾风曲自身移动速度+20尺持续1分钟", type: "active", usesPerDay: "2次/短休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "和鸣连射", description: "动物伙伴攻击命中后你获得一次免费远程攻击", type: "passive" },
          { name: "警戒之音", description: "吹奏警戒音感知范围内所有潜行或隐形生物", type: "active", usesPerDay: "2次/短休" },
          { name: "安抚曲", description: "以动作吹奏安抚曲使30尺内敌对生物放弃攻击意愿", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "万兽乐章", description: "战歌号角持续期间动物伙伴每回合获得额外动作", type: "supernatural" },
          { name: "魂之歌", description: "吹奏灵魂挽歌使一名死亡盟友以半数HP复活", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
    ],
  },

  // 驯兽师 - 游侠子职
  {
    id: "ranger_beast_tamer",
    label: "游侠·驯兽师",
    description: "能够与超阶魔兽签订契约的驯兽师，拥有强大的宠物",
    minAttributes: { wisdom: 16, charisma: 14, dexterity: 12 },
    priorityAttributes: ["wisdom", "charisma", "dexterity"],
    skills: ["animal handling", "nature", "survival"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "dexterity"],
    spellcaster: true,
    spellcastingType: "half",
    baseClassId: "ranger",
    levelFeatures: [
      { level: 3,  name: "契约之绊", description: "与一只CR不超过你等级一半的魔兽签订灵魂契约，它可以作为你的伙伴共享先攻权并随你等级成长", type: "passive" },
      { level: 6,  name: "超阶驯服", description: "驯服检定时获得优势，且可以尝试驯服CR不超过你等级的魔兽", type: "passive" },
      { level: 10, name: "共生强化", description: "你和你的魔兽伙伴共享部分属性：魔兽获得你的熟练加值，你获得魔兽的一项特殊能力", type: "supernatural" },
      { level: 14, name: "兽群召唤", description: "以动作召唤最多3只已驯服的魔兽同时出场作战，持续1小时", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "万兽之王", description: "你的魔兽伙伴进化为传奇形态，获得额外的HP、伤害和专属传奇动作", type: "supernatural" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "野性共鸣", description: "魔兽伙伴额外获得你的熟练加值到攻击检定", type: "passive" },
          { name: "协同战术", description: "你和魔兽伙伴夹击同一目标时双方攻击获得优势", type: "passive" },
          { name: "治愈兽魂", description: "以动作让你的魔兽伙伴恢复3d8生命值", type: "active", usesPerDay: "2次/短休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "多重契约", description: "可同时与第二只魔兽签订灵魂契约", type: "active" },
          { name: "兽牙武装", description: "魔兽伙伴的天然武器获得+1魔法攻击和伤害加值", type: "passive" },
          { name: "守护壁垒", description: "魔兽伙伴可以反应动作为你格挡一次攻击", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "灵魂融合", description: "与魔兽伙伴暂时合体获得双方全部属性加成", type: "supernatural", usesPerDay: "1次/长休" },
          { name: "传奇驯服", description: "可尝试驯服传奇生物CR等级无上限", type: "supernatural" },
        ],
      },
    ],
  },

  // ========== 工匠子类职业 ==========

  // 机巧人形师 - 工匠子职
  {
    id: "artificer_doll_master",
    label: "工匠·机巧人形师",
    description: "傀儡师进阶，能够操纵多个傀儡",
    minAttributes: { intelligence: 16, dexterity: 16, wisdom: 14 },
    priorityAttributes: ["intelligence", "dexterity", "wisdom"],
    skills: ["arcana", "crafting", "performance"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["constitution", "intelligence"],
    spellcaster: true,
    spellcastingType: "half",
    baseClassId: "artificer",
    levelFeatures: [
      { level: 3,  name: "双操人形", description: "可同时操控两具战斗人形为你作战，每具人形拥有独立的攻击和移动", type: "passive" },
      { level: 6,  name: "精密操控", description: "以附赠动作对所有人形下达战术指令，人形可执行更复杂的战技动作（缴械、绊摔、推撞）", type: "active" },
      { level: 10, name: "人形工坊", description: "可花费长休时间在工坊中制造和改造人形，数量上限提升至5具且每具可安装不同的武装模块", type: "passive" },
      { level: 14, name: "灵魂注入", description: "以动作将捕获的灵魂注入人形，人形获得自主意识和独立行动回合，不再需要你操作", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "人偶军势", description: "以动作激活所有库存人形组成军团，人形数量上限提升至20具，持续作战1小时", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "人形强化", description: "每具人形AC+1，最大HP+10", type: "passive" },
          { name: "替身术", description: "受击时与人形互换，攻击转由人形承担", type: "active", usesPerDay: "1次/短休" },
          { name: "自爆指令", description: "人形自爆对周围10尺造成3d6火焰伤害", type: "active" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "同步操控", description: "一个附赠动作对所有人形下达指令", type: "passive" },
          { name: "伪装术", description: "人形可伪装成普通物品或类人生物", type: "active" },
          { name: "束缚丝线", description: "人形攻击命中后目标需敏捷豁免否则束缚", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "灵魂觉醒", description: "注入灵魂的人形获得+2全属性加值", type: "supernatural" },
          { name: "双武装模块", description: "每具人形可安装两套不同武器模块", type: "passive" },
        ],
      },
    ],
  },

  // 重机驾手 - 工匠子职
  {
    id: "artificer_heavy_machine",
    label: "工匠·重机驾手",
    description: "酷爱操纵巨大机械与重火力",
    minAttributes: { intelligence: 16, strength: 16, constitution: 14 },
    priorityAttributes: ["intelligence", "strength", "constitution"],
    skills: ["arcana", "athletics", "crafting"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["constitution", "intelligence"],
    // 注：原著明文重机驾手无法掌握初级魔法，此处不设施法能力
    baseClassId: "artificer",
    levelFeatures: [
      { level: 3,  name: "机甲操控", description: "可驾驶一台中型机甲作战，机甲拥有独立的HP和AC，提供额外的攻击火力", type: "passive" },
      { level: 6,  name: "重火力模式", description: "以附赠动作切换机甲的武器模式：机关炮（多段低伤）、主炮（单段高伤）、火焰喷射器（范围伤害）", type: "active" },
      { level: 10, name: "攻城机甲", description: "机甲升级为大型攻城模式，获得额外HP和伤害减免，可对建筑和大型目标造成双倍伤害", type: "passive" },
      { level: 14, name: "自爆装置", description: "以反应动作在机甲被摧毁时启动自爆，对30尺内所有敌人造成10d10火焰伤害", type: "active" },
      { level: 18, name: "钢铁洪流", description: "以动作召唤三台备用机甲从异次元仓库中传送至战场，机甲可自主作战或由盟友驾驶", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "重装装甲", description: "机甲获得5点全伤害减免", type: "passive" },
          { name: "紧急弹射", description: "机甲被摧毁时可弹射至60尺安全位置", type: "passive" },
          { name: "能量护盾", description: "附赠激活护盾，吸收智力调整×5伤害", type: "active", usesPerDay: "1次/短休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "狙击模式", description: "主炮暴击范围扩大至18-20", type: "passive" },
          { name: "弹幕压制", description: "机关炮命中使目标下回合移速减半", type: "passive" },
          { name: "涡轮增压", description: "机甲移速+30尺，可执行疾冲附赠动作", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "核心过载", description: "全伤害+50%持续3回合，之后瘫痪1回合", type: "active", usesPerDay: "1次/长休" },
          { name: "纳米修复", description: "机甲每回合开始恢复3d6生命值", type: "passive" },
        ],
      },
    ],
  },

  // ========== 武僧子类职业 ==========

  // 降魔武僧 - 武僧子职
  {
    id: "monk_demon_subduer",
    label: "武僧·降魔武僧",
    description: "练就金刚不坏之躯的武僧，魔法抗性极高，是法系职业的克星",
    minAttributes: { wisdom: 16, strength: 14, constitution: 16 },
    priorityAttributes: ["wisdom", "constitution", "strength"],
    skills: ["religion", "athletics", "meditation"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "dexterity"],
    baseClassId: "monk",
    levelFeatures: [
      { level: 3,  name: "金刚体", description: "获得魔法抗性，对抗法术的豁免检定获得优势，且受到的法术伤害减少等于感知调整值的量", type: "passive" },
      { level: 6,  name: "破法拳", description: "以附赠动作蓄力，下一次徒手攻击命中时自动驱散目标身上的一个法术效果", type: "active", usesPerDay: "3次/短休" },
      { level: 10, name: "伏魔掌", description: "徒手攻击对邪魔、亡灵和异怪额外造成2d8光耀伤害，且目标无法通过传送或变形逃脱", type: "passive" },
      { level: 14, name: "金刚不坏", description: "以反应动作进入金刚不坏状态1分钟，期间AC+4且免疫暴击和偷袭伤害", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "降魔真言", description: "以动作念出降魔真言，60尺内所有邪魔和亡灵必须通过感知豁免否则被驱散回原属位面", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "驱魔法印", description: "徒手攻击命中时可尝试驱散目标身上的一个法术效果", type: "active", usesPerDay: "2次/短休" },
          { name: "金刚拳劲", description: "徒手攻击伤害骰提升一级，重击时自动击退目标", type: "passive" },
          { name: "正气凛然", description: "对抗魅惑和恐惧的豁免检定获得+2加值", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "封魔掌", description: "命中施法者时封印其最高环法术位1回合无法使用", type: "active", usesPerDay: "1次/短休" },
          { name: "金刚怒目", description: "30尺内邪恶阵营生物对你攻击具有劣势", type: "passive" },
          { name: "业火焚魔", description: "对邪魔和亡灵徒手攻击额外造成2d8光耀伤害", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "丈六金身", description: "金刚不坏状态下可免疫一次致命伤害并回复半血", type: "passive" },
          { name: "降魔咒缚", description: "攻击命中后目标无法传送或变形逃脱，持续1分钟", type: "passive" },
        ],
      },
    ],
  },

  // ========== 吟游诗人子类职业 ==========

  // 音律大师 - 吟游诗人子职
  {
    id: "bard_sound_master",
    label: "吟游诗人·音律大师",
    description: "最擅长追踪与辨析的大神，雷达",
    minAttributes: { charisma: 16, wisdom: 16, dexterity: 14 },
    priorityAttributes: ["charisma", "wisdom", "dexterity"],
    skills: ["performance", "perception", "survival"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["dexterity", "charisma"],
    spellcaster: true,
    spellcastingType: "full",
    baseClassId: "bard",
    levelFeatures: [
      { level: 3,  name: "声纳探测", description: "以附赠动作释放声波探测500尺范围内的所有生物和物体，获得精确位置和大致体型信息", type: "active", usesPerDay: "感知调整值次/长休" },
      { level: 6,  name: "音波攻击", description: "以动作释放定向音波冲击，对单一目标造成4d8雷鸣伤害，目标必须通过体质豁免否则耳聋1分钟", type: "active", usesPerDay: "3次/短休" },
      { level: 10, name: "绝对音感", description: "获得对声音的超凡感知，无法被突袭，且可分辨1000尺内的任何声音来源", type: "passive" },
      { level: 14, name: "毁灭音域", description: "以动作演奏毁灭之音，30尺半径内所有敌人受6d10雷鸣伤害且被击退20尺", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 18, name: "万籁俱寂", description: "以动作创造绝对静音领域，60尺内所有声音法术失效，敌人无法施放需要语言成分的法术，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "超频声纳", description: "声纳探测范围提升至1000尺", type: "passive" },
          { name: "寂静领域", description: "创造15尺静音区，持续10分钟", type: "active", usesPerDay: "2次/长休" },
          { name: "魅惑之音", description: "音波命中附加魅惑，感知豁免DC13", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "共振爆破", description: "音波攻击对建筑和物件造成双倍伤害", type: "passive" },
          { name: "音障护体", description: "反应展开音障，AC+5应对一次攻击", type: "active", usesPerDay: "感知次/长休" },
          { name: "超音速刃", description: "音波化为近战音刃，攻击检定+2", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "毁灭乐章", description: "毁灭音域伤害骰提升至10d10", type: "passive" },
          { name: "寂静大师", description: "万籁俱寂范围扩大至120尺", type: "passive" },
        ],
      },
    ],
  },

  // ========== 术士子类职业 ==========

  // 邪焰术士 - 术士子职
  {
    id: "sorcerer_hellfire",
    label: "术士·邪焰术士",
    description: "擅长地狱黑炎的施法者，能将死气枯死的树木变成柴火，制造寸草不生的战场",
    minAttributes: { charisma: 16, intelligence: 14, constitution: 14 },
    priorityAttributes: ["charisma", "intelligence", "constitution"],
    skills: ["arcana", "intimidation", "survival"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["constitution", "charisma"],
    spellcaster: true,
    spellcastingType: "full",
    baseClassId: "sorcerer",
    levelFeatures: [
      { level: 3,  name: "邪焰术", description: "你的火焰法术转化为地狱黑炎，造成暗蚀伤害而非火焰伤害，可点燃死气枯木使其持续燃烧", type: "passive" },
      { level: 6,  name: "焦土战场", description: "以动作诅咒一片土地使其寸草不生，30尺半径内地面变为困难地形，敌人每回合受到2d6暗蚀伤害", type: "supernatural", usesPerDay: "2次/长休" },
      { level: 10, name: "死气汲取", description: "每当你对敌人造成暗蚀伤害，恢复伤害量一半的生命值", type: "passive" },
      { level: 14, name: "地狱火风暴", description: "以动作召唤地狱黑炎风暴，60尺半径内所有敌人受到10d6暗蚀伤害，且无法被治疗1分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "邪焰领主", description: "化为地狱黑炎化身1分钟，获得火焰和暗蚀伤害抗性，每回合开始对10尺内敌人造成2d8黯蚀伤害，火焰法术施法时间缩短为附赠动作（每回合限一次）", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "烈焰蔓延", description: "邪焰命中后每回合1d6黯蚀，持续3回合", type: "passive" },
          { name: "黑炎抗性", description: "获得火焰和黯蚀伤害抗性", type: "passive" },
          { name: "枯萎之触", description: "近战接触造成2d8黯蚀并吸取等量生命", type: "active", usesPerDay: "3次/长休" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "焦土扩张", description: "焦土战场半径扩大至60尺", type: "passive" },
          { name: "死气沸腾", description: "死气汲取回复量提升至伤害的75%", type: "passive" },
          { name: "邪焰余烬", description: "击杀后在尸体位置留下10尺邪焰区域", type: "passive" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "地狱火精通", description: "地狱火风暴伤害提升至12d6", type: "passive" },
          { name: "邪焰契约", description: "牺牲10HP，下一个邪焰法术免费瞬发", type: "active" },
        ],
      },
    ],
  },

  // 血族帝君 - 术士子职
  {
    id: "sorcerer_vampire_lord",
    label: "术士·血族帝君",
    description: "血族的帝君，灰烬之城的主人",
    minAttributes: { charisma: 18, intelligence: 16, wisdom: 14 },
    priorityAttributes: ["charisma", "intelligence", "wisdom"],
    skills: ["arcana", "persuasion", "deception"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["constitution", "charisma"],
    spellcaster: true,
    spellcastingType: "full",
    baseClassId: "sorcerer",
    levelFeatures: [
      { level: 3,  name: "血族之力", description: "获得吸血鬼的部分特性：黑暗视觉60尺、生命吸取攻击可恢复等同于伤害量的生命值", type: "supernatural" },
      { level: 6,  name: "血之领域", description: "以动作展开血之领域，30尺内所有活物每回合受到1d8暗蚀伤害，你恢复等量生命值", type: "supernatural", usesPerDay: "1次/短休" },
      { level: 10, name: "血裔转化", description: "以动作将一个自愿或失去意识的生物转化为血裔仆从，仆从拥有该生物的全部属性并服从你的命令", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 14, name: "灰烬之城", description: "以动作将战场幻化为灰烬之城，所有非血族生物移动减半且施法需要专注检定", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "血族帝君", description: "进化为完全体吸血鬼领主，获得飞行能力、再生特性（每回合恢复20生命值）、魅惑凝视", type: "supernatural" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "血族魅力", description: "魅惑类法术豁免DC+2", type: "passive" },
          { name: "蝙蝠化身", description: "附赠化为蝙蝠群，飞行速度60尺", type: "supernatural", usesPerDay: "2次/短休" },
          { name: "鲜血盛宴", description: "生命吸取额外恢复1d8生命值", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "血域扩张", description: "血之领域半径扩大至60尺", type: "passive" },
          { name: "雾化形态", description: "反应化为雾态，免疫一次物理攻击", type: "supernatural", usesPerDay: "1次/短休" },
          { name: "血族凝视", description: "动作凝视目标，感知豁免否则麻痹1回合", type: "active", usesPerDay: "3次/长休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "永夜君临", description: "灰烬之城中你的所有伤害+30%", type: "passive" },
          { name: "血裔大军", description: "可同时控制2名血裔仆从", type: "passive" },
        ],
      },
    ],
  },

  // ========== 其他特殊职业 ==========

  // 剑仙 - 双职业复合职业
  {
    id: "sword_immortal",
    label: "复合职业·剑仙",
    description: "武者与道士结合的复合职业，独一无二的隐藏职业",
    minAttributes: { strength: 16, dexterity: 16, wisdom: 14 },
    priorityAttributes: ["dexterity", "wisdom", "strength"],
    skills: ["swordsmanship", "arcana", "insight"],
    baseHp: 10,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "dexterity"],
    spellcaster: true,
    spellcastingType: "half",
    baseClassId: "monk",
    levelFeatures: [
      { level: 3,  name: "御剑术", description: "以附赠动作指挥飞剑在30尺内自动攻击敌人，使用你的敏捷调整值进行攻击和伤害掷骰", type: "active", usesPerDay: "感知调整值次/长休" },
      { level: 6,  name: "剑气纵横", description: "你的近战攻击可延伸至20尺，视作远程武器攻击但不承受远程攻击惩罚", type: "passive" },
      { level: 10, name: "御剑飞行", description: "以动作踏上飞剑获得60尺飞行速度，持续1小时，飞行期间可正常攻击", type: "supernatural", usesPerDay: "2次/长休" },
      { level: 14, name: "万剑归宗", description: "消耗3点气以动作召唤10把灵剑组成剑阵，每把灵剑每回合可攻击不同目标（攻击加值=感知调整值+熟练加值），造成1d8+感知调整值力场伤害，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "剑仙降世", description: "消耗5点气化身上古剑仙形态1分钟，获得60尺飞行速度、对非魔法物理伤害获得抗性，所有攻击附带额外5d8力场伤害", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "灵剑淬炼", description: "御剑术伤害骰由d6提升至d8，攻击检定+1", type: "passive" },
          { name: "护体剑气", description: "受到近战攻击时自动以剑气反伤1d8加感知调整值", type: "passive" },
          { name: "双剑合璧", description: "御剑术可同时操控两把飞剑攻击不同目标", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "剑阵守护", description: "以附赠动作展开剑阵护体，AC+2持续1分钟", type: "active", usesPerDay: "1次/短休" },
          { name: "诛仙剑气", description: "剑气攻击对邪恶生物额外造成2d6光耀伤害", type: "passive" },
          { name: "御空术", description: "以附赠动作传送至60尺内任意可见位置", type: "supernatural", usesPerDay: "2次/长休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "天剑诀", description: "万剑归宗召唤剑数提升至15把，剑阵持续时间翻倍", type: "passive" },
          { name: "剑心不灭", description: "死亡时以剑气重塑肉身复活，恢复一半生命值", type: "supernatural", usesPerDay: "1次/长休" },
        ],
      },
    ],
  },

  // 奇术师 - 法师子职
  {
    id: "wizard_occultist",
    label: "法师·奇术师",
    description: "精通奇门遁甲与秘仪之术的异术法师，擅用非常规手段克敌制胜",
    minAttributes: { intelligence: 16, charisma: 14, wisdom: 12 },
    priorityAttributes: ["intelligence", "charisma", "wisdom"],
    skills: ["arcana", "insight", "deception"],
    baseHp: 8,
    rulesets: ["dnd5e"],
    saveProficiencies: ["intelligence", "wisdom"],
    spellcaster: true,
    spellcastingType: "full",
    knownSpellsCount: 6,
    baseClassId: "wizard",
    levelFeatures: [
      { level: 3,  name: "奇门秘术", description: "学会三道奇门符咒（定身/封技/遁形），每道符咒可使用一次，需长休后恢复", type: "active", usesPerDay: "各1次/长休" },
      { level: 6,  name: "移形换位", description: "以反应与30尺内的一名生物瞬间交换位置，可用在受到攻击时规避伤害", type: "supernatural", usesPerDay: "2次/短休" },
      { level: 10, name: "禁咒结界", description: "以动作展开10尺半径结界，范围内禁止一切法术施展，持续1分钟，施法者每回合须通过智力豁免才能在结界外施法", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 14, name: "逆天改命", description: "在一次攻击、豁免或检定掷骰后发动，将结果反转（自然1变自然20，反之亦然），每天限一次", type: "supernatural", usesPerDay: "1次/长休" },
      { level: 18, name: "奇术·万象天罗", description: "以动作引动天象地脉，在60尺范围内创造持续1分钟的奇异领域，领域内所有规则由你定义（选择重力反转/时间迟缓/元素紊乱之一）", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "遁甲之术", description: "获得三种遁术任选其一（土遁、水遁、火遁），可在对应环境中瞬间消失", type: "active" },
          { name: "奇门八卦", description: "布置八卦阵，踏入阵中敌人受到随机负面效果（减速、混乱或沉默）", type: "active" },
          { name: "符咒精通", description: "每日可额外制作三道符咒，符咒种类库扩展至六种", type: "passive" },
        ]
      },
      {
        level: 8, pick: 1, options: [
          { name: "夺魂之术", description: "可尝试夺取敌人感官（视觉、听觉或嗅觉任选），持续至目标通过豁免", type: "active" },
          { name: "天机推演", description: "每日可预测一次未来事件结果，在关键检定时获得预言加值", type: "supernatural" },
          { name: "阵法大师", description: "可同时维持两个不同阵法效果，且阵法范围扩大一倍", type: "passive" },
        ]
      },
      {
        level: 12, pick: 1, options: [
          { name: "偷天换日", description: "可篡改一次因果，将刚刚发生的一个事件结果改写，每天限一次", type: "supernatural" },
          { name: "因果逆转", description: "受到的伤害转化为治疗直到你下回合开始，每天限一次持续1轮", type: "supernatural" },
          { name: "万象归宗", description: "领悟奇术终极奥义，所有符咒效果翻倍且可混合两种阵法产生新效果", type: "supernatural" },
        ]
      },
    ],
  },

  // 荣光戟手 - 战士子职
  {
    id: "fighter_glory_halberd",
    label: "战士·荣光戟手",
    description: "挥舞荣耀长戟的不屈斗士，战场上如旋风般横扫敌军，以一当百",
    minAttributes: { strength: 16, constitution: 14, dexterity: 14 },
    priorityAttributes: ["strength", "constitution", "dexterity"],
    skills: ["athletics", "intimidation", "tactics"],
    baseHp: 12,
    rulesets: ["dnd5e"],
    saveProficiencies: ["strength", "constitution"],
    baseClassId: "fighter",
    levelFeatures: [
      { level: 3,  name: "长戟精通", description: "使用长柄武器时攻击范围+5尺，且可对直线5尺内的两个相邻目标同时发动攻击", type: "passive" },
      { level: 6,  name: "旋风扫", description: "以动作旋转长戟，对自身周围10尺内所有敌人进行一次近战攻击，造成武器伤害+力量调整值", type: "active", usesPerDay: "3次/短休" },
      { level: 10, name: "不败意志", description: "生命值低于一半时获得+2AC和所有豁免优势，且每回合开始恢复5生命值", type: "supernatural" },
      { level: 14, name: "破阵冲锋", description: "以动作发起不可阻挡的冲锋，沿直线移动最多60尺，穿过路径上所有敌人并造成全额武器伤害", type: "active", usesPerDay: "1次/短休" },
      { level: 18, name: "荣光永耀", description: "以动作化身为战场上的荣耀化身，长戟延长至20尺且每命中一个敌人便获得10临时生命值，持续1分钟", type: "supernatural", usesPerDay: "1次/长休" }
    ],
    featChoices: [
      {
        level: 4, pick: 1, options: [
          { name: "横扫千军", description: "旋风扫伤害骰可额外附加一次力量调整值，且攻击范围扩大至15尺", type: "passive" },
          { name: "戟阵固守", description: "持长柄武器时获得+1AC且无法被推撞或击倒", type: "passive" },
          { name: "荣耀印记", description: "命中敌人后获得5临时HP，最多叠加至战士等级×3", type: "passive" },
        ],
      },
      {
        level: 8, pick: 1, options: [
          { name: "愈战愈勇", description: "不败意志触发阈值提升至HP低于最大生命值2/3时即生效", type: "passive" },
          { name: "回旋利刃", description: "每回合首次近战命中后可对5尺内另一敌人造成该次伤害的一半", type: "passive" },
          { name: "不屈战魂", description: "以附赠动作激荡战意，下回合无视任何控制效果且移动速度翻倍", type: "active", usesPerDay: "1次/短休" },
        ],
      },
      {
        level: 12, pick: 1, options: [
          { name: "破军之势", description: "破阵冲锋结束后可免费发动一次旋风扫，且该旋风扫伤害翻倍", type: "passive" },
          { name: "荣耀壁垒", description: "荣光永耀每次长休可启动3次，期间自身获得全伤害抗性", type: "passive" },
        ],
      },
    ],
  },
];

// ============================================================
// 三转传奇模板（20+ 满级后突破）
// ============================================================

/** 《乾坤》三转传奇模板 */
const QIANKUN_LEGENDARY_TEMPLATES: LegendaryTemplate[] = [
  // ── 神罚骑士 · 光之制裁者 ──
  {
    id: "legendary_divine_punisher",
    label: "光之制裁者",
    description: "铁蹄骑士团团长圣琼尼达到的英雄境界，光之箭与圣链的终极形态",
    appliesTo: ["paladin_divine_punisher"],
    prerequisites: { minLevel: 20, requiresSubclass: ["paladin_divine_punisher"] },
    epicFeature: { level: 18, name: "光之箭·异端公墓", description: "以动作召唤漫天光之箭雨，60尺半径内所有邪魔与不死生物受到12d10光耀伤害（感知豁免减半），同时对范围内盟友施加【圣链加护】：1分钟内免疫恐慌且AC+3", legendary: true },
    legendaryActions: [
      { name: "圣链加护", description: "以附赠动作将圣链缠绕30尺内一名盟友，使其受到的下一次伤害减半且获得等价临时生命值", cost: 1, type: "bonus_action", sceneLimit: "any" },
      { name: "光之箭·神罚", description: "以反应动作在敌人攻击命中前射出一支光之箭，使该攻击失手并对攻击者造成4d8光耀伤害", cost: 1, type: "reaction", sceneLimit: "combat" },
    ],
    legendaryResistance: 2,
    epicNarrative: "神罚骑士已突破凡人极限——其光之箭可贯穿位面壁垒，圣链可连接众生命运。举手投足间，圣光随行，邪魔辟易。",
  },

  // ── 龙炎霸者 · 龙神化身 ──
  {
    id: "legendary_dragon_fire",
    label: "龙神化身",
    description: "烈火雄心达到的三转极致，龙炎不灭体与双头剑『纵火者犄角』的完全解放",
    appliesTo: ["barbarian_dragon_fire"],
    prerequisites: { minLevel: 20, requiresSubclass: ["barbarian_dragon_fire"] },
    epicFeature: { level: 18, name: "龙神降临·不灭龙炎", description: "以动作化为远古龙神形态1分钟：获得100点临时生命值、免疫火焰伤害、龙息对90尺锥形造成16d10火焰伤害（敏捷豁免减半）、近战攻击附加4d8火焰伤害、每回合恢复10+体质调整值生命值", legendary: true },
    legendaryActions: [
      { name: "狂化·逆鳞", description: "以附赠动作进入狂化状态，本回合所有攻击造成双倍伤害，但受到伤害时承受1.5倍", cost: 1, type: "bonus_action", sceneLimit: "combat" },
      { name: "龙炎再生", description: "你受到伤害时，可以选择消耗一次传奇抗性立即恢复30点生命值", cost: 1, type: "reaction", sceneLimit: "combat" },
    ],
    legendaryResistance: 1,
    epicNarrative: "龙炎霸者已化为行走的天灾——其吐息能熔穿山岳，逆鳞之下无人可挡。纵火者犄角所及，皆为焦土。",
  },

  // ── 通武将军 · 武曲星君 ──
  {
    id: "legendary_martial_general",
    label: "武曲星君",
    description: "武曲星天命宿主战黄沙的三转形态，精通一切武器的终极武神",
    appliesTo: ["fighter_martial_general"],
    prerequisites: { minLevel: 20, requiresSubclass: ["fighter_martial_general"] },
    epicFeature: { level: 18, name: "武神降世·万武归宗", description: "以动作演武进入武神形态1分钟：全武器熟练+擅长重击、每回合可发动四次攻击、全豁免获得优势、所有攻击忽略目标的伤害抗性和减伤", legendary: true },
    legendaryActions: [
      { name: "武曲天命", description: "以反应动作重新投掷一次失败的攻击检定、技能检定或豁免（必须接受新结果）", cost: 1, type: "reaction", sceneLimit: "any" },
      { name: "万武归一", description: "以附赠动作更换手中武器为任意武器库中的装备，且该武器在接下来1分钟内被视为魔法武器", cost: 1, type: "bonus_action", sceneLimit: "any" },
    ],
    legendaryResistance: 2,
    epicNarrative: "武曲星照耀之下，通武将军即是武之化身——十八般兵器随心而发，天命加身，万夫莫敌。",
  },

  // ── 荣光戟手 · 太阳神代行者 ──
  {
    id: "legendary_glory_halberd",
    label: "太阳神代行者",
    description: "荣光戟手自由头等舱的三转形态，太阳神代行者的完全觉醒",
    appliesTo: ["fighter_glory_halberd"],
    prerequisites: { minLevel: 20, requiresSubclass: ["fighter_glory_halberd"] },
    epicFeature: { level: 18, name: "伊卡洛斯·太阳神降临", description: "以动作化身太阳神形态1分钟：获得120尺飞行速度、长戟变为炽焰形态每次攻击附带6d8光耀伤害+4d8火焰伤害、'伊卡洛斯'俯冲攻击造成16d10光耀伤害（对暗属性目标翻倍）、自身周围30尺绽放净化光环每回合对不死生物造成4d8光耀伤害", legendary: true },
    legendaryActions: [
      { name: "光之翼", description: "以附赠动作展开光之翼，瞬间移动至60尺内可见位置并使经过路径上的敌人受到2d8光耀伤害", cost: 1, type: "bonus_action", sceneLimit: "combat" },
      { name: "净化之焰", description: "以反应动作在被攻击时爆发太阳烈焰，使该攻击失手并对攻击者造成4d8光耀+4d8火焰伤害", cost: 1, type: "reaction", sceneLimit: "combat" },
    ],
    legendaryResistance: 2,
    epicNarrative: "太阳神代行者张开光之翼时，黑夜亦如白昼——长戟所过，邪魔灰飞烟灭。阳炎不熄，圣战不止。",
  },

  // ── 天刑剑仙 · 御剑飞仙 ──
  {
    id: "legendary_sword_immortal",
    label: "天刑剑仙",
    description: "华夏守护神御清锋的三转形态，飞剑巡视万里苍穹的天刑剑仙",
    appliesTo: ["sword_immortal"],
    prerequisites: { minLevel: 20, requiresSubclass: ["sword_immortal"] },
    epicFeature: { level: 18, name: "万剑归宗·天刑剑阵", description: "以动作展开天刑剑阵1分钟：召唤1000把灵剑形成剑域，每把灵剑自动攻击120尺内任意目标（攻击加值=感知调整值+熟练加值，伤害2d8+感知调整值力场伤害）；剑阵范围内所有敌对生物移动速度减半、传送无效；剑仙可在剑阵内任意位置瞬间移动", legendary: true },
    legendaryActions: [
      { name: "飞剑·巡视", description: "以附赠动作释放飞剑巡视整片战场（最远500尺），揭示所有隐藏目标和陷阱，飞剑返回时携带一道剑光对指定目标造成6d10力场伤害", cost: 1, type: "bonus_action", sceneLimit: "any" },
      { name: "剑匣·归宗", description: "以反应动作在受到致命伤害时解体为万道剑光，免疫本次伤害并瞬间移动至60尺外，每场战斗限一次", cost: 1, type: "reaction", sceneLimit: "combat" },
    ],
    legendaryResistance: 3,
    epicNarrative: "天刑剑仙御剑立于云端，万里山河尽收眼底。剑匣中万剑齐鸣，一念间可斩尽来犯之敌。护国神将，当如是。",
  },
];

/**
 * 获取所有《乾坤》三转传奇模板
 */
export function getAllQiankunLegendaryTemplates(): LegendaryTemplate[] {
  return [...QIANKUN_LEGENDARY_TEMPLATES];
}
