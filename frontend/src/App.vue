<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { createSession, sendAction, getArchetypes, getSuggestions, getHistory, listSessions, getSession } from './api.js'
import KPDashboard from './KPDashboard.vue'
import CombatGrid from './CombatGrid.vue'
import ModuleEditor from './ModuleEditor.vue'
import CharacterEditor from './CharacterEditor.vue'
import NpcChat from './NpcChat.vue'
import SceneOverview from './SceneOverview.vue'
import SettingsPanel from './SettingsPanel.vue'

// State
const screen = ref('start')
const loading = ref(false)
const error = ref(null)
const loadingSessions = ref(false)
const savedSessions = ref([])
const characterName = ref('')
const archetypes = ref([])
const selectedArchetype = ref('')
const archetypeLoading = ref(false)
const selectedRuleset = ref('coc7e')
const rulesetName = computed(() => selectedRuleset.value === 'coc7e' ? '克苏鲁的呼唤 7 版' : selectedRuleset.value === 'dnd5e' ? '龙与地下城 5 版' : selectedRuleset.value)

const session = reactive({
  id: '', round: 0, scene: '', playerName: '', archetype: '',
  ruleset: '', hp: 0, maxHp: 0, san: 0, maxSAN: 0,
  tempInsanity: false, indefInsanity: false, dead: false,
  luck: 0, creditRating: 0, skills: {}, inventory: [], weapons: [], attributes: {},
})
const messages = ref([])
const companions = ref([])
const npcs = ref([])
const monsters = ref([])
const companionsExpanded = ref(true)
const selectedCompanion = ref(null)
const kpVisible = ref(false)
const moduleEditorVisible = ref(false)
const settingsVisible = ref(false)
const charEditorVisible = ref(false)
const npcChatVisible = ref(false)
const chattingNpc = ref(null)
const pcList = ref([])
const activePc = ref(0)
const suggestions = ref([])
const logFilter = ref('all')
const filteredMessages = computed(() => logFilter.value === 'all' ? messages.value : messages.value.filter(m => m.type === logFilter.value))
const inputValue = ref('')
const history = ref([])
const historyIndex = ref(-1)
const logEl = ref(null)
const inputRef = ref(null)

const hpPercent = computed(() => session.maxHp > 0 ? Math.max(0, Math.round((session.hp / session.maxHp) * 100)) : 100)
const sanPercent = computed(() => session.maxSAN > 0 ? Math.max(0, Math.round((session.san / session.maxSAN) * 100)) : 100)
const hpColor = computed(() => hpPercent.value <= 25 ? '#ff4757' : hpPercent.value <= 50 ? '#ffa502' : '#2ed573')
const sanColor = computed(() => sanPercent.value <= 25 ? '#ff4757' : sanPercent.value <= 50 ? '#ffa502' : '#2ed573')
const hasInsanity = computed(() => session.tempInsanity || session.indefInsanity)
const showCharCard = computed(() => selectedCompanion.value !== null)

async function scrollToBottom() { await nextTick(); if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight }
watch(() => messages.value.length, () => scrollToBottom())

async function loadArchetypes(rs) {
  const ruleset = rs || selectedRuleset.value
  archetypeLoading.value = true
  try {
    const data = await getArchetypes(ruleset)
    archetypes.value = data.archetypes || []
    if (archetypes.value.length > 0) selectedArchetype.value = archetypes.value[0].id
  } catch {
    archetypes.value = selectedRuleset.value === 'dnd5e'
      ? [{ id: 'fighter', label: '战士', description: '精通所有武器和护甲的战斗专家' }, { id: 'rogue', label: '游荡者', description: '潜行、巧手、寻找并解除陷阱' }, { id: 'wizard', label: '法师', description: '研习奥术，掌握强大的法术' }, { id: 'cleric', label: '牧师', description: '侍奉神祇，治愈队友，驱散亡灵' }, { id: 'barbarian', label: '野蛮人', description: '狂怒之力，以血肉之躯冲垮敌人' }]
      : [{ id: 'investigator', label: '调查员', description: '追查真相的专业人士' }, { id: 'antiquarian', label: '古物学者', description: '研究古代文物和历史的专家' }]
    if (archetypes.value.length > 0) selectedArchetype.value = archetypes.value[0].id
  } finally { archetypeLoading.value = false }
}

