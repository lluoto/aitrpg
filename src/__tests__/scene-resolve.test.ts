// 真人那条路的移动解析 —— 判据。
//
// 起因：查「新接的 LLM 消歧会不会被执行」时顺着调用链发现，
// `chooseConnection` 只服务剧本杀循环；**真人玩的那条路**
// （`api/game-session.ts`）有另一套完全独立的匹配，而且：
//   · 没有否定处理 —— 「别去警察局」含「警察局」，直接把人搬过去
//   · 没有 forced 概念 —— 认准了静默移动，没认准也静默移动
//   · 返回值在两个调用点都被丢掉
//   · 全仓只有一条 happy-path 测试（「移动到谷仓」）
// 剧本杀那条路查出来的一串毛病，在真人这条路上原样存在 ——
// 而真人才是会打出「别去警察局」的那个。
//
// 抽成纯函数之后先量（`tools/_probe-scene-resolve.ts`：11 条错 3 条），再改。

import { describe, test, expect } from "bun:test";
import { resolveSceneTarget, bigramScore, BIGRAM_CONFIDENT } from "../play/scene-resolve";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";

const rows = BARN_OF_PREMIER.scenes.map((s) => ({ id: s.id, name: s.name }));
const displayNames = Object.fromEntries(rows.map((r) => [r.id, r.name]));
const aliases = Object.fromEntries(rows.map((r) => [r.id, [r.name]]));

const go = (said: string) => resolveSceneTarget({ said, displayNames, aliases, rows });

describe("精确匹配 — 认准了就不算替选", () => {
  test("展示名 / id", () => {
    expect(go("警察局")).toEqual({ sceneId: "police_station", forced: false, via: "display-name" });
    expect(go("police_station").sceneId).toBe("police_station");
  });

  test("空输入不动", () => {
    expect(go("").sceneId).toBeNull();
    expect(go("   ").sceneId).toBeNull();
  });
});

describe("包含匹配", () => {
  test("**正例**：地名在句中", () => {
    const r = go("警察局了解案情");
    expect(r.sceneId).toBe("police_station");
    expect(r.forced).toBe(false);
  });

  test("**正例**：反向包含（玩家只说了名字的一部分）", () => {
    expect(go("移动到谷仓").sceneId).toBe("barn_building");
  });
});

describe("提到 ≠ 要去 —— 这是改之前错的那三条", () => {
  test("**错误输入**：否定，且被否定的地名**更短**（改前靠长度蒙对）", () => {
    const r = go("别去警察局，去维森酒吧");
    expect(r.sceneId).toBe("weisen_bar");
  });

  test("**错误输入**：否定，且被否定的地名**更长**（改前必错）", () => {
    // 原实现按「名字最长」挑，被否定的那个更长就一定选它。
    // 唯一「过了」的用例是靠长度运气 —— 换个更长的立刻现形。
    expect(go("别去艾德里安在镇子内的住宅，去报亭").sceneId).toBe("newsstand");
    expect(go("不要去谷仓形建筑，去报亭").sceneId).toBe("newsstand");
  });

  test("**错误输入**：已经去过了", () => {
    expect(go("警察局那边已经去过了，现在去报亭").sceneId).toBe("newsstand");
  });

  test("**干扰输入**：句子里有「不」但不是修饰地名的 → 照常去", () => {
    expect(go("不管怎样先去警察局").sceneId).toBe("police_station");
  });

  test("**干扰输入**：所有候选都被否定 → 不该硬挑一个", () => {
    const r = go("别去警察局");
    expect(r.sceneId).not.toBe("police_station");
  });
});

describe("没提地名就别搬人", () => {
  // 我一度断言「bigram 阈值 1 等于几乎任何一句话都能匹配上」。
  // 量完发现是错的：这四句得分都是 0。判据留在这儿守住它。
  for (const said of ["我看看地上的血迹", "我检查一下自己的背包", "问问他知道些什么", "我想先休息一会儿"]) {
    test(`「${said}」不移动`, () => {
      expect(go(said).sceneId).toBeNull();
    });
  }

  test("这四句对每个场景的 bigram 分都是 0（阈值不是唯一防线，但也别冤枉它）", () => {
    for (const said of ["我看看地上的血迹", "我检查一下自己的背包"]) {
      for (const r of rows) expect(bigramScore(said, r.name)).toBe(0);
    }
  });
});

describe("forced — 没认准要说出来", () => {
  test("**正确**：精确 / 干净的包含匹配不算替选", () => {
    expect(go("警察局").forced).toBe(false);
    expect(go("警察局了解案情").forced).toBe(false);
  });

  test("**错误行为的红线**：bigram 兜底且分数不高 → 必须标 forced", () => {
    const r = go("移动到谷仓");
    expect(r.via).toBe("bigram");
    expect(r.forced).toBe(true);
  });

  test("阈值是明确常量，不是散落的魔法数", () => {
    expect(BIGRAM_CONFIDENT).toBeGreaterThan(1);
  });
});

describe("回归 — 修复过程中真的踩到的两个坑", () => {
  test("**坑 1**：`isRejectedMention` 对「压根没提到」返回 true", () => {
    // 无条件拿它过滤 bigram 那一步，等于把整步废掉 ——
    // 「移动到谷仓」当场从命中变成不动。必须「提到了**而且**被排除」才跳过。
    expect(go("移动到谷仓").sceneId).toBe("barn_building");
  });

  test("**坑 2**：过滤掉被否定的之后，反向包含那一支不能跟着失效", () => {
    // 「谷仓」→「谷仓形建筑」这类走的是反向包含，不能因为
    // 正向包含没候选就整段跳过。
    expect(go("谷仓形建筑").sceneId).toBe("barn_building");
    expect(go("下水道").sceneId).toBe("sewer");
  });
});

describe("bigramScore", () => {
  test("共有二元组计数", () => {
    expect(bigramScore("谷仓形建筑", "谷仓形建筑")).toBe(4);
    expect(bigramScore("进入谷仓调查", "谷仓形建筑")).toBe(1);
    expect(bigramScore("完全无关", "警察局")).toBe(0);
  });

  test("干扰：太短的串没有二元组", () => {
    expect(bigramScore("去", "警察局")).toBe(0);
    expect(bigramScore("警察局", "局")).toBe(0);
  });
});
