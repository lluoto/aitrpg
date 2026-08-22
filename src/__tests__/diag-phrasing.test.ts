// 判据校准：「玩家这句话能不能对到他想去的地方」。
//
// 这份测试测的**不是引擎**，是判据。每条判据都要求三件事同时成立：
//   1. 行为正确的输入 → 判据通过
//   2. 目标行为错误的输入 → 判据失败
//   3. 文本相似但行为合法的干扰输入 → 判据不误报
// 少了第 2 条就是「永远通过」，少了第 3 条就是「永远报警」，
// 两种都等于没测（review-request 里六次错，全是这两种之一）。

import { describe, test, expect } from "bun:test";
import {
  judgePhrase, addPhraseResult, newPhraseReport, pct, classifyFailure,
  type PhraseCase, type PhraseOutcome,
} from "../diagnostics/phrasing";
import {
  chooseConnection, matchKeys, isRejectedMention, hasMoveIntent, uniqueAbbrevs,
  type MoveWorldView,
} from "../play/move-util";
import type { SceneConnection } from "../module/types";

// ── 判据层：只喂构造出来的结果，不碰引擎 ───────────────────────────

const positive: PhraseCase = {
  id: "say-name", kind: "positive", desc: "只说地名",
  said: "去维森酒吧", wantSceneId: "weisen_bar",
};
const negative: PhraseCase = {
  id: "negate", kind: "negative", desc: "否定一个目标同时指定另一个",
  said: "别去警察局，去维森酒吧", wantSceneId: "weisen_bar", forbidSceneId: "police_station",
};
const ambiguous: PhraseCase = {
  id: "pronoun", kind: "ambiguous", desc: "代词指代，没有唯一目标",
  said: "去那边", wantSceneId: null,
};

describe("judgePhrase — 正例", () => {
  test("正确：选中目标且不是替选 → 通过", () => {
    const o: PhraseOutcome = { chosenSceneId: "weisen_bar", forced: false };
    expect(judgePhrase(positive, o).verdict).toBe("pass");
  });

  test("错误：选中了别的地方 → 失败", () => {
    const o: PhraseOutcome = { chosenSceneId: "police_station", forced: true };
    const j = judgePhrase(positive, o);
    expect(j.verdict).toBe("fail");
    expect(j.why).toContain("police_station");
  });

  test("错误：目标碰巧对了但标成替选 → 仍失败（蒙对不算听懂）", () => {
    // 这条是「假绿」的入口：只比对 targetSceneId 的话，引擎按分数蒙中
    // 也算命中率，指标会虚高。
    const o: PhraseOutcome = { chosenSceneId: "weisen_bar", forced: true };
    expect(judgePhrase(positive, o).verdict).toBe("fail");
  });

  test("正例计入命中率分母", () => {
    expect(judgePhrase(positive, { chosenSceneId: "weisen_bar", forced: false }).countsTowardHitRate).toBe(true);
  });
});

describe("judgePhrase — 反例（否定式）", () => {
  test("正确：避开被否定的目标、去了指定的地方 → 通过", () => {
    expect(judgePhrase(negative, { chosenSceneId: "weisen_bar", forced: false }).verdict).toBe("pass");
  });

  test("错误：选中了话里明确排除的那个 → 失败", () => {
    const j = judgePhrase(negative, { chosenSceneId: "police_station", forced: false });
    expect(j.verdict).toBe("fail");
    expect(j.why).toContain("排除");
  });

  test("错误：避开了警察局但也没去维森酒吧 → 失败", () => {
    expect(judgePhrase(negative, { chosenSceneId: "hospital", forced: true }).verdict).toBe("fail");
  });

  test("错误：去对了地方却标成替选 → 失败（是碰上的不是认出来的）", () => {
    expect(judgePhrase(negative, { chosenSceneId: "weisen_bar", forced: true }).verdict).toBe("fail");
  });

  test("反例不计入目标命中率", () => {
    expect(judgePhrase(negative, { chosenSceneId: "weisen_bar", forced: false }).countsTowardHitRate).toBe(false);
  });

  test("**用例本身不成立**：被排除的和要去的是同一个场景 → 报用例坏了", () => {
    // 实际造出过「别去下水道，去下水道」：`maintenance_room` 有两条连接
    // 都通向 `sewer`，干扰项按「别的连接」取就撞上了自己。
    // 这种用例判不出任何东西，不能混进「反例通过率」当成引擎的失败。
    const broken: PhraseCase = {
      id: "self", kind: "negative", desc: "自己排除自己",
      said: "别去下水道，去下水道", wantSceneId: "sewer", forbidSceneId: "sewer",
    };
    const j = judgePhrase(broken, { chosenSceneId: "sewer", forced: false });
    expect(j.verdict).toBe("fail");
    expect(j.why).toContain("用例本身不成立");
  });

  test("**干扰**：forbid 与 want 不同则正常判定，不被上面那条误伤", () => {
    expect(judgePhrase(negative, { chosenSceneId: "weisen_bar", forced: false }).verdict).toBe("pass");
  });
});