async function loadSavedSessions() {
  loadingSessions.value = true
  try {
    const data = await listSessions()
    savedSessions.value = data.filter(s => s.id)
  } catch { savedSessions.value = [] }
  finally { loadingSessions.value = false }
}

loadArchetypes()
loadSavedSessions()
watch(selectedRuleset, (rs) => loadArchetypes(rs))

async function startGame() {
  loading.value = true; error.value = null
  try {
    const name = characterName.value.trim() || '调查员'
    const archetype = selectedArchetype.value || 'investigator'
    const data = await createSession({ ruleset: selectedRuleset.value, archetype, characterName: name })
    session.id = data.sessionId; session.round = data.summary?.round ?? 1; session.scene = data.summary?.scene ?? '序幕'
    session.playerName = data.characterName ?? name; session.archetype = data.summary?.archetype ?? ''
    session.ruleset = data.summary?.ruleset ?? 'CoC 7E'
    if (data.character) { session.hp = data.character.hp ?? 10; session.maxHp = data.character.maxHp ?? 10; session.san = data.character.attributes?.power ?? 50; session.maxSAN = data.character.attributes?.power ?? 50 }
    else { session.hp = 10; session.maxHp = 10; session.san = 55; session.maxSAN = 55 }
    pcList.value = [{ id: 'p1', name: data.characterName ?? name }]
    if (data.state?.companions) companions.value = data.state.companions
    if (data.state?.npcs) npcs.value = data.state.npcs
    if (data.state?.monsters) monsters.value = data.state.monsters
    messages.value = [{ id: Date.now(), type: 'narration', speaker: '守秘人', content: data.opening || '夜幕降临，故事由此开始……' }]
    screen.value = 'game'
  } catch (e) { error.value = e.message || '创建游戏失败' }
  finally { loading.value = false }
}

