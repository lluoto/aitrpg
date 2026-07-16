<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { createSession, sendAction, getArchetypes } from './api.js'
import KPDashboard from './KPDashboard.vue'
import CombatGrid from './CombatGrid.vue'
import ModuleEditor from './ModuleEditor.vue'
import CharacterEditor from './CharacterEditor.vue'
import NpcChat from './NpcChat.vue'

// ── State ──────────────────────────────────────────────
const screen = ref('start')        // 'start' | 'game'
const loading = ref(false)         // waiting for API
const error = ref(null)            // last error message

// Character creation
const characterName = ref('')
const archetypes = ref([])
const selectedArchetype = ref('')
const archetypeLoading = ref(false)
const selectedRuleset = ref('coc7e')

// Ruleset display names
const rulesetName = computed(() =>
  selectedRuleset.value === 'coc7e' ? '克苏鲁的呼唤 7 版'
    : selectedRuleset.value === 'dnd5e' ? '龙与地下城 5 版'
    : selectedRuleset.value
)

const session = reactive({
  id: '',
  round: 0,
  scene: '',
  playerName: '',
  archetype: '',
  ruleset: '',
  hp: 0,
  maxHp: 0,
  san: 0,
  maxSAN: 0,
  tempInsanity: false,
  indefInsanity: false,
  dead: false,
})

const messages = ref([])           // { id, type, speaker, content }
const companions = ref([])         // from data.state.companions[]
const npcs = ref([])               // from data.state.npcs[]
const monsters = ref([])           // from data.state.monsters[]
const companionsExpanded = ref(true) // collapsible toggle for narrow screens
const selectedCompanion = ref(null)     // modal state
const kpVisible = ref(false)            // KP dashboard toggle
const moduleEditorVisible = ref(false)  // Module editor toggle
const charEditorVisible = ref(false)    // Character editor toggle
const npcChatVisible = ref(false)       // NPC chat modal
const chattingNpc = ref(null)           // currently chatting NPC
const pcList = ref([])                  // available player characters
const activePc = ref(0)                 // index in pcList, 0 = main PC
const logEl = ref(null)            // scroll container ref

// ── Input History ───────────────────────────────────────
const inputValue = ref('')
const history = ref([])            // past commands (newest last)
const historyIndex = ref(-1)       // -1 = new input, 0..n = browsing history

// ── Computed ───────────────────────────────────────────
const hpPercent = computed(() =>
  session.maxHp > 0 ? Math.max(0, Math.round((session.hp / session.maxHp) * 100)) : 100
)

const sanPercent = computed(() =>
  session.maxSAN > 0 ? Math.max(0, Math.round((session.san / session.maxSAN) * 100)) : 100
)

const hpColor = computed(() => {
  if (hpPercent.value <= 25) return 'var(--color-hp-critical)'
  if (hpPercent.value <= 50) return 'var(--color-hp-warning)'
  return 'var(--color-hp)'
})

const sanColor = computed(() => {
  if (sanPercent.value <= 25) return 'var(--color-san-critical)'
  if (sanPercent.value <= 50) return 'var(--color-san-warning)'
  return 'var(--color-san)'
})

const hasInsanity = computed(() =>
  session.tempInsanity || session.indefInsanity
)

const showCharCard = computed(() => selectedCompanion.value !== null)

// ── Scroll ─────────────────────────────────────────────
async function scrollToBottom() {
  await nextTick()
  if (logEl.value) {
    logEl.value.scrollTop = logEl.value.scrollHeight
  }
}

// Auto-scroll when messages change
watch(() => messages.value.length, () => {
  scrollToBottom()
})

// ── Actions ────────────────────────────────────────────
// Load archetypes on mount
async function loadArchetypes(ruleset) {
  const rs = ruleset || selectedRuleset.value
  archetypeLoading.value = true
  try {
    const data = await getArchetypes(rs)
    archetypes.value = data.archetypes || []
    if (archetypes.value.length > 0) {
      selectedArchetype.value = archetypes.value[0].id
    }
  } catch {
    // Offline fallback: provide basic options by ruleset
    if (rs === 'dnd5e') {
      archetypes.value = [
        { id: 'fighter', label: '战士', description: '精通所有武器和护甲的战斗专家' },
        { id: 'rogue', label: '游荡者', description: '潜行、巧手、寻找并解除陷阱' },
        { id: 'wizard', label: '法师', description: '研习奥术，掌握强大的法术' },
        { id: 'cleric', label: '牧师', description: '侍奉神祇，治愈队友，驱散亡灵' },
        { id: 'barbarian', label: '野蛮人', description: '狂怒之力，以血肉之躯冲垮敌人' },
      ]
      selectedArchetype.value = 'fighter'
    } else {
      archetypes.value = [
        { id: 'investigator', label: '调查员', description: '追查真相的专业人士' },
        { id: 'antiquarian', label: '古物学者', description: '研究古代文物和历史的专家' },
        { id: 'physician_coc', label: '医师', description: '有执照的医学专业人士' },
        { id: 'journalist_coc', label: '记者', description: '追查真相的媒体人' },
        { id: 'professor', label: '教授', description: '学识渊博的大学教师' },
      ]
      selectedArchetype.value = 'investigator'
    }
  } finally {
    archetypeLoading.value = false
  }
}

// Call load on setup
loadArchetypes()

// Watch ruleset change → reload archetypes
watch(selectedRuleset, (rs) => {
  loadArchetypes(rs)
})

