// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type { SceneConnection, NarrativeEntity } from "../module/types";
import { occupationTagWeight } from "../agent/player-agent";

/**
 * 这个职业会不会下意识把话里的东西和眼前景物对上。
 *
 * 抽成模块级纯函数只为一件事：能测。
 */
export function noticesEntity(occupation: string, ent: Pick<NarrativeEntity, "noticedBy">): boolean {
  const habits = ent.noticedBy ?? [];
  return habits.length === 0 || habits.some((h) => occupation.includes(h));
}

/**
 * 这句移动示意是不是纯粹在复述目的地。
 *
 * 紧接着就会打出场景标题（"━ 再次来到 农场外围（陷阱区）"），
 * 所以"返回农场外围。"这种只报地名的句子等于把同一件事说了两遍。
 * 但"前往艾德里安的病房（需通过门口警员的检查）"带着额外条件，那句得留下 ——
 * 判据是去掉动词与括号补充之后，剩下的是不是就等于场景名本身。
 */
export function isRedundantMoveLine(condition: string, targetSceneName: string): boolean {
  // 括号只从场景名剥：标题里的"（陷阱区）"是标注，而 condition 里的括号
  // 往往是真信息（"（需通过门口警员的检查）"），跟着一起剥掉就会把它误判成复述、
  // 连那句提示一并吞掉。
  const tidy = (s: string) => s.replace(/[。，、\s]+$/, "").trim();
  const full = tidy(targetSceneName);
  // 场景名自己就可能带括号，而且两种写法都算复述：
  //   "农场外围（陷阱区）" ← "进入农场外围（陷阱区）" 连括号一起复述
  //   "建筑内（谷仓大厅）" ← "返回谷仓大厅" 只复述括号里那部分
  const bare = tidy(full.replace(/[（(][^）)]*[）)]/g, ""));
  const inner = tidy((full.match(/[（(]([^）)]*)[）)]/) ?? [])[1] ?? "");
  const stripped = tidy(condition).replace(/^(返回|回到|前往|进入|离开|去)/, "").trim();
  if (!stripped) return true;
  return stripped === full || stripped === bare || (inner !== "" && stripped === inner);
}

/** `chooseConnection` 要问世界的那几件事。抽成接口是为了让它能脱离 WorldState 单测 */
export interface MoveWorldView {
  isSceneVisited(sceneId: string): boolean;
  visitCount(sceneId: string): number;
  /** 模组里到底有没有这个场景。指向不存在场景的连接必须排最后 —— 见下面 -5 那一支 */
  sceneExists(sceneId: string): boolean;
  /** 目标场景的真名。condition 和场景名可以不一样（「返回镇上」→「普瑞米尔」）*/
  sceneName(sceneId: string): string;
}

/**
 * 一次匹配的过程记录。**只供诊断与测试读，剧本逻辑不看它。**
 *
 * 为什么要留痕：`tools/_diag-phrasing.ts` 只拿得到 `conn + forced`，
 * 于是它能说「没对上」，说不出**为什么**没对上 ——
 * 是一个键都没命中，还是命中了别人的键，还是好几条都命中、
 * 靠列表顺序抢先。这三种是完全不同的毛病：
 *   第一种要加同义词，第二种要处理否定，第三种要处理歧义。
 * 混在一个「命中率 90.3%」里，等于知道有病但不知道病在哪。
 */
export interface MoveMatchTrace {
  /** 每条连接考虑过哪些键 */
  candidates: { targetSceneId: string; keys: string[] }[];
  /** 哪些连接的键出现在这句话里，按 `unlocked` 的顺序 */
  matched: { targetSceneId: string; key: string }[];
  /**
   * 命中项在 `unlocked` 里的下标；-1 表示没命中。
   * 有多条命中时，胜出的永远是下标最小的那条 —— 也就是**靠顺序赢的**。
   */
  winnerIndex: number;
  /** forced 时的打分结果，按降序 */
  scores: { targetSceneId: string; score: number }[];
}

