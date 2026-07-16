<script setup>
import { ref } from 'vue'
import { npcChat } from './api.js'

const props = defineProps({
  sessionId: String,
  npc: Object,
})
const emit = defineEmits(['close'])

const inputText = ref('')
const messages = ref([])
const loading = ref(false)

async function send() {
  const text = inputText.value.trim()
  if (!text || loading.value) return
  messages.value.push({ role: 'player', content: text })
  inputText.value = ''
  loading.value = true
  try {
    const data = await npcChat(props.sessionId, props.npc.name, text)
    messages.value.push({ role: 'npc', content: data.reply, name: data.npc })
  } catch (e) {
    messages.value.push({ role: 'system', content: `对话失败: ${e.message}` })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="nc-overlay" @click.self="emit('close')">
      <div class="nc-panel" @click.stop>
        <div class="nc-header">
          <h2>💬 {{ npc?.name ?? 'NPC' }}</h2>
          <span class="nc-role">{{ npc?.role ?? '' }}</span>
          <button class="nc-close" @click="emit('close')">✕</button>
        </div>
        <div class="nc-body" ref="logEl">
          <div v-for="(m, i) in messages" :key="i" class="nc-msg" :class="`nc-msg--${m.role}`">
            <strong v-if="m.role === 'npc'">{{ m.name ?? 'NPC' }}:</strong>
            <strong v-else-if="m.role === 'player'">你:</strong>
            <span>{{ m.content }}</span>
          </div>
          <div v-if="loading" class="nc-msg nc-msg--npc"><em>{{ npc?.name }} 正在思考…</em></div>
          <div v-if="messages.length === 0" class="nc-hint">对 {{ npc?.name }} 说点什么…</div>
        </div>
        <div class="nc-input-row">
          <input
            v-model="inputText"
            class="nc-input"
            :disabled="loading"
            placeholder="输入对话…"
            @keyup.enter="send"
          />
          <button class="nc-btn" :disabled="loading || !inputText.trim()" @click="send">发送</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.nc-overlay { position: fixed; inset: 0; z-index: 9000; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: center; }
.nc-panel { width: min(460px, 90vw); height: 60vh; background: #1a1a2e; border: 1px solid #3a3a5c; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; color: #e0e0e0; font-size: 13px; }
.nc-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #2a2a4a; background: #141428; }
.nc-header h2 { font-size: 14px; color: #c9a96e; margin: 0; flex: 1; }
.nc-role { font-size: 11px; color: #888; }
.nc-close { background: transparent; border: 1px solid #3a3a5c; color: #888; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.nc-body { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.nc-msg { padding: 6px 10px; border-radius: 8px; max-width: 85%; line-height: 1.4; }
.nc-msg--player { background: #2a2a4a; align-self: flex-end; }
.nc-msg--npc { background: #1e1e3a; border: 1px solid #3a3a5c; align-self: flex-start; }
.nc-msg--system { background: #2a1a1a; color: #ff6b6b; align-self: center; font-size: 11px; }
.nc-msg strong { color: #c9a96e; margin-right: 4px; }
.nc-hint { color: #555; text-align: center; padding: 32px 0; font-size: 12px; }
.nc-input-row { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid #2a2a4a; background: #141428; }
.nc-input { flex: 1; padding: 7px 10px; border: 1px solid #3a3a5c; border-radius: 6px; background: #1a1a2e; color: #e0e0e0; font-size: 13px; outline: none; }
.nc-input:focus { border-color: #c9a96e; }
.nc-btn { padding: 7px 14px; border: 1px solid #c9a96e; border-radius: 6px; background: #3a3a20; color: #c9a96e; font-size: 12px; cursor: pointer; }
.nc-btn:disabled { opacity: 0.4; cursor: default; }
</style>