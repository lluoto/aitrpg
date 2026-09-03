// 摄取管线 · 无基准模式下的 id 行为（开发·无基准模式 任务④）
//
// 无基准时不猜、不硬套：`scenes`/`items` 就是内部句柄的原样版本
// （scene_NN/item_NN），一个 id 都不改写——`scripts/ingest/run.ts` 的
// 实现方式是"压根不调用 id 继承"，不是"调用 id 继承但传一个空数组当
// 基准"（两者结果一样，见 inherit-ids.ts 的 computeIdInheritance：传
// 空基准数组时每个候选都会走"基准里找不到同名条目"分支，行为等价，
// 但"压根不调用"更直接地表达了"这一步没有基准可比"，不依赖
// computeIdInheritance 恰好在空输入下的行为不崩这件事）。
//
// 这份测试钉住的是**可观察的结果**：不管内部走哪条路径，无基准时产出
// 的 id 必须严格符合 `scene_NN`/`item_NN` 这个内部句柄的形状——不能是
// 任何看起来像人工意译的字符串（比如 "adrian_bedroom" 这种基准风格的
// id）。凭空生成一个看起来像意译的 id，等于偷偷造出第四套命名体系
// （现有三套见 todo-19/todo-34），这条红线比"多产出/少产出"更重要。

import { describe, test, expect } from "bun:test";
import { runIngestFromPages } from "../ingest/pipeline";

function scriptedClient(replies: string[]) {
  let i = 0;
  return {
    chat: async (_msgs: Array<{ role: string; content: string }>) => replies[i++] ?? "{}",
  } as never;
}

const PAGES = [
  "艾德里安的卧室：\n这是一间很简洁的卧室。\n▶床头柜：翻开之后发现一本日记。\n" +
    "维森酒吧：\n维森酒吧是这个小镇唯二的酒吧。\n▶奇怪的钥匙：可以打开某扇门。\n",
];

const SCENE_ID_PATTERN = /^scene_\d+$/;
const ITEM_ID_PATTERN = /^item_\d+$/;

describe("无基准时，scenes/items 的 id 严格是内部句柄形状，不是任何看起来像意译的字符串", () => {
  test("场景 id 全部匹配 scene_NN——即使场景名字听起来很像基准会用的意译（如「艾德里安的卧室」），也不会被巧合地「猜」成 adrian_bedroom 这类形状", async () => {
    const client = scriptedClient([
      '{"艾德里安的卧室":"scene","维森酒吧":"scene"}',
      '{"p1:L3":"item","p1:L6":"item"}',
      '{"p1:L3":"item","p1:L6":"item"}',
    ]);
    const r = await runIngestFromPages(PAGES, client);
    // 无基准模式：直接用管线产出的原始 scenes/items，不做任何 id 继承尝试
    // ——这正是 scripts/ingest/run.ts 无基准分支的做法（不调用
    // computeBaselineComparison，scenes = r.scenes，items = r.items）。
    for (const s of r.scenes) {
      expect(s.id, `场景「${s.name}」的 id「${s.id}」不符合内部句柄形状`).toMatch(SCENE_ID_PATTERN);
    }
  });

  test("物品 id 全部匹配 item_NN", async () => {
    const client = scriptedClient([
      '{"艾德里安的卧室":"scene","维森酒吧":"scene"}',
      '{"p1:L3":"item","p1:L6":"item"}',
      '{"p1:L3":"item","p1:L6":"item"}',
    ]);
    const r = await runIngestFromPages(PAGES, client);
    for (const it of r.items) {
      expect(it.id, `物品「${it.name}」的 id「${it.id}」不符合内部句柄形状`).toMatch(ITEM_ID_PATTERN);
    }
  });

  test("场景连接（connections[].targetSceneId）同样没有被悄悄改写成基准风格的引用", async () => {
    const client = scriptedClient([
      '{"艾德里安的卧室":"scene","维森酒吧":"scene"}',
      '{"p1:L3":"item","p1:L6":"item"}',
      '{"p1:L3":"item","p1:L6":"item"}',
    ]);
    const r = await runIngestFromPages(PAGES, client);
    for (const s of r.scenes) {
      for (const c of s.connections) {
        expect(c.targetSceneId).toMatch(SCENE_ID_PATTERN);
      }
    }
  });
});
