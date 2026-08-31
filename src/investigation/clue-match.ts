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
//   uniqueAbbrevs      —— 复用，但**先剥动词再传进去**（"卫生间"→场景里
//                          唯一能对应的完整名词片段）。⚠ 这条注释曾经声称
//                          "直接复用"能产出「卫生间」，实测却产出「生间」
//                          （bug 2，2026-08-31-barn-action-anchor-abort.md
//                          第 6 回合）——它是给移动匹配（场景名"中心词在
//                          后"）设计的，线索描述常是"动词+名词"，动词不剥
//                          掉会连带把最短唯一子串切进名词内部。见调用点的
//                          注释；uniqueAbbrevs 本体没有改，只是调用前多了
//                          一步 stripSearchVerbs()。
//   hasMoveIntent      —— 移动专用（认的是"去/前往"这类动词），线索场景要换一套
//                          "侦查/检查/搜索"这类动词，见下面的 hasSearchIntent
//   matchKeys/chooseConnection —— 类型绑死 SceneConnection，线索这边的候选是
//                          纯文本（matchTexts），不是场景连接，另写一份轻量的

import { isRejectedMention, uniqueAbbrevs } from "../play/move-util";

/**
 * 调查类动词：紧跟在关键词前面时才算"确实在找这个"，不是随口提了一嘴。
 *
 * ⚠ bug 1（2026-08-31-barn-action-anchor-abort.md 第 7 回合）：这份表原来
 * 没有「翻查」——"陆川仔细**翻查**餐桌下面和披萨盒的夹层"因为动词不在表
 * 里，简称邻接判定直接失败，三次搜索全部 deny，一次骰子都没掷。
 *
 * 补的是「翻找/翻阅」的常见口语近亲（翻查/翻看）与"掀开遮挡物查看"这类
 * 具体搜索动作（扒开/掀开/摸索），外加更随意的口语搜索用词（找找/瞧瞧）
 * ——都是这份表已有词的同语域变体，不是另开一类。**不收**更生僻或书面语
 * 的词（搜寻、勘察、蒐集……）：没有实跑证据支持要不要收，加了也没法用
 * 真实数据验证有没有用，只会让这份表无限膨胀却测不出收益。
 */
const SEARCH_VERB = /(侦查|检查|查看|搜索|搜查|寻找|翻找|翻查|翻看|翻阅|扒开|掀开|摸索|找找|瞧瞧|观察|查探|调查|询问|打听)$/;
/**
 * 同一份动词表 + 少量常见修饰性副词（仔细/认真/再次/好好），不锚定位置——
 * 用来从整句话里把"不携带信号的部分"都抠掉，看看还剩不剩内容。
 *
 * ⚠ 任务2：这些副词经常紧贴在调查动词前后（"仔细检查""再次翻查"），本身
 * 不指向任何位置/对象，跟动词一样该被当成"没说什么"——"仔细搜查这里"
 * （行动锚点自己给出的建议文案）抠完"搜查"还剩"仔细这里"，得再抠掉
 * "仔细"才能看出这句话真的没有位置信号。只加进这份"全句抠掉"的表，
 * **不**加进上面 SEARCH_VERB（hasSearchIntent 的动词邻接判定）——那边判
 * 的是"这个简称紧跟着的是不是一个搜索动作"，副词本身不构成搜索动作，
 * 混进去没有事实依据，超出了本轮要修的范围。
 */
const SEARCH_VERB_ANY = /侦查|检查|查看|搜索|搜查|寻找|翻找|翻查|翻看|翻阅|扒开|掀开|摸索|找找|瞧瞧|观察|查探|调查|询问|打听|仔细|认真|再次|好好/g;

/**
 * 把一句话里所有调查类动词抠掉，剩下的才是"位置/对象信号"。
 *
 * 导出这个函数是为了让 matchSceneClues 内部与外部调用方（比如
 * scripts/diag/diag-clue-phrasing.ts 生成缩写用例时）共用同一份"什么算
 * 动词"的认定，不重复抄一份 SEARCH_VERB_ANY 出去——那样两份列表迟早会
 * 走岔，判据说的"通用"就成了两套各自为政的"通用"。
 */
export function stripSearchVerbs(said: string): string {
  return said.replace(SEARCH_VERB_ANY, "").trim();
}

