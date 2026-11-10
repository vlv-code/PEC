// Routing & Profiles Tab Module for PEC Dashboard
import { state } from '../core/state.js';
import { adminFetch, esc, escapeHtml, extractError } from '../core/api.js';
import { toast, pecConfirm, pecPrompt, registerModalCloser } from '../core/notify.js';

let hasUnsavedRouting = false;

export function setUnsavedRouting(dirty: boolean) {
  hasUnsavedRouting = !!dirty;
  state.hasUnsavedRouting = hasUnsavedRouting;
  const badge = document.getElementById('unsavedChangesBadge');
  if (badge) {
    badge.style.display = hasUnsavedRouting ? 'inline-flex' : 'none';
  }
}

export function initRoutingDirtyTracking() {
  ['profName', 'profTargetGroup'].forEach(id => {
    const el = document.getElementById(id) as any;
    if (el && !el._dirtyBound) {
      el.addEventListener('input', () => setUnsavedRouting(true));
      el._dirtyBound = true;
    }
  });
  ['profDefaultPolicy', 'profTargetScope', 'profFailClosed'].forEach(id => {
    const el = document.getElementById(id) as any;
    if (el && !el._dirtyBound) {
      el.addEventListener('change', () => setUnsavedRouting(true));
      el._dirtyBound = true;
    }
  });
  const instList = document.getElementById('profTargetInstancesList') as any;
  if (instList && !instList._dirtyBound) {
    instList.addEventListener('change', () => setUnsavedRouting(true));
    instList._dirtyBound = true;
  }
}

