// 叙事用词 → 线索/场景 id 的登记表（开发·真相链路 任务③）。
//
// 背景：本轮修的两个真实案例都是同一形状——引擎自己写的叙事教了玩家
// 一个匹配键不认识的词：clue_bedroom_diary 的揭示文本教玩家"下水道
// 维修室"，但场景表里的正式名字是"维修间"（2c38d2c）；True End/
// near_truth/ENCOUNTER_NARRATIONS 反复用"培养缸"/"一大一小"称呼
// clue_final_brain_jars，但它的 matchTexts 只有线索名与 findMethod
// 原文（开发·真相链路 任务①）。这不是"叙事用词必须在原文里"（那太
// 严——创作层允许新词），是更窄的一条：**引擎叙事里出现过的可交互对象
// 称呼，玩家说出来必须能命中对应线索/场景**——引擎不能自己发明一个词
// 教给玩家，然后让匹配器听不懂这个词。
//
// 与 KNOWN_UNREACHABLE（end-narration-clue-reachability.test.ts）、
// FABRICATION_REGISTRY（three-way-audit.ts）同一种模式：显式登记，
// 判据对登记表里每一条跑真实匹配器断言命中，不是自动扫散文抓词。
//
// ⚠⚠ 能力边界（同 three-way-audit.ts:21-23 的处理方式，别让下一个人
// 以为这张表覆盖了"所有叙事用词"）：这份登记表**只保护表里已经写明的
// 这些词**，不做散文分词、不自动从 barn-of-premier.ts 的叙事文本里
// 提取新词、也不判断"还有没有别的叙事用词同样没被匹配器认识"——新的
// 叙事用词断链只能靠人工阅读叙事文本发现（就像本轮"培养缸"是靠实测
// 自然语句而不是靠工具扫出来的），发现后手动加一条登记，登记表本身
// 不会主动提醒"这里可能还有一个"。

/** 叙事用词命中的目标——线索（用 decideClueMatch 验证）或场景（用 resolveSceneTarget 验证）。 */
export type NarrativeVocabularyTarget =
  | { kind: "clue"; sceneName: string; clueId: string }
  | { kind: "scene"; sceneId: string };

export interface NarrativeVocabularyEntry {
  /** 引擎叙事里实际出现过、玩家会拿来指代这个对象/地点的词 */
  phrase: string;
  target: NarrativeVocabularyTarget;
  /** 这个词出现在哪段叙事里，为什么登记它 */
  note: string;
}

export const NARRATIVE_VOCABULARY_REGISTRY: NarrativeVocabularyEntry[] = [
  {
    phrase: "培养缸",
    target: { kind: "clue", sceneName: "维修间", clueId: "clue_final_brain_jars" },
    note: "True End 第3行、near_truth 第1行、ENCOUNTER_NARRATIONS 三处都用这个词称呼两个缸中脑（barn-of-premier.ts 5 处数据行）。开发·真相链路 任务①修复。",
  },
  {
    phrase: "玻璃缸",
    target: { kind: "clue", sceneName: "维修间", clueId: "clue_final_brain_jars" },
    note: "near_truth 第1行「两个培养缸静静地漂浮」的候选措辞——玩家转述时常见的同义替换，一并核实收录。开发·真相链路 任务①修复。",
  },
  {
    phrase: "一大一小",
    target: { kind: "clue", sceneName: "维修间", clueId: "clue_final_brain_jars" },
    note: "near_truth 第1行「一大一小，是艾米丽和爱莉」原句用词。开发·真相链路 任务①修复。",
  },
  {
    phrase: "营养液",
    target: { kind: "clue", sceneName: "维修间", clueId: "clue_final_brain_jars" },
    note: "True End 第3行「靠着营养液活着」、clue_final_brain_jars.description 本身、mythos-module.ts 艾米丽 secrets 都用这个词描述这两具缸中脑的生存介质。开发·真相链路 任务①修复。",
  },
  {
    phrase: "维修室",
    target: { kind: "scene", sceneId: "维修间" },
    note: "clue_bedroom_diary 的揭示文本「打开下水道维修室门」教玩家这个词，但场景表正式名字是「维修间」。开发·卧室线索修复 任务②修复（2c38d2c）——本条是那次修复的回归保护，登记在这张表里避免被后续改动悄悄撤掉而没有判据发现。",
  },
];
