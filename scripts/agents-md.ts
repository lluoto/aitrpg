// 生成仓库根目录 AGENTS.md —— 多数 agent 框架（Claude Code / opencode /
// Cursor 等）按约定会在会话开始时自动读取的文件，不需要每轮 prompt
// 手抄一遍工作纪律。
//
// 背景（开发·AGENTS.md 建不建，任务5·已裁决"建"）：规则的目的是降低
// AI 失误率，但 agent 不会自动读 docs/todo.json 或 docs/handoff.md，
// 此前只能靠每轮 prompt 手抄——而 prompt 每轮重写会丢东西，已反复
// 证实（启动方式丢过一次、日志位置指错文件、必需命令被自己的规则
// 禁掉，见 scripts/dev-server.ps1 头注释"模拟 prompt 每轮重写不算数，
// 脚本才算"，同一个道理用在这里）。
//
// 做法：docs/todo.json 的 rule-* 是本仓唯一的规则真相源，
// docs/handoff.md 已经在把它们的完整文本渲染进"工作纪律"一节
// （见 handoff.ts）——AGENTS.md 不是再造一份真相源，是**同一份数据的
// 第二个渲染视图**，与 handoff.md/now.md 同源同机械。
//
// ⚠ 受 rule-08 自己约束（token 预算是硬约束，加一条先考虑删一条）：
// handoff.md 渲染 rule-* 的**完整文本**（含事故经过与可查指针），
// 210+ 行；AGENTS.md 若原样照搬会重复消耗预算，且大多数 agent 框架
// 会把 AGENTS.md 整份塞进每次系统提示词（不像 docs/*.md 那样"需要时
// 才读"）——这里的预算比 handoff.md 更硬。所以只渲染**规则句本身**
// （第一个"——"或第一个"。"之前的部分），事故与指针留在
// docs/todo.json / docs/handoff.md，AGENTS.md 只负责"有这条规矩"，
// 不负责讲故事——读者要故事，指针已经给了去处。
//
// 用法：bun scripts/agents-md.ts

import { readFileSync, writeFileSync, existsSync } from "fs";

/**
 * 从完整的 rule text 里抠出"规则句"——第一个"——"或第一个"。"之前的
 * 那一段，去掉 markdown 强调符号（AGENTS.md 未必经过 markdown 渲染器，
 * `**x**`/`` `x` `` 原样显示反而更难读）。
 *
 * 两个分隔符哪个先出现就在哪里截断——rule-01/03 这类用"。"分句，
 * rule-02/05~13 这类用"——"引出事故，两种写法都要处理。
 *
 * ⚠ rule-04 是本仓 rule-* 里唯一的异常值（712 字符，整份约定细节都
 * 写进了正文，见它自己 docstring 里的说明——这本身也是 rule-06 的
 * 一个反例记录，本轮不碰它）：它的第一个"。"出现在近 300 字之后，
 * 简单找分隔符截不短。加一个硬上限兜底——找到的那一段仍然超过
 * MAX_LEN 就再截一刀、补"…"，不能指望每条 rule 都写得像 rule-01~03
 * 那样短。
 */
const MAX_LEN = 60;
function ruleSentence(text: string): string {
  const dashAt = text.indexOf("——");
  const periodAt = text.indexOf("。");
  let cut = text.length;
  if (dashAt >= 0) cut = dashAt;
  if (periodAt >= 0 && periodAt + 1 < cut) cut = periodAt + 1;
  const sentence = text.slice(0, cut).replace(/[`*]/g, "").trim();
  return sentence.length > MAX_LEN ? sentence.slice(0, MAX_LEN).trim() + "…" : sentence;
}

const todo = existsSync("docs/todo.json")
  ? (JSON.parse(readFileSync("docs/todo.json", "utf8")) as { items: Array<{ id: string; category: string; text: string }> })
  : { items: [] };
// ⚠ 按 id 前缀过滤，不按 category——todo-40 也标了 category:"工作约定"
// 但它是一条历史事实记录（提交语言切换点），不是行为规则，id 不是
// "rule-" 前缀。handoff.ts 现有的生成器按 category 过滤，todo-40 因此
// 混进了它的"工作纪律"列表（已是既有行为，本轮不改 handoff.ts——
// 那是另一个生成器，改它超出这条任务范围，rule-06 刚定的规矩）；
// AGENTS.md 是新脚本，没有"沿用旧逻辑"的负担，直接按任务原话
// "todo.json 的 rule-*" 来。
const rules = todo.items.filter((i) => i.id.startsWith("rule-"));

const md = `# AGENTS.md

> 本文件由 \`bun scripts/agents-md.ts\` 从 \`docs/todo.json\` 的 rule-*
> 条目生成，只渲染规则句本身——事故经过与可查指针见对应 rule id
> （\`docs/todo.json\`）或 \`docs/handoff.md\`「工作纪律」一节的完整版本。
> 别直接改这份文件，改了会被下次生成覆盖；改规则去改 \`docs/todo.json\`。

${rules.map((r) => `- ${ruleSentence(r.text)}（详见 docs/todo.json ${r.id}）`).join("\n")}
`;

writeFileSync("AGENTS.md", md, "utf8");
console.log(`AGENTS.md 已生成 —— ${md.split("\n").length} 行 / ${(md.length / 1024).toFixed(2)} KB，共 ${rules.length} 条规则`);
