// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import { DEFAULT_CTHULHU_PATH } from "../world/world-model-loader";
import type { WorldState } from "../world/state";
import type { ModuleData } from "../module/types";
import type { PlayerAgent } from "../agent/player-agent";
import type { WorldContext } from "../llm/npc-dialogue-prompts";
import type { SceneContext as WmSceneContext } from "../world/world-model-integrator";
import type { WorldModelCtx } from "./run-state";

/**
 * 神话侧世界模型上下文。
 *
 * 拿 `wm` 而不是闭包捕获 loader —— 世界模型那三样（integrator / 两份缓存）
 * 原先平铺在 runModuleInner 里，任何要用上下文的块抽出去都会被它们绊住。
 */
export function buildCthulhuContext(wm: WorldModelCtx): string {
  const { cthulhuLoader } = wm;
  try {
    if (!cthulhuLoader.isLoaded()) {
      cthulhuLoader.load(DEFAULT_CTHULHU_PATH);
    }
    if (!cthulhuLoader.isLoaded()) return "";
    const lines: string[] = [];
    lines.push("[克苏鲁神话上下文]");
    const deities = cthulhuLoader.getByType("deity");
    if (deities.length > 0) {
      lines.push("神话存在:");
      for (const d of deities.slice(0, 6)) {
        const name = d.name || "未知";
        const domains = (d as any).domains ? `(领域: ${(d as any).domains.join("、")})` : "";
        const mechanic = d.mechanic ? ` ${d.mechanic.slice(0, 80)}` : "";
        lines.push(`  - ${name}${domains}${mechanic}`);
      }
    }
    const mechanics = [
      ...cthulhuLoader.getByType("power_system"),
      ...cthulhuLoader.getByType("game_mechanic"),
      ...cthulhuLoader.getByType("crafting"),
      ...cthulhuLoader.getByType("cosmology"),
    ].slice(0, 8);
    if (mechanics.length > 0) {
      lines.push("神秘机制:");
      for (const m of mechanics) {
        const name = m.name || "未知";
        const mechanic = m.mechanic ? m.mechanic.slice(0, 90) : (m.description || "").slice(0, 90);
        lines.push(`  - ${name}: ${mechanic}`);
      }
    }
    const causals = cthulhuLoader.getByType("causal").slice(0, 3);
    if (causals.length > 0) {
      lines.push("可推进的怪异事件方向:");
      for (const c of causals) {
        const name = c.name || "未知";
        const mechanic = c.mechanic ? c.mechanic.slice(0, 90) : "";
        lines.push(`  - ${name}: ${mechanic}`);
      }
    }
    return lines.length > 1 ? lines.join("\n") : "";
  } catch {
    return "";
  }
}
/** 按当前场景构建世界模型注入块；同场景内节流复用（场景切换才重算） */
function buildWmContext(wm: WorldModelCtx, w: WorldState): string | undefined {
  if (!wm.integrator) return undefined;
  const scene = w.currentScene;
  const sceneId = scene?.id ?? "";
  if (wm.cacheSceneId === sceneId && wm.cacheText) return wm.cacheText;
  const wmCtx: WmSceneContext = {
    sceneId,
    sceneName: scene?.name ?? "",
    // 关键词 = 场景名 + 场景内线索名（保守匹配，避免噪声条目）
    keywords: [scene?.name ?? "", ...(scene?.clues.map(c => c.name) ?? [])].filter(k => k.length > 0),
    presentNPCs: scene?.npcIds ?? [],
    discoveredClues: scene?.clues.filter(c => w.isClueFound(c.id)).map(c => c.name) ?? [],
    round: w.round,
    ruleset: "cosmic-horror",
  };
  let wmText = wm.integrator.buildKPContext(wmCtx);
  // 克苏鲁神话上下文（独立 loader，失败静默跳过；随缓存一并复用）
  const cthulhuText = buildCthulhuContext(wm);
  if (cthulhuText) {
    wmText = wmText ? `${wmText}\n\n${cthulhuText}` : cthulhuText;
  }
  wm.cacheText = wmText;
  wm.cacheSceneId = sceneId;
  return wm.cacheText;
}


