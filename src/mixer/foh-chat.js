'use strict';

// Team chat card on the Home pages (FOH, ProPresenter, Lighting, Switcher, Producer and any added).
// History from /chat/history, new messages live from /chat/stream (see
// src/server/chat.js). Each message shows who sent it: the person scheduled
// for that page's role (foh.js sets window.fohChatIdentity), or the role.
(() => {
  const log = document.getElementById('fhChatLog');
  const form = document.getElementById('fhChatForm');
  if (!log || !form) return;
  const input = document.getElementById('fhChatInput');
  const send = document.getElementById('fhChatSend');
  const error = document.getElementById('fhChatError');
  const ROLE_LABELS = { foh: 'FOH', propresenter: 'ProPresenter', lighting: 'Lighting', switcher: 'Switcher', producer: 'Producer' };
  const ROLE_COLORS = { foh: '#ff6b85', propresenter: '#4dabf7', lighting: '#ffd43b', switcher: '#69db7c', producer: '#b197fc' };
  // An added Home page: its name comes with the message, its color from its id
  const MORE_COLORS = ['#ffa94d', '#3bc9db', '#f783ac', '#a9e34b', '#748ffc', '#e599f7', '#63e6be', '#ffc078'];
  const roleColor = (role) => ROLE_COLORS[role] || MORE_COLORS[[...String(role)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % MORE_COLORS.length];
  const roleName = (msg) => msg.roleLabel || ROLE_LABELS[msg.role] || 'Home';
  const seen = new Set();

  // Marks this browser's own messages (right-aligned), across reloads
  let clientId = '';
  try { clientId = localStorage.getItem('jpm_chat_client') || ''; } catch (_) {}
  if (!clientId) {
    clientId = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    try { localStorage.setItem('jpm_chat_client', clientId); } catch (_) {}
  }

  const time = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;

  function add(msg) {
    if (!msg || seen.has(msg.id)) return;
    seen.add(msg.id);
    const stick = nearBottom();
    const row = document.createElement('div');
    row.className = 'fh-chat-msg' + (msg.clientId && msg.clientId === clientId ? ' mine' : '');
    row.style.setProperty('--role', roleColor(msg.role));
    const meta = document.createElement('div');
    meta.className = 'fh-chat-meta';
    const role = document.createElement('span');
    role.className = 'fh-chat-role';
    role.textContent = msg.name ? `${msg.name} · ${roleName(msg)}` : roleName(msg);
    const at = document.createElement('span');
    at.textContent = time(msg.at);
    meta.append(role, at);
    const text = document.createElement('div');
    text.className = 'fh-chat-text';
    text.textContent = msg.text; // plain text only
    row.append(meta, text);
    log.appendChild(row);
    delete log.dataset.empty;
    if (stick || row.classList.contains('mine')) log.scrollTop = log.scrollHeight;
    if (document.hidden && !row.classList.contains('mine')) flagUnread();
  }

  // A count in the tab title while the page is in the background
  let unread = 0;
  const baseTitle = () => document.title.replace(/^\(\d+\) /, '');
  function flagUnread() { unread++; document.title = `(${unread}) ${baseTitle()}`; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && unread) { unread = 0; document.title = baseTitle(); } });

  // The chat clears itself when the service moves on (chat.js); `generation`
  // tells a page that missed the clear (asleep, reconnecting) to empty too
  let generation = null;
  function clearLog() {
    log.textContent = '';
    seen.clear();
    log.dataset.empty = 'No messages yet. Say hi to the team.';
  }

  async function loadHistory() {
    try {
      const res = await fetch('/chat/history', { cache: 'no-store' });
      const data = await res.json();
      if (generation !== null && data.generation !== generation) clearLog();
      generation = data.generation ?? generation;
      for (const msg of data.messages || []) add(msg);
      if (!log.children.length) log.dataset.empty = 'No messages yet. Say hi to the team.';
      log.scrollTop = log.scrollHeight;
    } catch (_) {}
  }

  function connect() {
    if (!window.EventSource) return;
    const source = new EventSource('/chat/stream');
    source.addEventListener('message', (e) => { try { add(JSON.parse(e.data)); } catch (_) {} });
    source.addEventListener('clear', (e) => { try { generation = JSON.parse(e.data).generation; } catch (_) {} clearLog(); });
    // EventSource reconnects by itself; catch anything sent while it was down
    source.addEventListener('open', loadHistory);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const who = window.fohChatIdentity || {};
    send.disabled = true;
    error.textContent = '';
    try {
      const res = await fetch('/chat/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ role: who.role || 'foh', name: who.name || '', text, clientId })
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) { error.textContent = data.error || 'Couldn’t send that. Try again.'; return; }
      input.value = '';
      add(data.message);
    } catch (_) {
      error.textContent = 'Can’t reach JPMixer right now. Your message wasn’t sent.';
    } finally {
      send.disabled = false;
      input.focus();
    }
  });

  loadHistory();
  connect();
})();
