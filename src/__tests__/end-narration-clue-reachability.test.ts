// 开发C·任务4：让「结局引用了不存在的东西」再也藏不住。
//
// 已知实例：bad_lever_pulled 全仓只有 3 处，全在 barn-of-premier.ts 内部，
// 没有任何地方产生它——所有 world.discoverClue(...) 调用点都不传它，
// src/play/ 下"拉杆"/"lever"零匹配（拉杆这个动作根本没实现）。后果：
// Bad End 不可达，且 Normal End 的 excludeClues 里那一项恒真、白写。
//
// 参考 ingest-scoring-key-boundary.test.ts:264-278 的「引用的 clue/item id
// 必须在基准里找到」——那条查的是"存在性"（id 有没有被声明成一个 Clue
// 对象）。这条判据深一层：不光要**存在**，还要**可被产生**——一个 clue
// id 即使没在任何 Scene.clues[] 里声明，只要匹配"NPC 知识揭示"这类动态
// 生成规则，游戏里仍然摸得到；反过来，bad_lever_pulled 哪种生产机制都
// 不沾边，纯粹是三处字符串字面量互相打气。
//
// ⚠ 不要把 bad_lever_pulled 的条件改指 clue_control_lever——那是"观察"
// 中控台拉杆（findMethods: observation），Bad End 要的是"拉下"拉杆，
// 改过去会变成看一眼拉杆就全员团灭。实现拉杆动作不在本轮范围。
//
// bun test src/__tests__/end-narration-clue-reachability.test.ts

import { describe, it, expect } from "bun:test";
import { BARN_OF_PREMIER, BARN_SUPPORT, END_NARRATIONS } from "../module/barn-of-premier";

/**
 * 全仓已知的线索生产机制，逐一对应一处真实的 world.discoverClue(...) 调用：
 *   · Scene.clues[].id —— 常规调查（clue-check.ts / scene-pipeline.ts）
 *   · EncounterNarration.victoryClueId —— 战斗胜利奖励（combat.ts）
 *   · `clue_kn_${npc.id}_${index}` / `conv_kn_${npc.id}_${index}` ——
 *     NPC 知识揭示，index 对应 npc.knowledge 数组下标
 *     （npc-dialogue.ts / scene-pipeline.ts）
 *   · ModuleItem.trap.detectedByClue —— 陷阱的"事先发现即可规避"线索
 *     （traps.ts）
 * 新增生产机制时要同步这份集合，否则这条判据会把合法可达的 clue 也
 * 误判成"无生产者"——判据本身也要能被将来的真实新增撑住，不是钉死当前
 * 这四种。
 */
function producibleClueIds(): Set<string> {
  const ids = new Set<string>();
  for (const scene of BARN_OF_PREMIER.scenes) {
    for (const c of scene.clues) ids.add(c.id);
  }
  for (const enc of BARN_SUPPORT.encounters) {
    if (enc.victoryClueId) ids.add(enc.victoryClueId);
  }
  for (const npc of BARN_OF_PREMIER.npcs) {
    (npc.knowledge ?? []).forEach((_, i) => {
      ids.add(`clue_kn_${npc.id}_${i}`);
      ids.add(`conv_kn_${npc.id}_${i}`);
    });
  }
  for (const item of BARN_OF_PREMIER.items) {
    if (item.trap?.detectedByClue) ids.add(item.trap.detectedByClue);
  }
  return ids;
}

/** 结局条件（requiredClues + excludeClues）里引用到的所有 clue id，去重。 */
function referencedClueIds(): string[] {
  const out = new Set<string>();
  for (const en of END_NARRATIONS) {
    for (const c of en.condition.requiredClues) out.add(c);
    for (const c of en.condition.excludeClues ?? []) out.add(c);
  }
  return [...out];
}

/**
 * 已知且已记录原因的不可达 clue id——见 END_NARRATIONS 里 bad 条目的
 * 注释。判据要求"引用了但无生产者"的 id 集合与这份名单**精确相等**：
 * 名单之外新冒出的不可达引用会让下面那条判据变红（新增一处不可达
 * 结局条件不能悄悄溜过去）；bad_lever_pulled 哪天真的接上了生产者，
 * 这份名单也要跟着改，同一条判据同样会提醒你——名单本身要跟着代码走，
 * 不能只靠这份注释和 prompt 记着。
 */
const KNOWN_UNREACHABLE = new Set(["bad_lever_pulled"]);

describe("结局条件引用的每个 clue id 必须有生产者，否则必须显式记录在 KNOWN_UNREACHABLE", () => {
  it("**正确**：常规可达的 clue（如 clue_bedroom_diary）确实在生产者集合里——判据本身没有算错", () => {
    const producible = producibleClueIds();
    expect(producible.has("clue_bedroom_diary")).toBe(true);
    expect(producible.has("clue_bedroom_old_doc")).toBe(true);
    expect(producible.has("clue_control_supplies")).toBe(true);
  });

  it("**错误行为红线**：bad_lever_pulled 确实无生产者——这是已知实例，判据必须能报出它", () => {
    const producible = producibleClueIds();
    expect(producible.has("bad_lever_pulled")).toBe(false);
  });

  it("**正确**：不可达 id 集合与 KNOWN_UNREACHABLE 精确相等——不多不少，不是「大致覆盖」", () => {
    const producible = producibleClueIds();
    const unreachable = referencedClueIds().filter((id) => !producible.has(id));
    expect(new Set(unreachable)).toEqual(KNOWN_UNREACHABLE);
  });

  it("**目标行为错误的对照**：判据对所有结局条件生效，不是只查 bad 这一条——true/good/normal 引用的 clue 全部可达", () => {
    const producible = producibleClueIds();
    const trueEnd = END_NARRATIONS.find((en) => en.id === "true")!;
    const goodEnd = END_NARRATIONS.find((en) => en.id === "good")!;
    const normalEnd = END_NARRATIONS.find((en) => en.id === "normal")!;
    for (const id of [...trueEnd.condition.requiredClues, ...(trueEnd.condition.excludeClues ?? [])]) {
      expect(producible.has(id)).toBe(true);
    }
    for (const id of [...goodEnd.condition.requiredClues, ...(goodEnd.condition.excludeClues ?? [])]) {
      expect(producible.has(id)).toBe(true);
    }
    for (const id of [...normalEnd.condition.requiredClues, ...(normalEnd.condition.excludeClues ?? [])]) {
      expect(producible.has(id)).toBe(true);
    }
  });
});
