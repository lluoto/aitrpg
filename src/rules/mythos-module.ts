/**
 * 剧本杀式神话模组导入系统 — MythosModuleLoader
 * ============================================================
 *
 * 功能：将克苏鲁神话扩展数据打包为"剧本杀"模组，一键导入到游戏会话中。
 *
 * 使用方式：
 *   const loader = new MythosModuleLoader(session);
 *   loader.import(INSMOUTH_MODULE);
 *
 * 模组可以包含：
 *   - 法术注册（供典籍研读/施法）
 *   - 典籍放置（场景物品，可读可学）
 *   - 起始物品（场景物品）
 *   - NPC/生物（世界状态实体）
 *   - 激活条件（何时自动导入）
 *   - 触发叙事（导入时的KP旁白）
 *
 * 设计原则：
 *   - 惰性注册：法术只在模组导入时注册到 mythosSpells，不预加载
 *   - 确定查表：所有内容走数据表，不依赖LLM
 *   - 可叠放：多个模组可叠加导入，互不冲突
 */

import type { Database } from "bun:sqlite";
import type { MessageType, NPCMood } from "../agent/types";
import type { MythosCreature } from "./mythos-expansion";
import { MYTHOS_CREATURES } from "./mythos-expansion";
// 与 WorldStateManager 读 exits 用的是**同一份**解析（见该文件顶部说明）
import { parseExits, mergeExits } from "../state/scene-exits";

// ============================================================
// 模组类型定义
// ============================================================

/** 模组中需注册的法术 */
interface ModuleSpell {
  name: string;
  sanCost: string;
  mpCost: number;
  description: string;
  effectType?: string;
}

/** 模组中需放置的典籍 */
interface ModuleTome {
  name: string;
  /** 出现在哪个场景 */
  sceneId: string;
  /** SAN 损失格式 */
  sanCost: string;
  /** 典籍评级（用于 CM 技能成长计算） */
  tomeRating: number;
  /** 可教授的法术名列表 */
  spells: string[];
  /** 打开时的叙事文字 */
  openDescription: string;
}

/**
 * 模组结局定义 — 游戏结束条件与触发描述
 */
interface ModuleEnding {
  id: string;
  /** 结局名称（如 "Normal End"、"True End"） */
  name: string;
  /** 结局描述文本 */
  description: string;
  /** 触发条件文本（供 LLM KP 判断调查员行为是否匹配） */
  conditionText: string;
  /** 可选 — 激活该结局时触发的钩子/特殊旁白 */
  narration?: string;
}

/**
 * 模组奖励规则 — 根据调查员行为自动结算
 * 与 endings 独立：同一个结局可能触发多条奖励规则，不同结局也可能共享规则
 */
interface ModuleReward {
  id: string;
  description: string;
  /** 触发条件文本（供 LLM KP 判断是否满足） */
  conditionText: string;
  /** SAN 变化，如 "+d6"（回复）、"-d6"（削减）、"rescued*d3"（按变量计算） */
  sanChange?: string;
  /** CM 变化（正值为增长） */
  cmChange?: number;
  /** 信誉变化 */
  reputationChange?: number;
  /** 技能成长，如 { "斗殴": "d10", "侦查": "d10" } */
  skillGrowth?: Record<string, string>;
}

/** 模组中的物品放置 */
export interface ModuleItem {
  name: string;
  sceneId: string;
  description?: string;
}

/** 模组中的 NPC/生物 */
export interface ModuleNPC {
  id: string;
  name: string;
  type: "npc" | "monster";
  hp: number;
  maxHp: number;
  ac: number;
  faction: string;
  sceneId: string;
  tacticsKey?: string;
  /** 若指定，则从 mythos-expansion MYTHOS_CREATURES 取属性覆盖 hp/ac/str 等 */
  mythosCreatureId?: string;
  attributes?: Record<string, number>;
  /** CoC 技能列表（技能名 → 百分比），如 { "斗殴": 65, "侦查": 50, "克苏鲁": 20 } */
  skills?: Record<string, number>;

  // ── 人设元数据（供 KP 上下文注入，防止 LLM 臆造年龄/性别）──
  /** 年龄（模组原文权威值；缺失时以 personality.background 文本为准） */
  age?: number;
  /** 性别（模组原文权威值；缺失时以 personality.background 文本为准） */
  gender?: "male" | "female";

  // ── NPC 人格系统集成 ──
  /** 对话提示（供 LLM 生成对话） */
  dialogHints?: string[];
  /**
   * 引用 npcs.yaml 中定义的 NPC 人格（使用 NPC 名称匹配）
   * 设置后 module loader 将创建 NPCAgent 并注册到 GameSession
   */
  npcPersonalityId?: string;
  /**
   * 内联 NPC 人格定义（适用于模组专属NPC）
   * 当未指定 npcPersonalityId 或需要覆盖默认人格时使用
   */
  personality?: {
    role?: string;
    personality?: string;
    background?: string;
    goals?: string[];
    speech_style?: string;
    knowledge?: string[];
    secrets?: string[];
    attitudes?: Record<string, string>;
    traits?: {
      courage: number;
      friendliness: number;
      suspicion: number;
      curiosity: number;
      stability: number;
    };
    /**
     * 声明成 NPCMood 而不是 string。
     *
     * 写成 string 时这里放过了一个 "paranoid" —— NPCMood 没有这个取值。
     * 它经 NPCAgent.getMood() 原样流到消息上（实测 /history 里就是 paranoid），
     * 而下游按八个取值分派：语音层选不到音色，任何 switch 都会掉到 default。
     */
    initialMood?: NPCMood;
    factions?: Array<{ name: string; loyalty: number }>;
  };
}

