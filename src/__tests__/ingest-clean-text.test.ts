// 摄取管线：PDF 文本清洗
//
// 样本全部取自《普瑞米尔的谷仓 ver1.03.pdf》实际抽出的文本，不是编的。
// PDF 是分栏排版，pdf-parse 抽出来有两个固定毛病：
//   1. 行内数字与拉丁词被制表符包裹（"来自 \t2077 \t瑞弗警官"）
//   2. 长句在栏宽处被硬换行切断（"木质栅栏，\n上面的油漆"）
// 不清洗直接喂下游，句子是断的，数值旁边挂着制表符。

import { describe, test, expect } from "bun:test";
import { cleanPageText } from "../ingest/clean-text";

describe("制表符包裹", () => {
  test("行内数字两侧的制表符收成单个空格", () => {
    // 实样：前言里提到游戏《2077》
    expect(cleanPageText("灵感有来自 \t2077 \t瑞弗警官的支线任务")).toBe(
      "灵感有来自 2077 瑞弗警官的支线任务",
    );
  });

  test("拉丁词同样处理", () => {
    expect(cleanPageText("旧日支配者之治的 \tMi-Go \t支线任务")).toBe(
      "旧日支配者之治的 Mi-Go 支线任务",
    );
  });

  test("骰子表达式不能被拆开", () => {
    // 陷阱数值是要被下游解析的，1D4+1 中间进了空格就废了
    expect(cleanPageText("硫酸会造成 \t1D4+1 \t的伤害")).toBe("硫酸会造成 1D4+1 的伤害");
  });

  test("紧贴中文的制表符收成空格 —— 中西文之间留一格更可读", () => {
    expect(cleanPageText("模组采用\tCOC7th\t规则")).toBe("模组采用 COC7th 规则");
  });
});

describe("分栏硬换行", () => {
  test("中文行尾无终止标点时与下一行接上，不插空格", () => {
    const raw = "这间农场周围围着很简单的木质栅栏，\n上面的油漆都已经被雨水腐蚀掉了。";
    expect(cleanPageText(raw)).toBe("这间农场周围围着很简单的木质栅栏，上面的油漆都已经被雨水腐蚀掉了。");
  });

  test("连续多行断句全部接上", () => {
    const raw = "在入口处\n似乎还有一块本应存在的牌匾，现在也只能看\n到孤零零的架子。";
    expect(cleanPageText(raw)).toBe("在入口处似乎还有一块本应存在的牌匾，现在也只能看到孤零零的架子。");
  });

  test("句号结尾不与下一行合并", () => {
    const raw = "艾德里安从来没有使用过这个别墅。\n里面都是空的。";
    expect(cleanPageText(raw)).toBe("艾德里安从来没有使用过这个别墅。\n里面都是空的。");
  });

  test("问号叹号同样是句子边界", () => {
    expect(cleanPageText("你确定吗？\n他没有回答。")).toBe("你确定吗？\n他没有回答。");
    expect(cleanPageText("快跑！\n身后传来声音。")).toBe("快跑！\n身后传来声音。");
  });

  test("右引号收尾算句子边界 —— 场景描述都是整段引文", () => {
    const raw = "到哪里去了。”\n当调查员来到这个地方的时候";
    expect(cleanPageText(raw)).toBe("到哪里去了。”\n当调查员来到这个地方的时候");
  });
});

describe("段落与空行", () => {
  test("空行保留为段落分隔", () => {
    expect(cleanPageText("第一段结束。\n\n第二段开始。")).toBe("第一段结束。\n\n第二段开始。");
  });

  test("多个连续空行压成一个", () => {
    expect(cleanPageText("上一段。\n\n\n\n下一段。")).toBe("上一段。\n\n下一段。");
  });

  test("首尾空白去掉", () => {
    expect(cleanPageText("\n\n  正文。  \n\n")).toBe("正文。");
  });
});

describe("条目标记", () => {
  test("▶ 开头的条目自成一行，不被上一行吸走", () => {
    // 模组用 ▶ 标记陷阱/规则条目，这是下游切分的重要锚点
    const raw = "不会伤害到调查员。\n▶硫酸陷阱：会从门上直接倒下一瓶硫酸";
    expect(cleanPageText(raw)).toBe("不会伤害到调查员。\n▶硫酸陷阱：会从门上直接倒下一瓶硫酸");
  });

  test("上一行没有终止标点时，▶ 仍然另起一行", () => {
    const raw = "以下是陷阱列表\n▶捕兽夹：踩中时造成伤害";
    expect(cleanPageText(raw)).toBe("以下是陷阱列表\n▶捕兽夹：踩中时造成伤害");
  });
});

describe("标题与标签行", () => {
  // 场景名是下游切分的锚点。实样里它们被吸进了正文：
  //   "艾德里安的农场：“这间农场周围围着..."
  // 一旦糊在一起，就没法靠它定位场景边界了。

  test("短标签行（冒号结尾）自成一行，不被上一行吸走", () => {
    expect(cleanPageText("《普瑞米尔的谷仓》ver1.03\n前言：\n本模组是在吃安眠药的情况下想到的")).toBe(
      "《普瑞米尔的谷仓》ver1.03\n前言：\n本模组是在吃安眠药的情况下想到的",
    );
  });

  test("场景名不与紧随其后的场景描述合并", () => {
    const raw = "艾德里安的农场：\n“这间农场周围围着很简单的木质栅栏，\n上面的油漆都已经被雨水腐蚀掉了。”";
    expect(cleanPageText(raw)).toBe(
      "艾德里安的农场：\n“这间农场周围围着很简单的木质栅栏，上面的油漆都已经被雨水腐蚀掉了。”",
    );
  });

  test("冒号结尾但很长的句子不算标签，仍按正常断句处理", () => {
    // "艾德里安会在外围布置 3 种陷阱：" 是正文的一部分，不是标题
    const raw = "艾德里安会在外围布置 3 种陷阱：\n▶捕兽夹：体形小于 35 的角色会免疫";
    expect(cleanPageText(raw)).toBe("艾德里安会在外围布置 3 种陷阱：\n▶捕兽夹：体形小于 35 的角色会免疫");
  });

  test("标签行之后的正文照常合并", () => {
    const raw = "维修间：\n这里堆着工具，\n墙上挂着几把扳手。";
    expect(cleanPageText(raw)).toBe("维修间：\n这里堆着工具，墙上挂着几把扳手。");
  });
});

describe("幂等", () => {
  test("清洗过的文本再洗一次不变", () => {
    const raw = "灵感有来自 \t2077 \t瑞弗警官，\n这是第二行。";
    const once = cleanPageText(raw);
    expect(cleanPageText(once)).toBe(once);
  });
});

describe("空输入", () => {
  test("空串返回空串", () => {
    expect(cleanPageText("")).toBe("");
  });
  test("纯空白返回空串", () => {
    expect(cleanPageText("  \n\t\n  ")).toBe("");
  });
});
