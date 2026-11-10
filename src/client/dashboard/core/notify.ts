// Notifications, Dialogs & Modals Module for PEC Dashboard
import { state } from './state.js';

let lastActiveElementBeforeModal: HTMLElement | null = null;

export function trackModalOpener(el?: HTMLElement) {
  lastActiveElementBeforeModal = el || (document.activeElement as HTMLElement | null);
}

export function toast(message: string, type?: string) {
  if (typeof window !== 'undefined' && typeof (window as any).toast === 'function' && (window as any).toast !== toast) {
    return (window as any).toast(message, type);
  }
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-atomic', 'false');
    host.style.cssText = 'position: fixed; bottom: 18px; right: 18px; z-index: 10000; display: flex; flex-direction: column; gap: 8px; max-width: 380px;';
    document.body.appendChild(host);
  }
  while (host.children.length >= 5) {
    if (host.firstElementChild) host.firstElementChild.remove();
  }
  const el = document.createElement('div');
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const colors = type === 'error'
    ? 'background: #7f1d1d; border: 1px solid #ef4444;'
    : type === 'success'
      ? 'background: #064e3b; border: 1px solid #10b981;'
      : 'background: #1e293b; border: 1px solid #475569;';
  el.style.cssText = colors + ' color: #f8fafc; padding: 10px 14px; border-radius: 8px; font-size: 12.5px; box-shadow: 0 6px 18px rgba(0,0,0,0.35); word-break: break-word; display: flex; align-items: center; justify-content: space-between; gap: 10px;';

  el.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.style.cssText = 'background: transparent; border: none; color: inherit; font-size: 16px; line-height: 1; cursor: pointer; padding: 0 0 0 6px; opacity: 0.7; margin-left: auto;';
  closeBtn.onmouseenter = () => { closeBtn.style.opacity = '1'; };
  closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.7'; };

  function removeToast() {
    el.style.transition = 'opacity 0.25s, transform 0.25s';
    el.style.opacity = '0';
    setTimeout(() => { el.remove(); }, 260);
  }

  closeBtn.onclick = (e) => {
    e.stopPropagation();
    removeToast();
  };
  el.appendChild(closeBtn);
  host.appendChild(el);

  let timer: any = null;
  let remaining = 4200;
  let start = Date.now();

  function startTimer() {
    start = Date.now();
    timer = setTimeout(removeToast, remaining);
  }

  function pauseTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      remaining -= (Date.now() - start);
      if (remaining < 500) remaining = 500;
    }
  }

  el.addEventListener('mouseenter', pauseTimer);
  el.addEventListener('mouseleave', startTimer);
  startTimer();
}

export function getOrCreatePecDialog(): HTMLDialogElement {
  let dlg = document.getElementById('pecModalDialog') as HTMLDialogElement | null;
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'pecModalDialog';
    dlg.className = 'pec-dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'pecDialogTitle');
    dlg.setAttribute('aria-describedby', 'pecDialogMessage');
    dlg.innerHTML =
      '<div class="pec-dialog-content">' +
        '<div class="pec-dialog-header">' +
          '<h3 id="pecDialogTitle" class="pec-dialog-title"></h3>' +
        '</div>' +
        '<p id="pecDialogMessage" class="pec-dialog-message"></p>' +
        '<div id="pecDialogPromptContainer" class="pec-dialog-prompt" style="display:none;">' +
          '<input type="text" id="pecDialogInput" class="pec-dialog-input" autocomplete="off" />' +
        '</div>' +
        '<div class="pec-dialog-actions">' +
          '<button type="button" id="pecDialogCancelBtn" class="btn btn-secondary pec-dialog-btn-cancel">Cancel</button>' +
          '<button type="button" id="pecDialogConfirmBtn" class="btn btn-primary pec-dialog-btn-confirm">OK</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);
  }
  return dlg;
}

export interface PecDialogOptions {
  title?: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  isDanger?: boolean;
  cancelText?: string;
  confirmText?: string;
}