async function startGame() {
  loading.value = true
  error.value = null
  try {
    const name = characterName.value.trim() || '调查员'
    const archetype = selectedArchetype.value || 'investigator'
    const data = await createSession({ ruleset: selectedRuleset.value, archetype, characterName: name })
    session.id = data.sessionId
    session.round = data.summary?.round ?? 1
    session.scene = data.summary?.scene ?? '序幕'
    session.playerName = data.characterName ?? name
    session.archetype = data.summary?.archetype ?? ''
    session.ruleset = data.summary?.ruleset ?? 'CoC 7E'

    // 初始化 PC 列表（多角色支持）
    pcList.value = [{ id: 'p1', name: data.characterName ?? name }]
    if (data.state?.companions?.length) {
      for (const c of data.state.companions) {
        if (c.control === 'player') pcList.value.push({ id: c.id, name: c.name })
      }
    }
    activePc.value = 0

    // Use actual character stats if available
    if (data.character) {
      session.hp = data.character.hp ?? 10
      session.maxHp = data.character.maxHp ?? 10
      session.san = data.character.attributes?.power ?? 50
      session.maxSAN = data.character.attributes?.power ?? 50
    } else {
      session.hp = 10
      session.maxHp = 10
      session.san = 55
      session.maxSAN = 55
    }

    // Initialize companions from session state
    if (data.state?.companions) {
      companions.value = data.state.companions
    }
    if (data.state?.npcs) npcs.value = data.state.npcs
    if (data.state?.monsters) monsters.value = data.state.monsters

    messages.value = [{
      id: Date.now(),
      type: 'narration',
      speaker: '守秘人',
      content: data.opening || '夜幕降临，故事由此开始……'
    }]

    screen.value = 'game'
  } catch (e) {
    error.value = e.message || '创建游戏失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function submitAction(inputText, actingPc) {
  const trimmed = inputText.trim()
  if (!trimmed || loading.value) return

  const speaker = (actingPc !== undefined ? pcList.value[actingPc]?.name : pcList.value[activePc.value]?.name) || session.playerName

  recordHistory(trimmed)
  loading.value = true
  error.value = null

  // Add player action to log
  messages.value.push({
    id: Date.now(),
    type: 'action',
    speaker,
    content: trimmed,
  })

  try {
    const data = await sendAction(session.id, trimmed)

    // Add GM narration
    if (data.narrative) {
      messages.value.push({
        id: Date.now() + 1,
        type: 'narration',
        speaker: '守秘人',
        content: data.narrative,
      })
    }

    // Add events
    if (data.events) {
      for (const ev of data.events) {
        messages.value.push({
          id: Date.now() + Math.random(),
          type: ev.type || 'system',
          speaker: ev.speaker || '系统',
          content: ev.content || '',
        })
      }
    }

    // Add dice roll display
    if (data.dice && data.dice.length > 0) {
      for (const d of data.dice) {
        const detail = d.detail ? ` (${d.detail})` : ''
        const bonus = d.bonus ? ` + ${d.bonus}` : ''
        messages.value.push({
          id: Date.now() + Math.random(),
          type: 'roll',
          speaker: '🎲',
          content: `${d.expr} = **${d.total}**${detail}${bonus}`,
        })
      }
    }

    // Update state
    if (data.state) {
      session.round = data.state.round ?? session.round
      session.scene = data.state.scene ?? session.scene
      if (data.state.player) {
        session.hp = data.state.player.hp ?? session.hp
        session.maxHp = data.state.player.maxHp ?? session.maxHp
      }
      if (data.state.companions) {
        companions.value = data.state.companions
      }
      if (data.state.npcs) npcs.value = data.state.npcs
      if (data.state.monsters) monsters.value = data.state.monsters
    }
    // Player death
    if (data.dead) {
      session.hp = 0
      session.dead = true
    }
    if (data.sanity) {
      session.san = data.sanity.currentSAN ?? session.san
      session.maxSAN = data.sanity.maxSAN ?? session.maxSAN
      session.tempInsanity = data.sanity.temporaryInsanity ?? false
      session.indefInsanity = data.sanity.indefiniteInsanity ?? false
    }
  } catch (e) {
    messages.value.push({
      id: Date.now() + 2,
      type: 'system',
      speaker: '系统',
      content: '错误：' + (e.message || '请求失败，请重试'),
    })
  } finally {
    loading.value = false
  }
}

function newGame() {
  Object.assign(session, {
    id: '', round: 0, scene: '', playerName: '', archetype: '', ruleset: '',
    hp: 0, maxHp: 0, san: 0, maxSAN: 0,
    tempInsanity: false, indefInsanity: false, dead: false,
  })
  messages.value = []
  companions.value = []
  history.value = []
  historyIndex.value = -1
  error.value = null
  kpVisible.value = false
  moduleEditorVisible.value = false
  charEditorVisible.value = false
  npcChatVisible.value = false
  screen.value = 'start'
}

// ── Companion Control ──────────────────────────────────
function toggleControl(companion) {
  if (!companion || loading.value) return
  if (companion.control === 'auto') {
    submitAction('控制 ' + companion.name)
  } else {
    submitAction('自动 ' + companion.name)
  }
}

function chatNpc(npc) {
  chattingNpc.value = npc
  npcChatVisible.value = true
}

function positionLabel(pos) {
  const map = { melee_range: '近战位', ranged: '远程位', far: '后排' }
  return map[pos] || pos || '未知'
}

function behaviorLabel(beh) {
  const map = { aggressive: '攻击', defensive: '防御', support: '支援' }
  return map[beh] || beh || '未知'
}

// ── Character Card Modal ────────────────────────────────
function openCharCard(c) {
  selectedCompanion.value = c
}
function closeCharCard() {
  selectedCompanion.value = null
}

function resolveStateLabel(state) {
  return { steadfast: '坚定', afflicted: '恐慌', berserk: '疯狂' }[state] || state
}
function resolveStateColor(state) {
  return { steadfast: '#8fbc8f', afflicted: '#dda0dd', berserk: '#ff6b6b' }[state] || 'var(--color-text)'
}

const traitNames = {
  courage: '勇气', aggression: '攻击性', caution: '谨慎',
  loyalty: '忠诚', cruelty: '残忍',
}
function traitColor(val) {
  // 统一金色系，按数值调节透明度
  const opacity = Math.max(0.2, val / 10)
  return `rgba(201, 169, 110, ${opacity})`
}

const skillNames = {
  fight: '格斗', dodge: '闪避', heal: '治疗',
  stealth: '潜行', arcana: '奥术', perception: '察觉',
  survival: '生存', persuasion: '说服', intimidate: '威吓',
}

// ── Input ref ──────────────────────────────────────────
const inputRef = ref(null)
function focusInput() {
  nextTick(() => inputRef.value?.focus())
}

// ── Input History Navigation ───────────────────────────
function onInputKeydown(e) {
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (history.value.length === 0) return
    const newIdx = historyIndex.value === -1
      ? history.value.length - 1
      : Math.max(0, historyIndex.value - 1)
    historyIndex.value = newIdx
    inputValue.value = history.value[newIdx]
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (historyIndex.value === -1) return
    const newIdx = historyIndex.value + 1
    if (newIdx >= history.value.length) {
      historyIndex.value = -1
      inputValue.value = ''
    } else {
      historyIndex.value = newIdx
      inputValue.value = history.value[newIdx]
    }
  }
}

function recordHistory(cmd) {
  // Don't record duplicates of the last command
  if (history.value.length > 0 && history.value[history.value.length - 1] === cmd) return
  history.value.push(cmd)
  historyIndex.value = -1
}
</script>