export interface MoveChoice {
  conn: SceneConnection | null;
  /**
   * true = 玩家说的话没对上任何一条连接，这个目的地是引擎按分数替他挑的。
   *
   * 这个字段是重点。原先这段逻辑埋在 `processScene` 的闭包里，
   * 「玩家自己选的」和「引擎替他选的」出来一模一样，
   * 外面无从分辨，也就没人能发现玩家的话被丢掉了。
   */
  forced: boolean;
  /** 匹配过程留痕，见 `MoveMatchTrace`。行为与它无关 */
  trace: MoveMatchTrace;
}

/**
 * 一条连接可以用哪些说法认出来。
 *
 * 原先只有一个键：condition 去掉动词后取前 8 字。它在括号上会断成半个 ——
 * 「前往艾德里安的农场（沿着小路向北）」截出来是「艾德里安的农场（」，
 * 于是玩家说「我去艾德里安的农场」永远对不上，被判成引擎替他挑的。
 *
 * 现在给三个键，命中任意一个就算：
 *   1. 去掉动词的整句（最严，最准）
 *   2. 再去掉括号补充 —— 括号里往往是"（沿着小路向北）"这类走法说明，玩家不会照念
 *   3. 目标场景的**真名** —— condition 和场景名可以不一样（「返回镇上」→「普瑞米尔」）
 *
 * 短于 2 字的键丢掉：单个字满大街都是，会把不相干的话判成移动。
 */
export function matchKeys(c: SceneConnection, world: MoveWorldView): string[] {
  const noVerb = c.condition.replace(/^(前往|进入|返回|回到|离开|去|到)\s*/, "").trim();
  const noParen = noVerb.replace(/[（(][^）)]*[）)]/g, "").trim();
  const sceneName = world.sceneName(c.targetSceneId).trim();
  return [noVerb, noParen, sceneName].filter(k => k.length >= 2);
}

/**
 * 把玩家的一句话对到一条连接上。**纯函数，没有行为改动** ——
 * 原样搬自 `processScene`，只是从闭包里挪出来好让它可测。
 *
 * 为什么值得挪：这个仓库已经栽过一次 —— 见
 * `src/__tests__/narrative-entity-recognition.test.ts:55`，
 * 「这道门原先长在 runModuleInner 的闭包里，测不到 —— 于是四局实跑一次都没演」。
 * 主循环至今没有任何测试覆盖，改它之前先让它能被测。
 */
export function chooseConnection(
  decision: { action: string },
  unlocked: SceneConnection[],
  world: MoveWorldView,
): MoveChoice {
  const trace: MoveMatchTrace = { candidates: [], matched: [], winnerIndex: -1, scores: [] };
  if (unlocked.length === 0) return { conn: null, forced: false, trace };

  // 先把**所有**命中都记下来再决定，而不是撞上第一个就 return。
  // 行为不变（胜出的仍是下标最小的那条），但「其实有好几条都命中」
  // 这件事从此看得见 —— 「重叠地名」和「否定」两类失败正是这么产生的。
  unlocked.forEach((c, i) => {
    const keys = matchKeys(c, world);
    trace.candidates.push({ targetSceneId: c.targetSceneId, keys });
    const key = keys.find(k => decision.action.includes(k));
    if (key === undefined) return;
    trace.matched.push({ targetSceneId: c.targetSceneId, key });
    if (trace.winnerIndex < 0) trace.winnerIndex = i;
  });
  if (trace.winnerIndex >= 0) {
    return { conn: unlocked[trace.winnerIndex]!, forced: false, trace };
  }

  // 没对上 —— 按"哪个更值得去"排个序替他挑一个。
  const scored = unlocked.map(c => {
    let score = 0;
    // 目标场景不存在（模组数据有洞）→ 直接垫底。
    // 少了这一支，坏连接反而会因为"没访问过"拿 +10 排到第一个去。
    if (!world.sceneExists(c.targetSceneId)) return { conn: c, score: -5 };
    if (!world.isSceneVisited(c.targetSceneId)) score += 10; else score -= 3;
    const vc = world.visitCount(c.targetSceneId);
    if (vc >= 3) score -= 8;
    else if (vc >= 2) score -= 4;
    return { conn: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  trace.scores = scored.map(s => ({ targetSceneId: s.conn.targetSceneId, score: s.score }));
  return { conn: scored[0]!.conn, forced: true, trace };
}
