// Upstream Proxies Tab Module for PEC Dashboard
import { state } from '../core/state.js';
import { adminFetch, esc } from '../core/api.js';
import { toast, pecConfirm, registerModalCloser } from '../core/notify.js';
import { t } from '../core/theme.js';

export async function fetchProxies() {
  try {
    const res = await adminFetch('/api/proxies');
    if (!res.ok) {
      console.warn('Failed to fetch proxies: HTTP ' + res.status);
      return;
    }
    state.currentProxiesList = (await res.json()) || [];
    renderProxiesTable(state.currentProxiesList);
  } catch (e) {
    console.error('Error fetching proxies:', e);
  }
}

export function renderProxiesTable(proxies: any[]) {
  const list = proxies || [];
  const tbody = document.getElementById('proxiesTableBody');
  if (tbody) {
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--text-muted);">' + esc(t('txtNoProxies', 'No proxy nodes configured yet.')) + '</td></tr>';
    } else {
      tbody.innerHTML = list.map((px) => {
        const activeCell = px.isActive
          ? '<span class="badge badge-online" style="cursor: default;" title="' + esc(t('badgeActive', 'ACTIVE')) + '">● ' + esc(t('badgeActive', 'ACTIVE')) + '</span>'
          : '<button type="button" class="btn-secondary btn-activate-proxy" style="font-size: 11px; padding: 3px 8px;" data-id="' + esc(px.id) + '">' + esc(t('btnSetActive', 'Activate')) + '</button>';

        const nameHtml = (px.name && px.name !== px.tag)
          ? '<div style="font-size: 11px; color: var(--text-muted);">' + esc(px.name) + '</div>'
          : '';

        const typeBadge = px.type === '3x-ui' ? 'badge-action-proxy' : 'badge-secondary';
        const statusBadge = px.status === 'OK' ? 'badge-online' : (px.status === 'ERROR' ? 'badge-offline' : 'badge-secondary');
        const syncTime = px.lastSync ? '<div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">' + new Date(px.lastSync).toLocaleTimeString() + '</div>' : '';

        const latencyHtml = (typeof px.latencyMs === 'number' && px.latencyMs > 0)
          ? '<span class="badge ' + (px.latencyMs < 300 ? 'badge-online' : (px.latencyMs < 1000 ? 'badge-warning' : 'badge-offline')) + '">' + px.latencyMs + ' ms</span>'
          : '<span style="color: var(--text-muted); font-size: 11px;">—</span>';

        const egressHtml = px.egressIp
          ? '<code>' + esc(px.egressIp) + '</code>' + (px.geoCountry ? ' <span class="badge badge-secondary" style="margin-left: 4px;">' + esc(px.geoCountry) + '</span>' : '')
          : '<span style="color: var(--text-muted); font-size: 11px;">—</span>';

        const checkBtn = '<button type="button" class="btn-secondary btn-check-proxy" style="font-size: 11px; padding: 3px 6px;" data-id="' + esc(px.id) + '" title="' + esc(t('btnCheckProxy', 'Check proxy latency and egress IP')) + '"><img src="/icons/bolt.png" class="icon-inline-sm" alt="check"></button>';

        const syncBtn = px.type === '3x-ui'
          ? '<button type="button" class="btn-secondary btn-sync-proxy" style="font-size: 11px; padding: 3px 6px;" data-id="' + esc(px.id) + '" title="' + esc(t('btnSyncProxy', 'Sync & Rotate')) + '"><img src="/icons/sync.png" class="icon-inline-sm" alt="sync"></button>'
          : '';

        const socksAuthWarn = (px.protocol === 'socks5' && px.username)
          ? ' <span title="' + esc(t('warnSocksAuthTable', 'Chromium browsers do not support SOCKS5 with authentication. Use HTTP or IP-whitelisted SOCKS5.')) + '" style="cursor: help; color: #f59e0b;" class="socks-auth-warn"><img src="/icons/warning.png" class="icon-inline-sm" alt="warn"></span>'
          : '';

        return '<tr>' +
          '<td style="text-align: center;">' + activeCell + '</td>' +
          '<td><div><strong>' + esc(px.tag) + '</strong></div>' + nameHtml + '</td>' +
          '<td><span class="badge ' + esc(typeBadge) + '">' + esc(px.type) + '</span></td>' +
          '<td><code style="font-size: 11px; text-transform: uppercase;">' + esc(px.protocol) + '</code>' + socksAuthWarn + '</td>' +
          '<td><code>' + esc(px.host) + ':' + esc(px.port) + '</code></td>' +
          '<td><span>' + esc(px.username || '—') + '</span></td>' +
          '<td><span class="badge ' + esc(statusBadge) + '" title="' + esc(px.errorMessage || '') + '">' + esc(px.status || 'IDLE') + '</span>' + syncTime + '</td>' +
          '<td>' + latencyHtml + '</td>' +
          '<td>' + egressHtml + '</td>' +
          '<td style="text-align: right;"><div style="display: flex; gap: 4px; justify-content: flex-end;">' +
            checkBtn +
            syncBtn +
            '<button type="button" class="btn-secondary btn-edit-proxy" style="font-size: 11px; padding: 3px 6px;" data-id="' + esc(px.id) + '" title="' + esc(t('btnEditProxy', 'Edit')) + '"><img src="/icons/edit.png" class="icon-inline-sm" alt="edit"></button>' +
            '<button type="button" class="btn-danger btn-delete-proxy" style="font-size: 11px; padding: 3px 6px;" data-id="' + esc(px.id) + '" title="' + esc(t('btnDeleteProxy', 'Delete')) + '"><img src="/icons/trash.png" class="icon-inline-sm" alt="del"></button>' +
          '</div></td>' +
        '</tr>';
      }).join('');
    }
  }

  const active = list.find((px) => px.isActive);
  const pacText = document.getElementById('activePacDirectiveText');
  const activeBadge = document.getElementById('activeProxyBadge');
  if (pacText) {
    if (active) {
      let directive = 'PROXY ' + active.host + ':' + active.port + '; DIRECT';
      if (active.protocol === 'socks5') directive = 'SOCKS5 ' + active.host + ':' + active.port + '; DIRECT';
      else if (active.protocol === 'https') directive = 'HTTPS ' + active.host + ':' + active.port + '; DIRECT';
      pacText.textContent = directive;
    } else {
      pacText.textContent = 'DIRECT';
    }
  }
  if (activeBadge) {
    if (active) {
      activeBadge.textContent = active.tag + ' (' + active.protocol + ')';
      activeBadge.className = 'badge badge-action-proxy';
    } else {
      activeBadge.textContent = t('badgeNoActiveProxy', 'No Active Proxy');
      activeBadge.className = 'badge badge-offline';
    }
  }

  const warnBanner = document.getElementById('noActiveProxyWarning');
  if (warnBanner) {
    const isPlaceholder = !active || active.host === '10.0.0.1' || active.status === 'ERR' || active.status === 'ERROR';
    warnBanner.style.display = isPlaceholder ? 'flex' : 'none';
  }
}

