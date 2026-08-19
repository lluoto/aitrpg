// 模组数据核心类型定义
// 用于将原始模组 PDF 文本解析为结构化数据

/** 模组数据顶层结构 */
export interface ModuleData {
  id: string;
  title: string;
  version: string;
  ruleset: "cosmic-horror";
  era: string;
  summary: string;
  scenes: Scene[];
  npcs: ModuleNPC[];
  /** 全局元信息 */
  meta: {
    author?: string;
    playerCount: string;
    expectedDuration: string;
    triggerWarnings: string[];
    /** 未来扩展：BGM 提示 */
    bgmHints?: Record<string, string>;
  };
  /** 结局定义 */
  endings: Ending[];
  /** 模组中的可交互物品 */
  items: ModuleItem[];
  /** 导入叙事 */
  prologue?: PrologueEntry;
  /** 团队聚合信息 — 每个调查员独立如何卷入 */
  partySetup?: PartySetup;
  /** 后日谈条目 */
  epilogues?: EpilogueEntry[];
  /** 叙事层：场景/线索之外的"能被提起、也能被望见"的东西 */
  narrative?: {
    entities: NarrativeEntity[];
  };
  /**
   * 生成溯源 —— 读取阶段对原文做过的每一次改写。
   *
   * 运行模组是生成物，不是手稿：读取模块会补数值、改写泄底的描述、
   * 用世界模型约束修掉不合理处。没有这份记录，模组数据就成了黑盒，
   * 出问题时无从判断到底是原文如此，还是生成阶段擅自改的。
   */
  provenance?: Provenance[];
}

/** 一条改写记录：原文、结果、理由，三者缺一不可 */
export interface Provenance {
  /** 被改写的字段路径，如 "items[3].trap.damage" */
  path: string;
  /** 原文片段 */
  source: string;
  /**
   * 原文位置。摄取管线给的形态是 `p9:L13`（PDF 页号 + 页内行号），
   * 由 sectionize 的 sourceKey() 产出。
   *
   * 别和 `raw/section_09.txt:L42` 那种写法混着用 —— 后者指的是 raw 切片文件，
   * 而切片是派生物且不进版本库，PDF 才是权威源。
   */
  sourceRef?: string;
  /** 改写结果 */
  result: string;
  /** 为什么改 */
  reason: string;
  /** 谁改的：确定性规则 / LLM / 人工 */
  by: "rule" | "llm" | "human";
  /** 若由世界模型约束触发，记下命中的约束 ID */
  constraintId?: string;
}

/**
 * 叙事实体 —— 一件在场景描述里已经写到、但要等对话点破才有意义的东西。
 *
 * 典型：特里坎家院子一旁那座拖车房。调查员进院子时就看见了（模组原文有写），
 * 但它只是"一座拖车房"；等菲碧说出"加比十五岁就搬到外面拖车住了"，
 * 那座拖车才变成"失踪男孩的房间"——调查员会自己扭头看过去。
 *
 * 所以它有两个互不相同的单调状态位，谁也不能替代谁：
 *   已引入(introduced) —— 被 NPC 台词提起过；
 *   已识别(recognized) —— 识别桥段已经演过，不再重演。
 * 可见性(visible)不存状态，由当前场景的 visibleEntities 现算 —— 走开就看不见了，
 * 这是会来回变的量，存下来必然和实际所在地失同步。
 */
export interface NarrativeEntity {
  id: string;
  /** 叙事里怎么称呼它（"那座拖车房"） */
  name: string;
  /** NPC 台词里出现任一词即视为"被提起" */
  mentionKeywords: string[];
  /** 它对应的场景 ID（识别之后调查员就知道该往哪走） */
  sceneId?: string;
  /**
   * 什么习惯的调查员会自发看过去：匹配调查员职业名（含即命中，如 "侦探"）。
   * 沿用 llmExpanded.mentionReactions 既有的职业触发约定。留空 = 任何调查员都会注意到。
   */
  noticedBy?: string[];
  /** 识别桥段正文，{name} 替换为那位调查员的名字 */
  recognition: string;
}

