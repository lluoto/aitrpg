// 摄取管线 · id 分配
//
// id 是内部句柄，不与基准的手写意译 id 对齐（那是语义翻译，机械复现不了，
// 把基准 id 喂进 prompt 又等于泄题）。所以 id 本身能测的只有四条功能需求：
// 唯一、同输入稳定、纯 ASCII、与输入一一对应。
//
// 但这个文件测的不止 id：底下还钉了 sourceKey 的形态（`p9:L13`）。
// 形态不是 id 的性质，钉在这儿是因为它同时充当 assignItemIds 的键与 Provenance.sourceRef，
// 一变两处齐错。原来这段只写「能测的只有四条」，把它漏在了话外 ——
// 正是本轮在收的那种「注释比代码少说一件事」。

import { describe, test, expect } from "bun:test";
import { assignSceneIds, assignItemIds, assignNpcIds } from "../ingest/ids";
import type { Section, SectionItem } from "../ingest/sectionize";
import { sourceKey } from "../ingest/sectionize";
import type { SectionKind } from "../ingest/classify-sections";

const sec = (title: string): Section => ({
  title,
  body: "",
  items: [],
  source: { page: 1, line: 1 },
});

describe("assignSceneIds", () => {
  test("与输入等长", () => {
    expect(assignSceneIds([sec("甲"), sec("乙"), sec("丙")])).toHaveLength(3);
  });

  test("空输入给空数组", () => {
    expect(assignSceneIds([])).toEqual([]);
  });

  test("同一份输入两次跑出同一批 id —— 稳定性是 diff 有意义的前提", () => {
    const input = [sec("甲"), sec("乙")];
    expect(assignSceneIds(input)).toEqual(assignSceneIds(input));
  });

  test("全部唯一", () => {
    const ids = assignSceneIds(Array.from({ length: 44 }, (_, i) => sec(`块${i}`)));
    expect(new Set(ids).size).toBe(44);
  });

  test("重名标题各得各的 id —— 以标题为键会静默丢块", () => {
    const ids = assignSceneIds([sec("卧室"), sec("卧室")]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("纯 ASCII —— 中文 id 会渗进存档文件名与 Provenance.path", () => {
    const ids = assignSceneIds([sec("特里坎家"), sec("霍姆斯医院")]);
    expect(ids.length).toBe(2); // 空表会让下面的循环一条断言都不跑 —— 先钉住它非空
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9_]+$/);
    }
  });

  test("序号是块在文中的序号，不是场景的序号", () => {
    // 只有一部分块会被判成场景。按块编号，分类结果变化时
    // 仍是场景的那些块 id 不会漂移；按场景编号则会全体挪位。
    const ids = assignSceneIds([sec("前言"), sec("特里坎家"), sec("附录")]);
    expect(ids).toEqual(["scene_01", "scene_02", "scene_03"]);
  });

  test("超过 99 块自然进位成三位，不截断", () => {
    const ids = assignSceneIds(Array.from({ length: 100 }, (_, i) => sec(`块${i}`)));
    expect(ids[99]).toBe("scene_100");
    expect(new Set(ids).size).toBe(100);
  });
});

const item = (name: string, page: number, line: number): SectionItem => ({
  name,
  text: "x",
  source: { page, line },
});

const secWith = (title: string, items: SectionItem[]): Section => ({
  title,
  body: "",
  items,
  source: { page: 1, line: 1 },
});

describe("sourceKey", () => {
  test("形态是 pN:LN", () => {
    expect(sourceKey({ page: 9, line: 13 })).toBe("p9:L13");
  });

  test("不补零 —— 页码行号本来就是数，补零只会多一套要记的规矩", () => {
    expect(sourceKey({ page: 1, line: 1 })).toBe("p1:L1");
  });
});

