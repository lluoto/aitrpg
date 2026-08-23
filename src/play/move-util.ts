// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type { SceneConnection, NarrativeEntity } from "../module/types";


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
 * 为什么要留痕：`scripts/diag/diag-phrasing.ts` 只拿得到 `conn + forced`，
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

// ── 提及的性质 ──
//
// 一个地名出现在句子里，不等于玩家要去那儿。
// `scripts/diag/diag-phrasing.ts` 把失败按成因分开之后，142 条里有 **72 条**是
// 「自己和别处都命中，靠候选顺序抢先」—— 同一句话换个连接顺序结论就变。
// 那不是「没听懂」，是**听懂了但选错了人**。

/**
 * 否定：这地方玩家明说了不去。
 *
 * ⚠ 动词那一节必须是可选组，不能把「不去」写成一个整体。
 * 第一版写的是 `(别|不要|不去|…)$`，于是「**别去**加比的拖车房」根本匹配不上
 * —— 紧挨着地名的两个字是「别去」，而模式里只有「别」（要求结尾）和「不去」。
 * 那一版看着能过测试，纯粹是因为用例里被否定的那个地名恰好更短，
 * 靠键长比赢的，不是靠否定。换个更长的地名立刻现形（实跑
 * 「别去加比的拖车房，去普瑞米尔」26 条全灭）。
 */
const NEGATION = /(别|不要|不用|甭|先不|暂时不|没必要|无需|不)(去|前往|到|进|进入|回|返回|走)?$/;
/** 已完成：去过了、看过了 —— 提它是为了排除它 */
const DONE_AFTER = /^(那边|这边|那儿|那里)?(已经|都)?(去过|来过|看过|查过|搜过)/;
/** 移动意图：紧挨在地名前面的动词 */
const MOVE_VERB = /(去|前往|到|进|进入|回|返回|走向|奔向)$/;

/**
 * 这句话里提到这个地名，是不是**被排除掉**了。
 *
 * 两种排除：
 *   否定 —— 「**别去**警察局，去维森酒吧」
 *   已完成 —— 「警察局那边**已经去过了**，现在去报亭」
 *
 * 判据看的是紧挨着地名的那一小段，不是整句 —— 整句里出现「不」就一律排除
 * 会把「不管怎样先去警察局」也毙掉。窗口取 4 个字，够覆盖「先不」「没必要」
 * 这类前缀，又不至于跨到上一个分句。
 */
export function isRejectedMention(said: string, key: string): boolean {
  let from = 0;
  for (;;) {
    const at = said.indexOf(key, from);
    if (at < 0) return true;         // 每一处提及都被排除了
    const before = said.slice(Math.max(0, at - 4), at);
    const after = said.slice(at + key.length, at + key.length + 8);
    if (!NEGATION.test(before) && !DONE_AFTER.test(after)) return false; // 有一处是干净的
    from = at + key.length;
  }
}

/** 这个地名前面紧挨着移动动词吗 —— 「现在**去**报亭」比单纯提一嘴更像是要去 */
export function hasMoveIntent(said: string, key: string): boolean {
  let from = 0;
  for (;;) {
    const at = said.indexOf(key, from);
    if (at < 0) return false;
    if (MOVE_VERB.test(said.slice(Math.max(0, at - 2), at))) return true;
    from = at + key.length;
  }
}

/**
 * 一条命中有多可信。分数只在**命中之间**比较，不与 forced 打分表混用。
 *
 * 三档，按重要性：
 *   +100 前面紧挨移动动词（「现在去报亭」）
 *   + 键长 —— 更长的键更具体，「农场主别墅」比「农场」说明的东西多
 *   + 出现位置 —— 越靠后越可能是最终决定（「A 去过了，现在去 B」）
 *
 * ⚠ 不能只用键长：「别去维森酒吧，去警察局」里维森酒吧更长，
 *   光比长度会选错。否定必须先过滤掉，长度只做次要区分。
 */
function mentionScore(said: string, key: string): number {
  const at = said.lastIndexOf(key);
  return (hasMoveIntent(said, key) ? 100 : 0) + key.length * 2 + (at < 0 ? 0 : at * 0.1);
}

/**
 * 这条连接的**唯一简称**：能把它和同场景其它出口区分开的最短前缀与最短后缀。
 *
 * 玩家不会照念全名，而且省法有两种：
 *   掐后面 —— 「先去**维森**那边」（维森酒吧）
 *   掐前面 —— 「我们去**医院**看看」（霍姆斯医院）
 * 中文地名的中心词在后面，所以后缀那一支不是可有可无：
 * 实跑 `p11-唯一后缀` 在只有前缀时是 **2/74 = 2.7%**。
 *
 * ⚠ 唯一性是**按当前这组出口**算的，不是全模组：
 *   - 在「警察局 / 维森酒吧 / 霍姆斯医院」之间，「维森」「医院」都唯一 → 认
 *   - 在「艾德里安的农场 / 农场外围 / 农场主别墅」之间，「农场」谁都沾 → 不认
 * 歧义是**构造上**排除的，不靠调阈值。认不出来的仍旧走 `forced=true`，
 * 引擎照旧承认自己是替玩家挑的。
 *
 * 只取最短的那个：更长的已经被完整键覆盖，多留只是噪音。
 * 括号补充先剥掉 —— 「农场外围（陷阱区）」的后缀不该是「陷阱区）」。
 */