export function checkSocksAuthWarning() {
  const protoEl = document.getElementById('proxyFormProtocol') as HTMLSelectElement | null;
  const userEl = document.getElementById('proxyFormUser') as HTMLInputElement | null;
  const warnEl = document.getElementById('proxyFormSocksWarning');
  if (!warnEl) return;
  const isSocks = protoEl && (protoEl.value === 'socks5' || protoEl.value === 'socks');
  const hasAuth = userEl && userEl.value.trim().length > 0;
  if (isSocks && hasAuth) {
    warnEl.style.display = 'block';
  } else {
    warnEl.style.display = 'none';
  }
}

export function openAddManualModal() {
  const idEl = document.getElementById('proxyFormId') as HTMLInputElement | null;
  const titleEl = document.getElementById('proxyFormTitle');
  const tagEl = document.getElementById('proxyFormTag') as HTMLInputElement | null;
  const nameEl = document.getElementById('proxyFormName') as HTMLInputElement | null;
  const protoEl = document.getElementById('proxyFormProtocol') as HTMLSelectElement | null;
  const hostEl = document.getElementById('proxyFormHost') as HTMLInputElement | null;
  const portEl = document.getElementById('proxyFormPort') as HTMLInputElement | null;
  const userEl = document.getElementById('proxyFormUser') as HTMLInputElement | null;
  const passEl = document.getElementById('proxyFormPass') as HTMLInputElement | null;
  const activeEl = document.getElementById('proxyFormIsActive') as HTMLInputElement | null;
  const errEl = document.getElementById('proxyFormError');

  if (idEl) idEl.value = '';
  if (titleEl) titleEl.textContent = t('titleAddManualProxy', 'Add Manual Proxy Node');
  if (tagEl) { tagEl.value = ''; tagEl.disabled = false; }
  if (nameEl) nameEl.value = '';
  if (protoEl) { protoEl.value = 'http'; protoEl.disabled = false; }
  if (hostEl) hostEl.value = '';
  if (portEl) { portEl.value = '10809'; portEl.disabled = false; }
  if (userEl) userEl.value = '';
  if (passEl) { passEl.value = ''; passEl.placeholder = '••••••••'; }
  if (activeEl) activeEl.checked = true;
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  checkSocksAuthWarning();

  const modal = document.getElementById('modalProxyForm');
  if (modal) modal.style.display = 'flex';
  if (tagEl) tagEl.focus();
}

