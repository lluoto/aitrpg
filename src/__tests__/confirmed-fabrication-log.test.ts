// 开发·三方审计补语义——已确证臆造存档的判据。
//
// FABRICATION_REGISTRY 长期读数是 0，但 0 不等于"没有臆造过"——这份
// 存档（confirmed-fabrication-log.ts）钉住三条已经靠人工通读原文才
// 发现、工具当时一条都没抓到的真实臆造，判据对每一条断言"它不再
// 逐字出现在挂靠的模组数据里"。
//
// 三条各自要有能红能绿的变异检验（rule-03），不能只验一条就当机制
// 成立；边界声明（"只挡逐字重现，换个说法就挡不住"）要有测例佐证，
// 不是写在注释里的空口承诺。
//
// bun test src/__tests__/confirmed-fabrication-log.test.ts

import { describe, it, expect } from "bun:test";
import { CONFIRMED_FABRICATION_LOG, findReintroducedFabrications } from "../ingest/confirmed-fabrication-log";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { PREMIERS_BARN_MODULE } from "../rules/mythos-module";
import { MODULE_PREMIERS_BARN } from "../rules/custom-modules/premiers_barn";

const barnText = JSON.stringify(BARN_OF_PREMIER);
const mythosText = JSON.stringify(PREMIERS_BARN_MODULE);
const premiersText = JSON.stringify(MODULE_PREMIERS_BARN);

describe("存档形状", () => {
  it("都有完整字段，fabricatedText 非空", () => {
    expect(CONFIRMED_FABRICATION_LOG).toHaveLength(4);
    for (const e of CONFIRMED_FABRICATION_LOG) {
      expect(e.fabricatedText.length).toBeGreaterThan(0);
      expect(e.discoveredBy.length).toBeGreaterThan(0);
      expect(e.whyToolMissed.length).toBeGreaterThan(0);
      expect(e.fixCommit.length).toBeGreaterThan(0);
    }
  });

  it("id 各不相同，供测试按名索引", () => {
    const ids = CONFIRMED_FABRICATION_LOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("**主判据**：已确证臆造都不再逐字出现在真实模组数据里", () => {
  it("barn-of-premier.ts 里挂靠的条目（True End 台词 / photo_farm.revelation）", () => {
    const hits = findReintroducedFabrications(barnText, "barn-of-premier");
    expect(hits).toEqual([]);
  });

  it("mythos-module.ts 里挂靠的条目（艾德里安 secrets）", () => {
    const hits = findReintroducedFabrications(mythosText, "mythos-module");
    expect(hits).toEqual([]);
  });

  it("premiers_barn.ts 里挂靠的条目（步骤 3 修复的 B2 裁决错误）", () => {
    const hits = findReintroducedFabrications(premiersText, "premiers-barn");
    expect(hits).toEqual([]);
  });
});

describe("变异检验：三条各自单独验证判据能变红（不是只验一条就当机制成立）", () => {
  it("①「但她知道，米—戈欺骗了他们所有人。」原样放回去，判据必须红", () => {
    const mutated = barnText + "但她知道，米—戈欺骗了他们所有人。";
    const hits = findReintroducedFabrications(mutated, "barn-of-premier");
    expect(hits.map((h) => h.id)).toEqual(["true-end-emily-knew"]);
  });

  it("②「意识到被米-戈欺骗」原样放回去，判据必须红", () => {
    const mutated = mythosText + "意识到被米-戈欺骗";
    const hits = findReintroducedFabrications(mutated, "mythos-module");
    expect(hits.map((h) => h.id)).toEqual(["adrian-secrets-aware"]);
  });

  it("③「照片背面写着农场的地址坐标。」原样放回去，判据必须红", () => {
    const mutated = barnText + "照片背面写着农场的地址坐标。";
    const hits = findReintroducedFabrications(mutated, "barn-of-premier");
    expect(hits.map((h) => h.id)).toEqual(["photo-farm-coordinates"]);
  });

  it("三条同时放回同一份文本，判据一次性抓出全部三条（不是抓一条就短路）", () => {
    const mutated = barnText + "但她知道，米—戈欺骗了他们所有人。" + "照片背面写着农场的地址坐标。";
    const hits = findReintroducedFabrications(mutated, "barn-of-premier");
    expect(hits.map((h) => h.id).sort()).toEqual(["photo-farm-coordinates", "true-end-emily-knew"].sort());
  });

  it("④「\"sceneId\":\"艾德里安的农场\"」原样放回去，判据必须红", () => {
    const mutated = premiersText + '"sceneId":"艾德里安的农场"';
    const hits = findReintroducedFabrications(mutated, "premiers-barn");
    expect(hits.map((h) => h.id)).toEqual(["premiers-barn-adrian-at-farm"]);
  });

  it("对照组：真实数据不掺假时不会误报任何一条（否则上面各条红没有意义）", () => {
    expect(findReintroducedFabrications(barnText, "barn-of-premier")).toEqual([]);
    expect(findReintroducedFabrications(mythosText, "mythos-module")).toEqual([]);
    expect(findReintroducedFabrications(premiersText, "premiers-barn")).toEqual([]);
  });
});

describe("**负面确认**：能力边界是真的——换一种说法的同义臆造不会被抓到", () => {
  it("「但她知道，米—戈欺骗了他们所有人」换成意思相同但措辞不同的句子，判据看不见（这是已知边界，不是漏洞）", () => {
    // 与条目①语义完全相同（艾米丽知情、米-戈欺骗了所有人），但一个字都没有
    // 逐字重复原来那句话——这正是文件头「能力边界」段落断言的情形：
    // 字面串护栏只挡原样重现，语义层面的同义改写会绕过去。
    const paraphrased = barnText + "艾米丽其实心知肚明，米-戈的谎言骗过的不止艾德里安一个人。";
    const hits = findReintroducedFabrications(paraphrased, "barn-of-premier");
    expect(hits).toEqual([]);
  });

  it("「意识到被米-戈欺骗」换个说法（「察觉了米-戈的骗局」），判据同样看不见", () => {
    const paraphrased = mythosText + "他其实早就察觉了米-戈的骗局，只是没有说出口。";
    const hits = findReintroducedFabrications(paraphrased, "mythos-module");
    expect(hits).toEqual([]);
  });
});
