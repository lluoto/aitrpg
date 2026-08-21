import { describe, expect, test } from "bun:test";
import { extractEndings } from "../ingest/extract-endings";
import type { ChatLike } from "../ingest/infer-connections";

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

const BLOCKS = [{ title: "结局", body: "Normal End 就当旅游了一圈吧。True End 找到了真相。" }];

describe("extractEndings", () => {
  test("抽出结局并按序号给 id", async () => {
    const c = fake(
      `[{"name":"Normal End","description":"就当旅游了一圈吧","conditions":["没有知道真相"]},
        {"name":"True End","description":"找到了真相","conditions":[]}]`,
    );
    const got = await extractEndings(BLOCKS, c);
    expect(got.map((e) => e.id)).toEqual(["ending_1", "ending_2"]);
    expect(got[0]?.name).toBe("Normal End");
    expect(got[0]?.conditions).toEqual(["没有知道真相"]);
    expect(got[1]?.conditions).toEqual([]);
  });

  test("缺名字或缺描述的整条丢掉，id 不留空档", async () => {
    // 没名字的结局在 endLabels 里无从显示，没描述的到了终局什么都念不出来。
    // 丢掉之后 id 必须仍然连号，否则存档里会出现不存在的 ending_2。
    const c = fake(
      `[{"name":"","description":"有描述没名字","conditions":[]},
        {"name":"没描述","description":"","conditions":[]},
        {"name":"True End","description":"找到了真相","conditions":[]}]`,
    );
    const got = await extractEndings(BLOCKS, c);
    expect(got).toHaveLength(1);
    expect(got[0]?.id).toBe("ending_1");
    expect(got[0]?.name).toBe("True End");
  });

  test("conditions 里的空串滤掉", async () => {
    const c = fake(`[{"name":"A","description":"d","conditions":["真条件","","   "]}]`);
    expect((await extractEndings(BLOCKS, c))[0]?.conditions).toEqual(["真条件"]);
  });

  test("conditions 不是数组时给空数组，不抛错", async () => {
    const c = fake(`[{"name":"A","description":"d","conditions":"一条"}]`);
    expect((await extractEndings(BLOCKS, c))[0]?.conditions).toEqual([]);
  });

  test("带 ``` 围栏也能读", async () => {
    const c = fake("```json\n[{\"name\":\"A\",\"description\":\"d\",\"conditions\":[]}]\n```");
    expect(await extractEndings(BLOCKS, c)).toHaveLength(1);
  });

  test("调用失败 → 空数组", async () => {
    const c: ChatLike = { chat: () => Promise.reject(new Error("boom")) };
    expect(await extractEndings(BLOCKS, c)).toEqual([]);
  });

  test("读不出 JSON → 空数组", async () => {
    expect(await extractEndings(BLOCKS, fake("这段里没有结局"))).toEqual([]);
  });

  test("没有正文的块不调用模型", async () => {
    const c = fake("[]");
    expect(await extractEndings([{ title: "附录", body: "   " }], c)).toEqual([]);
    expect(c.calls).toBe(0);
  });

  test("所有块的正文都进 prompt", async () => {
    // 结局不一定写在标题叫「结局」的块里，所以是整批送过去让模型自己找。
    // 谁要是改成按标题挑，这条会红。
    const c = fake("[]");
    await extractEndings(
      [
        { title: "附录", body: "附录的正文" },
        { title: "写在最后", body: "作者的话" },
      ],
      c,
    );
    expect(c.prompt).toContain("附录的正文");
    expect(c.prompt).toContain("作者的话");
  });
});
