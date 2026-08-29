// 从 LLM 回答里抠 JSON —— 全仓唯一实现，谁都不该再抄一份。
//
// 背景：这段逻辑曾经存在六份拷贝（含改成认数组的变体），而两个真正会
// 裸 `JSON.parse()` 炸掉的消费方（llm/intent.ts、llm/generate-llm-expanded.ts）
// 一份都没拿到。intent.ts 那处直接导致过一次真事故：LLM 把合法 JSON 裹进
// ```json 围栏，JSON.parse(raw.trim()) 抛异常，静默回落到 regex 兜底，
// regex 里贪婪的 /追/ 把"追问 NPC"命中成"chase"（追逐），一次对话请求
// 变成一次追逐判定。见 docs/notes/engine.md 对这次实跑的记录。
//
// 放在 src/llm/ 而不是 src/ingest/：`src/ingest/*.ts` 已经在 import
// `src/llm/client.ts` 的 `LLMClient` 类型——ingest 依赖 llm 这条方向早就
// 定了，把这段逻辑放回 ingest/ 会让 llm/ 反过来 import ingest/，方向反了。
// 这里无下层依赖，任何一层都能安全 import（同 llm/enabled.ts 抽到这一层
// 的理由——那边也是因为多个上层都要用、放回任一个上层都会成环）。

function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenced ? (fenced[1] as string) : text;
}

/** 从可能夹着解释文字或代码围栏的回答里抠出 JSON 对象（`{ }`）。认不出返回 null。 */
export function extractJson(text: string): unknown {
  const body = stripFence(text);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 同上，但抠的是数组（`[ ]`）不是对象（`{ }`）。
 *
 * 不给 `extractJson` 加参数改成"认对象还是数组"：两种形态的起止符号、
 * 失败返回值形状都不同，一个参数管两种行为比两个函数更容易在调用点
 * 传错默认值。调用方明确知道自己要哪种，直接调对应的函数。
 */
export function extractJsonArray(text: string): unknown[] | null {
  const body = stripFence(text);
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
