// 摄取管线 · PDF → 逐页文本
//
// 这里只测形态，不测内容保真。
//
// 内容保真需要原文切片，而切片在被 .gitignore 排除的 tools/ 下，
// 且 `0fbf778 chore: keep one copy of the raw material` 明确只留一份素材。
// 把 PDF 文本复制进 fixtures 既违背那个决定，也等于把模组原文又铺进一处。
// 保真靠实跑对 tools/modules/raw/ 逐字比对（已验证 17/17），不靠单测假装验证。
//
// 别把这条当成漏测顺手补上。

import { describe, test, expect } from "bun:test";
import { extractPages } from "../ingest/pdf-source";

describe("extractPages", () => {
  // await 不能省：expect(...).rejects 返回的是 Promise，
  // 不 await 就没人观察这个断言，函数不抛时测试照样绿 —— 等于什么都没测
  test("空数据直接抛 —— 返回空数组会让整条管线安静地产出零个场景", async () => {
    // 那种失败会表现成「模型没干活」，而真正的原因在最上游
    await expect(extractPages(new Uint8Array(0))).rejects.toThrow();
  });

  test("不是 PDF 的字节也要抛，不能假装成功", async () => {
    await expect(extractPages(new TextEncoder().encode("这不是 PDF"))).rejects.toThrow();
  });
});