export function openEditProxyModal(id: string) {
  const px = (state.currentProxiesList || []).find((p) => p.id === id);
  if (!px) return;

  const idEl = document.getElementById('proxyFormId') as HTMLInputElement | null;
  const titleEl = document.getElementById('proxyFormTitle');
  const tagEl = document.getElementById('proxyFormTag') as HTMLInputElement | null;
  const nameEl = document.getElementById('proxyFormName') as HTMLInputElement | null;
  const protoEl = document.getElementById('proxyFormProtocol') as HTMLSelectElement | null;
  const hostEl = document.getElementById('proxyFormHost') as HTMLInputElement | null;
  const portEl = document.getElementById('proxyFormPort') as HTMLInputElement | null;
  const userEl = document.getElementById('proxyFormUser') as HTMLInputElement | null;
  const passEl = document.getElementById('proxyFormPass') as HTMLInputElement | null;
  const activeEl = document.getElementById('proxyFormIsActive') as HTMLInputElement | null;
  const errEl = document.getElementById('proxyFormError');

  if (idEl) idEl.value = px.id;
  if (titleEl) titleEl.textContent = t('titleEditProxy', 'Edit Proxy Node') + ': ' + px.tag;
  if (tagEl) { tagEl.value = px.tag; tagEl.disabled = (px.type === '3x-ui'); }
  if (nameEl) nameEl.value = px.name || '';
  if (protoEl) { protoEl.value = px.protocol || 'http'; protoEl.disabled = (px.type === '3x-ui'); }
  if (hostEl) hostEl.value = px.host || '';
  if (portEl) { portEl.value = String(px.port || ''); portEl.disabled = (px.type === '3x-ui'); }
  if (userEl) userEl.value = px.username || '';
  if (passEl) { passEl.value = ''; passEl.placeholder = '•••••••• (leave empty to keep unchanged)'; }
  if (activeEl) activeEl.checked = Boolean(px.isActive);
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
  checkSocksAuthWarning();

  const modal = document.getElementById('modalProxyForm');
  if (modal) modal.style.display = 'flex';
}

export function closeProxyFormModal() {
  const modal = document.getElementById('modalProxyForm');
  if (modal) modal.style.display = 'none';
}

export async function submitProxyForm() {
  const idEl = document.getElementById('proxyFormId') as HTMLInputElement | null;
  const tagEl = document.getElementById('proxyFormTag') as HTMLInputElement | null;
  const nameEl = document.getElementById('proxyFormName') as HTMLInputElement | null;
  const protoEl = document.getElementById('proxyFormProtocol') as HTMLSelectElement | null;
  const hostEl = document.getElementById('proxyFormHost') as HTMLInputElement | null;
  const portEl = document.getElementById('proxyFormPort') as HTMLInputElement | null;
  const userEl = document.getElementById('proxyFormUser') as HTMLInputElement | null;
  const passEl = document.getElementById('proxyFormPass') as HTMLInputElement | null;
  const activeEl = document.getElementById('proxyFormIsActive') as HTMLInputElement | null;
  const errEl = document.getElementById('proxyFormError');
  if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

  const id = idEl ? idEl.value.trim() : '';
  const tag = tagEl ? tagEl.value.trim() : '';
  const name = nameEl ? nameEl.value.trim() : '';
  const protocol = protoEl ? protoEl.value : 'socks5';
  const host = hostEl ? hostEl.value.trim() : '';
  const portRaw = portEl ? portEl.value.trim() : '';
  const username = userEl ? userEl.value.trim() : '';
  const password = passEl ? passEl.value : '';
  const isActive = activeEl ? Boolean(activeEl.checked) : false;

  if (!tag || !host || !portRaw) {
    if (errEl) { errEl.textContent = 'Tag, Host, and Port are required.'; errEl.style.display = 'block'; }
    return;
  }
  const portNum = parseInt(portRaw, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    if (errEl) { errEl.textContent = 'Port must be a number between 1 and 65535.'; errEl.style.display = 'block'; }
    return;
  }

  const btn = document.getElementById('btnProxyFormSubmit') as HTMLButtonElement | null;
  let origHtml = '';
  if (btn) {
    origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> ' + (btn.textContent || '').trim();
  }

  try {
    let res: Response;
    if (id) {
      const payload: any = {
        name: name || undefined,
        host,
        port: portNum,
        username: username || undefined,
        isActive
      };
      if (password) payload.password = password;
      res = await adminFetch('/api/proxies/' + encodeURIComponent(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await adminFetch('/api/proxies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag,
          name: name || undefined,
          type: 'manual',
          protocol,
          host,
          port: portNum,
          username: username || undefined,
          password: password || undefined,
          isActive
        })
      });
    }

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      closeProxyFormModal();
      toast(t('toastProxySaved', 'Proxy saved!'), 'success');
      await fetchProxies();
    } else {
      if (errEl) { errEl.textContent = data.error || 'Failed to save proxy'; errEl.style.display = 'block'; }
    }
  } catch (e: any) {
    if (errEl) { errEl.textContent = 'Network error: ' + e; errEl.style.display = 'block'; }
  } finally {
    if (btn) {
      btn.disabled = false;
      if (origHtml) btn.innerHTML = origHtml;
    }
  }
}