async function resumeSession(s) {
  loading.value = true
  try {
    session.id = s.id; session.round = s.round ?? 0; session.scene = s.scene ?? ''
    session.playerName = s.playerName ?? '调查员'; session.ruleset = s.ruleset ?? 'CoC 7E'
    try { const hist = await getHistory(s.id, 100); messages.value = (hist.messages || []).map((m) => ({ id: Date.now() + Math.random(), type: m.type || 'system', speaker: m.speaker || '', content: m.content || '' })) }
    catch { messages.value = [] }
    screen.value = 'game'
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}

async function submitAction(inputText, actingPc) {
  const trimmed = inputText.trim(); if (!trimmed || loading.value) return
  const speaker = (actingPc !== undefined ? pcList.value[actingPc]?.name : pcList.value[activePc.value]?.name) || session.playerName
  if (history.value.length === 0 || history.value[history.value.length - 1] !== trimmed) history.value.push(trimmed)
  historyIndex.value = -1; loading.value = true; error.value = null
  messages.value.push({ id: Date.now(), type: 'action', speaker, content: trimmed })
  try {
    const data = await sendAction(session.id, trimmed)
    if (data.narrative) messages.value.push({ id: Date.now() + 1, type: 'narration', speaker: '守秘人', content: data.narrative })
    if (data.events) { for (const ev of data.events) messages.value.push({ id: Date.now() + Math.random(), type: ev.type || 'system', speaker: ev.speaker || '系统', content: ev.content || '' }) }
    if (data.dice && data.dice.length > 0) { for (const d of data.dice) messages.value.push({ id: Date.now() + Math.random(), type: 'roll', speaker: '🎲', content: d.expr + ' = **' + d.total + '**' + (d.detail ? ' (' + d.detail + ')' : '') }) }
    if (data.rolls && data.rolls.length > 0) { for (const r of data.rolls) messages.value.push({ id: Date.now() + Math.random(), type: 'roll', speaker: '🎲', content: r.skill + ' d100=' + r.roll + ' (目标=' + r.target + '%) → ' + (r.success ? '成功' : '失败') }) }
    if (data.state) { session.round = data.state.round ?? session.round; session.scene = data.state.scene ?? session.scene }
    if (data.state?.player) { session.hp = data.state.player.hp ?? session.hp; session.maxHp = data.state.player.maxHp ?? session.maxHp }
    if (data.state?.companions) companions.value = data.state.companions
    if (data.state?.npcs) npcs.value = data.state.npcs
    if (data.state?.monsters) monsters.value = data.state.monsters
    if (data.dead) { session.hp = 0; session.dead = true }
    if (data.sanity) { session.san = data.sanity.currentSAN ?? session.san; session.maxSAN = data.sanity.maxSAN ?? session.maxSAN; session.tempInsanity = data.sanity.temporaryInsanity ?? false; session.indefInsanity = data.sanity.indefiniteInsanity ?? false }
  } catch (e) { messages.value.push({ id: Date.now() + 2, type: 'system', speaker: '系统', content: '错误：' + (e.message || '请求失败') }) }
  finally { loading.value = false; getSuggestions(session.id).then(s => suggestions.value = s).catch(() => {}) }
}

function newGame() {
  Object.assign(session, { id: '', round: 0, scene: '', playerName: '', archetype: '', ruleset: '', hp: 0, maxHp: 0, san: 0, maxSAN: 0, tempInsanity: false, indefInsanity: false, dead: false })
  messages.value = []; companions.value = []; npcs.value = []; monsters.value = []; history.value = []; historyIndex.value = -1
  error.value = null; screen.value = 'start'; kpVisible.value = false; moduleEditorVisible.value = false; settingsVisible.value = false; savedSessions.value = []; suggestions.value = []; pcList.value = []; activePc.value = 0; charEditorVisible.value = false; npcChatVisible.value = false
}

function toggleControl(companion) { if (!companion || loading.value) return; submitAction(companion.control === 'auto' ? '控制 ' + companion.name : '自动 ' + companion.name) }
function chatNpc(npc) { chattingNpc.value = npc; npcChatVisible.value = true }
function openCharCard(c) { selectedCompanion.value = c }
function closeCharCard() { selectedCompanion.value = null }
function focusInput() { nextTick(() => inputRef.value?.focus()) }

const traitNames = { courage: '勇气', aggression: '攻击性', caution: '谨慎', loyalty: '忠诚', cruelty: '残忍' }
const skillNames = { fight: '格斗', dodge: '闪避', heal: '治疗', stealth: '潜行', arcana: '奥术', perception: '察觉', survival: '生存', persuasion: '说服', intimidate: '威吓' }

function positionLabel(pos) { const map = { melee_range: '近战位', ranged: '远程位', far: '后排' }; return map[pos] || pos || '未知' }
function behaviorLabel(beh) { const map = { aggressive: '攻击', defensive: '防御', support: '支援' }; return map[beh] || beh || '未知' }
function resolveStateLabel(state) { return { steadfast: '坚定', afflicted: '恐慌', berserk: '疯狂' }[state] || state }
function resolveStateColor(state) { return { steadfast: '#8fbc8f', afflicted: '#dda0dd', berserk: '#ff6b6b' }[state] || '#ccc' }
function traitColor(val) { const opacity = Math.max(0.2, val / 10); return 'rgba(201, 169, 110, ' + opacity + ')' }

function onInputKeydown(e) {
  if (e.key === 'ArrowUp') { e.preventDefault(); if (history.value.length === 0) return; const newIdx = historyIndex.value === -1 ? history.value.length - 1 : Math.max(0, historyIndex.value - 1); historyIndex.value = newIdx; inputValue.value = history.value[newIdx] }
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (historyIndex.value === -1) return; const newIdx = historyIndex.value + 1; if (newIdx >= history.value.length) { historyIndex.value = -1; inputValue.value = '' } else { historyIndex.value = newIdx; inputValue.value = history.value[newIdx] } }
}
</script>

