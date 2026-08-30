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
# ⚠ 上面这两条修了之后，2026-08-30 又实测出**第三个毛病**：改成
# `Start-Process -PassThru -NoNewWindow -RedirectStandardOutput/-Error`
# 之后进程确实不再是孤儿，但**调用方本身还是被卡住**——8 分半没有任何
# 请求进来（`server-out.log` 早就有内容，PID 也确实在跑），第一次被
# 误诊成"start 只负责启动，日志没内容很正常"，其实是调用方压根没拿到
# 返回。根因：`-NoNewWindow` 只是让子进程共用调用方的控制台，不改变它
# 仍在调用方自己的 Job Object 里这件事——调用方等的是整棵进程树退出，
# 换个控制台救不了。已实测方案 A（去掉 `-NoNewWindow`）依旧卡住，
# 退到方案 B：用 WMI `Win32_Process.Create` 起进程（由 WMI 服务代为
# 创建，不在调用方的 Job Object 里），已实测调用方不再等它。细节与两次
# 独立实测记录见 Start-DevServer 函数体内的注释。
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
# cmd.exe 包装进程的 PID——见 Start-DevServer 里方案 B 的说明。真实服务器
# PID（bun.exe）仍然是 .dev-server.pid，对外行为不变；这份只是 stop 时
# 用来确保包装进程也被清理掉，不留任何一层孤儿。
$WrapperPidFile = Join-Path $RepoRoot ".dev-server-wrapper.pid"
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
  #
  # ⚠ 方案 A（去掉 `-NoNewWindow`，只让子进程拿自己的控制台）已经**实测
  # 不成立**（2026-08-30，dev-server-startup-hang 一轮）：新控制台只是
  # 换了个窗口/句柄，不改变子进程仍在**调用方自己的 Job Object**里这件
  # 事——调用方（这条 agent 自己的 shell 工具）等的是整棵进程树退出，
  # 不是控制台关闭；实测 `Start-Process ... -PassThru` 去掉 `-NoNewWindow`
  # 之后，脚本内部的计时立刻返回（<1s），但调用方那一层仍然卡到超时才被
  # 强制杀掉——两次独立实测（`bun run dev-server:start` 与直接
  # `powershell -File ... start`）现象一致，不是巧合。
  #
  # 退到方案 B：用 WMI `Win32_Process.Create` 起进程——它是由 WMI 服务
  # （`WmiPrvSE.exe`）代为创建的，不在调用方自己的 Job Object 里，调用方
  # 不会等它（已实测：`Invoke-CimMethod ... Win32_Process Create` 本身
  # 0.2s 内返回，且调用它的那层工具**没有**卡到超时，与方案 A 的两次
  # 失败实测形成对照）。
  #
  # 代价：`Win32_Process.Create` 只是 `CreateProcess` 的薄封装，不解释
  # `>`/`2>` 这类 shell 重定向语法，必须包一层 `cmd.exe /c` 才能把
  # stdout/stderr 写文件——这意味着 WMI 直接创建出来的进程是 cmd.exe，
  # 真正监听端口的 bun.exe 是它的子进程（`cmd /c` 默认会等子进程退出才
  # 自己退出，所以正常情况下杀掉 bun.exe 之后 cmd.exe 会自己跟着消失；
  # 但 Stop-DevServer 不依赖"通常会"，两个 PID 都记下来、stop 时都显式
  # 杀一遍，见该函数）。
  $wrapperCmdLine = "cmd.exe /c bun src/api/server.ts > `"$OutLog`" 2> `"$ErrLog`""
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $wrapperCmdLine
    CurrentDirectory = $RepoRoot.Path
  }
  if ($created.ReturnValue -ne 0) {
    throw "WMI Win32_Process.Create 失败，ReturnValue=$($created.ReturnValue)"
  }
  $wrapperId = $created.ProcessId

  # bun.exe 是 cmd.exe 的子进程，cmd 启动它有极短延迟——轮询最多 5 秒，
  # 找不到就明确报错，不把 wrapper（cmd.exe）的 PID 误当成真实服务器 PID
  # 写进 .dev-server.pid（那样 status/stop 会认错进程）。
  $realId = $null
  for ($i = 0; $i -lt 50; $i++) {
    $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$wrapperId AND Name='bun.exe'" -ErrorAction SilentlyContinue
    if ($child) { $realId = $child.ProcessId; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $realId) {
    throw "等了 5 秒也没找到 bun.exe 子进程（wrapper PID $wrapperId），启动可能失败，查看 $ErrLog"
  }

  Set-Content -Path $PidFile -Value $realId
  Set-Content -Path $WrapperPidFile -Value $wrapperId
  Write-Host "已启动：PID $realId（cmd.exe 包装进程 PID $wrapperId），端口 3099（用环境变量 PORT 覆盖），日志 server-out.log / server-err.log"
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

  # 方案 B 的 cmd.exe 包装进程通常在 bun.exe 退出后自己跟着退出（`cmd /c`
  # 是同步等待子进程的），但"通常会"不是保证——显式再杀一遍，确保不会
  # 留下这一层孤儿（哪怕它此刻已经什么都不监听）。
  if (Test-Path $WrapperPidFile) {
    $wrapperId = Get-Content $WrapperPidFile
    $wrapperProc = Get-Process -Id $wrapperId -ErrorAction SilentlyContinue
    if ($wrapperProc) {
      Stop-Process -Id $wrapperId -Force -ErrorAction SilentlyContinue
      Write-Host "顺带清理了 cmd.exe 包装进程：PID $wrapperId"
    }
    Remove-Item $WrapperPidFile -ErrorAction SilentlyContinue
  }
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