/**
 * 陷阱机制 —— 模组原文里写死的可结算数值。
 *
 * 在此之前这些数字只存在于 ModuleItem.description 的散文里，引擎读不到，
 * 于是人工抄进 play-module.ts 硬编码一份。两份各走各的：模组改了引擎不会红，
 * 而且一个场景里只有被抄中的那个陷阱是活的，其余全是死数据。
 *
 * 声明成结构体之后，"模组特殊规则"这一层（DESIGN-LOG §1 优先级最高的一层）
 * 才第一次对物理后果真正有内容——此前它只有物品与对话两个文本域。
 */
export interface TrapMechanics {
  /** 伤害骰，CoC 表达式（如 "1D4+1"）。省略 = 不造成伤害 */
  damage?: string;
  /**
   * 触发瞬间的躲避检定：成功则完全不受影响。
   *
   * 与 escape 是两件事，不能合并——霰弹枪拌锁是"来得及闪开就没事"，
   * 捕兽夹是"已经咬住了，现在要掰开"。合成一个字段就会把
   * 「躲过了」和「挣脱了」写成同一句话。
   */
  avoid?: {
    skill: string;
    difficulty: "regular" | "hard" | "extreme";
  };
  /** 已经中招后的挣脱检定。省略 = 无需挣脱 */
  escape?: {
    /** 属性或技能名（如 "力量"） */
    skill: string;
    difficulty: "regular" | "hard" | "extreme";
    /** 大失败时的额外伤害骰 */
    fumbleDamage?: string;
  };
  /** 未挣脱期间的持续伤害 */
  ongoing?: {
    /** 每回合伤害骰 */
    damage: string;
    /** 停止条件（叙事描述，供旁白使用） */
    until: string;
  };
  /**
   * SAN 消耗，CoC 的「成功损失/失败损失」格式（如 "0/1d3"）。
   *
   * 不是所有陷阱都靠伤害起作用。音响陷阱原文写着它已经失效，
   * 但紧接着留了个口子：KP 仍可以用突然的巨响判 sc0/1d3。
   * 只认伤害的话，这类陷阱会被整个判成"无机制"。
   */
  sanCost?: string;
  /** 急救方式（叙事性说明；引擎目前不结算，写下来是为了旁白不必现编） */
  firstAid?: string;
  /**
   * 事先发现即可规避：已找到此线索则该陷阱不再触发。
   *
   * 这是原先 ModuleSupport.trapClueId 承担的语义——侦查成功就不会踩中。
   * 把它挪到陷阱自己身上，是因为一个场景里的多个陷阱本就该各有各的发现方式：
   * 看见地上的铁齿不等于也看见了门后拌着的绳子。
   */
  detectedByClue?: string;
  /**
   * 体型免疫阈值：SIZ 严格小于此值则不触发。省略 = 无免疫。
   * 模组常只给结论不给理由，理由属于推断——写进 inferred，别混进数据。
   */
  sizImmunityBelow?: number;
  /** 单次伤害超过最大 HP 的此比例即致残（0–1）。省略 = 不致残 */
  maimAtHpRatio?: number;
  /** 触发时的叙事 */
  triggerNarration?: string;
  /** 因体型免疫而未触发时的叙事 */
  immuneNarration?: string;
  /**
   * 模组原文未写、由读取阶段推断出来的字段名。
   *
   * 留着是为了让"这是原文如此"和"这是我们补的"永远分得开：
   * 校对的人只需看这一行，就知道哪些值不能拿去反推模组作者的意图。
   */
  inferred?: string[];
}

/** 模组中的可拾取/可交互物品 */
export interface ModuleItem {
  id: string;
  name: string;
  /** 所在场景 ID */
  sceneId: string;
  description: string;
  /** 物品类型 */
  type: "key" | "document" | "weapon" | "loot" | "trap";
  /** 拾取/交互后的揭示文本 */
  revelation?: string;
  /** 物品属性（武器用） */
  properties?: Record<string, string | number>;
  /** 陷阱结算数值（仅 type="trap"）。缺省 = 该陷阱纯叙事，不结算 */
  trap?: TrapMechanics;
}

