(() => {
  // ── State ──
  let snippets = [];
  let history = [];
  let settings = { maxHistoryItems: 30, autoPaste: true };
  let currentTab = 'history';
  let editingItem = null;
  let selectedIndex = -1;
  let actionableItems = [];
  let searchVisible = false;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

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

  // ── Toast ──
  let toastTimer;
  function showToast(msg) {
    const t = $('#cn-toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1200);
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

  // ── Copy to clipboard ──
  async function copyText(text) {
    const expanded = expandPlaceholders(text);
    try {
      await navigator.clipboard.writeText(expanded);
      showToast('Copied!');
      // Close popup after a short delay
      setTimeout(() => window.close(), 400);
    } catch {
      showToast('Copy failed');
    }
  }

  // ── Selection ──
  function setSelected(idx) {
    if (idx < -1) idx = actionableItems.length - 1;
    if (idx >= actionableItems.length) idx = 0;
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
      if (item.type === 'snippet') copyText(item.data.content || '');
      else if (item.type === 'history') copyText(item.data.content);
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
      const newIdx = actionableItems.findIndex(a => a.data?.id === item.data.id);
      if (newIdx !== -1) setSelected(newIdx);
    }
  }

  function rebuildActionableItems() {
    actionableItems = [];
    const rows = $('#cn-list').querySelectorAll('.row');
    rows.forEach(el => {
      if (el.closest('.folder-children.hidden')) return;
      const itemData = el.__cnData;
      if (itemData) actionableItems.push({ el, ...itemData });
    });
  }

  // ── Tab switching ──
  function switchTab(tab) {
    currentTab = tab;
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    selectedIndex = -1;
    render();
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

  // ── Render ──
  function render() {
    const q = ($('#cn-search')?.value || '').toLowerCase();
    const list = $('#cn-list');
    list.innerHTML = '';
    actionableItems = [];

    if (currentTab === 'snippets') renderSnippets(list, q);
    else renderHistory(list, q);

    rebuildActionableItems();
    if (selectedIndex === -1 && actionableItems.length > 0) setSelected(0);
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
      results.forEach(s => container.appendChild(s.isFolder ? folderRow(s) : snippetRow(s, idx++)));
    } else {
      const roots = snippets.filter(s => !s.parentId).sort((a, b) => (a.order || 0) - (b.order || 0));
      if (!roots.length && !pinned.length) {
        container.innerHTML += `<div class="empty-state">No snippets yet<br><span style="font-size:11px;color:#ccc">Click + Snippet to add one</span></div>`;
      }
      let idx = pinned.length;
      roots.forEach(item => {
        if (item.isFolder) container.appendChild(folderTree(item));
        else if (!item.isPinned) container.appendChild(snippetRow(item, idx++));
      });
    }
  }

  function renderHistory(container, q) {
    const items = history.filter(h => !q || h.content.toLowerCase().includes(q));
    if (!items.length) {
      container.innerHTML = `<div class="empty-state">${q ? 'No results' : 'No history yet<br><span style="font-size:11px;color:#ccc">Copy something to get started</span>'}</div>`;
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
        <div class="row-actions">
          <button class="mini-btn cn-save-snippet" title="Save as snippet (s)">💾</button>
          <button class="mini-btn cn-delete" title="Delete">✕</button>
        </div>
      `;
      row.querySelector('.cn-save-snippet').addEventListener('click', (e) => {
        e.stopPropagation();
        const title = item.content.slice(0, 30).replace(/\n/g, ' ').trim() || 'Untitled';
        openEditor({ id: crypto.randomUUID(), title, content: item.content, order: 0, isPinned: false, parentId: null }, true);
      });
      row.querySelector('.cn-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        history = history.filter(h => h.id !== item.id);
        await saveHistory();
        render();
      });
      row.addEventListener('click', () => copyText(item.content));
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
    row.addEventListener('click', () => copyText(s.content || ''));
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
    if (editingItem._type === 'folder') {
      const ids = new Set([editingItem.id]);
      let changed = true;
      while (changed) {
        changed = false;
        snippets.forEach(s => { if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) { ids.add(s.id); changed = true; } });
      }
      snippets = snippets.filter(s => !ids.has(s.id));
    } else {
      snippets = snippets.filter(s => s.id !== editingItem.id);
    }
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

  // ── Search ──
  function toggleSearch() {
    searchVisible = !searchVisible;
    $('#cn-search-wrap').classList.toggle('visible', searchVisible);
    if (searchVisible) setTimeout(() => $('#cn-search').focus(), 30);
    else { $('#cn-search').value = ''; selectedIndex = -1; render(); $('#cn-list').focus(); }
  }

  // ── Settings ──
  function openSettings() {
    $('#cn-main').classList.add('hidden');
    $('#cn-settings-view').classList.remove('hidden');
    $('#cn-setting-max-history').value = settings.maxHistoryItems;
    $('#cn-setting-auto-paste').checked = settings.autoPaste;
  }

  async function closeSettings() {
    settings.maxHistoryItems = parseInt($('#cn-setting-max-history').value);
    settings.autoPaste = $('#cn-setting-auto-paste').checked;
    await chrome.storage.local.set({ settings });
    showMain();
    render();
    setTimeout(() => $('#cn-list').focus(), 30);
  }

  // ── Keyboard ──
  document.addEventListener('keydown', (e) => {
    const inEditor = !$('#cn-editor').classList.contains('hidden') || !$('#cn-folder-editor').classList.contains('hidden');
    const inSettings = !$('#cn-settings-view').classList.contains('hidden');
    const inSearch = document.activeElement === $('#cn-search');

    if (e.key === 'Escape') {
      if (inSettings) closeSettings();
      else if (inEditor) closeEditor();
      else if (searchVisible) toggleSearch();
      else window.close();
      e.preventDefault(); return;
    }

    if (inSettings) return;

    if (inEditor) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!$('#cn-editor').classList.contains('hidden')) saveEditor();
        else saveFolderEditor();
      }
      return;
    }

    if (e.key === 'Tab') { e.preventDefault(); cycleTab(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(selectedIndex + 1); return; }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(selectedIndex <= 0 ? actionableItems.length - 1 : selectedIndex - 1);
      return;
    }

    if (e.key === 'ArrowRight' && selectedIndex >= 0) {
      const item = actionableItems[selectedIndex];
      if (item?.type === 'folder') {
        const children = item.el.nextElementSibling;
        if (children?.classList.contains('hidden')) { e.preventDefault(); toggleFolder(item); }
      }
      return;
    }

    if (e.key === 'ArrowLeft' && selectedIndex >= 0) {
      const item = actionableItems[selectedIndex];
      if (item?.type === 'folder') {
        const children = item.el.nextElementSibling;
        if (children && !children.classList.contains('hidden')) { e.preventDefault(); toggleFolder(item); }
      }
      return;
    }

    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && selectedIndex >= 0) {
      e.preventDefault(); executeSelected(); return;
    }

    if (e.key === 'e' && !inSearch && selectedIndex >= 0) { e.preventDefault(); editSelected(); return; }

    if (e.key === 's' && !inSearch && selectedIndex >= 0) {
      const item = actionableItems[selectedIndex];
      if (item?.type === 'history') {
        e.preventDefault();
        const title = item.data.content.slice(0, 30).replace(/\n/g, ' ').trim() || 'Untitled';
        openEditor({ id: crypto.randomUUID(), title, content: item.data.content, order: 0, isPinned: false, parentId: null }, true);
      }
      return;
    }

    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey && !inSearch) {
      const idx = parseInt(e.key) - 1;
      if (idx < actionableItems.length) {
        e.preventDefault();
        const item = actionableItems[idx];
        if (item.type === 'folder') { setSelected(idx); toggleFolder(item); }
        else copyText(item.data.content || '');
      }
      return;
    }

    if (e.key === '/' && !inSearch) { e.preventDefault(); toggleSearch(); return; }
  });

  // ── Event Listeners ──
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('#cn-search').addEventListener('input', () => { selectedIndex = -1; render(); });
  $('#cn-settings').addEventListener('click', openSettings);
  $('#cn-settings-back').addEventListener('click', closeSettings);

  $('#cn-add-snippet').addEventListener('click', () => addSnippet(null));
  $('#cn-add-folder').addEventListener('click', () => openFolderEditor({ id: crypto.randomUUID(), title: '', isFolder: true, order: 0, parentId: null }, true));
  $('#cn-manage').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });

  $('#cn-editor-back').addEventListener('click', closeEditor);
  $('#cn-editor-save').addEventListener('click', saveEditor);
  $('#cn-editor-delete').addEventListener('click', deleteEditor);
  $('#cn-editor-content').addEventListener('input', (e) => {
    $('#cn-editor-chars').textContent = `${e.target.value.length} chars`;
  });

  $('#cn-folder-back').addEventListener('click', closeEditor);
  $('#cn-folder-save').addEventListener('click', saveFolderEditor);
  $('#cn-folder-delete').addEventListener('click', deleteEditor);

  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = '.json'; fileInput.style.display = 'none';
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', (e) => { if (e.target.files[0]) { importData(e.target.files[0]); e.target.value = ''; } });

  $('#cn-s-import').addEventListener('click', () => fileInput.click());
  $('#cn-s-export').addEventListener('click', exportData);
  $('#cn-s-clear-history').addEventListener('click', async () => { history = []; await saveHistory(); showToast('History cleared'); render(); });

  // ── Init ──
  loadData().then(() => {
    render();
    $('#cn-list').focus();
  });
})();