export async function loadPresets() {
  try {
    const res = await adminFetch('/api/routing/presets');
    const presets = await res.json();
    const container = document.getElementById('presetsContainer');
    if (!container) return;

    const isRu = state.currentLang === 'ru';
    container.innerHTML = presets.map((p: any) => {
      const entriesList = p.entries || p.domains || [];
      const count = entriesList.length;

      // Check if preset is already in currentProfile
      const existingRule = (state.currentProfile && Array.isArray(state.currentProfile.rules))
        ? state.currentProfile.rules.find((r: any) => r.targetType === 'preset' && r.pattern === p.id)
        : null;

      let badgeHtml = '';
      if (existingRule) {
        const act = (existingRule.action || 'proxy').toLowerCase();
        const actLabel = isRu
          ? (act === 'proxy' ? 'ПРОКСИ' : act === 'direct' ? 'НАПРЯМУЮ' : 'БЛОК')
          : act.toUpperCase();
        badgeHtml = `<span class="preset-in-profile-badge action-${esc(act)}">${isRu ? 'В профиле: ' : 'In Profile: '}${esc(actLabel)}</span>`;
      }

      return `
      <div class="preset-card">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; margin-bottom: 4px;">
            <h4 style="margin: 0; font-size: 13px; font-weight: 600;">${esc(p.name)}</h4>
            <button type="button" class="btn-icon btn-inspect-geobase" data-id="${esc(p.id)}" title="${isRu ? 'Инспектор пресета' : 'Inspect Preset'}" style="font-size: 11px; padding: 2px 5px; line-height: 1;"><img src="/icons/search.png" class="icon-inline-sm" alt="inspect"></button>
          </div>
          <p style="margin: 0 0 6px 0;">${esc(p.description)} (${count} ${isRu ? 'записей' : 'entries'})</p>
          ${badgeHtml ? `<div style="margin-bottom: 6px;">${badgeHtml}</div>` : ''}
        </div>
        <div style="display: flex; gap: 6px; margin-top: 6px;">
          <button type="button" class="btn-secondary btn-add-preset-rule" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-action="proxy" style="font-size: 11px; padding: 4px 8px; flex: 1;">+ ${isRu ? 'Прокси' : 'Proxy'}</button>
          <button type="button" class="btn-secondary btn-add-preset-rule" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-action="direct" style="font-size: 11px; padding: 4px 8px; flex: 1;">+ ${isRu ? 'Напрямую' : 'Direct'}</button>
          <button type="button" class="btn-danger btn-add-preset-rule" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-action="block" style="font-size: 11px; padding: 4px 8px; flex: 1;">+ ${isRu ? 'Блок' : 'Block'}</button>
        </div>
      </div>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
  }
}

export async function loadProfiles() {
  try {
    const res = await adminFetch('/api/routing/profiles');
    if (!res.ok) return;
    state.allProfiles = await res.json();
    const sel = document.getElementById('profileSelect') as HTMLSelectElement | null;
    if (sel) {
      sel.innerHTML = state.allProfiles.map((p: any) => 
        `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.defaultPolicy.toUpperCase())} default)${p.isDefault ? ' [DEFAULT]' : ''}</option>`
      ).join('');
    }

    if (state.allProfiles.length > 0) {
      state.currentProfile = state.allProfiles[0];
      (window as any).currentProfile = state.currentProfile;
      renderProfile(state.currentProfile);
      const hdr = document.getElementById('hdrActiveProfile');
      if (hdr) hdr.textContent = state.currentProfile.name;
    }
  } catch (e) {
    console.error(e);
  }
}

export async function loadSelectedProfile() {
  const sel = document.getElementById('profileSelect') as HTMLSelectElement | null;
  if (!sel) return;
  const prevId = state.currentProfile ? state.currentProfile.id : '';
  const newId = sel.value;
  if (prevId === newId) return;

  if (hasUnsavedRouting) {
    const isRu = state.currentLang === 'ru';
    const ok = await pecConfirm({
      title: isRu ? 'Несохраненные изменения' : 'Unsaved Changes',
      message: isRu
        ? 'У вас есть несохраненные изменения в текущем профиле. Сбросить их?'
        : 'You have unsaved changes in the current profile. Discard them?',
      isDanger: true,
      confirmText: isRu ? 'Сбросить' : 'Discard'
    });
    if (!ok) {
      sel.value = prevId;
      return;
    }
    setUnsavedRouting(false);
  }

  const found = state.allProfiles.find((p: any) => p.id === newId);
  if (found) {
    state.currentProfile = found;
    (window as any).currentProfile = state.currentProfile;
    renderProfile(state.currentProfile);
  }
}

export async function populateProfileInstancesList(selectedIds: string[] = []) {
  const container = document.getElementById('profTargetInstancesList');
  if (!container) return;
  if (!state.lastLoadedInstances || !state.lastLoadedInstances.length) {
    try {
      const res = await adminFetch('/api/instances');
      if (res.ok) {
        const data = await res.json();
        state.lastLoadedInstances = data.instances || [];
      }
    } catch (_) {}
  }
  const instances = state.lastLoadedInstances || [];
  const set = new Set(selectedIds || []);
  const isRu = state.currentLang === 'ru';
  if (instances.length === 0) {
    container.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">' + (isRu ? 'Нет подключенных устройств' : 'No instances connected yet') + '</span>';
    return;
  }
  container.innerHTML = instances.map((inst: any) => {
    const id = esc(inst.instanceId);
    const name = esc(inst.username || inst.ip || inst.instanceId);
    const checked = set.has(inst.instanceId) ? ' checked' : '';
    return '<label style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 12px; cursor: pointer;">' +
      '<input type="checkbox" class="prof-instance-checkbox" value="' + id + '"' + checked + ' style="margin: 0; width: 14px; height: 14px;"> ' +
      '<span><code>' + id + '</code> (' + name + ')</span>' +
      '</label>';
  }).join('');
}

export function renderProfile(p: any) {
  if (!p) return;
  const nameEl = document.getElementById('profName') as HTMLInputElement | null;
  if (nameEl) nameEl.value = p.name || '';
  const defPolicyEl = document.getElementById('profDefaultPolicy') as HTMLSelectElement | null;
  if (defPolicyEl) defPolicyEl.value = p.defaultPolicy || 'direct';
  const targetScopeEl = document.getElementById('profTargetScope') as HTMLSelectElement | null;
  if (targetScopeEl) targetScopeEl.value = p.targetScope || 'all';
  const targetGroupEl = document.getElementById('profTargetGroup') as HTMLInputElement | null;
  if (targetGroupEl) targetGroupEl.value = p.targetGroup || '';
  const failClosedEl = document.getElementById('profFailClosed') as HTMLInputElement | null;
  if (failClosedEl) failClosedEl.checked = Boolean(p.failClosed);
  const descEl = document.getElementById('profDesc');
  if (descEl) descEl.textContent = p.description || 'Configured routing rules.';
  
  const groupRow = document.getElementById('groupTargetRow');
  if (groupRow) groupRow.style.display = p.targetScope === 'group' ? 'block' : 'none';

  const instRow = document.getElementById('instancesTargetRow');
  if (instRow) {
    instRow.style.display = p.targetScope === 'instances' ? 'block' : 'none';
    if (p.targetScope === 'instances') {
      populateProfileInstancesList(p.targetInstanceIds || []);
    }
  }

  const pacPreviewBtn = document.getElementById('btnPacPreview') as HTMLAnchorElement | null;
  if (pacPreviewBtn) pacPreviewBtn.href = '/proxy.pac?profileId=' + p.id;
  setUnsavedRouting(false);
  initRoutingDirtyTracking();
  renderRules(p.rules || []);
  loadPresets();
}

export function renderRules(rules: any[]) {
  const tbody = document.getElementById('rulesTableBody');
  const isRu = state.currentLang === 'ru';
  if (!tbody) return;
  if (!rules || !rules.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'В этом профиле нет правил. Используйте кнопки выше для добавления пресетов или кастомных правил.' : 'No rules defined for this profile. Use buttons above to add presets or custom rules.') + '</td></tr>';
    return;
  }

  tbody.innerHTML = rules.map((r: any, idx: number) => {
    let badge = 'badge-action-proxy';
    if (r.action === 'direct') badge = 'badge-action-direct';
    else if (r.action === 'block') badge = 'badge-action-block';
    const actionLabel = isRu ? (r.action === 'proxy' ? 'ПРОКСИ' : (r.action === 'direct' ? 'НАПРЯМУЮ' : 'БЛОК')) : r.action.toUpperCase();

    return `<tr>
      <td>
        <input type="checkbox" class="toggle-rule-enabled" data-index="${idx}" ${r.enabled ? 'checked' : ''} style="margin: 0;" />
      </td>
      <td>
        <div style="display: flex; gap: 4px; align-items: center;">
          <button type="button" class="btn-reorder-up" data-index="${idx}" ${idx === 0 ? 'disabled' : ''} title="${isRu ? 'Выше' : 'Move Up'}">▲</button>
          <button type="button" class="btn-reorder-down" data-index="${idx}" ${idx === rules.length - 1 ? 'disabled' : ''} title="${isRu ? 'Ниже' : 'Move Down'}">▼</button>
        </div>
      </td>
      <td><strong>${esc(r.name)}</strong></td>
      <td><code>${esc(r.pattern)}</code></td>
      <td><span class="badge ${badge}">${esc(actionLabel)}</span></td>
      <td>
        <div style="display: flex; gap: 4px; align-items: center;">
          <button type="button" class="btn-secondary btn-edit-rule" data-index="${idx}" style="font-size: 11px; padding: 3px 8px;" title="${isRu ? 'Редактировать правило' : 'Edit rule'}">✏️ ${isRu ? 'Изменить' : 'Edit'}</button>
          <button type="button" class="btn-danger btn-remove-rule" data-index="${idx}" style="font-size: 11px; padding: 3px 8px;">${isRu ? 'Удалить' : 'Delete'}</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

export function moveRuleUp(index: number) {
  if (!state.currentProfile || !Array.isArray(state.currentProfile.rules)) return;
  if (index <= 0 || index >= state.currentProfile.rules.length) return;
  const temp = state.currentProfile.rules[index];
  state.currentProfile.rules[index] = state.currentProfile.rules[index - 1];
  state.currentProfile.rules[index - 1] = temp;
  setUnsavedRouting(true);
  renderRules(state.currentProfile.rules);
}

export function moveRuleDown(index: number) {
  if (!state.currentProfile || !Array.isArray(state.currentProfile.rules)) return;
  if (index < 0 || index >= state.currentProfile.rules.length - 1) return;
  const temp = state.currentProfile.rules[index];
  state.currentProfile.rules[index] = state.currentProfile.rules[index + 1];
  state.currentProfile.rules[index + 1] = temp;
  setUnsavedRouting(true);
  renderRules(state.currentProfile.rules);
}

export function toggleRuleEnabled(idx: number) {
  if (state.currentProfile && state.currentProfile.rules && state.currentProfile.rules[idx]) {
    state.currentProfile.rules[idx].enabled = !state.currentProfile.rules[idx].enabled;
    setUnsavedRouting(true);
    renderRules(state.currentProfile.rules);
  }
}

export function removeRule(idx: number) {
  if (state.currentProfile && state.currentProfile.rules && state.currentProfile.rules[idx]) {
    state.currentProfile.rules.splice(idx, 1);
    setUnsavedRouting(true);
    renderRules(state.currentProfile.rules);
    loadPresets();
  }
}

export function openEditRuleModal(idx: number) {
  if (!state.currentProfile || !Array.isArray(state.currentProfile.rules) || !state.currentProfile.rules[idx]) return;
  const rule = state.currentProfile.rules[idx];
  const idxEl = document.getElementById('editRuleIndex') as HTMLInputElement | null;
  const nameEl = document.getElementById('editRuleName') as HTMLInputElement | null;
  const patternEl = document.getElementById('editRulePattern') as HTMLInputElement | null;
  const actionEl = document.getElementById('editRuleAction') as HTMLSelectElement | null;
  const errEl = document.getElementById('editRuleError');

  if (idxEl) idxEl.value = String(idx);
  if (nameEl) nameEl.value = rule.name || '';
  if (patternEl) patternEl.value = rule.pattern || '';
  if (actionEl) actionEl.value = rule.action || 'proxy';
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

  const modal = document.getElementById('modalEditRule');
  if (modal) modal.style.display = 'flex';
}

export function closeEditRuleModal() {
  const modal = document.getElementById('modalEditRule');
  if (modal) modal.style.display = 'none';
}

export function validatePatternToken(token: string): { valid: boolean; error?: string } {
  if (!token) return { valid: false, error: 'Пустой элемент шаблона' };
  if (token.includes('/')) {
    const parts = token.split('/');
    if (parts.length !== 2) return { valid: false, error: 'Неверный формат CIDR: ' + token };
    const ip = parts[0];
    const maskStr = parts[1];
    const mask = parseInt(maskStr, 10);
    if (isNaN(mask) || String(mask) !== maskStr) return { valid: false, error: 'Неверная маска CIDR: /' + maskStr };
    const octets = ip.split('.');
    if (octets.length === 4) {
      if (mask < 0 || mask > 32) return { valid: false, error: 'Маска IPv4 CIDR должна быть от 0 до 32' };
      for (const oct of octets) {
        if (!/^\d{1,3}$/.test(oct)) return { valid: false, error: 'Неверный октет IPv4: ' + oct };
        const n = Number(oct);
        if (n < 0 || n > 255) return { valid: false, error: 'Октет IPv4 должен быть от 0 до 255: ' + oct };
      }
      return { valid: true };
    }
    if (ip.includes(':')) {
      if (mask < 0 || mask > 128) return { valid: false, error: 'Маска IPv6 CIDR должна быть от 0 до 128' };
      if (!/^[0-9a-fA-F:]+$/.test(ip)) return { valid: false, error: 'Неверный адрес IPv6: ' + ip };
      return { valid: true };
    }
    return { valid: false, error: 'Неверный IP в CIDR: ' + token };
  }
  if (/[<>"'\\^`{}|\s]/.test(token)) {
    return { valid: false, error: 'Недопустимые символы в маске домена: ' + token };
  }
  return { valid: true };
}

export function saveEditedRule() {
  if (!state.currentProfile || !Array.isArray(state.currentProfile.rules)) return;
  const idxEl = document.getElementById('editRuleIndex') as HTMLInputElement | null;
  const nameEl = document.getElementById('editRuleName') as HTMLInputElement | null;
  const patternEl = document.getElementById('editRulePattern') as HTMLInputElement | null;
  const actionEl = document.getElementById('editRuleAction') as HTMLSelectElement | null;
  const errEl = document.getElementById('editRuleError');

  const idx = parseInt(idxEl ? idxEl.value : '-1', 10);
  if (isNaN(idx) || idx < 0 || idx >= state.currentProfile.rules.length) {
    if (errEl) { errEl.textContent = 'Invalid rule index'; errEl.style.display = 'block'; }
    return;
  }

  const name = nameEl ? nameEl.value.trim() : '';
  const pattern = patternEl ? patternEl.value.trim() : '';
  const action = actionEl ? actionEl.value : 'proxy';

  if (!pattern) {
    if (errEl) {
      errEl.textContent = state.currentLang === 'ru' ? 'Укажите шаблон правила' : 'Please specify a rule pattern';
      errEl.style.display = 'block';
    }
    return;
  }
  const tokens = pattern.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (tokens.length === 0) {
    if (errEl) {
      errEl.textContent = state.currentLang === 'ru' ? 'Укажите шаблон правила' : 'Please specify a rule pattern';
      errEl.style.display = 'block';
    }
    return;
  }

  for (const tok of tokens) {
    const valRes = validatePatternToken(tok);
    if (!valRes.valid) {
      if (errEl) {
        errEl.textContent = (state.currentLang === 'ru' ? 'Ошибка валидации: ' : 'Validation error: ') + valRes.error;
        errEl.style.display = 'block';
      }
      return;
    }
  }

  const normalizedPattern = tokens.join(', ');

  const rule = state.currentProfile.rules[idx];
  rule.name = name || normalizedPattern;
  rule.pattern = normalizedPattern;
  rule.action = action;
  rule.targetType = tokens.some(t => t.includes('/')) ? 'cidr' : 'wildcard';

  closeEditRuleModal();
  setUnsavedRouting(true);
  renderRules(state.currentProfile.rules);
}

export function addPresetRule(presetId: string, presetName: string, action: string = 'proxy') {
  if (!state.currentProfile) return;
  if (!state.currentProfile.rules) state.currentProfile.rules = [];
  const isRu = state.currentLang === 'ru';

  const existingIdx = state.currentProfile.rules.findIndex((r: any) => r.targetType === 'preset' && r.pattern === presetId);
  if (existingIdx !== -1) {
    state.currentProfile.rules[existingIdx].action = action;
    state.currentProfile.rules[existingIdx].enabled = true;
    toast((isRu ? 'Пресет обновлен: ' : 'Preset updated: ') + presetName, 'info');
  } else {
    state.currentProfile.rules.push({
      id: 'r_' + Math.random().toString(36).substring(2, 8),
      name: presetName,
      targetType: 'preset',
      pattern: presetId,
      action: action,
      enabled: true
    });
    toast((isRu ? 'Пресет добавлен: ' : 'Preset added: ') + presetName, 'success');
  }
  setUnsavedRouting(true);
  renderRules(state.currentProfile.rules);
  loadPresets();
}

export function addCustomRule() {
  if (!state.currentProfile) return;
  const nameEl = document.getElementById('newRuleName') as HTMLInputElement | null;
  const patternEl = document.getElementById('newRulePattern') as HTMLInputElement | null;
  const actionEl = document.getElementById('newRuleAction') as HTMLSelectElement | null;

  const name = nameEl ? nameEl.value.trim() : '';
  const pattern = patternEl ? patternEl.value.trim() : '';
  const action = actionEl ? actionEl.value : 'proxy';

  if (!pattern) {
    toast(state.currentLang === 'ru' ? 'Укажите шаблон правила' : 'Please specify a rule pattern', 'error');
    return;
  }
  const tokens = pattern.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  if (tokens.length === 0) {
    toast(state.currentLang === 'ru' ? 'Укажите шаблон правила' : 'Please specify a rule pattern', 'error');
    return;
  }

  for (const tok of tokens) {
    const valRes = validatePatternToken(tok);
    if (!valRes.valid) {
      toast((state.currentLang === 'ru' ? 'Ошибка шаблона: ' : 'Pattern error: ') + valRes.error, 'error');
      return;
    }
  }

  const normalizedPattern = tokens.join(', ');

  state.currentProfile.rules.push({
    id: 'r_' + Math.random().toString(36).substring(2, 8),
    name: name || normalizedPattern,
    targetType: tokens.some(t => t.includes('/')) ? 'cidr' : 'wildcard',
    pattern: normalizedPattern,
    action: action,
    enabled: true
  });

  if (nameEl) nameEl.value = '';
  if (patternEl) patternEl.value = '';
  setUnsavedRouting(true);
  renderRules(state.currentProfile.rules);
}

export async function saveCurrentProfile() {
  if (!state.currentProfile) return;
  const btn = document.querySelector('button[onclick="saveCurrentProfile()"]') as HTMLButtonElement | null;
  let origHtml = '';
  if (btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    origHtml = btn.innerHTML;
    btn.innerHTML = '<span class="loading-spinner"></span> ' + (btn.textContent || '').trim();
  }

  state.currentProfile.name = (document.getElementById('profName') as HTMLInputElement).value.trim();
  state.currentProfile.defaultPolicy = (document.getElementById('profDefaultPolicy') as HTMLSelectElement).value;
  state.currentProfile.targetScope = (document.getElementById('profTargetScope') as HTMLSelectElement).value;
  state.currentProfile.targetGroup = (document.getElementById('profTargetGroup') as HTMLInputElement).value.trim();
  state.currentProfile.failClosed = (document.getElementById('profFailClosed') as HTMLInputElement).checked;

  if (state.currentProfile.targetScope === 'instances') {
    const checkedBoxes = document.querySelectorAll('#profTargetInstancesList .prof-instance-checkbox:checked');
    state.currentProfile.targetInstanceIds = Array.from(checkedBoxes).map((cb: any) => cb.value);
  } else {
    state.currentProfile.targetInstanceIds = [];
  }

  try {
    const res = await adminFetch('/api/routing/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.currentProfile)
    });
    if (res.ok) {
      toast(state.currentLang === 'ru' ? 'Профиль маршрутизации сохранен! Применен к соответствующим устройствам.' : 'Routing profile saved! Deployed to matching devices.', 'success');
      setUnsavedRouting(false);
      loadProfiles();
    } else {
      if (res.status === 401) return;
      const data = await res.json().catch(() => ({}));
      toast(extractError(res, data, state.currentLang === 'ru' ? 'Ошибка сохранения профиля' : 'Failed to save profile'), 'error');
    }
  } catch (e) {
    toast('Error saving profile: ' + e, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (origHtml) btn.innerHTML = origHtml;
    }
  }
}

// ==================== Geobase Inspector Modal Logic ====================
let currentInspectorPreset: any = null;
let inspectorEntries: string[] = [];
let inspectorFilteredEntries: string[] = [];
const inspectorSelectedSet = new Set<string>();

export async function openGeobaseInspector(presetId: string) {
  const modal = document.getElementById('modalGeobaseInspector');
  if (!modal) return;
  modal.style.display = 'flex';
  
  const isRu = state.currentLang === 'ru';
  const titleEl = document.getElementById('inspectorTitle');
  if (titleEl) titleEl.textContent = isRu ? 'Загрузка...' : 'Loading...';
  const tbody = document.getElementById('inspectorTableBody');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Загрузка содержимого пресета...' : 'Loading preset entries...') + '</td></tr>';
  }
  const searchEl = document.getElementById('inspectorSearch') as HTMLInputElement | null;
  if (searchEl) searchEl.value = '';
  inspectorSelectedSet.clear();
  updateInspectorCounters();

  try {
    const res = await adminFetch('/api/routing/presets/' + encodeURIComponent(presetId));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const preset = await res.json();
    currentInspectorPreset = preset;

    if (titleEl) titleEl.textContent = preset.name || presetId;
    const typeBadge = document.getElementById('inspectorTypeBadge');
    if (typeBadge) {
      typeBadge.textContent = (preset.type || 'domain').toUpperCase();
    }
    const subTitleEl = document.getElementById('inspectorSubtitle');
    if (subTitleEl) {
      subTitleEl.textContent = preset.description || (preset.source ? 'Source: ' + preset.source : '');
    }

    inspectorEntries = preset.entries || preset.domains || [];
    inspectorFilteredEntries = [...inspectorEntries];
    renderInspectorTable();
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #ef4444;">' + (isRu ? 'Ошибка загрузки пресета: ' : 'Failed to load preset: ') + esc(String(err)) + '</td></tr>';
    }
  }
}