describe("judgePhrase — 歧义输入", () => {
  test("正确：引擎承认自己替玩家挑的 → 通过（去了哪儿都不算错）", () => {
    expect(judgePhrase(ambiguous, { chosenSceneId: "newsstand", forced: true }).verdict).toBe("pass");
    expect(judgePhrase(ambiguous, { chosenSceneId: "hospital", forced: true }).verdict).toBe("pass");
  });

  test("错误：把替选伪装成玩家自己的选择 → 失败", () => {
    // 「去那边」不可能唯一确定目标。此时 forced=false 就是在撒谎。
    const j = judgePhrase(ambiguous, { chosenSceneId: "newsstand", forced: false });
    expect(j.verdict).toBe("fail");
    expect(j.why).toContain("forced=false");
  });

  test("歧义输入**不进**目标命中率 —— 这是上一版指标失真的根因之一", () => {
    const a = judgePhrase(ambiguous, { chosenSceneId: "newsstand", forced: true });
    const b = judgePhrase(ambiguous, { chosenSceneId: "newsstand", forced: false });
    expect(a.countsTowardHitRate).toBe(false);
    expect(b.countsTowardHitRate).toBe(false);
  });
});

describe("PhraseReport — 三类分开统计", () => {
  test("命中率分母只含正例", () => {
    const r = newPhraseReport();
    addPhraseResult(r, positive, { chosenSceneId: "weisen_bar", forced: false });
    addPhraseResult(r, negative, { chosenSceneId: "weisen_bar", forced: false });
    addPhraseResult(r, ambiguous, { chosenSceneId: "hospital", forced: true });
    expect(r.hitRate).toEqual({ hit: 1, total: 1 });
    expect(r.negative).toEqual({ hit: 1, total: 1 });
    expect(r.ambiguous).toEqual({ hit: 1, total: 1 });
    expect(pct(r.hitRate)).toBe("100.0%");
  });

  test("歧义输入判失败也不会污染命中率", () => {
    const r = newPhraseReport();
    addPhraseResult(r, ambiguous, { chosenSceneId: "hospital", forced: false });
    expect(r.hitRate).toEqual({ hit: 0, total: 0 });
    expect(r.ambiguous).toEqual({ hit: 0, total: 1 });
    expect(r.failures.length).toBe(1);
  });
});

// ── 端到端：真的过一遍 chooseConnection ────────────────────────────
//
// 固定的连接夹具，不用真模组 —— 真模组的连接顺序会变，
// 而「反例会不会因为连接顺序而选错」正是要钉住的东西。

const SCENES: Record<string, string> = {
  police_station: "警察局",
  weisen_bar: "维森酒吧",
  hospital: "霍姆斯医院",
  adrian_farm: "艾德里安的农场",
  farm_periphery: "农场外围（陷阱区）",
  farm_villa: "农场主别墅",
  newsstand: "报亭",
};

function view(): MoveWorldView {
  return namedView(SCENES);
}

/** 换一套场景名的 view —— 用来测「condition 与场景真名不同」那条路径 */
function namedView(names: Record<string, string>): MoveWorldView {
  return {
    isSceneVisited: () => false,
    visitCount: () => 0,
    sceneExists: (id) => id in names,
    sceneName: (id) => names[id] ?? "",
  };
}

