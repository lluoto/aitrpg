// 摄取管线 · 场景 id 分配
//
// id 是内部句柄，不与基准的手写意译 id 对齐（那是语义翻译，机械复现不了，
// 把基准 id 喂进 prompt 又等于泄题）。所以这里能测的只有四条功能需求：
// 唯一、同输入稳定、纯 ASCII、与输入一一对应。

import { describe, test, expect } from "bun:test";
import { assignSceneIds } from "../ingest/scene-id";
import type { Section } from "../ingest/sectionize";

const sec = (title: string): Section => ({
  title,
  body: "",
  items: [],
  source: { page: 1, line: 1 },
});

describe("assignSceneIds", () => {
  test("与输入等长", () => {
    expect(assignSceneIds([sec("甲"), sec("乙"), sec("丙")])).toHaveLength(3);
  });

  test("空输入给空数组", () => {
    expect(assignSceneIds([])).toEqual([]);
  });

  test("同一份输入两次跑出同一批 id —— 稳定性是 diff 有意义的前提", () => {
    const input = [sec("甲"), sec("乙")];
    expect(assignSceneIds(input)).toEqual(assignSceneIds(input));
  });

  test("全部唯一", () => {
    const ids = assignSceneIds(Array.from({ length: 44 }, (_, i) => sec(`块${i}`)));
    expect(new Set(ids).size).toBe(44);
  });

  test("重名标题各得各的 id —— 以标题为键会静默丢块", () => {
    const ids = assignSceneIds([sec("卧室"), sec("卧室")]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("纯 ASCII —— 中文 id 会渗进存档文件名与 Provenance.path", () => {
    for (const id of assignSceneIds([sec("特里坎家"), sec("霍姆斯医院")])) {
      expect(id).toMatch(/^[a-z0-9_]+$/);
    }
  });

  test("序号是块在文中的序号，不是场景的序号", () => {
    // 只有一部分块会被判成场景。按块编号，分类结果变化时
    // 仍是场景的那些块 id 不会漂移；按场景编号则会全体挪位。
    const ids = assignSceneIds([sec("前言"), sec("特里坎家"), sec("附录")]);
    expect(ids).toEqual(["scene_01", "scene_02", "scene_03"]);
  });

  test("超过 99 块自然进位成三位，不截断", () => {
    const ids = assignSceneIds(Array.from({ length: 100 }, (_, i) => sec(`块${i}`)));
    expect(ids[99]).toBe("scene_100");
    expect(new Set(ids).size).toBe(100);
  });
});
