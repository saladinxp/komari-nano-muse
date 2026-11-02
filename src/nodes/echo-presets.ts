/* Real tasks only, created after the administrator reviews the exact plan.
   Hebei CDN targets were selected by the user on 2026-11-01; reachability
   remains subject to tests from the user's own nodes, not this environment. */
import { getJson, rpc2 } from '../api/client'
import { S } from '../state'
import { $, esc, store } from '../utils/format'
import type { PingTaskDef, ThemeSettings } from '../types/komari'

export const ECHO_PRESETS = [
  { key: 'telecom', name: '电信 · 河北', target: '124.237.177.164', legacy: '219.141.136.10' },
  { key: 'unicom', name: '联通 · 河北', target: '110.242.74.102', legacy: '202.106.0.20' },
  { key: 'mobile', name: '移动 · 河北', target: '111.63.65.247', legacy: '' },
  { key: 'google', name: 'Google', target: '8.8.8.8', legacy: '' },
] as const
// beta.2/3 persisted IDs only. Never relabel their samples as new targets.
const BETA3_TARGETS: Record<string, string> = {
  telecom: '219.141.136.10',
  unicom: '202.106.0.20',
  mobile: '221.179.155.161',
  google: '8.8.8.8',
}
export type PresetTarget = { key: string; name: string; target: string }
let defs: PingTaskDef[] = []
let saving = false
let refreshView: () => void = () => {}
let refreshData: () => void = () => {}
let review: { targets: PresetTarget[]; fingerprint: string; settings: string } | null = null

