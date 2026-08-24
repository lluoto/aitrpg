// OpenAI-compatible LLM client with streaming support
// Works with: OpenAI, DeepSeek, Ollama, and any OpenAI-compatible API

import type { LLMConfig } from "../config";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Force JSON output (OpenAI/DeepSeek compatible) */
  jsonMode?: boolean;
  /** 超时时间（毫秒），默认 120000（ECNU/DeepSeek 代理实测生成 100 tokens 需 ~80s） */
  timeout?: number;
}

/**
 * 会话与各 Agent 实际依赖的 LLM 调用面。
 *
 * 没有 API key 时装配的是 MockLLMClient，它与 LLMClient 没有共同基类，
 * 但 chat 的签名完全一致。消费方按本接口声明参数，就不必再假装拿到的一定是 LLMClient。
 */
export interface LLMLike {
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
}

/**
 * 从 chat-completion 响应里取正文。
 *
 * 响应来自外部 API，`resp.json()` 的类型是 unknown；此前各调用点要么各写一遍
 * `json.choices?.[0]?.message?.content` 这条链，要么用 `const json: any` 绕开检查。
 * 形状不符一律回退空串，由调用方自行决定抛错还是降级。
 */
export function extractMessageContent(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const { choices } = payload as { choices?: unknown };
  if (!Array.isArray(choices)) return "";
  const first: unknown = choices[0];
  if (typeof first !== "object" || first === null) return "";
  const { message } = first as { message?: unknown };
  if (typeof message !== "object" || message === null) return "";
  const { content } = message as { content?: unknown };
  return typeof content === "string" ? content : "";
}

export class LLMClient {
  private config: LLMConfig;
  /**
   * 全局熔断。**带冷却**，跳闸后到点自动进半开。
   *
   * ⚠ 原先是 `private static _defeated = false`，一旦置真就**永不恢复**：
   *   没有冷却、没有半开，`resetDefeat()` 又只有两个诊断脚本在调
   *   （注释写着「切换 API key 时调用」，可生产代码里一次都没调过）。
   *
   *   而 `server.ts` 是长期进程、这个标志又是 static ——
   *   **一次网络抖动就让整个进程往后所有会话、所有玩家永久退回模板**，
   *   直到有人手动重启。而且是跨会话的：一个会话连不上，
   *   把其他所有人的 LLM 一起带走。
   *
   *   改成存「熔断到什么时候」：过了冷却就放一个调用过去探路，
   *   成功即自愈，再失败就再跳闸一个冷却。
   */
  private static _defeatedUntil = 0;

  /** 冷却时长。留成环境变量，便于诊断脚本调短了验证自愈。 */
  private static cooldownMs(): number {
    const raw = Number(process.env.LLM_BREAKER_COOLDOWN_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
  }

  private static tripBreaker(): void {
    LLMClient._defeatedUntil = Date.now() + LLMClient.cooldownMs();
  }

  /** 熔断是否仍然张开。到点自动转半开（返回 false，放行一次探路调用）。 */
  private static breakerOpen(): boolean {
    return Date.now() < LLMClient._defeatedUntil;
  }

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /** 重置熔断（切换 API key 时调用） */
  static resetDefeat() { LLMClient._defeatedUntil = 0; }

  /**
   * 兼容 ECNU/qwen 代理：多条 system 消息会触发 500。
   * 将连续的所有 system 消息合并为一条（按出现顺序拼接），保留 user/assistant 顺序。
   */
  private normalizeMessages(messages: Message[]): Message[] {
    const sys: string[] = [];
    const out: Message[] = [];
    for (const m of messages) {
      if (m.role === "system") {
        sys.push(m.content);
      } else {
        if (sys.length > 0) {
          out.push({ role: "system", content: sys.join("\n\n") });
          sys.length = 0;
        }
        out.push(m);
      }
    }
    if (sys.length > 0) out.push({ role: "system", content: sys.join("\n\n") });
    return out;
  }

  /** Non-streaming chat — returns full response */
  async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
    if (LLMClient.breakerOpen()) throw new Error("LLM 已熔断（之前连接失败）");

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: this.normalizeMessages(messages),
      temperature: options.temperature ?? this.config.temperature,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
    };

    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const timeout = options.timeout ?? 300000;
    // ECNU/qwen 代理响应波动大（3s~90s+）：超时/瞬时错误自动重试 1 次
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      let resp: Response;
      try {
        resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err: any) {
        clearTimeout(timeoutId);
        const isTimeout = err.name === "AbortError";
        if (!isTimeout) LLMClient.tripBreaker();
        if (isTimeout && attempt === 0) continue; // 超时重试 1 次
        throw new Error(`LLM 连接失败: ${isTimeout ? "超时" : err.message}`);
      }
      clearTimeout(timeoutId);

      if (!resp.ok) {
        const err = (await resp.text()).slice(0, 500);
        // 5xx 服务端瞬时错误：重试 1 次
        if (resp.status >= 500 && attempt === 0) continue;
        throw new Error(`LLM API error ${resp.status}: ${err}`);
      }

      const content = extractMessageContent(await resp.json());
      if (!content) throw new Error("LLM returned empty response");
      return content;
    }
    throw new Error("LLM 重试仍失败");
  }

  /** Streaming chat — yields text chunks as they arrive */
  async *chatStream(
    messages: Message[],
    options: ChatOptions = {}
  ): AsyncGenerator<string> {
    // `chat()` 一开头就查熔断，这里原先不查 —— 同一个熔断，两条路两种待遇：
    // 跳闸之后流式调用照样往外发请求，等 fetch 自己失败才知道。
    if (LLMClient.breakerOpen()) throw new Error("LLM 已熔断（之前连接失败）");
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: this.normalizeMessages(messages),
      temperature: options.temperature ?? this.config.temperature,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      stream: true,
      stream_options: { include_usage: false },
    };

    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? 300000);

    let resp: Response;
    try {
      resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      // 超时 = 生成慢（非不可用），不触发熔断；仅真连接错误熔断
      if (err.name !== "AbortError") LLMClient.tripBreaker();
      throw new Error(`LLM 连接失败: ${err.name === "AbortError" ? "超时" : err.message}`);
    }
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const err = (await resp.text()).slice(0, 500);
      throw new Error(`LLM API error ${resp.status}: ${err}`);
    }

    if (!resp.body) throw new Error("No response body in stream");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  }
}
