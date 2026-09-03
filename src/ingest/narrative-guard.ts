// 摄取管线 · 创作层约束接线（todo-52 任务②）。
//
// 背景见 docs/notes/ingest.md「叙事层立项」与 todo-52：创作层是摄取
// 管线第一条【允许编】的通道，但"允许编"不是"随便编"——三档约束里
// 只有前两档进管线当门禁（确定性、可 scale），第三档（语义蕴含扫描）
// 按设计不进这里，见 todo-52 的分工说明。
//
// 第一档：禁止新造实体/专名。
//   生成文本不该凭空发明专有名词或黑话（反例：【共鸣特质】，
//   `three-way-audit.ts` 文件头记录过这个真实臆造案例，原文 0 命中）。
//   复用 three-way-audit 的既有能力（`extractBracketTerms` +
//   `termAppearsInCorpus`）而不是重新发明一套检测——生成文本沿用同一个
//   约定：想引入原文没有的专名/术语，必须用【】标出来，方便审计；
//   没有标注的普通描述词（阴冷、潮湿）不受此限，因为它们根本不会被
//   提取成候选术语。
//
// 第二档：可交互对象称呼必须能被 decideClueMatch 命中。
//   这是"培养缸"那次事故（`docs/notes/engine.md`「引擎教了玩家一个
//   自己不认识的词——这是第二次」，commit 7d9e6f1）的机器化版本：那次
//   是 KP 叙事教了玩家一个匹配器不认识的词，靠实跑自然语句才发现。
//   生成时手上就有场景的线索集，能在生成的那一刻直接断言，不必等
//   实跑撞见。做法：生成端必须显式声明"这段文本用哪个称呼指代哪条
//   线索"（`ObjectMentionClaim`），不是让判据去散文里猜——判据只对
//   声明过的每一条断言 `decideClueMatch` 真的认得这个称呼，认不出来
//   就是这段生成内容不合格，与 `narrative-vocabulary-registry.ts`
//   "显式登记 + 判据对每一条断言"同一个模式，只是这里的"登记"是
//   生成时当场做的，不是事后人工补的。

import { extractBracketTerms, termAppearsInCorpus } from "./three-way-audit";
import { decideClueMatch, type ClueMatchCandidate } from "../investigation/clue-match";

/**
 * 第一档：从生成文本里抽出【】标注的术语，返回原文语料查不到的那些。
 * 空数组 = 没有可疑的新造术语。
 *
 * `extractBracketTerms` 本是给源码文件写的（会跳过 `//` 注释行），但
 * 生成的叙事文本不会有这种行，直接复用不需要改它的实现。
 */
export function findFabricatedTerms(generatedText: string, corpusText: string): string[] {
  return extractBracketTerms(generatedText).filter((term) => !termAppearsInCorpus(term, corpusText));
}

/** 生成端对"这段文本用哪个称呼指代哪条线索"的显式声明 */
export interface ObjectMentionClaim {
  /** 生成文本里实际用的称呼 */
  phrase: string;
  /** 生成时自称在指代这条线索的 id */
  clueId: string;
}

/**
 * 第二档：声明的每一条对象称呼都必须能被 `decideClueMatch` 命中回
 * 声明的那个线索 id。返回命中失败的声明（空数组 = 全部属实）。
 *
 * 失败的两种情形都要抓：命中别的线索（声明与实际所指对不上）、
 * 或者压根没命中任何线索（`ask`/`deny`/`fallback`）——"培养缸"那次
 * 事故属于后一种：候选文本里没有这个词，`decideClueMatch` 认不出来。
 */
export function findUnresolvedObjectMentions(
  claims: ObjectMentionClaim[],
  candidates: ClueMatchCandidate[],
): ObjectMentionClaim[] {
  const failed: ObjectMentionClaim[] = [];
  for (const claim of claims) {
    const decision = decideClueMatch(claim.phrase, candidates);
    if (decision.kind !== "resolve" || decision.clueId !== claim.clueId) failed.push(claim);
  }
  return failed;
}

/**
 * 把场景的线索列表转成 `decideClueMatch` 要的候选形状——与
 * `game-session.ts` 组装 `matchTexts` 时用的字段一致（`clue.name` +
 * `findMethods[].description`），只是摄取管线产的线索目前
 * `findMethods` 恒为空数组（`build-clues.ts` 的范围决策），所以候选
 * 文本这里通常只有线索名一项。
 */
export function clueCandidatesForScene(clues: { id: string; name: string; findMethods: { description: string }[] }[]): ClueMatchCandidate[] {
  return clues.map((c) => ({ id: c.id, texts: [c.name, ...c.findMethods.map((f) => f.description)] }));
}
