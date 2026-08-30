# AGENTS.md

> 本文件由 `bun scripts/agents-md.ts` 从 `docs/todo.json` 的 rule-*
> 条目生成，只渲染规则句本身——事故经过与可查指针见对应 rule id
> （`docs/todo.json`）或 `docs/handoff.md`「工作纪律」一节的完整版本。
> 别直接改这份文件，改了会被下次生成覆盖；改规则去改 `docs/todo.json`。

- 改动前后各跑一次 bun scripts/preflight.ts。（详见 docs/todo.json rule-01）
- 同一类失误连着犯到第 3 次就停手，换一双眼睛（另一个模型 review diff）。（详见 docs/todo.json rule-02）
- 判据没验过就不算数。（详见 docs/todo.json rule-03）
- 提交信息用英文、格式兼容 GitHub（只对新提交生效，不追溯历史）：subject 英文祈使句 + conventio…（详见 docs/todo.json rule-04）
- 先想再写：不确定就问，把多种理解都列出来再动手。（详见 docs/todo.json rule-05）
- 只改必须改的：顺手做的事一旦超出任务范围，副作用大概率不会被自己发现。（详见 docs/todo.json rule-06）
- 答案已经确定就用代码，别再问模型一遍。（详见 docs/todo.json rule-07）
- token 预算是硬约束，加一条先考虑删一条。（详见 docs/todo.json rule-08）
- 先读再写，别只看片段就断言。（详见 docs/todo.json rule-09）
- 测试要验意图，不是验现状。（详见 docs/todo.json rule-10）
- 长流程要设检查点。（详见 docs/todo.json rule-11）
- 惯例优先于个人品味。（详见 docs/todo.json rule-12）
- 失败要主动喊出来，别指望别人从"零条 warn"里猜。（详见 docs/todo.json rule-13）
