// Agent 注册中心 — 多 Agent 热插拔容器
//
// 设计:
//   NPC 可以动态加入/离开游戏，无需重启主循环。
//   - 进入新场景 → 按需注册场景中的 NPC
//   - 实体死亡 → 自动注销对应 Agent
//   - 玩家或 KP 触发 → 即时创建新 NPC 并注册

import type { LLMClient } from "../llm/client";
import type { NPCPersonality } from "./types";
import { NPCAgent } from "./npc-agent";
import { NPCStore } from "../db/index";

export type RegistryEvent = "register" | "unregister";
export type RegistryHook = (name: string, event: RegistryEvent) => void;

export class AgentRegistry {
  private agents: Map<string, NPCAgent> = new Map();
  private llm: LLMClient;
  private hooks: RegistryHook[] = [];
  private db?: NPCStore;

  constructor(llm: LLMClient, db?: NPCStore) {
    this.llm = llm;
    this.db = db;
  }

  /** 设置/更换数据库实例 */
  setDB(db: NPCStore): void {
    this.db = db;
  }

  /** 注册 NPC Agent（从完整人格卡） */
  register(personality: NPCPersonality): NPCAgent {
    if (this.agents.has(personality.name)) {
      throw new Error(`Agent "${personality.name}" 已注册。如需替换，请先 unregister。`);
    }
    const agent = new NPCAgent(personality, this.llm, this.db);
    // 如果数据库中有该 NPC 的记忆，加载
    if (this.db) {
      const existing = this.db.getPersonality(personality.name);
      if (existing) {
        agent.loadMemoriesFromDB();
        // 恢复状态
        const state = this.db.getState(personality.name);
        if (state) {
          // 注意：关系值/情绪通过私有字段访问，不能直接设置
          // 但我们可以通过 persistState 回写
        }
      } else {
        // 新 NPC，持久化人格卡
        this.db.savePersonality(personality);
      }
    }
    this.agents.set(personality.name, agent);
    this.emit("register", personality.name);
    return agent;
  }

  /** 快速注册 NPC（从最小描述自动生成人格卡） */
  registerQuick(
    name: string,
    role: string,
    personality: string,
    opts: {
      background?: string;
      goals?: string[];
      speech?: string;
      knowledge?: string[];
      attitudes?: Record<string, string>;
    } = {}
  ): NPCAgent {
    const card: NPCPersonality = {
      name,
      role,
      personality,
      background: opts.background ?? `${name}，${role}`,
      goals: opts.goals ?? ["生存", "完成自己的事"],
      speech_style: opts.speech ?? `以${role}的身份说话，简洁自然`,
      knowledge: opts.knowledge ?? [],
      secrets: [],
      attitudes: opts.attitudes,
    };
    return this.register(card);
  }

  /** 注销 NPC Agent */
  unregister(name: string): boolean {
    const agent = this.agents.get(name);
    if (!agent) return false;
    this.agents.delete(name);
    this.emit("unregister", name);
    return true;
  }

  /** 按名查找 */
  get(name: string): NPCAgent | undefined {
    return this.agents.get(name);
  }

  /** 按名查找 Agent（server API 兼容别名，等价 get） */
  findAgentByName(name: string): NPCAgent | undefined {
    return this.agents.get(name);
  }

  /** 是否存在 */
  has(name: string): boolean {
    return this.agents.has(name);
  }

  /** 获取所有活跃 Agent */
  getAll(): NPCAgent[] {
    return [...this.agents.values()];
  }

  /** 获取所有活跃 Agent 名 */
  getAllNames(): string[] {
    return [...this.agents.keys()];
  }

  /** 数量 */
  get count(): number {
    return this.agents.size;
  }

  /** 批量注册 */
  registerAll(personalities: NPCPersonality[]): NPCAgent[] {
    return personalities.map((p) => this.register(p));
  }

  /** 按条件注销（如：清除所有不在某场景中的 NPC） */
  unregisterWhere(predicate: (agent: NPCAgent) => boolean): string[] {
    const removed: string[] = [];
    for (const [name, agent] of this.agents) {
      if (predicate(agent)) {
        this.agents.delete(name);
        removed.push(name);
        this.emit("unregister", name);
      }
    }
    return removed;
  }

  /** 监听注册/注销事件 */
  onEvent(hook: RegistryHook) {
    this.hooks.push(hook);
  }

  private emit(event: RegistryEvent, name: string) {
    for (const hook of this.hooks) {
      try { hook(name, event); } catch { /* 不阻塞 */ }
    }
  }
}
