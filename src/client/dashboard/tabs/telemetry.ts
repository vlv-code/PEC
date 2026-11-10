// Telemetry, Fleet, GPO, 3x-ui & Releases Tab Module for PEC Dashboard
import { state } from '../core/state.js';
import { adminFetch, esc, escapeHtml, extractError } from '../core/api.js';
import { toast, pecConfirm, pecPrompt, registerModalCloser } from '../core/notify.js';
import { t, I18N } from '../core/theme.js';
import { openEditRuleModal, moveRuleUp, moveRuleDown, removeRule, openGeobaseInspector, addPresetRule, toggleRuleEnabled, toggleInspectorEntry } from './routing.js';
import { deleteAppProcessRule, updateAppProcessRuleField } from './studio.js';
import { activateProxy, checkProxy, syncProxy, openEditProxyModal, deleteProxy, fetchProxies } from './proxies.js';

declare let currentLang: string;
declare const formatRelativeTime: any;
let loadInstancesSeq = 0;
let loadDesktopInstancesSeq = 0;
let fetchStatusSeq = 0;
let currentProxiesList: any[] = [];
export let allProfiles: any[] = [];
export let globalGpo: any = null;
export let globalKillSwitch = false;

if (typeof window !== 'undefined' && !('currentLang' in window)) {
  Object.defineProperty(window, 'currentLang', {
    get() { return state.currentLang || 'ru'; },
    set(v) { state.currentLang = v; },
    configurable: true
  });
}

    // ----------------- Devices & Instances -----------------