export function closeGeobaseInspector() {
  const modal = document.getElementById('modalGeobaseInspector');
  if (modal) modal.style.display = 'none';
  currentInspectorPreset = null;
  inspectorEntries = [];
  inspectorFilteredEntries = [];
  inspectorSelectedSet.clear();
}

export function filterInspectorEntries() {
  const searchEl = document.getElementById('inspectorSearch') as HTMLInputElement | null;
  const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
  if (!q) {
    inspectorFilteredEntries = [...inspectorEntries];
  } else {
    inspectorFilteredEntries = inspectorEntries.filter(e => String(e).toLowerCase().includes(q));
  }
  renderInspectorTable();
}

export function renderInspectorTable() {
  const tbody = document.getElementById('inspectorTableBody');
  const isRu = state.currentLang === 'ru';
  if (!tbody) return;
  if (!inspectorFilteredEntries.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Нет совпадений' : 'No matching entries') + '</td></tr>';
    updateInspectorCounters();
    return;
  }

  const limit = 500;
  const visible = inspectorFilteredEntries.slice(0, limit);
  tbody.innerHTML = visible.map(entry => {
    const checked = inspectorSelectedSet.has(entry) ? 'checked' : '';
    const entryType = entry.includes('/') ? 'CIDR' : (entry.startsWith('*.') || entry.startsWith('.')) ? 'Wildcard' : 'Domain';
    return `<tr>
      <td>
        <input type="checkbox" class="toggle-inspector-entry" data-entry="${escapeHtml(entry)}" ${checked} style="margin: 0;" />
      </td>
      <td><code>${esc(entry)}</code></td>
      <td><span class="badge" style="font-size: 10px; background: rgba(255,255,255,0.06);">${entryType}</span></td>
    </tr>`;
  }).join('');

  if (inspectorFilteredEntries.length > limit) {
    tbody.innerHTML += `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); font-size: 11px;">... ${isRu ? 'показано первых' : 'showing first'} ${limit} ${isRu ? 'из' : 'of'} ${inspectorFilteredEntries.length} (${isRu ? 'уточните поиск' : 'refine search'})</td></tr>`;
  }

  updateInspectorCounters();
}