/** 剧本杀模组 */
export interface MythosModule {
  /** 模组唯一标识 */
  id: string;
  /** 模组名 */
  name: string;
  /** 版本 */
  version: string;
  /** 简介 */
  description: string;
  /** 难度 */
  difficulty: "easy" | "medium" | "hard" | "nightmare";
  /** 原著出处 */
  source?: string;
  /** 模组激活方式 */
  activation: {
    type: "manual" | "location_enter" | "item_found" | "read_tome" | "san_threshold";
    /** 激活条件（如 location_enter 时为场景ID，item_found 时为物品名） */
    condition: string;
  };
  /** 场景出口映射（场景ID → 可到达的场景列表），覆盖全连接默认逻辑 */
  exits?: Record<string, Array<{ target: string; desc?: string }>>;
  /** 场景描述映射（场景ID → 描述文本），在 registerScene 时传入 */
  sceneDescriptions?: Record<string, string>;
  /**
   * 场景配乐映射（场景ID → 音轨标识）。
   *
   * 只存标识不存路径：路径拼装是前端的事，模组不该关心资源目录结构。
   * 缺省或找不到对应音频时前端静默不放，不影响任何叙事流程。
   */
  sceneBgm?: Record<string, string>;
  /** 模组激活时的KP旁白 */
  introNarration?: string;
  /** 注册到 mythosSpells 的法术 */
  spells?: ModuleSpell[];
  /** 放置在场景中的典籍 */
  tomes?: ModuleTome[];
  /** 放置在场景中的物品 */
  items?: ModuleItem[];
  /** 在世界中生成的NPC/生物 */
  npcs?: ModuleNPC[];
  /** 模组激活时的一些特殊状态变更 */
  initialEffects?: Array<{
    target: string;
    field: string;
    value: any;
  }>;

  // ── 调查线索 ──
  /** 注册到 investigation engine 的线索 */
  clues?: Array<{
    /** 关联场景名 */
    scene: string;
    /** 线索标识（需在 investigation.yaml 中有定义，或预先注册） */
    clueType: string;
    /** 线索描述 */
    description?: string;
    /** SAN 损失格式 "0/1d3" */
    sanCost?: string;
  }>;

  // ── 场景事件钩子 ──
  /**
   * 场景事件钩子 — 玩家触发特定条件时自动执行
   * type: 触发类型
   *   on_enter_scene: 进入场景时触发
   *   on_combat_start: 战斗开始时触发
   *   on_read_tome: 阅读特定典籍时触发
   *   on_investigate: 调查特定线索时触发
   * condition: 触发条件（场景名/典籍名/线索ID）
   * narration: KP 旁白文本
   * effect: 额外效果描述（非功能性，仅用于提示）
   */
  hooks?: Array<{
    type: "on_enter_scene" | "on_combat_start" | "on_read_tome" | "on_investigate";
    condition: string;
    narration?: string;
    effect?: string;
  }>;

  // ── 结局与奖励 ──
  /** 模组结局列表 */
  endings?: ModuleEnding[];
  /** 奖励规则列表（根据调查员行为触发的 SAN/CM/信誉/技能变化） */
  rewards?: ModuleReward[];

  // ── KP 灵活干涉指引（LLM KP 运行时查阅） ──
  /**
   * KP 灵活干涉指引：标记模块中哪些地方 KP（特别是 LLM KP）可以灵活调整。
   *
   * key 约定:
   *   "sceneName"         → 进入该场景时可用的指引
   *   "sceneName:detail"  → 场景内特定元素（NPC/物品/陷阱）的指引
   *   "__global__"        → 模块全局指引（开团准备、难度调整等）
   *   "__ending:type"     → 特定结局的条件/奖励说明
   *   "__npc:npcId"       → 针对特定 NPC 的扮演指引
   *
   * value: 自由文本，LLM 直接读取作为 KP 裁量依据。
   */
  kpNotes?: Record<string, string>;
}

// ============================================================
// 加载器
// ============================================================

/** 模组加载器需要的外部接口 — 最小依赖集合 */
export interface MythosModuleHost {
  mythosSpells: Map<string, { sanCost: string; mpCost: number; description: string; effect?: string }>;
  knownMythosSpells: string[];
  sceneItems: Map<string, string[]>;
  /** 物品描述映射（物品名 → 描述文本），与 sceneItems 共用物品名索引 */
  itemDescriptions: Map<string, string>;
  /** KP 灵活干涉指引（场景ID/特殊key → 指引文本），供 LLM KP 运行时读取 */
  kpNotes?: Map<string, string>;
  /** 模块奖励规则（奖励ID → ModuleReward），LLM KP 在游戏结束时结算 */
  moduleRewards?: Map<string, ModuleReward>;
  world: {
    upsertEntity(entity: {
      id: string;
      name: string;
      type: "npc" | "monster";
      hp: number;
      maxHp: number;
      ac: number;
      status: string[];
      position: string;
      faction: string;
      scene_id?: string;
      attributes?: Record<string, number>;
      skills?: Record<string, number>;
    }): void;
    logEvent?(params: { round: number; timestamp: number; event_type: string; actor: string; description: string }): void;
    /**
     * 构建模组场景出口时要直接读写 scenes 表。
     * 这个依赖以前只靠 (host.world as any).getDatabase() 存在，契约里查不到，
     * 宿主换成窄适配器就会在运行时变成 undefined。这里明确声明出来。
     * 纯内存宿主（如测试 mock）可以不提供，加载器会跳过出口连接。
     */
    getDatabase?(): Database;
  };
  /**
   * 宿主只需要 verbatim 与 mood 这两项；可见性是会话概念，模组不关心，
   * 由宿主适配器补默认值。
   */
  addMessage(
    speaker: string,
    content: string,
    type: MessageType,
    opts?: { verbatim?: boolean; mood?: NPCMood }
  ): void;
  activeRuleset?: string;
  currentRound?: number;

  // ── NPC 人格注册 ──
  /**
   * 注册 NPC 人格到 NPC Agent 系统
   * @param npcName NPC 在游戏世界中的实体名（与 upsertEntity 的 name 一致）
   * @param personality 内联人格定义
   * @param npcPersonalityId 可选，引用 npcs.yaml 中的人格
   */
  registerNPCPersonality?(npcName: string, personality: ModuleNPC["personality"], npcPersonalityId?: string): void;

  // ── 调查系统 ──
  /** 注册调查线索到指定场景 */
  registerSceneClue?(sceneName: string, clueType: string, description?: string, sanCost?: string): void;

