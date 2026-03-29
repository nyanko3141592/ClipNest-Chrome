(() => {
  // ── State ──
  let snippets = [];
  let history = [];
  let settings = { maxHistoryItems: 30, autoPaste: true, hotkey: { key: 'v', code: 'KeyV', metaKey: false, shiftKey: false, ctrlKey: false, altKey: true } };
  let selectedId = null;
  let openFolders = new Set();
  let dragItemId = null;
  let recording = false;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ── Data ──

  async function loadData() {
    const data = await chrome.storage.local.get(['snippets', 'history', 'settings']);
    snippets = data.snippets || [];
    history = data.history || [];
    settings = { maxHistoryItems: 30, autoPaste: true, ...data.settings };
    if (!settings.hotkey) settings.hotkey = { key: 'v', code: 'KeyV', metaKey: false, shiftKey: false, ctrlKey: false, altKey: true };
  }

  async function saveSnippets() { await chrome.storage.local.set({ snippets }); }
  async function saveHistory() { await chrome.storage.local.set({ history }); }
  async function saveSettings() { await chrome.storage.local.set({ settings }); }

  // ── Helpers ──

  function esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

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
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleString();
  }

  function getChildren(parentId) {
    return snippets.filter(s => (s.parentId || null) === parentId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function getFolders(excludeId = null) {
    return snippets.filter(s => s.isFolder && s.id !== excludeId);
  }

  function getAllDescendantIds(folderId) {
    const ids = new Set([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      snippets.forEach(s => {
        if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) {
          ids.add(s.id);
          changed = true;
        }
      });
    }
    return ids;
  }

  // ── Toast ──

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1500);
  }

  // ── Navigation ──

  $$('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.nav-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $$('.view').forEach(v => v.classList.remove('active'));
      $(`#view-${tab.dataset.view}`).classList.add('active');
      if (tab.dataset.view === 'history') renderHistory();
      if (tab.dataset.view === 'settings') renderSettings();
    });
  });

  // ══════════════════════════════════════
  // ═══ TREE VIEW ═══
  // ══════════════════════════════════════

  function renderTree() {
    const tree = $('#tree');
    tree.innerHTML = '';
    const roots = getChildren(null);
    roots.forEach(item => tree.appendChild(buildTreeNode(item, 0)));
  }

  function buildTreeNode(item, depth) {
    const frag = document.createDocumentFragment();
    const el = document.createElement('div');
    el.className = 'tree-item' + (item.id === selectedId ? ' selected' : '');
    el.style.setProperty('--depth', depth);
    el.dataset.id = item.id;
    el.draggable = true;

    if (item.isFolder) {
      const open = openFolders.has(item.id);
      el.innerHTML = `
        <span class="tree-icon folder">${open ? '📂' : '📁'}</span>
        <span class="tree-title">${esc(item.title || 'Untitled')}</span>
      `;
      frag.appendChild(el);
      if (open) {
        const children = getChildren(item.id);
        children.forEach(child => frag.appendChild(buildTreeNode(child, depth + 1)));
      }
    } else {
      el.innerHTML = `
        <span class="tree-icon">${detectIcon(item.content)}</span>
        <span class="tree-title">${esc(item.title || 'Untitled')}</span>
        ${item.isPinned ? '<span class="tree-pin">★</span>' : ''}
      `;
      frag.appendChild(el);
    }

    // Click
    el.addEventListener('click', () => {
      if (item.isFolder) {
        if (openFolders.has(item.id)) openFolders.delete(item.id);
        else openFolders.add(item.id);
      }
      selectedId = item.id;
      renderTree();
      showEditor(item);
    });

    // ── Drag & Drop ──
    el.addEventListener('dragstart', (e) => {
      dragItemId = item.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      dragItemId = null;
      $$('.tree-item').forEach(n => {
        n.classList.remove('dragging', 'drag-over-above', 'drag-over-below', 'drag-over-inside');
      });
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragItemId === item.id) return;
      e.dataTransfer.dropEffect = 'move';

      // Clear all indicators
      $$('.tree-item').forEach(n => n.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside'));

      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ratio = y / rect.height;

      if (item.isFolder && ratio > 0.25 && ratio < 0.75) {
        el.classList.add('drag-over-inside');
      } else if (ratio <= 0.5) {
        el.classList.add('drag-over-above');
      } else {
        el.classList.add('drag-over-below');
      }
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragItemId || dragItemId === item.id) return;

      const dragItem = snippets.find(s => s.id === dragItemId);
      if (!dragItem) return;

      // Prevent dropping a folder into its own descendant
      if (dragItem.isFolder && getAllDescendantIds(dragItem.id).has(item.id)) return;

      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const ratio = y / rect.height;

      let newParentId, insertIdx;

      if (item.isFolder && ratio > 0.25 && ratio < 0.75) {
        // Drop inside folder
        newParentId = item.id;
        openFolders.add(item.id);
        const children = getChildren(item.id);
        insertIdx = children.length;
      } else {
        // Drop above or below
        newParentId = item.parentId || null;
        const siblings = getChildren(newParentId);
        const targetIdx = siblings.findIndex(s => s.id === item.id);
        insertIdx = ratio <= 0.5 ? targetIdx : targetIdx + 1;
      }

      // Remove from old position
      dragItem.parentId = newParentId;

      // Reorder siblings
      const siblings = getChildren(newParentId).filter(s => s.id !== dragItem.id);
      siblings.splice(insertIdx, 0, dragItem);
      siblings.forEach((s, i) => s.order = i);

      saveSnippets().then(() => {
        renderTree();
        toast('Moved');
      });
    });

    return frag;
  }

  // ══════════════════════════════════════
  // ═══ EDITORS ═══
  // ══════════════════════════════════════

  function showEditor(item) {
    $('#editor-empty').classList.add('hidden');
    if (item.isFolder) {
      $('#snippet-editor').classList.add('hidden');
      $('#folder-editor').classList.remove('hidden');
      populateFolderEditor(item);
    } else {
      $('#folder-editor').classList.add('hidden');
      $('#snippet-editor').classList.remove('hidden');
      populateSnippetEditor(item);
    }
  }

  function hideEditor() {
    selectedId = null;
    $('#snippet-editor').classList.add('hidden');
    $('#folder-editor').classList.add('hidden');
    $('#editor-empty').classList.remove('hidden');
    renderTree();
  }

  // ── Snippet editor ──

  function populateSnippetEditor(item) {
    $('#ed-title').value = item.title || '';
    $('#ed-content').value = item.content || '';
    $('#ed-pinned').checked = item.isPinned || false;
    $('#ed-chars').textContent = `${(item.content || '').length} chars`;

    // Folder dropdown
    const sel = $('#ed-folder');
    sel.innerHTML = '<option value="">— No folder —</option>';
    getFolders().forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.title || 'Untitled';
      if (f.id === item.parentId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  $('#ed-content').addEventListener('input', () => {
    $('#ed-chars').textContent = `${$('#ed-content').value.length} chars`;
  });

  $('#ed-save').addEventListener('click', () => {
    const item = snippets.find(s => s.id === selectedId);
    if (!item) return;
    item.title = $('#ed-title').value.trim() || 'Untitled';
    item.content = $('#ed-content').value;
    item.isPinned = $('#ed-pinned').checked;
    const newParent = $('#ed-folder').value || null;
    if (newParent !== (item.parentId || null)) {
      item.parentId = newParent;
      if (newParent) openFolders.add(newParent);
    }
    saveSnippets().then(() => { renderTree(); toast('Saved'); });
  });

  $('#ed-delete').addEventListener('click', () => {
    if (!selectedId) return;
    if (!confirm('Delete this snippet?')) return;
    snippets = snippets.filter(s => s.id !== selectedId);
    saveSnippets().then(() => { hideEditor(); toast('Deleted'); });
  });

  // ── Folder editor ──

  function populateFolderEditor(folder) {
    $('#fed-title').value = folder.title || '';

    const sel = $('#fed-parent');
    const excludeIds = getAllDescendantIds(folder.id);
    sel.innerHTML = '<option value="">— Root —</option>';
    getFolders(folder.id).forEach(f => {
      if (excludeIds.has(f.id)) return;
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.title || 'Untitled';
      if (f.id === folder.parentId) opt.selected = true;
      sel.appendChild(opt);
    });

    const children = getChildren(folder.id);
    const folders = children.filter(c => c.isFolder).length;
    const items = children.filter(c => !c.isFolder).length;
    const parts = [];
    if (items) parts.push(`${items} snippet${items > 1 ? 's' : ''}`);
    if (folders) parts.push(`${folders} subfolder${folders > 1 ? 's' : ''}`);
    $('#fed-info').textContent = parts.length ? `Contains: ${parts.join(', ')}` : 'Empty folder';
  }

  $('#fed-save').addEventListener('click', () => {
    const item = snippets.find(s => s.id === selectedId);
    if (!item) return;
    item.title = $('#fed-title').value.trim() || 'Untitled Folder';
    const newParent = $('#fed-parent').value || null;
    item.parentId = newParent;
    saveSnippets().then(() => { renderTree(); showEditor(item); toast('Saved'); });
  });

  $('#fed-delete').addEventListener('click', () => {
    if (!selectedId) return;
    const ids = getAllDescendantIds(selectedId);
    const count = ids.size - 1;
    const msg = count > 0
      ? `Delete this folder and its ${count} item(s)?`
      : 'Delete this empty folder?';
    if (!confirm(msg)) return;
    snippets = snippets.filter(s => !ids.has(s.id));
    saveSnippets().then(() => { hideEditor(); toast('Deleted'); });
  });

  // ── Add snippet / folder ──

  $('#btn-add-snippet').addEventListener('click', () => {
    const parentId = selectedId && snippets.find(s => s.id === selectedId)?.isFolder ? selectedId : null;
    const item = { id: crypto.randomUUID(), title: '', content: '', order: getChildren(parentId).length, isPinned: false, parentId };
    snippets.push(item);
    if (parentId) openFolders.add(parentId);
    selectedId = item.id;
    saveSnippets().then(() => {
      renderTree();
      showEditor(item);
      $('#ed-title').focus();
    });
  });

  $('#btn-add-folder').addEventListener('click', () => {
    const parentId = selectedId && snippets.find(s => s.id === selectedId)?.isFolder ? selectedId : null;
    const item = { id: crypto.randomUUID(), title: '', isFolder: true, order: getChildren(parentId).length, parentId };
    snippets.push(item);
    if (parentId) openFolders.add(parentId);
    selectedId = item.id;
    openFolders.add(item.id);
    saveSnippets().then(() => {
      renderTree();
      showEditor(item);
      $('#fed-title').focus();
    });
  });

  // ── Import / Export ──

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(snippets, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'clipnest-snippets.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Exported');
  });

  $('#btn-import').addEventListener('click', () => $('#file-input').click());

  $('#file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then(text => {
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) { toast('Invalid file'); return; }
      const ids = new Set(snippets.map(s => s.id));
      let added = 0;
      arr.forEach(s => { if (!ids.has(s.id)) { snippets.push(s); added++; } });
      saveSnippets().then(() => { renderTree(); toast(`Imported ${added} item(s)`); });
    }).catch(() => toast('Import failed'));
    e.target.value = '';
  });

  // ══════════════════════════════════════
  // ═══ HISTORY VIEW ═══
  // ══════════════════════════════════════

  function renderHistory() {
    const q = ($('#history-search')?.value || '').toLowerCase();
    const list = $('#history-list');
    list.innerHTML = '';

    const items = history.filter(h => !q || h.content.toLowerCase().includes(q));
    if (items.length === 0) {
      list.innerHTML = `<div class="history-empty">${q ? 'No results' : 'No history yet'}</div>`;
      return;
    }

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `
        <div class="history-icon">${detectIcon(item.content)}</div>
        <div class="history-body">
          <div class="history-preview">${esc(item.content.slice(0, 200))}</div>
          <div class="history-time">${timeAgo(item.timestamp)}</div>
        </div>
        <div class="history-actions">
          <button class="btn cn-copy" title="Copy">📋</button>
          <button class="btn cn-save" title="Save as snippet">💾</button>
          <button class="btn cn-del" title="Delete">✕</button>
        </div>
      `;
      el.querySelector('.cn-copy').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(item.content).then(() => toast('Copied'));
      });
      el.querySelector('.cn-save').addEventListener('click', (e) => {
        e.stopPropagation();
        const s = {
          id: crypto.randomUUID(),
          title: item.content.slice(0, 30).replace(/\n/g, ' ').trim() || 'Untitled',
          content: item.content,
          order: 0, isPinned: false, parentId: null
        };
        snippets.push(s);
        saveSnippets().then(() => {
          renderTree();
          toast('Saved as snippet');
        });
      });
      el.querySelector('.cn-del').addEventListener('click', (e) => {
        e.stopPropagation();
        history = history.filter(h => h.id !== item.id);
        saveHistory().then(renderHistory);
      });
      el.addEventListener('click', () => {
        navigator.clipboard.writeText(item.content).then(() => toast('Copied'));
      });
      list.appendChild(el);
    });
  }

  $('#history-search').addEventListener('input', renderHistory);
  $('#btn-clear-history').addEventListener('click', () => {
    if (!confirm('Clear all history?')) return;
    history = [];
    saveHistory().then(() => { renderHistory(); toast('History cleared'); });
  });

  // ══════════════════════════════════════
  // ═══ SETTINGS VIEW ═══
  // ══════════════════════════════════════

  function hotkeyLabel(hk) {
    const parts = [];
    if (hk.ctrlKey) parts.push('Ctrl');
    if (hk.altKey) parts.push('⌥');
    if (hk.shiftKey) parts.push('⇧');
    if (hk.metaKey) parts.push('⌘');
    parts.push(hk.key.length === 1 ? hk.key.toUpperCase() : hk.key);
    return parts.join('');
  }

  function renderSettings() {
    $('#set-max-history').value = settings.maxHistoryItems;
    $('#set-auto-paste').checked = settings.autoPaste;
    $('#set-hotkey').textContent = hotkeyLabel(settings.hotkey);
    $('#set-hotkey').classList.remove('recording');
    $('#set-hotkey-record').textContent = 'Record';
    recording = false;
    const manifest = chrome.runtime.getManifest();
    $('#set-version').textContent = manifest.version;
  }

  $('#set-hotkey-record').addEventListener('click', () => {
    recording = !recording;
    const display = $('#set-hotkey');
    display.classList.toggle('recording', recording);
    $('#set-hotkey-record').textContent = recording ? 'Press keys...' : 'Record';
    if (recording) display.textContent = '...';
    else display.textContent = hotkeyLabel(settings.hotkey);
  });

  document.addEventListener('keydown', (e) => {
    if (!recording) return;
    e.preventDefault();
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
    if (!e.metaKey && !e.ctrlKey && !e.altKey) return;

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
    recording = false;
    $('#set-hotkey').textContent = hotkeyLabel(settings.hotkey);
    $('#set-hotkey').classList.remove('recording');
    $('#set-hotkey-record').textContent = 'Record';
  });

  $('#set-save').addEventListener('click', () => {
    settings.maxHistoryItems = parseInt($('#set-max-history').value);
    settings.autoPaste = $('#set-auto-paste').checked;
    saveSettings().then(() => toast('Settings saved'));
  });

  // ══════════════════════════════════════
  // ═══ Sync from external changes ═══
  // ══════════════════════════════════════

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.snippets) {
      snippets = changes.snippets.newValue || [];
      renderTree();
      // Refresh editor if the selected item changed
      if (selectedId) {
        const item = snippets.find(s => s.id === selectedId);
        if (item) showEditor(item);
        else hideEditor();
      }
    }
    if (changes.history) {
      history = changes.history.newValue || [];
      if ($('#view-history').classList.contains('active')) renderHistory();
    }
    if (changes.settings) {
      settings = { ...settings, ...changes.settings.newValue };
      if ($('#view-settings').classList.contains('active')) renderSettings();
    }
  });

  // ══════════════════════════════════════
  // ═══ Init ═══
  // ══════════════════════════════════════

  loadData().then(() => {
    renderTree();
    // Auto-expand all root folders
    snippets.filter(s => s.isFolder && !s.parentId).forEach(f => openFolders.add(f.id));
    renderTree();
  });
})();
