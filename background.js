// ── Helpers ──

async function sendMessage(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (e) {
      console.warn('ClipNest: cannot inject into this page', e);
    }
  }
}

// ── Shortcut command ──

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-clipnest') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) sendMessage(tab.id, { type: 'toggle' });
  }
});

// ── Context Menus ──

// ID scheme:
//   clipnest                     — top-level parent
//   cn-history                   — "History" submenu
//   cn-snippets                  — "Snippets" submenu
//   cn-folder-{folderId}         — folder submenu
//   cn-h-{index}                 — history item
//   cn-s-{snippetId}             — snippet item
//   cn-open                      — open panel
//   cn-save                      — save selection as snippet
//   cn-clear-history             — clear history

const MAX_HISTORY = 15;
const MAX_PER_FOLDER = 20;

function truncate(text, len = 45) {
  const single = text.replace(/\n/g, ' ').trim();
  return single.length > len ? single.slice(0, len) + '...' : single;
}

// Build a lookup: parentId → children (sorted by order)
function buildTree(allItems) {
  const byParent = new Map();
  for (const item of allItems) {
    const pid = item.parentId || '__root__';
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(item);
  }
  // Sort each group
  for (const [, arr] of byParent) {
    arr.sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  return byParent;
}

async function rebuildMenus() {
  await chrome.contextMenus.removeAll();

  const data = await chrome.storage.local.get(['history', 'snippets']);
  const history = data.history || [];
  const allSnippets = data.snippets || [];
  const tree = buildTree(allSnippets);

  // ── Top-level parent ──
  chrome.contextMenus.create({
    id: 'clipnest',
    title: 'ClipNest',
    contexts: ['editable']
  });

  // ── History submenu ──
  chrome.contextMenus.create({
    id: 'cn-history',
    parentId: 'clipnest',
    title: `History${history.length ? ` (${history.length})` : ''}`,
    contexts: ['editable']
  });

  if (history.length === 0) {
    chrome.contextMenus.create({
      id: 'cn-h-empty',
      parentId: 'cn-history',
      title: '(empty)',
      enabled: false,
      contexts: ['editable']
    });
  } else {
    history.slice(0, MAX_HISTORY).forEach((h, i) => {
      chrome.contextMenus.create({
        id: `cn-h-${i}`,
        parentId: 'cn-history',
        title: truncate(h.content),
        contexts: ['editable']
      });
    });
    if (history.length > MAX_HISTORY) {
      chrome.contextMenus.create({
        id: 'cn-h-more-sep',
        parentId: 'cn-history',
        type: 'separator',
        contexts: ['editable']
      });
      chrome.contextMenus.create({
        id: 'cn-h-more',
        parentId: 'cn-history',
        title: `... and ${history.length - MAX_HISTORY} more → Open panel`,
        contexts: ['editable']
      });
    }
    chrome.contextMenus.create({
      id: 'cn-h-clear-sep',
      parentId: 'cn-history',
      type: 'separator',
      contexts: ['editable']
    });
    chrome.contextMenus.create({
      id: 'cn-clear-history',
      parentId: 'cn-history',
      title: 'Clear History',
      contexts: ['editable']
    });
  }

  // ── Snippets submenu ──
  chrome.contextMenus.create({
    id: 'cn-snippets',
    parentId: 'clipnest',
    title: 'Snippets',
    contexts: ['editable']
  });

  const roots = tree.get('__root__') || [];
  const hasSnippets = roots.length > 0;

  if (!hasSnippets) {
    chrome.contextMenus.create({
      id: 'cn-s-empty',
      parentId: 'cn-snippets',
      title: '(empty)',
      enabled: false,
      contexts: ['editable']
    });
  } else {
    // Pinned first (flat, at top of snippets)
    const pinned = allSnippets.filter(s => s.isPinned && !s.isFolder);
    if (pinned.length > 0) {
      pinned.forEach(s => {
        chrome.contextMenus.create({
          id: `cn-s-${s.id}`,
          parentId: 'cn-snippets',
          title: `★ ${truncate(s.title || s.content || 'Untitled')}`,
          contexts: ['editable']
        });
      });
      chrome.contextMenus.create({
        id: 'cn-s-pin-sep',
        parentId: 'cn-snippets',
        type: 'separator',
        contexts: ['editable']
      });
    }

    // Build folder/snippet tree recursively
    const pinnedIds = new Set(pinned.map(s => s.id));
    buildMenuTree(roots, 'cn-snippets', tree, pinnedIds);
  }

  // ── Separator + actions ──
  chrome.contextMenus.create({
    id: 'cn-sep-actions',
    parentId: 'clipnest',
    type: 'separator',
    contexts: ['editable']
  });

  chrome.contextMenus.create({
    id: 'cn-open',
    parentId: 'clipnest',
    title: 'Manage ClipNest...',
    contexts: ['editable']
  });

  // "Save as snippet" — works on any selected text, not just editable
  chrome.contextMenus.create({
    id: 'cn-save',
    title: 'ClipNest: Save "%s" as snippet',
    contexts: ['selection']
  });
}

// Recursively create submenus for folders and items within
function buildMenuTree(items, parentMenuId, tree, pinnedIds) {
  let count = 0;
  for (const item of items) {
    if (count >= MAX_PER_FOLDER) break;

    if (item.isFolder) {
      const folderId = `cn-folder-${item.id}`;
      chrome.contextMenus.create({
        id: folderId,
        parentId: parentMenuId,
        title: `📁 ${truncate(item.title || 'Untitled', 35)}`,
        contexts: ['editable']
      });
      const children = tree.get(item.id) || [];
      if (children.length === 0) {
        chrome.contextMenus.create({
          id: `cn-folder-empty-${item.id}`,
          parentId: folderId,
          title: '(empty)',
          enabled: false,
          contexts: ['editable']
        });
      } else {
        buildMenuTree(children, folderId, tree, pinnedIds);
      }
    } else {
      // Skip pinned (already shown at top)
      if (pinnedIds.has(item.id)) continue;
      if (!item.content) continue;
      chrome.contextMenus.create({
        id: `cn-s-${item.id}`,
        parentId: parentMenuId,
        title: truncate(item.title || item.content || 'Untitled'),
        contexts: ['editable']
      });
    }
    count++;
  }
}

// ── Click handler ──

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  const mid = info.menuItemId;

  // Open management page
  if (mid === 'cn-open' || mid === 'cn-h-more') {
    chrome.runtime.openOptionsPage();
    return;
  }

  // Clear history
  if (mid === 'cn-clear-history') {
    await chrome.storage.local.set({ history: [] });
    return; // storage.onChanged will trigger rebuildMenus
  }

  // Save selection as snippet
  if (mid === 'cn-save') {
    const text = info.selectionText;
    if (text && text.trim()) {
      const data = await chrome.storage.local.get(['snippets']);
      const snippets = data.snippets || [];
      snippets.push({
        id: crypto.randomUUID(),
        title: text.slice(0, 30).replace(/\n/g, ' ').trim(),
        content: text,
        order: 0,
        isPinned: false,
        parentId: null
      });
      await chrome.storage.local.set({ snippets });
    }
    return;
  }

  // History item
  if (typeof mid === 'string' && mid.startsWith('cn-h-')) {
    const idx = parseInt(mid.slice(5));
    if (isNaN(idx)) return;
    const data = await chrome.storage.local.get(['history']);
    const h = (data.history || [])[idx];
    if (h) sendMessage(tab.id, { type: 'paste', text: h.content });
    return;
  }

  // Snippet item
  if (typeof mid === 'string' && mid.startsWith('cn-s-')) {
    const snippetId = mid.slice(5);
    const data = await chrome.storage.local.get(['snippets']);
    const s = (data.snippets || []).find(s => s.id === snippetId);
    if (s?.content) sendMessage(tab.id, { type: 'paste', text: s.content });
    return;
  }
});