  // ── 场景事件钩子 ──
  /**
   * 注册模组事件钩子
   * 当玩家触发特定条件时，系统自动执行钩子动作
   */
  registerHook?(hook: {
    type: "on_enter_scene" | "on_combat_start" | "on_read_tome" | "on_investigate";
    condition: string;
    narration?: string;
    effect?: string;
  }): void;

  // ── 场景注册 ──
  /**
   * 向世界注册一个场景
   * 模组中可以定义模组专属场景，通过此方法暴露给世界系统
   */
  registerScene?(sceneId: string, displayName: string, description?: string): void;
}

// ============================================================
// 神话生物 stat 集成 — 供 combat 读取
// ============================================================

/** 所有神话生物按名字索引的 stat 映射（name → MythosCreature） */
export const MYTHOS_CREATURE_MAP: Map<string, MythosCreature> = new Map(
  MYTHOS_CREATURES.map(c => [c.name, c])
);

/** 按 tacticsKey / yaml id 索引的映射 */
export const MYTHOS_CREATURE_BY_ID: Map<string, MythosCreature> = new Map(
  MYTHOS_CREATURES.map(c => [c.id, c])
);

/**
 * 从 MYTHOS_CREATURES 创建标准 WorldEntity 数据
 * @param creatureIdOrName 生物 id（如 "deep_one"）或中文名（如 "深潜者"）
 * @param sceneId 放置场景
 * @param customFaction 可选阵营，默认自动推断
 */
export function createMythosEntity(
  creatureIdOrName: string,
  sceneId: string,
  customFaction?: string
): {
  id: string;
  name: string;
  type: "monster";
  hp: number;
  maxHp: number;
  ac: number;
  status: string[];
  position: string;
  faction: string;
  scene_id: string;
  stats: MythosCreature;
} {
  const creature =
    MYTHOS_CREATURE_BY_ID.get(creatureIdOrName) ??
    MYTHOS_CREATURE_MAP.get(creatureIdOrName);

  if (!creature) {
    throw new Error(`神话生物 "${creatureIdOrName}" 未找到。可用: ${Array.from(MYTHOS_CREATURE_BY_ID.keys()).join(", ")}`);
  }

  const ts = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    id: `${creature.id}_${ts}`,
    name: creature.name,
    type: "monster",
    hp: creature.hp,
    maxHp: creature.maxHp,
    ac: creature.ac,
    status: [],
    position: sceneId,
    faction: customFaction ?? "神话生物",
    scene_id: sceneId,
    stats: creature,
  };
}

export class MythosModuleLoader {
  private host: MythosModuleHost;
  /** 已导入的模组ID集合（防止重复导入） */
  private imported: Set<string> = new Set();

  constructor(host: MythosModuleHost) {
    this.host = host;
  }

  /** 已导入的模组ID列表 */
  get importedModules(): string[] {
    return Array.from(this.imported);
  }

  /** 是否已导入某模组 */
  isImported(moduleId: string): boolean {
    return this.imported.has(moduleId);
  }

