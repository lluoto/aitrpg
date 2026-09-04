// 两份谷仓模组表示的跨表示一致性判据——开发·陈旧记录纠正+收敛前置
// N10，为 todo-19/20 的收敛做前置。
//
// 背景：`BARN_OF_PREMIER`（`ModuleData`，`module/barn-of-premier.ts`）与
// `MODULE_PREMIERS_BARN`（`MythosModule`，
// `rules/custom-modules/premiers_barn.ts`）是同一个模组的两份独立表示，
// 长期各自演化，没有任何机制保证它们讲的是同一个故事。这份判据比对
// 双方都声称掌握的同一批事实，覆盖四项：
//   · NPC 站位（角色在哪个场景）
//   · 关键数值（原文里反复出现、双方各自转述过的数字）
//   · 结局 id 集合（复用既有 module-endings-consistency 判据同一个概念）
//   · 场景集合（A 有 B 没有 / B 有 A 没有）
//
// ⚠ 这份判据【一开工就应该是红的】——已知至少 12 处不一致（5 个 NPC
// 站位 + 1 个数值 + 6 个场景集合差异，结局 id 集合当前一致，0 处）。
// 这是判据写对了，不是判据写错了：两份表示从一开始就没有被同步维护
// 过。红的条目逐条登记进 KNOWN_INCONSISTENCIES（照本仓既有登记表
// 惯例：KNOWN_UNREACHABLE / FABRICATION_REGISTRY /
// CONFIRMED_FABRICATION_LOG），名单外新出现的不一致会让判据变红；
// 名单归零 = 收敛完成的验收标准（那时候两份表示应该已经合并成一份，
// 或者一份变成另一份的纯投影，不再有能"各自表态"的独立事实）。
//
// 本轮范围：只建判据、裁决红条目该信哪一侧（見
// `confirmed-fabrication-log.ts` 同一处置：核对不出处的记非法臆造），
// 不修数据——现在改会让这份判据的红/绿失去"收敛进度表"的意义。
//
// 与 `ingest/confirmed-fabrication-log.ts` 的分工 + 交接规则见该文件
// 头部注释（开发·场景 id 收敛 N11 补记）：`KNOWN_INCONSISTENCIES` 存
// 未修复的发现，`CONFIRMED_FABRICATION_LOG` 存已修复+带字面串回归
// 护栏的臆造——某一条一旦被订正，要从这里迁过去补一条护栏，不能直接
// 删除了事。

import { BARN_OF_PREMIER, END_NARRATIONS } from "./barn-of-premier";
import { MODULE_PREMIERS_BARN } from "../rules/custom-modules/premiers_barn";
import type { ModuleData } from "./types";
import type { MythosModule } from "../rules/mythos-module";

export type InconsistencyCategory = "npc_scene" | "numeric_fact" | "ending_id" | "scene_set";

export interface RepresentationInconsistency {
  category: InconsistencyCategory;
  /** 这条不一致的主键——NPC 名/事实名/结局 id/场景名，供登记表按 (category,key) 精确匹配 */
  key: string;
  /** 人能看懂发生了什么：双方各自的值是什么 */
  detail: string;
}

/** 与 `GameSession.stripBracketSuffix`（game-session.ts:4099）同一个正则——那处是 private，
 *  这里按 `scene-id-bridge.test.ts:38` 已经确认过的先例内联同一份归一化，不新发明一套。 */
function stripBracketSuffix(name: string): string {
  return name.replace(/（[^）]*）$/, "");
}

// ────────────────────────────────────────────────────────────
// ① NPC 站位
// ────────────────────────────────────────────────────────────

/** ModuleData 的场景 id → 去括号后的展示名，A 侧 NPC.sceneId 要经这层翻译才能跟 B 比。 */
function sceneNameById(scenes: ModuleData["scenes"]): Map<string, string> {
  return new Map(scenes.map((s) => [s.id, stripBracketSuffix(s.name)]));
}

/**
 * 比对同名 NPC 在两份表示里的场景归属。只比对【双方都声明了这个角色】
 * 的情况——只在一侧出现的 NPC（如 A 侧的前台/报亭老板/医护人员，B
 * 没有对应条目）不是"站位矛盾"，是"这一侧压根没建这个角色"，不同的
 * 缺口类型，不在这份判据的范围（那类缺口在场景集合/角色实体那条线
 * 上已经有别的判据管，见 scene-npc-noun-registry.ts）。
 */