export let lastLoadedInstances = [];
export let selectedFleetInstances = new Set();
export let fleetSortCol = 'lastSync';
export let fleetSortAsc = false;
export let fleetListenersInitialized = false;
export let lastFleetFetchTime = 0;

    export async function loadInstances() {
      const seq = ++loadInstancesSeq;
      try {
        if (!currentProxiesList || !currentProxiesList.length) {
          try {
            const pRes = await adminFetch('/api/proxies');
            if (pRes.ok) currentProxiesList = (await pRes.json()) || [];
          } catch (_) {}
        }
        const res = await adminFetch('/api/instances');
        if (seq < loadInstancesSeq) return;
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        const data = await res.json();
        if (seq < loadInstancesSeq) return;

        lastFleetFetchTime = Date.now();
        const staleBadge = document.getElementById('badgeFleetStale');
        if (staleBadge) {
          staleBadge.style.display = 'none';
        }

        const isRu = currentLang === 'ru';
        const badge = document.getElementById('badgeFleetOnline');
        if (badge) {
          badge.textContent = data.online + (isRu ? ' онлайн' : ' online');
        }
        lastLoadedInstances = data.instances || [];
        renderInstancesTable(lastLoadedInstances);
        loadDesktopInstances();
        initFleetListeners();
      } catch (e) {
        console.error(e);
        const staleBadge = document.getElementById('badgeFleetStale');
        if (staleBadge) {
          const isRu = currentLang === 'ru';
          const timeStr = lastFleetFetchTime ? new Date(lastFleetFetchTime).toLocaleTimeString() : (isRu ? 'нет связи' : 'no connection');
          staleBadge.textContent = (isRu ? 'Данные устарели (' : 'Stale data (') + timeStr + ')';
          staleBadge.style.display = 'inline-block';
        }
      }
    }

    export async function fetchFleet() {
      return loadInstances();
    }

    export function renderInstancesTable(instances) {
      const isRu = currentLang === 'ru';
      const tbody = document.getElementById('fleetTableBody');
      if (!tbody) return;

      // Update header indicators
      document.querySelectorAll('#instancesTable th.sortable-th').forEach(th => {
        const col = th.getAttribute('data-sort');
        th.classList.remove('sort-asc', 'sort-desc');
        if (col === fleetSortCol) {
          th.classList.add(fleetSortAsc ? 'sort-asc' : 'sort-desc');
          th.setAttribute('aria-sort', fleetSortAsc ? 'ascending' : 'descending');
        } else {
          th.setAttribute('aria-sort', 'none');
        }
      });

      if (!instances || !instances.length) {
        selectedFleetInstances.clear();
        updateFleetBulkBar();
        tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Пока нет подключенных устройств. Расширения синхронизируются через <code>/api/sync</code> каждые 5 мин.' : 'No instances connected yet. Extensions sync via <code>/api/sync</code> every 5 min.') + '</td></tr>';
        tbody.removeAttribute('data-rendered-sig');
        return;
      }

      // Non-destructive rendering guard: preserve focus and selection
      if (tbody.contains(document.activeElement)) return;
      const sel = window.getSelection ? window.getSelection() : null;
      if (sel && sel.toString() && tbody.contains(sel.anchorNode)) return;

      // Dirty-diff check using serialized signature
      const currentSig = instances.map(i => `${i.instanceId}:${i.status}:${i.assignedProfileId || ''}:${i.assignedProxyId || ''}:${i.syncCount || 0}:${i.lastHeartbeat || ''}:${i.tokenHash ? 1 : 0}:${i.revoked ? 1 : 0}:${i.username || ''}:${i.pairedAppId || ''}`).join(';') + `;sort:${fleetSortCol}:${fleetSortAsc}`;
      if (tbody.getAttribute('data-rendered-sig') === currentSig) {
        return;
      }

      const defaultProxy = (currentProxiesList || []).find(p => p.isActive || p.active);
      const defaultHostPort = defaultProxy && defaultProxy.host ? (defaultProxy.host.includes(':') && !defaultProxy.host.startsWith('[') ? '[' + defaultProxy.host + ']:' + defaultProxy.port : defaultProxy.host + ':' + defaultProxy.port) : '';
      const defaultProxyName = defaultProxy
        ? (defaultProxy.name || defaultHostPort)
        : (isRu ? 'Серверный по умолчанию' : 'Server Default');

      // Sort instances
      const sortedInstances = [...instances].sort((a, b) => {
        let vA = '';
        let vB = '';
        if (fleetSortCol === 'id') {
          vA = a.instanceId || '';
          vB = b.instanceId || '';
        } else if (fleetSortCol === 'user') {
          vA = a.username || '';
          vB = b.username || '';
        } else if (fleetSortCol === 'ip') {
          vA = a.ip || '';
          vB = b.ip || '';
        } else if (fleetSortCol === 'version') {
          vA = a.version || '';
          vB = b.version || '';
        } else if (fleetSortCol === 'group') {
          vA = a.group || '';
          vB = b.group || '';
        } else if (fleetSortCol === 'profile') {
          vA = a.appliedProfileName || '';
          vB = b.appliedProfileName || '';
        } else if (fleetSortCol === 'syncs') {
          const diff = (Number(a.syncCount) || 0) - (Number(b.syncCount) || 0);
          return fleetSortAsc ? diff : -diff;
        } else if (fleetSortCol === 'status') {
          vA = a.status || '';
          vB = b.status || '';
        } else { // default 'lastSync'
          const tA = a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0;
          const tB = b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0;
          return fleetSortAsc ? (tA - tB) : (tB - tA);
        }
        const cmp = String(vA).localeCompare(String(vB));
        return fleetSortAsc ? cmp : -cmp;
      });

      // Memoize profile and proxy structures to avoid re-looping on every instance
      const memoizedProfiles = (state.allProfiles || allProfiles || []).map(p => ({
        id: p.id,
        name: esc(p.name)
      }));

      const memoizedProxies = (currentProxiesList || []).map(p => {
        const pHostPort = p.host && p.host.includes(':') && !p.host.startsWith('[') ? '[' + p.host + ']:' + p.port : p.host + ':' + p.port;
        const pName = p.name || pHostPort;
        return {
          id: p.id,
          label: `${esc(pName)} (${esc(p.protocol)})`
        };
      });

      tbody.innerHTML = sortedInstances.map(inst => {
        let badge = 'badge-online';
        if (inst.status === 'STALE') badge = 'badge-stale';
        else if (inst.status === 'OFFLINE') badge = 'badge-offline';

        const hasToken = Boolean(inst.tokenHash);
        const tokenBadge = hasToken
          ? '<span class="badge badge-success" title="' + (isRu ? 'Индивидуальный токен выдан' : 'Enrolled per-instance token') + '">🔑 ' + (isRu ? 'Токен' : 'Token') + '</span>'
          : (inst.revoked
            ? '<span class="badge badge-danger" title="' + (isRu ? 'Токен отозван' : 'Token revoked') + '">🚫 ' + (isRu ? 'Отозван' : 'Revoked') + '</span>'
            : '<span class="badge badge-secondary" title="' + (isRu ? 'Использует общий токен' : 'Using shared token') + '">' + (isRu ? 'Общий' : 'Shared') + '</span>');

        const revokeBtnHtml = hasToken
          ? '<button class="btn btn-sm btn-warning btn-revoke-token" data-id="' + escapeHtml(inst.instanceId) + '" title="' + (isRu ? 'Отозвать индивидуальный токен' : 'Revoke token') + '">🚫</button>'
          : '';

        const isChecked = selectedFleetInstances.has(inst.instanceId);

        const profileOptions = memoizedProfiles.map(p => {
          const sel = (inst.assignedProfileId === p.id) ? ' selected' : '';
          return `<option value="${esc(p.id)}"${sel}>${esc(p.name)}</option>`;
        }).join('');

        const proxyOptions = memoizedProxies.map(p => {
          const sel = inst.assignedProxyId === p.id ? ' selected' : '';
          return `<option value="${esc(p.id)}"${sel}>${esc(p.label)}</option>`;
        }).join('');

        const pairedBadge = inst.pairedAppId
          ? `<span class="badge badge-success" title="${isRu ? 'Связано с десктоп-агентом (' + esc(inst.pairedHostname || '') + ')' : 'Paired with desktop app (' + esc(inst.pairedHostname || '') + ')'}">🔗 ${isRu ? 'Десктоп' : 'Desktop'}</span>`
          : '';
        const userDisplay = inst.username
          ? `<div style="font-weight: 600; font-family: var(--mono); font-size: 12px;">${esc(inst.username)}</div>${pairedBadge ? '<div style="margin-top: 3px;">' + pairedBadge + '</div>' : ''}`
          : `<span style="color: var(--text-muted);">—</span>`;

        return `<tr>
          <td style="text-align: center;">
            <input type="checkbox" class="fleet-row-checkbox" data-id="${esc(inst.instanceId)}" ${isChecked ? 'checked' : ''}>
          </td>
          <td>
            <code>${esc(inst.instanceId)}</code>
            <div style="margin-top: 4px;">${tokenBadge}</div>
          </td>
          <td>${userDisplay}</td>
          <td style="font-family: var(--mono);">${esc(inst.ip)}</td>
          <td>v${esc(inst.version)}</td>
          <td><code>${esc(inst.group || (isRu ? 'Основная группа' : 'Default Group'))}</code></td>
          <td><span class="badge badge-action-proxy">${esc(inst.appliedProfileName || (isRu ? 'По умолчанию' : 'Default'))}</span></td>
          <td>${esc(inst.syncCount)}</td>
          <td><span class="badge ${badge}">${esc(inst.status)}</span></td>
          <td>
            <select class="form-select form-select-sm select-instance-profile" data-instance-id="${escapeHtml(inst.instanceId)}" data-prev-value="${esc(inst.assignedProfileId || '')}" style="margin-bottom: 0; font-size: 11px; padding: 3px 6px;">
              <option value="">${isRu ? 'По умолчанию (Авто)' : 'Default (Auto)'}</option>
              ${profileOptions}
            </select>
          </td>
          <td>
            <select class="form-select form-select-sm select-instance-proxy" data-instance-id="${escapeHtml(inst.instanceId)}" data-prev-value="${esc(inst.assignedProxyId || '')}" style="margin-bottom: 0; font-size: 11px; padding: 3px 6px;">
              <option value="">${isRu ? 'По умолчанию (' + esc(defaultProxyName) + ')' : 'Default (' + esc(defaultProxyName) + ')'}</option>
              ${proxyOptions}
            </select>
          </td>
          <td>
            <div style="display: inline-flex; gap: 6px; align-items: center;">
              ${revokeBtnHtml}
              <button class="btn btn-sm btn-danger btn-delete-instance" data-id="${escapeHtml(inst.instanceId)}" title="${isRu ? 'Удалить устройство' : 'Delete device'}"><img src="/icons/trash.png" class="icon-inline-sm" alt="del"></button>
            </div>
          </td>
        </tr>`;
      }).join('');

      tbody.setAttribute('data-rendered-sig', currentSig);
      updateFleetBulkBar();
    }

    export function updateFleetBulkBar() {
      const isRu = currentLang === 'ru';
      const bar = document.getElementById('fleetBulkBar');
      const countEl = document.getElementById('fleetSelectedCount');
      const selectAll = document.getElementById('fleetSelectAll');

      const count = selectedFleetInstances.size;
      if (countEl) countEl.textContent = String(count);

      if (bar) {
        bar.style.display = count > 0 ? 'flex' : 'none';
      }

      if (selectAll) {
        const total = (lastLoadedInstances || []).length;
        if (total > 0 && count === total) {
          selectAll.checked = true;
          selectAll.indeterminate = false;
        } else if (count > 0) {
          selectAll.checked = false;
          selectAll.indeterminate = true;
        } else {
          selectAll.checked = false;
          selectAll.indeterminate = false;
        }
      }

      // Populate bulk selects
      const proxySelect = document.getElementById('bulkAssignProxySelect');
      if (proxySelect) {
        const currentVal = proxySelect.value;
        const defaultProxy = (currentProxiesList || []).find(p => p.isActive || p.active);
        const defaultHostPort = defaultProxy && defaultProxy.host ? (defaultProxy.host.includes(':') && !defaultProxy.host.startsWith('[') ? '[' + defaultProxy.host + ']:' + defaultProxy.port : defaultProxy.host + ':' + defaultProxy.port) : '';
        const defaultProxyName = defaultProxy ? (defaultProxy.name || defaultHostPort) : (isRu ? 'Серверный по умолчанию' : 'Server Default');
        
        proxySelect.innerHTML = `<option value="">${isRu ? 'По умолчанию (' + esc(defaultProxyName) + ')' : 'Default (' + esc(defaultProxyName) + ')'}</option>` +
          (currentProxiesList || []).map(p => {
            const pHostPort = p.host && p.host.includes(':') && !p.host.startsWith('[') ? '[' + p.host + ']:' + p.port : p.host + ':' + p.port;
            const pName = p.name || pHostPort;
            return `<option value="${esc(p.id)}">${esc(pName)} (${esc(p.protocol)})</option>`;
          }).join('');
        if (currentVal) proxySelect.value = currentVal;
      }

      const profileSelect = document.getElementById('bulkAssignProfileSelect');
      if (profileSelect) {
        const currentVal = profileSelect.value;
        profileSelect.innerHTML = `<option value="">${isRu ? 'По умолчанию (Авто)' : 'Default (Auto)'}</option>` +
          (state.allProfiles || allProfiles || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
        if (currentVal) profileSelect.value = currentVal;
      }
    }

    export async function bulkAssignProxy() {
      const isRu = currentLang === 'ru';
      if (!selectedFleetInstances.size) return;
      const proxySelect = document.getElementById('bulkAssignProxySelect');
      const proxyId = proxySelect ? proxySelect.value : '';
      try {
        const res = await adminFetch('/api/instances/bulk-assign-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceIds: Array.from(selectedFleetInstances),
            proxyId: proxyId || undefined
          })
        });
        if (res.ok) {
          toast(isRu ? `Прокси назначен для ${selectedFleetInstances.size} устройств` : `Proxy assigned to ${selectedFleetInstances.size} devices`, 'success');
          selectedFleetInstances.clear();
          loadInstances();
        } else {
          const d = await res.json().catch(() => ({}));
          toast('Bulk proxy error: ' + (d.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Bulk proxy error: ' + err, 'error');
      }
    }

    export async function bulkAssignProfile() {
      const isRu = currentLang === 'ru';
      if (!selectedFleetInstances.size) return;
      const profileSelect = document.getElementById('bulkAssignProfileSelect');
      const profileId = profileSelect ? profileSelect.value : '';
      try {
        const res = await adminFetch('/api/instances/bulk-assign-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceIds: Array.from(selectedFleetInstances),
            profileId
          })
        });
        if (res.ok) {
          toast(isRu ? `Профиль назначен для ${selectedFleetInstances.size} устройств` : `Profile assigned to ${selectedFleetInstances.size} devices`, 'success');
          selectedFleetInstances.clear();
          loadInstances();
        } else {
          const d = await res.json().catch(() => ({}));
          toast('Bulk profile error: ' + (d.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Bulk profile error: ' + err, 'error');
      }
    }

    export async function bulkRevokeTokens() {
      const isRu = currentLang === 'ru';
      const count = selectedFleetInstances.size;
      if (!count) return;
      if (!await pecConfirm(isRu ? `Отозвать индивидуальные токены для ${count} устройств?` : `Revoke tokens for ${count} devices?`, { isDanger: true })) return;
      try {
        const res = await adminFetch('/api/instances/bulk-revoke-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceIds: Array.from(selectedFleetInstances)
          })
        });
        if (res.ok) {
          toast(isRu ? 'Токены успешно отозваны' : 'Tokens successfully revoked', 'success');
          selectedFleetInstances.clear();
          loadInstances();
        } else {
          const d = await res.json().catch(() => ({}));
          toast('Bulk revoke error: ' + (d.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Bulk revoke error: ' + err, 'error');
      }
    }

    export async function bulkDeleteInstances() {
      const isRu = currentLang === 'ru';
      const count = selectedFleetInstances.size;
      if (!count) return;
      if (!await pecConfirm(isRu ? `Удалить ${count} выбранных устройств из флота?` : `Delete ${count} selected devices from fleet?`, { isDanger: true })) return;
      try {
        const res = await adminFetch('/api/instances/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instanceIds: Array.from(selectedFleetInstances)
          })
        });
        if (res.ok) {
          toast(isRu ? 'Устройства успешно удалены' : 'Devices deleted successfully', 'success');
          selectedFleetInstances.clear();
          loadInstances();
        } else {
          const d = await res.json().catch(() => ({}));
          toast('Bulk delete error: ' + (d.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Bulk delete error: ' + err, 'error');
      }
    }

export let lastLoadedDesktopInstances = [];

    export async function loadDesktopInstances() {
      const seq = ++loadDesktopInstancesSeq;
      try {
        if (!currentProxiesList || !currentProxiesList.length) {
          try {
            const pRes = await adminFetch('/api/proxies');
            if (pRes.ok) currentProxiesList = (await pRes.json()) || [];
          } catch (_) {}
        }
        const res = await adminFetch('/api/app/instances');
        if (seq < loadDesktopInstancesSeq) return;
        if (!res.ok) return;
        const data = await res.json();
        if (seq < loadDesktopInstancesSeq) return;
        lastLoadedDesktopInstances = data.instances || [];
        renderDesktopInstancesTable(lastLoadedDesktopInstances);
      } catch (err) {
        console.warn('Failed to load desktop instances:', err);
      }
    }

    export function renderDesktopInstancesTable(instances) {
      const isRu = currentLang === 'ru';
      const tbody = document.getElementById('desktopFleetTableBody');
      const badge = document.getElementById('badgeDesktopOnline');
      if (!tbody) return;

      const onlineCount = (instances || []).filter(i => i.status === 'ONLINE').length;
      if (badge) {
        badge.textContent = onlineCount + (isRu ? ' онлайн' : ' online');
        badge.className = 'badge ' + (onlineCount > 0 ? 'badge-online' : 'badge-offline');
      }

      if (!instances || !instances.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">' +
          (isRu ? 'Десктопные клиенты еще не подключались. Запустите PEC-App.exe на рабочей станции.' : 'No desktop clients connected yet. Launch PEC-App.exe on a workstation.') +
          '</td></tr>';
        tbody.removeAttribute('data-rendered-sig');
        return;
      }

      // Non-destructive rendering guard: preserve focus and selection
      if (tbody.contains(document.activeElement)) return;
      const sel = window.getSelection ? window.getSelection() : null;
      if (sel && sel.toString() && tbody.contains(sel.anchorNode)) return;

      const sig = instances.map(i => `${i.appInstanceId}:${i.status}:${i.assignedProxyId || ''}:${i.lastSync || ''}`).join('|');
      if (tbody.getAttribute('data-rendered-sig') === sig) return;

      const proxies = currentProxiesList || [];
      tbody.innerHTML = instances.map(inst => {
        let badgeClass = 'badge-online';
        if (inst.status === 'STALE') badgeClass = 'badge-stale';
        else if (inst.status === 'OFFLINE') badgeClass = 'badge-offline';

        const pairedBadge = inst.pairedExtension?.instanceId
          ? `<span class="badge badge-success" title="ID: ${esc(inst.pairedExtension.instanceId)}">🔗 ${esc(inst.pairedExtension.instanceId.slice(0, 14))}... (${esc(inst.pairedExtension.browser || 'ext')})</span>`
          : `<span style="color: var(--text-muted); font-size: 11px;">${isRu ? 'Не привязано' : 'Not paired'}</span>`;

        let proxyOptions = `<option value="default">${isRu ? 'По умолчанию' : 'Default'}</option>`;
        proxies.forEach(p => {
          const pHostPort = (p.host || '') + ':' + (p.port || '');
          const pName = p.name || pHostPort;
          const isSel = (inst.assignedProxyId === p.id);
          proxyOptions += `<option value="${esc(p.id)}" ${isSel ? 'selected' : ''}>${esc(pName)}</option>`;
        });

        const syncTime = inst.lastSync ? (typeof formatRelativeTime === 'function' ? formatRelativeTime(inst.lastSync) : new Date(inst.lastSync).toLocaleTimeString()) : '-';

        return `<tr>
          <td><span class="badge ${badgeClass}">${esc(inst.status || 'ONLINE')}</span></td>
          <td><strong>${esc(inst.hostname || '-')}</strong></td>
          <td><span class="badge badge-subtle">👤 ${esc(inst.username || '-')}</span></td>
          <td><code>${esc(inst.ip || '-')}</code></td>
          <td><span class="badge badge-version">v${esc(inst.version || '2.2.0')}</span></td>
          <td>${pairedBadge}</td>
          <td>
            <select class="form-select form-select-sm desktop-proxy-select" data-app-id="${esc(inst.appInstanceId)}" data-prev-value="${esc(inst.assignedProxyId || 'default')}" style="font-size: 12px; max-width: 170px; margin-bottom: 0;">
              ${proxyOptions}
            </select>
          </td>
          <td style="font-size: 11px; color: var(--text-muted);">${esc(syncTime)}</td>
          <td style="text-align: center;">
            <button type="button" class="btn btn-sm btn-icon btn-danger btn-delete-desktop" data-app-id="${esc(inst.appInstanceId)}" title="${isRu ? 'Удалить из реестра' : 'Delete'}">🗑️</button>
          </td>
        </tr>`;
      }).join('');
      tbody.setAttribute('data-rendered-sig', sig);
    }

    export function initFleetListeners() {
      if (fleetListenersInitialized) return;
      fleetListenersInitialized = true;

      const selectAll = document.getElementById('fleetSelectAll');
      if (selectAll) {
        selectAll.addEventListener('change', () => {
          if (selectAll.checked) {
            (lastLoadedInstances || []).forEach(i => { selectedFleetInstances.add(i.instanceId); });
          } else {
            selectedFleetInstances.clear();
          }
          renderInstancesTable(lastLoadedInstances);
        });
      }

      const tbody = document.getElementById('fleetTableBody');
      if (tbody) {
        tbody.addEventListener('change', (e) => {
          const target = e.target;
          if (target && target.classList.contains('fleet-row-checkbox')) {
            const id = target.getAttribute('data-id');
            if (id) {
              if (target.checked) selectedFleetInstances.add(id);
              else selectedFleetInstances.delete(id);
              updateFleetBulkBar();
            }
          }
        });
      }

      const table = document.getElementById('instancesTable');
      if (table) {
        const handleSort = (th) => {
          if (!th) return;
          const col = th.getAttribute('data-sort');
          if (col) {
            if (fleetSortCol === col) {
              fleetSortAsc = !fleetSortAsc;
            } else {
              fleetSortCol = col;
              fleetSortAsc = true;
            }
            renderInstancesTable(lastLoadedInstances);
          }
        };

        table.addEventListener('click', (e) => {
          const th = e.target.closest('th.sortable-th');
          if (th) handleSort(th);
        });

        table.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            const th = e.target.closest('th.sortable-th');
            if (th) {
              e.preventDefault();
              handleSort(th);
            }
          }
        });
      }

      const btnBulkProxy = document.getElementById('btnBulkAssignProxy');
      if (btnBulkProxy) btnBulkProxy.addEventListener('click', bulkAssignProxy);
      const btnBulkProfile = document.getElementById('btnBulkAssignProfile');
      if (btnBulkProfile) btnBulkProfile.addEventListener('click', bulkAssignProfile);
      const btnBulkRevoke = document.getElementById('btnBulkRevokeTokens');
      if (btnBulkRevoke) btnBulkRevoke.addEventListener('click', bulkRevokeTokens);
      const btnBulkDel = document.getElementById('btnBulkDelete');
      if (btnBulkDel) btnBulkDel.addEventListener('click', bulkDeleteInstances);
      const btnRefreshDesktop = document.getElementById('btnRefreshDesktopFleet');
      if (btnRefreshDesktop) {
        btnRefreshDesktop.addEventListener('click', () => loadDesktopInstances());
      }

      const desktopTbody = document.getElementById('desktopFleetTableBody');
      if (desktopTbody) {
        desktopTbody.addEventListener('change', async (e) => {
          const sel = e.target.closest('.desktop-proxy-select');
          if (!sel) return;
          const appId = sel.getAttribute('data-app-id');
          const proxyId = sel.value;
          try {
            const res = await adminFetch(`/api/app/instances/${encodeURIComponent(appId)}/assign-proxy`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ proxyId }),
            });
            if (res.ok) {
              sel.setAttribute('data-prev-value', proxyId);
              toast(currentLang === 'ru' ? 'Прокси успешно назначен клиенту' : 'Proxy assigned to client', 'success');
              loadDesktopInstances();
            } else {
              sel.value = sel.getAttribute('data-prev-value') || 'default';
              toast(currentLang === 'ru' ? 'Не удалось назначить прокси' : 'Failed to assign proxy', 'error');
            }
          } catch (err) {
            sel.value = sel.getAttribute('data-prev-value') || 'default';
            toast((currentLang === 'ru' ? 'Ошибка: ' : 'Error: ') + err.message, 'error');
          }
        });

        desktopTbody.addEventListener('click', async (e) => {
          const btn = e.target.closest('.btn-delete-desktop');
          if (!btn) return;
          const appId = btn.getAttribute('data-app-id');
          const isRu = currentLang === 'ru';
          if (!await pecConfirm(isRu ? 'Удалить десктопный клиент из реестра?' : 'Delete desktop client from registry?', { isDanger: true })) return;
          try {
            const res = await adminFetch(`/api/app/instances/${encodeURIComponent(appId)}`, {
              method: 'DELETE',
            });
            if (res.ok) {
              toast(isRu ? 'Клиент удален' : 'Client deleted', 'success');
              loadDesktopInstances();
            } else {
              toast(isRu ? 'Не удалось удалить клиента' : 'Failed to delete client', 'error');
            }
          } catch (err) {
            toast((isRu ? 'Ошибка: ' : 'Error: ') + err.message, 'error');
          }
        });
      }
    }

    export async function revokeInstanceToken(id) {
      const isRu = currentLang === 'ru';
      if (!await pecConfirm((isRu ? 'Отозвать токен доступа для ' : 'Revoke access token for ') + id + '?', { isDanger: true })) return;
      try {
        const res = await adminFetch('/api/instances/' + encodeURIComponent(id) + '/revoke-token', {
          method: 'POST'
        });
        if (res.ok || res.status === 200) {
          toast(isRu ? 'Токен успешно отозван' : 'Token successfully revoked', 'success');
          loadInstances();
        } else {
          const errData = await res.json().catch(() => ({}));
          toast('Revoke error: ' + (errData.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Revoke error: ' + err, 'error');
      }
    }

    export async function deleteInstance(id) {
      if (!await pecConfirm("Удалить устройство " + id + "?", { isDanger: true })) return;
      try {
        const res = await adminFetch('/api/instances/' + encodeURIComponent(id), {
          method: 'DELETE'
        });
        if (res.ok || res.status === 200) {
          toast(currentLang === 'ru' ? 'Устройство успешно удалено' : 'Device deleted successfully', 'success');
          loadInstances();
        } else {
          const errData = await res.json().catch(() => ({}));
          toast('Delete error: ' + (errData.error || res.statusText), 'error');
        }
      } catch (err) {
        toast('Delete error: ' + err, 'error');
      }
    }

    document.addEventListener('click', function (e) {
      const revokeBtn = e.target.closest('.btn-revoke-token');
      if (revokeBtn) {
        const id = revokeBtn.getAttribute('data-id');
        if (id) revokeInstanceToken(id);
        return;
      }
      const btn = e.target.closest('.btn-delete-instance');
      if (btn) {
        const id = btn.getAttribute('data-id');
        if (id) deleteInstance(id);
        return;
      }
      const inspectPresetBtn = e.target.closest('.btn-inspect-geobase');
      if (inspectPresetBtn) {
        const id = inspectPresetBtn.getAttribute('data-id');
        if (id) openGeobaseInspector(id);
        return;
      }
      const addPresetBtn = e.target.closest('.btn-add-preset-rule');
      if (addPresetBtn) {
        const id = addPresetBtn.getAttribute('data-id');
        const name = addPresetBtn.getAttribute('data-name');
        const action = addPresetBtn.getAttribute('data-action');
        if (id && name && action) addPresetRule(id, name, action);
        return;
      }
      const reorderUpBtn = e.target.closest('.btn-reorder-up');
      if (reorderUpBtn) {
        const idx = reorderUpBtn.getAttribute('data-index');
        if (idx !== null) moveRuleUp(parseInt(idx, 10));
        return;
      }
      const reorderDownBtn = e.target.closest('.btn-reorder-down');
      if (reorderDownBtn) {
        const idx = reorderDownBtn.getAttribute('data-index');
        if (idx !== null) moveRuleDown(parseInt(idx, 10));
        return;
      }
      const editRuleBtn = e.target.closest('.btn-edit-rule');
      if (editRuleBtn) {
        const idx = editRuleBtn.getAttribute('data-index');
        if (idx !== null) openEditRuleModal(parseInt(idx, 10));
        return;
      }
      const removeRuleBtn = e.target.closest('.btn-remove-rule');
      if (removeRuleBtn) {
        const idx = removeRuleBtn.getAttribute('data-index');
        if (idx !== null) removeRule(parseInt(idx, 10));
        return;
      }
      const delAppRuleBtn = e.target.closest('.btn-delete-app-rule');
      if (delAppRuleBtn) {
        const idx = delAppRuleBtn.getAttribute('data-index');
        if (idx !== null) deleteAppProcessRule(parseInt(idx, 10));
        return;
      }
      const actProxyBtn = e.target.closest('.btn-activate-proxy');
      if (actProxyBtn) {
        const id = actProxyBtn.getAttribute('data-id');
        if (id) activateProxy(id);
        return;
      }
      const checkProxyBtn = e.target.closest('.btn-check-proxy');
      if (checkProxyBtn) {
        const id = checkProxyBtn.getAttribute('data-id');
        if (id) checkProxy(id);
        return;
      }
      const syncProxyBtn = e.target.closest('.btn-sync-proxy');
      if (syncProxyBtn) {
        const id = syncProxyBtn.getAttribute('data-id');
        if (id) syncProxy(id);
        return;
      }
      const editProxyBtn = e.target.closest('.btn-edit-proxy');
      if (editProxyBtn) {
        const id = editProxyBtn.getAttribute('data-id');
        if (id) openEditProxyModal(id);
        return;
      }
      const delProxyBtn = e.target.closest('.btn-delete-proxy');
      if (delProxyBtn) {
        const id = delProxyBtn.getAttribute('data-id');
        if (id) deleteProxy(id);
        return;
      }
      const setActiveRelBtn = e.target.closest('.btn-set-active-release');
      if (setActiveRelBtn) {
        const type = setActiveRelBtn.getAttribute('data-type');
        const version = setActiveRelBtn.getAttribute('data-version');
        if (type && version) setActiveReleaseVersion(type, version);
        return;
      }
      const downloadRelBtn = e.target.closest('.btn-download-release');
      if (downloadRelBtn) {
        const type = downloadRelBtn.getAttribute('data-type');
        const version = downloadRelBtn.getAttribute('data-version');
        const filename = downloadRelBtn.getAttribute('data-filename');
        if (type && version) downloadReleaseVersion(type, version, filename);
        return;
      }
      const delRelBtn = e.target.closest('.btn-delete-release');
      if (delRelBtn) {
        const type = delRelBtn.getAttribute('data-type');
        const version = delRelBtn.getAttribute('data-version');
        if (type && version) deleteReleaseVersion(type, version);
        return;
      }
    });

    export async function assignProfileToInstance(instanceId, profileId, selectEl) {
      const el = selectEl || document.querySelector(`.select-instance-profile[data-instance-id="${instanceId}"]`);
      try {
        const res = await adminFetch('/api/instances/assign-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId, profileId })
        });
        if (res.ok) {
          toast(currentLang === 'ru' ? 'Профиль для инстанса обновлен' : 'Instance profile updated', 'success');
          if (el) el.setAttribute('data-prev-value', profileId || '');
          loadInstances();
        } else {
          const err = await res.json().catch(() => ({}));
          const errMsg = extractError(res, err, 'HTTP ' + res.status);
          toast(errMsg, 'error');
          if (el) el.value = el.getAttribute('data-prev-value') || '';
        }
      } catch (e) {
        toast('Assignment error: ' + e, 'error');
        if (el) el.value = el.getAttribute('data-prev-value') || '';
      }
    }

    export async function assignProxyToInstance(instanceId, proxyId, selectEl) {
      const el = selectEl || document.querySelector(`.select-instance-proxy[data-instance-id="${instanceId}"]`);
      try {
        const res = await adminFetch('/api/instances/assign-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ instanceId, proxyId: proxyId || undefined })
        });
        if (res.ok) {
          toast(currentLang === 'ru' ? 'Прокси для инстанса обновлен' : 'Instance proxy updated', 'success');
          if (el) el.setAttribute('data-prev-value', proxyId || '');
          loadInstances();
        } else {
          const data = await res.json().catch(() => ({}));
          const errMsg = extractError(res, data, res.statusText || 'Failed to assign proxy');
          toast('Proxy assignment error: ' + errMsg, 'error');
          if (el) el.value = el.getAttribute('data-prev-value') || '';
        }
      } catch (err) {
        toast('Proxy assignment error: ' + err, 'error');
        if (el) el.value = el.getAttribute('data-prev-value') || '';
      }
    }

    document.addEventListener('change', function (e) {
      const selectProxy = e.target.closest('.select-instance-proxy');
      if (selectProxy) {
        const instanceId = selectProxy.getAttribute('data-instance-id');
        const proxyId = selectProxy.value || undefined;
        assignProxyToInstance(instanceId, proxyId, selectProxy);
        return;
      }
      const selectProfile = e.target.closest('.select-instance-profile');
      if (selectProfile) {
        const instanceId = selectProfile.getAttribute('data-instance-id');
        const profileId = selectProfile.value || '';
        assignProfileToInstance(instanceId, profileId, selectProfile);
        return;
      }
      const toggleRule = e.target.closest('.toggle-rule-enabled');
      if (toggleRule) {
        const idx = toggleRule.getAttribute('data-index');
        if (idx !== null) toggleRuleEnabled(parseInt(idx, 10));
        return;
      }
      const toggleInspector = e.target.closest('.toggle-inspector-entry');
      if (toggleInspector) {
        const entry = toggleInspector.getAttribute('data-entry');
        if (entry) toggleInspectorEntry(entry, toggleInspector.checked);
        return;
      }
      const appRuleSel = e.target.closest('.app-rule-select');
      if (appRuleSel) {
        const idx = appRuleSel.getAttribute('data-index');
        const field = appRuleSel.getAttribute('data-field');
        if (idx !== null && field) updateAppProcessRuleField(parseInt(idx, 10), field, appRuleSel.value);
        return;
      }
    });

    document.addEventListener('input', function (e) {
      const appRuleInp = e.target.closest('.app-rule-input');
      if (appRuleInp) {
        const idx = appRuleInp.getAttribute('data-index');
        const field = appRuleInp.getAttribute('data-field');
        if (idx !== null && field) updateAppProcessRuleField(parseInt(idx, 10), field, appRuleInp.value);
        return;
      }
    });

    // ----------------- Extension Info & GPO -----------------
    let currentGpoScope = 'user'; // 'user' (HKCU) or 'machine' (HKLM)
export let currentGpoBrowser = 'chrome'; // 'chrome', 'edge', 'yandex', 'opera'

    export function updateGpoDisplay() {
      if (!globalGpo) return;

      const browserKeys = {
        chrome: 'Google\\Chrome',
        edge: 'Microsoft\\Edge',
        yandex: 'YandexBrowser',
        opera: 'Opera Software\\Opera',
      };

      const root = currentGpoScope === 'machine' ? 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies' : 'HKEY_CURRENT_USER\\Software\\Policies';
      const activePathEl = document.getElementById('gpoActiveRegKey');
      if (activePathEl) {
        activePathEl.textContent = root + '\\' + (browserKeys[currentGpoBrowser] || 'Google\\Chrome');
      }

      const forcelistEntry = (globalGpo.forcelistEntries && globalGpo.forcelistEntries[currentGpoBrowser]) || globalGpo.forcelistEntry || '';
      const forcelistEl = document.getElementById('gpoForcelist');
      if (forcelistEl) forcelistEl.textContent = forcelistEntry;

      const scenGpo = document.getElementById('scenGpoForcelistText');
      if (scenGpo) scenGpo.textContent = forcelistEntry;

      const browserSettings = (globalGpo.extensionSettingsEntries && globalGpo.extensionSettingsEntries[currentGpoBrowser]) || globalGpo.extensionSettingsJson;
      const settingsEl = document.getElementById('gpoSettings');
      if (settingsEl && browserSettings) {
        settingsEl.textContent = JSON.stringify(browserSettings, null, 2);
      }

      const yandexAlert = document.getElementById('gpoYandexAlert');
      if (yandexAlert) {
        yandexAlert.style.display = currentGpoBrowser === 'yandex' ? 'block' : 'none';
      }

      const dlLabel = document.getElementById('lblDownloadRegBtn');
      if (dlLabel) {
        const isRu = currentLang === 'ru';
        dlLabel.textContent = isRu
          ? (currentGpoScope === 'machine' ? 'Скачать Windows .REG файл (HKLM)' : 'Скачать Windows .REG файл (HKCU)')
          : (currentGpoScope === 'machine' ? 'Download Windows .REG File (HKLM)' : 'Download Windows .REG File (HKCU)');
      }
    }

    export function setGpoScope(scope) {
      currentGpoScope = scope;
      const userBtn = document.getElementById('scopeBtnUser');
      const machBtn = document.getElementById('scopeBtnMachine');
      if (userBtn && machBtn) {
        if (scope === 'user') {
          userBtn.style.background = 'var(--primary)';
          userBtn.style.color = '#fff';
          userBtn.style.opacity = '1';
          machBtn.style.background = 'transparent';
          machBtn.style.color = 'var(--text)';
          machBtn.style.opacity = '0.6';
        } else {
          machBtn.style.background = 'var(--primary)';
          machBtn.style.color = '#fff';
          machBtn.style.opacity = '1';
          userBtn.style.background = 'transparent';
          userBtn.style.color = 'var(--text)';
          userBtn.style.opacity = '0.6';
        }
      }
      updateGpoDisplay();
    }

    export function setGpoBrowser(browser) {
      currentGpoBrowser = browser;
      const browsers = ['chrome', 'edge', 'yandex', 'opera'];
      browsers.forEach(b => {
        const btn = document.getElementById('gpoBrowser' + b.charAt(0).toUpperCase() + b.slice(1));
        if (btn) {
          if (b === browser) {
            btn.classList.add('active');
            btn.style.borderColor = 'var(--primary)';
            btn.style.opacity = '1';
          } else {
            btn.classList.remove('active');
            btn.style.borderColor = '';
            btn.style.opacity = '0.7';
          }
        }
      });
      updateGpoDisplay();
    }

    export async function fetchExtensionInfo() {
      try {
        const res = await adminFetch('/api/extension/info');
        const data = await res.json();
        document.getElementById('dispExtId').textContent = data.extensionId;
        document.getElementById('dispExtVer').textContent = data.version;

        globalGpo = data.gpo;
        updateGpoDisplay();
      } catch (e) {
        console.error(e);
      }
    }

    export async function downloadGpoPack() {
      try {
        toast(currentLang === 'ru' ? 'Формирование GPO пакета...' : 'Generating GPO deployment pack...', 'info');
        const res = await adminFetch('/api/builder/gpo-pack');
        if (!res.ok) {
          toast('Failed to download GPO pack: HTTP ' + res.status, 'error');
          return;
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pec-gpo-deployment-pack.zip';
        a.click();
        toast(currentLang === 'ru' ? 'Пакет GPO скачан!' : 'GPO pack downloaded!', 'success');
      } catch (e) {
        toast('Error downloading GPO pack: ' + e, 'error');
      }
    }

    export async function downloadRegFile() {
      try {
        const res = await adminFetch('/api/builder/reg?scope=' + currentGpoScope);
        if (!res.ok) {
          toast('Failed to download .reg file: HTTP ' + res.status, 'error');
          return;
        }
        const text = await res.text();
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pec-policy-' + currentGpoScope + '.reg';
        a.click();
      } catch (e) {
        toast('Could not download .reg file: ' + e, 'error');
      }
    }

    export async function downloadScriptFile(name) {
      try {
        const res = await adminFetch('/api/builder/script/' + name + '.ps1');
        if (!res.ok) {
          toast('Failed to download script: HTTP ' + res.status, 'error');
          return;
        }
        const text = await res.text();
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (name === 'deploy' ? 'deploy-pec-gpo.ps1' : 'verify-pec-gpo.ps1');
        a.click();
      } catch (e) {
        toast('Could not download script: ' + e, 'error');
      }
    }

    export function copyGpoForcelist() {
      const el = document.getElementById('gpoForcelist');
      if (el && el.textContent) {
        navigator.clipboard.writeText(el.textContent.trim()).then(() => {
          toast(currentLang === 'ru' ? 'Forcelist скопирован в буфер!' : 'Forcelist entry copied to clipboard!', 'success');
        });
      }
    }

    export function copyGpoSettings() {
      const el = document.getElementById('gpoSettings');
      if (el && el.textContent) {
        navigator.clipboard.writeText(el.textContent.trim()).then(() => {
          toast(currentLang === 'ru' ? 'ExtensionSettings JSON скопирован!' : 'ExtensionSettings JSON copied!', 'success');
        });
      }
    }

    export function copyGpoRegSz() {
      if (!globalGpo) return;
      const browserSettings = (globalGpo.extensionSettingsEntries && globalGpo.extensionSettingsEntries[currentGpoBrowser]) || globalGpo.extensionSettingsJson;
      if (browserSettings) {
        const rawJson = JSON.stringify(browserSettings);
        navigator.clipboard.writeText(rawJson).then(() => {
          toast(currentLang === 'ru' ? 'REG_SZ строка скопирована для GPMC!' : 'REG_SZ string copied for GPMC!', 'success');
        });
      }
    }

    window.setGpoScope = setGpoScope;
    window.setGpoBrowser = setGpoBrowser;
    window.downloadGpoPack = downloadGpoPack;
    window.downloadRegFile = downloadRegFile;
    window.downloadScriptFile = downloadScriptFile;
    window.copyGpoForcelist = copyGpoForcelist;
    window.copyGpoSettings = copyGpoSettings;
    window.copyGpoRegSz = copyGpoRegSz;

    // ----------------- System Status & Kill-Switch -----------------
    export async function fetchStatus() {
      const seq = ++fetchStatusSeq;
      try {
        const res = await adminFetch('/api/status');
        if (seq < fetchStatusSeq) return;
        if (!res.ok) throw new Error('Status fetch failed: ' + res.status);
        const data = await res.json();
        if (seq < fetchStatusSeq) return;
        const isRu = currentLang === 'ru';
        
        const gatewayDot = document.getElementById('gatewayStatusIndicator');
        if (gatewayDot) {
          gatewayDot.classList.remove('offline');
          let tooltip = isRu ? 'Шлюз активен' : 'Gateway Active';
          if (data.activeInstancesCount !== undefined) {
            tooltip += ' • ' + (isRu ? 'Устройств: ' : 'Devices: ') + data.activeInstancesCount;
          }
          gatewayDot.setAttribute('title', tooltip);
        }

        document.getElementById('hdrUser').textContent = data.currentUser || (isRu ? 'нет' : 'none');
        document.getElementById('hdrFleetCount').textContent = data.activeInstancesCount + (isRu ? ' активных (' : ' active (') + data.totalInstancesCount + (isRu ? ' всего)' : ' total)');
        
        if (data.nextRotationAt) {
          const diffMin = Math.round((new Date(data.nextRotationAt).getTime() - Date.now()) / 60000);
          document.getElementById('hdrNextRot').textContent = (diffMin > 0 ? (isRu ? 'через ' + diffMin + ' мин' : 'in ' + diffMin + 'm') : (isRu ? 'сейчас' : 'imminent')) + ' (' + new Date(data.nextRotationAt).toLocaleTimeString() + ')';
        } else {
          document.getElementById('hdrNextRot').textContent = isRu ? 'Отключено' : 'Disabled';
        }

        // Kill-switch state is the SERVER's truth, never a local guess:
        // a stale local flag previously let a second tab (or a reopened
        // dashboard) accidentally flip the emergency state.
        if (typeof data.killSwitch === 'boolean' && data.killSwitch !== globalKillSwitch) {
          globalKillSwitch = data.killSwitch;
          updateKillSwitchButton();
        }

        renderAuditLogs(data.auditLogs || []);
      } catch (err) {
        console.error(err);
        const gatewayDot = document.getElementById('gatewayStatusIndicator');
        if (gatewayDot) {
          const isRu = currentLang === 'ru';
          gatewayDot.classList.add('offline');
          gatewayDot.setAttribute('title', isRu ? 'Шлюз недоступен' : 'Gateway Offline');
        }
      }
    }

    export function updateKillSwitchButton() {
      const ksBtn = document.getElementById('btnKillSwitch');
      if (!ksBtn) return;
      const dict = I18N[currentLang] || I18N.ru;
      if (globalKillSwitch) {
        ksBtn.textContent = dict.btnKillSwitchOn;
        ksBtn.classList.remove('btn-secondary');
        ksBtn.classList.add('btn-danger');
      } else {
        ksBtn.textContent = dict.btnKillSwitchOff;
        ksBtn.classList.remove('btn-danger');
        ksBtn.classList.add('btn-secondary');
      }
    }

    export async function toggleKillSwitch() {
      const desired = !globalKillSwitch;
      const isRu = currentLang === 'ru';
      const title = desired
        ? (isRu ? 'Внимание: Kill-Switch' : 'Warning: Kill-Switch')
        : (isRu ? 'Отключение Kill-Switch' : 'Disable Kill-Switch');
      const msg = desired
        ? (isRu
            ? 'Вы уверены, что хотите перевести все устройства компании в прямой режим (DIRECT)? Весь трафик устройств пойдёт напрямую в обход прокси.'
            : 'Are you sure you want to switch all company devices to direct mode (DIRECT)? All client traffic will bypass proxy servers.')
        : (isRu
            ? 'Вы уверены, что хотите отключить аварийный режим и вернуть маршрутизацию через прокси?'
            : 'Are you sure you want to disable emergency direct mode and restore proxy routing?');

      const confirmed = await pecConfirm({
        title,
        message: msg,
        isDanger: desired
      });
      if (!confirmed) return;

      try {
        const res = await adminFetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ killSwitch: desired })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || ('HTTP ' + res.status));
        }
        const updated = await res.json();
        globalKillSwitch = Boolean(updated.killSwitch);
        updateKillSwitchButton();
      } catch (e) {
        toast('Kill-switch error: ' + e, 'error');
        fetchStatus(); // resync with the server's actual state
      }
    }

    // ----------------- 3x-ui Rotation -----------------
    export async function fetchRotationConfig() {
      try {
        const res = await adminFetch('/api/rotation/config');
        const data = await res.json();
        const cfg = data.config;
        
        document.getElementById('rotPanelUrl').value = cfg.panelUrl || '';
        document.getElementById('rotAdminUser').value = cfg.adminUser || '';
        document.getElementById('rotRemark').value = cfg.inboundRemark || '';
        document.getElementById('rotInterval').value = String(cfg.intervalMinutes || 1440);
        document.getElementById('rotEnabled').value = String(cfg.enabled);
        const rotInsecure = document.getElementById('rotInsecureTls');
        if (rotInsecure) rotInsecure.checked = Boolean(cfg.insecureSkipVerify);
        
        document.getElementById('rotStatusText').textContent = cfg.lastStatus || 'Idle';
        document.getElementById('rotNextRun').textContent = cfg.nextRotationAt ? new Date(cfg.nextRotationAt).toLocaleString() : 'Disabled';
        document.getElementById('rotLastRun').textContent = cfg.lastRotatedAt ? new Date(cfg.lastRotatedAt).toLocaleString() : 'None';

        const passBadge = document.getElementById('passwordSavedBadge');
        if (passBadge) {
          if ((cfg.rotAdminPass && cfg.rotAdminPass !== '') || (cfg.adminPass && cfg.adminPass !== '')) {
            passBadge.style.display = 'inline-block';
          } else {
            passBadge.style.display = 'none';
          }
        }

        renderRotationHistory(data.history || []);
      } catch (e) {
        console.error(e);
      }
    }

    export async function saveRotationConfig() {
      const intervalRaw = document.getElementById('rotInterval').value.trim();
      const intervalNum = parseInt(intervalRaw, 10);
      if (!intervalRaw || !Number.isFinite(intervalNum) || intervalNum < 1 || String(intervalNum) !== intervalRaw) {
        toast('Rotation interval must be a whole number of minutes (>= 1).', 'error');
        return;
      }
      const rotInsecure = document.getElementById('rotInsecureTls');
      const payload: any = {
        panelUrl: document.getElementById('rotPanelUrl').value.trim(),
        adminUser: document.getElementById('rotAdminUser').value.trim(),
        inboundRemark: document.getElementById('rotRemark').value.trim(),
        intervalMinutes: intervalNum,
        enabled: document.getElementById('rotEnabled').value === 'true',
        insecureSkipVerify: rotInsecure ? rotInsecure.checked : false,
      };
      const pass = document.getElementById('rotAdminPass').value;
      if (pass) payload.adminPass = pass;

      const btn = document.querySelector('button[onclick*="saveRotationConfig"]') || document.querySelector('[data-i18n="btnSaveScheduler"]');
      let origHtml = '';
      if (btn) {
        origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner"></span> ' + (btn.textContent || '').trim();
      }

      try {
        const res = await adminFetch('/api/rotation/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          toast(currentLang === 'ru' ? 'Расписание ротации обновлено!' : 'Rotation schedule updated!', 'success');
          fetchRotationConfig();
          fetchStatus();
        } else {
          const data = await res.json().catch(() => ({}));
          toast((currentLang === 'ru' ? 'Ошибка сохранения настроек ротации: ' : 'Failed to save rotation settings: ') + (data.error || ('HTTP ' + res.status)), 'error');
        }
      } catch (e) {
        toast((currentLang === 'ru' ? 'Ошибка сохранения настроек ротации: ' : 'Error saving rotation settings: ') + e, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          if (origHtml) btn.innerHTML = origHtml;
        }
      }
    }

    export async function test3xui() {
      const out = document.getElementById('test3xuiResult');
      out.textContent = 'Testing connection to 3x-ui API...';
      const enteredPass = document.getElementById('rotAdminPass').value;
      const payload: any = {
        panelUrl: document.getElementById('rotPanelUrl').value.trim(),
        adminUser: document.getElementById('rotAdminUser').value.trim(),
        inboundRemark: document.getElementById('rotRemark').value.trim()
      };
      if (enteredPass && enteredPass.trim()) {
        payload.adminPass = enteredPass.trim();
      }

      try {
        const res = await adminFetch('/api/3xui/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        out.innerHTML = (data.ok ? '<img src="/icons/check.png" class="icon-inline-sm" alt="ok"> ' : '<img src="/icons/cross.png" class="icon-inline-sm" alt="err"> ') + esc(data.message);
        out.style.color = data.ok ? 'var(--success)' : 'var(--danger)';
      } catch (e) {
        out.textContent = 'Connection test failed: ' + e;
        out.style.color = 'var(--danger)';
      }
    }

    export async function manualRotate() {
      const isRu = currentLang === 'ru';
      if (!await pecConfirm({
        title: isRu ? 'Ротация учетных данных' : 'Rotate Credentials',
        message: isRu ? 'Выполнить немедленную ротацию учетных данных прокси?' : 'Rotate proxy credentials immediately?',
        isDanger: true
      })) return;
      const btn = document.getElementById('btnRotateNow');
      let origHtml = '';
      if (btn) {
        origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner"></span> ' + (btn.textContent || '').trim();
      }
      try {
        const res = await adminFetch('/api/rotation/rotate-now', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          toast(isRu ? ('Успешно! Новый пользователь: ' + data.result.user) : ('Rotated! New user: ' + data.result.user + ' (source: ' + data.result.source + ')'), 'success');
          if (typeof (window as any).refreshAll === 'function') (window as any).refreshAll();
        } else {
          toast((isRu ? 'Ошибка ротации: ' : 'Rotation error: ') + data.error, 'error');
        }
      } catch (e) {
        toast((isRu ? 'Сетевая ошибка: ' : 'Failed: ') + e, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          if (origHtml) btn.innerHTML = origHtml;
        }
      }
    }

    export function renderRotationHistory(history) {
      const tbody = document.getElementById('rotHistoryTable');
      if (!history.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="color: var(--text-muted); text-align: center;">No rotation events yet</td></tr>';
        return;
      }
      tbody.innerHTML = history.map(item => `<tr>
        <td style="font-family: var(--mono); font-size: 12px;">${new Date(item.timestamp).toLocaleTimeString()}</td>
        <td><code>${esc(item.source)}</code></td>
        <td>${esc(item.user)}</td>
        <td><span class="badge ${item.success ? 'badge-online' : 'badge-offline'}">${item.success ? 'SUCCESS' : 'FAILED'}</span></td>
      </tr>`).join('');
    }

    // ----------------- 3x-ui Panels Registry -----------------
export let currentPanelsList = [];

    export async function load3xuiPanels() {
      try {
        const res = await adminFetch('/api/3xui/panels');
        if (!res.ok) return;
        const data = await res.json();
        currentPanelsList = Array.isArray(data) ? data : (data && data.panels ? data.panels : []);
        render3xuiPanelsTable(currentPanelsList);
      } catch (e) {
        console.warn('Failed to load 3x-ui panels:', e);
      }
    }

    export function render3xuiPanelsTable(panels) {
      const isRu = currentLang === 'ru';
      const tbody = document.getElementById('panels3xuiBody');
      if (tbody) {
        if (!panels || !panels.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">' + (isRu ? 'Панели 3x-ui не настроены' : 'No 3x-ui panels configured') + '</td></tr>';
        } else {
          tbody.innerHTML = panels.map(p => `<tr>
            <td><strong>${esc(p.name)}</strong></td>
            <td style="font-family: var(--mono);">${esc(p.panelUrl)}</td>
            <td><code>${esc(p.adminUser)}</code></td>
            <td><span class="badge ${p.insecureTls ? 'badge-warning' : 'badge-success'}">${p.insecureTls ? (isRu ? 'Self-signed TLS' : 'Insecure TLS') : (isRu ? 'Строгий TLS' : 'Valid TLS')}</span></td>
            <td style="text-align: right;">
              <div style="display: inline-flex; gap: 6px;">
                <button type="button" class="btn btn-sm btn-secondary btn-test-panel" data-id="${esc(p.id)}">${isRu ? 'Проверить' : 'Test'}</button>
                <button type="button" class="btn btn-sm btn-secondary btn-edit-panel" data-id="${esc(p.id)}" title="${isRu ? 'Редактировать' : 'Edit'}">✏️</button>
                <button type="button" class="btn btn-sm btn-danger btn-delete-panel" data-id="${esc(p.id)}" title="${isRu ? 'Удалить' : 'Delete'}"><img src="/icons/trash.png" class="icon-inline-sm" alt="del"></button>
              </div>
            </td>
          </tr>`).join('');
        }
      }

      // Populate select in Add from 3x-ui modal
      const sel = document.getElementById('add3xuiPanelSelect');
      if (sel) {
        sel.innerHTML = '<option value="">' + (isRu ? 'По умолчанию (Настройки ротации)' : 'Default (Rotation Settings)') + '</option>' +
          (panels || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.panelUrl)})</option>`).join('');
      }
    }

    export function openAdd3xuiPanelModal(panel?: any) {
      const idInp = document.getElementById('panelIdInput');
      const nameInp = document.getElementById('panelName');
      const urlInp = document.getElementById('panelUrl');
      const userInp = document.getElementById('panelUser');
      const passInp = document.getElementById('panelPass');
      const tlsInp = document.getElementById('panelInsecureTls');
      const errEl = document.getElementById('panelModalError');

      if (idInp) idInp.value = panel ? panel.id : '';
      if (nameInp) nameInp.value = panel ? panel.name : '';
      if (urlInp) urlInp.value = panel ? panel.panelUrl : '';
      if (userInp) userInp.value = panel ? panel.adminUser : '';
      if (passInp) passInp.value = '';
      if (tlsInp) tlsInp.checked = panel ? Boolean(panel.insecureTls) : false;
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

      const modal = document.getElementById('modal3xuiPanel');
      if (modal) modal.style.display = 'flex';
      if (nameInp) nameInp.focus();
    }

    export function close3xuiPanelModal() {
      const modal = document.getElementById('modal3xuiPanel');
      if (modal) modal.style.display = 'none';
    }

    export async function save3xuiPanelAction() {
      const isRu = currentLang === 'ru';
      const id = document.getElementById('panelIdInput')?.value;
      const name = document.getElementById('panelName')?.value?.trim();
      const panelUrl = document.getElementById('panelUrl')?.value?.trim();
      const adminUser = document.getElementById('panelUser')?.value?.trim();
      const adminPass = document.getElementById('panelPass')?.value;
      const insecureTls = document.getElementById('panelInsecureTls')?.checked;
      const errEl = document.getElementById('panelModalError');

      if (!name || !panelUrl || !adminUser) {
        if (errEl) { errEl.textContent = isRu ? 'Заполните обязательные поля: Название, URL и Пользователь' : 'Please fill all required fields'; errEl.style.display = 'block'; }
        return;
      }

      const btn = document.getElementById('btnSave3xuiPanel');
      let origHtml = '';
      if (btn) {
        origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner"></span> ' + (btn.textContent || '').trim();
      }

      try {
        const url = id ? `/api/3xui/panels/${encodeURIComponent(id)}` : '/api/3xui/panels';
        const method = id ? 'PUT' : 'POST';
        const res = await adminFetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, panelUrl, adminUser, adminPass, insecureTls })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          close3xuiPanelModal();
          toast(isRu ? 'Панель 3x-ui сохранена' : '3x-ui panel saved', 'success');
          load3xuiPanels();
        } else {
          if (errEl) { errEl.textContent = data.error || 'Failed to save panel'; errEl.style.display = 'block'; }
        }
      } catch (e) {
        if (errEl) { errEl.textContent = String(e); errEl.style.display = 'block'; }
      } finally {
        if (btn) {
          btn.disabled = false;
          if (origHtml) btn.innerHTML = origHtml;
        }
      }
    }

    export async function delete3xuiPanelAction(id) {
      const isRu = currentLang === 'ru';
      if (!await pecConfirm(isRu ? 'Удалить эту панель 3x-ui?' : 'Delete this 3x-ui panel?', { isDanger: true })) return;
      try {
        const res = await adminFetch(`/api/3xui/panels/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (res.ok) {
          toast(isRu ? 'Панель удалена' : 'Panel deleted', 'success');
          load3xuiPanels();
        } else {
          toast('Delete failed', 'error');
        }
      } catch (e) {
        toast('Delete error: ' + e, 'error');
      }
    }

    export async function test3xuiPanelAction(id) {
      const isRu = currentLang === 'ru';
      toast(isRu ? 'Проверка соединения с панелью...' : 'Testing panel connection...', 'info');
      try {
        const res = await adminFetch(`/api/3xui/panels/${encodeURIComponent(id)}/test`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          toast(isRu ? 'Соединение успешно! ' + (data.message || '') : 'Connected! ' + (data.message || ''), 'success');
        } else {
          toast((isRu ? 'Ошибка соединения: ' : 'Connection error: ') + (data.message || data.error || 'Failed'), 'error');
        }
      } catch (e) {
        toast('Test error: ' + e, 'error');
      }
    }

    export function openAdd3xuiModal() {
      const tagEl = document.getElementById('add3xuiTag');
      const nameEl = document.getElementById('add3xuiName');
      const hostEl = document.getElementById('add3xuiHost');
      const activeEl = document.getElementById('add3xuiIsActive');
      const previewEl = document.getElementById('add3xuiPreview');
      const errEl = document.getElementById('add3xuiError');
      if (tagEl) tagEl.value = '';
      if (nameEl) nameEl.value = '';
      if (hostEl) hostEl.value = '';
      if (activeEl) activeEl.checked = true;
      if (previewEl) previewEl.innerHTML = '<span data-i18n="txtInboundPreviewPlaceholder">' + esc(t('txtInboundPreviewPlaceholder', 'Click "Fetch Info" to preview inbound parameters before adding.')) + '</span>';
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      const modal = document.getElementById('modalAdd3xui');
      if (modal) modal.style.display = 'flex';
      if (tagEl) tagEl.focus();
    }

    export function closeAdd3xuiModal() {
      const modal = document.getElementById('modalAdd3xui');
      if (modal) modal.style.display = 'none';
    }

    export async function lookup3xuiInbound() {
      const tagEl = document.getElementById('add3xuiTag');
      const tag = tagEl ? tagEl.value.trim() : '';
      const panelSelect = document.getElementById('add3xuiPanelSelect');
      const panelId = panelSelect ? panelSelect.value : '';
      const errEl = document.getElementById('add3xuiError');
      const previewEl = document.getElementById('add3xuiPreview');
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
      if (!tag) {
        if (errEl) { errEl.textContent = 'Please enter an inbound tag'; errEl.style.display = 'block'; }
        return;
      }
      if (previewEl) previewEl.textContent = 'Querying 3x-ui panel...';

      try {
        const res = await adminFetch('/api/3xui/inbound-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag: tag, panelId: panelId || undefined })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && data.inbound) {
          const ib = data.inbound;
          let warnHtml = '';
          if ((ib.protocol === 'socks' || ib.protocol === 'socks5') && (ib.username || ib.hasPassword)) {
            warnHtml = '<div style="margin-top: 8px; padding: 6px 10px; background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; border-radius: 4px; color: #fbbf24; font-size: 11px; display: flex; align-items: center; gap: 6px;">' +
              '<img src="/icons/warning.png" class="icon-inline" alt="warn"> ' +
              '<span>' + t('warnChromiumSocks5Auth', 'Chromium (Chrome, Edge, Brave, Yandex) does not support SOCKS5 authentication. If credentials are set, Chrome will reject the connection or bypass the proxy. Use HTTP protocol for authenticated corporate proxies or use SOCKS5 without username/password (e.g. IP whitelist).') + '</span>' +
              '</div>';
          }
          if (previewEl) {
            previewEl.innerHTML = '<div style="color: var(--success); font-weight: 600; margin-bottom: 4px;">Inbound Found:</div>' +
              '<div><strong>Protocol:</strong> ' + esc(ib.protocol) + ' &bull; <strong>Port:</strong> ' + esc(ib.port) + '</div>' +
              '<div><strong>Username:</strong> ' + esc(ib.username || 'none') + ' &bull; <strong>Password:</strong> ' + (ib.hasPassword ? 'Present' : 'None') + '</div>' +
              warnHtml;
          }
          const nameEl = document.getElementById('add3xuiName');
          if (nameEl && !nameEl.value.trim()) {
            nameEl.value = ib.tag || tag;
          }
        } else {
          const msg = data.error || 'Failed to lookup inbound from 3x-ui';
          if (previewEl) previewEl.textContent = 'Lookup failed: ' + msg;
          if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        }
      } catch (e) {
        if (previewEl) previewEl.textContent = 'Error: ' + e;
        if (errEl) { errEl.textContent = String(e); errEl.style.display = 'block'; }
      }
    }

    export async function submitAdd3xuiProxy() {
      const tagEl = document.getElementById('add3xuiTag');
      const nameEl = document.getElementById('add3xuiName');
      const hostEl = document.getElementById('add3xuiHost');
      const activeEl = document.getElementById('add3xuiIsActive');
      const panelSelect = document.getElementById('add3xuiPanelSelect');
      const panelId = panelSelect ? panelSelect.value : '';
      const errEl = document.getElementById('add3xuiError');
      if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

      const tag = tagEl ? tagEl.value.trim() : '';
      if (!tag) {
        if (errEl) { errEl.textContent = 'Tag is required'; errEl.style.display = 'block'; }
        return;
      }
      const payload = {
        type: '3x-ui',
        tag: tag,
        name: nameEl && nameEl.value.trim() ? nameEl.value.trim() : undefined,
        host: hostEl && hostEl.value.trim() ? hostEl.value.trim() : undefined,
        isActive: activeEl ? Boolean(activeEl.checked) : true,
        panelId: panelId || undefined
      };

      const btn = document.getElementById('btnAdd3xuiSubmit');
      let origHtml = '';
      if (btn) {
        origHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner"></span> ' + (btn.textContent || '').trim();
      }

      try {
        const res = await adminFetch('/api/proxies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.id) {
          closeAdd3xuiModal();
          toast(t('toastProxySaved', 'Proxy saved!'), 'success');
          await fetchProxies();
          fetchStatus();
        } else {
          if (errEl) { errEl.textContent = data.error || 'Failed to save proxy'; errEl.style.display = 'block'; }
        }
      } catch (e) {
        if (errEl) { errEl.textContent = String(e); errEl.style.display = 'block'; }
      } finally {
        if (btn) {
          btn.disabled = false;
          if (origHtml) btn.innerHTML = origHtml;
        }
      }
    }

    export function renderAuditLogs(logs) {
      const tbody = document.getElementById('auditTableBody');
      if (!tbody) return;
      if (!logs || !logs.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">' + (currentLang === 'ru' ? 'Запросов не зафиксировано' : 'No requests recorded') + '</td></tr>';
        tbody.removeAttribute('data-rendered-sig');
        return;
      }
      if (tbody.contains(document.activeElement)) return;
      const sel = window.getSelection ? window.getSelection() : null;
      if (sel && sel.toString() && tbody.contains(sel.anchorNode)) return;

      const sig = logs.map(x => x.timestamp + ':' + x.ip + ':' + x.endpoint + ':' + x.status + ':' + x.result).join('|');
      if (tbody.getAttribute('data-rendered-sig') === sig) return;

      tbody.innerHTML = logs.map(l => {
        let badge = 'badge-online';
        if (l.result === 'REJECTED_TOKEN' || l.result === 'STORE_ERROR') badge = 'badge-offline';
        else if (l.result === 'HEALTH_CHECK') badge = 'badge-action-proxy';
        
        return `<tr>
          <td style="font-family: var(--mono); font-size: 12px;">${new Date(l.timestamp).toLocaleTimeString()}</td>
          <td style="font-family: var(--mono);">${esc(l.ip)}</td>
          <td><code>${esc(l.endpoint)}</code></td>
          <td style="font-family: var(--mono);">${esc(l.status)}</td>
          <td><span class="badge ${badge}">${esc(l.result)}</span></td>
          <td style="color: var(--text-muted); font-size: 12px;">${esc(l.details || '-')}</td>
        </tr>`;
      }).join('');
      tbody.setAttribute('data-rendered-sig', sig);
    }

    export async function testCredsEndpoint() {
      const token = document.getElementById('testTokenInput').value;
      const out = document.getElementById('testCredsOutput');
      out.textContent = 'Executing GET /creds...';
      try {
        const start = performance.now();
        const res = await fetch('/creds?instanceId=test-admin-probe', {
          headers: token ? { 'X-Ext-Token': token } : {}
        });
        const elapsed = Math.round(performance.now() - start);
        const json = await res.json().catch(() => ({}));
        out.textContent = `HTTP ${res.status} ${res.statusText} (${elapsed}ms)

${JSON.stringify(json, null, 2)}`;
        fetchStatus();
      } catch (e) {
        out.textContent = 'Request failed: ' + e;
      }
    }

    export async function testSyncEndpoint() {
      const out = document.getElementById('testSyncOutput');
      out.textContent = 'Executing POST /api/sync...';
      const token = document.getElementById('testTokenInput').value;
      try {
        const res = await fetch('/api/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'X-Ext-Token': token } : {})
          },
          body: JSON.stringify({
            instanceId: 'test-simulated-worker',
            version: '1.2.0',
            activeProxyMode: 'http'
          })
        });
        const json = await res.json();
        out.textContent = JSON.stringify(json, null, 2);
        // Cleanup: a diagnostics probe must not pollute the production fleet
        // registry (online counters, instances_meta.json) with phantom workers.
        try { await adminFetch('/api/instances/test-simulated-worker', { method: 'DELETE' }); } catch (e) {}
        fetchFleet();
        fetchStatus();
      } catch (e) {
        out.textContent = 'Sync test failed: ' + e;
      }
    }

    // ----------------- Releases & Rollback Management -----------------