  /**
   * 导入一个模组
   * @returns 导入结果描述
   */
  import(module: MythosModule): string[] {
    const lines: string[] = [];

    if (this.imported.has(module.id)) {
      lines.push(`模组「${module.name}」已导入，跳过。`);
      return lines;
    }

    this.imported.add(module.id);
    lines.push(`【剧本杀模组：${module.name}】`);
    lines.push(`难度：${module.difficulty} | ${module.description}`);

    // 0. 注册模组场景 —— 白名单按"来源"判定，不是按字符串长得像不像地点：
    //    地点是被声明（sceneDescriptions）/被引用（NPC、物品、典籍、线索的
    //    sceneId）/被出口连接（module.exits 的 key 与 target）的东西。
    //
    //    ⚠ 曾经这里还加了一条 `if (h.condition) referencedScenes.add(h.condition)`
    //    —— hook 的 condition 是"触发条件"，从来就不是地点，但被无条件当场景
    //    注册了。谷仓模组实测：22 个真场景硬是被灌成了 39 个，混进去的 17 条
    //    里有「主要_npc」「结局」「可选」这种一眼是从文档小标题抽取管线里
    //    漏进来的东西。移动候选池（game-session.ts 的模糊场景匹配）取的是
    //    全量已注册场景，于是「查看餐桌、披萨盒」能被判定送到「可能的敌人类」。
    //    hook 的 narration 仍然有用（是 lore，下面第 6 步单独注册），只是不该
    //    让它顺带造出一个可移动到的地点。
    const referencedScenes = new Set<string>();
    if (module.npcs) for (const n of module.npcs) if (n.sceneId && n.sceneId !== "unknown") referencedScenes.add(n.sceneId);
    if (module.items) for (const it of module.items) if (it.sceneId && it.sceneId !== "unknown") referencedScenes.add(it.sceneId);
    if (module.tomes) for (const t of module.tomes) if (t.sceneId && t.sceneId !== "unknown") referencedScenes.add(t.sceneId);
    if (module.clues) for (const c of module.clues) if (c.scene && c.scene !== "unknown") referencedScenes.add(c.scene);
    if (module.sceneDescriptions) for (const sid of Object.keys(module.sceneDescriptions)) referencedScenes.add(sid);
    if (module.exits) for (const [sid, list] of Object.entries(module.exits)) {
      referencedScenes.add(sid);
      for (const e of list) referencedScenes.add(e.target);
    }
    let sceneCount = 0;
    // 场景注册到 DB — 无描述，handleMovement 会自动根据 NPC 位置生成"在场的还有"
    if (this.host.registerScene) {
      for (const sid of referencedScenes) {
        const desc = module.sceneDescriptions?.[sid];
        this.host.registerScene(sid, sid, desc);
        sceneCount++;
      }
    }
    if (sceneCount > 0) lines.push(`注册 ${sceneCount} 个模组场景`);

    // ── 构建模组场景出口连接 ──
    try {
      const getDb = this.host.world.getDatabase;
      if (!getDb) throw new Error("宿主未提供数据库能力，无法连接场景出口");
      const db = getDb.call(this.host.world);
      if (module.exits) {
        // 使用模组定义的显式出口
        let exitCount = 0;
        for (const [sceneId, exitList] of Object.entries(module.exits)) {
          const currentRow: any = db.query("SELECT exits FROM scenes WHERE id = ?").get(sceneId);
          // ⚠ 原写法是 `try { existing.push(...JSON.parse(row.exits ?? "[]")) } catch {}`，
          // 解析失败时 `existing` 保持空、**接着照样把 merged 写回去** ——
          // 这个场景原有的出口就被静默抹掉了，catch 里一个字都没有。
          // §八 记的正是这类：「模组场景出口整段失效」而测试全绿。
          // 现在读不出来就**放弃覆盖**，保住原数据，并把这件事说出来。
          const parsed = parseExits(currentRow?.exits);
          if (!parsed.ok) {
            lines.push(`⚠️ 场景「${sceneId}」原有出口读不出来（${parsed.reason}），已跳过合并以免覆盖`);
            continue;
          }
          const deduped = mergeExits(
            parsed.exits,
            exitList.map(e => ({ target: e.target, desc: e.desc ?? e.target })),
          );
          db.run("UPDATE scenes SET exits = ? WHERE id = ?", [JSON.stringify(deduped), sceneId]);
          exitCount += exitList.length;
        }
        lines.push(`构建 ${exitCount} 条模组场景显式出口`);
      } else {
        // 默认：物理场景全连接（向后兼容）
        const physicalScenes = new Set<string>();
        if (module.npcs) for (const n of module.npcs) if (n.sceneId && n.sceneId !== "unknown") physicalScenes.add(n.sceneId);
        if (module.items) for (const it of module.items) if (it.sceneId && it.sceneId !== "unknown") physicalScenes.add(it.sceneId);
        if (module.tomes) for (const t of module.tomes) if (t.sceneId && t.sceneId !== "unknown") physicalScenes.add(t.sceneId);
        const sceneArr = [...physicalScenes];
        if (sceneArr.length > 1) {
          const exitObjs = sceneArr.map(sid => ({ target: sid, desc: sid }));
          for (const sid of sceneArr) {
            const others = exitObjs.filter(o => o.target !== sid);
            db.run("UPDATE scenes SET exits = ? WHERE id = ?", [JSON.stringify(others), sid]);
          }
          // 入口场景加上模组场景出口
          const activeRow: any = db.query("SELECT id FROM scenes WHERE is_active = 1 LIMIT 1").get();
          const entryScene: string | undefined = activeRow?.id;
          if (entryScene && entryScene !== "unknown" && !sceneArr.includes(entryScene)) {
            const existingRow: any = db.query("SELECT exits FROM scenes WHERE id = ?").get(entryScene);
            // 与上面同一个道理：读不干净就别覆盖。入口场景的出口被抹掉，
            // 后果是开局那一步无路可走，而没有任何一处会报错。
            const parsed = parseExits(existingRow?.exits);
            if (!parsed.ok) {
              lines.push(`⚠️ 入口场景「${entryScene}」原有出口读不出来（${parsed.reason}），已跳过合并以免覆盖`);
            } else {
              const deduped = mergeExits(parsed.exits, exitObjs);
              db.run("UPDATE scenes SET exits = ? WHERE id = ?", [JSON.stringify(deduped), entryScene]);
            }
          }
          lines.push(`构建 ${sceneArr.length} 个模组场景出口`);
        }
      }
    } catch (e: any) {
      lines.push(`⚠️ 场景出口连接失败: ${e.message}`);
    }

    // 1. 注册法术
    let spellCount = 0;
    if (module.spells) {
      for (const s of module.spells) {
        if (!this.host.mythosSpells.has(s.name)) {
          this.host.mythosSpells.set(s.name, {
            sanCost: s.sanCost,
            mpCost: s.mpCost,
            description: s.description,
            effect: s.effectType,
          });
          spellCount++;
        }
      }
    }
    if (spellCount > 0) lines.push(`注册 ${spellCount} 个神话法术`);

    // 2. 放置典籍
    let tomeCount = 0;
    if (module.tomes) {
      for (const t of module.tomes) {
        const items = this.host.sceneItems.get(t.sceneId) ?? [];
        if (!items.includes(t.name)) {
          items.push(t.name);
          this.host.sceneItems.set(t.sceneId, items);
          tomeCount++;
        }
      }
    }
    if (tomeCount > 0) lines.push(`放置 ${tomeCount} 本典籍`);

    // 3. 放置物品
    let itemCount = 0;
    if (module.items) {
      for (const it of module.items) {
        const items = this.host.sceneItems.get(it.sceneId) ?? [];
        if (!items.includes(it.name)) {
          items.push(it.name);
          this.host.sceneItems.set(it.sceneId, items);
          // 物品描述
          if (it.description) {
            this.host.itemDescriptions.set(it.name, it.description);
          }
          itemCount++;
        }
      }
    }
    if (itemCount > 0) lines.push(`放置 ${itemCount} 件物品`);

    // 4. 生成 NPC/生物（支持引用 mythos-expansion 的生物属性）
    let npcCount = 0;
    if (module.npcs) {
      for (const n of module.npcs) {
        // 如果指定了 mythosCreatureId，用生物属性覆盖基础值
        let entityHp = n.hp;
        let entityMaxHp = n.maxHp;
        let entityAc = n.ac;
        let entityFaction = n.faction;

        if (n.mythosCreatureId) {
          const creatureStats = MYTHOS_CREATURE_BY_ID.get(n.mythosCreatureId) ?? MYTHOS_CREATURE_MAP.get(n.mythosCreatureId);
          if (creatureStats) {
            entityHp = creatureStats.hp;
            entityMaxHp = creatureStats.maxHp;
            entityAc = creatureStats.ac;
            entityFaction = entityFaction === "神话生物" ? creatureStats.name : entityFaction;
          }
        }

        this.host.world.upsertEntity({
          id: n.id,
          name: n.name,
          type: n.type,
          hp: entityHp,
          maxHp: entityMaxHp,
          ac: entityAc,
          status: [],
          position: n.sceneId,
          faction: entityFaction,
          scene_id: n.sceneId,
          attributes: n.attributes ?? {},
          skills: n.skills ?? {},
        });

        // NPC 人格注册（内联 personality 或 npcPersonalityId 引用）
        if (this.host.registerNPCPersonality && (n.personality || n.npcPersonalityId)) {
          // 合并 root-level 的 background/goals/secrets 到 personality，兼容两种写法
          const p = n.personality ?? {} as NonNullable<ModuleNPC["personality"]>;
          const enrichedPersonality = {
            ...p,
            background: p.background || (n as any).background || "",
            goals: p.goals || (n as any).goals || [],
            secrets: p.secrets || (n as any).secrets || [],
          };
          this.host.registerNPCPersonality(n.name, enrichedPersonality, n.npcPersonalityId);
        }

        npcCount++;
      }
    }
    if (npcCount > 0) lines.push(`生成 ${npcCount} 个 NPC/生物（含 mythos 属性同步）`);

    // 5. 场景调查线索注册
    let clueCount = 0;
    if (module.clues && this.host.registerSceneClue) {
      for (const c of module.clues) {
        // sanCost 必须一起传：模组每条线索都写了它，而调查判定要靠它决定
        // 发现这条线索损失多少理智。此前签名里没有这个参数，值在边界被丢弃。
        this.host.registerSceneClue(c.scene, c.clueType, c.description, c.sanCost);
        clueCount++;
      }
    }
    if (clueCount > 0) lines.push(`注册 ${clueCount} 条调查线索`);

    // 6. 场景事件钩子
    let hookCount = 0;
    if (module.hooks && this.host.registerHook) {
      for (const h of module.hooks) {
        this.host.registerHook(h);
        hookCount++;
      }
    }
    if (hookCount > 0) lines.push(`注册 ${hookCount} 个场景事件钩子`);

    // 7. 模组叙事
    if (module.introNarration) {
      // 模组开场白按跑团惯例逐字朗读，不经 LLM 改写 —— 标记出来，
      // 使前端与后续语音路由能区分「照读原文」与「KP 即兴叙述」。
      this.host.addMessage("KP", module.introNarration, "narration", { verbatim: true });
    }

    // 8. 初始状态变更
    if (module.initialEffects) {
      // 预留：未来支持对世界状态的特殊修改
      lines.push(`应用 ${module.initialEffects.length} 项初始状态变更`);
    }

    // 9. KP 灵活干涉指引（供 LLM KP 运行时查阅）
    if (module.kpNotes) {
      if (!this.host.kpNotes) this.host.kpNotes = new Map();
      for (const [key, note] of Object.entries(module.kpNotes)) {
        this.host.kpNotes.set(key, note);
      }
      lines.push(`加载 ${Object.keys(module.kpNotes).length} 条 KP 灵活干涉指引`);
    }

    // ⚠ 这里曾经有一段"结局注册"：把 module.endings 逐条写进
    // this.host.moduleEndings（一个 Map）。删掉的原因是那个 Map 从建出来
    // 那天起就没有任何读者——GameSession 这条自由跑团路径压根没有"判定
    // 结局"这回事（那是另一轮的范围），"写但没人读"的注册表正是本仓
    // 反复吃过亏的"认出来了，没地方放"。module.endings 本身没有被删——
    // 它仍然是 MythosModule 数据的一部分（conditionText 是给人/LLM 读的
    // 展示文本，见 ModuleEnding 类型定义），只是本轮不再把它复制进一个
    // 谁都不查的 Map。真要用它时，先接上读者，再决定要不要重新登记。

    // 11. 奖励规则注册
    if (module.rewards) {
      if (!this.host.moduleRewards) this.host.moduleRewards = new Map();
      for (const r of module.rewards) {
        this.host.moduleRewards.set(r.id, r);
      }
      lines.push(`注册 ${module.rewards.length} 条奖励规则`);
    }

    this.host.addMessage("系统", `剧本杀模组「${module.name}」已加载`, "system");

    return lines;
  }