<template>
  <div class="trpg-app" :class="{ 'screen--game': screen === 'game' }">
    <div v-if="screen === 'start'" class="start-screen">
      <div class="start-screen__inner">
        <div class="start-screen__ornament top"></div>
        <h1 class="start-screen__title">AI TRPG</h1>
        <p class="start-screen__subtitle">人工智能桌面角色扮演游戏</p>
        <p class="start-screen__desc">选择你的规则集，创建角色，开始冒险。<br/>CoC 适合洛夫克拉夫特式恐怖，D&D 适合奇幻冒险。</p>
        <div class="char-creation">
          <div class="char-creation__field">
            <label class="char-creation__label">角色姓名</label>
            <input v-model="characterName" class="char-creation__input" placeholder="输入你的名字..." maxlength="20" @keyup.enter="startGame"/>
          </div>
          <div class="char-creation__field">
            <label class="char-creation__label">规则</label>
            <select v-model="selectedRuleset" class="char-creation__select">
              <option value="coc7e">克苏鲁的呼唤 7 版</option>
              <option value="dnd5e">龙与地下城 5 版</option>
            </select>
          </div>
          <div class="char-creation__field">
            <label class="char-creation__label">职业</label>
            <select v-model="selectedArchetype" class="char-creation__select" :disabled="archetypeLoading">
              <option v-for="a in archetypes" :key="a.id" :value="a.id">{{ a.label }}</option>
            </select>
            <p class="char-creation__hint" v-if="selectedArchetype">{{ archetypes.find(a => a.id === selectedArchetype)?.description || '' }}</p>
          </div>
          <div v-if="selectedArchetype" class="stat-preview">
            <h4 class="stat-preview__title">基础属性 (CoC 7e)</h4>
            <div class="stat-preview__grid">
              <div class="stat-preview__item"><span class="stat-preview__label">STR</span><span class="stat-preview__val">50</span></div>
              <div class="stat-preview__item"><span class="stat-preview__label">CON</span><span class="stat-preview__val">50</span></div>
              <div class="stat-preview__item"><span class="stat-preview__label">SIZ</span><span class="stat-preview__val">50</span></div>
              <div class="stat-preview__item"><span class="stat-preview__label">DEX</span><span class="stat-preview__val">50</span></div>
              <div class="stat-preview__item"><span class="stat-preview__label">APP</span><span class="stat-preview__val">50</span></div>
              <div class="stat-preview__item"><span class="stat-preview__label">INT</span><span class="stat-preview__val">50</span></div>
              <div class="stat-preview__item"><span class="stat-preview__label">POW</span><span class="stat-preview__val">50</span></div>
              <div class="stat-preview__item"><span class="stat-preview__label">EDU</span><span class="stat-preview__val">50</span></div>
            </div>
          </div>
          <div v-if="savedSessions.length > 0" class="saved-sessions">
            <h4 class="saved-sessions__title">继续游戏</h4>
            <div v-if="loadingSessions" class="saved-sessions__loading">加载中…</div>
            <div v-for="s in savedSessions.slice(0, 5)" :key="s.id" class="saved-sessions__item" @click="resumeSession(s)">
              <span class="saved-sessions__name">{{ s.playerName || '调查员' }}</span>
              <span class="saved-sessions__meta">{{ s.ruleset }} · {{ s.scene }} · 回合{{ s.round }}</span>
            </div>
          </div>
        </div>
        <button class="btn btn--primary" :disabled="loading || archetypeLoading" @click="startGame"><span v-if="loading" class="btn__spinner"></span><span v-else>开始新游戏</span></button>
        <p v-if="error" class="start-screen__error">{{ error }}</p>
      </div>
    </div>

    <div v-if="screen === 'game'" class="game-screen">
      <header class="status-bar">
        <div class="status-bar__row">
          <div class="status-bar__info"><span class="status-bar__label">会话</span><span class="status-bar__value status-bar__value--mono">{{ session.id.slice(-6) || '—' }}</span></div>
          <div class="status-bar__info"><span class="status-bar__label">{{ session.ruleset === 'dnd5e' ? '回合' : '轮' }}</span><span class="status-bar__value">{{ session.round || '—' }}</span></div>
          <div class="status-bar__info"><span class="status-bar__label">场景</span><span class="status-bar__value">{{ session.scene || '—' }}</span></div>
          <div class="status-bar__info" v-if="session.archetype"><span class="status-bar__label">职业</span><span class="status-bar__value">{{ session.archetype }}</span></div>
        </div>
        <div class="status-bar__stats">
          <div class="stat"><span class="stat__label">HP</span><div class="stat__track"><div class="stat__fill" :style="{ width: hpPercent + '%', background: hpColor }"></div></div><span class="stat__num">{{ session.hp }}/{{ session.maxHp }}</span></div>
          <div class="stat"><span class="stat__label">SAN</span><div class="stat__track"><div class="stat__fill" :style="{ width: sanPercent + '%', background: sanColor }"></div></div><span class="stat__num">{{ session.san }}/{{ session.maxSAN }}</span></div>
          <span class="insanity-badge" :class="{ 'insanity-badge--active': hasInsanity }">{{ session.indefInsanity ? '不定疯狂' : session.tempInsanity ? '临时疯狂' : '清醒' }}</span>
          <button class="kp-toggle-btn" @click="charEditorVisible = true" title="编辑角色">📝</button>
          <button class="kp-toggle-btn" @click="kpVisible = !kpVisible" :class="{ 'kp-toggle-btn--active': kpVisible }" title="KP 控制台">📋</button>
          <button class="kp-toggle-btn" @click="moduleEditorVisible = !moduleEditorVisible" :class="{ 'kp-toggle-btn--active': moduleEditorVisible }" title="模组编辑器">📦</button>
          <button class="kp-toggle-btn" @click="settingsVisible = !settingsVisible" :class="{ 'kp-toggle-btn--active': settingsVisible }" title="设置">⚙️</button>
        </div>
      </header>

      <SceneOverview v-if="session.scene" :scene="session.scene" :npcs="npcs" :monsters="monsters" :companions="companions" @chat="(n) => { chattingNpc = n; npcChatVisible = true }" @inspect="(c) => { if (c._type === 'companion') openCharCard(c) }" />
      <div v-if="session.id" class="suggestion-bar"><span class="suggestion-bar__hint">💡 你可以：</span><button v-for="s in suggestions" :key="s" class="suggestion-bar__chip" :disabled="loading" @click="submitAction(s)">{{ s }}</button></div>
      <CombatGrid v-if="companions.length > 0 || npcs.length > 0 || monsters.length > 0" :player="session" :companions="companions" :npcs="npcs" :monsters="monsters" @inspect="(e) => { if (e._type === 'companion') { const found = companions.find(c => c.id === e._id); if (found) openCharCard(found) } }" />

      <section class="companion-panel" :class="{ 'companion-panel--collapsed': !companionsExpanded }">
        <header class="companion-panel__header" @click="companionsExpanded = !companionsExpanded"><h2 class="companion-panel__title">同伴</h2><span class="companion-panel__count" v-if="companions.length">{{ companions.length }}</span><span class="companion-panel__toggle">{{ companionsExpanded ? '▾' : '▸' }}</span></header>
        <div v-if="companionsExpanded" class="companion-panel__body">
          <div v-if="companions.length === 0" class="companion-panel__empty"><p class="companion-panel__empty-text">当前没有同伴。</p><p class="companion-panel__empty-hint">输入「邀请 希尔妲」来招募。</p></div>
          <div v-for="c in companions" :key="c.id" class="companion-card" @click="openCharCard(c)">
            <div class="companion-card__header"><span class="companion-card__name">{{ c.name }}</span><span class="companion-card__badges"><span v-if="c.resolveState && c.resolveState !== 'normal'" class="companion-card__badge" :class="'companion-card__badge--' + c.resolveState">{{ c.resolveState === 'steadfast' ? '✦ 坚定' : c.resolveState === 'afflicted' ? '☠ 恐慌' : '🔥 疯狂' }}</span><span class="companion-card__badge" :class="c.control === 'auto' ? 'companion-card__badge--ai' : 'companion-card__badge--player'">{{ c.control === 'auto' ? '🤖 AI' : '🎮 玩家' }}</span></span></div>
            <div class="companion-card__stat"><span class="companion-card__stat-label">HP</span><div class="companion-card__track companion-card__track--hp"><div class="companion-card__fill" :style="{ width: c.maxHp > 0 ? Math.max(0, Math.round((c.hp / c.maxHp) * 100)) + '%' : '0%', background: (c.maxHp > 0 && (c.hp / c.maxHp) <= 0.25) ? '#ff4757' : (c.maxHp > 0 && (c.hp / c.maxHp) <= 0.5) ? '#ffa502' : '#2ed573' }"></div></div><span class="companion-card__stat-num">{{ c.hp }}/{{ c.maxHp }}</span></div>
            <div class="companion-card__stat"><span class="companion-card__stat-label">士气</span><div class="companion-card__track companion-card__track--morale"><div class="companion-card__fill" :style="{ width: Math.max(0, Math.min(100, (c.morale / 10) * 100)) + '%', background: c.morale <= 2.5 ? '#ff4757' : c.morale <= 5 ? '#ffa502' : '#2ed573' }"></div></div><span class="companion-card__stat-num">{{ c.morale }}/10</span></div>
            <div class="companion-card__info-row"><span class="companion-card__info-tag">{{ positionLabel(c.position) }}</span><span class="companion-card__info-tag">{{ behaviorLabel(c.behavior) }}</span><span class="companion-card__info-tag companion-card__info-tag--weapon" v-if="c.inventory?.length">{{ c.inventory[0] }}</span></div>
            <div class="companion-card__actions"><button class="companion-card__action-btn" :disabled="loading" @click="chatNpc(c)">💬</button><button class="companion-card__control-btn" :class="c.control === 'auto' ? 'companion-card__control-btn--takeover' : 'companion-card__control-btn--auto'" :disabled="loading" @click="toggleControl(c)">{{ c.control === 'auto' ? '🎮 接管' : '🤖 自动' }}</button></div>
          </div>
        </div>
      </section>

      <main class="narrative-log" ref="logEl">
        <div class="log-filter"><button v-for="f in [{k:'all',l:'全部'},{k:'narration',l:'叙事'},{k:'action',l:'行动'},{k:'system',l:'系统'},{k:'roll',l:'骰子'}]" :key="f.k" class="log-filter__btn" :class="{ 'log-filter__btn--active': logFilter === f.k }" @click="logFilter = f.k">{{ f.l }}</button></div>
        <div class="narrative-log__inner">
          <div v-for="msg in filteredMessages" :key="msg.id" class="message" :class="'message--' + msg.type"><span v-if="msg.speaker" class="message__speaker">{{ msg.speaker }}</span><p class="message__content">{{ msg.content }}</p></div>
          <div v-if="loading" class="message message--loading"><span class="message__dots"><span class="message__dot">·</span><span class="message__dot">·</span><span class="message__dot">·</span></span><p class="message__content">思考中…</p></div>
        </div>
      </main>

      <div v-if="session.dead" class="death-overlay"><div class="death-overlay__inner"><p class="death-overlay__title">你已死亡</p><p class="death-overlay__desc">调查在此终止。</p><button class="btn btn--primary" @click="newGame">开始新游戏</button></div></div>

      <footer class="input-area" :class="{ 'input-area--dead': session.dead }">
        <form class="input-area__form" @submit.prevent="() => { submitAction(inputValue); inputValue = ''; focusInput() }">
          <select v-if="pcList.length > 1" v-model.number="activePc" class="input-area__pc-select" :disabled="loading || session.dead"><option v-for="(pc, i) in pcList" :key="pc.id" :value="i">{{ pc.name }}</option></select>
          <input ref="inputRef" v-model="inputValue" type="text" class="input-area__field" :disabled="loading || session.dead" :placeholder="session.dead ? '旅程已结束……' : (loading ? '守秘人正在思考……' : '输入你的行动……')" autocomplete="off" @keydown="onInputKeydown"/>
          <button type="submit" class="btn btn--send" :disabled="loading || !inputValue.trim() || session.dead">发送</button>
        </form>
        <button class="input-area__restart" @click="newGame" :disabled="loading">新游戏</button>
      </footer>

      <div v-if="showCharCard" class="char-card-overlay" @click.self="closeCharCard"><div class="char-card-modal" @click.stop><button class="char-card-modal__close" @click="closeCharCard">✕</button><h2 class="char-card-modal__name">{{ selectedCompanion?.name }}</h2></div></div>

      <KPDashboard v-if="kpVisible" :session-id="session.id" @close="kpVisible = false"/>
      <ModuleEditor v-if="moduleEditorVisible" @close="moduleEditorVisible = false"/>
      <SettingsPanel v-if="settingsVisible" @close="settingsVisible = false"/>
      <CharacterEditor v-if="charEditorVisible && session.id" :session-id="session.id" :character="{ name: session.playerName, archetype: session.archetype, hp: session.hp, maxHp: session.maxHp, luck: session.luck ?? 60, creditRating: session.creditRating ?? 30, skills: session.skills ?? {}, inventory: session.inventory ?? [], weapons: session.weapons ?? [], attributes: session.attributes ?? {} }" :sanity="{ currentSAN: session.san, maxSAN: session.maxSAN }" @close="charEditorVisible = false"/>
      <NpcChat v-if="npcChatVisible && chattingNpc" :session-id="session.id" :npc="chattingNpc" @close="npcChatVisible = false"/>
    </div>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; min-height: 100vh; }
