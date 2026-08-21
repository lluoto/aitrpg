// 条目分类二次追问的边界测试。
//
// 这一层的价值全在「只改该改的、失败不拖累原判」上 ——
// 追问是锦上添花，一旦它能把已经判对的条目弄坏，或者一次网络抖动就让整批分类归零，
// 那 +9 分的收益随时会被一次坏运气吃掉。所以测的重点是**不越界**。
import { describe, expect, test } from "bun:test";
import type { ItemInput, ItemKind } from "../ingest/classify-items";
import {
  eventFollowupPrompt,
  itemFollowupPrompt,
  parseKeyed,
  refineItemKinds,
} from "../ingest/classify-followup";

const inp = (key: string, name: string, text = "正文"): ItemInput => ({
  key,
  sceneTitle: "农场外围",
  sceneId: "scene_01",
  name,
  text,
});

/** 只按预设脚本回话的假客户端，顺带记下它被问了几次、问了什么 */
function fakeClient(replies: string[]) {
  const asked: string[] = [];
  let i = 0;
  return {
    asked,
    client: {
      chat: async (msgs: Array<{ role: string; content: string }>) => {
        asked.push(msgs[0]?.content ?? "");
        return replies[i++] ?? "{}";
      },
    } as never,
  };
}

describe("追问 prompt", () => {
  test("item 族的例子不能删 —— 删掉之后实测掉 2 分", () => {
    const p = itemFollowupPrompt([inp("p1:L1", "床头柜")]);
    for (const eg of ["防盗门的钥匙", "驾驶证", "床头柜", "枪械柜"]) expect(p).toContain(eg);
  });

  test("item 族点明文件也算 thing —— 基准 6 个非陷阱物品里 3 个是文件", () => {
    expect(itemFollowupPrompt([inp("p1:L1", "x")])).toContain("文件、照片、证件都算 thing");
  });

  test("event 族问的是「往下还有得查吗」，不是「发生了什么」", () => {
    const p = eventFollowupPrompt([inp("p1:L1", "x")]);
    expect(p).toContain("能继续往下查");
    expect(p).toContain("lead");
    expect(p).toContain("dead");
  });

  test("条目键出现在 prompt 里 —— 模型得拿它当返回的键", () => {
    expect(itemFollowupPrompt([inp("p7:L3", "驾驶证")])).toContain("p7:L3");
  });
});

describe("解析", () => {
  const known = new Set(["p1:L1", "p1:L2"]);

  test("正常 JSON", () => {
    const m = parseKeyed('{"p1:L1":"thing","p1:L2":"place"}', known, ["thing", "place"]);
    expect(m.get("p1:L1")).toBe("thing");
    expect(m.get("p1:L2")).toBe("place");
  });

  test("模型把整行抄回来当键时认出行首的 pN:LN", () => {
    const m = parseKeyed('{"p1:L1 【农场外围】床头柜":"place"}', known, ["thing", "place"]);
    expect(m.get("p1:L1")).toBe("place");
  });

  test("枚举外的答案丢弃，不兜底猜", () => {
    expect(parseKeyed('{"p1:L1":"也许是"}', known, ["thing", "place"]).size).toBe(0);
  });

  test("没问过的键丢弃 —— 模型会编", () => {
    expect(parseKeyed('{"p9:L9":"thing"}', known, ["thing", "place"]).size).toBe(0);
  });

  test("JSON 坏掉时返回空表，不抛", () => {
    expect(parseKeyed("{不是 JSON", known, ["thing", "place"]).size).toBe(0);
  });
});

describe("覆盖原判", () => {
  const inputs = [inp("p1:L1", "床头柜"), inp("p1:L2", "驾驶证"), inp("p2:L1", "如果他冷静下来")];
  const base = new Map<string, ItemKind>([
    ["p1:L1", "item"],
    ["p1:L2", "item"],
    ["p2:L1", "event"],
  ]);

  test("place 改判 clue，thing 维持 item", async () => {
    const { client } = fakeClient(['{"p1:L1":"place","p1:L2":"thing"}', '{"p2:L1":"dead"}']);
    const after = await refineItemKinds(inputs, base, client);
    expect(after.get("p1:L1")).toBe("clue");
    expect(after.get("p1:L2")).toBe("item");
  });

  test("lead 改判 clue，dead 维持 event —— dead 不是一个类别，只是「不改」", async () => {
    const { client } = fakeClient(["{}", '{"p2:L1":"lead"}']);
    expect((await refineItemKinds(inputs, base, client)).get("p2:L1")).toBe("clue");
    const { client: c2 } = fakeClient(["{}", '{"p2:L1":"dead"}']);
    expect((await refineItemKinds(inputs, base, c2)).get("p2:L1")).toBe("event");
  });

  // 只问该问的那一族。把 trap/connection 这些一起送进去，等于让模型重判一遍，
  // 而它们本来就判对了 —— 那是拿已有的分数去赌。
  test("只把 item 族送进 item 追问，别的类别不参与", async () => {
    const withTrap = [...inputs, inp("p3:L1", "硫酸陷阱")];
    const kinds = new Map(base).set("p3:L1", "trap" as ItemKind);
    const { client, asked } = fakeClient(["{}", "{}"]);
    await refineItemKinds(withTrap, kinds, client);
    expect(asked[0]).toContain("p1:L1");
    expect(asked[0]).not.toContain("p3:L1");
  });

  test("不改动传进来的表 —— 调用方要拿前后两份对比", async () => {
    const { client } = fakeClient(['{"p1:L1":"place"}', "{}"]);
    await refineItemKinds(inputs, base, client);
    expect(base.get("p1:L1")).toBe("item");
  });

  // 追问是锦上添花。一次网络抖动就把已有分类拖下水，那 +9 分随时会被坏运气吃掉。
  test("追问调用抛错时维持原判，不是清空", async () => {
    const client = {
      chat: async () => {
        throw new Error("network");
      },
    } as never;
    const after = await refineItemKinds(inputs, base, client);
    expect(after.get("p1:L1")).toBe("item");
    expect(after.get("p2:L1")).toBe("event");
    expect(after.size).toBe(base.size);
  });

  test("一族失败不影响另一族", async () => {
    let n = 0;
    const client = {
      chat: async () => {
        n++;
        if (n === 1) throw new Error("boom");
        return '{"p2:L1":"lead"}';
      },
    } as never;
    const after = await refineItemKinds(inputs, base, client);
    expect(after.get("p1:L1")).toBe("item"); // 第一族没修成，维持
    expect(after.get("p2:L1")).toBe("clue"); // 第二族照修
  });

  test("某一族为空时不发请求 —— 空清单问模型只会得到噪声", async () => {
    const onlyEvents = [inp("p2:L1", "如果他冷静下来")];
    const kinds = new Map<string, ItemKind>([["p2:L1", "event"]]);
    const { client, asked } = fakeClient(["{}"]);
    await refineItemKinds(onlyEvents, kinds, client);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("往下查");
  });
});
