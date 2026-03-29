(() => {
  if (window.__clipnest) return;
  window.__clipnest = true;

  // ── State ──
  let snippets = [];
  let history = [];
  let settings = { maxHistoryItems: 30, autoPaste: true, hotkey: { key: 'v', code: 'KeyV', metaKey: false, shiftKey: false, ctrlKey: false, altKey: true } };
  let visible = false;
  let currentTab = 'history';
  let activeField = null;
  let editingItem = null;
  let selectedIndex = -1;       // Currently highlighted row index
  let actionableItems = [];     // Flat list of { el, action, type, data } for keyboard nav
  let searchVisible = false;

  // ── Shadow DOM ──
  const host = document.createElement('div');
  host.id = 'clipnest-host';
  host.style.cssText = 'position:static;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
    :host { all: initial; }
    * { margin: 0; padding: 0; box-sizing: border-box; }

    .panel {
      position: fixed;
      width: 300px;
      max-height: 400px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,.12), 0 2px 8px rgba(0,0,0,.08);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 13px;
      color: #1a1a1a;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(0,0,0,.06);
      animation: cn-in .12s ease-out;
    }

    @keyframes cn-in {
      from { opacity: 0; transform: translateY(-4px) scale(.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Search */
    .search-wrap { padding: 10px 12px 6px; }

    .search {
      width: 100%;
      padding: 8px 12px;
      border: 1.5px solid #e5e5e5;
      border-radius: 8px;
      font: inherit; font-size: 13px;
      color: #1a1a1a;
      background: #fafafa;
      outline: none;
      transition: border-color .15s, box-shadow .15s;
    }
    .search:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.1); background: #fff; }
    .search::placeholder { color: #aaa; }

    /* Tabs */
    .tabs { display: flex; gap: 2px; padding: 0 12px; margin-bottom: 2px; }

    .tab {
      flex: 1; padding: 7px 0; background: none; border: none;
      border-bottom: 2px solid transparent;
      font: inherit; font-size: 12px; font-weight: 500;
      color: #999; cursor: pointer; transition: color .15s, border-color .15s;
    }
    .tab:hover { color: #555; }
    .tab.active { color: #3b82f6; border-bottom-color: #3b82f6; }

    .tab-gear {
      background: none; border: none; color: #bbb; cursor: pointer;
      font-size: 14px; padding: 4px 8px; transition: color .15s;
    }
    .tab-gear:hover { color: #555; }

    /* List */
    .list-wrap { flex: 1; overflow-y: auto; padding: 4px 0; outline: none; }
    .list-wrap::-webkit-scrollbar { width: 4px; }
    .list-wrap::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }

    .section-label {
      padding: 6px 14px 4px;
      font-size: 10px; font-weight: 600; color: #aaa;
      text-transform: uppercase; letter-spacing: .6px;
    }

    .row {
      display: flex; align-items: center; gap: 10px;
      padding: 7px 14px; cursor: pointer; transition: background .06s;
    }
    .row:hover { background: #f5f5f5; }
    .row.selected { background: #eff6ff; }

    .row-icon {
      width: 28px; height: 28px; border-radius: 7px;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; flex-shrink: 0; background: #f0f0f0;
    }

    .row-body { flex: 1; min-width: 0; }

    .row-title {
      font-size: 13px; font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    .row-sub {
      font-size: 11px; color: #999;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      margin-top: 1px;
    }

    .row-meta { font-size: 10px; color: #bbb; flex-shrink: 0; }
    .row-pin { color: #f59e0b; font-size: 11px; flex-shrink: 0; }

    .row-actions { display: flex; gap: 2px; opacity: 0; transition: opacity .1s; }
    .row:hover .row-actions, .row.selected .row-actions { opacity: 1; }

    .mini-btn {
      background: none; border: none; cursor: pointer;
      font-size: 13px; color: #aaa; padding: 2px 4px; border-radius: 4px; line-height: 1;
    }
    .mini-btn:hover { background: #eee; color: #555; }

    .folder-icon { background: #fef3c7; color: #d97706; }
    .folder-children { padding-left: 18px; }

    .key-hint {
      font-size: 10px; color: #bbb; font-weight: 600;
      width: 14px; text-align: center; flex-shrink: 0;
    }
    .row.selected .key-hint { color: #3b82f6; }

    .footer-btn {
      background: none; border: none; font: inherit;
      font-size: 11px; color: #3b82f6; cursor: pointer;
      padding: 3px 6px; border-radius: 4px;
    }
    .footer-btn:hover { background: #f0f7ff; }
    .footer-btn.danger { color: #ef4444; }
    .footer-btn.danger:hover { background: #fef2f2; }

    /* Editor */
    .editor { padding: 12px; display: flex; flex-direction: column; gap: 8px; }

    .editor-header {
      display: flex; align-items: center; gap: 8px;
      font-weight: 600; font-size: 14px;
    }

    .back-btn {
      background: none; border: none; cursor: pointer;
      font-size: 16px; color: #999; padding: 2px; border-radius: 4px; line-height: 1;
    }
    .back-btn:hover { color: #333; background: #f0f0f0; }

    .editor input[type="text"], .editor textarea {
      width: 100%; padding: 8px 10px;
      border: 1.5px solid #e5e5e5; border-radius: 8px;
      font: inherit; font-size: 13px; color: #1a1a1a;
      background: #fafafa; outline: none; transition: border-color .15s;
    }
    .editor input[type="text"]:focus, .editor textarea:focus {
      border-color: #3b82f6; background: #fff;
    }
    .editor textarea { min-height: 100px; resize: vertical; font-family: inherit; }

    .editor-meta {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 11px; color: #999;
    }
    .editor-meta label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .editor-meta input[type="checkbox"] { accent-color: #3b82f6; }

    .editor-btns { display: flex; gap: 8px; align-items: center; }

    .btn-primary {
      background: #3b82f6; color: #fff; border: none;
      padding: 7px 18px; border-radius: 8px;
      font: inherit; font-size: 13px; font-weight: 500;
      cursor: pointer; transition: background .15s;
    }
    .btn-primary:hover { background: #2563eb; }

    .empty-state { padding: 24px 14px; text-align: center; color: #bbb; font-size: 12px; }

    /* Settings */
    .settings { padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .settings-header {
      display: flex; align-items: center; gap: 8px;
      font-weight: 600; font-size: 14px;
    }

    .setting-row {
      display: flex; align-items: center; justify-content: space-between;
    }
    .setting-label { font-size: 13px; color: #555; }

    .setting-row select {
      background: #fafafa; color: #1a1a1a; border: 1.5px solid #e5e5e5;
      border-radius: 6px; padding: 4px 8px; font: inherit; font-size: 13px;
      outline: none;
    }
    .setting-row select:focus { border-color: #3b82f6; }
    .setting-row input[type="checkbox"] { accent-color: #3b82f6; width: 16px; height: 16px; }

    .hotkey-recorder {
      display: flex; align-items: center; gap: 8px;
    }
    .hotkey-display {
      padding: 6px 12px; background: #f5f5f5; border: 1.5px solid #e5e5e5;
      border-radius: 6px; font-size: 12px; font-weight: 500; color: #333;
      min-width: 100px; text-align: center;
    }
    .hotkey-display:focus { outline: none; }
    .hotkey-display.recording {
      border-color: #3b82f6; background: #eff6ff; color: #3b82f6;
      animation: cn-pulse 1s infinite;
    }
    @keyframes cn-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: .6; }
    }
    .hotkey-record-btn {
      background: none; border: 1.5px solid #e5e5e5; border-radius: 6px;
      padding: 5px 10px; font: inherit; font-size: 11px; color: #3b82f6;
      cursor: pointer;
    }
    .hotkey-record-btn:hover { background: #f0f7ff; }

    .hidden { display: none !important; }

    /* Chip */
    .chip {
      position: fixed;
      display: flex; align-items: center; gap: 4px;
      padding: 4px 10px;
      background: #fff;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 11px; font-weight: 500;
      color: #888;
      cursor: pointer;
      z-index: 2147483646;
      opacity: 0;
      transform: translateY(2px);
      transition: opacity .15s, transform .15s, background .1s, color .1s;
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
    }
    .chip.show {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    .chip:hover { background: #f0f7ff; color: #3b82f6; border-color: #bfdbfe; }
    .chip-icon { font-size: 13px; line-height: 1; }
    .chip-key {
      font-size: 9px; color: #bbb; font-weight: 600;
      background: #f5f5f5; padding: 1px 4px; border-radius: 3px;
    }
  `;
  shadow.appendChild(style);

  // ── Panel HTML ──
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div id="cn-main">
      <div class="search-wrap hidden" id="cn-search-wrap">
        <input class="search" id="cn-search" placeholder="Search..." autocomplete="off">
      </div>
      <div class="tabs">
        <button class="tab" data-tab="snippets">Snippets</button>
        <button class="tab active" data-tab="history">History</button>
        <button class="tab-gear" id="cn-settings" title="Settings">⚙</button>
      </div>
      <div class="list-wrap" id="cn-list" tabindex="0"></div>
    </div>

    <div id="cn-editor" class="hidden">
      <div class="editor">
        <div class="editor-header">
          <button class="back-btn" id="cn-editor-back">←</button>
          <span id="cn-editor-title">Edit Snippet</span>
        </div>
        <input type="text" id="cn-editor-name" placeholder="Title">
        <textarea id="cn-editor-content" placeholder="Content&#10;&#10;{{date}} {{time}} {{datetime}} {{clipboard}}"></textarea>
        <div class="editor-meta">
          <label><input type="checkbox" id="cn-editor-pinned"> Pinned</label>
          <span id="cn-editor-chars">0 chars</span>
        </div>
        <div class="editor-btns">
          <button class="btn-primary" id="cn-editor-save">Save</button>
          <button class="footer-btn danger" id="cn-editor-delete">Delete</button>
        </div>
      </div>
    </div>

    <div id="cn-folder-editor" class="hidden">
      <div class="editor">
        <div class="editor-header">
          <button class="back-btn" id="cn-folder-back">←</button>
          <span>Edit Folder</span>
        </div>
        <input type="text" id="cn-folder-name" placeholder="Folder name">
        <div class="editor-btns">
          <button class="btn-primary" id="cn-folder-save">Save</button>
          <button class="footer-btn danger" id="cn-folder-delete">Delete</button>
        </div>
      </div>
    </div>

    <div id="cn-settings-view" class="hidden">
      <div class="settings">
        <div class="settings-header">
          <button class="back-btn" id="cn-settings-back">←</button>
          <span>Settings</span>
        </div>
        <div class="setting-row">
          <span class="setting-label">Shortcut</span>
          <div class="hotkey-recorder">
            <div class="hotkey-display" id="cn-hotkey-display" tabindex="0">⌘⇧V</div>
            <button class="hotkey-record-btn" id="cn-hotkey-record">Record</button>
          </div>
        </div>
        <div class="setting-row">
          <span class="setting-label">Max History</span>
          <select id="cn-setting-max-history">
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="30">30</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
        <div class="setting-row">
          <span class="setting-label">Auto Paste</span>
          <input type="checkbox" id="cn-setting-auto-paste">
        </div>
        <div style="border-top:1px solid #f0f0f0; padding-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
          <button class="footer-btn" id="cn-s-add-snippet">+ Snippet</button>
          <button class="footer-btn" id="cn-s-add-folder">+ Folder</button>
          <button class="footer-btn" id="cn-s-import">Import</button>
          <button class="footer-btn" id="cn-s-export">Export</button>
          <button class="footer-btn danger" id="cn-s-clear-history">Clear History</button>
        </div>
      </div>
    </div>
  `;
  panel.classList.add('hidden');
  shadow.appendChild(panel);

  // ── Chip (floating hint near text fields) ──
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.innerHTML = `<span class="chip-icon">📋</span> Paste <span class="chip-key">⌥V</span>`;
  shadow.appendChild(chip);

  let chipTimer = null;
  let chipField = null;
  let chipClicking = false;

  function positionChip(el) {
    const rect = el.getBoundingClientRect();
    // Place chip at top-right of the field
    let top = rect.top - 28;
    let left = rect.right - chip.offsetWidth;
    // If not enough space above, place below
    if (top < 4) top = rect.bottom + 4;
    // Clamp to viewport
    if (left < 4) left = 4;
    if (left + 120 > window.innerWidth) left = window.innerWidth - 124;
    chip.style.top = `${top}px`;
    chip.style.left = `${left}px`;
  }

  function showChip(el) {
    if (visible) return;
    chipField = el;
    positionChip(el);
    requestAnimationFrame(() => chip.classList.add('show'));
  }

  function hideChip() {
    chip.classList.remove('show');
    chipField = null;
    clearTimeout(chipTimer);
  }

  chip.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chipClicking = true;
    // Refocus the original field to keep activeField valid
    if (activeField) {
      try { activeField.focus(); } catch {}
    }
    hideChip();
    loadData().then(() => captureClipboard().then(() => {
      show();
      chipClicking = false;
    }));
  });

  document.body.appendChild(host);
  host.style.display = '';

  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = '.json'; fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  // ── Helpers ──
  const $ = (sel) => shadow.querySelector(sel);
  const $$ = (sel) => shadow.querySelectorAll(sel);

  function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

  function expandPlaceholders(text) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);
    return text
      .replace(/\{\{date\}\}/g, date)
      .replace(/\{\{time\}\}/g, time)
      .replace(/\{\{datetime\}\}/g, `${date} ${time}`)
      .replace(/\{\{clipboard\}\}/g, '');
  }

  function detectIcon(content) {
    if (!content) return '📄';
    const t = content.trim();
    if (/^[\w.\-+]+@[\w.-]+\.\w+$/.test(t)) return '✉️';
    if (/^https?:\/\//.test(t)) return '🔗';
    if (/^[\d+\-() ]{7,}$/.test(t)) return '📞';
    if (/^[/~]/.test(t)) return '📁';
    if (/[{}<>;=]/.test(content) && content.length > 20) return '💻';
    if (content.includes('\n')) return '📝';
    return '📄';
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ── Data ──
  async function loadData() {
    const data = await chrome.storage.local.get(['snippets', 'history', 'settings']);
    snippets = data.snippets || [];
    history = data.history || [];
    settings = { maxHistoryItems: 30, autoPaste: true, ...data.settings };
  }

  async function saveSnippets() { await chrome.storage.local.set({ snippets }); }
  async function saveHistory() { await chrome.storage.local.set({ history }); }

  async function captureClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) return;
      const idx = history.findIndex(h => h.content === text);
      if (idx !== -1) history.splice(idx, 1);
      history.unshift({ id: crypto.randomUUID(), content: text, timestamp: Date.now() });
      if (history.length > settings.maxHistoryItems) history = history.slice(0, settings.maxHistoryItems);
      await saveHistory();
    } catch {}
  }

  // ── Paste ──
  function pasteText(text) {
    const expanded = expandPlaceholders(text);
    if (activeField) {
      activeField.focus();
      document.execCommand('insertText', false, expanded);
    }
    hide();
  }

  // ── Selection ──
  function setSelected(idx) {
    if (idx < -1) idx = actionableItems.length - 1;
    if (idx >= actionableItems.length) idx = 0;
    // Deselect previous
    if (selectedIndex >= 0 && actionableItems[selectedIndex]) {
      actionableItems[selectedIndex].el.classList.remove('selected');
    }
    selectedIndex = idx;
    if (idx >= 0 && actionableItems[idx]) {
      actionableItems[idx].el.classList.add('selected');
      actionableItems[idx].el.scrollIntoView({ block: 'nearest' });
    }
  }

  function executeSelected() {
    if (selectedIndex >= 0 && actionableItems[selectedIndex]) {
      const item = actionableItems[selectedIndex];
      if (item.type === 'snippet') pasteText(item.data.content || '');
      else if (item.type === 'history') pasteText(item.data.content);
      else if (item.type === 'folder') toggleFolder(item);
    }
  }

  function editSelected() {
    if (selectedIndex >= 0 && actionableItems[selectedIndex]) {
      const item = actionableItems[selectedIndex];
      if (item.type === 'snippet') openEditor(item.data);
      else if (item.type === 'folder') openFolderEditor(item.data);
    }
  }

  function toggleFolder(item) {
    const children = item.el.nextElementSibling;
    if (children && children.classList.contains('folder-children')) {
      children.classList.toggle('hidden');
      item.el.querySelector('.row-icon').textContent = children.classList.contains('hidden') ? '📁' : '📂';
      rebuildActionableItems();
      // Re-select the same folder
      const newIdx = actionableItems.findIndex(a => a.data?.id === item.data.id);
      if (newIdx !== -1) setSelected(newIdx);
    }
  }

  // Rebuild the flat actionable items list from visible rows
  function rebuildActionableItems() {
    actionableItems = [];
    const rows = $('#cn-list').querySelectorAll('.row');
    rows.forEach(el => {
      // Skip rows inside hidden folder-children
      if (el.closest('.folder-children.hidden')) return;
      const itemData = el.__cnData;
      if (itemData) actionableItems.push({ el, ...itemData });
    });
  }

  // ── Show / Hide ──
  function show() {
    if (!activeField) activeField = document.activeElement;
    hideChip();
    const rect = activeField?.getBoundingClientRect?.();
    if (rect && (activeField.tagName === 'INPUT' || activeField.tagName === 'TEXTAREA' || activeField.isContentEditable)) {
      panel.style.position = 'absolute';
      panel.style.left = `${window.scrollX + rect.left}px`;
      panel.style.top = `${window.scrollY + rect.bottom + 6}px`;
    } else {
      panel.style.position = 'fixed';
      panel.style.left = '50%';
      panel.style.top = '20%';
      panel.style.transform = 'translateX(-50%)';
    }

    panel.classList.remove('hidden');
    requestAnimationFrame(() => {
      const pr = panel.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (pr.right > vw - 8) {
        const newLeft = rect ? (window.scrollX + vw - pr.width - 8) : (vw - pr.width - 8);
        panel.style.left = `${newLeft}px`;
      }
      if (pr.bottom > vh - 8) {
        const newTop = rect
          ? (window.scrollY + rect.top - pr.height - 6)
          : (vh * 0.2 - pr.height);
        panel.style.top = `${newTop}px`;
      }
    });

    visible = true;
    selectedIndex = -1;
    searchVisible = false;
    showMain();
    $('#cn-search-wrap').classList.add('hidden');
    $('#cn-search').value = '';
    render();
    setTimeout(() => $('#cn-list').focus(), 30);
  }

  function hide() {
    panel.classList.add('hidden');
    panel.style.transform = '';
    visible = false;
    editingItem = null;
    selectedIndex = -1;
    actionableItems = [];
    // Restore focus to original field
    if (activeField) {
      try { activeField.focus(); } catch {}
    }
  }

  function toggle() {
    if (visible) hide();
    else loadData().then(() => captureClipboard().then(show));
  }

  // ── Tab switching ──
  function switchTab(tab) {
    currentTab = tab;
    $$('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    selectedIndex = -1;
    render();
    $('#cn-search').focus();
  }

  function cycleTab() {
    switchTab(currentTab === 'snippets' ? 'history' : 'snippets');
  }

  // ── Views ──
  function showMain() {
    $('#cn-main').classList.remove('hidden');
    $('#cn-editor').classList.add('hidden');
    $('#cn-folder-editor').classList.add('hidden');
    $('#cn-settings-view').classList.add('hidden');
  }

  // ── Hotkey helpers ──
  function hotkeyLabel(hk) {
    const parts = [];
    if (hk.ctrlKey) parts.push('Ctrl');
    if (hk.altKey) parts.push('Alt');
    if (hk.shiftKey) parts.push('⇧');
    if (hk.metaKey) parts.push('⌘');
    parts.push(hk.key.length === 1 ? hk.key.toUpperCase() : hk.key);
    return parts.join('');
  }

  function matchesHotkey(e, hk) {
    // Use e.code for reliable matching (e.key changes with Alt on macOS)
    const code = hk.code || `Key${hk.key.toUpperCase()}`;
    return e.code === code
      && e.metaKey === !!hk.metaKey
      && e.ctrlKey === !!hk.ctrlKey
      && e.shiftKey === !!hk.shiftKey
      && e.altKey === !!hk.altKey;
  }

  // ── Settings view ──
  let recording = false;

  function openSettings() {
    $('#cn-main').classList.add('hidden');
    $('#cn-settings-view').classList.remove('hidden');
    $('#cn-hotkey-display').textContent = hotkeyLabel(settings.hotkey);
    $('#cn-hotkey-display').classList.remove('recording');
    $('#cn-setting-max-history').value = settings.maxHistoryItems;
    $('#cn-setting-auto-paste').checked = settings.autoPaste;
    recording = false;
  }

  async function closeSettings() {
    settings.maxHistoryItems = parseInt($('#cn-setting-max-history').value);
    settings.autoPaste = $('#cn-setting-auto-paste').checked;
    recording = false;
    await chrome.storage.local.set({ settings });
    showMain();
    render();
    setTimeout(() => $('#cn-list').focus(), 30);
  }

  // ── Render ──
  function render() {
    const q = ($('#cn-search')?.value || '').toLowerCase();
    const list = $('#cn-list');
    list.innerHTML = '';
    actionableItems = [];

    if (currentTab === 'snippets') renderSnippets(list, q);
    else renderHistory(list, q);

    rebuildActionableItems();

    // Auto-select first item if nothing selected
    if (selectedIndex === -1 && actionableItems.length > 0) {
      setSelected(0);
    }
  }

  function renderSnippets(container, q) {
    const pinned = snippets.filter(s => !s.isFolder && s.isPinned && match(s, q));
    if (pinned.length) {
      container.innerHTML += `<div class="section-label">Pinned</div>`;
      pinned.forEach((s, i) => container.appendChild(snippetRow(s, i)));
    }

    if (q) {
      const results = snippets.filter(s => match(s, q) && !s.isPinned);
      if (!results.length && !pinned.length) {
        container.innerHTML += `<div class="empty-state">No snippets found</div>`;
      }
      let idx = pinned.length;
      results.forEach(s => {
        container.appendChild(s.isFolder ? folderRow(s) : snippetRow(s, idx++));
      });
    } else {
      const roots = snippets.filter(s => !s.parentId).sort((a, b) => (a.order || 0) - (b.order || 0));
      if (!roots.length && !pinned.length) {
        container.innerHTML += `<div class="empty-state">No snippets yet</div>`;
      }
      let idx = pinned.length;
      roots.forEach(item => {
        if (item.isFolder) {
          container.appendChild(folderTree(item));
        } else if (!item.isPinned) {
          container.appendChild(snippetRow(item, idx++));
        }
      });
    }
  }

  function renderHistory(container, q) {
    const items = history.filter(h => !q || h.content.toLowerCase().includes(q));
    if (!items.length) {
      container.innerHTML = `<div class="empty-state">No history yet</div>`;
      return;
    }
    items.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.__cnData = { type: 'history', data: item };
      const preview = item.content.slice(0, 60).replace(/\n/g, ' ');
      row.innerHTML = `
        ${i < 9 ? `<span class="key-hint">${i + 1}</span>` : ''}
        <div class="row-icon">${detectIcon(item.content)}</div>
        <div class="row-body"><div class="row-title">${esc(preview)}</div></div>
        <span class="row-meta">${timeAgo(item.timestamp)}</span>
      `;
      row.addEventListener('click', () => pasteText(item.content));
      container.appendChild(row);
    });
  }

  function match(item, q) {
    if (!q) return true;
    return (item.title || '').toLowerCase().includes(q) || (item.content || '').toLowerCase().includes(q);
  }

  function snippetRow(s, idx) {
    const row = document.createElement('div');
    row.className = 'row';
    row.__cnData = { type: 'snippet', data: s };
    row.innerHTML = `
      ${idx < 9 ? `<span class="key-hint">${idx + 1}</span>` : ''}
      <div class="row-icon">${detectIcon(s.content)}</div>
      <div class="row-body">
        <div class="row-title">${esc(s.title || 'Untitled')}</div>
        <div class="row-sub">${esc((s.content || '').slice(0, 50))}</div>
      </div>
      ${s.isPinned ? '<span class="row-pin">★</span>' : ''}
      <div class="row-actions"><button class="mini-btn cn-edit" title="Edit (e)">✎</button></div>
    `;
    row.querySelector('.cn-edit').addEventListener('click', (e) => { e.stopPropagation(); openEditor(s); });
    row.addEventListener('click', () => pasteText(s.content || ''));
    return row;
  }

  function folderRow(f) {
    const row = document.createElement('div');
    row.className = 'row';
    row.__cnData = { type: 'folder', data: f };
    row.innerHTML = `
      <div class="row-icon folder-icon">📁</div>
      <div class="row-body"><div class="row-title">${esc(f.title || 'Untitled')}</div></div>
      <div class="row-actions"><button class="mini-btn cn-edit-f" title="Edit (e)">✎</button></div>
    `;
    row.querySelector('.cn-edit-f').addEventListener('click', (e) => { e.stopPropagation(); openFolderEditor(f); });
    return row;
  }

  function folderTree(folder) {
    const wrap = document.createElement('div');

    const row = document.createElement('div');
    row.className = 'row';
    row.__cnData = { type: 'folder', data: folder };
    row.innerHTML = `
      <div class="row-icon folder-icon">📁</div>
      <div class="row-body"><div class="row-title">${esc(folder.title || 'Untitled')}</div></div>
      <div class="row-actions">
        <button class="mini-btn cn-add-in" title="Add snippet">+</button>
        <button class="mini-btn cn-edit-f" title="Edit (e)">✎</button>
      </div>
    `;

    const children = document.createElement('div');
    children.className = 'folder-children hidden';

    let childIdx = 0;
    snippets
      .filter(s => s.parentId === folder.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .forEach(item => {
        children.appendChild(item.isFolder ? folderTree(item) : snippetRow(item, 99));
      });

    row.addEventListener('click', (e) => {
      if (e.target.closest('.cn-edit-f')) { e.stopPropagation(); openFolderEditor(folder); return; }
      if (e.target.closest('.cn-add-in')) { e.stopPropagation(); addSnippet(folder.id); return; }
      children.classList.toggle('hidden');
      row.querySelector('.row-icon').textContent = children.classList.contains('hidden') ? '📁' : '📂';
      rebuildActionableItems();
    });

    wrap.appendChild(row);
    wrap.appendChild(children);
    return wrap;
  }

  // ── Editors ──
  function addSnippet(parentId) {
    openEditor({ id: crypto.randomUUID(), title: '', content: '', order: 0, isPinned: false, parentId: parentId || null }, true);
  }

  function openEditor(item, isNew = false) {
    editingItem = { ...item, _isNew: isNew, _type: 'snippet' };
    $('#cn-main').classList.add('hidden');
    $('#cn-editor').classList.remove('hidden');
    $('#cn-editor-title').textContent = isNew ? 'New Snippet' : 'Edit Snippet';
    $('#cn-editor-name').value = item.title || '';
    $('#cn-editor-content').value = item.content || '';
    $('#cn-editor-pinned').checked = item.isPinned || false;
    $('#cn-editor-chars').textContent = `${(item.content || '').length} chars`;
    $('#cn-editor-delete').classList.toggle('hidden', isNew);
    setTimeout(() => $('#cn-editor-name').focus(), 30);
  }

  function openFolderEditor(folder, isNew = false) {
    editingItem = { ...folder, _isNew: isNew, _type: 'folder' };
    $('#cn-main').classList.add('hidden');
    $('#cn-folder-editor').classList.remove('hidden');
    $('#cn-folder-name').value = folder.title || '';
    $('#cn-folder-delete').classList.toggle('hidden', isNew);
    setTimeout(() => $('#cn-folder-name').focus(), 30);
  }

  function closeEditor() {
    editingItem = null;
    showMain();
    render();
    setTimeout(() => $('#cn-list').focus(), 30);
  }

  async function saveEditor() {
    if (!editingItem || editingItem._type !== 'snippet') return;
    const obj = { ...editingItem };
    obj.title = $('#cn-editor-name').value.trim() || 'Untitled';
    obj.content = $('#cn-editor-content').value;
    obj.isPinned = $('#cn-editor-pinned').checked;
    const isNew = obj._isNew;
    delete obj._isNew; delete obj._type;
    if (isNew) snippets.push(obj);
    else { const i = snippets.findIndex(s => s.id === obj.id); if (i !== -1) snippets[i] = obj; }
    await saveSnippets();
    closeEditor();
  }

  async function deleteEditor() {
    if (!editingItem) return;
    snippets = snippets.filter(s => s.id !== editingItem.id);
    await saveSnippets();
    closeEditor();
  }

  async function saveFolderEditor() {
    if (!editingItem || editingItem._type !== 'folder') return;
    const obj = { ...editingItem };
    obj.title = $('#cn-folder-name').value.trim() || 'Untitled Folder';
    const isNew = obj._isNew;
    delete obj._isNew; delete obj._type;
    if (isNew) snippets.push(obj);
    else { const i = snippets.findIndex(s => s.id === obj.id); if (i !== -1) snippets[i] = obj; }
    await saveSnippets();
    closeEditor();
  }

  async function deleteFolderEditor() {
    if (!editingItem) return;
    const ids = new Set([editingItem.id]);
    let changed = true;
    while (changed) {
      changed = false;
      snippets.forEach(s => { if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) { ids.add(s.id); changed = true; } });
    }
    snippets = snippets.filter(s => !ids.has(s.id));
    await saveSnippets();
    closeEditor();
  }

  // ── Import / Export ──
  function exportData() {
    const blob = new Blob([JSON.stringify(snippets, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'clipnest-snippets.json'; a.click(); URL.revokeObjectURL(a.href);
  }

  function importData(file) {
    file.text().then(text => {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return;
      const ids = new Set(snippets.map(s => s.id));
      arr.forEach(s => { if (!ids.has(s.id)) snippets.push(s); });
      saveSnippets().then(render);
    }).catch(() => {});
  }

  // ── Search toggle ──
  function showSearch() {
    searchVisible = true;
    $('#cn-search-wrap').classList.remove('hidden');
    setTimeout(() => $('#cn-search').focus(), 30);
  }

  function hideSearch() {
    searchVisible = false;
    $('#cn-search-wrap').classList.add('hidden');
    $('#cn-search').value = '';
    selectedIndex = -1;
    render();
    $('#cn-list').focus();
  }

  // ── Keyboard handler (core) ──
  function handleKeydown(e) {
    if (!visible) return;
    if (e.__cnHandled) return;
    e.__cnHandled = true;

    const inEditor = !$('#cn-editor').classList.contains('hidden') || !$('#cn-folder-editor').classList.contains('hidden');
    const inSettings = !$('#cn-settings-view').classList.contains('hidden');
    const inSearch = shadow.activeElement === $('#cn-search');

    // ── Global shortcuts ──
    if (e.key === 'Escape') {
      if (recording) { recording = false; $('#cn-hotkey-display').textContent = hotkeyLabel(settings.hotkey); $('#cn-hotkey-display').classList.remove('recording'); $('#cn-hotkey-record').textContent = 'Record'; }
      else if (inSettings) { closeSettings(); }
      else if (inEditor) { closeEditor(); }
      else if (searchVisible) { hideSearch(); }
      else { hide(); }
      e.preventDefault(); e.stopPropagation(); return;
    }

    // ── Settings view: block other shortcuts ──
    if (inSettings) return;

    // ── Editor shortcuts ──
    if (inEditor) {
      // Cmd+Enter to save
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!$('#cn-editor').classList.contains('hidden')) saveEditor();
        else saveFolderEditor();
        return;
      }
      return; // Let editor handle other keys normally
    }

    // ── Main view shortcuts ──

    // Tab to cycle tabs
    if (e.key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      cycleTab();
      return;
    }

    // Down arrow: move selection down (or from search to list)
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      setSelected(selectedIndex + 1);
      return;
    }

    // Up arrow: move selection up (wrap to bottom at top)
    if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (selectedIndex <= 0) {
        setSelected(actionableItems.length - 1);
      } else {
        setSelected(selectedIndex - 1);
      }
      return;
    }

    // Right arrow: expand folder
    if (e.key === 'ArrowRight' && selectedIndex >= 0) {
      const item = actionableItems[selectedIndex];
      if (item?.type === 'folder') {
        const children = item.el.nextElementSibling;
        if (children?.classList.contains('hidden')) {
          e.preventDefault();
          toggleFolder(item);
        }
      }
      return;
    }

    // Left arrow: collapse folder
    if (e.key === 'ArrowLeft' && selectedIndex >= 0) {
      const item = actionableItems[selectedIndex];
      if (item?.type === 'folder') {
        const children = item.el.nextElementSibling;
        if (children && !children.classList.contains('hidden')) {
          e.preventDefault();
          toggleFolder(item);
        }
      }
      return;
    }

    // Enter: execute selected item
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      if (selectedIndex >= 0) {
        e.preventDefault(); e.stopPropagation();
        executeSelected();
      }
      return;
    }

    // e key: edit selected (only when not typing in search)
    if (e.key === 'e' && !inSearch && selectedIndex >= 0) {
      e.preventDefault();
      editSelected();
      return;
    }

    // s key: save selected history item as snippet
    if (e.key === 's' && !inSearch && selectedIndex >= 0) {
      const item = actionableItems[selectedIndex];
      if (item?.type === 'history') {
        e.preventDefault();
        const content = item.data.content;
        const title = content.slice(0, 30).replace(/\n/g, ' ').trim() || 'Untitled';
        openEditor({ id: crypto.randomUUID(), title, content, order: 0, isPinned: false, parentId: null }, true);
      }
      return;
    }

    // 1-9: quick select (works from search too, but only if not typing)
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey && !inSearch) {
      const idx = parseInt(e.key) - 1;
      if (idx < actionableItems.length) {
        e.preventDefault();
        const item = actionableItems[idx];
        if (item.type === 'snippet') pasteText(item.data.content || '');
        else if (item.type === 'history') pasteText(item.data.content);
        else if (item.type === 'folder') { setSelected(idx); toggleFolder(item); }
      }
      return;
    }

    // / key: toggle search
    if (e.key === '/' && !inSearch) {
      e.preventDefault();
      if (searchVisible) hideSearch();
      else showSearch();
      return;
    }
  }

  // ── Event listeners ──
  // Capture keydown at multiple levels to ensure it always works
  panel.addEventListener('keydown', handleKeydown, true);
  shadow.addEventListener('keydown', handleKeydown);

  // Prevent keydown from leaking to page
  host.addEventListener('keydown', (e) => {
    if (visible) e.stopPropagation();
  }, true);

  // Tabs (click)
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // Search
  $('#cn-search').addEventListener('input', () => {
    selectedIndex = -1;
    render();
  });

  // Import file handler
  fileInput.addEventListener('change', (e) => { if (e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; } });

  // Editor buttons
  $('#cn-editor-back').addEventListener('click', closeEditor);
  $('#cn-editor-save').addEventListener('click', saveEditor);
  $('#cn-editor-delete').addEventListener('click', deleteEditor);
  $('#cn-editor-content').addEventListener('input', (e) => {
    $('#cn-editor-chars').textContent = `${e.target.value.length} chars`;
  });

  $('#cn-folder-back').addEventListener('click', closeEditor);
  $('#cn-folder-save').addEventListener('click', saveFolderEditor);
  $('#cn-folder-delete').addEventListener('click', deleteFolderEditor);

  // Settings
  $('#cn-settings').addEventListener('click', openSettings);
  $('#cn-settings-back').addEventListener('click', closeSettings);
  $('#cn-s-add-snippet').addEventListener('click', () => { closeSettings(); addSnippet(null); });
  $('#cn-s-add-folder').addEventListener('click', () => { closeSettings(); openFolderEditor({ id: crypto.randomUUID(), title: '', isFolder: true, order: 0, parentId: null }, true); });
  $('#cn-s-import').addEventListener('click', () => fileInput.click());
  $('#cn-s-export').addEventListener('click', exportData);
  $('#cn-s-clear-history').addEventListener('click', async () => { history = []; await saveHistory(); render(); });

  // Hotkey recorder
  $('#cn-hotkey-record').addEventListener('click', () => {
    recording = !recording;
    const display = $('#cn-hotkey-display');
    display.classList.toggle('recording', recording);
    $('#cn-hotkey-record').textContent = recording ? 'Press keys...' : 'Record';
    if (recording) {
      display.textContent = '...';
      display.focus();
    } else {
      display.textContent = hotkeyLabel(settings.hotkey);
    }
  });

  // Capture hotkey during recording — listen on the display element directly
  $('#cn-hotkey-display').addEventListener('keydown', (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Ignore lone modifier keys
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
    // Require at least one modifier
    if (!e.metaKey && !e.ctrlKey && !e.altKey) return;

    // Derive the display key from e.code (e.key is unreliable with Alt on macOS)
    const displayKey = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase()
      : e.code.startsWith('Digit') ? e.code.slice(5)
      : e.key;
    settings.hotkey = {
      key: displayKey,
      code: e.code,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey
    };
    chrome.storage.local.set({ settings });

    recording = false;
    $('#cn-hotkey-display').textContent = hotkeyLabel(settings.hotkey);
    $('#cn-hotkey-display').classList.remove('recording');
    $('#cn-hotkey-record').textContent = 'Record';
  });

  // Click outside to close
  document.addEventListener('mousedown', (e) => {
    if (visible && !host.contains(e.target)) hide();
  });

  // Track active text field & show chip
  function isTextField(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'email', 'tel', 'number', 'password'].includes(type);
    }
    return false;
  }

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (isTextField(el) && !host.contains(el)) {
      activeField = el;
      clearTimeout(chipTimer);
      chipTimer = setTimeout(() => showChip(el), 300);
    }
  });

  document.addEventListener('focusout', (e) => {
    clearTimeout(chipTimer);
    // Delay hide so chip click can fire first
    setTimeout(() => {
      if (chipClicking || visible) return;
      if (!isTextField(document.activeElement) || host.contains(document.activeElement)) {
        hideChip();
      }
    }, 150);
  });

  // Reposition chip on scroll/resize
  window.addEventListener('scroll', () => { if (chipField) positionChip(chipField); }, { passive: true });
  window.addEventListener('resize', () => { if (chipField) positionChip(chipField); }, { passive: true });

  // ── Capture all keydown at document level when panel is visible ──
  document.addEventListener('keydown', (e) => {
    if (!visible) return;
    handleKeydown(e);
  }, true);

  // ── Load settings immediately on injection ──
  chrome.storage.local.get(['settings']).then(data => {
    if (data.settings) {
      settings = { ...settings, ...data.settings };
      if (!settings.hotkey) {
        settings.hotkey = { key: 'v', code: 'KeyV', metaKey: false, shiftKey: false, ctrlKey: false, altKey: true };
      }
      // Update chip shortcut label
      const keyEl = chip.querySelector('.chip-key');
      if (keyEl) keyEl.textContent = hotkeyLabel(settings.hotkey);
    }
  });

  // ── Global hotkey listener (document level, capture phase) ──
  document.addEventListener('keydown', (e) => {
    // Skip if inside clipnest panel
    if (visible) return;
    if (matchesHotkey(e, settings.hotkey)) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }
  }, true);

  // Message from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'toggle') toggle();
    if (msg.type === 'paste' && msg.text) {
      // Paste into the last focused text field
      if (activeField) {
        try { activeField.focus(); } catch {}
        document.execCommand('insertText', false, expandPlaceholders(msg.text));
      }
    }
  });
})();