<template>
  <div class="trpg-app" :class="{ 'screen--game': screen === 'game' }">

    <!-- ═══════════ START SCREEN ═══════════ -->
    <div v-if="screen === 'start'" class="start-screen">
      <div class="start-screen__inner">
        <div class="start-screen__ornament top" aria-hidden="true"></div>

        <h1 class="start-screen__title">AI TRPG</h1>
        <p class="start-screen__subtitle">人工智能桌面角色扮演游戏</p>
        <p class="start-screen__desc">
          选择你的规则集，创建角色，开始冒险。<br />
          CoC 适合洛夫克拉夫特式恐怖，D&D 适合奇幻冒险。
        </p>

        <!-- 角色创建 -->
        <div class="char-creation">
          <div class="char-creation__field">
            <label class="char-creation__label">角色姓名</label>
            <input
              v-model="characterName"
              class="char-creation__input"
              placeholder="输入你的名字…"
              maxlength="20"
              @keyup.enter="startGame"
            />
          </div>
          <div class="char-creation__field">
            <label class="char-creation__label">规则</label>
            <select
              v-model="selectedRuleset"
              class="char-creation__select"
            >
              <option value="coc7e">克苏鲁的呼唤 7 版</option>
              <option value="dnd5e">龙与地下城 5 版</option>
            </select>
          </div>
          <div class="char-creation__field">
            <label class="char-creation__label">职业</label>
            <select
              v-model="selectedArchetype"
              class="char-creation__select"
              :disabled="archetypeLoading"
            >
              <option
                v-for="a in archetypes"
                :key="a.id"
                :value="a.id"
              >{{ a.label }}</option>
            </select>
            <p class="char-creation__hint" v-if="selectedArchetype">
              {{ archetypes.find(a => a.id === selectedArchetype)?.description || '' }}
            </p>
          </div>
        </div>

        <button
          class="btn btn--primary"
          :disabled="loading || archetypeLoading"
          @click="startGame"
        >
          <span v-if="loading" class="btn__spinner"></span>
          <span v-else>开始新游戏</span>
        </button>

        <p v-if="error" class="start-screen__error">{{ error }}</p>

        <div class="start-screen__ornament bottom" aria-hidden="true"></div>
      </div>
      <div class="start-screen__noise" aria-hidden="true"></div>
    </div>

    <!-- ═══════════ GAME SCREEN ═══════════ -->
    <div v-if="screen === 'game'" class="game-screen">

      <!-- ── Status Bar ── -->
      <header class="status-bar">
        <div class="status-bar__row">
          <div class="status-bar__info">
            <span class="status-bar__label">会话</span>
            <span class="status-bar__value status-bar__value--mono">{{ session.id.slice(-6) || '—' }}</span>
          </div>
          <div class="status-bar__info">
            <span class="status-bar__label">{{ session.ruleset === 'dnd5e' ? '回合' : '轮' }}</span>
            <span class="status-bar__value">{{ session.round || '—' }}</span>
          </div>
          <div class="status-bar__info" v-if="session.ruleset">
            <span class="status-bar__label">规则</span>
            <span class="status-bar__value">{{ session.ruleset }}</span>
          </div>
          <div class="status-bar__info status-bar__info--scene">
            <span class="status-bar__label">场景</span>
            <span class="status-bar__value">{{ session.scene || '—' }}</span>
          </div>
          <div v-if="session.archetype" class="status-bar__info">
            <span class="status-bar__label">职业</span>
            <span class="status-bar__value">{{ session.archetype }}</span>
          </div>
        </div>

        <div class="status-bar__stats">
          <!-- HP -->
          <div class="stat">
            <span class="stat__label">HP</span>
            <div class="stat__track">
              <div
                class="stat__fill"
                :style="{ width: hpPercent + '%', background: hpColor }"
              ></div>
            </div>
            <span class="stat__num">{{ session.hp }}/{{ session.maxHp }}</span>
          </div>

          <!-- SAN -->
          <div class="stat">
            <span class="stat__label">SAN</span>
            <div class="stat__track">
              <div
                class="stat__fill"
                :style="{ width: sanPercent + '%', background: sanColor }"
              ></div>
            </div>
            <span class="stat__num">{{ session.san }}/{{ session.maxSAN }}</span>
          </div>

          <!-- Insanity Badge -->
          <span
            class="insanity-badge"
            :class="{ 'insanity-badge--active': hasInsanity }"
          >
            {{ session.indefInsanity ? '不定疯狂' : session.tempInsanity ? '临时疯狂' : '清醒' }}
          </span>
          <button class="kp-toggle-btn" @click="charEditorVisible = true" title="编辑角色">📝</button>
          <button class="kp-toggle-btn" @click="kpVisible = !kpVisible" :class="{ 'kp-toggle-btn--active': kpVisible }" title="KP 控制台">📋</button>
          <button class="kp-toggle-btn" @click="moduleEditorVisible = !moduleEditorVisible" :class="{ 'kp-toggle-btn--active': moduleEditorVisible }" title="模组编辑器">📦</button>
        </div>
      </header>

      <!-- ── Combat Grid ── -->
      <CombatGrid
        v-if="companions.length > 0 || npcs.length > 0 || monsters.length > 0"
        :player="session"
        :companions="companions"
        :npcs="npcs"
        :monsters="monsters"
        @inspect="(e) => { if (e._type === 'companion') { const found = companions.find(c => c.id === e._id); if (found) openCharCard(found) } }"
      />

      <!-- ── Companion Roster ── -->
      <section class="companion-panel" :class="{ 'companion-panel--collapsed': !companionsExpanded }">
        <header class="companion-panel__header" @click="companionsExpanded = !companionsExpanded">
          <h2 class="companion-panel__title">同伴</h2>
          <span class="companion-panel__count" v-if="companions.length">{{ companions.length }}</span>
          <span class="companion-panel__toggle" aria-hidden="true">{{ companionsExpanded ? '▾' : '▸' }}</span>
        </header>

        <!-- Expanded content -->
        <div v-if="companionsExpanded" class="companion-panel__body">
          <!-- Empty state -->
          <div v-if="companions.length === 0" class="companion-panel__empty">
            <p class="companion-panel__empty-text">
              当前没有同伴。
            </p>
            <p class="companion-panel__empty-hint">
              输入「邀请 希尔妲」来招募。
            </p>
          </div>

          <!-- Companion cards -->
          <div
            v-for="c in companions"
            :key="c.id"
            class="companion-card"
            @click="openCharCard(c)"
          >
            <!-- Header: Name + Resolve badge + Control badge -->
            <div class="companion-card__header">
              <span class="companion-card__name">{{ c.name }}</span>
              <span class="companion-card__badges">
                <span
                  v-if="c.resolveState && c.resolveState !== 'normal'"
                  class="companion-card__badge"
                  :class="'companion-card__badge--' + c.resolveState"
                >
                  {{ c.resolveState === 'steadfast' ? '✦ 坚定' : c.resolveState === 'afflicted' ? '☠ 恐慌' : '🔥 疯狂' }}
                </span>
                <span
                  class="companion-card__badge"
                  :class="c.control === 'auto' ? 'companion-card__badge--ai' : 'companion-card__badge--player'"
                >
                  {{ c.control === 'auto' ? '🤖 AI' : '🎮 玩家' }}
                </span>
              </span>
            </div>

            <!-- HP bar -->
            <div class="companion-card__stat">
              <span class="companion-card__stat-label">HP</span>
              <div class="companion-card__track companion-card__track--hp">
                <div
                  class="companion-card__fill"
                  :style="{
                    width: c.maxHp > 0 ? Math.max(0, Math.round((c.hp / c.maxHp) * 100)) + '%' : '0%',
                    background: (c.maxHp > 0 && (c.hp / c.maxHp) <= 0.25) ? 'var(--color-hp-critical)'
                      : (c.maxHp > 0 && (c.hp / c.maxHp) <= 0.5) ? 'var(--color-hp-warning)'
                      : 'var(--color-hp)'
                  }"
                ></div>
              </div>
              <span class="companion-card__stat-num">{{ c.hp }}/{{ c.maxHp }}</span>
            </div>

            <!-- Morale bar -->
            <div class="companion-card__stat">
              <span class="companion-card__stat-label">士气</span>
              <div class="companion-card__track companion-card__track--morale">
                <div
                  class="companion-card__fill"
                  :style="{
                    width: Math.max(0, Math.min(100, (c.morale / 10) * 100)) + '%',
                    background: c.morale <= 2.5 ? 'var(--color-san-critical)'
                      : c.morale <= 5 ? 'var(--color-san-warning)'
                      : 'var(--color-san)'
                  }"
                ></div>
              </div>
              <span class="companion-card__stat-num">{{ c.morale }}/10</span>
            </div>

            <!-- Info row: Position + Behavior -->
            <div class="companion-card__info-row">
              <span class="companion-card__info-tag">{{ positionLabel(c.position) }}</span>
              <span class="companion-card__info-tag">{{ behaviorLabel(c.behavior) }}</span>
              <span class="companion-card__info-tag companion-card__info-tag--weapon" v-if="c.inventory?.length">
                {{ c.inventory[0] }}
              </span>
            </div>

            <!-- Chat + Control buttons -->
            <div class="companion-card__actions">
              <button class="companion-card__action-btn" :disabled="loading" @click="chatNpc(c)">💬</button>
              <button
                class="companion-card__control-btn"
                :class="c.control === 'auto' ? 'companion-card__control-btn--takeover' : 'companion-card__control-btn--auto'"
                :disabled="loading"
                @click="toggleControl(c)"
              >
                {{ c.control === 'auto' ? '🎮 接管' : '🤖 自动' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Narrative Log ── -->
      <main class="narrative-log" ref="logEl">
        <div class="narrative-log__inner">
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="message"
            :class="'message--' + msg.type"
          >
            <span v-if="msg.speaker" class="message__speaker">{{ msg.speaker }}</span>
            <p class="message__content">{{ msg.content }}</p>
          </div>

          <!-- Loading indicator -->
          <div v-if="loading" class="message message--loading">
            <span class="message__dots">
              <span class="message__dot">·</span>
              <span class="message__dot">·</span>
              <span class="message__dot">·</span>
            </span>
            <p class="message__content">思考中<span class="message__ellipsis">…</span></p>
          </div>
        </div>
      </main>

      <!-- ── Death Overlay ── -->
      <div v-if="session.dead" class="death-overlay">
        <div class="death-overlay__inner">
          <div class="death-overlay__skull">💀</div>
          <p class="death-overlay__title">你已死亡</p>
          <p class="death-overlay__desc">调查在此终止。<br>你的故事结束了——但世界仍在运转。</p>
          <button class="btn btn--primary" @click="newGame">开始新游戏</button>
        </div>
      </div>

      <!-- ── Input Area ── -->
      <footer class="input-area" :class="{ 'input-area--dead': session.dead }">
        <form
          class="input-area__form"
          @submit.prevent="() => { submitAction(inputValue); inputValue = ''; focusInput() }"
        >
          <select v-if="pcList.length > 1" v-model.number="activePc" class="input-area__pc-select" :disabled="loading || session.dead">
            <option v-for="(pc, i) in pcList" :key="pc.id" :value="i">{{ pc.name }}</option>
          </select>
          <input
            ref="inputRef"
            v-model="inputValue"
            type="text"
            class="input-area__field"
            :disabled="loading || session.dead"
            :placeholder="session.dead ? '旅程已结束……' : (loading ? '守秘人正在思考……' : '输入你的行动……')"
            autocomplete="off"
            @keydown="onInputKeydown"
          />
          <button
            type="submit"
            class="btn btn--send"
            :disabled="loading || !inputValue.trim() || session.dead"
          >
            发送
          </button>
        </form>
        <button
          class="input-area__restart"
          @click="newGame"
          :disabled="loading"
        >
          新游戏
        </button>
      </footer>

      <!-- KP Dashboard -->
      <KPDashboard
        v-if="kpVisible"
        :session-id="session.id"
        @close="kpVisible = false"
      />
      <ModuleEditor
        v-if="moduleEditorVisible"
        @close="moduleEditorVisible = false"
      />
      <CharacterEditor
        v-if="charEditorVisible && session.id"
        :session-id="session.id"
        :character="{ name: session.playerName, archetype: session.archetype, hp: session.hp, maxHp: session.maxHp, luck: 60, skills: {} }"
        :sanity="{ currentSAN: session.san, maxSAN: session.maxSAN }"
        @close="charEditorVisible = false"
      />
      <NpcChat
        v-if="npcChatVisible && chattingNpc"
        :session-id="session.id"
        :npc="chattingNpc"
        @close="npcChatVisible = false"
      />
    </div>

    <!-- ═══════════ CHARACTER CARD MODAL ═══════════ -->
    <Teleport to="body">
      <div
        v-if="showCharCard"
        class="char-card-overlay"
        @click.self="closeCharCard"
      >
        <div class="char-card-modal" @click.stop>
          <!-- Close button -->
          <button class="char-card-modal__close" @click="closeCharCard" aria-label="关闭">✕</button>

          <!-- Name + Motivation -->
          <h2 class="char-card-modal__name">{{ selectedCompanion?.name }}</h2>
          <p v-if="selectedCompanion?.motivation" class="char-card-modal__motivation">
            {{ selectedCompanion.motivation }}
          </p>

          <!-- HP bar -->
          <div class="char-card-modal__section">
            <div class="char-card-modal__stat">
              <span class="char-card-modal__stat-label">HP</span>
              <div class="char-card-modal__track">
                <div
                  class="char-card-modal__fill"
                  :style="{
                    width: selectedCompanion && selectedCompanion.maxHp > 0
                      ? Math.max(0, Math.round((selectedCompanion.hp / selectedCompanion.maxHp) * 100)) + '%'
                      : '0%',
                    background: selectedCompanion && selectedCompanion.maxHp > 0 && (selectedCompanion.hp / selectedCompanion.maxHp) <= 0.25
                      ? 'var(--color-hp-critical)'
                      : selectedCompanion && selectedCompanion.maxHp > 0 && (selectedCompanion.hp / selectedCompanion.maxHp) <= 0.5
                        ? 'var(--color-hp-warning)'
                        : 'var(--color-hp)',
                  }"
                ></div>
              </div>
              <span class="char-card-modal__stat-num">
                {{ selectedCompanion?.hp }}/{{ selectedCompanion?.maxHp }}
              </span>
            </div>
          </div>

          <!-- AC (D&D only — CoC 没有护甲等级) -->
          <div class="char-card-modal__section" v-if="session.ruleset === 'dnd5e'">
            <div class="char-card-modal__ac-row">
              <span class="char-card-modal__ac-label">AC</span>
              <span class="char-card-modal__ac-value">{{ selectedCompanion?.ac ?? '—' }}</span>
            </div>
          </div>
          <!-- CoC: 显示闪避技能值 -->
          <div class="char-card-modal__section" v-else-if="selectedCompanion?.skills?.dodge">
            <div class="char-card-modal__ac-row">
              <span class="char-card-modal__ac-label">闪避</span>
              <span class="char-card-modal__ac-value">{{ selectedCompanion.skills.dodge }}%</span>
            </div>
          </div>

          <!-- Morale bar -->
          <div class="char-card-modal__section">
            <div class="char-card-modal__stat">
              <span class="char-card-modal__stat-label">士气</span>
              <div class="char-card-modal__track">
                <div
                  class="char-card-modal__fill"
                  :style="{
                    width: selectedCompanion ? Math.max(0, Math.min(100, (selectedCompanion.morale / 10) * 100)) + '%' : '0%',
                    background: selectedCompanion && selectedCompanion.morale <= 2.5
                      ? 'var(--color-san-critical)'
                      : selectedCompanion && selectedCompanion.morale <= 5
                        ? 'var(--color-san-warning)'
                        : 'var(--color-san)',
                  }"
                ></div>
              </div>
              <span class="char-card-modal__stat-num">
                {{ selectedCompanion?.morale }}/10
              </span>
            </div>
          </div>

          <!-- ── Traits ── -->
          <div class="char-card-modal__section" v-if="selectedCompanion?.traits">
            <h3 class="char-card-modal__subhead">性格特质</h3>
            <div
              v-for="(val, key) in selectedCompanion.traits"
              :key="key"
              class="char-card-modal__stat"
            >
              <span class="char-card-modal__stat-label">{{ traitNames[key] || key }}</span>
              <div class="char-card-modal__track">
                <div
                  class="char-card-modal__fill"
                  :style="{
                    width: Math.max(0, (val / 10) * 100) + '%',
                    background: traitColor(val),
                  }"
                ></div>
              </div>
              <span class="char-card-modal__stat-num">{{ val }}/10</span>
            </div>
          </div>

          <!-- ── Skills ── -->
          <div class="char-card-modal__section" v-if="selectedCompanion?.skills">
            <h3 class="char-card-modal__subhead">技能</h3>
            <div class="char-card-modal__skills">
              <span
                v-for="(val, key) in selectedCompanion.skills"
                :key="key"
                class="char-card-modal__skill-tag"
              >
                {{ skillNames[key] || key }} {{ val }}
              </span>
            </div>
          </div>

          <!-- ── Inventory ── -->
          <div class="char-card-modal__section" v-if="selectedCompanion?.inventory?.length">
            <h3 class="char-card-modal__subhead">装备</h3>
            <div class="char-card-modal__inventory">
              <span
                v-for="(item, idx) in selectedCompanion.inventory"
                :key="idx"
                class="char-card-modal__item-tag"
              >{{ item }}</span>
            </div>
          </div>

          <!-- ── Resolve / Behavior / Control ── -->
          <div class="char-card-modal__section char-card-modal__footer-row">
            <span class="char-card-modal__meta" v-if="selectedCompanion?.resolveState && selectedCompanion.resolveState !== 'normal'">
              意志：<strong :style="{ color: resolveStateColor(selectedCompanion.resolveState) }">{{ resolveStateLabel(selectedCompanion.resolveState) }}</strong>
            </span>
            <span class="char-card-modal__meta">
              行为：<strong>{{ behaviorLabel(selectedCompanion?.behavior) }}</strong>
            </span>
            <span class="char-card-modal__meta">
              控制：<strong>{{ selectedCompanion?.control === 'auto' ? 'AI' : '玩家' }}</strong>
            </span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style>
