// NPC 战斗决策引擎 — 状态机驱动，确定性地选择行为
// 输入：NPC实体 + 世界状态 + 规则集
// 输出：ActionIntent（与玩家统一的接口，走同一条律书判定管线）

import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import type { ActionIntent, WorldState, WorldEntity } from "../types";
import type { WorldStateManager } from "../state/world-state-manager";
import { inferGrailRank } from "../rules/grail-engine";

// ============================================================
// YAML 配置类型
// ============================================================

interface CreatureConfig {
  tactics?: string;
  engagement?: string;
  target_priority?: string[];
  flee_when_hp_below?: number;
  morale?: string;
  abilities?: string[];
  [key: string]: any;
}

interface RulesetConfig {
  ruleset: string;
  default: any;
  creatures?: Record<string, CreatureConfig>;
  cr_tactics?: Record<string, any>;
  ranks?: Record<string, any>;
  tier_suppression?: any;
  morale?: any;
  action_weights?: Record<string, number>;
}

// ============================================================
// 决策引擎
// ============================================================

export class NPCCombatEngine {
  private configs: Map<string, RulesetConfig> = new Map();

  constructor() {
    this.loadConfig("dnd5e", "./src/combat/dnd-npc.yaml");
    this.loadConfig("cosmic-horror", "./src/combat/coc-npc.yaml");
    this.loadConfig("grail", "./src/combat/grail-npc.yaml");
  }

  private loadConfig(ruleset: string, path: string) {
    const raw = readFileSync(path, "utf-8");
    this.configs.set(ruleset, parseYaml(raw) as RulesetConfig);
  }

  /**
   * 为 NPC 决定本轮战斗行动
   * @param npc NPC 实体
   * @param world 世界状态管理器
   * @param ruleset 规则集："dnd5e" | "cosmic-horror" | "grail"
   * @returns ActionIntent，如果 NPC 不行动（逃跑/投降/无目标）返回 null
   */
  decide(
    npc: WorldEntity,
    world: WorldStateManager,
    ruleset: string
  ): ActionIntent | null {
    const config = this.configs.get(ruleset);
    if (!config) return null;

    const state = world.getCurrentState();

    // Step 1: 检查 NPC 是否还能行动
    if (npc.hp <= 0 || npc.status.includes("dead")) return null;
    if (npc.status.includes("paralyzed") || npc.status.includes("unconscious")) return null;

    // Step 2: 获取该 NPC 的配置（特定生物 > CR段位 > 默认）
    const creatureCfg = this.getCreatureConfig(npc, config);

    // Step 3: 检查逃跑条件
    if (this.shouldFlee(npc, creatureCfg, state)) return null; // null = 逃跑

    // Step 4: 选择目标
    const target = this.selectTarget(npc, creatureCfg, state);
    if (!target) return null; // 无可攻击目标

    // Step 5: 选择行动
    const action = this.selectAction(npc, creatureCfg, target, state, config, ruleset);

    // Step 6: 偏转
    // 让 intent 路径更丰富——一个 "faction_relation" 的 action 可以
    // 触发更具体的 intent（偷袭、偷袭、精准打击等）：
    const intent: ActionIntent = {
      action: action.type,
      target: target.id,
      weapon: action.weapon || this.pickWeapon(npc, ruleset),
      method: action.method,
      skill: action.skill,
    };

    return intent;
  }

  // ==========================================================
  // 配置解析
  // ==========================================================

  private getCreatureConfig(npc: WorldEntity, config: RulesetConfig): CreatureConfig {
    // 优先精确匹配 creature name（小写比较）
    const nameLower = npc.name.toLowerCase();
    if (config.creatures) {
      for (const [key, cfg] of Object.entries(config.creatures)) {
        if (nameLower.includes(key.toLowerCase()) || key.toLowerCase().includes(nameLower)) {
          return { ...config.default, ...cfg };
        }
      }
    }
    return config.default;
  }

  // ==========================================================
  // 逃跑判定
  // ==========================================================

