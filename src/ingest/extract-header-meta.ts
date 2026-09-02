// 摄取管线：era / 部分 meta 抽取。
//
// 前言块（sectionize.ts 里第一个真正的标题，通常叫「前言」，但标题字面
// 因作者而异，这里不认标题名，认内容里的结构信号）里混着好几类信息：
// 年代、推荐人数、时长、内容预警、一段介绍模组类型的文字。
// 这些信息不是同一种「抽取难度」，分两半处理：
//
//   era / playerCount / expectedDuration —— 有固定的「标签词 + 值」结构
//     （「1921 年」「人数为 2~3 人」「长度中短」），能用位置信号确定性
//     抽取，抽不到就留空，不猜。
//
//   summary / triggerWarnings —— 没有这种标签词。要把哪几句话算进摘要、
//     警示句要不要拆成几条、从哪里切到哪里，都是编辑判断，不是结构抽取。
//     同一个「一个字都不编」的纪律在这里意味着：宁可两个字段都留空，
//     也不要在没有位置信号的地方替作者做编辑决定。
//     （这与 assemble-module.ts 顶部纪律同源：字段留空是诚实的「没抽到」，
//     不是「懒得做」。）
import type { Section } from "./sectionize";

export interface HeaderMeta {
  era: string;
  meta: {
    playerCount: string;
    expectedDuration: string;
    /** 结构性理由见文件头注释：需要编辑判断，本轮不做，恒为空数组 */
    triggerWarnings: string[];
  };
  warnings: string[];
}

/** 1500~2099 年，后面紧跟「年」。范围宽松是因为不想在这里对模组年代设定做假设 */
const ERA_PATTERN = /(1[5-9]\d{2}|20\d{2})\s*年/;

/** 「人数」附近的一个数字或「数字~数字」区间，后面跟「人」 */
const PLAYER_COUNT_PATTERN = /人数[^0-9]{0,6}(\d+\s*[~～\-]\s*\d+|\d+)\s*人/;

/**
 * 「长度」紧跟一个时长描述词。
 *
 * 不能直接抓「长度后面的任意几个字」——「长度」本身是常见词，
 * 可能出现在与时长无关的句子里（「……的长度的正文」），那样会把
 * 下一句话的开头几个字当成时长。收窄到一个封闭的描述词表，
 * 表外的词宁可不认，也不要把无关文字当成时长。
 */
const DURATION_WORDS = ["中短", "中长", "较长", "较短", "偏长", "偏短", "很长", "很短", "中等", "长", "中", "短"];
const DURATION_PATTERN = new RegExp(`长度[：:]?\\s*(${DURATION_WORDS.join("|")})`);

/**
 * 从切分出的块里抽 era 与部分 meta 字段。
 *
 * 不认标题名（不同模组的前言可能叫「前言」「导入」「简介」），扫描全部
 * 块的 title+body，取文档序上第一个命中。
 */
export function extractHeaderMeta(sections: Section[]): HeaderMeta {
  const warnings: string[] = [];
  let era = "";
  let playerCount = "";
  let expectedDuration = "";

  for (const s of sections) {
    const text = `${s.title}\n${s.body}`;
    if (!era) {
      const m = text.match(ERA_PATTERN);
      if (m) era = m[1] as string;
    }
    if (!playerCount) {
      const m = text.match(PLAYER_COUNT_PATTERN);
      if (m) playerCount = (m[1] as string).replace(/\s+/g, "").replace("～", "~").replace("-", "~");
    }
    if (!expectedDuration) {
      const m = text.match(DURATION_PATTERN);
      if (m) expectedDuration = m[1] as string;
    }
  }

  if (!era) warnings.push("era 没抽到 —— 原文没找到「四位数字 + 年」的年代标记");
  if (!playerCount) warnings.push("meta.playerCount 没抽到 —— 原文没找到「人数……人」的推荐人数标记");
  if (!expectedDuration) warnings.push("meta.expectedDuration 没抽到 —— 原文没找到「长度……」的时长标记");
  warnings.push(
    "summary / meta.triggerWarnings 未抽取，留空 —— 两者都要求从多句原文里做编辑取舍" +
      "（挑哪几句算摘要、警示句拆成几条），不是结构抽取，没有位置信号，硬做就是编",
  );

  return { era, meta: { playerCount, expectedDuration, triggerWarnings: [] }, warnings };
}