/** 场景 */
export interface Scene {
  id: string;
  name: string;
  /**
   * 建议游玩顺序。可选：现有模组数据都没写，且仓库内没有任何代码读取它，
   * 声明成必填只会逼着每个场景补一个没人消费的数字。
   */
  order?: number;
  description: string; // KP 用的场景描述
  /** 场景中的可交互线索 */
  clues: Clue[];
  /** 此场景中出现的 NPC */
  npcIds: string[];
  /**
   * 站在此场景里能望见的叙事实体 ID（ModuleData.narrative.entities）。
   * 与 npcIds 同一形状：场景自己声明"这里有什么"。
   */
  visibleEntities?: string[];
  /** 此场景需要的技能检定 */
  skillChecks?: SkillCheckHint[];
  /** 连接到其他场景 */
  connections: SceneConnection[];
  /** 场景特有事件触发器 */
  events?: SceneEvent[];
  /** 环境描述（KP 提示） */
  atmosphere?: string;
  /** 玩家可见的开场氛围描写：打印在场景描述之后、NPC 出场之前（首次到访时） */
  openingAtmosphere?: string;
  /** 私宅场景：NPC 首次见面时引擎自动插入"进屋坐下"过渡（建立叙事节奏） */
  isHome?: boolean;
  /**
   * 剧情状态变量（模组特有结构化状态，DESIGN-LOG §2）：
   * 如 { gateUnlocked: false, generatorOff: false }——引擎负责读写，LLM 旁白只读取。
   * 初始值在此声明；运行时由线索 setStateVar / 引擎逻辑修改。
   */
  stateVars?: Record<string, boolean | string>;
  /** 未来发展：BGM 提示 */
  bgmHint?: string;
  /** 未来发展：图像生成提示 */
  imageHint?: string;
}

/** 线索 */
export interface Clue {
  id: string;
  name: string;
  description: string;
  /** 找到线索的方法 */
  findMethods: FindMethod[];
  /** 找到后的揭示文本 */
  revelation: string;
  /** 解锁的新线索 ID 列表 */
  unlocks: string[];
  /** 线索是否被找到 */
  found: boolean;
  /** 线索的优先级（影响 NPC 是否主动提示） */
  importance: "core" | "bonus" | "color";
  /** 叙事描述性提示（替代元信息线索列表，给玩家的隐晦提示） */
  hint?: string;
  /**
   * 失败兜底（Gumshoe 原则：关键线索最终必得，失败只换代价）：
   * 连续检定失败达到 maxFails 次后强制发现该线索，但附带叙事代价。
   * 未设置 = 无兜底（保持原失败即丢失行为）。
   */
  failback?: {
    /** 连续失败触发兜底的次数阈值（默认 2） */
    maxFails?: number;
    /** 兜底触发时是否进行 SAN 检定，CoC 成本格式 "成功损失/失败损失"（如 "0/1d3"） */
    sanCost?: string;
    /** 兜底触发时的揭示文本（替代原 revelation，叙事"历经周折终于找到"） */
    fallbackRevelation?: string;
  };
  /**
   * 找到该线索时自动写入的剧情状态（如找到扳手 → 场景状态变量 valveOpen: true）。
   * 引擎在 discoverClue 时写入，LLM 旁白随后可读取该事实。
   */
  setStateVar?: { key: string; value: boolean | string };
}

/** 寻找线索的方法 */
export interface FindMethod {
  type: "skill" | "observation" | "npc_dialogue" | "item" | "automatic";
  /** 技能名（如果是 skill 类型） */
  skillName?: string;
  /** 难度 */
  difficulty?: "regular" | "hard" | "extreme";
  /** 描述 */
  description: string;
}

/** 场景连接 */
export interface SceneConnection {
  targetSceneId: string;
  /** 解锁条件描述 */
  condition: string;
  /** 自动解锁的条件（如：找到某个关键线索后） */
  requiredClueId?: string;
  /** 是否需要技能检定才能发现这个连接 */
  checkRequired?: { skill: string; difficulty: "regular" | "hard" | "extreme" };
}

/** 建议的技能检定 */
export interface SkillCheckHint {
  skill: string;
  difficulty: "regular" | "hard" | "extreme";
  purpose: string;
}

/** 场景事件触发器 */
export interface SceneEvent {
  trigger: "time" | "action" | "clue_found" | "scene_entry";
  /** 触发描述 */
  description: string;
  /** 触发延迟（回合数，仅 time 类型） */
  delayRounds?: number;
  /** 触发结果 */
  outcome: string;
}

