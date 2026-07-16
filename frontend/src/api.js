const BASE = '/api'

export async function createSession({ ruleset = 'coc7e', archetype, characterName } = {}) {
  const body = { ruleset }
  if (archetype) body.archetype = archetype
  if (characterName) body.characterName = characterName
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json()).error || '创建失败')
  return res.json()
}

export async function getArchetypes(ruleset = 'coc7e') {
  const res = await fetch(`${BASE}/archetypes?ruleset=${ruleset}`)
  return res.json()
}

export async function sendAction(sessionId, input) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  })
  if (!res.ok) throw new Error((await res.json()).error || '请求失败')
  return res.json()
}

export async function getSession(sessionId) {
  const res = await fetch(`${BASE}/sessions/${sessionId}`)
  if (!res.ok) throw new Error('会话不存在')
  return res.json()
}

export async function getHistory(sessionId, limit = 50) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/history?limit=${limit}`)
  return res.json()
}

export async function getCharacter(sessionId) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/character`)
  return res.json()
}

export async function getKPState(sessionId) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/kp`)
  if (!res.ok) throw new Error((await res.json()).error || '获取 KP 状态失败')
  return res.json()
}

export async function kpAction(sessionId, action, body = {}) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/kp/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json()).error || 'KP 操作失败')
  return res.json()
}

export async function saveCharacterSheet(sessionId, data) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/character`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error((await res.json()).error || '保存角色卡失败')
  return res.json()
}

export async function npcChat(sessionId, npc, message) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/npc-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ npc, message }),
  })
  if (!res.ok) throw new Error((await res.json()).error || 'NPC 对话失败')
  return res.json()
}

export async function getSuggestions(sessionId) {
  const res = await fetch(`${BASE}/sessions/${sessionId}/suggestions`)
  if (!res.ok) return []
  const data = await res.json()
  return data.suggestions ?? []
}