export function toggleInspectorEntry(entry: string, isChecked: boolean) {
  if (isChecked) {
    inspectorSelectedSet.add(entry);
  } else {
    inspectorSelectedSet.delete(entry);
  }
  updateInspectorCounters();
}

export function selectInspectorAll(select: boolean) {
  if (select) {
    for (const e of inspectorFilteredEntries) {
      inspectorSelectedSet.add(e);
    }
  } else {
    for (const e of inspectorFilteredEntries) {
      inspectorSelectedSet.delete(e);
    }
  }
  renderInspectorTable();
}

export function updateInspectorCounters() {
  const isRu = state.currentLang === 'ru';
  const selCount = document.getElementById('inspectorSelectedCount');
  if (selCount) {
    selCount.textContent = (isRu ? 'Выбрано: ' : 'Selected: ') + inspectorSelectedSet.size;
  }
  const totalCount = document.getElementById('inspectorTotalCount');
  if (totalCount) {
    totalCount.textContent = (isRu ? 'Всего записей: ' : 'Total entries: ') + inspectorEntries.length;
  }
  const allBox = document.getElementById('inspectorSelectAll') as HTMLInputElement | null;
  if (allBox) {
    allBox.checked = inspectorFilteredEntries.length > 0 && inspectorFilteredEntries.every(e => inspectorSelectedSet.has(e));
  }
}

