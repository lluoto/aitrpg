<script setup>
import { ref, reactive, watch } from 'vue'
import { saveCharacterSheet } from './api.js'

const props = defineProps({
  sessionId: String,
  character: Object,
  sanity: Object,
})
const emit = defineEmits(['close', 'saved'])

const form = reactive({})
const skills = reactive({})
const inventory = ref([])
const loading = ref(false)
const msg = ref('')

watch(() => props.character, (c) => {
  if (!c) return
  Object.assign(form, {
    hp: c.hp ?? 10, maxHp: c.maxHp ?? 10,
    luck: c.luck ?? 60, creditRating: c.creditRating ?? 30,
  })
  Object.assign(skills, { ...(c.skills ?? {}) })
  inventory.value = [...(c.inventory ?? [])]
}, { immediate: true })

function addSkill() {
  const name = prompt('技能名称:')
  if (!name) return
  skills[name] = 50
}

function removeSkill(name) {
  delete skills[name]
}

function addInventoryItem() {
  const item = prompt('物品名:')
  if (!item) return
  inventory.value.push(item)
}

function removeItem(idx) {
  inventory.value.splice(idx, 1)
}

async function save() {
  loading.value = true; msg.value = ''
  try {
    const data = {
      hp: form.hp, maxHp: form.maxHp,
      luck: form.luck, creditRating: form.creditRating,
      skills: { ...skills },
      inventory: [...inventory.value],
    }
    const res = await saveCharacterSheet(props.sessionId, data)
    msg.value = '✓ 保存成功'
    emit('saved', res)
  } catch (e) {
    msg.value = `✗ ${e.message}`
  } finally { loading.value = false }
}
</script>

<template>
  <Teleport to="body">
    <div class="ce-overlay" @click.self="emit('close')">
      <div class="ce-panel" @click.stop>
        <div class="ce-header">
          <h2>📋 角色编辑 · {{ props.character?.name ?? '—' }}</h2>
          <div>
            <span class="ce-arc">{{ props.character?.archetype ?? '' }}</span>
            <button class="ce-close" @click="emit('close')">✕</button>
          </div>
        </div>
        <div class="ce-body">
          <!-- 属性 -->
          <h4 class="ce-sub">基础属性</h4>
          <div class="ce-row">
            <label>HP</label>
            <input v-model.number="form.hp" type="number" class="ce-input ce-input--num" min="0" />
            <span>/</span>
            <input v-model.number="form.maxHp" type="number" class="ce-input ce-input--num" min="1" />
          </div>
          <div class="ce-row">
            <label>幸运</label>
            <input v-model.number="form.luck" type="number" class="ce-input ce-input--num" min="0" max="99" />
            <label>信誉</label>
            <input v-model.number="form.creditRating" type="number" class="ce-input ce-input--num" min="0" max="99" />
          </div>
          <div class="ce-row">
            <label>SAN</label>
            <span>{{ props.sanity?.currentSAN ?? '—' }} / {{ props.sanity?.maxSAN ?? '—' }}</span>
            <label>CM</label>
            <span>{{ props.sanity?.cthulhuMythos ?? 0 }}</span>
          </div>

          <!-- 技能 -->
          <h4 class="ce-sub">技能 ({{ Object.keys(skills).length }})</h4>
          <div v-for="(v, k) in skills" :key="k" class="ce-skill-row">
            <span class="ce-skill-name">{{ k }}</span>
            <input v-model.number="skills[k]" type="number" class="ce-input ce-input--num" min="0" max="99" />
            <button class="ce-btn ce-btn--sm" @click="removeSkill(k)">✕</button>
          </div>
          <button class="ce-btn ce-btn--sm" @click="addSkill">+ 技能</button>

          <!-- 物品 -->
          <h4 class="ce-sub">物品 ({{ inventory.length }})</h4>
          <div v-for="(item, i) in inventory" :key="i" class="ce-item-row">
            <span>{{ item }}</span>
            <button class="ce-btn ce-btn--sm" @click="removeItem(i)">✕</button>
          </div>
          <button class="ce-btn ce-btn--sm" @click="addInventoryItem">+ 物品</button>

          <!-- 保存 -->
          <div class="ce-actions">
            <span v-if="msg" class="ce-msg" :class="{ 'ce-msg--ok': msg.startsWith('✓') }">{{ msg }}</span>
            <button class="ce-btn" @click="emit('close')">关闭</button>
            <button class="ce-btn ce-btn--primary" :disabled="loading" @click="save">保存</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ce-overlay { position: fixed; inset: 0; z-index: 9000; background: rgba(0,0,0,0.7); display: flex; justify-content: center; align-items: flex-start; padding-top: 4vh; }
.ce-panel { width: min(520px, 95vw); max-height: 88vh; background: #1a1a2e; border: 1px solid #3a3a5c; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; color: #e0e0e0; font-size: 13px; }
.ce-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #2a2a4a; background: #141428; }
.ce-header h2 { font-size: 14px; color: #c9a96e; margin: 0; }
.ce-arc { font-size: 11px; color: #888; margin-right: 8px; }
.ce-close { background: transparent; border: 1px solid #3a3a5c; color: #888; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.ce-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
.ce-sub { font-size: 12px; color: #c9a96e; margin: 12px 0 6px; border-bottom: 1px solid #2a2a4a; padding-bottom: 4px; }
.ce-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; font-size: 12px; }
.ce-row label { min-width: 40px; color: #888; }
.ce-input { padding: 4px 6px; border: 1px solid #3a3a5c; border-radius: 4px; background: #141428; color: #e0e0e0; font-size: 12px; outline: none; }
.ce-input:focus { border-color: #c9a96e; }
.ce-input--num { width: 56px; text-align: center; }
.ce-skill-row, .ce-item-row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; font-size: 12px; }
.ce-skill-name { min-width: 80px; color: #aaa; }
.ce-btn { padding: 4px 10px; border: 1px solid #3a3a5c; border-radius: 6px; background: #2a2a4a; color: #ccc; font-size: 11px; cursor: pointer; }
.ce-btn:hover { background: #3a3a5c; }
.ce-btn--primary { background: #3a3a20; border-color: #c9a96e; color: #c9a96e; }
.ce-btn--sm { padding: 2px 6px; font-size: 10px; }
.ce-actions { display: flex; gap: 8px; align-items: center; margin-top: 16px; padding-top: 12px; border-top: 1px solid #2a2a4a; }
.ce-msg { font-size: 12px; flex: 1; }
.ce-msg--ok { color: #6bcf6b; }
.ce-msg:not(.ce-msg--ok) { color: #ff6b6b; }
</style>