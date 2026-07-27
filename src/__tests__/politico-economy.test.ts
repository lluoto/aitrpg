import { describe, it, expect, beforeAll } from "bun:test";
import { PoliticoEconomyEngine } from "../economy/politic-economy-engine";
import { TradeSystem } from "../economy/trade-system";

describe("PoliticoEconomyEngine", () => {
  let engine: PoliticoEconomyEngine;

  beforeAll(() => {
    engine = new PoliticoEconomyEngine();
  });

  it("should initialize with default state", () => {
    const state = engine.getBriefState();
    expect(state).toHaveProperty("factions");
    expect(state).toHaveProperty("markets");
    expect(state).toHaveProperty("crisisCount");
    expect(Array.isArray(state.factions)).toBe(true);
    expect(Array.isArray(state.markets)).toBe(true);
  });

  it("should seed initial factions", () => {
    const state = engine.getBriefState();
    expect(state.factions.length).toBeGreaterThanOrEqual(4);
    expect(state.factions.some(f => f.name === "奥法议会")).toBe(true);
    expect(state.factions.some(f => f.name === "商会联盟")).toBe(true);
  });

  it("should seed initial markets", () => {
    const state = engine.getBriefState();
    expect(state.markets.length).toBeGreaterThanOrEqual(3);
    expect(state.markets.some(m => m.name === "王都市场")).toBe(true);
  });

  it("should advance round without error", () => {
    const events = engine.advanceRound();
    expect(Array.isArray(events)).toBe(true);
    const state = engine.getBriefState();
    expect(state).toBeDefined();
  });

  it("should return diplomatic context string", () => {
    const ctx = engine.getDiplomaticContext();
    expect(typeof ctx).toBe("string");
    expect(ctx.length).toBeGreaterThan(0);
    expect(ctx).toContain("政治经济局势");
  });

  it("should handle check_economy action", () => {
    const result = engine.handleAction("check_economy", {});
    expect(result).toHaveProperty("narrative");
    expect(typeof result.narrative).toBe("string");
    expect(result.narrative.length).toBeGreaterThan(0);
  });

  it("should handle faction_status action", () => {
    const result = engine.handleAction("faction_status", { target: "arcane_council" });
    expect(result.narrative).toContain("奥法议会");
  });

  it("should handle market list action", () => {
    const result = engine.handleAction("market", {});
    expect(result.narrative).toContain("市场列表");
    expect(result.narrative).toContain("王都市场");
  });

  it("should handle specific market detail", () => {
    const result = engine.handleAction("market", { target: "capital_market" });
    expect(result.narrative).toContain("王都市场");
  });

  it("should read price from market entries", () => {
    const market = engine.trades.getMarket("capital_market")!;
    expect(market.entries["food"]).toBeDefined();
    expect(market.entries["food"].price).toBeGreaterThan(0);
  });

  it("should generate economic events after multiple rounds", () => {
    const allEvents: any[] = [];
    for (let i = 0; i < 5; i++) {
      const events = engine.advanceRound();
      allEvents.push(...events);
    }
    expect(allEvents.length).toBeGreaterThanOrEqual(0);
  });
});

describe("TradeSystem", () => {
  let trade: TradeSystem;

  beforeAll(() => {
    trade = new TradeSystem();
  });

  it("should register default resources", () => {
    expect(trade["resources"].has("food")).toBe(true);
    expect(trade["resources"].has("wood")).toBe(true);
    expect(trade["resources"].has("stone")).toBe(true);
  });

  it("should create and retrieve markets", () => {
    trade.createMarket({ id: "test_market", name: "测试市场", location: "test" });
    const market = trade.getMarket("test_market");
    expect(market).toBeDefined();
    expect(market!.name).toBe("测试市场");
  });

  it("should fail to get non-existent market", () => {
    expect(trade.getMarket("no_such_market")).toBeUndefined();
  });

  it("should set and retrieve prices", () => {
    trade.createMarket({ id: "price_test_market", name: "价格测试市场", location: "test" });
    trade.setPrice("price_test_market", "food", 10);
    const entry = trade.getMarket("price_test_market")!.entries["food"];
    expect(entry).toBeDefined();
    expect(entry.price).toBe(10);
  });

  it("should handle supply adjustments", () => {
    trade.adjustSupply("test_market", "food", 50);
    trade.adjustDemand("test_market", "food", 30);
    const entry = trade.getMarket("test_market")!.entries["food"];
    expect(entry).toBeDefined();
    expect(entry.supply).toBe(50);
    expect(entry.demand).toBe(30);
  });

  it("should advance round with market updates", () => {
    const events = trade.advanceRound();
    expect(Array.isArray(events)).toBe(true);
  });

  it("should read price from market entry", () => {
    const entry = trade.getMarket("test_market")!.entries["food"];
    expect(entry.price).toBeGreaterThan(0);
  });
});