.trpg-app { max-width: 800px; margin: 0 auto; width: 100%; padding: 16px; min-height: 100vh; display: flex; flex-direction: column; }
.screen--game { padding: 0; }
.start-screen { display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 24px; }
.start-screen__inner { max-width: 420px; width: 100%; text-align: center; }
.start-screen__title { font-size: 2.5rem; color: #c9a96e; margin-bottom: 8px; }
.start-screen__subtitle { color: #888; margin-bottom: 24px; }
.start-screen__desc { color: #666; font-size: 0.9rem; margin-bottom: 32px; line-height: 1.6; }
.char-creation { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
.char-creation__field { text-align: left; }
.char-creation__label { display: block; font-size: 0.8rem; color: #888; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px; }
.char-creation__input, .char-creation__select { width: 100%; padding: 10px 12px; background: #141428; border: 1px solid #3a3a5c; border-radius: 8px; color: #e0e0e0; font-size: 1rem; outline: none; }
.char-creation__input:focus, .char-creation__select:focus { border-color: #c9a96e; }
.char-creation__hint { font-size: 0.8rem; color: #888; margin-top: 4px; }
.stat-preview { margin-top: 16px; padding: 16px; background: #1e1e3a; border: 1px solid #3a3a5c; border-radius: 8px; }
.stat-preview__title { font-size: 0.72rem; color: #c9a96e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
.stat-preview__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.stat-preview__item { display: flex; flex-direction: column; align-items: center; padding: 4px 0; }
.stat-preview__label { font-size: 0.65rem; color: #888; text-transform: uppercase; }
.stat-preview__val { font-size: 1rem; font-weight: 600; }
.saved-sessions { margin-top: 24px; padding: 16px; background: #1e1e3a; border: 1px solid #3a3a5c; border-radius: 8px; }
.saved-sessions__title { font-size: 0.72rem; color: #c9a96e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
.saved-sessions__item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
.saved-sessions__item:hover { background: rgba(201, 169, 110, 0.08); }
.saved-sessions__name { font-size: 0.85rem; font-weight: 500; }
.saved-sessions__meta { font-size: 0.65rem; color: #888; }
.btn { padding: 10px 24px; border: 1px solid #c9a96e; border-radius: 8px; background: #3a3a20; color: #c9a96e; font-size: 1rem; cursor: pointer; }
.btn:disabled { opacity: 0.4; cursor: default; }
.kp-toggle-btn { background: transparent; border: 1px solid #3a3a5c; color: #888; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 16px; margin-left: 4px; transition: all 0.15s; }
.kp-toggle-btn:hover { color: #fff; border-color: #666; }
.kp-toggle-btn--active { color: #c9a96e; border-color: #c9a96e; }
.suggestion-bar { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 0; }
.suggestion-bar__hint { font-size: 0.72rem; color: #888; align-self: center; }
.suggestion-bar__chip { padding: 4px 10px; border: 1px solid #3a3a5c; border-radius: 12px; background: transparent; color: #aaa; font-size: 0.72rem; cursor: pointer; transition: all 0.15s; }
.suggestion-bar__chip:hover { color: #c9a96e; border-color: #c9a96e; }
.companion-panel { flex-shrink: 0; background: #1e1e3a; border: 1px solid #3a3a5c; border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
.companion-panel__header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; }
.companion-panel__title { font-size: 0.8rem; color: #c9a96e; }
.companion-panel__count { font-size: 0.7rem; color: #888; }
.companion-panel__toggle { margin-left: auto; color: #888; }
.companion-panel__body { display: flex; gap: 8px; padding: 0 12px 8px; overflow-x: auto; }
.companion-card { flex: 0 0 180px; padding: 8px 10px; background: #141428; border: 1px solid #3a3a5c; border-radius: 8px; cursor: pointer; }
.companion-card__header { display: flex; justify-content: space-between; margin-bottom: 6px; }
.companion-card__name { font-weight: 600; font-size: 0.8rem; }
.companion-card__badges { display: flex; gap: 4px; }
.companion-card__badge { font-size: 0.6rem; padding: 1px 5px; border-radius: 4px; }
.companion-card__badge--steadfast { background: rgba(143, 188, 143, 0.2); color: #8fbc8f; }
.companion-card__badge--afflicted { background: rgba(221, 160, 221, 0.2); color: #dda0dd; }
.companion-card__badge--berserk { background: rgba(255, 107, 107, 0.2); color: #ff6b6b; }
.companion-card__badge--ai { background: rgba(100, 149, 237, 0.2); color: #6495ed; }
.companion-card__badge--player { background: rgba(201, 169, 110, 0.2); color: #c9a96e; }
.companion-card__stat { display: flex; align-items: center; gap: 4px; margin-bottom: 4px; font-size: 0.72rem; }
.companion-card__stat-label { color: #888; min-width: 24px; }
.companion-card__track { flex: 1; height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
.companion-card__fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
.companion-card__stat-num { min-width: 32px; text-align: right; color: #aaa; font-size: 0.7rem; }
.companion-card__info-row { display: flex; gap: 4px; flex-wrap: wrap; margin: 4px 0; }
.companion-card__info-tag { font-size: 0.6rem; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.05); }
.companion-card__actions { display: flex; gap: 4px; width: 100%; }
.companion-card__action-btn { padding: 5px 8px; border: 1px solid #3a3a5c; border-radius: 6px; background: rgba(255,255,255,0.04); color: #888; font-size: 14px; cursor: pointer; }
.companion-card__action-btn:hover { background: rgba(255,255,255,0.1); }
.companion-card__control-btn { flex: 1; padding: 5px 8px; border: 1px solid #3a3a5c; border-radius: 6px; background: rgba(255,255,255,0.04); color: #888; font-size: 0.72rem; cursor: pointer; }
.companion-card__control-btn--takeover { background: rgba(201, 169, 110, 0.15); border-color: rgba(201, 169, 110, 0.25); color: #c9a96e; }
.companion-card__control-btn--auto { background: rgba(255,255,255,0.04); }
.narrative-log { flex: 1; overflow-y: auto; padding: 8px 0; min-height: 0; }
.log-filter { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
.log-filter__btn { padding: 3px 10px; border: 1px solid #3a3a5c; border-radius: 12px; background: transparent; color: #888; font-size: 0.72rem; cursor: pointer; }
.log-filter__btn:hover { color: #ccc; }
.log-filter__btn--active { background: #c9a96e; color: #1a1a2e; font-weight: 600; }
.narrative-log__inner { display: flex; flex-direction: column; gap: 8px; padding: 0 12px; }
.message { padding: 6px 10px; border-radius: 6px; }
.message--narration { background: transparent; border-bottom: 1px solid #3a3a5c; border-radius: 0; }
.message--action { border-left: 3px solid #c9a96e; background: rgba(212, 160, 64, 0.04); }
.message--system { border-left: 3px solid #e05555; background: rgba(224, 85, 85, 0.05); }
.message--roll { border-left: 3px solid #c9a96e; background: rgba(201, 169, 110, 0.06); }
.message--roll .message__speaker { color: #c9a96e; font-size: 1.1rem; }
.message--roll .message__content { color: #e0d0b0; font-family: monospace; }
.message__speaker { font-size: 0.75rem; color: #888; display: block; margin-bottom: 2px; }
.message__content { line-height: 1.5; font-size: 0.95rem; }
.message--loading { text-align: center; color: #888; }
.death-overlay { position: fixed; inset: 0; z-index: 8000; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; }
.death-overlay__title { font-size: 2rem; color: #ff6b6b; margin-bottom: 16px; }
.death-overlay__desc { color: #888; margin-bottom: 24px; }
.input-area { display: flex; gap: 8px; align-items: center; padding: 8px 0; }
.input-area__form { display: flex; gap: 8px; align-items: center; flex: 1; }
.input-area__pc-select { padding: 4px 8px; border: 1px solid #3a3a5c; border-radius: 6px; background: #141428; color: #e0e0e0; font-size: 0.8rem; cursor: pointer; }
.input-area__field { flex: 1; padding: 8px 12px; background: #141428; border: 1px solid #3a3a5c; border-radius: 8px; color: #e0e0e0; font-size: 1rem; outline: none; }
.input-area__field:focus { border-color: #c9a96e; }
.btn--send { padding: 8px 16px; }
.input-area__restart { background: none; border: none; color: #888; font-size: 0.72rem; cursor: pointer; }
.status-bar { flex-shrink: 0; border-bottom: 1px solid #3a3a5c; margin-bottom: 8px; padding-bottom: 8px; }
.status-bar__row { display: flex; gap: 16px; font-size: 0.75rem; margin-bottom: 8px; }
.status-bar__info { display: flex; gap: 4px; }
.status-bar__label { color: #888; }
.status-bar__value { color: #c9a96e; }
.status-bar__stats { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.stat { display: flex; align-items: center; gap: 4px; font-size: 0.75rem; }
.stat__label { color: #888; min-width: 28px; }
.stat__track { width: 60px; height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
.stat__fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
.stat__num { color: #aaa; font-size: 0.7rem; min-width: 40px; }
.insanity-badge { font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.04); color: #888; }
.insanity-badge--active { background: rgba(255, 107, 107, 0.15); color: #ff6b6b; }
@media (min-width: 781px) { .game-screen { border-left: 1px solid #3a3a5c; border-right: 1px solid #3a3a5c; } }
</style>