// 台词引导桥的拼接
//
// 这里锁的是同一个 bug 反复出现的那条缝：引擎会在台词前加一句叙述引导桥
// （"歪着头想了想，说："），LLM 又常常在台词开头自带一段神态。两边各自都对，
// 叠起来就重复。先是重复成「引导桥 + （括号神态）台词」，把括号切出来转成叙述句之后，
// 又重复成「…搓着手说，说：」—— 因为切出来的动作本身已经带了动词。
//
// bun test src/__tests__/dialogue-lead.test.ts

import { describe, it, expect } from "bun:test";
import { speechLead, askerScore, partnerRemark } from "../play-module";
import { selfIntroduction } from "../llm/generate-llm-expanded";

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

// 实跑原文：「你们好。我是警员警员。请说明来意。」
// 模组里那名警察没有姓名，name 与 role 都是"警员"，模板无条件拼了两遍。
describe("自报家门不重复身份", () => {
  it("只有身份没有姓名时只说一次", () => {
    expect(selfIntroduction("警员", "警员")).toBe("警员");
  });

  it("名字里已经含着身份时不再前置", () => {
    expect(selfIntroduction("警长", "艾伦警长")).toBe("艾伦警长");
  });

  it("身份与姓名是两回事时正常拼接", () => {
    expect(selfIntroduction("警员", "汤姆·艾伦")).toBe("警员汤姆·艾伦");
  });

  it("没有身份就只说名字", () => {
    expect(selfIntroduction(undefined, "菲碧·特里坎")).toBe("菲碧·特里坎");
    expect(selfIntroduction("  ", "菲碧·特里坎")).toBe("菲碧·特里坎");
  });

  it("任何情况下都不会把同一个词连着写两遍", () => {
    for (const [r, n] of [["警员", "警员"], ["警长", "艾伦警长"], ["警员", "汤姆·艾伦"]] as const) {
      expect(selfIntroduction(r, n)).not.toMatch(/(.{2,})\1/);
    }
  });
});

// 谁开口原先是写死 pl1，然后是 askTurn % 2 硬轮流 —— 前者让一个人整局失声，
// 后者让两个人像在排队发言。改成按人打分后，这里锁住三条倾向。
describe("谁开口：按性格与经历", () => {
  const base = { occupation: "记者", personality: "", background: "" };

  it("同职业下外向的比寡言的更可能开口", () => {
    const 外向 = askerScore({ ...base, personality: "健谈，爱管闲事" }, "", 0);
    const 寡言 = askerScore({ ...base, personality: "沉默寡言，不善言辞" }, "", 0);
    expect(外向).toBeGreaterThan(寡言);
  });

  it("话题跟自己的经历沾边时更可能接话", () => {
    const 沾边 = askerScore({ ...base, background: "她在镇上的教堂做了十年礼拜" }, "教堂", 0);
    const 无关 = askerScore({ ...base, background: "她在纽约的码头扛过货" }, "教堂", 0);
    expect(沾边).toBeGreaterThan(无关);
  });

  it("话题为空时不因背景产生差异", () => {
    const a = askerScore({ ...base, background: "教堂" }, "", 0);
    const b = askerScore({ ...base, background: "码头" }, "", 0);
    expect(a).toBe(b);
  });

  it("已经问过几轮的人会被压下去，轮到另一个人", () => {
    const 话多的 = askerScore({ ...base, personality: "健谈" }, "", 3);
    const 一直没开口的 = askerScore({ ...base, personality: "沉默寡言" }, "", 0);
    expect(一直没开口的).toBeGreaterThan(话多的);
  });

  it("惩罚随开口次数单调递减", () => {
    const s = [0, 1, 2, 3].map((n) => askerScore(base, "", n));
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeLessThan(s[i - 1]);
  });
});

// 之前整局日志里两名调查员从头到尾没对彼此说过一个字：
// 所有输出不是对 NPC 提问就是引擎旁白。这类话不推动情节，作用是让现场有两个人。
describe("同伴之间的非叙事性交流", () => {
  it("寡言的人给短句，外向的人给长句", () => {
    const 寡言 = partnerRemark("沉默寡言，不善言辞", "clue");
    const 外向 = partnerRemark("健谈，直率", "clue");
    expect(寡言.length).toBeLessThanOrEqual(8);
    expect(外向.length).toBeGreaterThan(8);
  });

  it("既外向又谨慎时按外向处理，不当成寡言", () => {
    for (let i = 0; i < 20; i++) {
      expect(partnerRemark("谨慎但健谈", "clue").length).toBeGreaterThan(8);
    }
  });

  it("SAN 场合说的是关心，不是讨论线索", () => {
    for (let i = 0; i < 20; i++) {
      expect(partnerRemark("健谈", "san")).not.toMatch(/记下来|收着|对得上/);
    }
  });

  it("avoid 的那句不会被再选中", () => {
    const first = partnerRemark("健谈", "clue");
    for (let i = 0; i < 30; i++) {
      expect(partnerRemark("健谈", "clue", first)).not.toBe(first);
    }
  });

  it("任何组合都不会返回空串", () => {
    for (const p of ["", "健谈", "沉默寡言"]) {
      for (const k of ["clue", "san"] as const) {
        expect(partnerRemark(p, k).length).toBeGreaterThan(0);
      }
    }
  });
});