/* ── Global Google Fonts ── */
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
</style>

<style scoped>
/* ════════════════════════════════════════════════════════
   DESIGN SYSTEM TOKENS
   ════════════════════════════════════════════════════════ */
.trpg-app {
  /* ── Colors ── */
  --color-bg:            #0a0a14;
  --color-bg-elevated:   #0e1128;
  --color-bg-card:       #151b3a;
  --color-bg-input:      #1a2040;
  --color-gold:          #c9a96e;
  --color-gold-dim:      #8a7240;
  --color-gold-glow:     rgba(201, 169, 110, 0.12);
  --color-text:          #e0d6c2;
  --color-text-secondary:#8a8a9e;
  --color-text-muted:    #5a5a6e;
  --color-hp:            #c0392b;
  --color-hp-warning:    #d4a040;
  --color-hp-critical:   #e05555;
  --color-san:           #7b4fa0;
  --color-san-warning:   #b07ccc;
  --color-san-critical:  #c471ed;
  --color-narration:     #d4c5a9;
  --color-dialogue:      #7ecb76;
  --color-system:        #e05555;
  --color-action:        #d4a040;
  --color-border:        rgba(201, 169, 110, 0.12);
  --color-border-active: rgba(201, 169, 110, 0.25);

  /* ── Spacing (8px base) ── */
  --space-xs:  4px;
  --space-sm:  8px;
  --space-md:  16px;
  --space-lg:  24px;
  --space-xl:  32px;
  --space-2xl: 48px;

  /* ── Typography ── */
  --font-display: 'Cinzel', Georgia, serif;
  --font-body:    'Crimson Text', Georgia, serif;

  /* ── Radii ── */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* ── Shadows ── */
  --shadow-glow: 0 0 24px var(--color-gold-glow);
  --shadow-card: 0 4px 24px rgba(0, 0, 0, 0.45);
  --shadow-input: 0 0 12px rgba(201, 169, 110, 0.06);

  /* ── Transitions ── */
  --ease-out: cubic-bezier(0.33, 1, 0.68, 1);
  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --duration-slow: 600ms;
}