  /**
   * 检查激活条件并自动导入匹配的模组
   * @param modules 候选模组列表
   * @param eventType 当前事件类型
   * @param eventValue 当前事件值（如进入的场景ID、发现的物品名等）
   */
  autoActivate(
    modules: MythosModule[],
    eventType: string,
    eventValue: string
  ): string[] {
    const results: string[] = [];
    for (const mod of modules) {
      if (this.imported.has(mod.id)) continue;
      if (mod.activation.type === eventType && mod.activation.condition === eventValue) {
        const lines = this.import(mod);
        results.push(...lines);
      }
    }
    return results;
  }
}

// ============================================================
// 预打包模组
// ============================================================

/**
 * 印斯茅斯模组 — 基于《印斯茅斯的阴霾》
 * 玩家进入印斯茅斯码头区域时自动激活
 */
export const INNSMOUTH_MODULE: MythosModule = {
  id: "innsmouth_shadow",
  name: "印斯茅斯的阴霾",
  version: "1.0",
  description: "马萨诸塞州海岸线上被诅咒的渔港，居民与深海邪神达成了血腥交易。",
  difficulty: "hard",
  source: "《印斯茅斯的阴霾》(The Shadow Over Innsmouth, H.P. Lovecraft, 1936)",
  activation: {
    type: "location_enter",
    condition: "innsmouth_docks",
  },
  sceneBgm: {
    innsmouth_docks: "coast",
    innsmouth_reef: "coast",
    innsmouth_church: "sacred",
  },
  introNarration:
    "铅灰色的海面在冬日低垂的云层下无尽延伸。腐烂的木质栈桥伸向海中，" +
    "空气中弥漫着鱼腥和腐败盐渍的刺鼻气味。远处的礁石上，有什么东西在潮湿的雾中发出反光。" +
    "你注意到镇上的人们有着不寻常的面容——过于凸出的眼睛、过于扁平的鼻子、粗糙发灰的皮肤。" +
    "当你走过时，他们的目光追随你，但他们不笑，也不说话。欢迎来到印斯茅斯。",
  spells: [
    {
      name: "接触大衮",
      sanCost: "1d4/1d8",
      mpCost: 6,
      description: "在海岸边吟诵古老的大衮祷文，尝试与深潜者的父神建立精神联系。",
      effectType: "other",
    },
  ],
  tomes: [
    {
      name: "扎多克的低语",
      sceneId: "innsmouth_docks",
      sanCost: "1/1d4",
      tomeRating: 4,
      spells: ["接触大衮"],
      openDescription:
        "老酒鬼扎多克·艾伦颤抖着塞给你几张皱巴巴的纸片，上面是他用颤抖的手写下的证词——" +
        "关于1846年的「海军条约」、关于大衮教团的真相、关于魔鬼礁下的城市伊哈斯莱……",
    },
  ],
  items: [
    { name: "大衮教团徽章", sceneId: "innsmouth_church", description: "一枚刻有扭曲鱼形图案的铜质徽章" },
    { name: "旧日印戒", sceneId: "innsmouth_reef", description: "一枚在礁石间发现的古老戒指，戒面上刻有无法辨认的铭文" },
  ],
  clues: [
    { scene: "innsmouth_docks",  clueType: "strange_fish_market", description: "码头鱼市场的渔获中有带着鳞片的人类肢体",              sanCost: "0/1" },
    { scene: "innsmouth_church", clueType: "dagon_shrine",        description: "教堂暗格中发现大衮神龛和血迹斑斑的祭坛",             sanCost: "1/1d3" },
    { scene: "innsmouth_reef",   clueType: "submerged_ruins",     description: "退潮时礁石间浮现出海底城市的轮廓——伊哈斯莱",        sanCost: "1/1d4" },
  ],
  hooks: [
    { type: "on_enter_scene", condition: "innsmouth_docks",  narration: "你注意到码头上晾晒的渔网中夹杂着奇怪的海藻——它们呈现出血红色，微微摆动仿佛有生命。",       effect: "获得线索：血色海藻" },
    { type: "on_enter_scene", condition: "innsmouth_church", narration: "教堂深处传来低沉的吟唱声，不像人类语言——那是大衮教团的晚祷。你感到一阵无法抑制的恐惧。",      effect: "SAN -0/1" },
    { type: "on_read_tome",   condition: "扎多克的低语",     narration: "当你读到「伊哈斯莱」这个名字时，脑海深处响起一声低语……不是你记忆中的语言，但你理解了它的含义：深潜者的城市。", effect: "获得线索：伊哈斯莱" },
  ],
  npcs: [
    {
      id: "zadok_allen",
      name: "扎多克·艾伦",
      type: "npc",
      hp: 8,
      maxHp: 8,
      ac: 10,
      faction: "恐惧的知情者",
      sceneId: "innsmouth_docks",
      personality: {
        role: "恐惧的知情者",
        personality: "满脑子恐惧的醉酒老水手",
        background: "年轻时曾是远洋船员，见证了1846年海军条约的真相。多年来靠酒精压抑记忆。",
        goals: ["向愿意倾听的人说出真相"],
        speech_style: "醉酒颤抖、语无伦次、急切地想告诉你些什么",
        knowledge: ["印斯茅斯历史", "大衮教团", "1846年条约"],
        secrets: ["他自己也流淌着深潜者的血脉——他的曾祖母不是人类"],
        traits: { courage: 3, friendliness: 6, suspicion: 7, curiosity: 5, stability: 2 },
        // 原写 "paranoid"：他的核心是恐惧而非怀疑，role 就叫「恐惧的知情者」。
        // 多疑那一面由 suspicion: 7 承载，不需要再挤进情绪字段。
        initialMood: "fearful",
      },
    },
    {
      id: "deep_one_scout",
      name: "潜伏的生物",
      type: "monster",
      hp: 15,
      maxHp: 15,
      ac: 13,
      faction: "深潜者",
      sceneId: "innsmouth_reef",
    },
    {
      id: "high_priest",
      name: "教团大祭司",
      type: "npc",
      hp: 14,
      maxHp: 14,
      ac: 12,
      faction: "大衮教团",
      sceneId: "innsmouth_church",
      personality: {
        role: "大衮教团领袖",
        personality: "狂热的深海崇拜者，外表与常人无异但内心已完全非人",
        background: "代代相传的教团领袖家族，面容已经开始显现深潜者的特征。",
        goals: ["保护教团秘密", "完成深潜者的血祭仪式", "转化更多的镇民"],
        speech_style: "庄严而阴森，夹杂着旧约式的预言腔调",
        knowledge: ["大衮仪式", "深潜者历史", "伊哈斯莱"],
        secrets: ["教团正在准备一场大规模的血祭以迎接大衮的降临"],
        attitudes: { "外来者": "敌意", "扎多克·艾伦": "叛徒必须被清除" },
        traits: { courage: 8, friendliness: 2, suspicion: 9, curiosity: 4, stability: 7 },
        // 原写 "hostile"：人格描述明说「常年警惕但不主动攻击」，
        // 敌意是立场不是情绪，用 suspicious 才对得上「警惕」；
        // angry 会让他一上场就像已经动了手。
        initialMood: "suspicious",
      },
    },
  ],
};