export function addSelectedToProfile(action: string = 'proxy') {
  if (!state.currentProfile) {
    toast('No profile selected', 'error');
    return;
  }
  if (!inspectorSelectedSet.size) {
    toast(state.currentLang === 'ru' ? 'Не выбрано ни одной записи' : 'No entries selected', 'error');
    return;
  }

  const isRu = state.currentLang === 'ru';
  const entries = Array.from(inspectorSelectedSet);
  const presetName = currentInspectorPreset ? currentInspectorPreset.name : 'Entries';

  let added = 0;
  for (const entry of entries) {
    const isCidr = entry.includes('/');
    state.currentProfile.rules.push({
      id: 'r_' + Math.random().toString(36).substring(2, 8),
      name: `${presetName} [${entry}]`,
      targetType: isCidr ? 'cidr' : 'wildcard',
      pattern: entry,
      action: action,
      enabled: true
    });
    added++;
  }

  toast((isRu ? `Добавлено правил: ${added}` : `Added ${added} rules`) + ` (${action.toUpperCase()})`, 'success');
  setUnsavedRouting(true);
  renderRules(state.currentProfile.rules);
  closeGeobaseInspector();
}

// ==================== Import Presets Modal Logic ====================
let currentImportTab: string = 'url';

export function openImportPresetsModal() {
  const modal = document.getElementById('modalImportPresets');
  if (!modal) return;
  modal.style.display = 'flex';
  const errBox = document.getElementById('importPresetError');
  if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
  const urlInp = document.getElementById('importPresetUrlInput') as HTMLInputElement | null;
  if (urlInp) urlInp.value = '';
  const fileInp = document.getElementById('importPresetFileInput') as HTMLInputElement | null;
  if (fileInp) fileInp.value = '';
  const tagInp = document.getElementById('importPresetTag') as HTMLInputElement | null;
  if (tagInp) tagInp.value = '';
  const nameInp = document.getElementById('importPresetName') as HTMLInputElement | null;
  if (nameInp) nameInp.value = '';
  switchImportTab('url');
}