  private shouldFlee(
    npc: WorldEntity,
    cfg: CreatureConfig,
    state: WorldState
  ): boolean {
    const threshold = cfg.flee_when_hp_below ?? 0.25;
    const hpRatio = npc.hp / npc.maxHp;

    if (hpRatio <= threshold) {
      // 有些 NPC 不逃跑（morale: "mindless" / "unbreakable"）
      const morale = cfg.morale ?? "medium";
      if (morale === "mindless" || morale === "unbreakable" || morale === "very_high" || morale === "unkillable" || morale === "territorial" || morale === "alien") {
        return false;
      }
      // 概率判定：低士气逃跑概率更高
      const fleeChance = morale === "low" ? 0.9 : morale === "medium" ? 0.5 : 0.2;
      return Math.random() < fleeChance;
    }

    return false;
  }

  // ==========================================================
  // 目标选择
  // ==========================================================

  private selectTarget(
    npc: WorldEntity,
    cfg: CreatureConfig,
    state: WorldState
  ): WorldEntity | null {
    const priorities = cfg.target_priority ?? ["nearest"];
    const candidates = Object.values(state.entities).filter(
      (e) =>
        e.id !== npc.id &&
        e.type !== "item" &&
        e.hp > 0 &&
        !e.status.includes("dead") &&
        e.position === npc.position // 同场景才可攻击
    );

    if (candidates.length === 0) return null;

    for (const priority of priorities) {
      let match: WorldEntity | null = null;

      switch (priority) {
        case "nearest":
          match = candidates[0]; // 简化：取第一个活着的
          break;
        case "lowest_hp":
          match = candidates.reduce((a, b) => (a.hp < b.hp ? a : b));
          break;
        case "highest_threat":
          match = candidates.reduce((a, b) => (a.ac > b.ac ? a : b)); // AC 为威胁代理
          break;
        case "isolated":
          // 找最近的且周围没有其他友军的
          match = candidates[0];
          break;
        case "last_attacker":
          // 简化：取第一个——真实实现需追踪"最后攻击者"
          match = candidates.find((c) => c.type === "pc") || candidates[0];
          break;
        case "caster":
        case "healer":
        case "leader":
          match = candidates[0]; // 简化
          break;
        case "holy_users":
          match = candidates.find(
            (c) => c.status.includes("holy") || c.faction === "圣骑士"
          ) || candidates[0];
          break;
        case "attacking_allies":
        case "undead_or_demon":
          match = candidates[0];
          break;
        default:
          match = candidates[0];
      }

      if (match) return match;
    }

    return candidates[0];
  }

  // ==========================================================
  // 行动选择
  // ==========================================================

  private selectAction(
    npc: WorldEntity,
    cfg: CreatureConfig,
    target: WorldEntity,
    state: WorldState,
    config: RulesetConfig,
    ruleset: string
  ): { type: string; weapon?: string; method?: string; skill?: string } {
    const weights = config.action_weights ?? {
      melee_attack: 50,
      ranged_attack: 20,
      special_ability: 15,
      disengage: 10,
      dodge: 5,
    };

    // 圣杯系统：根据 rank 调整可用行动
    if (ruleset === "grail") {
      return this.selectGrailAction(npc, target, config);
    }

    // 加权随机选择
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let roll = Math.random() * total;

    for (const [action, weight] of entries) {
      roll -= weight;
      if (roll <= 0) {
        return this.actionToIntent(action, cfg);
      }
    }

    return { type: "attack" };
  }

  private actionToIntent(
    action: string,
    cfg: CreatureConfig
  ): { type: string; weapon?: string; method?: string; skill?: string } {
    switch (action) {
      case "melee_attack":
        return { type: "attack", method: "melee" };
      case "ranged_attack":
        return { type: "attack", method: "ranged" };
      case "special_ability":
        return { type: "cast" };
      case "disengage":
        return { type: "move", method: "disengage" };
      case "dodge":
        return { type: "skill_check", skill: "acrobatics" };
      case "dash":
        return { type: "move", method: "dash" };
      default:
        return { type: "attack" };
    }
  }

  // ==========================================================
  // 圣杯系统专用行动选择
  // ==========================================================

