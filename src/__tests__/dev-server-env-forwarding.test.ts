// 开发·dev-server 传不进环境变量——脚本形状回归。
//
// Win32_Process.Create 从 WmiPrvSE.exe 的环境创建 cmd.exe，不继承调用方
// PowerShell 的 $env:LOG_LEVEL/$env:WORLD_MODEL_PATH。此前脚本 65-70 行
// 给调用方环境赋默认值，但创建命令行没有 Environment/set 前缀，这段代码
// 实际是惰性的：LOG_LEVEL=debug 永远打不开 intent-trace，指定不存在的
// WORLD_MODEL_PATH 也仍会回落默认模型路径。
//
// 真验收是人工 WMI 启停（测试不能稳定占 3099/WMI/PID 文件）：
// LOG_LEVEL=debug 的 server-out.log 有 intent-trace；默认没有；不存在的
// WORLD_MODEL_PATH 在 /api/config 变 exists=false；stop 清两层且调用方不挂。
// 这份单测只钉住把白名单转成 `cmd /c set "X=Y"&&...` 的关键文本形状，
// 防止以后重构时又把 envPrefix 从 wrapperCmdLine 丢掉。

import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";

const script = readFileSync("scripts/dev-server.ps1", "utf8");

describe("dev-server WMI 环境透传", () => {
  it("只白名单转发 LOG_LEVEL、两个模型路径和 PORT，不转发整个调用方环境", () => {
    expect(script).toContain('$forwardedEnvNames = @("LOG_LEVEL", "WORLD_MODEL_PATH", "CTHULHU_MODEL_PATH", "PORT")');
    expect(script).toContain('[Environment]::GetEnvironmentVariable($name, "Process")');
    expect(script).not.toContain("GetEnvironmentVariables()");
  });

  it("每个 set 紧贴 &&，并且 wrapper 真正拼入 envPrefix 再启动 bun", () => {
    // `&&` 前多一个空格会成为环境变量值的一部分，是 cmd.exe 的老坑。
    expect(script).toContain('$envPrefix += "set `"$name=$escaped`"&&"');
    expect(script).not.toContain('$envPrefix += "set `"$name=$escaped`" &&"');
    expect(script).toContain('"cmd.exe /c ${envPrefix}bun src/api/server.ts');
  });

  it("注释明确 WMI 不继承调用方环境，避免把显式模型路径又说成已经生效", () => {
    expect(script).toContain("不继承这份");
    expect(script).toContain("PowerShell 调用方环境");
  });
});
