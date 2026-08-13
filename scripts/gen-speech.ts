/**
 * 预制层合成 —— 把模组开场白离线合成成音频。
 *   bun scripts/gen-speech.ts [输出目录]
 *
 * 只处理 verbatim 内容（模组开场白）：它不经 LLM，加载时内容就已确定，
 * 提前合成等于把这部分的首包延迟降为零。KP 即兴叙述与 NPC 台词每次都不同，
 * 属于实时层，不在这里。判据见 docs/voice-readiness.md 第四节。
 *
 * 合成走 Windows SAPI（zh-CN 语音，系统自带、离线、无需任何密钥）。
 * 这是本机可验证的实现，不是对生产 TTS 的选型 —— 换厂商只需替换本文件，
 * 清单与键的口径由 src/voice/speech-plan.ts 决定，不受影响。
 *
 * 音频不入库（.gitignore 已忽略），随时可以重新生成。
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { collectPrebakeEntries } from "../src/voice/speech-plan";
import {
  INNSMOUTH_MODULE,
  ARKHAM_LIBRARY_MODULE,
  PREMIERS_BARN_MODULE,
} from "../src/rules/mythos-module";
import { MODULE_PREMIERS_BARN } from "../src/rules/custom-modules/premiers_barn";

const VOICE = "Microsoft Huihui Desktop"; // zh-CN
/** 略慢于默认语速：叙述文本比日常对话密，放慢一点更好跟 */
const RATE = -1;

const outDir = resolve(process.argv[2] ?? join("frontend", "public", "voice"));
mkdirSync(outDir, { recursive: true });

const entries = collectPrebakeEntries([
  INNSMOUTH_MODULE,
  ARKHAM_LIBRARY_MODULE,
  PREMIERS_BARN_MODULE,
  MODULE_PREMIERS_BARN,
]);

if (entries.length === 0) {
  console.log("没有可预制的文本。");
  process.exit(0);
}

const manifestPath = join(outDir, "manifest.json");
writeFileSync(manifestPath, JSON.stringify(entries, null, 2), "utf-8");

// PowerShell 脚本本身保持纯 ASCII，中文一律从 manifest 里按 UTF-8 读，
// 避免命令行传参时被控制台代码页改写 —— 这一步踩过坑。
const psPath = join(outDir, "_synth.ps1");
writeFileSync(
  psPath,
  [
    `$ErrorActionPreference = 'Stop'`,
    `Add-Type -AssemblyName System.Speech`,
    `$json = [System.IO.File]::ReadAllText('${manifestPath.replace(/\\/g, "\\\\")}', [System.Text.Encoding]::UTF8)`,
    `$entries = $json | ConvertFrom-Json`,
    `$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer`,
    `$names = $synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }`,
    `if ($names -notcontains '${VOICE}') { Write-Output ('MISSING_VOICE:' + ($names -join '|')); exit 2 }`,
    `$synth.SelectVoice('${VOICE}')`,
    `$synth.Rate = ${RATE}`,
    `foreach ($e in $entries) {`,
    `  $path = Join-Path '${outDir.replace(/\\/g, "\\\\")}' ($e.key + '.wav')`,
    `  $synth.SetOutputToWaveFile($path)`,
    `  $synth.Speak($e.text)`,
    `  Write-Output ('OK:' + $e.key)`,
    `}`,
    `$synth.SetOutputToNull()`,
    `$synth.Dispose()`,
  ].join("\n"),
  "utf-8"
);

const proc = Bun.spawnSync(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath]);
const stdout = new TextDecoder().decode(proc.stdout);
const stderr = new TextDecoder().decode(proc.stderr);

if (stdout.includes("MISSING_VOICE")) {
  const available = stdout.split("MISSING_VOICE:")[1]?.trim() ?? "(未知)";
  console.error(`找不到语音 "${VOICE}"。本机可用：${available}`);
  console.error("Windows 设置 → 时间和语言 → 语音 → 添加语音，装一个 zh-CN 语音即可。");
  process.exit(1);
}

if (proc.exitCode !== 0) {
  console.error(`合成失败（exit ${proc.exitCode}）：`);
  console.error(stderr.slice(0, 800));
  process.exit(1);
}

rmSync(psPath, { force: true });

/**
 * 按块解析 WAV，不要假设头是 44 字节。
 *
 * SAPI 写的 fmt 块是 18 字节（带 cbSize），data 因此从偏移 38 开始 ——
 * 按固定 44 字节去算，得到的时长和采样率都是错的。
 */
function wavInfo(path: string): { seconds: number; sampleRate: number; peak: number } {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`不是 WAV 文件: ${path}`);
  }

  let sampleRate = 0;
  let byteRate = 0;
  let dataStart = 0;
  let dataLen = 0;

  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const len = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      sampleRate = buf.readUInt32LE(pos + 12);
      byteRate = buf.readUInt32LE(pos + 16);
    } else if (id === "data") {
      dataStart = pos + 8;
      dataLen = Math.min(len, buf.length - dataStart);
      break;
    }
    pos += 8 + len + (len % 2); // 块按偶数字节对齐
  }
  if (!byteRate || !dataLen) throw new Error(`WAV 结构异常: ${path}`);

  // 峰值：合成失败时也会产出文件，只是全是静音，光看文件大小分辨不出来
  let peak = 0;
  for (let i = dataStart; i + 1 < dataStart + dataLen; i += 2) {
    const v = Math.abs(buf.readInt16LE(i));
    if (v > peak) peak = v;
  }

  return { seconds: dataLen / byteRate, sampleRate, peak: peak / 32768 };
}

let ok = 0;
for (const e of entries) {
  const path = join(outDir, `${e.key}.wav`);
  if (!existsSync(path)) {
    console.error(`缺失 ${e.key}（${e.moduleId}）`);
    continue;
  }

  const { seconds, sampleRate, peak } = wavInfo(path);
  const chars = e.text.length;
  if (peak < 0.01) {
    console.error(`${e.moduleId} 合成结果接近静音（峰值 ${peak.toFixed(3)}）`);
    continue;
  }
  ok++;
  console.log(
    `${e.moduleId.padEnd(18)} ${chars} 字  ${seconds.toFixed(1)} 秒  ` +
    `${(chars / seconds).toFixed(1)} 字/秒  ${(sampleRate / 1000).toFixed(1)}kHz  峰值 ${peak.toFixed(2)}`
  );
}

console.log(`\n${ok}/${entries.length} 条已合成 → ${outDir}`);