/**
 * 构建全局调查上下文（WorldContext）— 跨场景串联，供所有 LLM 叙事生成点注入。
 *
 * 被对话与线索两边共用（5 处），这也是它非抽不可的原因：
 * 留在闭包里，线索检定那块就抽不干净。
 */
export function buildWorldContext(
  module: ModuleData,
  agents: [PlayerAgent, PlayerAgent],
  wm: WorldModelCtx,
  w: WorldState,
): WorldContext {
  const [pl1, pl2] = agents;
  // 跨场景已发现线索名（跳过对话追踪用合成 id，如 clue_kn_/conv_kn_）
  const discovered: string[] = [];
  for (const sc of module.scenes) {
    for (const cl of sc.clues) {
      if (w.isClueFound(cl.id)) discovered.push(cl.name);
    }
  }
  // 已接触的 NPC（按模块 npcIds 顺序）
  const met = module.npcs
    .filter(n => w.getNpcState(n.id)?.knownByPlayers)
    .map(n => n.name.replace(/[（(].*[）)]$/, "").trim());
  // 已访问场景名（sceneHistory 存的是 id，转成名字；当前场景去重）
  const visited = w.getSnapshot().sceneHistory
    .map(id => module.scenes.find(s => s.id === id)?.name)
    .filter((n): n is string => !!n);
  const current = w.currentScene?.name ?? "";
  if (current && !visited.includes(current)) visited.push(current);
  // 调查员目标
  const goals = [pl1.pc.currentGoal, pl2.pc.currentGoal].filter((g): g is string => !!g && g.length > 0);
  // 最近事件：WorldState 记录的历史（场景历史含事件串）
  const history = w.getHistorySummary(5).filter(e => !module.scenes.some(s => s.name === e));
  // 未探索的核心线索场景（模糊提示——引导调查方向，不点名场景内部细节）
  const unexplored: string[] = [];
  for (const sc of module.scenes) {
    if (sc.id === w.currentScene?.id) continue;
    const hasCore = sc.clues.some(cl => cl.importance === "core" && !w.isClueFound(cl.id));
    if (hasCore) unexplored.push(sc.name);
  }
  // 剧情状态变量（DESIGN-LOG §2）：当前场景全量（含初始声明），其他场景只列运行时被修改过的（≠初始值）
  const stateVars: string[] = [];
  const curId = w.currentScene?.id ?? "";
  for (const sc of module.scenes) {
    const vars = w.getStateVars(sc.id);
    const keys = Object.keys(vars);
    if (keys.length === 0) continue;
    const initial = sc.stateVars ?? {};
    const shown = keys.filter(k => sc.id === curId || vars[k] !== initial[k]);
    if (shown.length === 0) continue;
    stateVars.push(`${sc.name}: ${shown.map(k => `${k}=${vars[k]}`).join("、")}`);
  }
  return {
    visitedScenes: visited,
    currentScene: current,
    discoveredClues: discovered,
    currentGoals: goals,
    recentEvents: history,
    metNpcs: met,
    triggeredEvents: [],
    // 只给"还有地方没去"这个事实，不给名字。
    //
    // 原先这里把未访问场景名拼进去，而这段会一路注入到 PC 提问的 prompt 里 ——
    // 于是调查员会张口就问"拖车房在镇子哪里"，可那时根本没人提过拖车房。
    // 上面第一行注释本来就写着"不点名场景内部细节"，是实现没做到。
    // 地点该由 NPC 说出口或被玩家撞见来引入，不该从进度提示里漏出去。
    unexploredHints: unexplored.length > 0
      ? ["镇上仍有与案件相关的场所未曾到访（是哪些，调查员目前并不知道）"]
      : [],
    stateVars: stateVars.length > 0 ? stateVars : undefined,
    worldModelContext: buildWmContext(wm, w),
  };
}