const conn = (targetSceneId: string, condition: string): SceneConnection =>
  ({ targetSceneId, condition }) as SceneConnection;

function run(said: string, conns: SceneConnection[]): PhraseOutcome {
  const r = chooseConnection({ action: said }, conns, view());
  return { chosenSceneId: r.conn?.targetSceneId ?? null, forced: r.forced, matched: r.trace.matched };
}

describe("端到端 — 唯一简称与唯一别名", () => {
  const conns = [
    conn("police_station", "前往警察局"),
    conn("weisen_bar", "前往维森酒吧"),
    conn("hospital", "前往霍姆斯医院"),
  ];

  test("说全名「维森酒吧」→ 命中（正例通过）", () => {
    const c: PhraseCase = { id: "full", kind: "positive", desc: "全名", said: "先去维森酒吧坐坐", wantSceneId: "weisen_bar" };
    expect(judgePhrase(c, run(c.said, conns)).verdict).toBe("pass");
  });

  test("唯一简称「维森」认得出（上一版这里是 0/70）", () => {
    // 上一版的 12 条用例里 8 条都含完整地名，跑出 100%；补进会掉的用例后
    // 这一类是 0/70。判据把成因指成 `no-key`（匹配方式太窄），据此加了唯一简称。
    const c: PhraseCase = { id: "short", kind: "positive", desc: "唯一简称", said: "先去维森那边坐坐", wantSceneId: "weisen_bar" };
    const o = run(c.said, conns);
    expect(o.forced).toBe(false);
    expect(judgePhrase(c, o).verdict).toBe("pass");
  });

  test("**判据不是一味放行**：目标不对时照样失败", () => {
    const c: PhraseCase = { id: "short", kind: "positive", desc: "唯一简称", said: "先去维森那边坐坐", wantSceneId: "weisen_bar" };
    expect(judgePhrase(c, { chosenSceneId: "police_station", forced: false }).verdict).toBe("fail");
  });

  test("后缀式别名也认得出：「医院」之于「霍姆斯医院」", () => {
    // 中文地名的中心词在后面，玩家最常省掉的正是前面的专名。
    // 只做前缀时这一类实跑 2/74 = 2.7%。
    const c: PhraseCase = { id: "alias", kind: "positive", desc: "后缀别名", said: "我们去医院看看", wantSceneId: "hospital" };
    expect(judgePhrase(c, run(c.said, conns)).verdict).toBe("pass");
  });

  test("**中缀仍认不出**：「姆斯」这种碎片不给 —— 唯一但不是词", () => {
    // 只认前缀与后缀，因为它们是中文地名的自然切分点。
    // 任意子串都算唯一简称的话，「会面」「筑内」这类碎片会撞上不相干的句子。
    const c: PhraseCase = { id: "infix", kind: "positive", desc: "中缀", said: "我们去姆斯那边", wantSceneId: "hospital" };
    expect(judgePhrase(c, run(c.said, conns)).verdict).toBe("fail");
  });

  test("干扰项：句子里出现别的地名，但要去的是自己点名的那个", () => {
    // 「警察局那边我们已经去过了，现在去报亭」—— 文本里有「警察局」三个字，
    // 判据不能因为它出现过就算命中警察局。
    const c: PhraseCase = {
      id: "mentioned-not-target", kind: "negative", desc: "提到但不是目标",
      said: "警察局那边我们已经去过了，现在去报亭",
      wantSceneId: "newsstand", forbidSceneId: "police_station",
    };
    const withNews = [...conns, conn("newsstand", "前往报亭")];
    expect(judgePhrase(c, run(c.said, withNews)).verdict).toBe("pass");
  });

  test("**换个连接顺序，结论必须一样** —— 顺序无关是这次改动的核心", () => {
    const c: PhraseCase = {
      id: "mentioned-not-target", kind: "negative", desc: "提到但不是目标",
      said: "警察局那边我们已经去过了，现在去报亭",
      wantSceneId: "newsstand", forbidSceneId: "police_station",
    };
    const reordered = [conn("newsstand", "前往报亭"), ...conns];
    const withNews = [...conns, conn("newsstand", "前往报亭")];
    expect(run(c.said, reordered).chosenSceneId).toBe(run(c.said, withNews).chosenSceneId);
    expect(judgePhrase(c, run(c.said, reordered)).verdict).toBe("pass");
  });
});

