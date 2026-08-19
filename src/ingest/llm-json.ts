// 摄取管线 · 从 LLM 回答里抠 JSON
//
// 块分类和条目分类各存了一份逐字相同的拷贝（连注释都一样）。围栏解析真要修的时候
// 得记着修两处，漏掉一处就是两份悄悄跑偏的实现 —— 而这段的失效方式是「返回 null，
// 上游拿到空表」，跑偏了也不报错，只表现成模型没干活。就是本层最该避免的那种静默。
//
// 单独成模块而不是塞进两个分类器里的任何一个：谁 import 谁都会让一侧的分类逻辑
// 平白依赖另一侧，而这两件事之间本来毫无关系。它也不属于 llm/client ——
// 那边管怎么把话送出去，这边管模型话里夹了解释文字和代码围栏时怎么捞回结构。

/** 从可能夹着解释文字或代码围栏的回答里抠出 JSON 对象 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? (fenced[1] as string) : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}