/* ════════════════════════════════════════════════════════
   RESET & BASE
   ════════════════════════════════════════════════════════ */
.trpg-app {
  min-height: 100dvh;
  background:
    radial-gradient(ellipse 80% 60% at 50% 20%, rgba(21, 27, 58, 0.5), transparent),
    radial-gradient(ellipse 40% 40% at 80% 80%, rgba(123, 79, 160, 0.06), transparent),
    var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 1.05rem;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  position: relative;
  overflow: hidden;
}

/* ════════════════════════════════════════════════════════
   BUTTONS
   ════════════════════════════════════════════════════════ */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  font-family: var(--font-display);
  font-size: 0.95rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    opacity var(--duration-fast) var(--ease-out);
  outline: none;
}
.btn:focus-visible {
  box-shadow: 0 0 0 2px var(--color-gold);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn--primary {
  background: linear-gradient(135deg, var(--color-gold), var(--color-gold-dim));
  color: var(--color-bg);
  border-color: var(--color-gold);
  padding: var(--space-md) var(--space-2xl);
  font-size: 1.1rem;
  box-shadow: var(--shadow-glow);
}
.btn--primary:hover:not(:disabled) {
  box-shadow: 0 0 32px rgba(201, 169, 110, 0.25);
  transform: translateY(-1px);
}

.btn--send {
  background: var(--color-gold);
  color: var(--color-bg);
  border-color: var(--color-gold);
  padding: var(--space-sm) var(--space-lg);
  font-weight: 700;
  flex-shrink: 0;
}
.btn--send:hover:not(:disabled) {
  background: #d4b87a;
}

.btn__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid transparent;
  border-top-color: var(--color-bg);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ════════════════════════════════════════════════════════
   START SCREEN
   ════════════════════════════════════════════════════════ */
.start-screen {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: var(--space-lg);
}

.start-screen__inner {
  text-align: center;
  max-width: 480px;
  position: relative;
  z-index: 1;
}

.start-screen__title {
  font-family: var(--font-display);
  font-size: clamp(2.5rem, 8vw, 4.5rem);
  font-weight: 700;
  color: var(--color-gold);
  letter-spacing: 0.12em;
  text-shadow: 0 0 40px rgba(201, 169, 110, 0.3);
  margin: 0 0 var(--space-sm);
  line-height: 1.2;
}

.start-screen__subtitle {
  font-size: 1.15rem;
  color: var(--color-text-secondary);
  letter-spacing: 0.2em;
  margin: 0 0 var(--space-xl);
  font-family: var(--font-body);
}

.start-screen__desc {
  color: var(--color-text-muted);
  font-size: 1rem;
  line-height: 1.8;
  margin: 0 0 var(--space-2xl);
}

.start-screen__error {
  color: var(--color-system);
  margin-top: var(--space-md);
  font-size: 0.9rem;
}

/* Character creation form */
.char-creation {
  margin: 0 auto var(--space-xl);
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.char-creation__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.char-creation__label {
  font-family: var(--font-display);
  font-size: 0.85rem;
  color: var(--color-gold-dim);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.char-creation__input,
.char-creation__select {
  background: var(--color-bg-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 1rem;
  padding: var(--space-sm) var(--space-md);
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.char-creation__input:focus,
.char-creation__select:focus {
  border-color: var(--color-gold);
  box-shadow: var(--shadow-input);
}
.char-creation__input::placeholder {
  color: var(--color-text-muted);
}
.char-creation__select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238a7240' stroke-width='1.5' fill='none'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;
}
.char-creation__select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.char-creation__hint {
  margin: var(--space-xs) 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
  line-height: 1.4;
  min-height: 1.2em;
}

@media (max-width: 480px) {
  .char-creation {
    max-width: 100%;
  }
}

/* Ornamental dividers */
.start-screen__ornament {
  width: 120px;
  height: 1px;
  margin: var(--space-xl) auto;
  background: linear-gradient(
    90deg,
    transparent,
    var(--color-gold-dim),
    var(--color-gold),
    var(--color-gold-dim),
    transparent
  );
}
.start-screen__ornament.top {
  margin-top: 0;
  margin-bottom: var(--space-xl);
}
.start-screen__ornament.bottom {
  margin-top: var(--space-xl);
  margin-bottom: 0;
}

/* Noise overlay texture */
.start-screen__noise {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* ════════════════════════════════════════════════════════
   GAME SCREEN LAYOUT
   ════════════════════════════════════════════════════════ */
.game-screen {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-width: 780px;
  margin: 0 auto;
  position: relative;
}

/* ════════════════════════════════════════════════════════
   STATUS BAR
   ════════════════════════════════════════════════════════ */
.status-bar {
  flex-shrink: 0;
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
  padding: var(--space-sm) var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.status-bar__row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.status-bar__label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-family: var(--font-display);
}

.status-bar__value {
  font-size: 0.9rem;
  color: var(--color-text);
  margin-left: var(--space-xs);
}
.status-bar__value--mono {
  font-family: 'Courier New', monospace;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.status-bar__info {
  display: flex;
  align-items: baseline;
  gap: var(--space-xs);
}
.status-bar__info--scene {
  flex: 1;
  min-width: 0;
}
.status-bar__info--scene .status-bar__value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Stats row (HP, SAN, Insanity) */
.status-bar__stats {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.stat {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
}

.stat__label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  font-family: var(--font-display);
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.stat__track {
  width: 80px;
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
  flex-shrink: 0;
}

.stat__fill {
  height: 100%;
  border-radius: 3px;
  transition: width var(--duration-slow) var(--ease-out);
  min-width: 0;
}

.stat__num {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

/* Insanity badge */
.insanity-badge {
  font-size: 0.72rem;
  padding: 2px var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-family: var(--font-display);
  letter-spacing: 0.04em;
  transition:
    color var(--duration-normal) var(--ease-out),
    border-color var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out);
}
.insanity-badge--active {
  color: var(--color-san-critical);
  border-color: rgba(196, 113, 237, 0.35);
  box-shadow: 0 0 8px rgba(196, 113, 237, 0.15);
}

/* ════════════════════════════════════════════════════════
   NARRATIVE LOG
   ════════════════════════════════════════════════════════ */
.narrative-log {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--space-md) var(--space-md) var(--space-xs);
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
}
.narrative-log::-webkit-scrollbar {
  width: 4px;
}
.narrative-log::-webkit-scrollbar-track {
  background: transparent;
}
.narrative-log::-webkit-scrollbar-thumb {
  background: rgba(201, 169, 110, 0.2);
  border-radius: 2px;
}
.narrative-log::-webkit-scrollbar-thumb:hover {
  background: rgba(201, 169, 110, 0.35);
}

.narrative-log__inner {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding-bottom: var(--space-sm);
}

/* ════════════════════════════════════════════════════════
   MESSAGES
   ════════════════════════════════════════════════════════ */
.message {
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
  background: var(--color-bg-card);
  animation: messageIn var(--duration-normal) var(--ease-out) both;
  position: relative;
}

@keyframes messageIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message__speaker {
  display: block;
  font-family: var(--font-display);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: var(--space-xs);
  color: var(--color-gold-dim);
}

.message__content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.8;
}

/* ── Message type variants ── */
.message--narration {
  background: transparent;
  border: none;
  padding: var(--space-md) 0;
  border-bottom: 1px solid var(--color-border);
  border-radius: 0;
}
.message--narration .message__speaker {
  color: var(--color-narration);
}
.message--narration .message__content {
  color: var(--color-narration);
  font-style: italic;
  font-size: 1.05rem;
}

.message--dialogue {
  border-left: 3px solid var(--color-dialogue);
  background: rgba(126, 203, 118, 0.04);
}
.message--dialogue .message__speaker {
  color: var(--color-dialogue);
}
.message--dialogue .message__content {
  color: var(--color-dialogue);
}

.message--action {
  border-left: 3px solid var(--color-action);
  background: rgba(212, 160, 64, 0.04);
  margin-left: var(--space-md);
}
.message--action .message__speaker {
  color: var(--color-action);
}
.message--action .message__content {
  color: var(--color-action);
}

.message--system {
  border-left: 3px solid var(--color-system);
  background: rgba(224, 85, 85, 0.05);
}
.message--system .message__speaker {
  color: var(--color-system);
}
.message--system .message__content {
  color: var(--color-system);
  font-size: 0.95rem;
}

/* Dice roll */
.message--roll {
  border-left: 3px solid #c9a96e;
  background: rgba(201, 169, 110, 0.06);
  margin-left: var(--space-md);
}
.message--roll .message__speaker {
  color: #c9a96e;
  font-size: 1.1rem;
}
.message--roll .message__content {
  color: #e0d0b0;
  font-family: 'Courier New', monospace;
}

/* Loading message */
.message--loading {
  background: transparent;
  border: 1px dashed var(--color-border-active);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md);
  animation: messageIn var(--duration-fast) var(--ease-out) both, pulse-border 2s ease-in-out infinite;
}
.message--loading .message__content {
  color: var(--color-text-muted);
  font-style: italic;
}

@keyframes pulse-border {
  0%, 100% { border-color: var(--color-border); }
  50% { border-color: var(--color-border-active); }
}

.message__dots {
  display: flex;
  gap: 2px;
  font-size: 1.4rem;
  color: var(--color-gold-dim);
  line-height: 0;
}

.message__dot {
  animation: dotPulse 1.4s ease-in-out infinite;
}
.message__dot:nth-child(2) { animation-delay: 0.2s; }
.message__dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}

.message__ellipsis {
  animation: ellipsisBlink 1.4s steps(1, end) infinite;
}

@keyframes ellipsisBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* ════════════════════════════════════════════════════════
   DEATH OVERLAY
   ════════════════════════════════════════════════════════ */
.death-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.82);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 100;
  animation: death-fade 0.6s var(--ease-out) forwards;
}
@keyframes death-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.death-overlay__inner {
  text-align: center;
  padding: var(--space-xl) var(--space-lg);
  max-width: 340px;
}
.death-overlay__skull {
  font-size: 3.6rem;
  line-height: 1;
  margin-bottom: var(--space-md);
  filter: grayscale(0.3);
  animation: skull-pulse 2.4s ease-in-out infinite;
}
@keyframes skull-pulse {
  0%, 100% { opacity: 0.8; transform: scale(1); }
  50%      { opacity: 1;   transform: scale(1.06); }
}
.death-overlay__title {
  font-family: var(--font-display);
  font-size: 1.5rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text);
  margin-bottom: var(--space-sm);
}
.death-overlay__desc {
  font-family: var(--font-body);
  font-size: 0.88rem;
  color: var(--color-text-muted);
  line-height: 1.7;
  margin-bottom: var(--space-xl);
}

