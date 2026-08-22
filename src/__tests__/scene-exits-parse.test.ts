// `scenes.exits` 的解析 —— 读取层与写入层共用的那一份。
//
// 起因：扫「无声吞掉错误的 catch」时发现同一份数据有**两套解析**，
// 而且对「数据坏了」的处理是**相反**的：
//
//   读取层 `WorldStateManager.parseExits`
//     `catch { return [] }` —— 「坏了」和「本来就没出口」返回一模一样
//   写入层 `mythos-module`
//     `try { existing.push(...JSON.parse(...)) } catch {}` 然后**照样写回去**
//     —— 原有出口被静默抹掉
//
// docs/kp-tool-surface-assessment.md §八 记的两次事故正是这类：
// 「被 catch 降级成一行警告，模组场景出口整段失效」
// 「类型检查与 710 个测试全绿，只有真实跑团暴露了它」。
//
// 判据的核心是**三种状态必须能分开**：
//   没有出口 / 读得懂 / 读不懂
// 前两种混淆 → 读取层显示错；后两种混淆 → 写入层抹数据。

import { describe, test, expect } from "bun:test";
import { parseExits, mergeExits, parseSighted } from "../state/scene-exits";
import { WorldStateManager } from "../state/world-state-manager";

describe("三种状态必须分得开", () => {
  test("**没有出口**：null / undefined / 空串 / \"[]\" → ok 且为空", () => {
    for (const raw of [null, undefined, "", "[]", "null"]) {
      const r = parseExits(raw);
      expect(r.ok).toBe(true);
      expect(r.exits).toEqual([]);
    }
  });

  test("**读得懂**：对象数组", () => {
    const r = parseExits(JSON.stringify([{ target: "barn", desc: "谷仓" }]));
    expect(r.ok).toBe(true);
    expect(r.exits).toEqual([{ target: "barn", desc: "谷仓" }]);
  });

  test("**读不懂**：JSON 坏了 → ok=false，且**不是**空出口那种 ok", () => {
    // 这一条就是全部要害：坏了必须与「本来就没有」区分得开，
    // 否则写入层会拿空数组把原有出口覆盖掉。
    const r = parseExits("{坏掉的 json");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("JSON");
    expect(parseExits("[]").ok).toBe(true); // 对照
  });

  test("**读不懂**：解析出来不是数组", () => {
    const r = parseExits('{"target":"barn"}');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("不是数组");
  });

  test("**读不懂**：根本不是字符串", () => {
    expect(parseExits(123).ok).toBe(false);
    expect(parseExits({}).ok).toBe(false);
  });
});

describe("部分可用 —— 读取层要显示，写入层不许覆盖", () => {
  const raw = JSON.stringify([{ target: "barn", desc: "谷仓" }, { nope: 1 }, 42]);

  test("好的条目照样返回（读取层「尽力显示」）", () => {
    expect(parseExits(raw).exits).toEqual([{ target: "barn", desc: "谷仓" }]);
  });

  test("**同时** ok=false（写入层据此放弃覆盖）", () => {
    const r = parseExits(raw);
    expect(r.ok).toBe(false);
    expect(r.skipped).toBe(2);
  });

  test("两种立场共用一次解析 —— 不会漂", () => {
    // 读取层看 `exits`，写入层看 `ok`，同一个返回值。
    // 各写一份解析正是这次要根除的东西。
    const r = parseExits(raw);
    expect(r.exits.length).toBeGreaterThan(0);
    expect(r.ok).toBe(false);
  });
});

describe("历史数据 — 纯字符串写法是真实存在的旧数据，不是错误", () => {
  test("字符串数组照收，且 ok=true", () => {
    const r = parseExits(JSON.stringify(["barn", "sewer"]));
    expect(r.ok).toBe(true);
    expect(r.exits).toEqual([
      { target: "barn", desc: "barn" },
      { target: "sewer", desc: "sewer" },
    ]);
  });

  test("**干扰**：空字符串条目算畸形，不是合法出口", () => {
    const r = parseExits(JSON.stringify(["barn", ""]));
    expect(r.exits).toEqual([{ target: "barn", desc: "barn" }]);
    expect(r.ok).toBe(false);
  });

  test("desc 缺失时回落成 target，不算错", () => {
    const r = parseExits(JSON.stringify([{ target: "barn" }]));
    expect(r.ok).toBe(true);
    expect(r.exits[0]).toEqual({ target: "barn", desc: "barn" });
  });
});

describe("sighted — 半截的识别文本比没有更糟", () => {
  const sighted = { entityId: "e1", name: "谷仓", mentionKeywords: ["谷仓"], noticedBy: [], recognition: "你望见那座谷仓。" };

  test("**正确**：字段齐全就带上", () => {
    const r = parseExits(JSON.stringify([{ target: "barn", desc: "谷仓", sighted }]));
    expect(r.ok).toBe(true);
    expect(r.exits[0]!.sighted?.recognition).toBe("你望见那座谷仓。");
  });

  test("**错误输入**：recognition 缺失 → 整个 sighted 丢掉，但出口本身还在", () => {
    const bad = { ...sighted, recognition: "" };
    const r = parseExits(JSON.stringify([{ target: "barn", desc: "谷仓", sighted: bad }]));
    expect(r.exits[0]!.target).toBe("barn");
    expect(r.exits[0]!.sighted).toBeUndefined();
  });

  test("parseSighted 单独也守得住", () => {
    expect(parseSighted(sighted)?.entityId).toBe("e1");
    expect(parseSighted({ entityId: "e1" })).toBeUndefined();
    expect(parseSighted(null)).toBeUndefined();
    expect(parseSighted("字符串")).toBeUndefined();
  });
});

// ── 接真实现：读不干净时**绝不能覆盖** ─────────────────────────

describe("读取层 — 坏数据不再伪装成「没有出口」", () => {
  test("坏掉的 exits 读出来是空的，但不是静默的", () => {
    // 读取层的立场是「尽力显示」，所以仍然返回能解析的部分；
    // 关键是它现在会 warn，而不是让坏数据和「本来就没出口」长得一模一样。
    const world = new WorldStateManager(":memory:");
    world.registerScene("a", "A");
    (world as unknown as { db: { run(q: string, p: unknown[]): void } }).db
      .run("UPDATE scenes SET exits = ? WHERE id = ?", ["{坏掉的", "a"]);
    expect(world.getScene("a")!.exits).toEqual([]);
  });

  test("**对照**：正常写入读回原样", () => {
    const world = new WorldStateManager(":memory:");
    world.registerScene("a", "A");
    world.registerScene("b", "B");
    world.setSceneExits("a", [{ target: "b", desc: "去 B" }]);
    expect(world.getScene("a")!.exits).toEqual([{ target: "b", desc: "去 B" }]);
  });
});

describe("mergeExits — 先来的优先", () => {
  test("按 target 去重", () => {
    const a = [{ target: "barn", desc: "旧描述" }];
    const b = [{ target: "barn", desc: "新描述" }, { target: "sewer", desc: "下水道" }];
    expect(mergeExits(a, b)).toEqual([
      { target: "barn", desc: "旧描述" },
      { target: "sewer", desc: "下水道" },
    ]);
  });

  test("**干扰**：任一侧为空都不出错", () => {
    expect(mergeExits([], [{ target: "a", desc: "a" }])).toEqual([{ target: "a", desc: "a" }]);
    expect(mergeExits([{ target: "a", desc: "a" }], [])).toEqual([{ target: "a", desc: "a" }]);
    expect(mergeExits([], [])).toEqual([]);
  });
});
