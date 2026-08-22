// LLM 到底通不通 —— **实际发一次请求**再说。
//
// 这个仓库有一条明令：「判断 LLM 通不通，必须实际发一次请求，
// 不要拿测试输出或历史记录当证据」（docs/notes/ingest.md）。
// 但一直没有工具实现它，于是判断方式还是靠翻记录 ——
// 而 `bun test` 输出里那句 `[config] No LLM_API_KEY set` 是**测试在验证
// 无 key 的降级路径**，跟真实可用性没有关系，最容易被当成证据。
//
// 另一件同样重要的事写在下面的报告里：五个跑局诊断脚本全都
// `LLM_DISABLED=true`，也就是说**它们从没量过 LLM 路径**。
// 「离线测试盖不到的行为」正是当初要做诊断脚本的理由，别让它变成盲区。
//
// 用法：bun scripts/diag/probe-llm.ts

import { loadConfig } from "../../src/config";
import { LLMClient } from "../../src/llm/client";
import { writeReport } from "../../src/diagnostics/report";

const cfg = loadConfig();
const hasKey = cfg.apiKey !== "sk-placeholder" && !cfg.apiKey.startsWith("${");

const out: string[] = ["# LLM 可用性探针", ""];
out.push(`- 时间：${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
out.push(`- baseUrl：\`${cfg.baseUrl}\``);
out.push(`- model：\`${cfg.model}\``);
out.push(`- key：${hasKey ? `已配置（长度 ${cfg.apiKey.length}）` : "**缺失**"}`);
out.push("");

let ok = false;
let detail = "";
if (!hasKey) {
  detail = "没有 key，连请求都发不出去";
} else {
  const t0 = Date.now();
  try {
    // 熔断是进程级静态变量，探针里先复位，免得被同进程里的历史失败带偏
    LLMClient.resetDefeat();
    const reply = await new LLMClient(cfg).chat(
      [{ role: "user", content: "只回复两个字：可用" }],
      { maxTokens: 32, temperature: 0, timeout: 60_000 },
    );
    ok = reply.trim().length > 0;
    detail = `耗时 ${Date.now() - t0}ms，回复 ${JSON.stringify(reply.trim().slice(0, 60))}`;
  } catch (e) {
    detail = `耗时 ${Date.now() - t0}ms，${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
  }
}

out.push(ok ? `## ✓ 可用` : `## ✗ 不可用`);
out.push("");
out.push(detail);
out.push("");
out.push("## 已知盲区");
out.push("");
out.push("五个跑局诊断脚本（fuzz / wounds / combat / downed 与 phrasing）都写死");
out.push("`LLM_DISABLED = \"true\"`，**从没量过 LLM 路径**。它们量的是离线行为，");
out.push("这一点本身没错（要可复现），但别把结论当成「整个引擎都这样」。");
out.push("");
out.push("特别地：`chooseConnection` 是**纯子串匹配，任何时候都不问 LLM**。");
out.push("所以「换个地方看看」这类说法认不出，原因是匹配器不问，");
out.push("**不是**因为没有 API。这两件事以前被混为一谈过。");

const path = await writeReport("probe-llm.md", out.join("\n"));
console.log(`${ok ? "✓ LLM 可用" : "✗ LLM 不可用"}｜${detail}  -> ${path}`);
process.exit(ok ? 0 : 1);