describe("端到端 — 否定式反例与连接顺序无关", () => {
  const said = "别去警察局，去维森酒吧";

  test("维森酒吧排在前面时，看着是对的", () => {
    const c: PhraseCase = { id: "negate", kind: "negative", desc: "否定", said, wantSceneId: "weisen_bar", forbidSceneId: "police_station" };
    const ordered = [conn("weisen_bar", "前往维森酒吧"), conn("police_station", "前往警察局")];
    expect(judgePhrase(c, run(said, ordered)).verdict).toBe("pass");
  });

  test("**警察局排在前面时也不能选错** —— 这就是「干扰项恰好在目标之后」那类错", () => {
    // review-request 第 3 条：用例只跑一种顺序，实现改错也全绿。
    const c: PhraseCase = { id: "negate", kind: "negative", desc: "否定", said, wantSceneId: "weisen_bar", forbidSceneId: "police_station" };
    const ordered = [conn("police_station", "前往警察局"), conn("weisen_bar", "前往维森酒吧")];
    expect(judgePhrase(c, run(said, ordered)).verdict).toBe("pass");
  });

  test("**否定必须压过键长** —— 被否定的地名更长时同样要避开", () => {
    // 第一版否定正则写成 `(别|不去|…)$`，「别去X」根本匹配不上（紧邻两字是「别去」）。
    // 当时能过测试纯粹是因为被否定的地名恰好更短，靠键长比赢的。
    // 换成更长的被否定地名立刻现形 —— 实跑 26 条全灭。
    const c: PhraseCase = {
      id: "negate-long", kind: "negative", desc: "否定一个更长的地名",
      said: "别去艾德里安在镇子内的住宅，去报亭",
      wantSceneId: "newsstand", forbidSceneId: "adrian_town_house",
    };
    const ordered = [
      conn("adrian_town_house", "前往艾德里安在镇子内的住宅"),
      conn("newsstand", "前往报亭"),
    ];
    expect(judgePhrase(c, run(c.said, ordered)).verdict).toBe("pass");
    expect(judgePhrase(c, run(c.said, [...ordered].reverse())).verdict).toBe("pass");
  });
});

describe("端到端 — 重叠地名", () => {
  const conns = [
    conn("adrian_farm", "前往艾德里安的农场"),
    conn("farm_periphery", "进入农场外围（陷阱区）"),
    conn("farm_villa", "前往农场主别墅"),
  ];

  test("说全名「农场主别墅」应当唯一命中（正例通过）", () => {
    const c: PhraseCase = { id: "overlap-full", kind: "positive", desc: "重叠地名说全名", said: "去农场主别墅", wantSceneId: "farm_villa" };
    expect(judgePhrase(c, run(c.said, conns)).verdict).toBe("pass");
  });

  test("只说共同前缀「农场」是歧义 → 引擎承认替选，判据通过且不进命中率", () => {
    const c: PhraseCase = { id: "overlap-bare", kind: "ambiguous", desc: "重叠地名只说共同前缀", said: "去农场", wantSceneId: null };
    const o = run(c.said, conns);
    expect(o.forced).toBe(true);
    const j = judgePhrase(c, o);
    expect(j.verdict).toBe("pass");
    expect(j.countsTowardHitRate).toBe(false);
  });

  test("**真正的重叠陷阱：短地名是长说法的子串** —— 判据必须报失败", () => {
    // 「镇上」是 town_premier 的匹配键，而玩家要去的是「镇内住宅」。
    // 一句「回镇上那处住宅看看」里同时含「镇上」，子串匹配先撞上 town_premier。
    // 这与连接顺序无关：只要 town_premier 在列表里靠前就会中。
    const overlapping = [
      conn("town_premier", "返回镇上"),
      conn("adrian_town_house", "前往镇内住宅"),
    ];
    const c: PhraseCase = {
      id: "overlap-substring", kind: "negative", desc: "短地名是长说法的子串",
      said: "回镇上那处住宅看看", wantSceneId: "adrian_town_house", forbidSceneId: "town_premier",
    };
    const o = run(c.said, overlapping);
    expect(o.chosenSceneId).toBe("town_premier");
    expect(judgePhrase(c, o).verdict).toBe("fail");
  });
});

