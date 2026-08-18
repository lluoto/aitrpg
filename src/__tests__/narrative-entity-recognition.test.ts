// 叙事实体的识别桥段 —— 状态机 + 两条路径的数据契约
//
// 背景：特里坎家的场景描述（模组原文）本来就写着院子一旁停着一座拖车房，
// 调查员进门就看见了。但那时它只是一座拖车；要等菲碧说出"他十五岁就搬到
// 外面拖车住了"，它才变成"失踪男孩的房间"。看见与认出是两件事。
//
// 所以状态拆成两个单调位（已提起 / 已识别），而"看得见"不存状态：
// 它随调查员走动来回变，存下来必然与实际所在地失同步。这里把这三条锁住。
//
// bun test src/__tests__/narrative-entity-recognition.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { WorldState } from "../world/state";
import { WorldStateManager } from "../state/world-state-manager";
import { populateWorldFromModule } from "../world/module-loader";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";

const TRAILER = "ent_gabi_trailer";
const HOUSE = "tricam_house";
const TRAILER_SCENE = "gabi_trailer";

describe("模组数据：叙事实体声明", () => {
  it("模组声明了拖车房实体，且指向真实存在的场景", () => {
    const ent = BARN_OF_PREMIER.narrative?.entities.find((e) => e.id === TRAILER);
    expect(ent).toBeDefined();
    expect(ent!.recognition.length).toBeGreaterThan(0);
    expect(ent!.mentionKeywords.length).toBeGreaterThan(0);
    expect(BARN_OF_PREMIER.scenes.some((s) => s.id === ent!.sceneId)).toBe(true);
  });

  it("视线挂在特里坎家 —— 与场景描述原文「在一旁可以看到一个拖车车房」一致", () => {
    const house = BARN_OF_PREMIER.scenes.find((s) => s.id === HOUSE)!;
    expect(house.visibleEntities).toContain(TRAILER);
    expect(house.description).toContain("拖车");
  });

  // 实跑撞出来的：调查员是随机车卡，性别不定。
  // 初版识别文案写死了"他的视线"，跑出来是"玛格丽特·哈里斯没有接话。他的视线……"。
  it("识别文案不写死第三人称代词 —— 调查员性别是随机的", () => {
    for (const ent of BARN_OF_PREMIER.narrative?.entities ?? []) {
      expect(ent.recognition).not.toMatch(/[他她]/);
    }
  });

  it("触发词能命中菲碧的知识原文（否则永远不会被提起）", () => {
    const ent = BARN_OF_PREMIER.narrative!.entities.find((e) => e.id === TRAILER)!;
    const phoebe = BARN_OF_PREMIER.npcs.find((n) => n.id === "phoebe_tricam")!;
    const allKnowledge = phoebe.knowledge.join("");
    expect(ent.mentionKeywords.some((k) => allKnowledge.includes(k))).toBe(true);
  });
});

describe("运行路径：识别状态机", () => {
  let w: WorldState;

  beforeEach(() => {
    w = new WorldState(BARN_OF_PREMIER);
  });

  it("起点就在特里坎家，拖车看得见", () => {
    expect(w.currentSceneId).toBe(HOUSE);
    expect(w.getVisibleEntities().map((e) => e.id)).toContain(TRAILER);
  });

  it("没被提起过就不该演 —— 光看得见不构成「认出」", () => {
    expect(w.isEntityIntroduced(TRAILER)).toBe(false);
    expect(w.getPendingRecognition()).toBeUndefined();
  });

  it("被提起 + 看得见 + 没演过 → 待演", () => {
    w.introduceEntity(TRAILER);
    expect(w.getPendingRecognition()?.id).toBe(TRAILER);
  });

  it("可见性是现算的：走开就不待演，走回来又待演", () => {
    w.introduceEntity(TRAILER);
    expect(w.getPendingRecognition()?.id).toBe(TRAILER);

    w.moveToScene(TRAILER_SCENE);
    expect(w.getPendingRecognition()).toBeUndefined();
    // 「被提起」是单调的，不因为走开而撤销
    expect(w.isEntityIntroduced(TRAILER)).toBe(true);

    w.moveToScene(HOUSE);
    expect(w.getPendingRecognition()?.id).toBe(TRAILER);
  });

  it("演过一次就永不再演，来回走动也不复活", () => {
    w.introduceEntity(TRAILER);
    w.markEntityRecognized(TRAILER);
    expect(w.getPendingRecognition()).toBeUndefined();

    w.moveToScene(TRAILER_SCENE);
    w.moveToScene(HOUSE);
    expect(w.getPendingRecognition()).toBeUndefined();
  });

  it("重复提起不出错，也不会让已演过的复活", () => {
    w.introduceEntity(TRAILER);
    w.introduceEntity(TRAILER);
    w.markEntityRecognized(TRAILER);
    w.introduceEntity(TRAILER);
    expect(w.getPendingRecognition()).toBeUndefined();
  });

  it("在看不到拖车的场景里，就算被提起也不待演", () => {
    w.moveToScene(TRAILER_SCENE);
    w.introduceEntity(TRAILER);
    expect(w.isEntityIntroduced(TRAILER)).toBe(true);
    expect(w.getPendingRecognition()).toBeUndefined();
  });
});

describe("读取路径：module-loader 写入的实体信息必须读得回来", () => {
  let world: WorldStateManager;

  beforeEach(() => {
    world = new WorldStateManager(":memory:");
    populateWorldFromModule(world, BARN_OF_PREMIER, {});
  });

  // 这条是核心：exits 的解析器历史上只重建 {target, desc}，
  // 多带的字段会被静默丢掉 —— 写得进去、读不出来，等于没实现。
  it("特里坎家通往拖车房的出口带着识别信息，且能原样读回", () => {
    const house = world.getScene(HOUSE);
    expect(house).not.toBeNull();

    const exit = house!.exits.find((e) => e.target === TRAILER_SCENE);
    expect(exit).toBeDefined();
    expect(exit!.sighted).toBeDefined();
    expect(exit!.sighted!.entityId).toBe(TRAILER);
    expect(exit!.sighted!.recognition.length).toBeGreaterThan(0);
    expect(exit!.sighted!.mentionKeywords).toContain("拖车");
    expect(exit!.sighted!.noticedBy.length).toBeGreaterThan(0);
  });

  it("读回的识别文本与模组声明逐字一致", () => {
    const ent = BARN_OF_PREMIER.narrative!.entities.find((e) => e.id === TRAILER)!;
    const exit = world.getScene(HOUSE)!.exits.find((e) => e.target === TRAILER_SCENE)!;
    expect(exit.sighted!.recognition).toBe(ent.recognition);
  });

  it("没有声明视线的出口不带 sighted，不给消费方假数据", () => {
    const house = world.getScene(HOUSE)!;
    const townExit = house.exits.find((e) => e.target === "town_premier");
    expect(townExit).toBeDefined();
    expect(townExit!.sighted).toBeUndefined();
  });

  it("从拖车房往回走的那条出口不带 sighted（视线是单向声明的）", () => {
    const trailer = world.getScene(TRAILER_SCENE)!;
    expect(trailer.exits.every((e) => e.sighted === undefined)).toBe(true);
  });

  it("setSceneExits 往返一趟不会把 sighted 洗掉", () => {
    const before = world.getScene(HOUSE)!.exits;
    world.setSceneExits(HOUSE, before);
    const after = world.getScene(HOUSE)!.exits;
    expect(after.find((e) => e.target === TRAILER_SCENE)!.sighted!.entityId).toBe(TRAILER);
  });
});
