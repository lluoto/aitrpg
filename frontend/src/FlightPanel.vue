<script setup>
import { ref } from 'vue'
import { kpAction } from './api.js'

const props = defineProps({ sessionId: String })
const emit = defineEmits(['close', 'action'])

const loading = ref(false)
const msg = ref('')
const customInput = ref('')

const QUICK_ACTIONS = [
  { label: '🎲 d100', cmd: () => `/roll d100`, desc: '投百分骰' },
  { label: '🎲 1d6', cmd: () => `/roll 1d6`, desc: '投六面骰' },
  { label: '⚔️ 战斗开始', cmd: () => `/combat start`, desc: '进入战斗模式' },
  { label: '✋ 战斗结束', cmd: () => `/combat end`, desc: '结束战斗' },
  { label: '☀️ 上午', cmd: () => `/time morning`, desc: '设为上午' },
  { label: '🌙 夜晚', cmd: () => `/time night`, desc: '设为夜晚' },
  { label: '🧠 SAN-1d6', cmd: () => `/dmg p1 1d6`, desc: '对 p1 造成 SAN 伤害' },
  { label: '❤️ 治疗1d6', cmd: () => `/heal p1 1d6`, desc: '治疗 p1' },
  { label: '📖 规则速查', cmd: () => `/ref`, desc: '打开规则速查' },
  { label: '🗺️ 场景列表', cmd: () => `/table scene`, desc: '随机场景' },
]

const CUSTOM_PRESETS = [
  { label: '搜索房间', cmd: () => `我仔细搜索这个房间的每一个角落，检查抽屉、地板暗格和书架上的书` },
  { label: '聆听', cmd: () => `我停下脚步，仔细聆听周围的动静` },
  { label: '社交', cmd: () => `我友好地打招呼，试着获取信息` },
  { label: '潜行', cmd: () => `我压低身形，悄无声息地移动` },
]

async function run(cmdFn) {
  loading.value = true; msg.value = ''
  const cmd = typeof cmdFn === 'function' ? cmdFn() : cmdFn
  try {
    if (cmd.startsWith('/')) {
      const action = cmd.slice(1).split(' ')[0]
      const rest = cmd.slice(1).split(' ').slice(1).join(' ')
      await kpAction(props.sessionId, 'send-message', { message: cmd, speaker: '守秘人', type: 'system' })
    }
    msg.value = `✓ 已发送: ${cmd}`
    emit('action', cmd)
  } catch (e) { msg.value = `✗ ${e.message}` }
  finally { loading.value = false; setTimeout(() => msg.value = '', 2000) }
}

async function sendCustom() {
  const text = customInput.value.trim()
  if (!text) return
  await run(text)
  customInput.value = ''
}
</script>

<template>
  <Teleport to="body">
    <div class="fp-overlay" @click.self="emit('close')">
      <div class="fp-panel" @click.stop>
        <div class="fp-header">
          <h2>⚡ 快捷操作台</h2>
          <button class="fp-close" @click="emit('close')">✕</button>
        </div>
        <div class="fp-body">
          <div v-if="msg" class="fp-msg">{{ msg }}</div>

          <h4 class="fp-section">KP 快捷操作</h4>
          <div class="fp-grid">
            <button v-for="a in QUICK_ACTIONS" :key="a.label" class="fp-btn" :disabled="loading" @click="run(a.cmd)" :title="a.desc">
              {{ a.label }}
            </button>
          </div>

          <h4 class="fp-section">玩家常用行为</h4>
          <div class="fp-grid">
            <button v-for="p in CUSTOM_PRESETS" :key="p.label" class="fp-btn fp-btn--preset" :disabled="loading" @click="run(p.cmd)">
              {{ p.label }}
            </button>
          </div>

          <h4 class="fp-section">自定义输入</h4>
          <div class="fp-input-row">
            <input v-model="customInput" class="fp-input" placeholder="输入任意行动…" @keyup.enter="sendCustom" :disabled="loading" />
            <button class="fp-btn fp-btn--go" :disabled="loading || !customInput.trim()" @click="sendCustom">发送</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.fp-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; padding-top: 6vh; }
.fp-panel { width: min(480px, 92vw); max-height: 82vh; background: #1a1a2e; border: 1px solid #3a3a5c; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; color: #e0e0e0; font-size: 13px; }
.fp-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #2a2a4a; background: #141428; }
.fp-header h2 { font-size: 15px; color: #c9a96e; margin: 0; }
.fp-close { background: transparent; border: 1px solid #3a3a5c; color: #888; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.fp-close:hover { color: #fff; border-color: #666; }
.fp-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
.fp-msg { padding: 6px 10px; border-radius: 6px; background: #1a2a1a; color: #6bcf6b; font-size: 12px; margin-bottom: 8px; text-align: center; }
.fp-section { font-size: 11px; color: #888; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: 1px; }
.fp-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.fp-btn { padding: 7px 12px; border: 1px solid #3a3a5c; border-radius: 8px; background: #2a2a4a; color: #ccc; font-size: 12px; cursor: pointer; transition: all 0.15s; }
.fp-btn:hover:not(:disabled) { background: #3a3a5c; color: #fff; border-color: #c9a96e; }
.fp-btn--preset { background: #1e2a1e; border-color: #3a5a3a; }
.fp-btn--preset:hover:not(:disabled) { background: #2a3a2a; border-color: #6bcf6b; }
.fp-btn--go { background: #3a3a20; border-color: #c9a96e; color: #c9a96e; }
.fp-btn:disabled { opacity: 0.4; cursor: default; }
.fp-input-row { display: flex; gap: 6px; }
.fp-input { flex: 1; padding: 7px 10px; border: 1px solid #3a3a5c; border-radius: 6px; background: #141428; color: #e0e0e0; font-size: 12px; outline: none; }
.fp-input:focus { border-color: #c9a96e; }
</style>