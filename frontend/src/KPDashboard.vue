<script setup>
import { ref, computed, watch } from 'vue'
import { getKPState, kpAction } from './api.js'

const props = defineProps({
  sessionId: { type: String, required: true },
})

const emit = defineEmits(['close'])

// ── State ──────────────────────────────────────────────
const kp = ref(null)
const loading = ref(false)
const error = ref(null)
const activeTab = ref('chars')

// Action form state
const msgText = ref('')
const msgSpeaker = ref('守秘人')
const sanPid = ref('')
const sanVal = ref(50)
const hpPid = ref('')
const hpVal = ref(10)
const dmgTarget = ref('')
const dmgVal = ref(1)
const sceneId = ref('')
const diffVal = ref('medium')
const actionFeedback = ref('')

// ── Fetch ──────────────────────────────────────────────
async function refresh() {
  if (!props.sessionId) return
  loading.value = true
  error.value = null
  try {
    const data = await getKPState(props.sessionId)
    kp.value = data.kp
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// Auto-fetch on mount and when sessionId changes
watch(() => props.sessionId, () => { if (props.sessionId) refresh() }, { immediate: true })

// ── Computed ────────────────────────────────────────────
const chars = computed(() => kp.value?.characters ?? [])
const comps = computed(() => kp.value?.companions ?? [])
const npcs = computed(() => kp.value?.npcs ?? [])
const currentDiff = computed(() => kp.value?.difficulty?.label ?? '未设置')
const currentScene = computed(() => kp.value?.scene ?? '未知')
const currentModule = computed(() => kp.value?.module)
const sceneItems = computed(() => kp.value?.sceneItems ?? [])
const combatOn = computed(() => kp.value?.combatActive ?? false)

// ── Actions ────────────────────────────────────────────
async function doAction(action, body, label) {
  actionFeedback.value = ''
  try {
    await kpAction(props.sessionId, action, body)
    actionFeedback.value = `✓ ${label} 完成`
    refresh()
  } catch (e) {
    actionFeedback.value = `✗ ${e.message}`
  }
  setTimeout(() => { actionFeedback.value = '' }, 3000)
}

function sendMsg() {
  if (!msgText.value.trim()) return
  doAction('send-message', { message: msgText.value, speaker: msgSpeaker.value }, '发送消息')
  msgText.value = ''
}

function setSan() {
  doAction('set-san', { playerId: sanPid.value || undefined, value: sanVal.value }, '设置 SAN')
}

function setHp() {
  doAction('set-hp', { playerId: hpPid.value || undefined, value: hpVal.value }, '设置 HP')
}

function applyDmg() {
  if (!dmgTarget.value.trim()) return
  doAction('apply-damage', { target: dmgTarget.value, damage: dmgVal.value }, '造成伤害')
}

function setScene() {
  if (!sceneId.value.trim()) return
  doAction('set-scene', { sceneId: sceneId.value }, '切换场景')
}

function setDiff(diff) {
  doAction('set-difficulty', { difficulty: diff }, `设置难度: ${diff}`)
}

const tabs = [
  { id: 'chars', label: '人物' },
  { id: 'comps', label: '同伴' },
  { id: 'npcs', label: 'NPC' },
  { id: 'scene', label: '场景' },
  { id: 'actions', label: '操作' },
]

function hpColor(cur, max) {
  if (!max) return 'var(--color-hp)'
  const pct = cur / max
  if (pct <= 0.25) return 'var(--color-hp-critical)'
  if (pct <= 0.5) return 'var(--color-hp-warning)'
  return 'var(--color-hp)'
}

function sanColor(cur, max) {
  if (!max) return 'var(--color-san)'
  const pct = cur / max
  if (pct <= 0.25) return 'var(--color-san-critical)'
  if (pct <= 0.5) return 'var(--color-san-warning)'
  return 'var(--color-san)'
}
</script>

<template>
  <Teleport to="body">
    <div class="kp-overlay" @click.self="emit('close')">
      <div class="kp-panel" @click.stop>
        <!-- Header -->
        <div class="kp-panel__header">
          <h2 class="kp-panel__title">📋 KP 控制台</h2>
          <div class="kp-panel__header-right">
            <button class="kp-panel__refresh" @click="refresh" :disabled="loading" title="刷新">⟳</button>
            <button class="kp-panel__close" @click="emit('close')" aria-label="关闭">✕</button>
          </div>
        </div>

        <!-- Meta -->
        <div class="kp-panel__meta">
          <span>会话: {{ props.sessionId.slice(-8) }}</span>
          <span>回合: {{ kp?.round ?? '—' }}</span>
          <span>规则: {{ kp?.ruleset ?? '—' }}</span>
          <span>战斗: <span :class="combatOn ? 'kp-badge--danger' : 'kp-badge--ok'">{{ combatOn ? '进行中' : '否' }}</span></span>
          <span>难度: <span class="kp-badge--diff">{{ currentDiff }}</span></span>
        </div>

        <!-- Error -->
        <div v-if="error" class="kp-panel__error">{{ error }}</div>

        <!-- Loading -->
        <div v-if="loading" class="kp-panel__loading">加载中…</div>

        <!-- Tabs -->
        <div class="kp-tabs">
          <button
            v-for="t in tabs" :key="t.id"
            class="kp-tab"
            :class="{ 'kp-tab--active': activeTab === t.id }"
            @click="activeTab = t.id"
          >{{ t.label }}</button>
        </div>

        <!-- Tab: 人物 -->
        <div v-if="activeTab === 'chars'" class="kp-tab-content">
          <div v-for="ch in chars" :key="ch.playerId" class="kp-char-card">
            <div class="kp-char-card__header">
              <span class="kp-char-card__name">{{ ch.name }}</span>
              <span class="kp-char-card__arc">{{ ch.archetype }}</span>
            </div>
            <div class="kp-char-card__stats">
              <div class="kp-stat-row">
                <span>HP</span>
                <span :style="{ color: hpColor(ch.hp, ch.maxHp) }">{{ ch.hp }}/{{ ch.maxHp }}</span>
              </div>
              <div class="kp-stat-row">
                <span>SAN</span>
                <span :style="{ color: sanColor(ch.san, ch.maxSan) }">{{ ch.san }}/{{ ch.maxSan }}</span>
                <span v-if="ch.temporaryInsanity" class="kp-tag kp-tag--warn">临时疯狂</span>
                <span v-if="ch.indefiniteInsanity" class="kp-tag kp-tag--danger">不定疯狂</span>
              </div>
              <div class="kp-stat-row">
                <span>CM</span>
                <span>{{ ch.cthulhuMythos ?? 0 }}</span>
              </div>
              <div class="kp-stat-row">
                <span>AC</span>
                <span>{{ ch.ac ?? '—' }}</span>
                <span>DB</span>
                <span>{{ ch.damageBonus ?? '—' }}</span>
                <span>MOVE</span>
                <span>{{ ch.move ?? '—' }}</span>
              </div>
              <div class="kp-stat-row">
                <span>甲</span>
                <span>{{ ch.armor?.join(', ') || '无' }}</span>
              </div>
            </div>
            <!-- Skills -->
            <details class="kp-details">
              <summary>技能 ({{ Object.keys(ch.skills ?? {}).length }})</summary>
              <div class="kp-skill-grid">
                <span v-for="(v, k) in ch.skills" :key="k" class="kp-skill-chip">{{ k }}: {{ v }}</span>
              </div>
            </details>
          </div>
          <div v-if="chars.length === 0" class="kp-empty">无角色数据</div>
        </div>

        <!-- Tab: 同伴 -->
        <div v-if="activeTab === 'comps'" class="kp-tab-content">
          <div v-for="c in comps" :key="c.id" class="kp-char-card kp-char-card--sm">
            <div class="kp-char-card__header">
              <span class="kp-char-card__name">{{ c.name }}</span>
              <span class="kp-char-card__arc">{{ c.position }} · {{ c.behavior }}</span>
            </div>
            <div class="kp-char-card__stats">
              <div class="kp-stat-row">
                <span>HP</span><span :style="{ color: hpColor(c.hp, c.maxHp) }">{{ c.hp }}/{{ c.maxHp }}</span>
                <span>AC</span><span>{{ c.ac }}</span>
                <span>士气</span><span>{{ c.morale }}</span>
              </div>
              <div class="kp-stat-row" v-if="c.resolveState">
                <span>心智</span><span>{{ c.resolveState }}</span>
              </div>
            </div>
          </div>
          <div v-if="comps.length === 0" class="kp-empty">无同伴</div>
        </div>

        <!-- Tab: NPC -->
        <div v-if="activeTab === 'npcs'" class="kp-tab-content">
          <div v-for="n in npcs" :key="n.name" class="kp-char-card kp-char-card--sm">
            <div class="kp-char-card__header">
              <span class="kp-char-card__name">{{ n.name }}</span>
              <span class="kp-char-card__arc">{{ n.type }}</span>
            </div>
            <div class="kp-char-card__stats">
              <div class="kp-stat-row">
                <span>HP</span><span :style="{ color: hpColor(n.hp, n.maxHp) }">{{ n.hp }}/{{ n.maxHp }}</span>
                <span>位置</span><span>{{ n.position }}</span>
              </div>
            </div>
          </div>
          <div v-if="npcs.length === 0" class="kp-empty">无 NPC</div>
        </div>

        <!-- Tab: 场景 -->
        <div v-if="activeTab === 'scene'" class="kp-tab-content">
          <div class="kp-section">
            <h4>当前场景：{{ currentScene }}</h4>
            <p v-if="currentModule">{{ currentModule.name }} — {{ currentModule.difficulty }}</p>
            <p v-if="currentModule?.description" class="kp-desc">{{ currentModule.description }}</p>
          </div>
          <div v-if="currentModule?.scenes" class="kp-section">
            <h4>模组场景列表</h4>
            <ul class="kp-scene-list">
              <li v-for="s in currentModule.scenes" :key="s">{{ s }}</li>
            </ul>
          </div>
          <div v-if="sceneItems.length" class="kp-section">
            <h4>场景物品</h4>
            <ul class="kp-item-list">
              <li v-for="(item, i) in sceneItems" :key="i">{{ item }}</li>
            </ul>
          </div>
          <div v-if="kp?.registeredModules?.length" class="kp-section">
            <h4>已注册模组</h4>
            <ul class="kp-item-list">
              <li v-for="m in kp.registeredModules" :key="m">{{ m }}</li>
            </ul>
          </div>
        </div>

        <!-- Tab: 操作 -->
        <div v-if="activeTab === 'actions'" class="kp-tab-content">
          <!-- 发送消息 -->
          <div class="kp-action-block">
            <h4>发送消息</h4>
            <div class="kp-form-row">
              <input v-model="msgSpeaker" class="kp-input kp-input--sm" placeholder="说话者" />
              <input v-model="msgText" class="kp-input kp-input--grow" placeholder="消息内容…" @keyup.enter="sendMsg" />
              <button class="kp-btn" @click="sendMsg">发送</button>
            </div>
          </div>

          <!-- 设置 SAN -->
          <div class="kp-action-block">
            <h4>设置 SAN</h4>
            <div class="kp-form-row">
              <input v-model="sanPid" class="kp-input kp-input--sm" placeholder="角色 ID" />
              <input v-model.number="sanVal" type="number" class="kp-input kp-input--xs" min="0" max="99" />
              <button class="kp-btn" @click="setSan">设置</button>
            </div>
          </div>

          <!-- 设置 HP -->
          <div class="kp-action-block">
            <h4>设置 HP</h4>
            <div class="kp-form-row">
              <input v-model="hpPid" class="kp-input kp-input--sm" placeholder="角色 ID" />
              <input v-model.number="hpVal" type="number" class="kp-input kp-input--xs" min="0" max="999" />
              <button class="kp-btn" @click="setHp">设置</button>
            </div>
          </div>

          <!-- 造成伤害 -->
          <div class="kp-action-block">
            <h4>造成伤害</h4>
            <div class="kp-form-row">
              <input v-model="dmgTarget" class="kp-input kp-input--sm" placeholder="目标 ID" />
              <input v-model.number="dmgVal" type="number" class="kp-input kp-input--xs" min="1" />
              <button class="kp-btn kp-btn--danger" @click="applyDmg">造成伤害</button>
            </div>
          </div>

          <!-- 切换场景 -->
          <div class="kp-action-block">
            <h4>切换场景</h4>
            <div class="kp-form-row">
              <input v-model="sceneId" class="kp-input kp-input--grow" placeholder="场景 ID…" />
              <button class="kp-btn" @click="setScene">切换</button>
            </div>
          </div>

          <!-- 难度 -->
          <div class="kp-action-block">
            <h4>设置难度</h4>
            <div class="kp-diff-btns">
              <button
                v-for="d in ['easy', 'medium', 'hard', 'nightmare']" :key="d"
                class="kp-btn"
                :class="{ 'kp-btn--active': diffVal === d }"
                @click="setDiff(d)"
              >{{ { easy: '简单', medium: '标准', hard: '困难', nightmare: '噩梦' }[d] }}</button>
            </div>
          </div>

          <!-- Feedback -->
          <div v-if="actionFeedback" class="kp-feedback" :class="{ 'kp-feedback--ok': actionFeedback.startsWith('✓') }">
            {{ actionFeedback }}
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Overlay ── */
.kp-overlay {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0,0,0,0.7);
  display: flex; justify-content: center; align-items: flex-start;
  padding-top: 4vh;
  animation: kpFadeIn 0.15s ease;
}
@keyframes kpFadeIn { from { opacity: 0; } to { opacity: 1; } }

/* ── Panel ── */
.kp-panel {
  width: min(680px, 95vw);
  max-height: 88vh;
  background: #1a1a2e;
  border: 1px solid #3a3a5c;
  border-radius: 12px;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,0,0,0.6);
  color: #e0e0e0;
  font-size: 13px;
}
.kp-panel__header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #2a2a4a;
  background: #141428;
}
.kp-panel__title { font-size: 15px; font-weight: 600; margin: 0; color: #c9a96e; }
.kp-panel__header-right { display: flex; gap: 8px; }
.kp-panel__refresh, .kp-panel__close {
  background: transparent; border: 1px solid #3a3a5c; color: #888;
  border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 14px;
  transition: all 0.15s;
}
.kp-panel__refresh:hover, .kp-panel__close:hover { color: #fff; border-color: #666; }
.kp-panel__meta {
  display: flex; gap: 16px; flex-wrap: wrap;
  padding: 8px 16px; font-size: 12px; color: #888;
  border-bottom: 1px solid #2a2a4a;
  background: #16162a;
}
.kp-panel__error { padding: 8px 16px; color: #ff6b6b; font-size: 12px; background: #2a1010; }
.kp-panel__loading { padding: 24px; text-align: center; color: #888; }

/* ── Badges ── */
.kp-badge--danger { color: #ff6b6b; font-weight: 600; }
.kp-badge--ok { color: #6bcf6b; }
.kp-badge--diff { color: #c9a96e; font-weight: 600; }

/* ── Tabs ── */
.kp-tabs {
  display: flex; gap: 0;
  border-bottom: 1px solid #2a2a4a;
  padding: 0 8px;
  background: #16162a;
}
.kp-tab {
  padding: 8px 16px; font-size: 12px;
  background: transparent; border: none; border-bottom: 2px solid transparent;
  color: #888; cursor: pointer; transition: all 0.15s;
}
.kp-tab:hover { color: #ccc; }
.kp-tab--active { color: #c9a96e; border-bottom-color: #c9a96e; }

/* ── Tab Content ── */
.kp-tab-content {
  flex: 1; overflow-y: auto; padding: 12px 16px;
}
.kp-empty { padding: 24px; text-align: center; color: #666; font-size: 13px; }

/* ── Character Card ── */
.kp-char-card {
  background: #1e1e3a; border: 1px solid #2a2a4a; border-radius: 8px;
  padding: 10px 12px; margin-bottom: 10px;
}
.kp-char-card--sm { padding: 8px 10px; }
.kp-char-card__header {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 6px;
}
.kp-char-card__name { font-weight: 600; font-size: 14px; color: #c9a96e; }
.kp-char-card__arc { font-size: 11px; color: #777; }
.kp-char-card__stats { display: flex; flex-direction: column; gap: 3px; }

.kp-stat-row { display: flex; gap: 12px; align-items: center; font-size: 12px; }
.kp-stat-row span:first-child { color: #888; min-width: 32px; }

.kp-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; }
.kp-tag--warn { background: #3a2a10; color: #ffaa33; }
.kp-tag--danger { background: #2a1010; color: #ff6b6b; }

/* ── Details / Skills ── */
.kp-details { margin-top: 6px; }
.kp-details summary { font-size: 11px; color: #888; cursor: pointer; }
.kp-skill-grid { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.kp-skill-chip {
  font-size: 10px; padding: 1px 6px;
  background: #2a2a4a; border-radius: 4px; color: #aaa;
}

/* ── Sections ── */
.kp-section { margin-bottom: 12px; }
.kp-section h4 { font-size: 13px; color: #c9a96e; margin: 0 0 4px; }
.kp-desc { font-size: 12px; color: #999; margin: 0; }
.kp-scene-list, .kp-item-list { font-size: 12px; color: #aaa; margin: 0; padding-left: 18px; }

/* ── Action Blocks ── */
.kp-action-block {
  background: #1e1e3a; border: 1px solid #2a2a4a; border-radius: 8px;
  padding: 10px 12px; margin-bottom: 10px;
}
.kp-action-block h4 { font-size: 12px; color: #888; margin: 0 0 6px; }
.kp-form-row { display: flex; gap: 6px; align-items: center; }
.kp-input {
  padding: 5px 8px; border: 1px solid #3a3a5c; border-radius: 6px;
  background: #141428; color: #e0e0e0; font-size: 12px;
  outline: none; transition: border-color 0.15s;
}
.kp-input:focus { border-color: #c9a96e; }
.kp-input--xs { width: 64px; }
.kp-input--sm { width: 100px; }
.kp-input--grow { flex: 1; }
.kp-input--xs[type=number] { text-align: center; }

.kp-btn {
  padding: 5px 12px; border: 1px solid #3a3a5c; border-radius: 6px;
  background: #2a2a4a; color: #ccc; font-size: 12px;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.kp-btn:hover { background: #3a3a5c; color: #fff; }
.kp-btn--danger:hover { background: #5a2020; border-color: #ff6b6b; }
.kp-btn--active { background: #3a3a20; border-color: #c9a96e; color: #c9a96e; }

.kp-diff-btns { display: flex; gap: 6px; flex-wrap: wrap; }

.kp-feedback { padding: 6px 12px; margin-top: 8px; border-radius: 6px; font-size: 12px; }
.kp-feedback--ok { background: #1a2a1a; color: #6bcf6b; }
.kp-feedback:not(.kp-feedback--ok) { background: #2a1a1a; color: #ff6b6b; }
@media (max-width: 480px) {
  .kp-panel { width: 100vw; max-height: 100vh; border-radius: 0; }
  .kp-tab-content { padding: 8px 10px; }
  .kp-form-row { flex-wrap: wrap; }
  .kp-input--grow { min-width: 100%; }
}
</style>