describe("端到端 — 歧义输入必须 forced=true", () => {
  const conns = [conn("police_station", "前往警察局"), conn("weisen_bar", "前往维森酒吧")];

  test("「换个地方看看」→ 引擎承认替选（判据通过，且不进命中率）", () => {
    const c: PhraseCase = { id: "rewrite", kind: "ambiguous", desc: "同义改写", said: "换个地方看看", wantSceneId: null };
    const o = run(c.said, conns);
    expect(o.forced).toBe(true);
    const j = judgePhrase(c, o);
    expect(j.verdict).toBe("pass");
    expect(j.countsTowardHitRate).toBe(false);
  });

  test("「去那边」同上", () => {
    const c: PhraseCase = { id: "pronoun", kind: "ambiguous", desc: "代词", said: "去那边", wantSceneId: null };
    expect(judgePhrase(c, run(c.said, conns)).verdict).toBe("pass");
  });
});

// ── 失败成因分类 ─────────────────────────────────────────────
//
// 「命中率 90.3%」说明不了要改什么。三类失败的修法完全不同：
// 缺同义词 / 认错了人 / 靠顺序抢先。判据要说得出是哪一类。

describe("classifyFailure — 说得出为什么没对上", () => {
  const want: PhraseCase = { id: "x", kind: "positive", desc: "", said: "", wantSceneId: "weisen_bar" };

  test("一个键都没命中 → no-key（该加简称/别名）", () => {
    expect(classifyFailure(want, { chosenSceneId: "police_station", forced: true, matched: [] })).toBe("no-key");
  });

  test("只命中了别处的键 → rival-only（子串比对认错了人）", () => {
    const o: PhraseOutcome = {
      chosenSceneId: "police_station", forced: false,
      matched: [{ targetSceneId: "police_station", key: "警察局" }],
    };
    expect(classifyFailure(want, o)).toBe("rival-only");
  });

  test("自己和别处都命中 → ambiguous（靠候选顺序抢先）", () => {
    const o: PhraseOutcome = {
      chosenSceneId: "police_station", forced: false,
      matched: [
        { targetSceneId: "police_station", key: "警察局" },
        { targetSceneId: "weisen_bar", key: "维森酒吧" },
      ],
    };
    expect(classifyFailure(want, o)).toBe("ambiguous");
  });

  test("**干扰**：没有 trace 时老实说不知道，不瞎归类", () => {
    expect(classifyFailure(want, { chosenSceneId: null, forced: true })).toBe("other");
  });

  test("端到端：「回镇上那处住宅看看」是 rival-only（只命中了别处的键）", () => {
    // 目标的键是「镇内住宅」，句子里没有；只有「镇上」中了。
    // 这类要靠模糊匹配才修得了，不是消歧能解决的 —— 判据得说得出这个区别。
    const c: PhraseCase = {
      id: "overlap", kind: "negative", desc: "短地名是长说法的子串",
      said: "回镇上那处住宅看看", wantSceneId: "adrian_town_house", forbidSceneId: "town_premier",
    };
    const o = run(c.said, [conn("town_premier", "返回镇上"), conn("adrian_town_house", "前往镇内住宅")]);
    expect(judgePhrase(c, o).verdict).toBe("fail");
    expect(classifyFailure(c, o)).toBe("rival-only");
  });
});

