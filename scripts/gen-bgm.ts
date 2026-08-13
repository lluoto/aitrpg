// 环境音床生成器 —— 按 frontend/public/bgm/README.md 的配方合成可听的占位母版。
//   bun scripts/gen-bgm.ts [输出目录]
//
// 输出 mono / 22.05kHz / 16-bit PCM WAV，默认写到 frontend/public/bgm/。
// WAV 不入库（.gitignore 已忽略）。它们有两个用处：让播放链路能被真正听一遍，
// 以及给后续找 CC0 素材的人一个"这条床该是什么感觉"的可听基准。
//
// 全部是噪声塑形 —— 无旋律、无可辨识动机，与 README 版权一节的结论一致。
// 处理链与 README 记的一致：噪声 → 低通 → 混响 → 极慢起伏（LFO）→ 限幅。

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SAMPLE_RATE = 22_050;
const LOOP_SEC = 60;
/** 尾部多生成这么久，再绕回头部做交叉淡化，循环点因此严格连续 */
const CROSSFADE_SEC = 4;
const PEAK = 0.72;

// ============================================================
// 基础 DSP
// ============================================================

/** mulberry32 —— 固定种子，同一条床每次生成结果一致 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一极低通的系数；截止越低系数越小 */
function poleCoef(cutoffHz: number): number {
  return 1 - Math.exp((-2 * Math.PI * cutoffHz) / SAMPLE_RATE);
}

/** 单极点低通，级联 n 次以获得更陡的斜率 */
function makeLowpass(cutoffHz: number, stages: number): (x: number) => number {
  const a = poleCoef(cutoffHz);
  const state = new Float64Array(stages);
  return (x: number) => {
    let v = x;
    for (let i = 0; i < stages; i++) {
      state[i] += a * (v - state[i]);
      v = state[i];
    }
    return v;
  };
}

/** 高通 = 原信号减去低通分量 */
function makeHighpass(cutoffHz: number): (x: number) => number {
  const lp = makeLowpass(cutoffHz, 1);
  return (x: number) => x - lp(x);
}

/** 带阻尼的反馈梳状延迟，多条并联可以压住单条的金属味共振 */
function makeComb(delaySamples: number, feedback: number, dampHz: number) {
  const buf = new Float64Array(Math.max(1, Math.floor(delaySamples)));
  const damp = makeLowpass(dampHz, 1);
  let idx = 0;
  return (x: number): number => {
    const delayed = buf[idx];
    const wet = damp(delayed);
    buf[idx] = x + wet * feedback;
    idx = (idx + 1) % buf.length;
    return wet;
  };
}

// ============================================================
// 床的参数
// ============================================================

interface EventSpec {
  /** 每分钟触发次数 */
  perMinute: number;
  /** 声件的中心频率 */
  centerHz: number;
  /** 衰减时长 */
  decaySec: number;
  level: number;
}

interface BedSpec {
  /** 主噪声低通截止 —— 决定这条床的"颜色" */
  colorHz: number;
  /** 高通截止，0 表示不高通 */
  highpassHz: number;
  noiseLevel: number;
  /** 低频层截止，0 表示无 */
  rumbleHz: number;
  rumbleLevel: number;
  /** 恒定嗡鸣频率，0 表示无。institutional 的电器嗡鸣、dread 的次声都走这里 */
  humHz: number;
  humLevel: number;
  reverbSec: number;
  reverbFeedback: number;
  reverbMix: number;
  /** LFO 在一个循环内的整数周期数；60 秒下 3~6 即 0.05~0.1Hz */
  lfoCycles: number;
  lfoDepth: number;
  events: EventSpec[];
}

