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
// 第二档：可交互对象称呼必须能被 decideClueMatch 命中——从"拒绝"
//   改为"学会"（开发·别名迁移轮 D 组）。
//
//   这是"培养缸"那次事故（`docs/notes/engine.md`「引擎教了玩家一个
//   自己不认识的词——这是第二次」，commit 7d9e6f1）的机器化版本：那次
//   是 KP 叙事教了玩家一个匹配器不认识的词，靠实跑自然语句才发现。
//   生成时手上就有场景的线索集，能在生成的那一刻直接断言，不必等
//   实跑撞见。
//
//   第一版（todo-52 实现轮）只做到"拒绝"：声明的称呼命中不了就整批
//   不采纳。真实管线跑了三轮，三轮全部被拦下——但复盘 7d9e6f1 那次
//   真实事故会发现，它的实际修法从来不是"禁止叙事用这些词"，是**把
//   这些词加进 matchTexts**。拒绝是在保护"不要出现匹配不上的叙事"，
//   但真正想要的是"叙事想用的词，匹配器都得跟着认识"——这次改成
//   自动学会：声明的称呼满足三条确定性条件就直接接纳为这条线索的
//   新别名（写进 `Clue.matchTexts`，见 `build-narrative.ts` 的
//   `applyNarrative`），不满足就还是老办法，不采纳这段生成内容。
//
//   三条确定性条件（`evaluateObjectMentionClaims`）：
//     a. 声明指代的线索 C 在本场景真实存在——0/3 第一版实测里前两次
//        栽的就是这个（模型编了一个不存在的线索 id）。
//     b. 把声明的称呼 P 加进候选池之后，`decideClueMatch(P)` 在本场景
//        唯一命中 C（不是 ask，不是 deny，不是命中别的线索）。
//     c. P 不出现在本场景**其它**线索的 name/description/findMethods
//        文本里——这是"过泛"的可检测代理。7d9e6f1 当时明确排除过
//        "设备"/"容器"这类词，理由不是"它们在别的场景会重名"（候选池
//        本来就按场景取，不存在跨场景污染），是"同一个场景内可能有
//        好几条线索都能被这个词描述，只有一条会被接纳，玩家说出这个
//        词时会拿到错的那个"——检查它是否已经出现在同场景其它线索
//        自己的描述文本里，是能机器判定的、最接近这条真实理由的代理
//        检查。
//
//   能力边界（不装作能做到）：没有任何确定性检查能验证"P 真的在描述
//   C"这件事本身——生成端完全可以声明一个语义上毫不相关、但字面上
//   恰好满足 a/b/c 的称呼，判据拦不住。这个洞只能靠语义判断堵，按
//   todo-52 的分工原则，语义判断是第三档，不进管线。代价评估：接纳
//   一个错误别名的后果是"玩家说这个词会命中错误的线索"，是轻度玩法
//   错误（可能问出一个文不对题但依然存在的线索），不是伪造事实（不会
//   凭空生成一个原文不存在的对象/情节）——这与拒绝一条本该被接纳的
//   称呼相比，风险量级更小，是本轮愿意接受这个洞的理由。

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

/** 场景内一条线索的可判据信息——条件 c 需要 description，比 ClueMatchCandidate 多一个字段 */
export interface SceneClueContext {
  id: string;
  name: string;
  description: string;
  findMethods: { description: string }[];
  matchTexts?: string[];
}

export interface ClaimEvaluation {
  claim: ObjectMentionClaim;
  accepted: boolean;
  /** 接纳或拒绝的理由，进 warnings/provenance，人能看懂发生了什么 */
  reason: string;
}

/**
 * 条件 b 的核心判定，从 `evaluateObjectMentionClaims` 抽出来单独导出——
 * 开发·把已有判据补齐到手写侧 N8：这条件原本只在"生成端提议一条新
 * 别名"这个场景里跑，`barn-of-premier.ts` 里手写的 matchTexts（如
 * weisen_bar 三条线索）从来没有经过它，于是出现了机器别名被挡、人写
 * 别名不被挡的覆盖不对称——「前台」同时进了两条线索的 matchTexts，
 * 没有任何判据发现过。
 *
 * 抽出来是为了让"检查一条别名是否加入候选池后仍能唯一命中目标线索"
 * 这件事只有一处实现——`evaluateObjectMentionClaims`（生成时的
 * 单条候选门禁）与 `findMatchTextCollisions`（scene-matchtext-
 * collision.ts，扫全部已提交数据）都调用这同一个函数，不是两边各自
 * 写一份 decideClueMatch 判断，那两套判定迟早会漂——这正是这次要修的
 * 病，不能在修的过程中又添一次同类风险。
 */