export function showPecDialog(mode: 'confirm' | 'prompt', messageOrOpts: any, defaultValue?: any, options?: PecDialogOptions): Promise<any> {
  let opts: PecDialogOptions = options || {};
  let msg = '';
  if (typeof messageOrOpts === 'object' && messageOrOpts !== null) {
    opts = messageOrOpts;
    msg = opts.message || '';
    if (opts.defaultValue !== undefined && defaultValue === undefined) {
      defaultValue = opts.defaultValue;
    }
  } else {
    msg = messageOrOpts || '';
  }

  const isRu = state.currentLang === 'ru';
  const dlg = getOrCreatePecDialog();

  const titleEl = document.getElementById('pecDialogTitle');
  const msgEl = document.getElementById('pecDialogMessage');
  const promptBox = document.getElementById('pecDialogPromptContainer');
  const inputEl = document.getElementById('pecDialogInput') as HTMLInputElement | null;
  const cancelBtn = document.getElementById('pecDialogCancelBtn') as HTMLButtonElement | null;
  const confirmBtn = document.getElementById('pecDialogConfirmBtn') as HTMLButtonElement | null;

  const title = opts.title || (mode === 'prompt'
    ? (isRu ? 'Ввод данных' : 'Prompt')
    : (opts.isDanger
      ? (isRu ? 'Подтверждение действия' : 'Confirm Action')
      : (isRu ? 'Подтверждение' : 'Confirmation')));

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = msg;

  if (cancelBtn) {
    cancelBtn.textContent = opts.cancelText || (isRu ? 'Отмена' : 'Cancel');
  }

  if (confirmBtn) {
    confirmBtn.textContent = opts.confirmText || (mode === 'prompt' ? (isRu ? 'ОК' : 'OK') : (isRu ? 'Подтвердить' : 'Confirm'));
    if (opts.isDanger) {
      confirmBtn.classList.remove('btn-primary');
      confirmBtn.classList.add('btn-danger');
    } else {
      confirmBtn.classList.remove('btn-danger');
      confirmBtn.classList.add('btn-primary');
    }
  }

  if (mode === 'prompt') {
    if (promptBox) promptBox.style.display = 'block';
    if (inputEl) {
      inputEl.value = defaultValue != null ? String(defaultValue) : '';
      inputEl.placeholder = opts.placeholder || '';
    }
  } else {
    if (promptBox) promptBox.style.display = 'none';
  }

  const prevActive = document.activeElement as HTMLElement | null;

  return new Promise((resolve) => {
    let isResolved = false;

    function cleanup(result: any) {
      if (isResolved) return;
      isResolved = true;

      dlg.removeEventListener('keydown', onKeyDown);
      dlg.removeEventListener('click', onBackdropClick);
      if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
      if (confirmBtn) confirmBtn.removeEventListener('click', onConfirm);

      if (typeof dlg.close === 'function') {
        try { dlg.close(); } catch (_) {}
      }
      dlg.removeAttribute('open');

      if (prevActive && typeof prevActive.focus === 'function') {
        try { prevActive.focus(); } catch (_) {}
      }

      resolve(result);
    }

    function onCancel() {
      cleanup(mode === 'prompt' ? null : false);
    }

    function onConfirm() {
      if (mode === 'prompt') {
        cleanup(inputEl ? inputEl.value : '');
      } else {
        cleanup(true);
      }
    }

    function onBackdropClick(e: MouseEvent) {
      if (e.target === dlg) onCancel();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === 'Enter') {
        if (document.activeElement === cancelBtn) return;
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
        return;
      }
      if (e.key === 'Tab') {
        const focusable: HTMLElement[] = [];
        if (mode === 'prompt' && inputEl) focusable.push(inputEl);
        if (cancelBtn) focusable.push(cancelBtn);
        if (confirmBtn) focusable.push(confirmBtn);

        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    dlg.addEventListener('keydown', onKeyDown);
    dlg.addEventListener('click', onBackdropClick);
    if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
    if (confirmBtn) confirmBtn.addEventListener('click', onConfirm);

    if (typeof dlg.showModal === 'function') {
      try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); }
    } else {
      dlg.setAttribute('open', '');
    }

    setTimeout(() => {
      if (mode === 'prompt' && inputEl) {
        inputEl.focus();
        if (typeof inputEl.select === 'function') inputEl.select();
      } else if (opts.isDanger && cancelBtn) {
        cancelBtn.focus();
      } else if (confirmBtn) {
        confirmBtn.focus();
      }
    }, 10);
  });
}

export function pecConfirm(message: string | PecDialogOptions, options?: PecDialogOptions): Promise<boolean> {
  if (typeof window !== 'undefined' && typeof (window as any).pecConfirm === 'function' && (window as any).pecConfirm !== pecConfirm) {
    return (window as any).pecConfirm(message, options);
  }
  return showPecDialog('confirm', message, null, options);
}

export function pecPrompt(message: string | PecDialogOptions, defaultValue?: string, options?: PecDialogOptions): Promise<string | null> {
  if (typeof window !== 'undefined' && typeof (window as any).pecPrompt === 'function' && (window as any).pecPrompt !== pecPrompt) {
    return (window as any).pecPrompt(message, defaultValue, options);
  }
  return showPecDialog('prompt', message, defaultValue, options);
}

// Global modal dialog management
const registeredModals: Array<{ id: string; close: () => void }> = [];

export function registerModalCloser(id: string, closeFn: () => void) {
  registeredModals.push({ id, close: closeFn });
}

export function closeAnyOpenModal(): boolean {
  let closed = false;
  for (const m of registeredModals) {
    const el = document.getElementById(m.id);
    if (el && el.style.display && el.style.display !== 'none') {
      try { m.close(); closed = true; } catch (_) {}
    }
  }
  const popover = document.getElementById('popoverCustomization');
  if (popover && popover.style.display !== 'none') {
    popover.style.display = 'none';
    closed = true;
  }
  const vPopover = document.getElementById('popoverVersionRelease');
  if (vPopover && vPopover.style.display !== 'none') {
    vPopover.style.display = 'none';
    closed = true;
  }
  if (closed && lastActiveElementBeforeModal && typeof lastActiveElementBeforeModal.focus === 'function') {
    try { lastActiveElementBeforeModal.focus(); } catch (_) {}
    lastActiveElementBeforeModal = null;
  }
  return closed;
}

export function initModalBackdropHandlers() {
  const modalIds = [
    'credsModal', 'modalAdd3xui', 'modal3xuiPanel', 'modalProxyForm',
    'modalEditRule', 'modalGeobaseInspector', 'modalImportPresets',
    'modalCompilerWarning', 'modalBuildLog'
  ];
  modalIds.forEach((id) => {
    const m = document.getElementById(id) as any;
    if (m && !m._backdropBound) {
      m._backdropBound = true;
      m.addEventListener('click', (e: MouseEvent) => {
        if (e.target === m) {
          closeAnyOpenModal();
        }
      });
    }
  });
}