/**
 * 指代词——占字数但不携带任何位置/对象信号（开发·线索闸门 任务2）。
 *
 * 背景：行动锚点（GameSession.getSuggestions）给的"仔细搜查这里"是一句
 * 合法可执行的动作，但 stripSearchVerbs 只抠掉"搜查"，剩下"仔细这里"
 * （4 字）——过了 ≥2 的无信号阈值，被当成"给了具体提示"，而"这里"根本
 * 不是任何线索的位置名词，匹配不上任何候选，直接 deny：**锚点自己推荐
 * 了一个必然失败的动作**。这份表与"那儿/那里/四周/周围"同理——它们在
 * 中文里的作用是指代"当前所在的地方"，不指代任何具体名词，天然不该被
 * 算进"玩家给了什么提示"。
 *
 * 不管它出现在句子哪个位置都不算信号，用 stripLocationFillers 统一处理，
 * 供 decideClueMatch 的入口判定与 matchSceneClues 内部的 no-signal 判定
 * 共用（同 stripSearchVerbs 的设计理由——两处各自维护一份迟早会走岔）。
 */
const LOCATION_FILLER = /这里|那里|那儿|四周|周围/g;
export function stripLocationFillers(said: string): string {
  return said.replace(LOCATION_FILLER, "").trim();
}

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
  /**
   * 早退在"没有位置/对象信号"这条路径上触发的（见 matchSceneClues 里
   * `contentOnly.length < 2` 那支）——不是"切词/简称方式太窄没找到同义词"
   * 的 no-key，是玩家压根没给可区分的信号，这是**正确行为**，不需要加
   * 同义词去"修"。
   *
   * 判据（clue-phrasing.ts 的 classifyClueFailure）必须读这个结构化标记，
   * 不能靠 `matched.length === 0` 去猜——早退发生在 `matched` 被填充之前，
   * 两条完全不同的路径殊途同归到同一个空数组，猜的话会把"正确拒绝猜测"
   * 误诊成"匹配方式太窄"，两者的修法（不修 vs 加同义词）截然相反。
   */
  noSignal: boolean;
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
 * 从线索的 findMethods 描述里抽一个短的位置提示——早期检定失败时用来
 * 引导玩家再查，而不是直接给出线索本身（开发·线索闸门 任务3）。
 *
 * 复用同一套切词/剥词流程（splitKeys + stripSearchVerbs +
 * stripLocationFillers），不新写一套解析——findMethods 描述本来就是
 * 这套判据的输入源，抽提示与做匹配是同一件"认出位置名词"的事，只是
 * 用途不同。挑候选里**最短**的那个：越短越像一个干净的位置名词
 * （"床底"），越长越可能夹带了动作/内容描述（"可以发现在披萨盒下面
 * 有一张小卡片"），那种不该被当成"方向"讲给玩家——方向要短、要指
 * 地方，不要连带说出"能发现什么"。
 *
 * `findMethodTexts` 只传 findMethods 的描述，不传线索展示名——名字本身
 * 就是"这是什么"，正是不该在降级信息里出现的那部分，只给"往哪查"。
 */
