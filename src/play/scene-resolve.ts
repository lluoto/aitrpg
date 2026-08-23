// 「玩家打的这句话指的是哪个场景」—— 自由跑团（API／真人）那条路的移动解析。
//
// ⚠ 这是**第二套**移动匹配，与 `move-util.ts` 的 `chooseConnection` 各管一条循环：
//     play-module.ts       剧本杀，出口是有限的几条连接   → chooseConnection
//     api/game-session.ts  自由跑团，目标是全模组任一场景 → 本文件
// 输入形态不同（前者在候选出口里选，后者在全部场景里选），所以没有硬合并；
// 但**判据是同一套**，两边都得能区分对错。
//
// 从 `GameSession.tryResolveModuleScene` 抽出来的。抽的理由：
// 它此前是 private、返回值在两个调用点都被丢掉、只有一条 happy-path 测试
// （`game-session.test.ts` 的「移动到谷仓」）。也就是说**真人那条路的移动匹配
// 几乎没有判据** —— 而剧本杀那条路的同类毛病已经查出来一串。
//
// 抽取时**逐字保持原行为**，先量再改（`tools/_probe-scene-resolve.ts` 量出 8/11），
// 然后才动。反过来做就是「先改实现再补用例」，补出来的必然是「刚好能过」的用例。
//
// 与抽取前的行为差别只有两处，都是为了别再骗玩家：
//   · 被否定／已去过的提及不再算命中（「**别去**警察局」）
//   · 把握不足的命中标 `forced`，由调用方说出来

import { isRejectedMention } from "./move-util";

export interface SceneRow { id: string; name: string }

interface SceneResolveInput {
  said: string;
  /** id → 展示名 */
  displayNames: Record<string, string>;
  /** id → 别名列表 */
  aliases: Record<string, string[]>;
  /** 世界里注册过的场景 */
  rows: readonly SceneRow[];
}

interface SceneResolveResult {
  sceneId: string | null;
  /**
   * true = 没认准，是引擎按相似度挑的。
   *
   * 原实现**没有这个概念**：要么静默移动、要么静默不动，玩家一个字都看不到。
   * 剧本杀那条路早就因此改过（`MoveChoice.forced` + 那句「没听清要去哪」），
   * 真人这条路反而一直没有 —— 而真人才是会打出「别去警察局」的那个。
   */
  forced: boolean;
  /** 命中哪条规则。报告与测试钉它 —— 分类碰巧对了但走错规则同样是坏的 */
  via: "display-name" | "alias" | "row-exact" | "contains" | "bigram" | "none";
}

/**
 * bigram 命中多少才算「认准了」。低于这个数仍然采纳（保住原有宽容度，
 * 免得真人打字稍有出入就完全动不了），但标成 `forced`，由调用方明说。
 *
 * 注意：`>= 1` 这个采纳门槛**没有动**。实测（`tools/_probe-scene-resolve.ts`）
 * 四句完全没提地名的话得分都是 0，并不会把人搬走 ——
 * 我一度断言「阈值 1 等于几乎任何一句话都能匹配上」，量完发现是错的。
 */
export const BIGRAM_CONFIDENT = 3;

/** bigram 相似度：`b` 里有多少个二元组也出现在 `a` 里 */
export function bigramScore(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) grams.add(a.slice(i, i + 2));
  let score = 0;
  for (let i = 0; i < b.length - 1; i++) if (grams.has(b.slice(i, i + 2))) score++;
  return score;
}

/**
 * 把一句话解析成场景 id。**行为与抽取前逐字一致。**
 *
 * 匹配顺序：
 *   1. 展示名 / id 精确
 *   2. 别名精确
 *   3. 注册表里 name / id 精确
 *   4. 包含关系（「警察局了解案情」→ 警察局；「谷仓」→ 谷仓形建筑）
 *   5. bigram 相似度，阈值 `>= 1`
 */
export function resolveSceneTarget(input: SceneResolveInput): SceneResolveResult {
  const t = (input.said ?? "").trim();
  if (!t) return { sceneId: null, forced: false, via: "none" };

  // 1/2/3：精确匹配。整句就是地名，没有歧义可言。
  for (const [id, name] of Object.entries(input.displayNames)) {
    if (name === t || id === t) return { sceneId: id, forced: false, via: "display-name" };
  }
  for (const [id, list] of Object.entries(input.aliases)) {
    if (list.includes(t)) return { sceneId: id, forced: false, via: "alias" };
  }
  for (const r of input.rows) {
    if (r.id === t || r.name === t) return { sceneId: r.id, forced: false, via: "row-exact" };
  }

  const usable = input.rows.filter((r) => r.name && r.name !== "unknown");

  // 4. 包含：目标包含场景名（「警察局了解案情」→ 警察局）
  //    或场景名包含目标（「谷仓」→ 谷仓形建筑）
  //
  // ⚠ **提到 ≠ 要去**。「别去警察局」「警察局那边已经去过了」都含「警察局」。
  // 原实现直接按「名字最长」挑，于是这三句全都把人搬到被否定的那个地方去。
  // 实测 11 条里错 3 条，而唯一「过了」的那条是**靠长度蒙的** ——
  // 被否定的地名恰好比目标短。换个更长的立刻现形。
  // 判据复用 `move-util` 的 `isRejectedMention`（那边已有正反例测试）。
  const mentioned = usable.filter((r) => t.includes(r.name));
  const alive = mentioned.filter((r) => !isRejectedMention(t, r.name));
  let best: SceneRow | null = null;
  for (const r of alive) {
    if (!best || r.name.length > best.name.length) best = r;
  }
  if (!best) {
    // 反向包含：玩家说的是场景名的一部分（「谷仓」→「谷仓形建筑」）。
    // 取最短的那个 —— 名字越短越接近他说的那几个字。
    for (const r of usable) {
      if (mentioned.includes(r)) continue;
      if (r.name.includes(t) && t.length >= 2) {
        if (!best || r.name.length < best.name.length) best = r;
      }
    }
  }
  if (best) {
    // 还剩不止一个候选时，说明是按启发式挑的，得承认
    return { sceneId: best.id, forced: alive.length > 1, via: "contains" };
  }

  // 5. bigram 公共子串。宽容度保留（采纳门槛仍是 >= 1），但把握不足要承认。
  let bestGram: SceneRow | null = null;
  let bestGramScore = 0;
  for (const r of usable) {
    // ⚠ `isRejectedMention` 对「压根没提到」返回 **true**（语义是「没有一处干净的提及」）。
    // 那在 `chooseConnection` 里没问题 —— 它只对已经确认出现过的键调用。
    // 这里不行：bigram 这一步本来就是给**不含完整地名**的句子兜底的，
    // 无条件用它过滤等于把整步废掉（实测「移动到谷仓」当场从命中变成不动）。
    // 只有**提到了而且被排除**才跳过。
    if (t.includes(r.name) && isRejectedMention(t, r.name)) continue;
    const score = bigramScore(t, r.name);
    if (score >= 1 && score > bestGramScore) { bestGramScore = score; bestGram = r; }
  }
  if (bestGram) {
    return { sceneId: bestGram.id, forced: bestGramScore < BIGRAM_CONFIDENT, via: "bigram" };
  }

  return { sceneId: null, forced: false, via: "none" };
}
