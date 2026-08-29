# 后端启停 —— 别再把这段逻辑留在模拟 prompt 里（修A·任务4）。
#
# ⚠ 这条已经丢过一次：.gitignore 里已经有一条 `start.ps1`，早先某次显然
# 写过同名脚本，被这条规则悄悄吃掉、从没入过库。这次改用不会撞规则的
# 文件名，并且这份文件本身就是"写进仓库"这件事的证据——每轮重写的模拟
# prompt 不算数，这里才算。
#
# 常见的错误启动方式两个毛病都占全了：
#   1. `bun run server` 是 package.json 里的包装脚本（bun src/api/server.ts），
#      会再 spawn 一个子进程——一次启动两个进程。Stop-Process 杀掉包装脚本，
#      真正在监听端口的那个 server.ts 变成孤儿，继续占着端口。
#   2. `start "" /b bun run server > out.log 2> err.log` 不脱离控制台——
#      子孙进程继承调用者的 stdout/stderr 句柄，工具等的是"管道关闭"而不是
#      "进程退出"，永远等不到 EOF，工具空转。
#
# 用法（都在仓库根目录 C:\aitrpg\poc 下跑）：
#   bun run dev-server:start     启动，PID 写进 .dev-server.pid
#   bun run dev-server:stop      按 PID 文件里的进程号杀掉，删掉 PID 文件
#   bun run dev-server:status    看 PID 文件里的进程还在不在
#   或直接：powershell -File scripts\dev-server.ps1 start|stop|status
#
# 服务端口默认 3099（不是 3000——模拟 prompt 里从来没写过这一点，
# 见 src/api/server.ts:1037），用环境变量 PORT 覆盖。

param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$PidFile = Join-Path $RepoRoot ".dev-server.pid"
$OutLog = Join-Path $RepoRoot "server-out.log"
$ErrLog = Join-Path $RepoRoot "server-err.log"

function Start-DevServer {
  if (Test-Path $PidFile) {
    $existingId = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($existingId -and (Get-Process -Id $existingId -ErrorAction SilentlyContinue)) {
      Write-Host "已经在跑：PID $existingId（先 stop 再 start，不要叠加启动）"
      return
    }
  }

  # 世界模型路径默认已经能通过 C→D 的 Junction 解析（../世界模型/...），
  # 这里显式指定只是更稳，不依赖 Junction/相对路径假设。已经设过就不覆盖，
  # 让调用方可以按需指向别的路径做对照测试。
  if (-not $env:WORLD_MODEL_PATH) {
    $env:WORLD_MODEL_PATH = "D:\aitrpg\世界模型\v18_output\v18_all_master.jsonl"
  }
  if (-not $env:CTHULHU_MODEL_PATH) {
    $env:CTHULHU_MODEL_PATH = "D:\aitrpg\世界模型\cthulhu_extracted\cthulhu_world_model.jsonl"
  }

  # 直接起 src/api/server.ts，不走 `bun run server` 那层包装——包装脚本会
  # 再 spawn 一次子进程，PID 记的是包装进程，Stop-Process 杀不到真正在
  # 监听端口的那一个，会变成孤儿继续占着 3099。
  # -NoNewWindow + -RedirectStandardOutput/-RedirectStandardError 才是
  # 真正脱离控制台的写法：子进程的 stdout/stderr 直接写文件，不继承调用者
  # 的句柄，调用者不会卡在等一个永远不会来的 EOF 上。
  $proc = Start-Process bun -ArgumentList "src/api/server.ts" -WorkingDirectory $RepoRoot `
    -PassThru -NoNewWindow `
    -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
  Set-Content -Path $PidFile -Value $proc.Id
  Write-Host "已启动：PID $($proc.Id)，端口 3099（用环境变量 PORT 覆盖），日志 server-out.log / server-err.log"
}

function Stop-DevServer {
  if (-not (Test-Path $PidFile)) {
    Write-Host "没有 .dev-server.pid，看起来没在跑（或者是用别的方式启动的，这个脚本管不到）"
    return
  }
  $procId = Get-Content $PidFile
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc) {
    Stop-Process -Id $procId -Force
    Write-Host "已停止：PID $procId"
  } else {
    Write-Host "PID $procId 已经不在了（可能是手动杀的），只清理 PID 文件"
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
}

function Get-DevServerStatus {
  if (-not (Test-Path $PidFile)) {
    Write-Host "没有 .dev-server.pid —— 没在跑（或者是用别的方式启动的）"
    return
  }
  $procId = Get-Content $PidFile
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Host "在跑：PID $procId"
  } else {
    Write-Host "PID 文件指向 $procId，但那个进程已经不在了——孤儿 PID 文件，跑一次 stop 清理掉"
  }
}

switch ($Action) {
  "start" { Start-DevServer }
  "stop" { Stop-DevServer }
  "status" { Get-DevServerStatus }
}
