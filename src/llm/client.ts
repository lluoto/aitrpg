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
  /** 超时时间（毫秒），默认 8000 */
  timeout?: number;
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

  /** Non-streaming chat — returns full response */
  async chat(messages: Message[], options: ChatOptions = {}): Promise<string> {
    if (LLMClient._defeated) throw new Error("LLM 已熔断（之前连接失败）");

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: options.temperature ?? this.config.temperature,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
    };

    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const timeout = options.timeout ?? 8000;
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
      LLMClient._defeated = true; // 熔断：后续调用立即抛错
      throw new Error(`LLM 连接失败: ${err.name === "AbortError" ? "超时" : err.message}`);
    }
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const err = await resp.text().slice(0, 500);
      throw new Error(`LLM API error ${resp.status}: ${err}`);
    }

    const json: any = await resp.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty response");
    return content;
  }

  /** Streaming chat — yields text chunks as they arrive */
  async *chatStream(
    messages: Message[],
    options: ChatOptions = {}
  ): AsyncGenerator<string> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: options.temperature ?? this.config.temperature,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      stream: true,
      stream_options: { include_usage: false },
    };

    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

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
      LLMClient._defeated = true;
      throw new Error(`LLM 连接失败: ${err.name === "AbortError" ? "超时(8s)" : err.message}`);
    }
    clearTimeout(timeoutId);

    if (!resp.ok) {
      const err = await resp.text().slice(0, 500);
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
