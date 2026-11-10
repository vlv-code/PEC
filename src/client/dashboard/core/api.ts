// API & Authentication Module for PEC Dashboard
import { state, stopDashboardTimers } from './state.js';

let loginPendingRetry: { url: string; opts?: RequestInit } | null = null;
let bootDashboardCallback: (() => void) | null = null;
let toastCallback: ((msg: string, type?: string) => void) | null = null;

export function registerBootCallback(fn: () => void) {
  bootDashboardCallback = fn;
}

export function registerToastCallback(fn: (msg: string, type?: string) => void) {
  toastCallback = fn;
}

export function esc(value: any): string {
  return String(value == null ? '' : value).replace(/[&<>"'`]/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c] || c;
  });
}
export const escapeHtml = esc;

export function extractError(res?: Response, data?: any, defaultMsg?: string): string {
  if (data) {
    if (typeof data.error === 'string' && data.error) return data.error;
    if (typeof data.message === 'string' && data.message) return data.message;
    if (typeof data.detail === 'string' && data.detail) return data.detail;
  }
  if (res && res.status) {
    return (defaultMsg || 'HTTP Error') + ' (' + res.status + ')';
  }
  return defaultMsg || 'Request failed';
}

export async function adminFetch(url: string, opts?: RequestInit): Promise<Response> {
  const options: RequestInit = Object.assign({}, opts || {});
  options.credentials = 'same-origin';
  options.headers = Object.assign({}, options.headers || {}, { 'X-Requested-With': 'pec-dashboard' });

  const res = await fetch(url, options);
  if (res.status === 401) {
    stopDashboardTimers();
    state.isDashboardAuthenticated = false;
    const screen = document.getElementById('authScreen');
    const isAuthVisible = screen && screen.style.display !== 'none';
    if (!isAuthVisible) {
      showAuthStep('login');
    }
    loginPendingRetry = { url, opts };
  }
  return res;
}

export function showAuthStep(step: 'token' | 'credentials' | 'login') {
  const screen = document.getElementById('authScreen');
  if (screen) screen.style.display = 'flex';
  const stepToken = document.getElementById('authStepToken');
  const stepCreds = document.getElementById('authStepCredentials');
  const stepLogin = document.getElementById('authStepLogin');
  if (stepToken) stepToken.style.display = 'none';
  if (stepCreds) stepCreds.style.display = 'none';
  if (stepLogin) stepLogin.style.display = 'none';

  const active = document.activeElement;
  const alreadyFocused = active && screen && screen.contains(active);

  if (step === 'token') {
    if (stepToken) stepToken.style.display = 'block';
    const inp = document.getElementById('authTokenInput') as HTMLInputElement | null;
    if (inp && !alreadyFocused) { inp.value = ''; inp.focus(); }
  } else if (step === 'credentials') {
    if (stepCreds) stepCreds.style.display = 'block';
    const inp = document.getElementById('authNewUsername') as HTMLInputElement | null;
    if (inp && !alreadyFocused) { inp.value = 'admin'; inp.focus(); }
  } else {
    if (stepLogin) stepLogin.style.display = 'block';
    const userInp = document.getElementById('loginUsernameInput') as HTMLInputElement | null;
    const passInp = document.getElementById('loginTokenInput') as HTMLInputElement | null;
    if (!alreadyFocused) {
      if (userInp && !userInp.value) {
        userInp.focus();
      } else if (passInp) {
        passInp.focus();
      } else if (userInp) {
        userInp.focus();
      }
    }
  }
}

export function hideAuthScreen() {
  const screen = document.getElementById('authScreen');
  if (screen) screen.style.display = 'none';
  const modal = document.getElementById('loginModal');
  if (modal) modal.style.display = 'none';
}

export function showLoginModal() {
  showAuthStep('login');
}

export function hideLoginModal() {
  hideAuthScreen();
}

export function setTokenError(msg: string) {
  const el = document.getElementById('authTokenError');
  if (el) {
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }
}

export function setAuthCredsError(msg: string) {
  const el = document.getElementById('authCredsError');
  if (el) {
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }
}

export function setLoginError(msg: string) {
  const el = document.getElementById('loginError');
  if (el) {
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }
}

