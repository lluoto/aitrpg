// 世界状态追踪器
// 管理：当前场景、发现的线索、NPC 状态、场景历史
// 为 KP 提示生成提供上下文

import type { ModuleData, Scene, ModuleState, NPCInstanceState, Clue } from "../module/types";

export class WorldState {
  private module: ModuleData;
  private state: ModuleState;
  /** 各线索连续检定失败次数（用于 failback 兜底触发） */
  private clueFailCounts = new Map<string, number>();

  constructor(module: ModuleData) {
    this.module = module;
    this.state = {
      currentSceneId: module.scenes[0]?.id ?? "",
      discoveredClues: new Set<string>(),
      triggeredEvents: new Set<string>(),
      npcStates: new Map<string, NPCInstanceState>(),
      sceneHistory: [],
      currentRound: 0,
      // 剧情状态变量：以各场景声明（Scene.stateVars）为初始值
      sceneStateVars: new Map<string, Record<string, boolean | string>>(
        module.scenes
          .filter(s => s.stateVars && Object.keys(s.stateVars).length > 0)
          .map(s => [s.id, { ...(s.stateVars as Record<string, boolean | string>) }]),
      ),
    };

    // 初始化所有 NPC 状态
    for (const npc of module.npcs) {
      this.state.npcStates.set(npc.id, {
        locationSceneId: npc.sceneId,
        mood: "neutral",
        relationship: 0,
        isAlive: true,
        isConscious: true,
        knownByPlayers: false,
      });
    }
  }

  get currentScene(): Scene | undefined {
    return this.module.scenes.find((s) => s.id === this.state.currentSceneId);
  }

  get currentSceneId(): string {
    return this.state.currentSceneId;
  }

  get round(): number {
    return this.state.currentRound;
  }

  get allNpcs() {
    return this.module.npcs;
  }

  getNpcState(npcId: string): NPCInstanceState | undefined {
    return this.state.npcStates.get(npcId);
  }

  getNpc(npcId: string) {
    return this.module.npcs.find((n) => n.id === npcId);
  }

  /** 获取当前场景中可见的 NPC */
  getVisibleNpcs(): { npc: any; state: NPCInstanceState }[] {
    const results: { npc: any; state: NPCInstanceState }[] = [];
    for (const [id, s] of this.state.npcStates) {
      if (s.locationSceneId === this.state.currentSceneId && s.isAlive && s.knownByPlayers) {
        const npc = this.getNpc(id);
        if (npc) results.push({ npc, state: s });
      }
    }
    return results;
  }

  /** 获取当前场景中所有可用的线索（含已发现和未发现的） */
  getSceneClues(): Clue[] {
    const scene = this.currentScene;
    if (!scene) return [];
    return scene.clues.map((c) => ({
      ...c,
      found: this.state.discoveredClues.has(c.id),
    }));
  }

  /** 获取当前场景中未发现的线索 */
  getUndiscoveredClues(): Clue[] {
    return this.getSceneClues().filter((c) => !c.found);
  }

  /** 标记一个线索已发现（连锁触发 unlocks） */
  discoverClue(clueId: string): void {
    if (this.state.discoveredClues.has(clueId)) return;
    this.state.discoveredClues.add(clueId);
    // One-level unlock: 发现线索时自动发现 unlocks 中指定的线索
    const clue = this.findClueById(clueId);
    if (clue?.unlocks) {
      for (const linkedId of clue.unlocks) {
        if (!this.state.discoveredClues.has(linkedId)) {
          this.state.discoveredClues.add(linkedId);
        }
      }
    }
    // 剧情状态联动：线索携带 setStateVar 时自动写入对应场景的状态变量
    if (clue?.setStateVar) {
      const scene = this.module.scenes.find(s => s.clues.some(c => c.id === clueId));
      if (scene) {
        this.setStateVar(scene.id, clue.setStateVar.key, clue.setStateVar.value);
      }
    }
  }

  /** 读取某场景的剧情状态变量（含 Scene.stateVars 初始值 + 运行时修改） */
  getStateVars(sceneId: string): Record<string, boolean | string> {
    return { ...(this.state.sceneStateVars.get(sceneId) ?? {}) };
  }

  /** 读取单个剧情状态变量 */
  getStateVar(sceneId: string, key: string): boolean | string | undefined {
    return this.state.sceneStateVars.get(sceneId)?.[key];
  }

  /** 写入剧情状态变量（引擎专用；LLM 不参与写入） */
  setStateVar(sceneId: string, key: string, value: boolean | string): void {
    const vars = this.state.sceneStateVars.get(sceneId) ?? {};
    vars[key] = value;
    this.state.sceneStateVars.set(sceneId, vars);
  }

