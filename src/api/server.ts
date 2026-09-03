// AI TRPG HTTP Server — Bun.serve()
// 管理 GameSession 实例，暴露 REST 接口供前端调用 //
// 运行: bun run src/api/server.ts

import { GameSession, type ActionResponse, type SessionSummary } from "./game-session";
import type { RulesetId } from "../rules/rules-engine";
import { loadConfig } from "../config";
import { saveSessionMeta, deleteSessionFile, listStoredSessions } from "./session-store";
import { saveCharacter, listCharacters, type StoredCharacter } from "./character-store";
import type { MessageType } from "../agent/types";
import { createWsClient, removeWsClient, broadcastToSession, broadcastPerConnection, listSessionPlayerIds, wsStats, isWsRole, type WsRole, type WsConnectionData } from "./ws-handler";
import { listSavedModules, loadModuleFile, saveModuleFile, deleteModuleFile, parseMythosModule } from "./module-editor";
import { CharacterFactory } from "../character/character-factory";
import { createScriptedSession, getScriptedSession } from "./scripted-session";
import { worldModelStatus } from "./world-model-status";
import { log } from "../log";

// ============================================================
// 会话存储
// ============================================================

const sessions = new Map<string, GameSession>();
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟无操作自动清理
function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function cleanupStaleSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TIMEOUT_MS && session.round === 0) {
      sessions.delete(id);
    }
  }
}

// 每 5 分钟清理
setInterval(cleanupStaleSessions, 5 * 60 * 1000);

// ============================================================
// CORS 头 // ============================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsHeaders(): Record<string, string> {
  return { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" };
}

// ============================================================
// 路由处理
// ============================================================

function parseUrl(pathname: string): { segments: string[]; query: URLSearchParams } {
  const [path, qs] = pathname.split("?");
  return {
    segments: path.split("/").filter(Boolean),
    query: new URLSearchParams(qs ?? ""),
  };
}