.input-area--dead {
  opacity: 0.35;
  pointer-events: none;
}

/* ════════════════════════════════════════════════════════
   INPUT AREA
   ════════════════════════════════════════════════════════ */
.input-area {
  flex-shrink: 0;
  padding: var(--space-sm) var(--space-md) var(--space-md);
  background: linear-gradient(180deg, transparent 0%, var(--color-bg) 20%);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.input-area__form {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.input-area__pc-select {
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.8rem;
  cursor: pointer;
  min-width: 60px;
  max-width: 100px;
  outline: none;
}
.input-area__pc-select:focus {
  border-color: var(--color-gold-dim);
}

.input-area__field {
  flex: 1;
  min-width: 0;
  padding: var(--space-sm) var(--space-md);
  background: var(--color-bg-input);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.5;
  outline: none;
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}
.input-area__field::placeholder {
  color: var(--color-text-muted);
  font-style: italic;
}
.input-area__field:focus {
  border-color: var(--color-gold-dim);
  box-shadow: var(--shadow-input);
}
.input-area__field:disabled {
  opacity: 0.5;
}

.input-area__restart {
  align-self: center;
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-family: var(--font-display);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  transition: color var(--duration-fast) var(--ease-out);
}
.input-area__restart:hover:not(:disabled) {
  color: var(--color-gold);
}
.input-area__restart:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ════════════════════════════════════════════════════════
   COMPANION ROSTER PANEL
   ════════════════════════════════════════════════════════ */
.companion-panel {
  flex-shrink: 0;
  background: var(--color-bg-elevated);
  border-bottom: 1px solid var(--color-border);
  transition: max-height var(--duration-slow) var(--ease-out);
  overflow: hidden;
}

.companion-panel__header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  cursor: pointer;
  user-select: none;
  transition: background var(--duration-fast) var(--ease-out);
}
.companion-panel__header:hover {
  background: rgba(201, 169, 110, 0.04);
}

.companion-panel__title {
  font-family: var(--font-display);
  font-size: 0.8rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-gold-dim);
  margin: 0;
  font-weight: 400;
}