describe("MoveMatchTrace — 匹配过程留痕", () => {
  const conns = [conn("police_station", "前往警察局"), conn("weisen_bar", "前往维森酒吧")];

  test("多条命中都留痕，即使其中一条被否定掉了", () => {
    const r = chooseConnection({ action: "别去警察局，去维森酒吧" }, conns, view());
    expect(r.trace.matched.length).toBe(2);
    expect(r.conn?.targetSceneId).toBe("weisen_bar");
  });

  test("**换个顺序，结论不变** —— 这是消歧生效的直接判据", () => {
    const a = chooseConnection({ action: "别去警察局，去维森酒吧" }, conns, view());
    const b = chooseConnection({ action: "别去警察局，去维森酒吧" }, [...conns].reverse(), view());
    expect(a.conn?.targetSceneId).toBe(b.conn?.targetSceneId);
    expect(a.forced).toBe(b.forced);
  });

  test("没命中时留下打分表，且 winnerIndex 为 -1", () => {
    const r = chooseConnection({ action: "换个地方看看" }, conns, view());
    expect(r.forced).toBe(true);
    expect(r.trace.winnerIndex).toBe(-1);
    expect(r.trace.scores.length).toBe(2);
  });

  test("候选键全部留痕（判据要能看到匹配方式有多窄）", () => {
    const r = chooseConnection({ action: "去维森酒吧" }, conns, view());
    expect(r.trace.candidates.map((x) => x.targetSceneId)).toEqual(["police_station", "weisen_bar"]);
    expect(r.trace.candidates[1]!.keys).toContain("维森酒吧");
  });

  test("空连接表不炸", () => {
    const r = chooseConnection({ action: "去哪儿" }, [], view());
    expect(r.conn).toBeNull();
    expect(r.trace.candidates).toEqual([]);
  });
});

// ── 消歧的三块砖 ─────────────────────────────────────────────

describe("isRejectedMention — 这地方是被排除掉的吗", () => {
  test("**应报**：否定", () => {
    expect(isRejectedMention("别去警察局，去维森酒吧", "警察局")).toBe(true);
    expect(isRejectedMention("不要去警察局", "警察局")).toBe(true);
    expect(isRejectedMention("先不去警察局了", "警察局")).toBe(true);
    expect(isRejectedMention("我们不去警察局", "警察局")).toBe(true);
  });

  test("**应报**：已经去过了", () => {
    expect(isRejectedMention("警察局那边已经去过了，现在去报亭", "警察局")).toBe(true);
    expect(isRejectedMention("警察局看过了", "警察局")).toBe(true);
  });

  test("**不应报**：正常提到", () => {
    expect(isRejectedMention("去警察局", "警察局")).toBe(false);
    expect(isRejectedMention("我们去警察局问问", "警察局")).toBe(false);
  });

  test("**不应报**：句子里有「不」但不是修饰这个地名的", () => {
    // 整句见「不」就排除，会把这句也毙掉。判据只看紧挨着的那几个字。
    expect(isRejectedMention("不管怎样先去警察局", "警察局")).toBe(false);
    expect(isRejectedMention("说不定该去警察局", "警察局")).toBe(false);
  });

  test("**干扰**：提了两次，一次被否定一次没有 → 不算排除", () => {
    expect(isRejectedMention("别去警察局……算了还是去警察局吧", "警察局")).toBe(false);
  });

  test("干扰：地名压根不在句子里 → 视作排除（没提过就不该选它）", () => {
    expect(isRejectedMention("去报亭", "警察局")).toBe(true);
  });
});

describe("hasMoveIntent — 前面紧挨着移动动词吗", () => {
  test("应报", () => {
    expect(hasMoveIntent("现在去报亭", "报亭")).toBe(true);
    expect(hasMoveIntent("前往报亭", "报亭")).toBe(true);
    expect(hasMoveIntent("返回报亭", "报亭")).toBe(true);
  });

  test("不应报：只是提了一嘴", () => {
    expect(hasMoveIntent("报亭那边已经看过了", "报亭")).toBe(false);
    expect(hasMoveIntent("听说报亭有消息", "报亭")).toBe(false);
  });

  test("干扰：提两次，有一次带动词就算", () => {
    expect(hasMoveIntent("报亭那边看过了，还是去报亭吧", "报亭")).toBe(true);
  });
});

