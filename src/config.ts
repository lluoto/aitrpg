// LLM configuration loaded from environment
// Bun auto-loads .env files — no dotenv needed

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export function loadConfig(): LLMConfig {
  const apiKey = process.env.LLM_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    console.warn("⚠  No LLM_API_KEY set. Set LLM_API_KEY in .env or environment.");
    console.warn("   Supported env vars: LLM_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY");
    console.warn("   Copy .env.example to .env and fill in your values.\n");
  }

  return {
    apiKey: apiKey || "sk-placeholder",
    baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "1024"),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
  };
}