export function resolvesUniquelyTo(
  phrase: string,
  targetClueId: string,
  candidates: ClueMatchCandidate[],
): boolean {
  const decision = decideClueMatch(phrase, candidates);
  return decision.kind === "resolve" && decision.clueId === targetClueId;
}

/**
 * 第二档主判据：对声明的每一条对象称呼跑三条确定性条件（a/b/c，见
 * 文件头），返回逐条的接纳/拒绝结果——不是简单的布尔，因为拒绝理由
 * 要进 warnings，接纳理由要进 provenance，两边都得留痕。
 *
 * 同一批声明按顺序评估、边评估边把已接纳的别名并入候选池——这样同一
 * 场景内后面的声明能看到前面刚学会的别名（条件 b 判断"唯一命中"时
 * 用的是当前为止的完整候选池，不是评估开始前的快照）。
 */
export function evaluateObjectMentionClaims(
  claims: ObjectMentionClaim[],
  sceneClues: SceneClueContext[],
): ClaimEvaluation[] {
  const results: ClaimEvaluation[] = [];
  const byId = new Map(sceneClues.map((c) => [c.id, c]));
  /** 本批次内已接纳的别名，逐条累加——条件 b 的候选池要看得见它们 */
  const learned = new Map<string, string[]>();

  const buildCandidates = (): ClueMatchCandidate[] =>
    sceneClues.map((c) => ({
      id: c.id,
      texts: [c.name, ...c.findMethods.map((f) => f.description), ...(c.matchTexts ?? []), ...(learned.get(c.id) ?? [])],
    }));

  for (const claim of claims) {
    // 条件 a：声明指代的线索在本场景真实存在
    const target = byId.get(claim.clueId);
    if (!target) {
      results.push({
        claim,
        accepted: false,
        reason: `声明的线索 id「${claim.clueId}」不在本场景线索列表里——这正是第一版实测两次真实撞见的失败模式（模型编了一个不存在的 id）`,
      });
      continue;
    }

    // 条件 c：P 不出现在同场景其它线索自己的 name/description/
    // findMethods 文本里——"过泛"的可检测代理，理由见文件头。
    const conflictsWith = sceneClues.find((c) => {
      if (c.id === claim.clueId) return false;
      const otherTexts = [c.name, c.description, ...c.findMethods.map((f) => f.description)];
      return otherTexts.some((t) => t.includes(claim.phrase));
    });
    if (conflictsWith) {
      results.push({
        claim,
        accepted: false,
        reason: `称呼「${claim.phrase}」也出现在本场景另一条线索「${conflictsWith.name}」自己的描述文本里，太泛，不收——7d9e6f1 排除"设备"/"容器"类词同一个理由`,
      });
      continue;
    }

    // 条件 b：加入候选池之后，decideClueMatch(P) 必须在本场景唯一命中 C
    const candidates = buildCandidates().map((c) =>
      c.id === claim.clueId ? { ...c, texts: [...c.texts, claim.phrase] } : c,
    );
    if (!resolvesUniquelyTo(claim.phrase, claim.clueId, candidates)) {
      const decision = decideClueMatch(claim.phrase, candidates);
      results.push({
        claim,
        accepted: false,
        reason: `称呼「${claim.phrase}」加入候选池后 decideClueMatch 未能唯一命中线索「${claim.clueId}」（结果：${decision.kind}）`,
      });
      continue;
    }

    if (!learned.has(claim.clueId)) learned.set(claim.clueId, []);
    learned.get(claim.clueId)!.push(claim.phrase);
    results.push({
      claim,
      accepted: true,
      reason: "满足三条确定性条件（线索存在 / 加入后唯一命中 / 不与同场景其它线索文本冲突），自动接纳为别名",
    });
  }

  return results;
}

/**
 * 把场景的线索列表转成 `decideClueMatch` 要的候选形状——与
 * `game-session.ts` 组装 `matchTexts` 时用的字段一致（`clue.name` +
 * `findMethods[].description` + `matchTexts`），只是摄取管线产的线索
 * 目前 `findMethods` 恒为空数组（`build-clues.ts` 的范围决策），
 * `matchTexts` 同样恒为空（同一份决策，见该文件头部）——候选文本这里
 * 通常只有线索名一项，除非上一轮已经学会过别名（开发·别名迁移轮 D 组：
 * 自动接纳的称呼写回 `Clue.matchTexts`，这里读到的是"目前为止已经
 * 学会的全部称呼"，不是本次生成新声明的那些——本次新声明能不能通过
 * 走的是 `findUnresolvedObjectMentions` 单独那条判断）。
 */
export function clueCandidatesForScene(
  clues: { id: string; name: string; findMethods: { description: string }[]; matchTexts?: string[] }[],
): ClueMatchCandidate[] {
  return clues.map((c) => ({ id: c.id, texts: [c.name, ...c.findMethods.map((f) => f.description), ...(c.matchTexts ?? [])] }));
}