describe("uniqueAbbrevs — 唯一简称，构造上不可能有歧义", () => {
  test("**正确**：能唯一区分时，前缀与后缀都给", () => {
    // 中文地名的中心词在后面，玩家最常省掉的正是前面的专名。
    // 只做前缀时 `p11-唯一后缀` 实跑 2/74 = 2.7%。
    const a = uniqueAbbrevs(["维森酒吧"], ["警察局", "霍姆斯医院"]);
    expect(a).toContain("维森");
    expect(a).toContain("酒吧");
  });

  test("**正确**：后缀能认出「医院」之于「霍姆斯医院」", () => {
    expect(uniqueAbbrevs(["霍姆斯医院"], ["警察局", "维森酒吧"])).toContain("医院");
  });

  test("**错误行为的红线**：区分不开时一个都不给", () => {
    // 「农场」谁都沾 —— 给了就等于制造歧义。
    const keys = ["农场外围（陷阱区）", "农场外围"];
    const rivals = ["艾德里安的农场", "农场主别墅"];
    expect(uniqueAbbrevs(keys, rivals).every((a) => !rivals.some((r) => r.includes(a)))).toBe(true);
    expect(uniqueAbbrevs(["农场"], ["农场主别墅"])).toEqual([]);
  });

  test("**错误行为的红线**：后缀撞车时也不给", () => {
    // 「医院」同时是两处的中心词 → 谁都不给
    expect(uniqueAbbrevs(["霍姆斯医院"], ["圣玛丽医院"])).not.toContain("医院");
  });

  test("**干扰**：括号补充先剥掉 —— 后缀不该是「陷阱区）」", () => {
    const a = uniqueAbbrevs(["农场外围（陷阱区）"], ["谷仓形建筑"]);
    expect(a.every((x) => !x.includes("）") && !x.includes("("))).toBe(true);
  });

  test("**干扰**：不给出完整键本身（那已经被完整匹配覆盖）", () => {
    expect(uniqueAbbrevs(["报亭"], ["警察局"])).toEqual([]); // 长度 2，没有更短的真前后缀
  });

  test("**干扰**：短于 2 字的片段不给 —— 单个字满大街都是", () => {
    expect(uniqueAbbrevs(["中控室"], ["谷仓大厅"]).every((a) => a.length >= 2)).toBe(true);
  });
});

describe("简称必须紧跟移动动词 —— 光提一嘴不算要去", () => {
  const conns = [conn("police_station", "前往警察局"), conn("weisen_bar", "前往维森酒吧")];

  test("**正确**：「我们去酒吧看看」认得出", () => {
    const o = run("我们去酒吧看看", conns);
    expect(o.forced).toBe(false);
    expect(o.chosenSceneId).toBe("weisen_bar");
  });

  test("**错误行为的红线**：「他在酒吧工作过」不该被当成要去酒吧", () => {
    // 一个光秃秃的中心词出现在句子里，多半是在提一件事。
    // 完整地名不设这道门槛 —— 说全名本身就足够表明是在点地方。
    const o = run("他在酒吧工作过，问问看", conns);
    expect(o.forced).toBe(true);
  });

  test("**干扰**：说全名时不需要动词也算数", () => {
    const o = run("维森酒吧那边应该有线索", conns);
    expect(o.forced).toBe(false);
    expect(o.chosenSceneId).toBe("weisen_bar");
  });
});