const BEDS: Record<string, BedSpec> = {
  // 白天小镇：人声压到只剩韵律，听不出词
  town: {
    colorHz: 1800, highpassHz: 120, noiseLevel: 0.5,
    rumbleHz: 90, rumbleLevel: 0.15, humHz: 0, humLevel: 0,
    reverbSec: 0.09, reverbFeedback: 0.55, reverbMix: 0.25,
    lfoCycles: 4, lfoDepth: 0.25,
    events: [{ perMinute: 14, centerHz: 700, decaySec: 0.8, level: 0.18 }],
  },
  // 有人住的房间：极安静，靠偶发声件撑住"有人"的感觉
  domestic: {
    colorHz: 900, highpassHz: 60, noiseLevel: 0.28,
    rumbleHz: 70, rumbleLevel: 0.12, humHz: 0, humLevel: 0,
    reverbSec: 0.05, reverbFeedback: 0.4, reverbMix: 0.18,
    lfoCycles: 5, lfoDepth: 0.3,
    events: [
      { perMinute: 6, centerHz: 1400, decaySec: 0.25, level: 0.12 },
      { perMinute: 60, centerHz: 2600, decaySec: 0.06, level: 0.05 },
    ],
  },
  // 酒吧：密度高、混响短，与 town 的区别在封闭感
  tavern: {
    colorHz: 2400, highpassHz: 150, noiseLevel: 0.55,
    rumbleHz: 100, rumbleLevel: 0.12, humHz: 0, humLevel: 0,
    reverbSec: 0.04, reverbFeedback: 0.62, reverbMix: 0.35,
    lfoCycles: 6, lfoDepth: 0.2,
    events: [{ perMinute: 40, centerHz: 3200, decaySec: 0.12, level: 0.14 }],
  },
  // 机构建筑：电器嗡鸣是灵魂，频率恒定不飘
  institutional: {
    colorHz: 1200, highpassHz: 40, noiseLevel: 0.3,
    rumbleHz: 60, rumbleLevel: 0.2, humHz: 50, humLevel: 0.1,
    reverbSec: 0.07, reverbFeedback: 0.5, reverbMix: 0.22,
    lfoCycles: 3, lfoDepth: 0.15,
    events: [{ perMinute: 5, centerHz: 900, decaySec: 0.5, level: 0.1 }],
  },
  // 废弃：空旷感来自留白，声件之间留长间隙
  derelict: {
    colorHz: 1500, highpassHz: 80, noiseLevel: 0.34,
    rumbleHz: 55, rumbleLevel: 0.18, humHz: 0, humLevel: 0,
    reverbSec: 0.12, reverbFeedback: 0.6, reverbMix: 0.32,
    lfoCycles: 4, lfoDepth: 0.45,
    events: [
      { perMinute: 7, centerHz: 500, decaySec: 1.4, level: 0.2 },
      { perMinute: 3, centerHz: 3000, decaySec: 0.5, level: 0.08 },
    ],
  },
  // 恐怖核心：次声层低到"感觉得到但听不见"
  dread: {
    colorHz: 700, highpassHz: 0, noiseLevel: 0.3,
    rumbleHz: 45, rumbleLevel: 0.3, humHz: 33, humLevel: 0.12,
    reverbSec: 0.1, reverbFeedback: 0.66, reverbMix: 0.3,
    lfoCycles: 5, lfoDepth: 0.35,
    events: [{ perMinute: 4, centerHz: 260, decaySec: 2, level: 0.16 }],
  },
  // 地下：混响短促金属化，与 dread 的开阔低频区分开
  underground: {
    colorHz: 1000, highpassHz: 70, noiseLevel: 0.26,
    rumbleHz: 60, rumbleLevel: 0.2, humHz: 0, humLevel: 0,
    reverbSec: 0.03, reverbFeedback: 0.7, reverbMix: 0.4,
    lfoCycles: 4, lfoDepth: 0.3,
    events: [{ perMinute: 22, centerHz: 2200, decaySec: 0.18, level: 0.2 }],
  },
  // 海岸：浪涌靠深 LFO，周期不规律才不像循环
  coast: {
    colorHz: 3000, highpassHz: 90, noiseLevel: 0.6,
    rumbleHz: 70, rumbleLevel: 0.2, humHz: 0, humLevel: 0,
    reverbSec: 0.08, reverbFeedback: 0.5, reverbMix: 0.24,
    lfoCycles: 5, lfoDepth: 0.5,
    events: [
      { perMinute: 5, centerHz: 1100, decaySec: 0.9, level: 0.14 },
      { perMinute: 3, centerHz: 3800, decaySec: 0.6, level: 0.07 },
    ],
  },
  // 仪式空间：石质长混响，吟唱只留混响尾巴
  sacred: {
    colorHz: 1100, highpassHz: 70, noiseLevel: 0.22,
    rumbleHz: 65, rumbleLevel: 0.12, humHz: 0, humLevel: 0,
    reverbSec: 0.18, reverbFeedback: 0.72, reverbMix: 0.45,
    lfoCycles: 4, lfoDepth: 0.3,
    events: [{ perMinute: 4, centerHz: 600, decaySec: 2.5, level: 0.1 }],
  },
  // 学术空间：最难的一条，安静到几乎无声但不能是纯静音
  library: {
    colorHz: 800, highpassHz: 60, noiseLevel: 0.12,
    rumbleHz: 50, rumbleLevel: 0.08, humHz: 0, humLevel: 0,
    reverbSec: 0.09, reverbFeedback: 0.5, reverbMix: 0.2,
    lfoCycles: 5, lfoDepth: 0.35,
    events: [
      { perMinute: 5, centerHz: 2400, decaySec: 0.12, level: 0.07 },
      { perMinute: 30, centerHz: 1200, decaySec: 0.1, level: 0.04 },
    ],
  },
};

// ============================================================
// 合成
// ============================================================