.companion-panel__count {
  font-family: var(--font-display);
  font-size: 0.7rem;
  color: var(--color-gold);
  background: rgba(201, 169, 110, 0.12);
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.companion-panel__toggle {
  margin-left: auto;
  color: var(--color-gold-dim);
  font-size: 0.75rem;
  transition: transform var(--duration-fast) var(--ease-out);
}

/* ── Body ── */
.companion-panel__body {
  display: flex;
  gap: var(--space-sm);
  padding: 0 var(--space-md) var(--space-sm);
  overflow-x: auto;
  overflow-y: hidden;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
}
.companion-panel__body::-webkit-scrollbar {
  height: 3px;
}
.companion-panel__body::-webkit-scrollbar-track {
  background: transparent;
}
.companion-panel__body::-webkit-scrollbar-thumb {
  background: rgba(201, 169, 110, 0.2);
  border-radius: 2px;
}

/* ── Empty state ── */
.companion-panel__empty {
  width: 100%;
  text-align: center;
  padding: var(--space-md) 0;
}
.companion-panel__empty-text {
  margin: 0;
  font-size: 0.88rem;
  color: var(--color-text-muted);
  font-family: var(--font-body);
}
.companion-panel__empty-hint {
  margin: var(--space-xs) 0 0;
  font-size: 0.78rem;
  color: var(--color-text-muted);
  opacity: 0.6;
  font-style: italic;
}

/* ── Collapsed state ── */
.companion-panel--collapsed .companion-panel__body {
  display: none;
}

/* ── Card ── */
.companion-card {
  flex: 0 0 200px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  animation: messageIn var(--duration-normal) var(--ease-out) both;
  box-shadow: var(--shadow-card);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out);
}
.companion-card:hover {
  border-color: var(--color-border-active);
}

.companion-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-xs);
  margin-bottom: 2px;
}

.companion-card__name {
  font-family: var(--font-display);
  font-size: 0.85rem;
  color: var(--color-gold);
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.companion-card__badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.companion-card__badge {
  font-size: 0.62rem;
  padding: 1px var(--space-xs);
  border-radius: var(--radius-sm);
  font-family: var(--font-display);
  letter-spacing: 0.06em;
  white-space: nowrap;
  flex-shrink: 0;
  text-transform: uppercase;
}
.companion-card__badge--ai {
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}
.companion-card__badge--player {
  color: var(--color-gold);
  border: 1px solid rgba(201, 169, 110, 0.3);
  background: rgba(201, 169, 110, 0.08);
}
.companion-card__badge--steadfast {
  color: #8fbc8f;
  border: 1px solid rgba(143, 188, 143, 0.3);
  background: rgba(143, 188, 143, 0.08);
}
.companion-card__badge--afflicted {
  color: #dda0dd;
  border: 1px solid rgba(221, 160, 221, 0.3);
  background: rgba(221, 160, 221, 0.08);
}
.companion-card__badge--berserk {
  color: #ff6b6b;
  border: 1px solid rgba(255, 107, 107, 0.3);
  background: rgba(255, 107, 107, 0.08);
  animation: pulse-berserk 1s ease-in-out infinite;
}
@keyframes pulse-berserk {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ── Card stat row ── */
.companion-card__stat {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.companion-card__stat-label {
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  font-family: var(--font-display);
  color: var(--color-text-muted);
  flex-shrink: 0;
  min-width: 2em;
}

.companion-card__track {
  flex: 1;
  height: 5px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}
.companion-card__track--hp { /* scoped */ }
.companion-card__track--morale { /* scoped */ }

.companion-card__fill {
  height: 100%;
  border-radius: 3px;
  transition: width var(--duration-slow) var(--ease-out);
  min-width: 0;
}

.companion-card__stat-num {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Info row ── */
.companion-card__info-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.companion-card__info-tag {
  font-size: 0.65rem;
  padding: 1px var(--space-xs);
  border-radius: 3px;
  background: rgba(201, 169, 110, 0.08);
  color: var(--color-gold-dim);
  border: 1px solid rgba(201, 169, 110, 0.12);
  font-family: var(--font-display);
  letter-spacing: 0.04em;
}
.companion-card__info-tag--weapon {
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--color-border);
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Control toggle button ── */
.companion-card__control-btn {
  flex: 1;
  padding: 5px var(--space-sm);
  font-family: var(--font-display);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    opacity var(--duration-fast) var(--ease-out);
  margin-top: 2px;
}
.companion-card__control-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.companion-card__control-btn--takeover {
  background: linear-gradient(135deg, rgba(201, 169, 110, 0.15), rgba(201, 169, 110, 0.06));
  border-color: rgba(201, 169, 110, 0.25);
  color: var(--color-gold);
}
.companion-card__control-btn--takeover:hover:not(:disabled) {
  background: rgba(201, 169, 110, 0.22);
  border-color: rgba(201, 169, 110, 0.4);
}
.companion-card__control-btn--auto {
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--color-border);
  color: var(--color-text-secondary);
}
.companion-card__control-btn--auto:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--color-border-active);
  color: var(--color-text);
}

/* ════════════════════════════════════════════════════════
   CHARACTER CARD MODAL
   ════════════════════════════════════════════════════════ */
.char-card-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 5, 15, 0.82);
  backdrop-filter: blur(4px);
  animation: charCardFadeIn var(--duration-normal) var(--ease-out);
  padding: var(--space-md);
}

