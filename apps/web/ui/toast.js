let toastRoot = null;
let dismissTimer = null;

function ensureRoot() {
  if (toastRoot) return toastRoot;
  toastRoot = document.createElement('div');
  toastRoot.className = 'app-toast hidden';
  toastRoot.setAttribute('role', 'status');
  toastRoot.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastRoot);
  return toastRoot;
}

export function showToast({ type = 'info', message, details = null, durationMs = 4200 } = {}) {
  if (!message) return;
  const root = ensureRoot();
  root.className = `app-toast app-toast--${type}`;
  root.innerHTML = '';

  const textWrap = document.createElement('div');
  textWrap.className = 'app-toast-text';
  const messageEl = document.createElement('div');
  messageEl.className = 'app-toast-message';
  messageEl.textContent = String(message);
  textWrap.appendChild(messageEl);

  if (details) {
    const detailsEl = document.createElement('div');
    detailsEl.className = 'app-toast-details';
    detailsEl.textContent = String(details);
    textWrap.appendChild(detailsEl);
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'app-toast-close';
  closeBtn.textContent = '×';
  closeBtn.title = 'Dismiss';
  closeBtn.addEventListener('click', () => {
    root.classList.add('hidden');
  });

  root.appendChild(textWrap);
  root.appendChild(closeBtn);
  root.classList.remove('hidden');

  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    root.classList.add('hidden');
  }, Math.max(1200, Number(durationMs) || 4200));
}