// Rebuild menus when data changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.history || changes.snippets) {
    rebuildMenus();
  }
});

// ── Initialize ──

chrome.runtime.onInstalled.addListener(async (details) => {
  const data = await chrome.storage.local.get(['snippets', 'history', 'settings']);

  if (!data.settings) {
    await chrome.storage.local.set({
      settings: { maxHistoryItems: 30, autoPaste: true, hotkey: { key: 'v', code: 'KeyV', metaKey: false, shiftKey: false, ctrlKey: false, altKey: true } }
    });
  }
  if (!data.history) await chrome.storage.local.set({ history: [] });

  // Populate sample data on first install only
  if (details.reason === 'install' && (!data.snippets || data.snippets.length === 0)) {
    const emailFolderId = crypto.randomUUID();
    const codeFolderId = crypto.randomUUID();

    const sampleSnippets = [
      // Folders
      { id: emailFolderId, title: 'Email Templates', isFolder: true, order: 0, parentId: null },
      { id: codeFolderId, title: 'Code Snippets', isFolder: true, order: 1, parentId: null },

      // Email snippets
      {
        id: crypto.randomUUID(), title: 'Greeting',
        content: 'Hi,\n\nThank you for reaching out. I appreciate your message.\n\nBest regards',
        order: 0, isPinned: false, parentId: emailFolderId
      },
      {
        id: crypto.randomUUID(), title: 'Follow-up',
        content: 'Hi,\n\nJust following up on my previous message. Please let me know if you have any questions.\n\nBest regards',
        order: 1, isPinned: false, parentId: emailFolderId
      },
      {
        id: crypto.randomUUID(), title: 'Meeting Request',
        content: 'Hi,\n\nWould you be available for a quick call this week? I\'d like to discuss a few things.\n\nLet me know what works for you.\n\nBest regards',
        order: 2, isPinned: false, parentId: emailFolderId
      },

      // Code snippets
      {
        id: crypto.randomUUID(), title: 'console.log',
        content: 'console.log(JSON.stringify(data, null, 2));',
        order: 0, isPinned: false, parentId: codeFolderId
      },
      {
        id: crypto.randomUUID(), title: 'fetch template',
        content: 'const res = await fetch(url, {\n  method: \'POST\',\n  headers: { \'Content-Type\': \'application/json\' },\n  body: JSON.stringify(data)\n});\nconst json = await res.json();',
        order: 1, isPinned: false, parentId: codeFolderId
      },

      // Root snippets
      {
        id: crypto.randomUUID(), title: 'Today\'s Date',
        content: '{{date}}',
        order: 2, isPinned: true, parentId: null
      },
      {
        id: crypto.randomUUID(), title: 'Timestamp',
        content: '{{datetime}}',
        order: 3, isPinned: false, parentId: null
      }
    ];

    await chrome.storage.local.set({ snippets: sampleSnippets });
  } else if (!data.snippets) {
    await chrome.storage.local.set({ snippets: [] });
  }

  rebuildMenus();
});

// Rebuild on service worker startup
rebuildMenus();
