// 台词引导桥的拼接
//
// 这里锁的是同一个 bug 反复出现的那条缝：引擎会在台词前加一句叙述引导桥
// （"歪着头想了想，说："），LLM 又常常在台词开头自带一段神态。两边各自都对，
// 叠起来就重复。先是重复成「引导桥 + （括号神态）台词」，把括号切出来转成叙述句之后，
// 又重复成「…搓着手说，说：」—— 因为切出来的动作本身已经带了动词。
//
// bun test src/__tests__/dialogue-lead.test.ts

import { describe, it, expect } from "bun:test";
import { speechLead } from "../play-module";

describe("引导桥不重复动词", () => {
  // 实跑原文：play-logs/run-2026-08-18T06-06-34.txt
  // 「菲碧·特里坎焦虑不安地搓着手说，说："你们回来了！"」
  it("动作已经以「说」收尾时不再补一个", () => {
    expect(speechLead("焦虑不安地搓着手说")).toBe("焦虑不安地搓着手说：");
  });

  it("问/道/答收尾同样不补", () => {
    expect(speechLead("开口问")).toBe("开口问：");
    expect(speechLead("补充道")).toBe("补充道：");
    expect(speechLead("低声回答")).toBe("低声回答：");
  });

  it("动作不带动词时才补「，说：」", () => {
    expect(speechLead("面带忧色")).toBe("面带忧色，说：");
    expect(speechLead("歪着头想了想")).toBe("歪着头想了想，说：");
  });

  it("两端空白不带进输出", () => {
    expect(speechLead("  面带忧色  ")).toBe("面带忧色，说：");
    expect(speechLead("  低声说  ")).toBe("低声说：");
  });

  it("拼出来的引导桥里「说」不会连续出现两次", () => {
    for (const a of ["焦虑不安地搓着手说", "面带忧色", "开口问", "抱着皮球晃了晃"]) {
      expect(speechLead(a)).not.toMatch(/说[，,]\s*说/);
    }
  });
});