describe("assignItemIds", () => {
  test("以 sourceKey 为键 —— 标题会重复，页内行号不会", () => {
    const ids = assignItemIds([secWith("农场外围", [item("捕兽夹", 9, 13)])]);
    expect(ids.get("p9:L13")).toBe("item_01");
  });

  test("跨块连续编号", () => {
    const ids = assignItemIds([
      secWith("甲", [item("a", 1, 1), item("b", 1, 2)]),
      secWith("乙", [item("c", 2, 1)]),
    ]);
    expect([...ids.values()]).toEqual(["item_01", "item_02", "item_03"]);
  });

  test("覆盖全部条目，不只是场景块上的 —— 筛选依赖分类结果，编号不能跟着它漂", () => {
    // 一个块从 scene 翻成 npc，它名下的条目就消失。若只给筛选后的编号，
    // 后面所有 id 会集体挪位，跨版本 diff 就没法比了。
    const ids = assignItemIds([
      secWith("菲碧·特里坎", [item("", 3, 8)]),
      secWith("农场外围", [item("捕兽夹", 9, 13)]),
    ]);
    expect(ids.size).toBe(2);
    expect(ids.get("p9:L13")).toBe("item_02");
  });

  test("同一份输入两次跑出同一批 id", () => {
    const input = [secWith("甲", [item("a", 1, 1), item("b", 1, 2)])];
    expect([...assignItemIds(input)]).toEqual([...assignItemIds(input)]);
  });

  test("全部唯一且纯 ASCII", () => {
    const items = Array.from({ length: 39 }, (_, i) => item(`条目${i}`, 1, i + 1));
    const ids = assignItemIds([secWith("甲", items)]);
    expect(new Set(ids.values()).size).toBe(39);
    for (const id of ids.values()) expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  test("没有条目时给空表", () => {
    expect(assignItemIds([secWith("甲", [])]).size).toBe(0);
  });
});

describe("assignNpcIds（开发·管线继承基准 id：修复 NPC id 复用 scene_NN 编号空间的 bug）", () => {
  const kindsOf = (pairs: [string, SectionKind][]): Map<string, SectionKind> => new Map(pairs);

  test("**错误行为红线**：npc 编号与它在全部块里的位置无关——不会因为它排在第 5 块就变成 npc_05/scene_05 那种巧合", () => {
    // 前四块随便什么类型，第五块才是 npc——如果 npc 的 id 是从块位置派生的
    // （旧 bug 的行为），这里会得到某种带"5"的 id；assignNpcIds 应该只数
        // npc 类的块，得到 npc_01（它是遇到的第一个 npc，不是第五个块）。
    const sections = [sec("场景一"), sec("场景二"), sec("场景三"), sec("场景四"), sec("艾德里安")];
    const kinds = kindsOf([
      ["场景一", "scene"], ["场景二", "scene"], ["场景三", "scene"], ["场景四", "scene"], ["艾德里安", "npc"],
    ]);
    const ids = assignNpcIds(sections, kinds);
    expect(ids.get("艾德里安")).toBe("npc_01");
  });

  test("不与 assignSceneIds 撞号：同一批块各自独立编号，npc_01 与 scene_01 可以同时存在指不同的块", () => {
    const sections = [sec("艾德里安"), sec("特里坎家")];
    const kinds = kindsOf([["艾德里安", "npc"], ["特里坎家", "scene"]]);
    const sceneIds = assignSceneIds(sections); // 按全部块编号：scene_01, scene_02
    const npcIds = assignNpcIds(sections, kinds);
    expect(sceneIds[0]).toBe("scene_01"); // "艾德里安" 这一块在场景编号表里仍然占了一个号（assignSceneIds 不看 kind）
    expect(npcIds.get("艾德里安")).toBe("npc_01"); // 但它的 NPC id 是独立编号，不是 scene_01
  });

  test("只数 npc 类的块，跳过其它类型", () => {
    const sections = [sec("前言"), sec("艾德里安"), sec("特里坎家"), sec("菲碧")];
    const kinds = kindsOf([
      ["前言", "structure"], ["艾德里安", "npc"], ["特里坎家", "scene"], ["菲碧", "npc"],
    ]);
    const ids = assignNpcIds(sections, kinds);
    expect(ids.size).toBe(2);
    expect(ids.get("艾德里安")).toBe("npc_01");
    expect(ids.get("菲碧")).toBe("npc_02");
  });

  test("没有任何 npc 类的块时给空表", () => {
    const sections = [sec("特里坎家")];
    const kinds = kindsOf([["特里坎家", "scene"]]);
    expect(assignNpcIds(sections, kinds).size).toBe(0);
  });

  test("同一份输入两次跑出同一批 id", () => {
    const sections = [sec("艾德里安"), sec("菲碧")];
    const kinds = kindsOf([["艾德里安", "npc"], ["菲碧", "npc"]]);
    expect([...assignNpcIds(sections, kinds)]).toEqual([...assignNpcIds(sections, kinds)]);
  });

  test("纯 ASCII", () => {
    const sections = [sec("艾德里安"), sec("菲碧")];
    const kinds = kindsOf([["艾德里安", "npc"], ["菲碧", "npc"]]);
    for (const id of assignNpcIds(sections, kinds).values()) expect(id).toMatch(/^[a-z0-9_]+$/);
  });
});
