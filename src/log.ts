// 诊断日志 — 只承载开发者/运维排障需要的信息。
//
// 边界（重要）：面向玩家的 CLI 正文——叙事、检定结果、命令用法、角色卡——
// 继续直接走 console.log，**不经过本模块**。给游戏正文套日志级别只会破坏体验。
// 本模块只处理玩家不关心、出问题才去看的信息：降级、跳过、配置缺失、后台清理。
//
// 级别按「谁消费、消费后做什么」选择，而不是按严重程度的感觉：
//   error — 服务自身失败且无法自行恢复
//   warn  — 流程走通了但走了异常路径：回退、跳过、降级
//   info  — 重建时间线所需的状态迁移：启动、清理、加载完成
//   debug — 本地复现用，默认不输出

export type LogLevel = "debug" | "info" | "warn" | "error";

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** 阈值只在本模块解析一次；调用点永远不读环境变量。 */
const threshold: number = (() => {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  return raw && raw in SEVERITY ? SEVERITY[raw as LogLevel] : SEVERITY.info;
})();

/** 沿用仓库既有的缩进 + 符号前缀风格，迁移后终端观感不变。 */
const MARK: Record<LogLevel, string> = {
  debug: "·",
  info: "·",
  warn: "⚠",
  error: "✖",
};

/**
 * cause 原样透传给 console，由运行时负责序列化。
 * 自己 String() 掉 Error 会丢掉堆栈——那正是排障时唯一有用的部分。
 */
function emit(level: LogLevel, scope: string, message: string, cause?: unknown): void {
  if (SEVERITY[level] < threshold) return;
  const line = `  ${MARK[level]} [${scope}] ${message}`;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (cause === undefined) sink(line);
  else sink(line, cause);
}

export const log = {
  debug: (scope: string, message: string): void => emit("debug", scope, message),
  info: (scope: string, message: string): void => emit("info", scope, message),
  warn: (scope: string, message: string, cause?: unknown): void => emit("warn", scope, message, cause),
  error: (scope: string, message: string, cause?: unknown): void => emit("error", scope, message, cause),
};