/** 模组中的 NPC 定义 */
export interface ModuleNPC {
  id: string;
  name: string;
  role: string;
  description: string;
  /**
   * 出场描写（可选）：叙事口吻的"当下动作"，用于场景内多 NPC 之间的过渡衔接。
   * 模板 fallback 优先使用它，避免直接念 description 数据稿
   * （如"在调查员来的时候会在篮球场玩球"是设定态，不是主持人口吻）。
   */
  entrance?: string;
  personality: {
    traits: string[];
    speech: string;
    attitude: string;
  };
  /** NPC 知道的信息（纯素材——引擎使用 llmExpanded 渲染） */
  knowledge: string[];
  /** NPC 隐藏的秘密 */
  secrets: string[];
  /** NPC 在当前场景中的位置 */
  sceneId: string;
  /**
   * 年龄。模组数据一直在写，世界模型也用它做年龄相关的行为门控
   * （world-model-integrator 对 7 岁以下 / 18 岁以下有分支），
   * 但此前未声明，导致读取方只能写 (npc as any).age。
   */
  age?: number;
  /** 行为触发器 */
  behaviors?: NPCBehavior[];
  /** LLM预生成的自然对话扩展。不为空时代替模板链 */
  llmExpanded?: {
    firstEncounter: string;
    knowledgeReveals: string[];
    revisitEncounter?: string;
    /** 基于玩家背景/职业的提及反应：当 PL 的 occupation 匹配 trigger 时触发 */
    mentionReactions?: Array<{
      trigger: string;    // 职业关键词（如 "侦探"），大小写不敏感匹配
      reaction: string;   // NPC 反应文本，{name} 替换为匹配的角色名
    }>;
    /**
     * knowledgeReveals 的可见条件。
     * 引擎在 revealNpcKnowledge 中检查条件，跳过不满足的 reveal。
     * 不设置 = 总是可见。
     */
    revealConditions?: Array<{
      /** 对应 knowledgeReveals 的索引 */
      index: number;
      /** 必须已找到所有以下线索才能可见 */
      requiresClue?: string[];
      /** 只要找到以下任一线索就不可见（用于分支回避） */
      blocksClue?: string[];
    }>;
  };
  /** 未来发展：NPC 立绘 prompt */
  portraitHint?: string;
  /** 未来发展：NPC 语音提示 */
  voiceHint?: string;
}

/** NPC 行为规则 */
export interface NPCBehavior {
  trigger: "player_approach" | "clue_found" | "combat_start" | "time" | "specific_action";
  /** 触发详情 */
  detail?: string;
  /** 行为描述 */
  action: string;
}

/** 结局定义 */
export interface Ending {
  id: string;
  name: string;
  description: string;
  conditions: string[];
  sanReward?: string;
  cmReward?: number;
}

/** 后日谈条目 — 条件驱动的游戏终盘叙事补完 */
export interface EpilogueEntry {
  id: string;
  title?: string;
  condition: {
    requiredClues?: string[];
    excludeClues?: string[];
    requiredScenes?: string[];
  };
  lines: string[];
}

/** 结局叙事 — 引擎根据世界状态匹配的结局（id + 触发条件 + 叙事段） */
export interface EndNarration {
  id: string;
  condition: {
    /** 必须已发现的线索 ID 列表（AND） */
    requiredClues: string[];
    /** 必须尚未发现的线索 ID 列表（AND） */
    excludeClues?: string[];
    /** 必须访问过的场景 ID 列表（AND） */
    requiredScenes?: string[];
  };
  /** 叙事文本段，逐段输出 */
  lines: string[];
}

/** 遭遇战叙事 — 场景内战斗遭遇定义（触发条件 + 胜负叙事） */
export interface EncounterNarration {
  /** 触发场景 ID */
  sceneId: string;
  /** 必须已触发的线索 */
  requiredClue: string;
  /** 必须尚未触发的线索（阻止重复） */
  excludedClue: string;
  /** 遭遇初始描述 */
  encounterLines: string[];
  /** 战斗胜利叙事 */
  victoryLines: string[];
  /** 战斗失败叙事 */
  defeatLines: string[];
  /** 敌人显示名（用于战斗标题/HP 栏等 UI，如 "米-戈"） */
  enemyName?: string;
  /** 胜利时发现的线索 ID（供后续结局/后日谈引用，如 "clue_migo_defeated"） */
  victoryClueId?: string;
  /** 打跑但未杀死（敌人受伤逃跑）时的叙事 */
  fledLines?: string[];
}