export function closeImportPresetsModal() {
  const modal = document.getElementById('modalImportPresets');
  if (modal) modal.style.display = 'none';
}

export function switchImportTab(tab: string) {
  currentImportTab = tab;
  const tabUrl = document.getElementById('tabImportUrl');
  const tabFile = document.getElementById('tabImportFile');
  const secUrl = document.getElementById('sectionImportUrl');
  const secFile = document.getElementById('sectionImportFile');

  if (tab === 'url') {
    if (tabUrl) tabUrl.className = 'btn-primary';
    if (tabFile) tabFile.className = 'btn-secondary';
    if (secUrl) secUrl.style.display = 'block';
    if (secFile) secFile.style.display = 'none';
  } else {
    if (tabUrl) tabUrl.className = 'btn-secondary';
    if (tabFile) tabFile.className = 'btn-primary';
    if (secUrl) secUrl.style.display = 'none';
    if (secFile) secFile.style.display = 'block';
  }
}

export async function submitImportPreset() {
  const isRu = state.currentLang === 'ru';
  const errBox = document.getElementById('importPresetError');
  if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }

  const tag = ((document.getElementById('importPresetTag') as HTMLInputElement)?.value || '').trim();
  const name = ((document.getElementById('importPresetName') as HTMLInputElement)?.value || '').trim();
  const category = (document.getElementById('importPresetCategory') as HTMLSelectElement)?.value || 'custom';
  const type = (document.getElementById('importPresetType') as HTMLSelectElement)?.value || 'domain';

  if (!tag) {
    if (errBox) {
      errBox.textContent = isRu ? 'Укажите системный идентификатор (tag/id)' : 'Specify system identifier (tag/id)';
      errBox.style.display = 'block';
    }
    return;
  }
  if (!name) {
    if (errBox) {
      errBox.textContent = isRu ? 'Укажите понятное имя пресета' : 'Specify human-readable preset name';
      errBox.style.display = 'block';
    }
    return;
  }

  const submitBtn = document.getElementById('btnSubmitImportPreset') as HTMLButtonElement | null;

  if (currentImportTab === 'url') {
    const url = ((document.getElementById('importPresetUrlInput') as HTMLInputElement)?.value || '').trim();
    if (!url) {
      if (errBox) {
        errBox.textContent = isRu ? 'Укажите прямой URL источника' : 'Specify source URL';
        errBox.style.display = 'block';
      }
      return;
    }

    try {
      if (submitBtn) submitBtn.disabled = true;
      const res = await adminFetch('/api/routing/presets/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, tag, name, category, type })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || ('HTTP ' + res.status));
      }
      toast((isRu ? 'Пресетов импортировано! Записей: ' : 'Preset imported! Entries: ') + (data.preset ? data.preset.entriesCount : ''), 'success');
      closeImportPresetsModal();
      loadPresets();
    } catch (e: any) {
      if (errBox) {
        errBox.textContent = (isRu ? 'Ошибка импорта: ' : 'Import error: ') + e.message;
        errBox.style.display = 'block';
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  } else {
    // File Upload
    const fileInput = document.getElementById('importPresetFileInput') as HTMLInputElement | null;
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      if (errBox) {
        errBox.textContent = isRu ? 'Выберите файл для загрузки' : 'Select a file to upload';
        errBox.style.display = 'block';
      }
      return;
    }
    const file = fileInput.files[0];

    try {
      if (submitBtn) submitBtn.disabled = true;
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const res = reader.result;
          if (typeof res === 'string') {
            const b64 = res.includes(',') ? res.split(',')[1] : res;
            resolve(b64);
          } else {
            reject(new Error('Failed to read file'));
          }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });

      const res = await adminFetch('/api/routing/presets/import-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          content: base64Data,
          encoding: 'base64',
          tag,
          name,
          category,
          type
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || ('HTTP ' + res.status));
      }
      toast((isRu ? 'Файл пресета импортирован! Записей: ' : 'Preset file imported! Entries: ') + (data.preset ? data.preset.entriesCount : ''), 'success');
      closeImportPresetsModal();
      loadPresets();
    } catch (e: any) {
      if (errBox) {
        errBox.textContent = (isRu ? 'Ошибка импорта: ' : 'Import error: ') + e.message;
        errBox.style.display = 'block';
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }
}

