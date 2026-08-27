// "玩家这句话对应场景里哪条线索" —— 匹配原语。
//
// 背景：同一场景多条未发现线索都靠同一个技能（多数是 spot_hidden）触发时，
// 引擎此前直接给场景里**第一条**未发现线索，不看玩家具体说了什么——
// 「侦查卫生间」拿到的是休息区的手枪线索，「侦查餐厅」拿到的是卫生间的
// 毒品线索。不是偏移一位，是玩家输入从未被读取。
//
// 这是移动匹配（src/play/move-util.ts）同一类问题在调查系统里的变体，能复用
// 的原语直接复用，不重新发明：
//   isRejectedMention  —— 通用（"别搜卫生间"不该命中），直接复用
//   uniqueAbbrevs      —— 通用（"卫生间"→场景里唯一能对应的完整描述），直接复用
//   hasMoveIntent      —— 移动专用（认的是"去/前往"这类动词），线索场景要换一套
//                          "侦查/检查/搜索"这类动词，见下面的 hasSearchIntent
//   matchKeys/chooseConnection —— 类型绑死 SceneConnection，线索这边的候选是
//                          纯文本（matchTexts），不是场景连接，另写一份轻量的

import { isRejectedMention, uniqueAbbrevs } from "../play/move-util";

/** 调查类动词：紧跟在关键词前面时才算"确实在找这个"，不是随口提了一嘴。 */
const SEARCH_VERB = /(侦查|检查|查看|搜索|搜查|寻找|翻找|翻阅|观察|查探|调查|询问|打听)$/;
/** 同一份动词表，不锚定位置——用来从整句话里把动词都抠掉，看看还剩不剩内容。 */
const SEARCH_VERB_ANY = /侦查|检查|查看|搜索|搜查|寻找|翻找|翻阅|观察|查探|调查|询问|打听/g;

/** 这个关键词前面紧挨着调查类动词吗——"侦查**卫生间**"比单纯提一嘴更像是要搜这里。 */
export function hasSearchIntent(said: string, key: string): boolean {
  let from = 0;
  for (;;) {
    const at = said.indexOf(key, from);
    if (at < 0) return false;
    if (SEARCH_VERB.test(said.slice(Math.max(0, at - 6), at))) return true;
    from = at + key.length;
  }
}

export interface ClueMatchCandidate {
  id: string;
  /** 线索名 + findMethods 描述等原始文本，供切词 */
  texts: string[];
}

/**
 * 一次匹配的过程记录，供判据/诊断读，不影响实际选取逻辑。
 * 形状照抄 MoveMatchTrace 的设计理由：只有 chosen/ambiguous 说不出**为什么**
 * 没对上——一个键都没命中、命中了别处的键、还是好几条都命中靠顺序抢先，
 * 是完全不同的三种毛病。
 */
export interface ClueMatchTrace {
  candidates: { id: string; keys: string[] }[];
  matched: { id: string; key: string }[];
}

export interface ClueMatchResult {
  /** 唯一命中的线索 id；命中 0 或 >1 条时为 null */
  hit: string | null;
  /** 命中多条时，这些候选的 id（供"你是指 A 还是 B"） */
  ambiguous: string[];
  trace: ClueMatchTrace;
}

/**
 * 把候选文本切成可匹配的短语。
 *
 * BARN_OF_PREMIER 的 findMethods 描述形状不统一：32 条里只有 5 条带 "/"
 * 分隔位置和动作（"侦查休息区/仔细检查床底"），其余 27 条是自由文本
 * （"购买报纸阅读""向其他人打听艾德里安，需判断幸运"）。不能只切 "/"——
 * 这里按常见分隔符全切一遍，短于 2 字的丢掉（单字满大街都是，会把不相干
 * 的话判成命中，同 move-util 的 minLen 约定）。
 */
export function splitKeys(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const seg of t.split(/[\/、，,：:+]/)) {
      const s = seg.trim();
      if (s.length >= 2) out.push(s);
    }
  }
  return [...new Set(out)];
}