  /** 在所有场景的线索中查找指定 ID 的线索 */
  private findClueById(clueId: string): Clue | undefined {
    for (const scene of this.module.scenes) {
      for (const clue of scene.clues) {
        if (clue.id === clueId) return clue;
      }
    }
    return undefined;
  }

  isClueFound(clueId: string): boolean {
    return this.state.discoveredClues.has(clueId);
  }

  /** 记录一次线索检定失败（用于 failback 兜底）；返回累计失败次数 */
  incrementClueFail(clueId: string): number {
    const next = (this.clueFailCounts.get(clueId) ?? 0) + 1;
    this.clueFailCounts.set(clueId, next);
    return next;
  }

  /** 查询某线索累计失败次数 */
  getClueFailCount(clueId: string): number {
    return this.clueFailCounts.get(clueId) ?? 0;
  }

  /** 线索被发现后清零失败计数 */
  resetClueFails(clueId: string): void {
    this.clueFailCounts.delete(clueId);
  }

  /** 切换场景 */
  moveToScene(sceneId: string): boolean {
    const exists = this.module.scenes.some((s) => s.id === sceneId);
    if (!exists) return false;
    // 记录场景历史
    this.state.sceneHistory.push(sceneId);
    this.state.currentSceneId = sceneId;
    return true;
  }

  /** 是否访问过某场景 */
  isSceneVisited(sceneId: string): boolean {
    return this.state.sceneHistory.includes(sceneId);
  }

  /** 获取当前场景可以前往的场景 */
  getAvailableConnections(): { sceneId: string; condition: string; unlocked: boolean }[] {
    const scene = this.currentScene;
    if (!scene) return [];
    return scene.connections.map((conn) => {
      let unlocked = true;
      if (conn.requiredClueId && !this.state.discoveredClues.has(conn.requiredClueId)) {
        unlocked = false;
      }
      return {
        sceneId: conn.targetSceneId,
        condition: conn.condition,
        unlocked,
      };
    });
  }

  /** 获取场景建议的技能检定 */
  getSkillCheckHints(): { skill: string; difficulty: string; purpose: string }[] {
    return this.currentScene?.skillChecks ?? [];
  }

  /** 推进一个回合 */
  advanceRound(): number {
    return ++this.state.currentRound;
  }

  /** 记录场景历史 */
  recordEvent(event: string): void {
    this.state.sceneHistory.push(`[第${this.state.currentRound}轮] ${event}`);
  }

  /** 获取场景历史摘要（最近 N 条） */
  getHistorySummary(n = 5): string[] {
    return this.state.sceneHistory.slice(-n);
  }

  /** 获取用于 KP 提示的完整上下文摘要 */
  getKpContext(): string {
    const scene = this.currentScene;
    if (!scene) return "场景未定义";

    const foundClues = this.getSceneClues()
      .filter((c) => c.found)
      .map((c) => c.name);

    const undiscoveredClues = this.getSceneClues()
      .filter((c) => !c.found && c.importance !== "color")
      .map((c) => `${c.name}（${c.description.slice(0, 60)}）`);

    return [
      `当前场景: ${scene.name}`,
      scene.atmosphere ? `氛围: ${scene.atmosphere}` : "",
      `已发现线索: ${foundClues.length > 0 ? foundClues.join("、") : "暂无"}`,
      `可追寻线索: ${undiscoveredClues.length > 0 ? undiscoveredClues.join("、") : "暂无"}`,
      `可用移动: ${this.getAvailableConnections().filter((c) => c.unlocked).map((c) => c.condition).join("、") || "暂无"}`,
      `已进行回合: ${this.state.currentRound}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** 设置 NPC 情绪 */
  setNpcMood(npcId: string, mood: string): void {
    const s = this.state.npcStates.get(npcId);
    if (s) s.mood = mood;
  }

  /** 调整 NPC 关系值 (-5 ~ +5) */
  adjustRelationship(npcId: string, delta: number): number {
    const s = this.state.npcStates.get(npcId);
    if (!s) return 0;
    s.relationship = Math.max(-5, Math.min(5, s.relationship + delta));
    return s.relationship;
  }

  /** 标记 NPC 已被玩家认识 */
  meetNpc(npcId: string): void {
    const s = this.state.npcStates.get(npcId);
    if (s) s.knownByPlayers = true;
  }

  /** 导出完整状态快照 */
  getSnapshot(): ModuleState {
    return this.state;
  }
}
