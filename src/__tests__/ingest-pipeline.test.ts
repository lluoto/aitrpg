// 编排层的测试。
//
// 这一层没有自己的逻辑，全是「谁先谁后、中间量传给谁」。所以测的也是这个：
// 两处顺序都踩过坑，一处让 4 个跨页条目丢了正文，一处让物品精确率退回 9/19。
// 顺序错了不会抛错、不会红 —— 只会让实跑数字悄悄变差，而那是最难查的一类。
//
// 走 `runIngestFromPages` 而不是 `runIngest`：后者第一件事是解码 PDF，
// 而 PDF 在仓库之外。这道缝就是为了让编排能脱离那份文件被验。
import { describe, expect, test } from "bun:test";
import { runIngestFromPages } from "../ingest/pipeline";

/** 按调用顺序回话的假客户端，顺带记下每次的 prompt */
function scriptedClient(replies: string[]) {
  const prompts: string[] = [];
  let i = 0;
  return {
    prompts,
    client: {
      chat: async (msgs: Array<{ role: string; content: string }>) => {
        prompts.push(msgs[0]?.content ?? "");
        return replies[i++] ?? "{}";
      },
    } as never,
  };
}

/**
 * 一页最小可切分的正文。
 *
 * 标题那行的**冒号不能少**：`sectionize.ts` 的 `TITLE_LINE` 认的是
 * 「短的、以冒号收尾的行」，没有冒号就整页落进 title 为空的前置块，
 * 一个场景也建不出来。条目行用 ▶ 起头，它的键是 `p1:L3`。
 */
const PAGES = ["农场外围：\n这里是非常危险的一个场景。\n▶床头柜：翻开之后发现一本日记。\n"];

describe("编排", () => {
  test("跑得通：切出块、分了类、建出场景", async () => {
    const { client } = scriptedClient(['{"农场外围":"scene"}', '{"p1:L3":"item"}', '{"p1:L3":"place"}']);
    const r = await runIngestFromPages(PAGES, client);
    expect(r.sections.length).toBeGreaterThan(0);
    expect(r.scenes.map((s) => s.name)).toEqual(["农场外围"]);
  });

  test("交出中间量 —— 度量那侧要拿它们对基准，少一个就得把编排再抄一遍", async () => {
    const { client } = scriptedClient([]);
    const r = await runIngestFromPages(PAGES, client);
    for (const k of [
      "sections",
      "kinds",
      "ids",
      "scenes",
      "sceneWarnings",
      "itemInputs",
      "itemKindsFirstPass",
      "itemKinds",
      "itemIds",
      "items",
      "provenance",
      "itemWarnings",
    ]) {
      expect(r).toHaveProperty(k);
    }
  });

  // 追问**之前**的那份分类要单独留着。没有它就算不出「修好几条 / 弄坏几条」，
  // 而那两个数是判断追问有没有反效果的唯一依据 —— 只看总分会把
  // 「修好 5 条弄坏 5 条」看成「没变化」。
  test("追问前后两份分类都交出来，且不是同一个对象", async () => {
    const { client } = scriptedClient(['{"农场外围":"scene"}', '{"p1:L3":"item"}', '{"p1:L3":"place"}']);
    const r = await runIngestFromPages(PAGES, client);
    expect(r.itemKinds).not.toBe(r.itemKindsFirstPass);
    expect(r.itemKindsFirstPass.get("p1:L3")).toBe("item");
    expect(r.itemKinds.get("p1:L3")).toBe("clue");
  });

  // 顺序错了不会抛错，只会让物品精确率从 9/11 退回 9/19：
  // 追问把「床头柜」改判成 clue 之后，它才不会变成 ModuleItem。
  test("追问在建物品之前 —— 改判过的条目不该再变成物品", async () => {
    const { client } = scriptedClient(['{"农场外围":"scene"}', '{"p1:L3":"item"}', '{"p1:L3":"place"}']);
    const r = await runIngestFromPages(PAGES, client);
    expect(r.items.map((i) => i.name)).not.toContain("床头柜");
  });

  test("追问答 thing 时仍然建成物品 —— 别把「不建」写死了", async () => {
    const { client } = scriptedClient(['{"农场外围":"scene"}', '{"p1:L3":"item"}', '{"p1:L3":"thing"}']);
    const r = await runIngestFromPages(PAGES, client);
    expect(r.items.length).toBeGreaterThan(0);
  });

  test("给出阶段标签，调用方才能把录下来的 prompt 分组", async () => {
    const { client } = scriptedClient([]);
    const seen: string[] = [];
    await runIngestFromPages(PAGES, client, { onStage: (l) => seen.push(l) });
    expect(seen).toContain("块分类");
    expect(seen).toContain("条目分类");
  });

  test("一次 LLM 调用都不成功时不抛，交出空的分类结果", async () => {
    const client = {
      chat: async () => {
        throw new Error("network");
      },
    } as never;
    const r = await runIngestFromPages(PAGES, client);
    expect(r.scenes).toEqual([]);
    expect(r.items).toEqual([]);
  });
});

describe("编排层的边界", () => {
  // 评分键是度量用的答案。一旦进了编排层，就有机会顺着参数流进 prompt。
  test("不 import 评分键", async () => {
    const src = await Bun.file("src/ingest/pipeline.ts").text();
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("scoring-key");
    expect(code).not.toContain("ENTRY_SCORING_KEY");
  });

  // 无 IO 是硬约束不是风格：这里一旦出现文件读写，整条管线就只能靠实跑来验，
  // 而实跑要花钱、要一份仓库外的 PDF、还不确定。
  // 注释里可以提这些名字（本文件的模块注释就提了），所以先把注释剥掉再看。
  test("不碰文件系统 —— 入口收的是字节，不是路径", async () => {
    const src = await Bun.file("src/ingest/pipeline.ts").text();
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const io of ["readFileSync", 'from "fs"', "Bun.file", "Bun.write"]) {
      expect(code).not.toContain(io);
    }
  });
});
