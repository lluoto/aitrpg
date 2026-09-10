import { describe, expect, it } from "bun:test";
import { GameSession } from "../api/game-session";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { MYTHOS_CREATURE_BY_ID } from "../rules/mythos-module";

const config = { apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 512, temperature: 0.7 };

describe("module runtime creature authority", () => {
  it("Barn Mi-Go HP/maxHP/AC stay module-explicit over generic creature defaults", async () => {
    const moduleMiGo = BARN_OF_PREMIER.npcs.find((npc) => npc.runtime?.sourceId === "mi-go")?.runtime;
    const genericMiGo = MYTHOS_CREATURE_BY_ID.get("mi_go");
    if (!moduleMiGo || !genericMiGo) throw new Error("Mi-Go fixture missing");
    expect([moduleMiGo.hp, moduleMiGo.maxHp, moduleMiGo.ac]).toEqual([11, 11, 10]);
    expect([genericMiGo.hp, genericMiGo.maxHp, genericMiGo.ac]).toEqual([12, 12, 14]);

    const session = new GameSession("module-creature-authority", "cosmic-horror", config, undefined, "调查员");
    await session.act("创建角色 investigator 甲");
    await session.act("加载模组 普瑞米尔的谷仓");
    const entity = session.world.getEntity("mi-go");
    expect([entity?.hp, entity?.maxHp, entity?.ac]).toEqual([11, 11, 10]);
    expect(entity?.name).toBe(moduleMiGo.sourceName);
    expect(entity?.faction).toBe(moduleMiGo.faction);
    expect(entity?.attributes).toEqual(moduleMiGo.attributes);
  });
});
