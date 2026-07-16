<script setup>
import { computed } from 'vue'

const props = defineProps({
  player: { type: Object, default: null },
  companions: { type: Array, default: () => [] },
  npcs: { type: Array, default: () => [] },
  monsters: { type: Array, default: () => [] },
})

const emit = defineEmits(['inspect'])

const ZONE_LABELS = {
  far: '后排',
  ranged: '远程位',
  melee_range: '近战位',
  player_side: '玩家侧',
  enemy_side: '敌侧',
}

const zones = ['far', 'ranged', 'melee_range']

const grid = computed(() => {
  const rows = []
  // 敌侧
  rows.push({
    label: '敌侧',
    side: 'enemy',
    zone: 'enemy_side',
    entities: [
      ...props.monsters.map(e => ({ ...e, _type: 'monster', _hp: e.hp, _maxHp: e.maxHp })),
      ...props.npcs.filter(n => n.attitude === '敌对').map(e => ({ ...e, _type: 'npc', _hp: e.hp, _maxHp: e.maxHp })),
    ],
  })
  // 中间区域（按距离）
  for (const z of zones) {
    const ents = [
      ...props.companions.filter(c => c.position === z).map(c => ({
        name: c.name, _type: 'companion', _hp: c.hp, _maxHp: c.maxHp, _id: c.id,
      })),
      ...props.npcs.filter(n => n.attitude !== '敌对' && n.position === z).map(n => ({
        name: n.name, _type: 'npc', _hp: n.hp, _maxHp: n.maxHp,
      })),
    ]
    if (z === 'melee_range' && props.player) {
      ents.unshift({
        name: props.player.name || 'PC', _type: 'player',
        _hp: props.player.hp, _maxHp: props.player.maxHp,
      })
    }
    rows.push({ label: ZONE_LABELS[z] || z, side: 'middle', zone: z, entities: ents })
  }
  // 友侧
  const allies = [
    ...props.companions.filter(c => !zones.includes(c.position)),
    ...props.npcs.filter(n => n.attitude === '友好' && !zones.includes(n.position)),
  ]
  if (allies.length > 0) {
    rows.push({ label: '友侧', side: 'ally', zone: 'player_side', entities: allies.map(a => ({
      ...a, _type: a._type || 'companion', _hp: a.hp, _maxHp: a.maxHp,
    })) })
  }
  return rows
})

function hpColor(hp, max) {
  if (!max) return '#666'
  const pct = hp / max
  if (pct <= 0.25) return '#ff4757'
  if (pct <= 0.5) return '#ffa502'
  return '#2ed573'
}

function zoneBg(side) {
  if (side === 'enemy') return 'rgba(255, 71, 87, 0.08)'
  if (side === 'ally') return 'rgba(46, 213, 115, 0.08)'
  return 'rgba(255, 255, 255, 0.03)'
}

function icon(et) {
  if (et === 'player') return '🧑'
  if (et === 'companion') return '👤'
  if (et === 'monster') return '👹'
  return '❓'
}
</script>

<template>
  <div class="combat-grid" v-if="grid.length > 0">
    <div
      v-for="(row, ri) in grid"
      :key="ri"
      class="combat-grid__row"
      :style="{ background: zoneBg(row.side) }"
    >
      <div class="combat-grid__zone-label">{{ row.label }}</div>
      <div class="combat-grid__entities">
        <div
          v-for="(e, ei) in row.entities"
          :key="ei"
          class="combat-grid__token"
          :class="`combat-grid__token--${e._type}`"
          :title="`${e.name} HP:${e._hp}/${e._maxHp}`"
          @click="emit('inspect', e)"
        >
          <span class="combat-grid__token-icon">{{ icon(e._type) }}</span>
          <span class="combat-grid__token-name">{{ e.name }}</span>
          <div class="combat-grid__token-hp">
            <div
              class="combat-grid__token-hp-fill"
              :style="{ width: (e._hp / (e._maxHp || 1)) * 100 + '%', background: hpColor(e._hp, e._maxHp) }"
            ></div>
          </div>
        </div>
        <div v-if="row.entities.length === 0" class="combat-grid__empty">—</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.combat-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0;
  font-size: 12px;
}
.combat-grid__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.06);
}
.combat-grid__zone-label {
  min-width: 48px;
  font-size: 11px;
  color: #888;
  text-align: right;
}
.combat-grid__entities {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
}
.combat-grid__token {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 4px;
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.combat-grid__token:hover { background: rgba(255,255,255,0.12); }
.combat-grid__token-icon { font-size: 14px; }
.combat-grid__token-name { color: #ccc; font-size: 11px; }
.combat-grid__token-hp {
  width: 32px; height: 4px;
  background: #333;
  border-radius: 2px;
  overflow: hidden;
  margin-left: 2px;
}
.combat-grid__token-hp-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s;
}
.combat-grid__empty { color: #555; font-size: 11px; padding: 2px 0; }
</style>