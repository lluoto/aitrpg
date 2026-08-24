// 角色卡抬头显示的是职业中文名，不是内部 id。
//
// 起因：跑一局完整对局，角色卡第二行是这个 ——
//
//     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//       亚瑟·彭德尔顿
//       nurse                        ← 玩家看到的是英文 id
//     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
// `character-display.ts` 直接打了 `char.archetypeId`。而职业表里一直带着
// 中文 `label`（`getCoCArchetypes()`），只是没人用。
//
// 这类东西单测不容易想到去测 —— 它不崩、不报错、数值也全对，
// 只是**最显眼的那一行是英文**。是实跑一局看出来的。

import { describe, test, expect } from "bun:test";
import { displayCharacterSheet, characterSummary } from "../pl/character-display";
import { createCoCCharacter, getCoCArchetypes } from "../character/coc-character";

const archetypes = getCoCArchetypes();

/** 造一个角色。createCoCCharacter 是异步的，且要把职业对象一起传进去 */
async function make(archetypeId: string) {
  const arch = archetypes.find((a) => a.id === archetypeId)!;
  return createCoCCharacter({ name: "测试员", archetypeId, method: "dice", age: 30 }, arch);
}

describe("角色卡抬头用中文职业名", () => {
  test("**错误行为的红线**：抬头不得出现英文 archetypeId", async () => {
    expect(archetypes.length).toBeGreaterThan(0); // 空表会让下面的循环假绿
    for (const a of archetypes.slice(0, 6)) {
      const ch = await make(a.id);
      const head = displayCharacterSheet(ch).split("\n").slice(0, 5).join("\n");
      expect(head).toContain(a.label);
      // id 是 ASCII 的内部标识（nurse / accountant …），不该出现在抬头
      expect(head).not.toMatch(new RegExp(`(?<![\\w$])${a.id}(?![\\w$])`));
    }
  });

  test("**干扰输入**：职业表里查不到时退回 id，不留空", async () => {
    // 宁可显示 id，也不能让抬头空着 —— 空行比英文更难查。
    const ch = await make(archetypes[0]!.id);
    const head = displayCharacterSheet({ ...ch, archetypeId: "not_a_real_archetype" })
      .split("\n").slice(0, 5).join("\n");
    expect(head).toContain("not_a_real_archetype");
  });

  test("**干扰输入**：一行摘要的形状与抬头不同，不在这条管辖内", async () => {
    const ch = await make(archetypes[0]!.id);
    expect(characterSummary(ch)).toContain("测试员");
  });
});