export async function activateProxy(id: string) {
  try {
    const res = await adminFetch('/api/proxies/' + encodeURIComponent(id) + '/activate', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      toast(t('toastProxyActivated', 'Proxy activated!'), 'success');
      await fetchProxies();
    } else {
      toast(data.error || 'Failed to activate proxy', 'error');
    }
  } catch (e) {
    toast('Error activating proxy: ' + e, 'error');
  }
}

export async function syncProxy(id: string) {
  try {
    toast('Syncing proxy with 3x-ui...', 'info');
    const res = await adminFetch('/api/proxies/' + encodeURIComponent(id) + '/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rotatePassword: true })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      toast(data.message || t('toastProxySynced', 'Proxy synchronized!'), 'success');
      await fetchProxies();
    } else {
      toast(data.error || 'Failed to sync proxy', 'error');
    }
  } catch (e) {
    toast('Error syncing proxy: ' + e, 'error');
  }
}

export async function deleteProxy(id: string) {
  if (!await pecConfirm(t('confirmDeleteProxy', 'Are you sure you want to delete this proxy node?'), { isDanger: true })) return;
  try {
    const res = await adminFetch('/api/proxies/' + encodeURIComponent(id), { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      toast(t('toastProxyDeleted', 'Proxy deleted'), 'success');
      await fetchProxies();
    } else {
      toast(data.error || 'Failed to delete proxy', 'error');
    }
  } catch (e) {
    toast('Error deleting proxy: ' + e, 'error');
  }
}

export async function checkProxy(id: string) {
  try {
    toast(t('toastCheckingProxy', 'Checking proxy connectivity and egress IP...'), 'info');
    const res = await adminFetch('/api/proxies/' + encodeURIComponent(id) + '/check', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok && data.result) {
      const r = data.result;
      const statusText = r.status === 'ONLINE' ? 'ONLINE (' + r.latencyMs + 'ms)' : r.status;
      toast(t('toastProxyCheckSuccess', 'Proxy probe: ') + statusText + (r.egressIp ? ' | IP: ' + r.egressIp : ''), r.status === 'ONLINE' ? 'success' : 'warning');
      await fetchProxies();
    } else {
      toast(data.error || 'Failed to check proxy', 'error');
    }
  } catch (e) {
    toast('Error checking proxy: ' + e, 'error');
  }
}

export async function checkAllProxies() {
  try {
    toast(t('toastCheckingAllProxies', 'Probing all proxies...'), 'info');
    const res = await adminFetch('/api/proxies/check-all', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      const count = data.results ? Object.keys(data.results).length : 0;
      toast(t('toastCheckAllSuccess', 'Probed ') + count + ' proxies successfully', 'success');
      await fetchProxies();
    } else {
      toast(data.error || 'Failed to check proxies', 'error');
    }
  } catch (e) {
    toast('Error probing proxies: ' + e, 'error');
  }
}

registerModalCloser('modalProxyForm', closeProxyFormModal);

export async function fetchProxyConfig() {
  try {
    const res = await adminFetch('/api/config');
    if (!res.ok) return;
    const cfg = await res.json();
    const mode = cfg.routingMode || 'pac';
    const pacRadio = document.getElementById('routingModePac') as HTMLInputElement | null;
    const fixedRadio = document.getElementById('routingModeFixed') as HTMLInputElement | null;
    if (pacRadio && fixedRadio) {
      if (mode === 'fixed') {
        fixedRadio.checked = true;
      } else {
        pacRadio.checked = true;
      }
    }
  } catch (err) {
    console.warn('Failed to fetch proxy config:', err);
  }
}

export async function onRoutingModeChanged(mode: string) {
  try {
    const res = await adminFetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routingMode: mode })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    toast(t('toastRoutingModeSaved', 'Routing mode updated! Extensions will receive it on next sync.'), 'success');
  } catch (e) {
    toast('Failed to update routing mode: ' + e, 'error');
    fetchProxyConfig();
  }
}