export async function createNewProfile() {
  const isRu = (typeof state.currentLang !== 'undefined' ? state.currentLang : 'ru') === 'ru';
  const name = await pecPrompt(isRu ? 'Введите название нового профиля маршрутизации:' : 'Enter name for the new Routing Profile:', 'New Department Profile');
  if (!name) return;
  const newP = {
    id: 'prof_' + Math.random().toString(36).substring(2, 8),
    name: name,
    description: 'Custom routing profile',
    defaultPolicy: 'direct',
    targetScope: 'all',
    rules: []
  };
  try {
    const res = await adminFetch('/api/routing/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newP)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast('Failed to create profile: ' + (data.error || ('HTTP ' + res.status)), 'error');
      return;
    }
    const saved = await res.json();
    state.allProfiles.push(saved);
    state.currentProfile = saved;
    (window as any).currentProfile = state.currentProfile;

    const sel = document.getElementById('profileSelect') as HTMLSelectElement | null;
    if (sel) {
      const opt = document.createElement('option');
      opt.value = saved.id;
      opt.textContent = saved.name;
      opt.selected = true;
      sel.appendChild(opt);
    }

    renderProfile(saved);
    toast('Profile created on the server. Remember to add rules and press Save after editing.', 'success');
  } catch (e) {
    toast('Error creating profile: ' + e, 'error');
  }
}

export async function deleteCurrentProfile() {
  if (!state.currentProfile) return;
  if (!await pecConfirm('Are you sure you want to delete profile "' + state.currentProfile.name + '"?', { isDanger: true })) return;
  try {
    const res = await adminFetch('/api/routing/profiles/' + state.currentProfile.id, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      toast('Profile deleted', 'success');
      loadProfiles();
    } else {
      toast('Delete error: ' + (data.error || 'Failed'), 'error');
    }
  } catch (e) {
    toast('Error: ' + e, 'error');
  }
}

// Modal closers
registerModalCloser('modalEditRule', closeEditRuleModal);
registerModalCloser('modalGeobaseInspector', closeGeobaseInspector);
registerModalCloser('modalImportPresets', closeImportPresetsModal);
