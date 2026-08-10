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
  /** 全局熔断：首次连接失败后跳过所有后续调用 */
  private static _defeated = false;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /** 重置熔断（切换 API key 时调用） */
  static resetDefeat() { LLMClient._defeated = false; }

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
    if (LLMClient._defeated) throw new Error("LLM 已熔断（之前连接失败）");

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
        if (!isTimeout) LLMClient._defeated = true;
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
      // 超时 = 生成慢（非不可用），不触发永久熔断；仅真连接错误熔断
      if (err.name !== "AbortError") LLMClient._defeated = true;
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
