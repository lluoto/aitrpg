import { describe, expect, test } from "bun:test";
import { inferConnections, type ChatLike } from "../ingest/infer-connections";

/** 记下最后一次收到的 prompt，供「有没有截断」那条断言检查。 */
function fake(reply: string): ChatLike & { prompt: string; calls: number } {
  const f = {
    prompt: "",
    calls: 0,
    async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
      f.calls++;
      f.prompt = messages[0]?.content ?? "";
      return reply;
    },
  };
  return f as ChatLike & { prompt: string; calls: number };
}

const S = [
  { id: "s1", name: "普瑞米尔", description: "一个小镇。" },
  { id: "s2", name: "警察局", description: "镇上的警察局。" },
  { id: "s3", name: "证物室", description: "警察局里面的房间。" },
];

describe("inferConnections", () => {
  test("把场景名换成 id", async () => {
    const c = fake(`{"普瑞米尔":["警察局"],"警察局":["普瑞米尔","证物室"]}`);
    const got = await inferConnections(S, c);
    expect(got.get("s1")).toEqual(["s2"]);
    expect(got.get("s2")).toEqual(["s1", "s3"]);
  });

  test("认不出的名字整条丢掉，不留悬空的边", async () => {
    // 模型偶尔会写出不在表里的地名。那种边指向一个不存在的场景，
    // 接到运行时就是一个点得进去、走不到的出口。
    const c = fake(`{"普瑞米尔":["警察局","市政厅"],"火星":["警察局"]}`);
    const got = await inferConnections(S, c);
    expect(got.get("s1")).toEqual(["s2"]);
    expect(got.has("火星")).toBe(false);
    expect([...got.keys()]).toEqual(["s1"]);
  });

  test("自环丢掉", async () => {
    const c = fake(`{"普瑞米尔":["普瑞米尔","警察局"]}`);
    expect((await inferConnections(S, c)).get("s1")).toEqual(["s2"]);
  });

  test("重复的目标只留一条", async () => {
    const c = fake(`{"普瑞米尔":["警察局","警察局"]}`);
    expect((await inferConnections(S, c)).get("s1")).toEqual(["s2"]);
  });

  test("带 ``` 围栏的 JSON 也能读", async () => {
    const c = fake("```json\n{\"普瑞米尔\":[\"警察局\"]}\n```");
    expect((await inferConnections(S, c)).get("s1")).toEqual(["s2"]);
  });

  test("调用失败 → 空 Map，连接维持空数组", async () => {
    // 失败语义：宁可没有边，也不要半张乱图。
    const c: ChatLike = {
      chat: () => Promise.reject(new Error("boom")),
    };
    expect((await inferConnections(S, c)).size).toBe(0);
  });

  test("JSON 读不出来 → 空 Map", async () => {
    expect((await inferConnections(S, fake("我觉得它们都连着"))).size).toBe(0);
  });

  test("场景不足两个就不调用模型", async () => {
    const c = fake("{}");
    expect((await inferConnections([S[0]!], c)).size).toBe(0);
    expect(c.calls).toBe(0);
  });

  test("描述必须整段给，不能截断", async () => {
    // 这条守的是一个量出来的结论：描述给前 90 字 F1 只有 0.71，
    // 400 字 0.76，全文 0.81。关键的衔接信息常在 90 字之后 ——
    // 农场那段「再稍微往里有两个比较显眼的建筑…」正是包含关系。
    // 谁要是又给它加上截断，这条会红。
    const tail = "这句话在第一百二十字之后才出现而且它是唯一的入口线索";
    const long = { id: "s9", name: "长场景", description: "铺垫".repeat(60) + tail };
    const c = fake("{}");
    await inferConnections([...S, long], c);
    expect(c.prompt).toContain(tail);
  });

  test("prompt 里带着场景的原始名字", async () => {
    const c = fake("{}");
    await inferConnections(S, c);
    for (const s of S) expect(c.prompt).toContain(s.name);
  });
});