describe("端到端 — 唯一简称认得出，不唯一的仍旧 forced", () => {
  test("「先去维森那边」认得出（正例）", () => {
    const conns = [conn("police_station", "前往警察局"), conn("weisen_bar", "前往维森酒吧")];
    const c: PhraseCase = { id: "abbr", kind: "positive", desc: "唯一简称", said: "先去维森那边", wantSceneId: "weisen_bar" };
    expect(judgePhrase(c, run(c.said, conns)).verdict).toBe("pass");
  });

  test("**「去农场」仍旧 forced** —— 三个目标都沾，简称不能凭空造出确定性", () => {
    const conns = [
      conn("adrian_farm", "前往艾德里安的农场"),
      conn("farm_periphery", "进入农场外围（陷阱区）"),
      conn("farm_villa", "前往农场主别墅"),
    ];
    const o = run("去农场", conns);
    expect(o.forced).toBe(true);
    const c: PhraseCase = { id: "amb", kind: "ambiguous", desc: "共同前缀", said: "去农场", wantSceneId: null };
    expect(judgePhrase(c, o).verdict).toBe("pass");
  });

  test("**完整键永远压得过简称** —— 简称扣分不是随便设的", () => {
    // 「去维森酒吧那边，别去警察」：完整键 维森酒吧 vs 简称 警察（若唯一）
    const conns = [conn("police_station", "前往警察局"), conn("weisen_bar", "前往维森酒吧")];
    expect(run("我想去警察局，顺路看看维森", conns).chosenSceneId).toBe("police_station");
  });

  test("干扰：同义改写/代词仍旧 forced（简称不该把它们也吞了）", () => {
    const conns = [conn("police_station", "前往警察局"), conn("weisen_bar", "前往维森酒吧")];
    expect(run("换个地方看看", conns).forced).toBe(true);
    expect(run("去那边", conns).forced).toBe(true);
    expect(run("去那个有灯光的房间", conns).forced).toBe(true);
  });

  test("干扰：两条连接通向同一个场景时，简称不算歧义（去哪儿一点不含糊）", () => {
    const conns = [conn("sewer", "返回下水道"), conn("sewer", "通过奇怪管道（下水道深处）")];
    const o = run("去下水", conns);
    expect(o.forced).toBe(false);
    expect(o.chosenSceneId).toBe("sewer");
  });
});

describe("变异检验 — 判据能不能抓住实现改坏", () => {
  test("把 forced 恒设为 false（假装总是听懂了）→ 歧义类判据必须变红", () => {
    const c: PhraseCase = { id: "pronoun", kind: "ambiguous", desc: "代词", said: "去那边", wantSceneId: null };
    const mutated: PhraseOutcome = { chosenSceneId: "police_station", forced: false };
    expect(judgePhrase(c, mutated).verdict).toBe("fail");
  });

  test("**接真实现**：`matchKeys` 必须含「场景真名」这一支", () => {
    // 定向变异：把 matchKeys 的 `sceneName` 去掉，这条立刻红。
    // 上面那些用构造结果喂判据的测试抓不到它 —— 判据再准，不接实现就守不住。
    const keys = matchKeys(conn("town_premier", "返回镇上"), namedView({ town_premier: "普瑞米尔" }));
    expect(keys).toContain("普瑞米尔");
  });

  test("**接真实现**：condition 与场景真名不同时，说真名也要能对上", () => {
    // 「返回镇上」→ 场景叫「普瑞米尔」。丢掉真名那一支之后，
    // 玩家说「去普瑞米尔」就只能靠打分替选。
    const conns = [conn("town_premier", "返回镇上"), conn("hospital", "前往霍姆斯医院")];
    const w = namedView({ town_premier: "普瑞米尔", hospital: "霍姆斯医院" });
    const r = chooseConnection({ action: "去普瑞米尔" }, conns, w);
    const c: PhraseCase = { id: "real-name", kind: "positive", desc: "说场景真名", said: "去普瑞米尔", wantSceneId: "town_premier" };
    expect(judgePhrase(c, { chosenSceneId: r.conn?.targetSceneId ?? null, forced: r.forced }).verdict).toBe("pass");
  });

  test("对照：场景名取不到时（那一支失效）判据必须报失败", () => {
    const conns = [conn("town_premier", "返回镇上"), conn("hospital", "前往霍姆斯医院")];
    const degraded: MoveWorldView = { ...namedView({ town_premier: "普瑞米尔" }), sceneName: () => "" };
    const r = chooseConnection({ action: "去普瑞米尔" }, conns, degraded);
    const c: PhraseCase = { id: "real-name", kind: "positive", desc: "说场景真名", said: "去普瑞米尔", wantSceneId: "town_premier" };
    expect(judgePhrase(c, { chosenSceneId: r.conn?.targetSceneId ?? null, forced: r.forced }).verdict).toBe("fail");
  });
});