export function presetBindings(settings: ThemeSettings = S.ts): Record<string, number> {
  try {
    const raw = JSON.parse(settings.echo_preset_tasks || '{}'),
      out: Record<string, number> = {}
    for (const p of ECHO_PRESETS) if (Number.isInteger(raw[p.key]) && raw[p.key] > 0) out[p.key] = raw[p.key]
    return out
  } catch {
    return {}
  }
}
function savedTargets(settings: ThemeSettings): Record<string, string> {
  try {
    const raw = JSON.parse(settings.echo_preset_targets || '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {}
  return {}
}
export function presetName(key: string, target: string): string {
  const p = ECHO_PRESETS.find(p => p.key === key)
  return p ? (target === p.target ? p.name : p.name.split(' · ')[0]) : key
}
export function configuredPresets(settings: ThemeSettings = S.ts): PresetTarget[] {
  const raw = savedTargets(settings)
  return ECHO_PRESETS.map(p => {
    const target = typeof raw[p.key] === 'string' ? raw[p.key] : p.target
    return { key: p.key, name: presetName(p.key, target), target }
  })
}
function boundTarget(key: string, settings: ThemeSettings): string {
  const raw = savedTargets(settings)
  return typeof raw[key] === 'string' ? raw[key] : BETA3_TARGETS[key] || ''
}
export function requiresPresetVerification(targets: PresetTarget[]): boolean {
  return targets.some(t => t.target !== ECHO_PRESETS.find(p => p.key === t.key)?.target)
}
export function echoTaskName(name: string): string {
  return name.replace(/^回声预设\s*·\s*/, '') || name
}
export function validPresetTarget(target: string): boolean {
  const parts = target.split('.')
  return (
    parts.length === 4 &&
    parts.every(s => /^(0|[1-9]\d{0,2})$/.test(s) && Number(s) <= 255) &&
    Number(parts[0]) > 0 &&
    Number(parts[0]) < 224
  )
}
export function echoGroup(): 'preset' | 'custom' {
  const explicit = store.get('echo-group', S.ts.echo_default_group || 'auto')
  return explicit === 'preset' || explicit === 'custom'
    ? explicit
    : ECHO_PRESETS.every(p => presetBindings()[p.key])
      ? 'preset'
      : 'custom'
}
function selectedIds(): number[] | null {
  try {
    const raw = JSON.parse(store.get('echo-targets', 'null'))
    return Array.isArray(raw) ? raw.filter(v => Number.isInteger(v) && v > 0) : null
  } catch {
    return null
  }
}
export function filterCustomTasks<T extends { id: number }>(tasks: T[]): T[] {
  const ids = selectedIds()
  return ids == null ? tasks : tasks.filter(t => ids.includes(Number(t.id)))
}
/* Default lines and custom targets never mix (user, 2026-11-02): a task belongs to the
   default lines when it is bound now, or when the theme created it (「回声预设 · …」),
   which also covers old bindings left in the backend for manual cleanup. */
const PRESET_NAME = /^回声预设\s*·/
export function isPresetTask(task: { id: number; name?: string }, settings: ThemeSettings = S.ts): boolean {
  return (
    Object.values(presetBindings(settings)).includes(Number(task.id)) || PRESET_NAME.test(task.name || '')
  )
}
/** Custom targets only: never a default line, then the visitor's own selection. */
export function customTasks<T extends { id: number; name?: string }>(tasks: T[]): T[] {
  return filterCustomTasks(tasks.filter(t => !isPresetTask(t)))
}
/** Whether any custom target exists before the visitor's selection is applied. */
export function hasCustomTasks(tasks: { id: number; name?: string }[]): boolean {
  return tasks.some(t => !isPresetTask(t))
}
export function presetRows<T extends { id: number; name: string }>(
  tasks: T[],
  uuid: string,
): { task?: T; name: string; target: string; message?: string }[] {
  const bindings = presetBindings()
  return configuredPresets().map(p => {
    const id = bindings[p.key],
      task = tasks.find(t => Number(t.id) === id)
    if (id && (!p.target || boundTarget(p.key, S.ts) !== p.target))
      return { name: p.name, target: p.target, message: '待管理员更新目标' }
    if (task) return { task: { ...task, fullName: task.name, name: p.name }, name: p.name, target: p.target }
    const def = defs.find(t => Number(t.id) === id)
    return {
      name: p.name,
      target: p.target,
      message: !id
        ? '尚未启用'
        : !def
          ? '等待任务信息'
          : Array.isArray(def.clients) && !def.clients.includes(uuid)
            ? '该节点未分配'
            : '等待采样',
    }
  })
}
export function setEchoTaskDefs(next: PingTaskDef[]) {
  defs = next
  syncEchoPresetControls()
}
function readTargets(): PresetTarget[] {
  return ECHO_PRESETS.map(p => {
    const target = $<HTMLInputElement>('echoTarget-' + p.key).value.trim()
    return { key: p.key, name: presetName(p.key, target), target }
  })
}
function syncVerification() {
  $('echoPresetVerification').hidden = !requiresPresetVerification(readTargets())
}
function invalidateReview() {
  review = null
  $('echoPresetReview').innerHTML = ''
  $('echoEnablePresets').hidden = true
}
export function syncEchoPresetControls() {
  $('echoTools').hidden = S.view !== 'list'
  const mode = echoGroup()
  document.querySelectorAll<HTMLElement>('[data-echo-group]').forEach(b => {
    b.classList.toggle('on', b.dataset.echoGroup === mode)
    b.setAttribute('aria-pressed', String(b.dataset.echoGroup === mode))
  })
  $('echoCustomPicker').hidden = mode !== 'custom'
  $('echoPresetAdmin').hidden = !S.loggedIn
  $('echoPresetHint').textContent =
    mode === 'preset' ? '四个参考目标 · 最近1小时真实采样' : '后台自建的拨测目标，不含默认四线；可按需选择'
  const selected = selectedIds()
  const options = defs
    .filter(d => !isPresetTask(d))
    .map(
      d =>
        `<label><input type="checkbox" data-echo-task="${Number(d.id)}"${selected == null || selected.includes(Number(d.id)) ? ' checked' : ''}/> ${esc(d.name)}</label>`,
    )
    .join('')
  if ($('echoTargetOptions').innerHTML !== options)
    $('echoTargetOptions').innerHTML = options || '<span>暂无自定义目标（默认四线不在这里）</span>'
  if (!$('echoPresetList').children.length) {
    const current = configuredPresets()
    $('echoPresetList').innerHTML = ECHO_PRESETS.map(
      p =>
        `<li><label for="echoTarget-${p.key}">${p.name.split(' · ')[0]}</label><input id="echoTarget-${p.key}" data-preset-target value="${esc(current.find(t => t.key === p.key).target)}" placeholder="${p.target}" aria-label="${p.name.split(' · ')[0]}目标 IPv4"/>${p.legacy ? `<small>旧目标 ${p.legacy} 已失效</small>` : ''}</li>`,
    ).join('')
  }
  syncVerification()
  $<HTMLButtonElement>('echoReviewPresets').disabled = saving
  $<HTMLButtonElement>('echoEnablePresets').disabled = saving
  $('echoEnablePresets').textContent = saving ? '正在保存…' : '确认新建 / 重新绑定'
}
function reusable(tasks: any[], target: string, clients: string[]) {
  return tasks.find(
    t =>
      Number.isInteger(Number(t.id)) &&
      Number(t.id) > 0 &&
      t.type === 'icmp' &&
      t.target === target &&
      t.default_on === true &&
      Array.isArray(t.clients) &&
      clients.every(id => t.clients.includes(id)),
  )
}
export function presetPlan(
  nodes: { uuid: string }[],
  tasks: any[],
  targets: PresetTarget[],
  settings: ThemeSettings = S.ts,
) {
  const clients = [...new Set(nodes.map(n => n.uuid))].sort(),
    old = presetBindings(settings)
  return targets.map(p => {
    const previous = tasks.find(t => Number(t.id) === old[p.key]),
      existing = reusable(tasks, p.target, clients)
    return {
      ...p,
      oldId: old[p.key] || null,
      oldTarget: previous?.target || (old[p.key] ? boundTarget(p.key, settings) : ''),
      oldName: previous?.name || '',
      reuseId: existing ? Number(existing.id) : null,
      clients,
    }
  })
}
/** Existing tasks are immutable, including exact matches reused by earlier versions.
    Old bindings are not proof of ownership, so obsolete tasks require manual cleanup. */
export async function ensureDefaultTasks(
  nodes: { uuid: string }[],
  tasks: any[],
  call = rpc2,
  targets: PresetTarget[] = configuredPresets(),
): Promise<Record<string, number>> {
  if (
    targets.length !== ECHO_PRESETS.length ||
    !ECHO_PRESETS.every(p => targets.filter(t => t.key === p.key).length === 1) ||
    targets.some(p => !validPresetTarget(p.target) || ECHO_PRESETS.some(old => old.legacy === p.target))
  )
    throw new Error('请先填写并验证替代目标，不能继续使用已失效地址')
  const clients = [...new Set(nodes.map(n => n.uuid))],
    bindings: Record<string, number> = {}
  for (const p of targets) {
    const existing = reusable(tasks, p.target, clients)
    if (existing) {
      bindings[p.key] = Number(existing.id)
      continue
    }
    const added = await call('admin:addPingTask', {
      name: '回声预设 · ' + p.name,
      target: p.target,
      type: 'icmp',
      interval: 60,
      clients,
      default_on: true,
    })
    if (!Number.isInteger(Number(added.task_id)) || Number(added.task_id) <= 0)
      throw new Error('后台未返回有效任务编号')
    bindings[p.key] = Number(added.task_id)
    tasks.push({
      id: bindings[p.key],
      name: '回声预设 · ' + p.name,
      target: p.target,
      type: 'icmp',
      interval: 60,
      clients,
      default_on: true,
    })
  }
  return bindings
}
const associationKey = (settings: ThemeSettings) =>
  JSON.stringify([settings.echo_preset_tasks || '', settings.echo_preset_targets || ''])
async function readCurrent() {
  const [site, nodes, tasks] = await Promise.all([
    getJson('/api/public?nm_echo=' + Date.now()),
    getJson('/api/nodes'),
    rpc2('admin:getAllPingTasks', {}),
  ])
  if (site.theme && site.theme !== 'NanoMuse') throw new Error('当前启用的主题已改变，请刷新页面')
  if (!Array.isArray(nodes) || !Array.isArray(tasks)) throw new Error('无法核实节点或任务列表，请重试')
  return { site, nodes, tasks }
}
async function reviewDefaults() {
  if (!S.loggedIn || saving) return
  invalidateReview()
  const targets = readTargets()
  if (targets.some(p => !validPresetTarget(p.target) || ECHO_PRESETS.some(old => old.legacy === p.target))) {
    $('echoPresetStatus').textContent = '请填写已验证的 IPv4 目标；已失效旧地址不能再次启用。'
    return
  }
  if (requiresPresetVerification(targets) && !$<HTMLInputElement>('echoTargetsVerified').checked) {
    $('echoPresetStatus').textContent =
      '替代地址须先在至少一个大陆、一个境外节点连续采样10分钟以上，再确认已验证。'
    return
  }
  saving = true
  syncEchoPresetControls()
  try {
    const { site, nodes, tasks } = await readCurrent(),
      plan = presetPlan(nodes, tasks, targets, site.theme_settings || {})
    review = {
      targets,
      fingerprint: JSON.stringify(plan),
      settings: associationKey(site.theme_settings || {}),
    }
    $('echoPresetReview').innerHTML =
      '<table><thead><tr><th>线路 / 旧任务</th><th>目标 / 将执行</th></tr></thead><tbody>' +
      plan
        .map(
          p =>
            `<tr><td>${esc(p.name)}<br>${p.oldId ? '#' + p.oldId + ' ' + esc(p.oldName) + '<br><code>' + esc(p.oldTarget || '目标未知') + '</code>' : '未绑定'}</td><td><code>${esc(p.target)}</code><br>${p.reuseId ? '复用 #' + p.reuseId : '新建 ICMP，每60秒'}<br>${p.clients.length} 个当前节点 + 未来节点</td></tr>`,
        )
        .join('') +
      '</tbody></table><p class="usage-note">确认后保存以上四线绑定。旧任务全部保留；不再使用的旧任务请核对编号后到后台手工清理。</p>'
    $('echoEnablePresets').hidden = false
    $('echoPresetStatus').textContent = '检查以上任务编号、目标及分配范围后再确认。'
  } catch (e) {
    $('echoPresetStatus').textContent = e instanceof Error ? e.message : '读取失败'
  } finally {
    saving = false
    syncEchoPresetControls()
  }
}
async function enableDefaults() {
  if (!S.loggedIn || saving || !review) return
  const approved = review
  saving = true
  syncEchoPresetControls()
  try {
    const { site, nodes, tasks } = await readCurrent(),
      settings = site.theme_settings || {}
    if (
      associationKey(settings) !== approved.settings ||
      JSON.stringify(presetPlan(nodes, tasks, approved.targets, settings)) !== approved.fingerprint ||
      JSON.stringify(readTargets()) !== JSON.stringify(approved.targets) ||
      (requiresPresetVerification(approved.targets) && !$<HTMLInputElement>('echoTargetsVerified').checked)
    ) {
      invalidateReview()
      throw new Error('配置或任务已变化，请重新检查更新内容')
    }
    const bindings = await ensureDefaultTasks(nodes, tasks, rpc2, approved.targets)
    const latest = await getJson('/api/public?nm_echo=' + Date.now())
    if (
      (latest.theme && latest.theme !== 'NanoMuse') ||
      associationKey(latest.theme_settings || {}) !== approved.settings
    ) {
      invalidateReview()
      throw new Error('主题或绑定已变化；已建任务保留，请重新检查')
    }
    const next = {
      ...(latest.theme_settings || {}),
      echo_preset_tasks: JSON.stringify(bindings),
      echo_preset_targets: JSON.stringify(Object.fromEntries(approved.targets.map(p => [p.key, p.target]))),
    }
    const response = await fetch('/api/admin/theme/settings?theme=NanoMuse', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    if (!response.ok) throw new Error('保存预设失败（' + response.status + '）')
    const result = await response.json()
    if (result.status === 'error') throw new Error(result.message || '保存失败')
    const oldTasks = presetPlan(nodes, tasks, approved.targets, settings).filter(
      p => p.oldId && p.oldId !== bindings[p.key],
    )
    S.ts = next
    store.set('echo-group', 'preset')
    invalidateReview()
    if (oldTasks.length)
      $('echoPresetReview').innerHTML =
        '<p class="usage-note">以下旧任务已解除四线绑定，仍在后台采样，请核对后手工清理：</p><ul>' +
        oldTasks
          .map(
            p =>
              '<li>#' +
              p.oldId +
              ' ' +
              esc(p.oldName) +
              ' · <code>' +
              esc(p.oldTarget || '目标未知') +
              '</code></li>',
          )
          .join('') +
        '</ul>'
    $('echoPresetStatus').textContent =
      '默认四线已启用。每60秒采样；旧任务全部保留；如有旧绑定，编号已列在上方供后台核对清理。'
    refreshData()
  } catch (e) {
    $('echoPresetStatus').textContent =
      (e instanceof Error ? e.message : '启用失败') + '。已有任务保留；重新检查会先查重。'
    invalidateReview()
  } finally {
    saving = false
    syncEchoPresetControls()
    refreshView()
  }
}
export function bindEchoPresets(onView: () => void, onData: () => void) {
  refreshView = onView
  refreshData = onData
  document.querySelectorAll<HTMLElement>('[data-echo-group]').forEach(b =>
    b.addEventListener('click', () => {
      store.set('echo-group', b.dataset.echoGroup)
      syncEchoPresetControls()
      refreshView()
    }),
  )
  $('echoTargetOptions').addEventListener('change', () => {
    store.set(
      'echo-targets',
      JSON.stringify(
        [...document.querySelectorAll<HTMLInputElement>('[data-echo-task]:checked')].map(i =>
          Number(i.dataset.echoTask),
        ),
      ),
    )
    refreshView()
  })
  $('echoAllTargets').addEventListener('click', () => {
    store.set('echo-targets', 'null')
    syncEchoPresetControls()
    refreshView()
  })
  $('echoPresetList').addEventListener('input', () => {
    $<HTMLInputElement>('echoTargetsVerified').checked = false
    invalidateReview()
    syncVerification()
  })
  $('echoTargetsVerified').addEventListener('change', invalidateReview)
  $('echoReviewPresets').addEventListener('click', () => void reviewDefaults())
  $('echoEnablePresets').addEventListener('click', () => void enableDefaults())
}