/** 调查员角色卡配置 — 引擎按此创建 PC */
export interface ModulePlayerSetup {
  /** 显示全名（如 "亨利·摩根"） */
  name: string;
  /** 战斗/检定叙事中的短名（如 "亨利"） */
  shortName: string;
  /** CoC 职业原型 ID（如 "detective"） */
  archetypeId: string;
  /** 职业显示名（如 "私家侦探"） */
  occupation: string;
  /** 性格 */
  personality: string;
  /** 背景 */
  background: string;
  /** 个人目标 */
  motive: string;
}

/**
 * 模组运行支持配置 — 引擎需要的模组专属钩子/常量。
 * ModuleData 是纯数据（场景/线索/NPC），此处承载引擎运行所需的
 * 模块专属逻辑与常量（SAN 映射、结局评估、战斗遭遇、枢纽/终局定位等）。
 */
export interface ModuleSupport {
  /** 恐怖线索 → SAN 成本映射（clue id → "成功损失/失败损失"） */
  traumaticClues: Record<string, string>;
  /** 结局评估：根据世界状态返回匹配的结局叙事（模块专属逻辑） */
  evaluateEnding: (
    isClueFound: (id: string) => boolean,
    isSceneVisited: (id: string) => boolean,
  ) => EndNarration | null;
  /** 结局显示标签（ending id → 标题） */
  endLabels: Record<string, string>;
  /** 遭遇战定义（场景内战斗轮） */
  encounters: EncounterNarration[];
  /** 移动排序的枢纽场景 ID（回镇上重分派） */
  hubSceneId: string;
  /** 终局触发场景 ID（叙事高潮，进入后渲染即结束） */
  finaleSceneId: string;
  /** 终局触发线索 ID（进入 finale 场景需已发现） */
  finaleClueId: string;
  /** BOSS NPC id 匹配（战斗目标识别，如 /mi[_-]?go/i） */
  bossNpcIdPattern: RegExp;
  // 原先这里有 trapSceneId / trapClueId 一对单数常量，指定"哪个场景有陷阱"。
  // 已删除：陷阱现在是 ModuleItem.trap 结构化数据，按 sceneId 挂载，一个场景可以有多个。
  // 留着这对字段只会诱导新模组继续走"引擎里硬编码一个陷阱"的老路。
  /**
   * 调查员配置（按顺序创建 PC）。可选：模组运行器已改为自行随机生成调查员
   * （见 play-module「模块 players 配置仅作为人设/兜底参考，不再写死身份」），
   * 现有模组都没有提供它，仓库内也没有任何读取方。
   */
  players?: ModulePlayerSetup[];
}

/** 导入叙事 — 模块作者编写的开场白，插槽填入角色信息 */
export interface PrologueEntry {
  lines: string[];
}

/** 团队聚合 — 每个调查员的独立卷入方式，无主客关系 */
export interface PartySetup {
  /** 开场情境（时代/地点/案由） */
  context: string[];
  /** 每个调查员的卷入方式，按 PL 顺序渲染。{name} {occupation} 槽位。 */
  hooks: string[];
  /** 合流后的收束 */
  closing?: string[];
}

/** 模块状态快照（运行时） */
export interface ModuleState {
  currentSceneId: string;
  discoveredClues: Set<string>;
  triggeredEvents: Set<string>;
  npcStates: Map<string, NPCInstanceState>;
  sceneHistory: string[];
  currentRound: number;
  /** 各场景剧情状态变量（运行时值，覆盖 Scene.stateVars 初始声明；未声明的变量也可由线索写入） */
  sceneStateVars: Map<string, Record<string, boolean | string>>;
  /** 已被 NPC 台词提起过的叙事实体（单调，只增不减） */
  introducedEntities: Set<string>;
  /** 识别桥段已经演过的叙事实体（单调，用于保证只演一次） */
  recognizedEntities: Set<string>;
}

/** NPC 运行时状态 */
export interface NPCInstanceState {
  locationSceneId: string;
  mood: string;
  relationship: number; // -5 to +5
  isAlive: boolean;
  isConscious: boolean;
  knownByPlayers: boolean;
}