export async function handleAuthVerifyToken() {
  const input = document.getElementById('authTokenInput') as HTMLInputElement | null;
  const token = ((input && input.value) || '').trim();
  if (!token) {
    if (input) input.focus();
    setTokenError('Введите Admin Token');
    return;
  }
  const btn = document.getElementById('btnAuthVerifyToken') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  setTokenError('');
  try {
    const res = await fetch('/api/auth/setup-verify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      showAuthStep('credentials');
    } else {
      setTokenError(data.error || 'Неверный токен администратора');
    }
  } catch (e) {
    setTokenError('Сетевая ошибка: ' + e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function handleAuthSaveCredentials() {
  const userInput = document.getElementById('authNewUsername') as HTMLInputElement | null;
  const passInput = document.getElementById('authNewPassword') as HTMLInputElement | null;
  const passConfInput = document.getElementById('authNewPasswordConfirm') as HTMLInputElement | null;
  const u = ((userInput && userInput.value) || '').trim();
  const p = ((passInput && passInput.value) || '');
  const pc = ((passConfInput && passConfInput.value) || '');

  setAuthCredsError('');
  if (!u || u.length < 3) {
    setAuthCredsError('Логин должен содержать от 3 до 64 символов');
    if (userInput) userInput.focus();
    return;
  }
  if (!p || p.length < 8) {
    setAuthCredsError('Пароль должен содержать минимум 8 символов');
    if (passInput) passInput.focus();
    return;
  }
  if (p !== pc) {
    setAuthCredsError('Пароли не совпадают');
    if (passConfInput) passConfInput.focus();
    return;
  }

  const btn = document.getElementById('btnAuthSaveCredentials') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/auth/setup-credentials', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'pec-dashboard' },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      showAuthStep('login');
      const banner = document.getElementById('authSetupSuccessBanner');
      if (banner) banner.style.display = 'block';
      const loginUser = document.getElementById('loginUsernameInput') as HTMLInputElement | null;
      if (loginUser) loginUser.value = u;
      const loginPass = document.getElementById('loginTokenInput') as HTMLInputElement | null;
      if (loginPass) { loginPass.value = ''; loginPass.focus(); }
    } else {
      setAuthCredsError(data.error || 'Ошибка сохранения учётных данных');
    }
  } catch (e) {
    setAuthCredsError('Сетевая ошибка: ' + e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function handleLoginSubmit() {
  const userInput = document.getElementById('loginUsernameInput') as HTMLInputElement | null;
  const input = document.getElementById('loginTokenInput') as HTMLInputElement | null;
  const u = ((userInput && userInput.value) || '').trim();
  const v = ((input && input.value) || '').trim();
  if (!u) { if (userInput) userInput.focus(); return; }
  if (!v) { if (input) input.focus(); return; }
  const btn = document.getElementById('loginSubmitBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  setLoginError('');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: v })
    });
    if (res.ok) {
      if (userInput) userInput.value = '';
      if (input) input.value = '';
      hideAuthScreen();
      state.isDashboardAuthenticated = true;
      if (loginPendingRetry) {
        const r = loginPendingRetry;
        loginPendingRetry = null;
        adminFetch(r.url, r.opts).catch((e) => { console.warn('Retry after login failed:', e); });
      }
      if (bootDashboardCallback) bootDashboardCallback();
    } else {
      const data = await res.json().catch(() => ({}));
      setLoginError(data.error || 'Ошибка входа (HTTP ' + res.status + ')');
    }
  } catch (e) {
    setLoginError('Сетевая ошибка: ' + e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export async function logoutDashboard() {
  stopDashboardTimers();
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'pec-dashboard' }
    });
  } catch (e) {}
  state.isDashboardAuthenticated = false;
  showAuthStep('login');
}

export function setCredError(msg: string) {
  const el = document.getElementById('credError');
  if (el) {
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }
}

export async function openCredsModal() {
  setCredError('');
  const cur = document.getElementById('credCurrentPassword') as HTMLInputElement | null;
  const un = document.getElementById('credUsernameInput') as HTMLInputElement | null;
  const np = document.getElementById('credNewPassword') as HTMLInputElement | null;
  if (cur) cur.value = '';
  if (np) np.value = '';
  try {
    const res = await adminFetch('/api/auth/session');
    const data = await res.json();
    if (un && data.username) un.value = data.username;
  } catch (e) {}
  const m = document.getElementById('credsModal');
  if (m) m.style.display = 'flex';
  if (cur) cur.focus();
}

export function closeCredsModal() {
  const m = document.getElementById('credsModal');
  if (m) m.style.display = 'none';
}

export async function submitCredsChange() {
  const cur = document.getElementById('credCurrentPassword') as HTMLInputElement | null;
  const un = document.getElementById('credUsernameInput') as HTMLInputElement | null;
  const np = document.getElementById('credNewPassword') as HTMLInputElement | null;
  const currentPassword = (cur && cur.value) || '';
  const newUsername = ((un && un.value) || '').trim();
  const newPassword = (np && np.value) || '';
  if (!currentPassword) { setCredError('Введите текущий пароль'); if (cur) cur.focus(); return; }
  if (!newUsername && !newPassword) { setCredError('Укажите новый логин и/или новый пароль'); return; }
  const btn = document.getElementById('credSubmitBtn') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  setCredError('');
  try {
    const res = await adminFetch('/api/auth/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newUsername: newUsername || undefined, newPassword: newPassword || undefined })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      closeCredsModal();
      if (toastCallback) {
        toastCallback('Учётные данные обновлены. Другие сессии завершены.', 'success');
      }
    } else {
      setCredError(data.error || 'Не удалось сохранить (HTTP ' + res.status + ')');
    }
  } catch (e) {
    setCredError('Сетевая ошибка: ' + e);
  } finally {
    if (btn) btn.disabled = false;
  }
}