/**
 * 阿卡姆模组 — 基于密斯卡托尼克大学设定
 * 玩家进入大学图书馆时自动激活
 */
export const ARKHAM_LIBRARY_MODULE: MythosModule = {
  id: "arkham_miskatonic",
  name: "密斯卡托尼克之秘",
  version: "1.0",
  description: "阿卡姆的密斯卡托尼克大学图书馆收藏着禁忌的知识——但知识有代价。",
  difficulty: "easy",
  source: "多篇洛夫克拉夫特作品中的阿卡姆设定",
  activation: {
    type: "location_enter",
    condition: "arkham_miskatonic",
  },
  sceneBgm: {
    arkham_miskatonic: "library",
    arkham_library_vault: "library",
    arkham_library_basement: "underground",
  },
  introNarration:
    "密斯卡托尼克大学图书馆的大厅弥漫着旧书和皮革的混合气味。" +
    "高大的拱形窗户让午后的阳光在飘浮的灰尘中形成一道道可见的光柱。" +
    "前台一位戴着半月形眼镜的老年馆员抬起头，透过镜片打量着你。" +
    "「需要帮助吗，年轻人？」他的声音像旧书页一样干燥。",
  spells: [
    {
      name: "阿卡姆档案检索",
      sanCost: "0/1d2",
      mpCost: 1,
      description: "利用密斯卡托尼克大学的档案系统，找到一份关于超自然事件的记录。",
      effectType: "perception",
    },
  ],
  tomes: [
    {
      name: "塞拉伊诺断章",
      sceneId: "arkham_library_vault",
      sanCost: "1d3/1d8",
      tomeRating: 8,
      spells: ["接触远古者", "克苏鲁之拳", "绿色腐败", "放逐术"],
      openDescription:
        "金属薄片上刻有发光的楔形文字，触碰时皮肤有轻微的电击感。文字在你眼前扭动，重组为可读的图景……",
    },
  ],
  items: [
    { name: "特别书库借阅证", sceneId: "arkham_miskatonic", description: "一张泛黄的借阅证，带有阿米蒂奇馆长的签名" },
    { name: "沃德家族档案", sceneId: "arkham_library_basement", description: "关于查尔斯·德克斯特·沃德案件的密封档案" },
  ],
  clues: [
    { scene: "arkham_miskatonic",     clueType: "restricted_section", description: "特别书库暗格里藏着一本用人类皮肤装订的日记",          sanCost: "1/1d3" },
    { scene: "arkham_library_vault",  clueType: "elder_sign_tablet",  description: "保险库深处发现一块刻有旧印的石板，语言不属于任何已知文明", sanCost: "0/1d2" },
    { scene: "arkham_library_basement", clueType: "ward_papers",      description: "沃德档案中记载了一次失败的死者复活仪式",             sanCost: "1/1d4" },
  ],
  hooks: [
    { type: "on_enter_scene", condition: "arkham_library_vault",    narration: "保险库的铁门在身后自动关闭——不是锁住，而是一种沉重的、令人窒息的隔绝。灯光闪烁了一下，然后恢复了正常。", effect: "触发恐惧检定" },
    { type: "on_read_tome",   condition: "塞拉伊诺断章",            narration: "金属薄片开始发热，你手心的皮肤传来灼烧般的刺痛。古老的文字在你脑海中排列成一种超越人类语言的结构——你理解了，但你不属于这种理解。", effect: "克苏鲁神话 +2%" },
  ],
  npcs: [
    {
      id: "librarian_armitage",
      name: "阿米蒂奇馆长",
      type: "npc",
      hp: 10,
      maxHp: 10,
      ac: 10,
      faction: "学者",
      sceneId: "arkham_miskatonic",
      personality: {
        role: "密斯卡托尼克大学图书馆馆长",
        personality: "年迈但思维敏锐的学者，守护着图书馆的超自然藏书",
        background: "曾在密大学习人类学，1920年代的一次埃及考古发掘后开始接触超自然文献。",
        goals: ["保护学生免受禁忌知识伤害", "确保特别书库的安全"],
        speech_style: "礼貌而含蓄，用词考究，经常停顿以选择合适的词汇",
        knowledge: ["密斯卡托尼克大学历史", "特别书库分类系统", "基本的旧印知识"],
        secrets: ["他自己也读过塞拉伊诺断章——虽然只看了三行"],
        attitudes: { "超自然研究者": "谨慎的帮助", "外来者": "职业性的礼貌" },
        traits: { courage: 6, friendliness: 7, suspicion: 8, curiosity: 9, stability: 5 },
        initialMood: "calm",
      },
    },
  ],
};