export function extractLocationHint(findMethodTexts: string[]): string | null {
  const candidates = splitKeys(findMethodTexts)
    .map((s) => stripLocationFillers(stripSearchVerbs(s)))
    .filter((s) => s.length >= 2 && s.length <= 6);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0]!;
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
  const trace: ClueMatchTrace = { candidates: [], matched: [], noSignal: false };
  if (candidates.length === 0) return { hit: null, ambiguous: [], trace };

  // 阈值定为 2 字，不是随手写的：
  //   · 定太低（0/1 字）：抠完动词剩一个字（"搜查二"剩"二"、"检查杂"剩
  //     "杂"）几乎不携带任何位置信号，单字满大街都是——splitKeys() 自己
  //     也是按这条线划的（见上面 splitKeys 的注释"单字满大街都是"），
  //     这里跟它对齐，不是另开一套标准。
  //   · 定太高（3 字以上）：会误伤真实存在的 2 字位置名词。"床底"、
  //     "卫生间"里最短的可用简称就是 2 字（"床底"本身就是 2 字），
  //     实测调高到 3 会让"侦查床底"这类已验证过的正例反过来变成误判的
  //     "无信号"——这不是假设，是本轮之前跑真实数据时踩过的坑。
  // 边界钉在测试里：剩 1 字 → 无信号；剩 2 字 → 正常参与匹配。
  //
  // 任务2：指代词（这里/那儿/那里/四周/周围）同样不携带信号，跟调查动词
  // 与副词一起抠掉——"仔细搜查这里"先抠"仔细""搜查"剩"这里"，再抠掉
  // "这里"就是 0 字，正确判定无信号（而不是被"这里"两个字凑够阈值，
  // 走到下面的精确匹配，最终一条都对不上又落到 deny——锚点自己给的建议
  // 因此曾经必然失败，见头部背景说明）。
  const contentOnly = stripLocationFillers(stripSearchVerbs(said));
  if (contentOnly.length < 2) {
    trace.noSignal = true;
    return { hit: null, ambiguous: candidates.map((c) => c.id), trace };
  }

  const allKeys = candidates.map((c) => splitKeys(c.texts));
  const hits: { id: string; key: string }[] = [];

  candidates.forEach((c, i) => {
    const keys = allKeys[i]!;
    const rivals = allKeys.filter((_, j) => j !== i).flat();
    // 唯一简称：本场景其它候选都不沾边的短前后缀，允许玩家不照念全文。
    //
    // ⚠ bug 2（同一份实跑报告，第 6 回合）：uniqueAbbrevs 是给移动匹配写的
    // （src/play/move-util.ts:188 一段的 docstring：「中文地名中心词在
    // 后面」，如"维森酒吧"/"霍姆斯医院"，最短唯一后缀天然落在有意义的
    // 2 字中心词上）。线索的 findMethods 描述形状不同——常是"动词+名词"
    // （"侦查卫生间"），最短唯一子串算法会先吃掉共享的动词前缀再找唯一
    // 前缀（"侦查卫生间"→"侦查卫"，把动词也切了进去），后缀更糟：从
    // "卫生间"（头字"间"只有 1 字，够不到 minLen=2）硬切 2 字后缀会切穿
    // "卫生"这个不可再拆的双字词内部，产出"生间"——玩家说"检查卫生间"，
    // "生间"前 6 字是"检查卫"，不以任何调查动词收尾，邻接判定必然失败。
    //
    // 修法：不改 uniqueAbbrevs 本体（它仍要正确服务移动匹配，diag-
    // phrasing.ts 前后对比过，见 clue-match.ts 头注释与本轮报告），只在
    // 线索这边调用前先用 stripSearchVerbs() 把动词从 key/rival 两侧都
    // 剥掉——最短唯一子串算法从此在纯名词上找边界，"侦查卫生间"先变成
    // "卫生间"，前缀扫描第一步就能在"卫生"（双字词，不再被动词占掉长度
    // 预算）上找到唯一值，不必被迫吃穿到"生间"。原始（未剥动词）的
    // `keys`/`rivals` 仍然原样传给 trace 与上面的精确匹配分支——只有喂
    // 给 uniqueAbbrevs 的输入被剥过，"这条线索到底长什么样"这件事不变。
    const strippedKeys = keys.map(stripSearchVerbs).filter((k) => k.length >= 2);
    const strippedRivals = rivals.map(stripSearchVerbs);
    const abbrevs = uniqueAbbrevs(strippedKeys, strippedRivals);

    // uniqueAbbrevs 的截断循环要求 `len < key.length`——去动词后剩下恰好
    // 2 字的名词（比如"侦查餐桌"只有这一条描述、别处压根没有"餐桌"这个
    // 词时）永远进不了循环，一条简称都产不出来，即便这个 2 字名词本身在
    // 本场景已经唯一。补一条：去动词后的完整名词本身，只要在本场景唯一，
    // 直接收进候选——不再依赖截断算法凑巧覆盖到它。这也是本来就该有的
    // 「卫生间」全词候选（不只是截断出的「卫生」/「生间」两个片段）。
    for (const key of strippedKeys) {
      if (!strippedRivals.some((r) => r.includes(key))) abbrevs.push(key);
    }
    const uniqueAbbrevList = [...new Set(abbrevs)];
    trace.candidates.push({ id: c.id, keys: [...keys, ...uniqueAbbrevList] });

    // ⚠ 剥动词修好 bug 2 之后带出一个新回归（同一份测试套件里就有：
    // "侦查卫生间已经搜过了"不该命中）：简称"卫生"只是"卫生间"截断后的
    // 前缀，isRejectedMention 固定往简称**自己**结束的位置后看 8 字——
    // 但玩家原句里"卫生"后面还接着"间"字才轮到"已经搜过了"，这 1 个字
    // 的空隙正好把否定/已完成检测的窗口挤偏，8 字看不到"已经"。
    // 修法：简称若是从更长的 strippedKeys 项截断来的，且那个完整名词
    // 本身也确实原样出现在 said 里（"卫生间"就在"侦查卫生间已经搜过了"
    // 里），否定检测就用完整名词的结束位置，不是简称自己截断处的位置——
    // 这样窗口对齐到真正的词尾，不会被截掉的那一两个字拖偏。完整名词不
    // 在 said 里（round 7 的"餐桌"就是这种情况——它的来源"宣言仔细餐桌"
    // 从没原样出现过）时，退回简称自己的位置，行为不变。
    const abbrevFullNoun = new Map<string, string>();
    for (const abbrev of uniqueAbbrevList) {
      const full = strippedKeys.find((k) => k.length > abbrev.length && (k.startsWith(abbrev) || k.endsWith(abbrev)));
      if (full) abbrevFullNoun.set(abbrev, full);
    }
    const notRejectedAsAbbrev = (k: string): boolean => {
      const full = abbrevFullNoun.get(k);
      const checkKey = full && said.includes(full) ? full : k;
      return !isRejectedMention(said, checkKey);
    };

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
      ...uniqueAbbrevList.filter((k) => said.includes(k) && hasSearchIntent(said, k) && notRejectedAsAbbrev(k)),
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

/**
 * 入口层的"没给提示"判定——剥掉开头紧贴着的一个调查类动词前缀（不是像
 * `stripSearchVerbs` 那样抠掉全句里出现的所有动词）。剩下太短（<2 字）就
 * 是玩家压根没说要找什么，这是"入口就该不该走到 matchSceneClues"的判断，
 * 与 matchSceneClues 内部自己的 no-signal 早退（stripSearchVerbs，全句抠）
 * 是两件不同的事——见 matchSceneClues 的 docstring。
 *
 * 之前只有 GameSession.resolveSceneClueMatch 私有内联了这份正则与短路，
 * diag-clue-phrasing.ts 的"裸动词"用例绕过它直接调 matchSceneClues()，
 * 于是判据测的根本不是生产真正走的那条路：生产对"侦查"这类裸动词从这里
 * 就短路回 fallback（取候选首条，不问不猜），压根不会走到 matchSceneClues
 * 内部那条 no-signal 分支；判据却直接调 matchSceneClues("侦查", ...)，
 * 命中的是 matchSceneClues 自己的 no-signal（报 ambiguous=全部候选），
 * 判据看着"歧义正确处理"，实际测的是生产从不会执行到的一条路。
 *
 * ⚠ 任务2：开头允许一个可选的修饰性副词（仔细/认真/再次/好好）先于动词——
 * "仔细搜查这里"要在这里被截住变成 fallback，不是先剥"搜查"剩下"仔细
 * 这里"再落进 matchSceneClues 内部去问"你想找什么"（那不是行动锚点这个
 * 一键动作该有的反馈，见 game-session.ts getSuggestions 的背景说明）。
 * 仍然只认**紧跟在动词前面**的这一个副词，不是全句扫描——"陆川仔细
 * 检查床底"这类完整叙述句不以副词/动词开头，这条正则本来就匹配不上，
 * 不受影响。
 */
const ENTRY_VERB_PREFIX = /^(?:仔细|认真|再次|好好)?\s*(?:侦查|观察|搜索|寻找|搜查|调查|检查|查看|翻找|翻查|翻看|翻阅|扒开|掀开|摸索|找找|瞧瞧|询问|打听|使用|尝试)\s*/;

export type ClueMatchDecision =
  | { kind: "resolve"; clueId: string }
  | { kind: "ask"; clueIds: string[] }
  | { kind: "deny" }
  | { kind: "fallback" };

/**
 * "场景内一句话该解析成哪条线索"的完整决策——入口短路 + matchSceneClues 派发，
 * 一步做齐。GameSession.resolveSceneClueMatch 与
 * scripts/diag/diag-clue-phrasing.ts 共用这一份，不各自维护一份短路判断
 * （上一次各自维护的代价：判据全绿，生产行为却是判据想禁止的那个）。
 *
 * 四种结果：
 *   resolve  —— 唯一命中，解析这一条
 *   ask      —— 命中多条，问清楚，不猜
 *   deny     —— 给了具体提示但一条都不中，如实说没有
 *   fallback —— 没给提示（剥掉开头动词/副词与指代词后不剩什么）——不是
 *               "匹配失败"，是玩家压根没说要找什么。调用方按既有行为取
 *               候选首条，不在这个函数里做（会不会取首条是调用方的策略，
 *               不是"匹配"这件事本身）。
 */
export function decideClueMatch(input: string, candidates: ClueMatchCandidate[]): ClueMatchDecision {
  const said = input.replace(ENTRY_VERB_PREFIX, "").trim();
  // 任务2：长度判断额外抠掉指代词——"仔细搜查这里"剥完开头的"仔细搜查"
  // 剩"这里"（2 字，字面过阈值），但"这里"不是位置信号，得再抠一层才能
  // 看出这句话其实什么都没说。传给 matchSceneClues() 的仍是未抠指代词的
  // said——那边自己的 no-signal 判定（同样已经在任务2改过）会用一致的
  // 判法，这里只是提前避免走进那个函数再绕一圈。
  if (stripLocationFillers(said).length < 2) return { kind: "fallback" };
  if (candidates.length === 0) return { kind: "fallback" };

  const result = matchSceneClues(said, candidates);
  if (result.hit) return { kind: "resolve", clueId: result.hit };
  if (result.ambiguous.length > 0) return { kind: "ask", clueIds: result.ambiguous };
  return { kind: "deny" };
}