export function uniqueAbbrevs(keys: string[], rivalKeys: string[], minLen = 2): string[] {
  const strip = (s: string) => s.replace(/[（(][^）)]*[）)]/g, "").trim();
  const rivals = rivalKeys.map(strip).filter(Boolean).concat(rivalKeys);
  const unique = (frag: string) => !rivals.some(r => r.includes(frag));
  const out: string[] = [];
  for (const raw of keys) {
    const key = strip(raw);
    for (let len = minLen; len < key.length; len++) {
      const prefix = key.slice(0, len);
      if (!unique(prefix)) continue;
      out.push(prefix);
      break;
    }
    for (let len = minLen; len < key.length; len++) {
      const suffix = key.slice(key.length - len);
      if (!unique(suffix)) continue;
      out.push(suffix);
      break;
    }
  }
  return [...new Set(out)];
}

/**
 * 解析 LLM 消歧的回答。
 *
 * 纯函数、不碰网络，因为要守的规矩全在这儿：
 *   1. 只接受**候选集合里真实存在**的 id。模型编一个出来必须当作 unknown ——
 *      不然一次幻觉就把玩家送到不存在的地方。
 *   2. `unknown` / 空 / 解析不了 → null，调用方回落到原来的替选并**明说**。
 *
 * 返回 null 就是「照旧 forced」。这条映射是整件事的关键：
 * 把一次**公开的替选**换成一次**隐蔽的猜测**是退步不是进步 ——
 * 记录里那句「比菜单更糟：菜单至少还承认玩家做了选择」说的就是这个。
 */
export function parseMoveHint(raw: string, allowed: readonly string[]): string | null {
  const m = raw.match(/"target"\s*:\s*"([^"]*)"/);
  const id = (m?.[1] ?? "").trim();
  if (!id || id === "unknown") return null;
  return allowed.includes(id) ? id : null;
}

/**
 * 把玩家的一句话对到一条连接上。
 *
 * 为什么值得从闭包里挪出来：这个仓库已经栽过一次 —— 见
 * `src/__tests__/narrative-entity-recognition.test.ts:55`，
 * 「这道门原先长在 runModuleInner 的闭包里，测不到 —— 于是四局实跑一次都没演」。
 *
 * 匹配分三步：
 *   1. 收集所有命中（不是撞上第一个就走）
 *   2. 去掉被否定/已完成的提及
 *   3. 剩下的按可信度排序，取最高
 * 第 2、3 步是 `_diag-phrasing.ts` 把 142 条失败按成因拆开之后加的：
 * 其中 72 条是「好几条都命中、靠列表顺序抢先」，换个顺序结论就变。
 */
export function chooseConnection(
  decision: { action: string },
  unlocked: SceneConnection[],
  world: MoveWorldView,
): MoveChoice {
  const trace: MoveMatchTrace = { candidates: [], matched: [], winnerIndex: -1, scores: [] };
  if (unlocked.length === 0) return { conn: null, forced: false, trace };

  const said = decision.action;
  const allKeys = unlocked.map(c => matchKeys(c, world));

  // 1. 收集所有命中。同一条连接可能有多个键命中，取最可信的那个。
  //    完整键之外再加**唯一简称** —— 只有在本组出口里能唯一定位时才算，
  //    所以简称构造上不可能造出歧义。简称扣分，任何完整键都压得过它。
  const hits: { index: number; key: string; score: number; rejected: boolean }[] = [];
  unlocked.forEach((c, i) => {
    const keys = allKeys[i]!;
    const rivals = allKeys.filter((_, j) => j !== i && unlocked[j]!.targetSceneId !== c.targetSceneId).flat();
    const abbrevs = uniqueAbbrevs(keys, rivals);
    trace.candidates.push({ targetSceneId: c.targetSceneId, keys: [...keys, ...abbrevs] });
    const hit = [
      ...keys.filter(k => said.includes(k)).map(k => ({ key: k, penalty: 0 })),
      // 简称**必须**紧跟移动动词才算数。一个光秃秃的「医院」「酒吧」
      // 出现在句子里，多半是在提一件事而不是要去那儿
      // （「他在酒吧工作过」）。完整地名不设这道门槛 —— 说全名本身
      // 就足够表明是在点地方。
      ...abbrevs.filter(k => said.includes(k) && hasMoveIntent(said, k)).map(k => ({ key: k, penalty: 60 })),
    ]
      .map(({ key, penalty }) => ({
        key,
        score: mentionScore(said, key) - penalty,
        rejected: isRejectedMention(said, key),
      }))
      .sort((a, b) => Number(a.rejected) - Number(b.rejected) || b.score - a.score)[0];
    if (!hit) return;
    trace.matched.push({ targetSceneId: c.targetSceneId, key: hit.key });
    hits.push({ index: i, ...hit });
  });

  // 2. 去掉被否定 / 已去过的。全被排除时才回落到打分替选 ——
  //    「别去警察局」不该被理解成「那就去警察局」。
  const alive = hits.filter(h => !h.rejected);
  if (alive.length > 0) {
    // 3. 按可信度取最高；完全打平才回落到列表顺序。
    //    平局用下标而不是随机：同样的话每次得到同样的结果。
    alive.sort((a, b) => b.score - a.score || a.index - b.index);
    trace.winnerIndex = alive[0]!.index;
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
