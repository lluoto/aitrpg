// 测试里访问外网必须直接报错。
//
// 逼出这条闸门的事故：全量输出里混进了**真实的 LLM 回复** ——
//
//     play-logs\_api_cap_test.mjs:
//     === API 配置 ===
//     baseUrl: https://chat.ecnu.edu.cn/open/api/v1 | model: ecnu-plus
//     === 1. 非流式 chat ===  OK: 明白
//
// 那是手工跑局留下的探测脚本，目录 `play-logs/` 在 .gitignore 里，
// 但 `bun test` **不看 gitignore**：它扫整个项目目录，文件名带 `_test`
// 就被当成测试执行。于是每一次 `bun test` 都在拿真 key 打线上 ——
// 慢、烧 token、结果不确定，而且**别人的检出上没有这个文件**，
// 属于查不出来的那种「我这儿才有」的差异。
//
// 两道防线：
//   · bunfig 的 `root = "src"` —— 解决「这一个文件」
//   · 这条 fetch 闸门 —— 解决「任何一个」
//
// 这个文件验的是第二道。防护本身不验，就只是另一段没人跑过的代码。

import { describe, test, expect } from "bun:test";

describe("测试进程的网络闸门", () => {
  test("**错误行为的红线**：连外网必须抛错，不能悄悄放行", async () => {
    let msg = "(没抛)";
    try {
      await fetch("https://chat.ecnu.edu.cn/open/api/v1/chat/completions");
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("不许访问外网");
    expect(msg).toContain("chat.ecnu.edu.cn"); // 要说清拦的是谁
  });

  test("**干扰输入**：别的外部域名一样拦", async () => {
    let msg = "(没抛)";
    try { await fetch("https://api.openai.com/v1/models"); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("不许访问外网");
  });

  test("**正确**：本机地址放行 —— 用「连不上」验熔断和降级是有意的", async () => {
    // 放行不等于连得上：127.0.0.1:1 必然拒绝连接。
    // 要分清「被闸门拦下」和「连过去但被拒」——前者说明闸门管太宽。
    let msg = "(没抛)";
    try { await fetch("http://127.0.0.1:1/"); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toContain("不许访问外网");
  });

  test("**正确**：localhost 同样放行", async () => {
    let msg = "(没抛)";
    try { await fetch("http://localhost:1/"); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toContain("不许访问外网");
  });

  test("**干扰输入**：报错要给出绕过办法，否则下一个人只会把闸门删掉", async () => {
    let msg = "";
    try { await fetch("https://example.com/"); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("ALLOW_TEST_NETWORK=1");
  });
});