/** 把偶发声件铺进一条增益轨：每个声件是一次带通噪声的指数衰减 */
function renderEvents(spec: EventSpec, total: number, rng: () => number): Float64Array {
  const track = new Float64Array(total);
  const expected = (spec.perMinute * (total / SAMPLE_RATE)) / 60;
  const count = Math.max(1, Math.round(expected));
  const decaySamples = Math.max(1, Math.floor(spec.decaySec * SAMPLE_RATE));

  for (let n = 0; n < count; n++) {
    const start = Math.floor(rng() * total);
    const lp = makeLowpass(spec.centerHz * 1.6, 2);
    const hp = makeHighpass(spec.centerHz * 0.5);
    // 每个声件的音量随机浮动，规整的重复最容易暴露是合成的
    const gain = spec.level * (0.6 + 0.8 * rng());
    for (let i = 0; i < decaySamples; i++) {
      const pos = start + i;
      if (pos >= total) break;
      const env = Math.exp((-5 * i) / decaySamples);
      track[pos] += hp(lp(rng() * 2 - 1)) * env * gain;
    }
  }
  return track;
}

function renderBed(name: string, spec: BedSpec): Float64Array {
  const loop = LOOP_SEC * SAMPLE_RATE;
  const fade = CROSSFADE_SEC * SAMPLE_RATE;
  const total = loop + fade;

  // 种子由床名派生 —— 同名每次生成一致，不同床互不相同
  let seed = 0;
  for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rng = makeRng(seed);

  const colorLp = makeLowpass(spec.colorHz, 2);
  const colorHp = spec.highpassHz > 0 ? makeHighpass(spec.highpassHz) : null;
  const rumbleLp = spec.rumbleHz > 0 ? makeLowpass(spec.rumbleHz, 3) : null;

  // 三条互质延迟的梳状滤波并联，避免单条延迟的驻波音高
  const base = Math.floor(spec.reverbSec * SAMPLE_RATE);
  const combs = [
    makeComb(base, spec.reverbFeedback, 2600),
    makeComb(Math.floor(base * 1.37), spec.reverbFeedback * 0.94, 2100),
    makeComb(Math.floor(base * 1.81), spec.reverbFeedback * 0.88, 1700),
  ];

  const eventTracks = spec.events.map((e) => renderEvents(e, total, rng));
  const out = new Float64Array(total);

  for (let i = 0; i < total; i++) {
    let dry = colorLp(rng() * 2 - 1) * spec.noiseLevel;
    if (colorHp) dry = colorHp(dry);
    if (rumbleLp) dry += rumbleLp(rng() * 2 - 1) * spec.rumbleLevel;
    if (spec.humHz > 0) {
      const t = (2 * Math.PI * spec.humHz * i) / SAMPLE_RATE;
      dry += (Math.sin(t) + 0.3 * Math.sin(2 * t)) * spec.humLevel;
    }
    for (const track of eventTracks) dry += track[i];

    let wet = 0;
    for (const comb of combs) wet += comb(dry);
    let v = dry + (wet / combs.length) * spec.reverbMix;

    // 极慢起伏 —— 让静态噪声听起来像"活的空间"。整数周期，绕回时相位对得上。
    const phase = (2 * Math.PI * spec.lfoCycles * i) / loop;
    v *= 1 - spec.lfoDepth + spec.lfoDepth * (0.5 + 0.5 * Math.sin(phase));

    out[i] = Math.tanh(v * 1.4);
  }

  // 尾部交叉淡回头部：out[loop-1] 之后本来就接 out[loop]，把它揉进开头即无缝
  const looped = new Float64Array(loop);
  for (let i = 0; i < loop; i++) looped[i] = out[i];
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    looped[i] = out[i] * w + out[loop + i] * (1 - w);
  }

  let peak = 0;
  for (let i = 0; i < loop; i++) peak = Math.max(peak, Math.abs(looped[i]));
  const scale = peak > 0 ? PEAK / peak : 1;
  for (let i = 0; i < loop; i++) looped[i] *= scale;
  return looped;
}

// ============================================================
// WAV 输出
// ============================================================

function toWav(samples: Float64Array): Buffer {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // 字节率
  buf.writeUInt16LE(2, 32); // 块对齐
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buf;
}

const outDir = process.argv[2] ?? join("frontend", "public", "bgm");
mkdirSync(outDir, { recursive: true });

for (const [name, spec] of Object.entries(BEDS)) {
  const samples = renderBed(name, spec);
  const wav = toWav(samples);
  const path = join(outDir, `${name}.wav`);
  writeFileSync(path, wav);
  // 循环点是否无缝：拿绕回处的落差比全曲平均相邻落差。
  // 噪声的相邻样本本来就跳得厉害，所以落差的绝对值说明不了问题，比值才有判别力 ——
  // 接近 1 表示接缝和曲子里任何一处过渡没有区别。
  const seam = Math.abs(samples[0] - samples[samples.length - 1]);
  let sum = 0;
  for (let i = 1; i < samples.length; i++) sum += Math.abs(samples[i] - samples[i - 1]);
  const ratio = seam / (sum / (samples.length - 1));
  console.log(
    `${name.padEnd(14)} ${(wav.length / 1024 / 1024).toFixed(2)} MB  接缝/平均落差 ${ratio.toFixed(2)}x`
  );
}
console.log(`\n${Object.keys(BEDS).length} 条床已写入 ${outDir}`);
