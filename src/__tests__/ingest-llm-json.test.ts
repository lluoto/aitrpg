// 从 LLM 回答里抠 JSON —— 全仓唯一实现（src/llm/json.ts）的契约测试。
//
// 这段逻辑曾经六份拷贝（摄取管线两个解析器各存一份，另外四处或抄一份
// 或干脆没有），2026-08-29 收敛到 src/llm/json.ts，因为两个真正会
// 裸 JSON.parse 炸掉的消费方（llm/intent.ts、llm/generate-llm-expanded.ts）
// 一份都没拿到——intent.ts 那处直接导致过一次真事故（见该文件的注释）。
//
// 它的失效方式是最难看出的一种：返回 null，上游拿到空表，表现成「模型
// 没答」。前几轮各栽在这个形状上一次，都是从「模型好像没干活」查起，
// 绕了一圈才发现是解析这一层丢的。所以这里直接对着 extractJson 测，
// 把它到底认什么、不认什么钉下来。
//
// 下面写的都是**现有实现的实际契约**，不是希望它有的契约 ——
// 有几条（围栏优先、尾随文字里带花括号）是刺，照实钉住比假装没有更有用。

import { describe, test, expect } from "bun:test";
import { extractJson, extractJsonArray } from "../llm/json";

describe("能认出来的", () => {
  test("干净的 JSON 对象原样解析", () => {
    expect(extractJson('{"农场外围": "scene"}')).toEqual({ 农场外围: "scene" });
  });

  test("```json 围栏里的", () => {
    // 模型被要求「只输出 JSON」时最常见的违约方式，就是好心裹一层围栏
    const reply = '```json\n{"p9:L13": "trap"}\n```';
    expect(extractJson(reply)).toEqual({ "p9:L13": "trap" });
  });

  test("光秃秃的 ``` 围栏里的 —— 语言标注是可选的", () => {
    const reply = '```\n{"p9:L13": "trap"}\n```';
    expect(extractJson(reply)).toEqual({ "p9:L13": "trap" });
  });

  test("光秃秃的围栏后面还跟着散文 —— 这条才真的在考围栏那一支", () => {
    // 上一条其实考不住：把正则的 `(?:json)?` 改成必须写 json，它照样绿 ——
    // 围栏认不出来时会退回全文扫花括号，恰好也捞得到同一个对象。
    // 后面挂一段带花括号的散文，两条路就分岔了：认出围栏才拿得到对象，
    // 认不出就会把散文一起切进来、解析失败给 null。变异测过，这条会红。
    const reply = '```\n{"报亭": "scene"}\n```\n说明：{已按要求输出}';
    expect(extractJson(reply)).toEqual({ 报亭: "scene" });
  });

  test("前后都夹着解释文字", () => {
    // 「不要任何解释文字」这条要求模型时不时就忘。前后各一段散文，
    // 靠首个 { 到末个 } 之间那截把对象捞出来
    const reply = '好的，我的判断如下：\n{"报亭": "scene", "附录": "structure"}\n如有疑问请告知。';
    expect(extractJson(reply)).toEqual({ 报亭: "scene", 附录: "structure" });
  });

  test("围栏没闭合也认 —— 回答被截断是真会发生的", () => {
    // 没有收尾的 ```，正则整体不匹配，于是退回全文找花括号，照样能捞出对象
    expect(extractJson('```json\n{"报亭": "scene"}')).toEqual({ 报亭: "scene" });
  });
});

describe("认不出来的一律给 null", () => {
  // 这一组是本模块唯一的失败信号。给 null 而不是抛，是让上游能决定怎么降级；
  // 代价是空表和「模型答了但答错」长得一样，所以调用方那边都配了 warning。

  test("花括号里不是合法 JSON", () => {
    expect(extractJson('{"报亭": scene}')).toBeNull();
  });

  test("一个花括号都没有", () => {
    expect(extractJson("我无法完成这个任务。")).toBeNull();
  });

  test("空字符串", () => {
    expect(extractJson("")).toBeNull();
  });

  test("只有 JSON 数组 —— 本函数只认对象", () => {
    // 找的是 { 与 }，数组没有，直接 null。上游两个解析器都按 {键: 值} 约定 prompt，
    // 所以这不是缺陷；但它意味着模型回了个数组会表现成「没答」
    expect(extractJson('["scene", "npc"]')).toBeNull();
  });

  test("右花括号在左花括号前面", () => {
    expect(extractJson("} 然后 {")).toBeNull();
  });
});

describe("两处刺 —— 照实钉住，别当它不存在", () => {
  test("有围栏就只看围栏里的，围栏外的对象一概不看", () => {
    // body 被换成围栏内容之后，外面那个 {"a":1} 就再也进不了视野。
    // 模型同时给「直接回答」和「示例围栏」时，拿到的是围栏那份。
    const reply = '{"报亭": "scene"}\n```json\n{"附录": "structure"}\n```';
    expect(extractJson(reply)).toEqual({ 附录: "structure" });
  });

  test("尾随的解释文字里带花括号会把整段拖废", () => {
    // 末个 } 落在散文里，切出来的那段就不是合法 JSON —— 结果是 null，
    // 也就是「模型没答」那个症状。真遇上了别去查 LLM，查这里。
    expect(extractJson('{"报亭": "scene"}\n说明：{已按要求输出}')).toBeNull();
  });
});

describe("extractJsonArray —— 同一份围栏/散文剥离逻辑，认的是 [ ] 不是 { }", () => {
  test("干净的 JSON 数组原样解析", () => {
    expect(extractJsonArray('["a", "b"]')).toEqual(["a", "b"]);
  });

  test("```json 围栏里的数组", () => {
    const reply = '```json\n[{"name":"true"}]\n```';
    expect(extractJsonArray(reply)).toEqual([{ name: "true" }]);
  });

  test("模型说没有结局时按 prompt 要求给空数组", () => {
    const reply = '好的，这段文字里没有结局。\n[]';
    expect(extractJsonArray(reply)).toEqual([]);
  });

  test("认不出数组的一律给 null，即便文本里有合法的对象", () => {
    // 与 extractJson 分工相反：这里找的是 [ 与 ]，对象形态不算数。
    expect(extractJsonArray('{"a": 1}')).toBeNull();
  });

  test("空字符串给 null", () => {
    expect(extractJsonArray("")).toBeNull();
  });

  test("方括号里不是合法 JSON 给 null", () => {
    expect(extractJsonArray("[a, b]")).toBeNull();
  });

  test("方括号里是对象不是数组（JSON.parse 能过，但 Array.isArray 会拦）", () => {
    // `[` 和 `]` 都能在文本里找到，但切出来的内容解析后不是数组
    expect(extractJsonArray("先看这个 [提示] 然后是 {\"a\":1}")).toBeNull();
  });
});