/**
 * 把玩家的一句话对到场景里的一条线索上。
 *
 * ⚠ 没有位置/对象信号的输入要老实报"该问不该猜"（歧义），不能因为凑巧
 * 撞上某条描述的动词前缀就精确命中一个——`diag-clue-phrasing.ts` 实跑真的
 * 抓到过一例："艾德里安的卧室"场景里裸的"侦查"精确命中了
 * clue_bedroom_diary，只因为它的 findMethods 描述恰好写的是"侦查或挪开
 * 床头柜"，玩家等于什么都没说，引擎却擅自挑了一个。
 *
 * 判据必须通用，不能列"侦查"的黑名单——那样"观察""搜查""检查"会一个个
 * 再犯一遍。做法：把 `said` 里所有调查类动词（复用 hasSearchIntent 那份
 * 动词表 SEARCH_VERB_ANY，不新开一份）都抠掉，看看还剩不剩够长的内容。
 * 剩下的才是"位置/对象信号"；一个字都不剩，就是纯动词、没有信号，
 * 老实报"候选是这些，问不该猜"（ambiguous = 全部候选），不往下走匹配。
 *
 * 这与调用方 resolveSceneClueMatch 的"没给提示→回落旧行为"是两件不同的
 * 事：那边处理的是"入口就该不该走到这里"，这里处理的是"就算真走到了
 * 这个函数，输入本身有没有实质信号"——matchSceneClues 作为可以被直接
 * 调用的通用匹配器，不能依赖调用方一定先做过这层判断。
 */
export function matchSceneClues(said: string, candidates: ClueMatchCandidate[]): ClueMatchResult {
  const trace: ClueMatchTrace = { candidates: [], matched: [] };
  if (candidates.length === 0) return { hit: null, ambiguous: [], trace };

  const contentOnly = said.replace(SEARCH_VERB_ANY, "").trim();
  if (contentOnly.length < 2) {
    return { hit: null, ambiguous: candidates.map((c) => c.id), trace };
  }

  const allKeys = candidates.map((c) => splitKeys(c.texts));
  const hits: { id: string; key: string }[] = [];

  candidates.forEach((c, i) => {
    const keys = allKeys[i]!;
    const rivals = allKeys.filter((_, j) => j !== i).flat();
    // 唯一简称：本场景其它候选都不沾边的短前后缀，允许玩家不照念全文
    const abbrevs = uniqueAbbrevs(keys, rivals);
    trace.candidates.push({ id: c.id, keys: [...keys, ...abbrevs] });

    const hit = [
      // 完整键出现在玩家话里（"我进去侦查卫生间看看"包含键"卫生间"）——
      // isRejectedMention 要求 key 是 said 的子串才能检查否定语境，
      // 只在这个方向调用。
      ...keys.filter((k) => said.includes(k) && !isRejectedMention(said, k)),
      // 反过来，玩家的话是键的子串（原话摘自描述中段，比键短）——
      // 这种没有"紧邻上下文"可判否定，跳过 isRejectedMention。
      ...keys.filter((k) => !said.includes(k) && k.includes(said)),
      // 简称必须紧跟调查动词才算数——光秃秃的"卫生间"出现在句子中间，
      // 多半是在说别的事，不是要搜这里（同 move-util 对简称的处理）。
      ...abbrevs.filter((k) => said.includes(k) && hasSearchIntent(said, k) && !isRejectedMention(said, k)),
    ][0];
    if (hit) {
      trace.matched.push({ id: c.id, key: hit });
      hits.push({ id: c.id, key: hit });
    }
  });

  const uniqueIds = [...new Set(hits.map((h) => h.id))];
  if (uniqueIds.length === 1) return { hit: uniqueIds[0]!, ambiguous: [], trace };
  if (uniqueIds.length > 1) return { hit: null, ambiguous: uniqueIds, trace };
  return { hit: null, ambiguous: [], trace };
}