@keyframes charCardFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.char-card-modal {
  position: relative;
  width: 100%;
  max-width: 380px;
  max-height: min(90vh, 700px);
  overflow-y: auto;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-active);
  border-radius: var(--radius-lg);
  box-shadow:
    0 0 48px rgba(201, 169, 110, 0.1),
    0 8px 48px rgba(0, 0, 0, 0.6);
  padding: var(--space-lg) var(--space-lg) var(--space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  animation: charCardSlideUp var(--duration-slow) var(--ease-out);
  scrollbar-width: thin;
  scrollbar-color: rgba(201, 169, 110, 0.2) transparent;
}

.char-card-modal::-webkit-scrollbar {
  width: 5px;
}
.char-card-modal::-webkit-scrollbar-track {
  background: transparent;
}
.char-card-modal::-webkit-scrollbar-thumb {
  background: rgba(201, 169, 110, 0.25);
  border-radius: 3px;
}

@keyframes charCardSlideUp {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* ── Close button ── */
.char-card-modal__close {
  position: absolute;
  top: var(--space-sm);
  right: var(--space-sm);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  font-size: 1rem;
  cursor: pointer;
  transition:
    color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
  line-height: 1;
}
.char-card-modal__close:hover {
  color: var(--color-gold);
  border-color: var(--color-border-active);
  background: rgba(201, 169, 110, 0.08);
}

/* ── Name ── */
.char-card-modal__name {
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--color-gold);
  letter-spacing: 0.06em;
  margin: 0;
  padding-right: 36px; /* space for close button */
  line-height: 1.3;
}

/* ── Motivation ── */
.char-card-modal__motivation {
  margin: 0;
  font-family: var(--font-body);
  font-size: 0.9rem;
  font-style: italic;
  color: var(--color-text-muted);
  line-height: 1.5;
}

/* ── Section ── */
.char-card-modal__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.char-card-modal__subhead {
  font-family: var(--font-display);
  font-size: 0.7rem;
  font-weight: 400;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-gold-dim);
  margin: 0;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--color-border);
}

/* ── Stat row (HP / Morale / Traits) ── */
.char-card-modal__stat {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.char-card-modal__stat-label {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  font-family: var(--font-display);
  color: var(--color-text-muted);
  min-width: 4em;
  flex-shrink: 0;
}

.char-card-modal__track {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}

.char-card-modal__fill {
  height: 100%;
  border-radius: 3px;
  transition: width var(--duration-slow) var(--ease-out);
  min-width: 0;
}

.char-card-modal__stat-num {
  font-size: 0.72rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 3em;
  text-align: right;
}

/* ── AC row ── */
.char-card-modal__ac-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.char-card-modal__ac-label {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  font-family: var(--font-display);
  color: var(--color-text-muted);
  min-width: 4em;
}

.char-card-modal__ac-value {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-sm);
  min-width: 3em;
  text-align: center;
}

/* ── Skills ── */
.char-card-modal__skills {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.char-card-modal__skill-tag {
  font-size: 0.72rem;
  font-family: var(--font-display);
  letter-spacing: 0.04em;
  padding: 2px var(--space-sm);
  border-radius: var(--radius-sm);
  background: rgba(201, 169, 110, 0.08);
  border: 1px solid rgba(201, 169, 110, 0.15);
  color: var(--color-gold-dim);
  white-space: nowrap;
}

/* ── Inventory ── */
.char-card-modal__inventory {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.char-card-modal__item-tag {
  font-size: 0.72rem;
  font-family: var(--font-display);
  letter-spacing: 0.04em;
  padding: 2px var(--space-sm);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* ── Footer row ── */
.char-card-modal__footer-row {
  flex-direction: row;
  justify-content: space-between;
  padding-top: var(--space-sm);
  border-top: 1px solid var(--color-border);
  margin-top: var(--space-xs);
}

.char-card-modal__meta {
  font-size: 0.72rem;
  font-family: var(--font-display);
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}
.char-card-modal__meta strong {
  color: var(--color-gold);
  font-weight: 600;
}

/* ════════════════════════════════════════════════════════
   RESPONSIVE — Mobile (320px+)
   ════════════════════════════════════════════════════════ */
@media (max-width: 480px) {
  .status-bar__row {
    gap: var(--space-sm);
  }
  .status-bar__value {
    font-size: 0.82rem;
  }
  .status-bar__info--scene .status-bar__value {
    max-width: 100px;
  }

  .status-bar__stats {
    gap: var(--space-sm);
  }

  .stat__track {
    width: 52px;
    height: 5px;
  }
  .stat__num {
    font-size: 0.72rem;
  }

  .narrative-log {
    padding: var(--space-sm);
  }

  .message {
    padding: var(--space-sm);
  }
  .message--narration {
    padding: var(--space-sm) 0;
  }
  .message--action {
    margin-left: var(--space-sm);
  }

  .input-area {
    padding: var(--space-xs) var(--space-sm) var(--space-sm);
    gap: var(--space-xs);
  }
  .input-area__field {
    padding: var(--space-sm);
    font-size: 0.95rem;
  }
  .btn--send {
    padding: var(--space-sm) var(--space-md);
    font-size: 0.85rem;
  }

  .start-screen__title {
    font-size: 2.2rem;
  }
  .start-screen__desc {
    font-size: 0.9rem;
  }
  .btn--primary {
    padding: var(--space-md) var(--space-xl);
    font-size: 1rem;
  }

  /* Companion panel — mobile */
  .companion-panel__header {
    padding: var(--space-xs) var(--space-sm);
  }
  .companion-panel__body {
    padding: 0 var(--space-sm) var(--space-xs);
    gap: var(--space-xs);
  }
  .companion-card {
    flex: 0 0 170px;
    padding: var(--space-xs) var(--space-sm);
    gap: 4px;
  }
  .companion-card__name {
    font-size: 0.78rem;
  }
.companion-card__actions {
  display: flex;
  gap: 4px;
  width: 100%;
}
.companion-card__action-btn {
  padding: 5px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
  line-height: 1;
}
.companion-card__action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text);
}
.companion-card__control-btn {
    font-size: 0.65rem;
    padding: 4px var(--space-xs);
  }
}

/* ── Tall narrow screens ── */
@media (min-width: 481px) and (max-width: 780px) {
  .game-screen {
    max-width: 100%;
  }
}

/* ── Desktop ── */
@media (min-width: 781px) {
  .game-screen {
    border-left: 1px solid var(--color-border);
    border-right: 1px solid var(--color-border);
  }
  .narrative-log {
    padding: var(--space-lg);
  }
  .input-area {
    padding: var(--space-sm) var(--space-lg) var(--space-lg);
  }
}
.kp-toggle-btn {
  background: transparent; border: 1px solid var(--color-border); color: #888;
  border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 16px;
  margin-left: 4px; transition: all 0.15s; line-height: 1;
}
.kp-toggle-btn:hover { color: #fff; border-color: #666; }
.kp-toggle-btn--active { color: #c9a96e; border-color: #c9a96e; }
</style>