export let currentReleasesList = [];
export let currentActiveExtVer = '';
export let currentActiveAppVer = '';

    export async function loadReleases() {
      try {
        const res = await adminFetch('/api/releases');
        if (!res.ok) {
          console.warn('Failed to load releases:', res.status);
          return;
        }
        const data = await res.json();
        currentActiveExtVer = data.activeExtensionVersion || '';
        currentActiveAppVer = data.activeAppVersion || '';
        currentReleasesList = data.releases || [];

        const badgesEl = document.getElementById('activeReleasesBadges');
        if (badgesEl) {
          const isRu = currentLang === 'ru';
          const extText = currentActiveExtVer ? `Ext: v${esc(currentActiveExtVer)}` : (isRu ? 'Расширение: нет' : 'Ext: none');
          const appText = currentActiveAppVer ? `App: v${esc(currentActiveAppVer)}` : (isRu ? 'Десктоп: нет' : 'App: none');
          badgesEl.innerHTML = `
            <span class="badge badge-action-proxy" title="${isRu ? 'Активная версия расширения' : 'Active extension version'}">🧩 ${extText}</span>
            <span class="badge badge-success" style="margin-left: 6px;" title="${isRu ? 'Активная версия десктоп-агента' : 'Active desktop app version'}">💻 ${appText}</span>
          `;
        }

        renderReleasesTable();
      } catch (err) {
        console.error('Error loading releases:', err);
      }
    }

    export function filterReleases() {
      renderReleasesTable();
    }

    export function renderReleasesTable() {
      const tbody = document.getElementById('releasesTableBody');
      if (!tbody) return;

      const isRu = currentLang === 'ru';
      const filterEl = document.getElementById('releasesFilterType');
      const filterType = filterEl ? filterEl.value : 'all';

      let list = currentReleasesList || [];
      if (filterType !== 'all') {
        list = list.filter(r => r.type === filterType);
      }

      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 18px;">${isRu ? 'Релизов не найдено. Соберите CRX в Конструкторе или ZIP в Конструкторе приложения.' : 'No releases found. Build CRX in Extension Builder or ZIP in App Studio.'}</td></tr>`;
        return;
      }

      // Sort descending by builtAt
      const sorted = [...list].sort((a, b) => {
        const timeA = new Date(a.builtAt || 0).getTime();
        const timeB = new Date(b.builtAt || 0).getTime();
        return timeB - timeA;
      });

      const rows = sorted.map(rel => {
        const isExtension = rel.type === 'extension';
        const typeBadge = isExtension
          ? `<span class="badge badge-action-proxy">🧩 ${isRu ? 'Расширение' : 'Extension'}</span>`
          : `<span class="badge badge-success">💻 ${isRu ? 'Десктоп' : 'Desktop App'}</span>`;

        const isActive = Boolean(rel.isActive || rel.active);
        const statusBadge = isActive
          ? `<span class="badge badge-success" style="font-weight: 700;">● ${isRu ? 'АКТИВНА' : 'ACTIVE'}</span>`
          : `<span class="badge badge-offline" style="opacity: 0.7;">${isRu ? 'В архиве' : 'Archived'}</span>`;

        const builtDate = rel.builtAt
          ? new Date(rel.builtAt).toLocaleString(isRu ? 'ru-RU' : 'en-US', { hour12: false })
          : '—';

        const shaDisplay = rel.sha256
          ? `<span style="font-family: var(--mono); font-size: 11px;" title="${esc(rel.sha256)}">${esc(rel.sha256.slice(0, 10))}…</span>`
          : '—';

        const rollbackBtn = isActive
          ? `<button class="btn btn-sm btn-secondary" disabled style="opacity: 0.5; font-size: 11px; padding: 3px 8px;">${isRu ? 'Активна' : 'Active'}</button>`
          : `<button class="btn btn-sm btn-primary btn-set-active-release" data-type="${esc(rel.type)}" data-version="${esc(rel.version)}" style="font-size: 11px; padding: 3px 8px;" title="${isRu ? 'Откатить/переключить на эту версию' : 'Rollback/switch to this version'}">${isRu ? 'Сделать активной' : 'Set Active'}</button>`;

        const downloadBtn = `<button class="btn btn-sm btn-secondary btn-download-release" data-type="${esc(rel.type)}" data-version="${esc(rel.version)}" data-filename="${esc(rel.fileName || '')}" style="font-size: 11px; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px;" title="${isRu ? 'Скачать архив релиза' : 'Download release package'}">${isRu ? 'Скачать' : 'Download'}</button>`;

        const deleteBtn = isActive
          ? ''
          : `<button class="btn btn-sm btn-danger btn-delete-release" data-type="${esc(rel.type)}" data-version="${esc(rel.version)}" style="font-size: 11px; padding: 3px 6px;" title="${isRu ? 'Удалить из архива' : 'Delete release'}">✕</button>`;

        return `<tr>
          <td>${typeBadge}</td>
          <td style="font-weight: 600; font-family: var(--mono);">v${esc(rel.version)}</td>
          <td style="font-size: 12px; color: var(--text-muted);">${builtDate}</td>
          <td>${shaDisplay}</td>
          <td>${statusBadge}</td>
          <td>
            <div style="display: flex; gap: 6px; align-items: center;">
              ${rollbackBtn}
              ${downloadBtn}
              ${deleteBtn}
            </div>
          </td>
        </tr>`;
      }).join('');

      tbody.innerHTML = rows;
    }

    export async function setActiveReleaseVersion(type, version) {
      const isRu = currentLang === 'ru';
      const label = type === 'extension' ? (isRu ? 'расширения' : 'extension') : (isRu ? 'десктоп-агента' : 'desktop app');
      const audienceWarning = isRu
        ? `Внимание: переключение активной версии затронет все рабочие станции флота при следующей синхронизации.\n\nПереключить активную версию ${label} на v${version} (откат)?`
        : `Warning: switching active release will affect all fleet workstations on their next sync.\n\nSwitch active ${label} version to v${version} (rollback)?`;
      if (!await pecConfirm({
        title: isRu ? 'Смена активной версии' : 'Switch Active Version',
        message: audienceWarning,
        isDanger: true
      })) return;

      try {
        const res = await adminFetch('/api/releases/set-active', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, version })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          toast(isRu ? `Активная версия ${label} изменена на v${version}` : `Active ${label} version switched to v${version}`, 'success');
          await loadReleases();
        } else {
          toast(data.error || (isRu ? 'Ошибка смены активной версии' : 'Failed to switch active release'), 'error');
        }
      } catch (e) {
        console.error('Error switching active release:', e);
        toast(isRu ? 'Сетевая ошибка при смене версии' : 'Network error switching active release', 'error');
      }
    }

    export async function deleteReleaseVersion(type, version) {
      const isRu = currentLang === 'ru';
      const confirmMsg = isRu
        ? `Удалить релиз ${type} v${version} из архива?`
        : `Delete release ${type} v${version} from archive?`;
      if (!await pecConfirm(confirmMsg, { isDanger: true })) return;

      try {
        const res = await adminFetch(`/api/releases/${encodeURIComponent(type)}/${encodeURIComponent(version)}`, {
          method: 'DELETE'
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          toast(isRu ? `Релиз v${version} удален` : `Release v${version} deleted`, 'success');
          await loadReleases();
        } else {
          toast(data.error || (isRu ? 'Ошибка удаления релиза' : 'Failed to delete release'), 'error');
        }
      } catch (e) {
        console.error('Error deleting release:', e);
        toast(isRu ? 'Сетевая ошибка при удалении релиза' : 'Network error deleting release', 'error');
      }
    }

    export async function downloadReleaseVersion(type, version, fileName) {
      const isRu = currentLang === 'ru';
      toast((isRu ? 'Скачивание релиза v' : 'Downloading release v') + version + '...', 'info');
      try {
        const res = await adminFetch(`/api/releases/download/${encodeURIComponent(type)}/${encodeURIComponent(version)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast((isRu ? 'Ошибка скачивания: ' : 'Download error: ') + (err.error || ('HTTP ' + res.status)), 'error');
          return;
        }
        const blob = await res.blob();
        const downloadFileName = fileName || (type === 'extension' ? 'pec-extension.crx' : 'pec-client-windows-x64.zip');
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = downloadFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      } catch (e) {
        toast((isRu ? 'Ошибка скачивания: ' : 'Download failed: ') + e.message, 'error');
      }
    }

    window.loadReleases = loadReleases;
    window.filterReleases = filterReleases;
    window.setActiveReleaseVersion = setActiveReleaseVersion;
    window.deleteReleaseVersion = deleteReleaseVersion;
    window.downloadReleaseVersion = downloadReleaseVersion;


// Register modal closers
registerModalCloser('modal3xuiPanel', close3xuiPanelModal);
registerModalCloser('modalAdd3xui', closeAdd3xuiModal);
