// 线索文本匹配的判据本身。
//
// 背景：同一场景多条未发现线索共用一个技能触发时，引擎此前直接给场景里
// 第一条未发现线索，玩家的话从没被读取——"侦查卫生间"拿到休息区的手枪，
// "侦查餐厅"拿到卫生间的毒品。见 game-session.ts 的 resolveSceneClueMatch()
// 与 src/investigation/clue-match.ts。
//
// bun test src/__tests__/clue-match.test.ts

import { describe, it, expect } from "bun:test";
import { matchSceneClues, hasSearchIntent } from "../investigation/clue-match";

describe("matchSceneClues — 命中唯一", () => {
  it("玩家的话包含某条线索的关键词，且只有它包含 → 精确命中", () => {
    const candidates = [
      { id: "clue_pistol", texts: ["黑袋子中的手枪", "侦查休息区/仔细检查床底"] },
      { id: "clue_drugs", texts: ["毒品", "侦查卫生间/仔细检查洗漱用具"] },
      { id: "clue_card", texts: ["奇怪的卡片", "侦查餐厅/宣言仔细检查餐桌：可以发现在披萨盒下面有一张小卡片"] },
    ];
    expect(matchSceneClues("卫生间", candidates).hit).toBe("clue_drugs");
    expect(matchSceneClues("餐厅", candidates).hit).toBe("clue_card");
    expect(matchSceneClues("床底", candidates).hit).toBe("clue_pistol");
  });

  it("玩家的话是某条线索关键词的父串（说得更完整）也能命中", () => {
    const candidates = [
      { id: "a", texts: ["卫生间"] },
      { id: "b", texts: ["餐厅"] },
    ];
    expect(matchSceneClues("我进去卫生间看看", candidates).hit).toBe("a");
  });

  it("对不带 / 的自由文本描述同样能匹配（27/32 的真实数据形状）", () => {
    const candidates = [
      { id: "clue_newspaper", texts: ["绑架犯的报道", "在废报纸中翻阅，成功的图书馆技能找到关于艾德里安的报道"] },
      { id: "clue_guest", texts: ["贵客身份", "付出大量现金+至少困难成功的社交类技能"] },
    ];
    expect(matchSceneClues("报纸", candidates).hit).toBe("clue_newspaper");
  });
});

describe("matchSceneClues — 命中多条：问，不猜", () => {
  it("两条候选的关键词都出现在同一句话里 → ambiguous，不擅自选一个", () => {
    const candidates = [
      { id: "a", texts: ["检查桌子"] },
      { id: "b", texts: ["检查桌子下面的箱子"] },
    ];
    const r = matchSceneClues("检查桌子", candidates);
    // "检查桌子" 是 a 的完整键，也是 b 键的子串——两条都命中
    expect(r.hit).toBe(null);
    expect(r.ambiguous.sort()).toEqual(["a", "b"]);
  });
});

describe("matchSceneClues — 无位置信号的裸动词：该问不该猜", () => {
  // 背景（真实案例，非构造）：diag-clue-phrasing.ts 实跑抓到——"艾德里安的
  // 卧室"场景裸的"侦查"精确命中了 clue_bedroom_diary，只因为它唯一的
  // findMethods 描述恰好写的是"侦查或挪开床头柜"，同场景另一条线索
  // （母语检定日记本）的描述完全不含任何调查动词——于是"侦查"这个词单靠
  // 子串包含就"碰巧"只命中了一条，看着像精确匹配，实际玩家等于什么都
  // 没说。这里复刻这个精确形状（一条候选的描述以调查动词开头，另一条
  // 不含任何调查动词），而不是两条描述都用同一个动词开头——那样两条会
  // 一起命中变成"两条都沾边"的歧义，反而测不出"看着唯一、实为虚假"这种
  // 更隐蔽的错误。
  const candidates = [
    { id: "clue_diary", texts: ["日记本与老旧文件", "侦查或挪开床头柜"] },
    { id: "clue_old_doc", texts: ["老旧文件（米-戈联络术）", "困难的母语来对照日记本观看文件"] },
  ];

  it.each(["侦查", "检查", "搜索", "搜查", "观察", "调查", "翻找"])(
    "裸动词「%s」（没有位置/对象信号）→ 不精确命中任何一条，报歧义",
    (verb) => {
      const r = matchSceneClues(verb, candidates);
      expect(r.hit).toBeNull();
    },
  );

  it("裸动词场景下 ambiguous 列出全部候选，供调用方原样转述给玩家", () => {
    const r = matchSceneClues("侦查", candidates);
    expect(r.ambiguous.sort()).toEqual(["clue_diary", "clue_old_doc"]);
  });

  it("**干扰**：动词后面跟了真实内容时不受影响，照常精确命中", () => {
    // 防止"矫枉过正"：不能因为句子里出现了调查动词，就连带内容一起否掉。
    expect(matchSceneClues("挪开床头柜", candidates).hit).toBe("clue_diary");
    expect(matchSceneClues("对照日记本观看文件", candidates).hit).toBe("clue_old_doc");
  });

  it("**干扰**：多个动词叠在一起但仍然没有实质内容 → 依旧歧义", () => {
    // "调查侦查搜索"去掉所有动词后剩不下东西，不该因为词多了就侥幸算出内容。
    const r = matchSceneClues("调查侦查搜索", candidates);
    expect(r.hit).toBeNull();
  });
});

describe("matchSceneClues — 一条不中：如实说没有，不是给下一条", () => {
  it("玩家的话跟任何候选都不沾边 → hit 和 ambiguous 都是空", () => {
    const candidates = [
      { id: "clue_pistol", texts: ["黑袋子中的手枪", "侦查休息区/仔细检查床底"] },
      { id: "clue_drugs", texts: ["毒品", "侦查卫生间/仔细检查洗漱用具"] },
    ];
    const r = matchSceneClues("衣柜", candidates);
    expect(r.hit).toBe(null);
    expect(r.ambiguous).toEqual([]);
  });
});

describe("matchSceneClues — 否定/已完成语境不算命中", () => {
  // ⚠ isRejectedMention 复用自 move-util.ts，内部 NEGATION 正则的可选动词
  // 组是移动动词（去/前往/到/进/进入/回/返回/走），"别搜 X"/"先不检查 X"
  // 这类"否定词+调查动词+名词"结构对不上——那是 move-util 的既有局限，
  // 不在本轮改动范围内。但 DONE_AFTER 那半支覆盖的是"已经搜过/查过"，
  // 这组词本来就是调查场景会用到的，可以真实生效。
  it("「侦查卫生间已经搜过了」不该再命中卫生间那条线索", () => {
    const candidates = [
      { id: "clue_drugs", texts: ["毒品", "侦查卫生间/仔细检查洗漱用具"] },
      { id: "clue_card", texts: ["奇怪的卡片", "侦查餐厅/宣言仔细检查餐桌"] },
    ];
    const r = matchSceneClues("侦查卫生间已经搜过了", candidates);
    expect(r.hit).not.toBe("clue_drugs");
  });
});

describe("hasSearchIntent — 简称必须紧跟调查动词", () => {
  it("紧跟「侦查」的关键词算数", () => {
    expect(hasSearchIntent("侦查卫生间", "卫生间")).toBe(true);
  });
  it("单独出现在句中、前面不是调查动词，不算数", () => {
    expect(hasSearchIntent("他从卫生间走了出来", "卫生间")).toBe(false);
  });
});