// ── Session Cleanup ──────────────────────────────────────
// 每 5 分钟清理一次超过 30 分钟未活跃的 session
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of sessions) {
    if (now - session.lastActiveAt > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
      deleteSessionFile(id);
      cleaned++;
    }
  }
  if (cleaned > 0) log.info("cleanup", `清理了 ${cleaned} 个过期会话`);
}, CLEANUP_INTERVAL_MS);

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { segments, query } = parseUrl(url.pathname + url.search);
  const method = req.method;

  // OPTIONS → CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // GET / → 前端构建产物；没有构建产物时回落到内置测试页
  if (method === "GET" && segments.length === 0) {
    const index = await serveStatic("/index.html");
    return index ?? serveTestPage();
  }

  // GET /api → 健康检查
  if (method === "GET" && segments[0] === "api" && segments.length === 1) {
    return respondJson({
      status: "ok",
      activeSessions: sessions.size,
      version: "0.1.0",
      endpoints: [
        "POST /api/sessions — 创建游戏会话",
        "GET /api/sessions — 列出会话",
        "GET /api/sessions/:id — 会话摘要",
        "POST /api/sessions/:id/action — 执行玩家行动",
        "GET /api/sessions/:id/history — 对话历史",
        "GET /api/sessions/:id/state — 世界状态",
      ],
    });
  }

  //   }

  // GET /api/config — 服务器配置
  if (method === "GET" && segments[0] === "api" && segments[1] === "config" && segments.length === 2) {
    const config = loadConfig();
    return respondJson({
      llm: { baseUrl: config.baseUrl, model: config.model, maxTokens: config.maxTokens, temperature: config.temperature, hasKey: !!config.apiKey && !config.apiKey.startsWith("sk-placeholder") },
      server: { port: parseInt(process.env.PORT || "3099"), env: process.env.NODE_ENV || "development", sessionTimeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES || "30") },
      sessionCount: sessions.size,
      // 世界模型是否已加载的机器可判定出口——不触发加载，只读既有状态。
      // 见 world-model-status.ts 头注释：默认路径找不到时此前只静默降级，
      // 一条 warn 滚过日志没人看见，整局叙述质量相关的观察全部作废。
      ...worldModelStatus(),
    });
  }

  // GET /api/archetypesGET /api/archetypes — 可用职业模板
  if (method === "GET" && segments[0] === "api" && segments[1] === "archetypes" && segments.length === 2) {
    const rulesetFilter = query.get("ruleset") || undefined;
    return respondJson({
      archetypes: CharacterFactory.listArchetypes(rulesetFilter),
    });
  }

  // ── 角色卡持久化 ──

  // GET /api/characters — 列出已保存的角色卡
  if (method === "GET" && segments[0] === "api" && segments[1] === "characters" && segments.length === 2) {
    return respondJson({ characters: listCharacters() });
  }

  // POST /api/characters — 保存角色卡
  if (method === "POST" && segments[0] === "api" && segments[1] === "characters" && segments.length === 2) {
    const body = await readJsonBody(req);
    const character = parseStoredCharacter(body);
    if (!character) return respondError("角色名不能为空", 400);
    // 展开原始 body 保留未建模字段，再用解析结果覆盖必需字段。
    saveCharacter(character.name, { ...body, ...character });
    return respondJson({ success: true });
  }

  // ── 模组编辑器 ──

  // GET /api/modules — 列出所有模块
  if (method === "GET" && segments[0] === "api" && segments[1] === "modules" && segments.length === 2) {
    return respondJson({ modules: listSavedModules() });
  }

  // GET /api/modules/:id — 获取单个模组
  if (method === "GET" && segments[0] === "api" && segments[1] === "modules" && segments.length === 3) {
    const mod = loadModuleFile(segments[2]);
    if (!mod) return respondError("模组不存在", 404);
    return respondJson({ module: mod });
  }

  // POST /api/modules — 新建或保存模块
  if (method === "POST" && segments[0] === "api" && segments[1] === "modules" && segments.length === 2) {
    const body = await readJsonBody(req);
    const parsed = parseMythosModule(body);
    if (!parsed.ok) return respondError(parsed.error, 400);
    saveModuleFile(parsed.module);
    return respondJson({ success: true });
  }

  // PUT /api/modules/:id — 更新模组
  if (method === "PUT" && segments[0] === "api" && segments[1] === "modules" && segments.length === 3) {
    const body = await readJsonBody(req);
    const existing = loadModuleFile(segments[2]);
    if (!existing) return respondError("模组不存在", 404);
    // 合并后再解析：局部更新也不能把文档改成非法形状。
    const parsed = parseMythosModule({ ...existing, ...body, id: segments[2] });
    if (!parsed.ok) return respondError(parsed.error, 400);
    saveModuleFile(parsed.module);
    return respondJson({ success: true });
  }

  // DELETE /api/modules/:id — 删除模组
  if (method === "DELETE" && segments[0] === "api" && segments[1] === "modules" && segments.length === 3) {
    deleteModuleFile(segments[2]);
    return respondJson({ success: true });
  }

  // ── 会话管理 ──

  // POST /api/sessions — 创建新会话
  if (method === "POST" && segments[0] === "api" && segments[1] === "sessions" && segments.length === 2) {
    let ruleset: RulesetId = "cosmic-horror";
    let archetypeId: string | undefined;
    let characterName: string | undefined;
    // 这里原本包着 `try { … } catch {}`，但 `readJsonBody` 自己就
    // `.catch(() => null)` 了、非法 JSON 退化成空对象，`bodyString` 是纯函数 ——
    // **那个 catch 永远不可能触发**。留着它更糟：它让下一个读代码的人以为
    // 这段有已知的失败路径、吞掉是正常的。没有失败路径就别装有。
    const body = await readJsonBody(req);
    const requestedRuleset = bodyString(body, "ruleset");
    if (requestedRuleset === "dnd5e" || requestedRuleset === "grail") ruleset = requestedRuleset;
    archetypeId = bodyString(body, "archetype") ?? archetypeId;
    characterName = bodyString(body, "characterName") ?? characterName;
    // p1 的扮演元数据（personality/backstory/currentGoal）——HTTP 字段为兜底链最
    // 优先一层，其余层（模组/推导/LLM）在 GameSession 构造里补。
    const persona = {
      personality: bodyString(body, "personality"),
      backstory: bodyString(body, "backstory"),
      currentGoal: bodyString(body, "currentGoal"),
    };
    const id = generateId();
    const session = new GameSession(id, ruleset, undefined, archetypeId, characterName, persona);

    // 生成开场描述
    let opening = "";
    try {
      opening = await session.getOpeningScene();
    } catch (err: any) {
      opening = `[LLM 不可用] ${err.message}`;
    }

    sessions.set(id, session);

    // 持久化（扩展元数据）
    const summary = session.getSummary();
    const kpState = session.getKPState();
    saveSessionMeta(id, {
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      ruleset: session.activeRuleset,
      playerName: characterName ?? "调查员",
      scene: summary.scene,
      round: summary.round,
      characters: kpState.characters?.map((ch: any) => ({
        name: ch.name, hp: ch.hp, maxHp: ch.maxHp,
        san: ch.san, maxSan: ch.maxSan,
        archetype: ch.archetype,
      })),
    });

    const character = session.getCharacterSummary();
    broadcastToSession(id, "session-created", {
      sessionId: id,
      ruleset,
      characterName: characterName ?? "调查员",
    });
    return respondJson({
      sessionId: id,
      ruleset,
      archetype: archetypeId ?? null,
      characterName: characterName ?? "调查员",
      character,
      opening,
      summary: session.getSummary(),
    }, 201);
  }

  // GET /api/sessions — 列表
  if (method === "GET" && segments[0] === "api" && segments[1] === "sessions" && segments.length === 2) {
    const list: SessionSummary[] = [];
    for (const s of sessions.values()) {
      list.push(s.getSummary());
    }
    // 合并已持久化但未在内存中的 session
    const storedMeta = listStoredSessions();
    for (const sm of storedMeta) {
      if (!list.find(l => l.id === sm.id)) {
        list.push({
          id: sm.id, round: 0, ruleset: sm.ruleset,
          scene: sm.scene, playerName: sm.playerName,
          archetype: null, messageCount: 0,
          npcCount: 0, createdAt: sm.createdAt,
        });
      }
    }
    return respondJson({ sessions: list });
  }

  // 需要 :id 的路由
  if (segments.length >= 3 && segments[0] === "api" && segments[1] === "sessions") {
    const sessionId = segments[2];
    const session = sessions.get(sessionId);

    if (!session) {
      return respondError("会话不存在或已过期", 404);
    }
    session.lastActiveAt = Date.now();

    // GET /api/sessions/:id
    if (method === "GET" && segments.length === 3) {
      return respondJson({
        summary: session.getSummary(),
        state: session.getState(),
        sanity: session.getSanity(),
        history: session.getHistory().messages.slice(-10),
      });
    }

    // GET /api/sessions/:id/history
    // ?pcId= 按指定 PC 读取——每个 PC 只看得到发给自己的消息（含
    // discoverer_only 的线索揭示，只有发现者自己看得到）。不传 pcId 时
    // 行为不变（取当前活动玩家的历史，兼容既有客户端）。
    if (method === "GET" && segments[3] === "history") {
      const limit = parseInt(query.get("limit") || "50");
      const pcId = query.get("pcId");
      if (pcId) {
        // 未知 pcId 要明确报错，不能悄悄返回空数组——那和"这个人确实没有
        // 历史"从外部长得一模一样，是本仓反复吃亏的"静默失效"。
        if (!session.session.get(pcId)) return respondError(`未知 pcId: ${pcId}`, 404);
        const history = session.getPlayerHistory(pcId);
        return respondJson({
          messages: history.messages.slice(-limit),
          total: history.total,
        });
      }
      const history = session.getHistory();
      return respondJson({
        messages: history.messages.slice(-limit),
        total: history.total,
      });
    }

    // GET /api/sessions/:id/state
    if (method === "GET" && segments[3] === "state") {
      return respondJson({
        state: session.getState(),
        sanity: session.getSanity(),
        summary: session.getSummary(),
      });
    }

    // GET /api/sessions/:id/suggestions — 当前可选行动
    if (method === "GET" && segments[3] === "suggestions") {
      const result = runSuggestions(session, query.get("pcId"));
      return respondJson(result.body, result.status);
    }

    // GET /api/sessions/:id/character — 角色属性
    if (method === "GET" && segments[3] === "character") {
      return respondJson({
        character: session.getCharacterSummary(),
        sanity: session.getSanity(),
      });
    }

    // ── KP 面板路由 ──

    // GET /api/sessions/:id/kp — KP 完整状态
    if (method === "GET" && segments[3] === "kp" && segments.length === 4) {
      return respondJson({ kp: session.getKPState() });
    }

    // POST /api/sessions/:id/kp/:action — KP 操作
    if (method === "POST" && segments[3] === "kp" && segments.length === 5) {
      const kpAction = segments[4];
      const body = await readJsonBody(req);

      try {
        switch (kpAction) {
          case "send-message": {
            const msg = (bodyString(body, "message") ?? "").trim();
            if (!msg) return respondError("消息不能为空", 400);
            const speaker = bodyString(body, "speaker") || "守秘人";
            const messageType = bodyString(body, "type");
            session.sendMessage(speaker, msg, isMessageType(messageType) ? messageType : "system");
            return respondJson({ success: true });
          }
          case "set-san": {
            const pid = bodyString(body, "playerId") || session.activePlayerId;
            const value = bodyNumber(body, "value");
            if (value === undefined) return respondError("SAN 值无效", 400);
            const result = session.setPlayerSan(pid, value);
            if (!result.ok) return respondError(`SAN 设置被拒绝: ${result.error.code}`, 400);
            return respondJson({ success: true, delta: result.value });
          }
          case "set-hp": {
            const pid = bodyString(body, "playerId") || session.activePlayerId;
            const value = bodyNumber(body, "value");
            if (value === undefined) return respondError("HP 值无效", 400);
            const result = session.setPlayerHp(pid, value);
            if (!result.ok) return respondError(`HP 设置被拒绝: ${result.error.code}`, 400);
            return respondJson({ success: true, delta: result.value });
          }
          case "apply-damage": {
            const target = (bodyString(body, "target") ?? "").trim();
            const dmg = bodyNumber(body, "damage");
            if (!target || dmg === undefined) return respondError("目标或伤害值无效", 400);
            const result = session.applyDamage(target, dmg);
            if (!result.ok) return respondError(`伤害应用被拒绝: ${result.error.code}`, 400);
            return respondJson({ success: true, delta: result.value });
          }
          case "set-scene": {
            const sceneId = (bodyString(body, "sceneId") ?? "").trim();
            if (!sceneId) return respondError("场景 ID 无效", 400);
            if (!session.setScene(sceneId)) {
              return respondError(`场景不存在: ${sceneId}`, 404);
            }
            return respondJson({ success: true });
          }
          case "set-difficulty": {
            const diff = (bodyString(body, "difficulty") ?? "").trim();
            if (!isDifficulty(diff)) {
              return respondError("难度需要 easy/medium/hard/nightmare", 400);
            }
            const result = session.setDifficulty(diff);
            if (!result.ok) return respondError(`难度设置被拒绝: ${result.error.code}`, 400);
            return respondJson({ success: true, delta: result.value });
          }
          default:
            return respondError(`未知 KP 操作: ${kpAction}`, 400);
        }
      } catch (err: any) {
        return respondError(`KP 操作失败: ${err.message}`, 500);
      }
    }

    // POST /api/sessions/:id/character — 更新角色属性
    if (method === "POST" && segments[3] === "character") {
      const body = await readJsonBody(req);
      try {
        const ch = session.activeCharacter;
        if (!ch) throw new Error("无活跃角色");
        const hp = bodyNumber(body, "hp");
        if (hp !== undefined) ch.hp = Math.max(0, Math.min(hp, ch.maxHp ?? 99));
        const maxHp = bodyNumber(body, "maxHp");
        if (maxHp !== undefined) ch.maxHp = maxHp;
        const skills = bodyRecord(body, "skills");
        if (skills) Object.assign(ch.skillValues ?? (ch.skillValues = {}), skills);
        const inventory = bodyStringArray(body, "inventory");
        if (inventory) session.setPlayerInventory(session.activePlayerId, inventory);
        const weapons = bodyStringArray(body, "weapons");
        if (weapons) session.setPlayerWeapons(session.activePlayerId, weapons);
        const luck = bodyNumber(body, "luck");
        if (luck !== undefined) ch.luck = luck;
        const creditRating = bodyNumber(body, "creditRating");
        if (creditRating !== undefined) ch.creditRating = creditRating;
        const attributes = bodyRecord(body, "attributes");
        if (attributes) Object.assign(ch.attributes ?? (ch.attributes = {}), attributes);
        // 同步世界实体——用 activePlayerId，不要写死 "player"：
        // 世界实体的真实 id 是 GameSession.activePlayerId（单人局默认
        // "p1"），写死 "player" 会同步到一个没人读的幽灵实体上。
        const ent = session.world.getEntity(session.activePlayerId);
        if (ent) { ent.hp = ch.hp; session.world.upsertEntity(ent); }
        return respondJson({ success: true, character: ch });
      } catch (err: any) {
        return respondError(`更新角色失败: ${err.message}`, 400);
      }
    }

    // POST /api/sessions/:id/action — 核心：玩家输入
    if (method === "POST" && segments[3] === "action") {
      const body = await readJsonBody(req);
      // 广播前先拍一次"现在连着的每个玩家历史有多长"——act() 会把这
      // 回合的消息按可见性 push 进各自的 messageHistory，之后用这份
      // 快照切出"这一回合新增了什么"（见 broadcastActionResult）。
      // 必须在 runAction 之前拍，等它跑完历史已经变长，就切不出新增段了。
      const priorCounts = new Map<string, number>();
      for (const pid of listSessionPlayerIds(sessionId)) {
        if (session.session.get(pid)) priorCounts.set(pid, session.getPlayerHistory(pid).total);
      }
      const result = await runAction(session, body);
      if (result.status !== 200) return respondJson(result.body, result.status);
      const ar = result.body as unknown as ActionResponse;
      saveSessionMeta(sessionId, {
        lastActiveAt: Date.now(),
        round: ar.state?.round,
        scene: ar.state?.scene,
      });
      broadcastActionResult(sessionId, session, priorCounts, ar);
      return respondJson({
        ...ar,
        summary: session.getSummary(),
      });
    }

    // POST /api/sessions/:id/party — 为队伍新增一个 PC
    // 单一入口 addPartyMember（其内部必须走到 createPartyMember，见 game-session
    // 注释）；body 里的 personality/backstory/currentGoal 走兜底链解析后挂到
    // PartyMember.meta（HTTP 字段最优先）。
    if (method === "POST" && segments[3] === "party") {
      const body = await readJsonBody(req);
      const name = (bodyString(body, "name") ?? "").trim();
      const archetype = (bodyString(body, "archetype") ?? "").trim();
      if (!name || !archetype) return respondError("name 和 archetype 不能为空", 400);
      const meta = {
        personality: bodyString(body, "personality"),
        backstory: bodyString(body, "backstory"),
        currentGoal: bodyString(body, "currentGoal"),
      };
      try {
        // buildCharacterForRuleset（addPartyMember 内部）对未知 archetype 会抛——
        // 与 POST /character、/luck-spend 同样有会抛的下游调用，同样包一层，
        // 不让它变成 Bun.serve 兜底的裸 500。
        const result = session.addPartyMember(name, archetype, meta);
        if ("rejected" in result) return respondError(result.rejected, 400);
        const m = result.member;
        saveSessionMeta(sessionId, { lastActiveAt: Date.now() });
        return respondJson({
          pcId: m.pcId,
          name,
          archetype,
          meta: m.meta ?? {},
          control: m.control,
          ...(result.warning ? { warning: result.warning } : {}),
        }, 201);
      } catch (err: any) {
        return respondError(`创建队友失败: ${err.message}`, 400);
      }
    }

    // POST /api/sessions/:id/npc-chat — NPC 对话
    if (method === "POST" && segments[3] === "npc-chat") {
      const body = await readJsonBody(req);
      const npcName = (bodyString(body, "npc") ?? "").trim();
      const playerMsg = (bodyString(body, "message") ?? "").trim();
      if (!npcName || !playerMsg) return respondError("NPC 名称和消息不能为空", 400);
      try {
        // 从 registry 找 NPC agent
        const npcAgent = session.registry.findAgentByName(npcName);
        if (!npcAgent) return respondError(`未找到 NPC: ${npcName}`, 404);
        const history = session.getHistory(10);
        const reply = await npcAgent.respond(playerMsg, history.messages);
        // 记录到 session 历史；情绪在此刻固定，供未来语音层选择音色
        session.addMessage(npcName, reply, "dialogue", { mood: npcAgent.getMood() });
        return respondJson({ npc: npcName, reply });
      } catch (err: any) {
        return respondError(`NPC 对话失败: ${err.message}`, 500);
      }
    }

    // POST /api/sessions/:id/luck-spend — 幸运消耗
    if (method === "POST" && segments[3] === "luck-spend") {
      const body = await readJsonBody(req);
      const amount = bodyNumber(body, "amount") ?? 0;
      const ch = session.activeCharacter;
      if (!ch) return respondError("无活跃角色", 400);
      if (amount <= 0 || amount > (ch.luck ?? 0)) return respondError("幸运不足", 400);
      ch.luck = (ch.luck ?? 0) - amount;
      return respondJson({ success: true, luck: ch.luck });
    }

    // GET /api/sessions/:id/export/:format — 战报导出
    if (method === "GET" && segments[3] === "export" && segments.length === 5) {
      const format = segments[4];
      const history = session.getHistory();
      const summary = session.getSummary();

      if (format === "json") {
        return respondJson({
          session: summary,
          exportedAt: new Date().toISOString(),
          messageCount: history.total,
          messages: history.messages,
        });
      }

      if (format === "markdown") {
        const lines: string[] = [
          `# AI TRPG 游戏记录`,
          ``,
          `**会话ID:** ${summary.id}`,
          `**规则:** ${summary.ruleset}`,
          `**角色:** ${summary.playerName}`,
          `**场景:** ${summary.scene}`,
          `**回合:** ${summary.round}`,
          `**导出时间:** ${new Date().toLocaleString("zh-CN")}`,
          ``,
          `---`,
          ``,
        ];
        for (const msg of history.messages) {
          const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("zh-CN") : "";
          const speaker = msg.speaker ?? "系统";
          const tag = msg.type === "narration" ? "*旁白*" : msg.type === "action" ? `**${speaker}**` : `_${speaker}_`;
          lines.push(`${ts ? `\`${ts}\` ` : ""}${tag}: ${msg.content}`);
          lines.push("");
        }
        return new Response(lines.join("\n"), {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      }

      return respondError("不支持的导出格式，支持 json, markdown", 400);
    }

  }

  // ── 剧本杀会话 ──
  // 与自由跑团（/api/sessions）并列的一套路由，不共享任何状态：
  // 那边是 KP 即兴生成，这边是线索门禁 + 多结局，两套规则混在一起只会互相污染。
  if (segments[0] === "api" && segments[1] === "scripted") {
    // POST /api/scripted — 开一局
    if (method === "POST" && segments.length === 2) {
      const s = createScriptedSession();
      return respondJson({ id: s.id });
    }

    const scripted = segments[2] ? getScriptedSession(segments[2]) : undefined;
    if (!scripted) return respondError("剧本会话不存在", 404);

    // GET /api/scripted/:id — 拉增量播报与当前岔口
    if (method === "GET" && segments.length === 3) {
      const snap = scripted.poll();
      return respondJson(scripted.error ? { ...snap, error: scripted.error } : snap);
    }

    // POST /api/scripted/:id/decide — 提交选择
    if (method === "POST" && segments[3] === "decide") {
      const body = await readJsonBody(req);
      const option = (bodyString(body, "option") ?? "").trim();
      if (!option) return respondError("option 不能为空", 400);
      const r = scripted.submit(option);
      if (!r.ok) return respondError(r.error, 400);
      return respondJson({ ok: true });
    }

    return respondError("未找到路由", 404);
  }

  // API 都没匹配上，再看是不是前端资源。
  // 放在最后：API 路由优先，静态文件不会遮住接口。
  if (method === "GET" && segments[0] !== "api") {
    const asset = await serveStatic(url.pathname);
    if (asset) return asset;
    // 带扩展名的路径没命中就是真的没有，不要回 index.html —— 否则前端拿到的是
    // 一份 HTML 却按 js/mp3 去解析，报出来的错和真实原因毫无关系。
    // 这一点在预制语音那边已经踩过：vite dev 对缺失的 .mp3 回 200 + HTML。
    if (!/\.[a-zA-Z0-9]+$/.test(url.pathname)) {
      const index = await serveStatic("/index.html");
      if (index) return index;
    }
  }

  return respondError("未找到路由", 404);
}

// ============================================================
// 前端静态资源
// ============================================================

const FRONTEND_DIR = process.env.FRONTEND_DIR
  ?? new URL("../../frontend/dist", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

/**
 * 从构建产物目录取文件。没有就返回 null，由调用方决定怎么办。
 *
 * 缓存分两档：带内容哈希的文件名（vite 产出的 index-XXXX.js）可以长期 immutable，
 * 因为改了内容文件名就变；index.html 必须 no-cache，否则用户会一直拿到旧的
 * 那份、里面引用着已经不存在的旧资源名。
 */
async function serveStatic(pathname: string): Promise<Response | null> {
  // 目录穿越防护：解码后不允许出现 ..，否则可以读到构建目录之外
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes("..") || decoded.includes("\0")) return null;

  const file = Bun.file(`${FRONTEND_DIR}${decoded}`);
  if (!(await file.exists())) return null;

  const ext = decoded.slice(decoded.lastIndexOf("."));
  const hashed = /-[A-Za-z0-9_]{8,}\.[a-z0-9]+$/.test(decoded);
  return new Response(file, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": hashed
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
}

// ============================================================
// 请求体解析 — 边界处一次性把 unknown 收成可安全读取的形状
// ============================================================

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DIFFICULTIES = ["easy", "medium", "hard", "nightmare"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

function isDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value);
}

const MESSAGE_TYPES = ["dialogue", "narration", "system", "action"] as const;

function isMessageType(value: string | undefined): value is MessageType {
  return value !== undefined && (MESSAGE_TYPES as readonly string[]).includes(value);
}

/** 请求体一律经此读取：非法 JSON、数组、null 全部退化为空对象，与原有 .catch(() => ({})) 行为一致。 */
async function readJsonBody(req: Request): Promise<JsonRecord> {
  const raw = await req.json().catch(() => null);
  return isJsonRecord(raw) ? raw : {};
}

function bodyString(body: JsonRecord, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

/** 数字字段兼容字符串写法（前端表单常传字符串），与原先的 parseInt 行为保持一致。 */
function bodyNumber(body: JsonRecord, key: string): number | undefined {
  const value = body[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function bodyRecord(body: JsonRecord, key: string): JsonRecord | undefined {
  const value = body[key];
  return isJsonRecord(value) ? value : undefined;
}

function bodyStringArray(body: JsonRecord, key: string): string[] | undefined {
  const value = body[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item): item is string => typeof item === "string") ? value : undefined;
}

/**
 * 角色卡是持久化数据，在边界补齐 StoredCharacter 要求的字段。
 * 返回值只覆盖必需字段；调用方仍会把原始 body 一并展开写入，
 * 以免静默丢掉前端存过、这里尚未建模的额外字段。
 */
function parseStoredCharacter(body: JsonRecord): StoredCharacter | null {
  const name = bodyString(body, "name");
  if (!name) return null;

  const rawSkills = bodyRecord(body, "skills") ?? {};
  const skills: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawSkills)) {
    if (typeof value === "number" && Number.isFinite(value)) skills[key] = value;
  }

  return {
    name,
    ruleset: bodyString(body, "ruleset") ?? "cosmic-horror",
    archetype: bodyString(body, "archetype") ?? "",
    archetypeLabel: bodyString(body, "archetypeLabel"),
    hp: bodyNumber(body, "hp") ?? 0,
    maxHp: bodyNumber(body, "maxHp") ?? 0,
    san: bodyNumber(body, "san") ?? 0,
    maxSan: bodyNumber(body, "maxSan") ?? 0,
    skills,
    inventory: bodyStringArray(body, "inventory") ?? [],
    createdAt: bodyNumber(body, "createdAt") ?? Date.now(),
  };
}

// ============================================================
// 响应辅助
// ============================================================

function respondJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: corsHeaders(),
  });
}

function respondError(message: string, status = 400): Response {
  return respondJson({ error: message }, status);
}

/**
 * 执行一次 action 的**核心**（body 解析 + 可选 pcId 路由 + 结构化拒绝），
 * 抽取成纯逻辑而不是让 HTTP 端点内联：这样 POST /api/sessions/:id/action
 * 的"pcId 是否真的被转发给 act()"是可单测的（改回 `session.act(input)`
 * 不传第二参，本函数的测试就会变红），而端点本身只负责它自己的职责——
 * 持久化元数据、广播、附 summary。
 *
 * pcId「以哪个 PC 身份行动」是可选字段：缺省（未传）时沿用
 * activePlayerId，与 kp/set-san 的 `bodyString(...,"playerId") ||
 * session.activePlayerId` 同一约定，保持既有客户端不破。未知 pcId 由
 * act() 内部在改动任何状态**前**结构化校验并置 result.error（activePlayerId
 * 因此不会"先切过去再发现切不了"），这里把它翻成结构化 4xx——不能折成 200
 * 里一条系统消息，那又是"报告了一件没发生的事"。
 */
export async function runAction(
  session: GameSession,
  body: JsonRecord,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const input = (bodyString(body, "input") ?? "").trim();
  if (!input) return { status: 400, body: { error: "请输入行动" } };
  const actingPcId = (bodyString(body, "pcId") ?? "").trim() || undefined;
  let result: ActionResponse;
  try {
    result = await session.act(input, actingPcId);
  } catch (err: any) {
    return { status: 500, body: { error: `判定失败: ${err.message}` } };
  }
  if (result.error) {
    return { status: 404, body: { code: result.error.code, targetId: result.error.targetId } };
  }
  return { status: 200, body: { ...result, summary: session.getSummary() } };
}

/**
 * 广播一次 action 的结果——按连接分别算该发什么，不是发一份 msg 给
 * session 里所有连接（那正是 todo-25 的漏洞：存储层按玩家过滤，
 * 推送层原先不过滤）。
 *
 * KP/observer 连接：与改动前行为一致，收完整的 ar（KP 本来就该知道
 * 一切，`PlayerSession.push` 的注释里写的是同一条纪律——KP 记录全局
 * 日志）。
 *
 * player 连接：只发"这一回合里，这个 pcId 的 messageHistory 新增了
 * 什么"——直接读 `session.getPlayerHistory(pcId)`，这正是 GET
 * /history?pcId= 已经在用、且被 clue-visibility-and-per-player-history
 * .test.ts 验证过的同一条存储层过滤路径，不重新判定一次可见性。
 * `priorCounts` 是调用方在 `session.act()` 之前拍的快照（此后这个
 * pcId 的历史只会变长，slice 那一段就是这一回合新增的）；没有新增
 * 内容（比如这回合的可见结果只发给了另一个 pcId）时返回 undefined，
 * 这个连接本轮完全不收到东西，不是收一个空 narrative。
 *
 * playerId 未知/连接没声明 playerId：fail-closed，不发——不能因为
 * "不知道该给他看哪部分"就干脆给他看全部。
 */
export function broadcastActionResult(
  sessionId: string,
  session: GameSession,
  priorCounts: Map<string, number>,
  ar: ActionResponse,
): void {
  broadcastPerConnection(sessionId, "action-result", (client) => {
    if (client.role === "kp" || client.role === "observer") {
      return { narrative: ar.narrative, events: ar.events, state: ar.state, dead: ar.dead, sanity: ar.sanity, dice: ar.dice };
    }
    // role === "player"
    if (!client.playerId || !session.session.get(client.playerId)) return undefined;
    const before = priorCounts.get(client.playerId) ?? 0;
    const fresh = session.getPlayerHistory(client.playerId).messages.slice(before);
    if (fresh.length === 0) return undefined;
    return {
      narrative: fresh.map((m: any) => m.content as string).join("\n"),
      events: fresh.map((m: any) => ({
        speaker: m.speaker as string,
        content: m.content as string,
        type: m.type as MessageType,
        ...(m.verbatim ? { verbatim: true as const } : {}),
      })),
      state: ar.state, dead: ar.dead, sanity: ar.sanity, dice: ar.dice,
    };
  });
}

/**
 * GET /suggestions 的核心（可直接单测，无需真的绑 HTTP 端口）。
 *
 * `pcId` 可选：不传保持旧行为，getSuggestions() 读取 activePlayerId；传了则
 * 只为读取该 PC 私密的未发现线索状态，不切换会话活跃 PC。未知值不能静默
 * 回空 suggestions——那和“这个 PC 在空场景里确实没有建议”对外完全一样，
 * 与 /history?pcId= 同口径明确 404。
 */
export function runSuggestions(
  session: GameSession,
  rawPcId: string | null,
): { status: number; body: Record<string, unknown> } {
  const pcId = rawPcId?.trim() || undefined;
  if (pcId && !session.session.get(pcId)) {
    return { status: 404, body: { error: `未知 pcId: ${pcId}` } };
  }
  return { status: 200, body: { suggestions: session.getSuggestions(pcId) } };
}

// ============================================================
// 测试页 // ============================================================

function serveTestPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI TRPG — 测试客户端</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; min-height: 100vh; display: flex; flex-direction: column; }
  #app { max-width: 800px; margin: 0 auto; width: 100%; padding: 16px; flex: 1; display: flex; flex-direction: column; }
  h1 { font-size: 20px; color: #b8b8d0; text-align: center; padding: 16px 0; border-bottom: 1px solid #2a2a4a; margin-bottom: 16px; }
  #narrative { flex: 1; background: #16213e; border-radius: 8px; padding: 16px; overflow-y: auto; min-height: 300px; line-height: 1.7; white-space: pre-wrap; font-size: 15px; margin-bottom: 12px; border: 1px solid #2a2a4a; }
  #narrative .msg-narration { color: #c8d6e5; margin-bottom: 8px; }
  #narrative .msg-dialogue { color: #7bed9f; margin-bottom: 4px; }
  #narrative .msg-system { color: #ff6b6b; font-size: 13px; margin-bottom: 4px; }
  #narrative .msg-action { color: #ffd93d; margin-bottom: 4px; }
  #narrative .speaker { font-weight: 600; }
  #narrative .timestamp { color: #576574; font-size: 11px; margin-left: 8px; }
  #status-bar { display: flex; gap: 16px; padding: 8px 12px; background: #0f3460; border-radius: 8px; font-size: 13px; margin-bottom: 12px; flex-wrap: wrap; }
  #status-bar .stat { display: flex; align-items: center; gap: 4px; }
  #status-bar .label { color: #8899aa; }
  #status-bar .value { color: #e0e0e0; font-weight: 600; }
  #status-bar .danger { color: #ff6b6b; }
  #input-area { display: flex; gap: 8px; }
  #input { flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #2a2a4a; background: #16213e; color: #e0e0e0; font-size: 15px; outline: none; }
  #input:focus { border-color: #4a6fa5; }
  #send { padding: 10px 24px; border-radius: 8px; border: none; background: #4a6fa5; color: #fff; font-size: 15px; cursor: pointer; }
  #send:hover { background: #5a7fb5; }
  #send:disabled { opacity: 0.5; cursor: not-allowed; }
  #new-game { padding: 8px 16px; border-radius: 8px; border: 1px solid #2a2a4a; background: transparent; color: #8899aa; font-size: 13px; cursor: pointer; }
  #new-game:hover { background: #2a2a4a; color: #e0e0e0; }
  .error-msg { color: #ff6b6b; padding: 8px; background: #2a1a1a; border-radius: 4px; margin-bottom: 8px; }
  .loading { text-align: center; padding: 20px; color: #576574; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2a2a4a; border-radius: 3px; }
</style>
</head>
<body>
<div id="app">
  <h1>🎲 AI TRPG — 调查员终端</h1>
  <div id="status-bar">
    <span class="stat"><span class="label">会话:</span><span class="value" id="session-id">—</span></span>
    <span class="stat"><span class="label">回合:</span><span class="value" id="round">0</span></span>
    <span class="stat"><span class="label">场景:</span><span class="value" id="scene">—</span></span>
    <span class="stat"><span class="label">HP:</span><span class="value" id="hp">—</span></span>
    <span class="stat"><span class="label">SAN:</span><span class="value" id="san">—</span></span>
    <span id="insanity-badge" style="display:none;color:#ff6b6b;font-weight:700;">🧠 疯狂</span>
    <button id="new-game">新游戏</button>
  </div>
  <div id="narrative">
    <div class="loading">点击"新游戏"开始</div>
  </div>
  <div id="input-area">
    <input id="input" type="text" placeholder="输入你的行动..." autocomplete="off">
    <button id="send" disabled>发送</button>
  </div>
</div>
<script>
let sessionId = null;
const narrative = document.getElementById('narrative');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const newGameBtn = document.getElementById('new-game');

function $(id) { return document.getElementById(id); }

function appendMessage(speaker, content, type) {
  const div = document.createElement('div');
  div.className = 'msg-' + type;
  const ts = new Date().toLocaleTimeString();
  if (type === 'system') {
    div.innerHTML = '<span class="speaker">⚔</span> ' + escapeHtml(content) + '<span class="timestamp">' + ts + '</span>';
  } else {
    div.innerHTML = '<span class="speaker">' + escapeHtml(speaker) + '</span> ' + escapeHtml(content) + '<span class="timestamp">' + ts + '</span>';
  }
  narrative.appendChild(div);
  narrative.scrollTop = narrative.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function updateStatus(state, sanity, summary) {
  if (summary) {
    $('session-id').textContent = summary.id || '—';
    $('round').textContent = summary.round || 0;
  }
  if (state) {
    $('scene').textContent = state.scene || '—';
    if (state.player) {
      $('hp').textContent = state.player.hp + '/' + state.player.maxHp;
    }
  }
  if (sanity) {
    $('san').textContent = sanity.currentSAN + '/' + sanity.maxSAN;
    const badge = $('insanity-badge');
    badge.style.display = (sanity.temporaryInsanity || sanity.indefiniteInsanity) ? 'inline' : 'none';
    badge.textContent = sanity.temporaryInsanity ? '🧠 临时疯狂' : sanity.indefiniteInsanity ? '🧠 永久疯狂' : '';
  }
}

async function createSession() {
  const res = await fetch('/api/sessions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ruleset:'cosmic-horror'}) });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  sessionId = data.sessionId;
  narrative.innerHTML = '';
  if (data.opening) {
    appendMessage('KP', data.opening, 'narration');
  }
  updateStatus(null, null, data.summary);
  input.disabled = false;
  input.focus();
  return data;
}

async function sendAction(inputText) {
  sendBtn.disabled = true;
  input.value = '';
  appendMessage('🎲', inputText, 'action');

  try {
    const res = await fetch('/api/sessions/' + sessionId + '/action', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({input: inputText}),
    });
    if (!res.ok) {
      const err = await res.json();
      appendMessage('系统', err.error || '请求失败', 'system');
      return;
    }
    const data = await res.json();
    // 显示 KP/旁白叙事
    if (data.narrative) {
      appendMessage('KP', data.narrative, 'narration');
    }
    // 显示其他事件
    if (data.events) {
      for (const e of data.events) {
        if (e.speaker !== 'KP' && e.speaker !== '旁白') {
          appendMessage(e.speaker, e.content, e.type);
        }
      }
    }
    updateStatus(data.state, data.sanity, data.summary);
  } catch (err) {
    appendMessage('系统', '连接错误: ' + err.message, 'system');
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

// 事件绑定
sendBtn.addEventListener('click', () => {
  const text = input.value.trim();
  if (text && sessionId) sendAction(text);
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !sendBtn.disabled) sendBtn.click();
});

newGameBtn.addEventListener('click', async () => {
  newGameBtn.disabled = true;
  narrative.innerHTML = '<div class="loading">创建新游戏...</div>';
  input.disabled = true;
  try {
    await createSession();
    sendBtn.disabled = false;
  } catch (err) {
    narrative.innerHTML = '<div class="error-msg">创建失败: ' + err.message + '</div>';
  } finally {
    newGameBtn.disabled = false;
  }
});

// 自动创建
window.addEventListener('load', async () => {
  try {
    await createSession();
    sendBtn.disabled = false;
  } catch (err) {
    narrative.innerHTML = '<div class="error-msg">无法连接服务器 ' + err.message + '</div>';
  }
});
</script>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ============================================================
// 启动
// ============================================================

const PORT = parseInt(process.env.PORT || "3099");

// 只在被直接运行时启动服务器（bun run src/api/server.ts）。被测试 import
// 进来取 runAction 等纯逻辑时，绝不能在这里把 3099 端口绑起来、也不该去
// 扫持久化的 session 文件。
if (import.meta.main) {

Bun.serve<WsConnectionData, never>({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req, server) {
    // WebSocket upgrade
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const sessionId = url.searchParams.get("session") || "";
      const rawRole = url.searchParams.get("role");
      const role: WsRole = isWsRole(rawRole) ? rawRole : "observer";
      const playerId = url.searchParams.get("playerId") || undefined;
      const upgraded = server.upgrade(req, {
        data: { sessionId, role, playerId },
      });
      if (upgraded) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return handleRequest(req);
  },
  websocket: {
    open(ws) {
      const { sessionId, role, playerId } = ws.data;
      createWsClient(ws, sessionId, role, playerId);
      console.log(`  🔗 WS 连接: ${role} → ${sessionId.slice(-8)} (共 ${wsStats().total} 连接)`);
    },
    close(ws) {
      removeWsClient(ws);
    },
    message(ws, msg) {
      // 可选的客户端→服务端消息（未来扩展）
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      } catch { /* ignore */ }
    },
  },
});

// 启动时加载已持久化的 session 摘要
const stored = listStoredSessions();
if (stored.length > 0) {
  console.log(`  Loaded ${stored.length} stored session(s) from disk`);
}

console.log(`\n  🎲 AI TRPG Server`);
console.log(`  ─────────────────`);
console.log(`  API:  http://localhost:${PORT}/api`);
console.log(`  GUI:  http://localhost:${PORT}/`);
console.log(`  Port: ${PORT}`);
console.log(`  CORS: *\n`);

}