export const PREMIERS_BARN_MODULE: MythosModule = {
  id: "premiers_barn",
  name: "普瑞米尔的谷仓",
  version: "1.03",
  description:
    "1921年，美国小镇普瑞米尔。17岁青年加比·特里坎失踪半月，" +
    "其母菲碧重金委托调查员寻找儿子下落。",
  difficulty: "easy",
  source: "MikuFan 原创模组《普瑞米尔的谷仓 ver1.03》(COC7th)",
  activation: {
    type: "manual",
    condition: "premiers_barn",
  },
  // 本文件内的 premiers_barn 用 ASCII 场景 id；custom-modules/premiers_barn.ts
  // 是同一模组的详版，用中文场景 id。两套 id 各自映射，互不干扰。
  sceneBgm: {
    premiers_barn: "dread",
    premiers_sewer: "underground",
    tricam_house: "domestic",
    gabis_trailer: "domestic",
  },
  introNarration:
    "1921年的普瑞米尔笼罩在早春的薄雾中。铁轨把小镇切成两半，" +
    "北边是整洁的居民区和商业街，南边则是一片被遗忘的工业废墟。" +
    "空气中混杂着铁锈和泥土的气味。你手中握着一份报纸，" +
    "上面刊登着一则寻人委托——一位母亲悬赏重金寻找她失踪半月的17岁儿子。",
  spells: [
    {
      name: "接触米-戈",
      sanCost: "1d3/1d6",
      mpCost: 8,
      description:
        "吟诵从一战遗迹中发现的古老笔记上的咒文，尝试与犹格斯真菌（米-戈）建立联系。" +
        "施法者必须在一个空旷的场所朗诵咒文，米-戈将在1d4轮内出现。",
      effectType: "summon",
    },
  ],
  tomes: [
    {
      name: "疯子的呓语——一战遗迹联络术笔记",
      sceneId: "premiers_barn",
      sanCost: "1/1d4",
      tomeRating: 6,
      spells: ["接触米-戈"],
      openDescription:
        "一本沾满污渍的旧笔记本，纸张已经发黄变脆。笔记详细描述了一种联络" +
        "「犹格斯真菌」的仪式——一种据称可以拯救致命伤病者的外星存在。",
    },
  ],
  items: [
    { name: "加比的照片", sceneId: "tricam_house", description: "打扮另类的憔悴青年" },
    { name: "染血的衣物", sceneId: "premiers_barn", description: "谷仓角落的染血衣物" },
    { name: "艾德里安的日记", sceneId: "premiers_barn", description: "记录绑架过程的日记本" },
    { name: "脑罐", sceneId: "premiers_sewer", description: "米-戈容器，维持大脑存活" },
  ],
  clues: [
    { scene: "tricam_house", clueType: "missing_person", description: "寻人委托——加比·特里坎失踪半月" },
    { scene: "gabis_trailer", clueType: "departure_clue", description: "加比走得匆忙，留下字条「明晚 老地方——A.E.」" },
    { scene: "premiers_barn", clueType: "barn_hideout", description: "7名被囚者（5人生存），谷仓下暗藏下水道入口", sanCost: "1/1d6" },
    { scene: "premiers_barn", clueType: "victim_log", description: "艾德里安记录：10名受害者，3人死亡" },
    { scene: "premiers_sewer", clueType: "mi_go_lair", description: "米-戈神殿，脑罐，非人类脚印", sanCost: "1/1d8" },
    // 开发·摄取管线校准 阶段3：这条原来写的是"艾米丽的脑罐揭示真相：
    // 被米-戈欺骗"——两处都不对。被米-戈直接欺骗的是艾德里安，不是
    // 艾米丽（她是被艾德里安瞒着的那一个）；脑罐本身也不会"揭示"任何
    // 事——艾米丽自己都不知道自己是缸中脑，见 three-way-audit.ts 的
    // 语义矛盾记录。改成如实描述这个物件与它带出的处境，不再让它替
    // 剧情"说话"。
    { scene: "premiers_sewer", clueType: "truth_revealed", description: "艾米丽的脑罐：她的意识仍然清醒，却完全不知道自己早已只剩一颗漂浮在营养液里的大脑——这场骗局的源头是米-戈骗了艾德里安，而艾德里安又瞒着她", sanCost: "1d2/1d6" },
  ],
  hooks: [
    { type: "on_enter_scene", condition: "tricam_house", narration: "小女孩在篮球场拍球，屋内是焦虑的母亲。", effect: "获得线索" },
    { type: "on_enter_scene", condition: "gabis_trailer", narration: "拖车房狼藉，衣柜半开，贵重物品未带走。", effect: "获得线索" },
    { type: "on_enter_scene", condition: "premiers_barn", narration: "腐败甜腻气味——7具人体支架，5人存活。", effect: "SAN检定" },
    { type: "on_enter_scene", condition: "premiers_sewer", narration: "冷光中的脑罐，电极闪烁。", effect: "SAN检定" },
  ],
  npcs: [
    {
      id: "phoebe_tricam", name: "菲碧·特里坎", type: "npc",
      hp: 9, maxHp: 9, ac: 10, faction: "委托方", sceneId: "tricam_house",
      personality: {
        role: "失踪青年的母亲",
        personality: "坚强但焦虑的职业女性",
        background: "42岁银行职员，丈夫去世，独自抚养一儿一女。不相信警方，刊登委托。",
        goals: ["找到加比", "保护小女儿米尔"],
        speech_style: "礼貌急切",
        knowledge: ["加比人际关系", "本地情况"],
        secrets: ["加比知道父亲生前的赌债"],
        traits: { courage: 7, friendliness: 7, suspicion: 5, curiosity: 6, stability: 6 },
        // 原写 "anxious_hopeful"：女儿失踪的母亲，焦虑压过抱有希望的那一面。
        // 「坚强」由 courage: 7 承载。
        initialMood: "fearful",
      },
    },
    {
      id: "mier_tricam", name: "米尔·特里坎", type: "npc",
      hp: 8, maxHp: 8, ac: 10, faction: "普通居民", sceneId: "tricam_house",
      personality: {
        role: "菲碧的幼女", personality: "天真好奇",
        background: "5岁，最后一次见哥哥是半个月前的夜晚，他穿着严实提着黑袋子离开。",
        goals: ["和哥哥玩"],
        speech_style: "童言无忌",
        traits: { courage: 4, friendliness: 8, suspicion: 3, curiosity: 9, stability: 5 },
        // 原写 "playful"：八个取值里最接近的是 friendly，而她的 friendliness 本就是 8。
        // 「好奇活泼」由 curiosity: 9 承载。
        initialMood: "friendly",
      },
    },
    {
      id: "adrian_estrom", name: "艾德里安·埃斯特鲁姆", type: "npc",
      hp: 6, maxHp: 6, ac: 8, faction: "前教授（瘫痪）", sceneId: "premiers_barn",
      personality: {
        role: "悲剧反派",
        personality: "被爱和绝望驱使的学者",
        background: "生物学教授，妻难产濒死，使用一战遗迹笔记召唤米-戈，被欺骗后绑架10人。第11次时与警交火弹片击中头部导致瘫痪。",
        goals: ["让妻女复活"],
        speech_style: "无法说话",
        // 开发·三档约束 阶段7：原文写的是"完全没有意识到自己完全是被利用了"
        // （section_01:15-18），这条曾经写反了——"意识到被米-戈欺骗"直接与
        // 原文和 barn-of-premier.ts True End 第2行（"艾德里安直到瘫痪在病床
        // 上，都没有意识到自己不过是被利用的工具"）矛盾。secrets 会原样注入
        // NPC Agent 的系统提示（npc-agent.ts:43「你的秘密（绝不主动透露）」），
        // 不只是数据错误——写反了会让扮演艾德里安的 LLM 表现得像个知情者，
        // 是可玩性缺陷。
        secrets: ["坚信米-戈会兑现承诺救回妻女，至今没有意识到自己不过是被利用的工具"],
        traits: { courage: 3, friendliness: 2, suspicion: 8, curiosity: 5, stability: 1 },
        // 原写 "paralyzed_terrified"：恐惧的程度由 stability: 1 表达，
        // 情绪字段只需要说清是哪一种情绪。
        initialMood: "fearful",
      },
    },
    {
      id: "mi_go_premier", name: "米-戈", type: "monster",
      hp: 12, maxHp: 12, ac: 14, faction: "神话生物", sceneId: "premiers_sewer",
      mythosCreatureId: "mi_go",
      personality: {
        role: "外星交易者",
        personality: "非人类思维，对道德无理解",
        goals: ["收集人类大脑"],
        speech_style: "通过脑罐文字交流",
        secrets: ["从未打算帮助艾德里安"],
        traits: { courage: 15, friendliness: 1, suspicion: 12, curiosity: 10, stability: 18 },
        // 原写 "alien_calm"：「异星」是它的身份而非情绪，情绪就是 calm，
        // 非人感由 friendliness: 1 与 stability: 18 表达。
        initialMood: "calm",
      },
    },
  ],
  initialEffects: [
    { target: "premiers_barn", field: "traps_active", value: true },
  ],
};