  private selectGrailAction(
    npc: WorldEntity,
    target: WorldEntity,
    config: RulesetConfig
  ): { type: string; weapon?: string; method?: string; skill?: string } {
    const rankKey = inferGrailRank(npc);
    const rank = config.ranks?.[rankKey];

    if (!rank) return { type: "attack" };

    // 传奇：可同时攻击多目标（简化：50%概率使用特殊能力）
    if (rank.tier >= 5 && Math.random() < 0.5) {
      return { type: "cast" }; // 代替"传奇动作"
    }

    // 黄金及以上：30%概率使用特殊技能
    if (rank.tier >= 4 && Math.random() < 0.3) {
      return { type: "cast" };
    }

    // 计算位阶压制
    const targetRank = inferGrailRank(target);
    const targetRankCfg = config.ranks?.[targetRank];
    const tierDiff = targetRankCfg ? rank.tier - targetRankCfg.tier : 0;

    if (tierDiff >= 3) {
      // 高三阶以上：必定命中
      return { type: "attack", method: "melee" };
    }

    return { type: "attack", method: "melee" };
  }

  // ==========================================================
  // 辅助
  // ==========================================================

  private pickWeapon(npc: WorldEntity, ruleset: string): string {
    // 简化：根据规则集和 NPC 类型选默认武器
    if (ruleset === "cosmic-horror") return "fist"; // CoC 很少自带武器——或用爪击
    return "shortsword"; // D&D 默认
  }

  /** 获取 NPC 的 CR 估算（D&D） */
  getEstimatedCR(npc: WorldEntity): string {
    // 简化：根据 HP 和 AC 估算
    const score = npc.maxHp + npc.ac * 2;
    if (score > 100) return "cr_11_plus";
    if (score > 60) return "cr_5_to_10";
    if (score > 25) return "cr_1_to_4";
    return "cr_0_to_half";
  }

  /** 应否触发 NPC 战斗阶段 */
  shouldEngage(npc: WorldEntity, playerEntity: WorldEntity): boolean {
    if (npc.type !== "monster" && npc.type !== "npc") return false;
    if (npc.hp <= 0) return false;
    // 不同场景不交战
    if (npc.position !== playerEntity.position) return false;

    // 检查是否对玩家敌对
    if (npc.faction === "野兽" || npc.faction === "怪物") return true;
    if (npc.status.includes("hostile")) return true;

    return false;
  }

  /**
   * 获取指定 NPC 的 CoC SAN 损失配置
   * 格式如 "1/1d6"（成功损失 / 失败损失）
   * 在 coc-npc.yaml 中由 san_cost 字段定义
   */
  // 已知神话生物的中英文名对照
  private static MYTHOS_NAMES: Record<string, string[]> = {
    mi_go:                ["米戈", "犹格斯真菌"],
    ghoul:                ["食尸鬼", "尸鬼"],
    deep_one:             ["深潜者", "深潜"],
    shoggoth:             ["修格斯"],
    cultist:              ["邪教徒", "信徒", "狂热者"],
    cthulhu:              ["克苏鲁"],
    nyarlathotep:         ["奈亚拉托提普", "奈亚"],
    yog_sothoth:          ["犹格·索托斯", "犹格"],
    azathoth:             ["阿撒托斯"],
    shub_niggurath:       ["莎布·尼古拉丝", "黑山羊"],
    dagon:                ["达贡"],
    elder_thing:          ["远古者", "古老者"],
    fire_vampire:         ["火焰吸血鬼"],
    colour:               ["星之彩", "颜色"],
    wendigo:              ["温迪戈"],
    rat_thing:            ["鼠群", "老鼠"],
  };

  getSanCost(npcName: string, ruleset: string): string | null {
    const config = this.configs.get(ruleset);
    if (!config?.creatures) return null;

    const nameLower = npcName.toLowerCase();
    // 先按 key 精确匹配
    for (const [key, cfg] of Object.entries(config.creatures)) {
      if (nameLower.includes(key.toLowerCase()) || key.toLowerCase().includes(nameLower)) {
        return (cfg as any).san_cost ?? null;
      }
    }
    // 再按中文名映射匹配
    for (const [key, aliases] of Object.entries(NPCCombatEngine.MYTHOS_NAMES)) {
      if (aliases.some(a => nameLower.includes(a.toLowerCase()))) {
        const cfg = config.creatures[key];
        return (cfg as any)?.san_cost ?? null;
      }
    }
    return null;
  }
}