export function findNpcSceneInconsistencies(
  moduleData: Pick<ModuleData, "scenes" | "npcs">,
  mythosModule: Pick<MythosModule, "npcs">,
): RepresentationInconsistency[] {
  const sceneNames = sceneNameById(moduleData.scenes);
  // NPC 名字也可能带括号后缀（如 A 侧 "Mi-Go（来自尤格斯的真菌）"，
  // B 侧只叫 "Mi-Go"）——按名字匹配同一个角色前，同样要去括号，否则
  // 这条 NPC 会被当成"只在一侧出现"整条漏判，Mi-Go 站位矛盾就是这样
  // 第一版实测漏掉的，补上后才追平"至少 5 处"这个已知下限。
  const bByName = new Map((mythosModule.npcs ?? []).map((n) => [stripBracketSuffix(n.name), n]));
  const out: RepresentationInconsistency[] = [];
  for (const npc of moduleData.npcs) {
    const b = bByName.get(stripBracketSuffix(npc.name));
    if (!b) continue;
    const aScene = sceneNames.get(npc.sceneId) ?? npc.sceneId;
    const bScene = stripBracketSuffix(b.sceneId);
    if (aScene !== bScene) {
      out.push({
        category: "npc_scene",
        key: npc.name,
        detail: `ModuleData: ${aScene}（sceneId=${npc.sceneId}） vs MythosModule: ${bScene}`,
      });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// ② 关键数值
// ────────────────────────────────────────────────────────────

export interface NumericFactCheck {
  /** 事实名，进登记表当 key */
  key: string;
  /** 从 ModuleData 一侧的文本里抽数字 */
  extractA: (moduleData: Pick<ModuleData, "npcs">) => number | null;
  /** 从 MythosModule 一侧的文本里抽数字 */
  extractB: (mythosModule: Pick<MythosModule, "npcs">) => number | null;
}

function firstMatch(text: string | undefined, re: RegExp): number | null {
  const m = text?.match(re);
  return m ? Number(m[1]) : null;
}

/**
 * 已核实、值得跟踪的数值事实——不是"扫描全部数字自动比对"（原文散文里
 * 到处是数字，日期/年龄/技能值这类多数不该跨表示强制一致），只登记
 * 已核实"双方各自转述过同一件事的同一个数字"的具体事实，照登记表
 * 惯例只收核实过的，不做通用扩展。
 */
export const NUMERIC_FACT_CHECKS: NumericFactCheck[] = [
  {
    key: "绑架人数",
    extractA: (mod) =>
      firstMatch(mod.npcs.find((n) => n.id === "adrian_estrum")?.description, /已绑架\/诱拐(\d+)名受害人/),
    extractB: (mod) =>
      firstMatch(
        (mod.npcs ?? []).find((n) => n.name === "艾德里安·埃斯特鲁姆")?.personality?.background,
        /已绑架(\d+)人/,
      ),
  },
];

export function findNumericFactInconsistencies(
  moduleData: Pick<ModuleData, "npcs">,
  mythosModule: Pick<MythosModule, "npcs">,
  checks: NumericFactCheck[] = NUMERIC_FACT_CHECKS,
): RepresentationInconsistency[] {
  const out: RepresentationInconsistency[] = [];
  for (const check of checks) {
    const a = check.extractA(moduleData);
    const b = check.extractB(mythosModule);
    if (a === null || b === null) continue; // 抽不到不算数，不能拿"抽不到"当"一致"
    if (a !== b) {
      out.push({ category: "numeric_fact", key: check.key, detail: `ModuleData: ${a} vs MythosModule: ${b}` });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// ③ 结局 id 集合——复用既有判据同一个概念，不重新判定一次
// ────────────────────────────────────────────────────────────

/**
 * 与 `module-endings-consistency.test.ts` 检查的是同一件事（id 集合
 * 相等），这里不重新实现比较逻辑，只是把结果并进同一份
 * RepresentationInconsistency 列表，让"两份表示还有哪些事没对齐"能
 * 一处看全。那份既有测试已经把 id 集合钉得很死（3 处判据交叉验证：
 * ModuleData.endings vs END_NARRATIONS、MythosModule.endings vs
 * END_NARRATIONS），本判据的职责只是"报告"，不是"重新验证"。
 */
export function findEndingIdInconsistencies(
  endNarrations: { id: string }[],
  mythosModule: Pick<MythosModule, "endings">,
): RepresentationInconsistency[] {
  const truthIds = new Set(endNarrations.map((e) => e.id));
  const bIds = new Set((mythosModule.endings ?? []).map((e) => e.id));
  const out: RepresentationInconsistency[] = [];
  for (const id of truthIds) {
    if (!bIds.has(id)) out.push({ category: "ending_id", key: id, detail: "END_NARRATIONS 有，MythosModule.endings 没有" });
  }
  for (const id of bIds) {
    if (!truthIds.has(id)) out.push({ category: "ending_id", key: id, detail: "MythosModule.endings 有，END_NARRATIONS 没有" });
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// ④ 场景集合
// ────────────────────────────────────────────────────────────

/** MythosModule 的场景图节点集合——没有单一的 Scene[] 字段，节点分散在 sceneDescriptions 的键与 exits 的键/目标里。 */
function mythosSceneNodeNames(mythosModule: Pick<MythosModule, "sceneDescriptions" | "exits">): Set<string> {
  const names = new Set<string>();
  for (const k of Object.keys(mythosModule.sceneDescriptions ?? {})) names.add(k);
  for (const [k, list] of Object.entries(mythosModule.exits ?? {})) {
    names.add(k);
    for (const e of list) names.add(e.target);
  }
  return names;
}

export function findSceneSetInconsistencies(
  moduleData: Pick<ModuleData, "scenes">,
  mythosModule: Pick<MythosModule, "sceneDescriptions" | "exits">,
): RepresentationInconsistency[] {
  const aNames = new Set(moduleData.scenes.map((s) => stripBracketSuffix(s.name)));
  const bNames = mythosSceneNodeNames(mythosModule);
  const out: RepresentationInconsistency[] = [];
  for (const name of bNames) {
    if (!aNames.has(name)) {
      out.push({ category: "scene_set", key: name, detail: "MythosModule 场景图节点，ModuleData.scenes 没有对应场景" });
    }
  }
  for (const name of aNames) {
    if (!bNames.has(name)) {
      out.push({ category: "scene_set", key: name, detail: "ModuleData.scenes 有，MythosModule 场景图节点没有" });
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// 汇总
// ────────────────────────────────────────────────────────────

export function findRepresentationInconsistencies(
  moduleData: Pick<ModuleData, "scenes" | "npcs">,
  mythosModule: Pick<MythosModule, "npcs" | "endings" | "sceneDescriptions" | "exits">,
  endNarrations: { id: string }[],
): RepresentationInconsistency[] {
  return [
    ...findNpcSceneInconsistencies(moduleData, mythosModule),
    ...findNumericFactInconsistencies(moduleData, mythosModule),
    ...findEndingIdInconsistencies(endNarrations, mythosModule),
    ...findSceneSetInconsistencies(moduleData, mythosModule),
  ];
}

/** 便捷入口：直接对真实的谷仓两份表示跑一遍。 */
export function findBarnRepresentationInconsistencies(): RepresentationInconsistency[] {
  return findRepresentationInconsistencies(BARN_OF_PREMIER, MODULE_PREMIERS_BARN, END_NARRATIONS);
}

// ────────────────────────────────────────────────────────────
// 已知不一致登记表——照 KNOWN_UNREACHABLE / FABRICATION_REGISTRY /
// CONFIRMED_FABRICATION_LOG 的既有惯例：判据跑出来的红条目必须逐条
// 登记在这里，名单外新出现的不一致会让判据变红；名单归零 = 收敛完成。
// ────────────────────────────────────────────────────────────

export interface KnownInconsistency {
  category: InconsistencyCategory;
  key: string;
  /** 为什么先登记不先修，以及（对 npc_scene/numeric_fact 这类真正
   *  存在事实分歧的条目）裁决哪一侧对——N10 B1 先登记发现，N10 B2
   *  逐条核对 tools/modules/raw/ 原文后把 reason 换成裁决结论；
   *  scene_set 类条目从一开始就是结构性差异，不是事实分歧，B1
   *  给出的结构成因本身就是结论，不需要另外裁决对错。 */
  reason: string;
}

export const KNOWN_INCONSISTENCIES: KnownInconsistency[] = [
  {
    category: "npc_scene",
    key: "艾德里安·埃斯特鲁姆",
    reason:
      "B2 裁决：MythosModule 错（sceneId=艾德里安的农场）。原文 section_11.txt 抓捕通报写着他被捕枪伤后" +
      "「于霍姆斯医院接受治疗，处于意识不清状态」——ModuleData（与艾德里安的会面/医院）对，MythosModule" +
      "把他抓捕前的落脚点当成了故事发生时的当前位置。核对不出出处，本轮只裁决不改数据（B3 才定收敛方案）。",
  },
  {
    category: "npc_scene",
    key: "艾米丽·埃斯特鲁姆",
    reason:
      "B2 裁决：不算错，是场景颗粒度差异。原文 section_12.txt:1-38「维修间：」这一节本身把「▶比较大的" +
      "奇怪管道」「▶艾米丽与爱莉的棺材」写成同一场景块内的 ▶ 子小节——ModuleData 把它们并成一个场景" +
      "（maintenance_room）与 MythosModule 拆成独立场景节点，两者都对得上原文结构，只是颗粒度不同。",
  },
  {
    category: "npc_scene",
    key: "爱莉·埃斯特鲁姆",
    reason: "B2 裁决：同「艾米丽·埃斯特鲁姆」条——不算错，是场景颗粒度差异，两侧站位都对得上原文结构。",
  },
  {
    category: "npc_scene",
    key: "流浪汉",
    reason:
      "B2 裁决：MythosModule 错（sceneId=农场外围）。原文 section_06.txt:50-62 逐字写着流浪汉占据的是" +
      "艾德里安在镇内那栋荒废的独门独户小别墅（与「艾德里安在镇子内的住宅」这个场景的描述文本逐句对上），" +
      "农场周围的原文段落从未出现过流浪汉。ModuleData 对。核对不出出处，本轮只裁决不改数据。",
  },
  {
    category: "npc_scene",
    key: "Mi-Go（来自尤格斯的真菌）",
    reason:
      "B2 裁决：MythosModule 错（sceneId=下水道）。原文 section_12.txt:25-38 写明米戈出现的地点是" +
      "「维修间」场景内部的「▶比较大的奇怪管道」子小节，下水道只是去维修间必经的更早一跳路径，不是米戈" +
      "现身的地方。ModuleData（maintenance_room）对。核对不出出处，本轮只裁决不改数据。",
  },
  {
    category: "numeric_fact",
    key: "绑架人数",
    reason:
      "B2 裁决：MythosModule 错（写 11）。原文受害者档案通报明确写的是 10 人，MythosModule 把「第 11 次" +
      "行动被警方发现交火」（这次行动本身就是失败被捕）和「总共绑架了多少人」两件事混成了一件事。" +
      "ModuleData（10）对。核对不出出处，本轮只裁决不改数据。",
  },
  { category: "scene_set", key: "奇怪的卡片", reason: "ModuleData 侧是 clue_card（线索不是场景），MythosModule 把线索建成了伪场景节点" },
  { category: "scene_set", key: "旅店", reason: "ModuleData 侧有孤儿常量 S.HOTEL（barn-of-premier.ts）但从未接进 buildScenes()，是真地点但漏建" },
  { category: "scene_set", key: "比较大的奇怪管道", reason: "ModuleData 侧并进了 maintenance_room 场景内的 clue_final_pipe，不是独立场景" },
  { category: "scene_set", key: "艾米丽与爱莉的棺材", reason: "ModuleData 侧并进了 maintenance_room 场景内的 clue_final_coffin，不是独立场景——也是上面 3 条 npc_scene 里 Emily/Ailey 站位矛盾的根源" },
  { category: "scene_set", key: "菲碧_特里坎", reason: "MythosModule 把 NPC 建成了可导航的伪场景节点，ModuleData 侧只用 Scene.npcIds 挂在 tricam_house 下" },
  { category: "scene_set", key: "米尔_特里坎", reason: "同上，MythosModule 把 NPC 建成了伪场景节点" },
];
