/**
 * OLED New Tab - Background Service Worker
 * Coordinates media state across tabs and manages communication with New Tab.
 */

const mediaTabs = new Map();
let activeSessionTabId = null;
let currentActiveMedia = null;
let broadcastTimer = null;
let pendingBroadcastMedia = null;

// Safely broadcast active media to open new tabs
function broadcastActiveMedia(data) {
  chrome.runtime.sendMessage({
    action: 'ACTIVE_MEDIA_CHANGED',
    data: data
  }).catch(() => {
    // No active listeners (e.g. newtab is not open), ignore safely
  });
}

function scheduleBroadcast(media) {
  pendingBroadcastMedia = media;
  if (broadcastTimer) return;

  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    chrome.storage.local.set({ activeMedia: pendingBroadcastMedia });
    broadcastActiveMedia(pendingBroadcastMedia);
  }, 60);
}

// Evaluate which tab should be the active media displayed in New Tab
function evaluateActiveMedia() {
  const allMedia = Array.from(mediaTabs.values());

  if (allMedia.length === 0) {
    activeSessionTabId = null;
    currentActiveMedia = null;
    chrome.storage.local.set({ activeMedia: null });
    broadcastActiveMedia(null);
    return;
  }

  let selected = null;

  // 1. If currently tracked active session is still present and playing, it holds priority
  if (activeSessionTabId && mediaTabs.has(activeSessionTabId)) {
    const activeTab = mediaTabs.get(activeSessionTabId);
    if (activeTab.isPlaying) {
      selected = activeTab;
    }
  }

  // 2. If current active session is not playing or doesn't exist, check all playing tabs
  if (!selected) {
    const playingTabs = allMedia.filter(m => m.isPlaying);
    if (playingTabs.length > 0) {
      // Prioritize most recently activated playing source
      playingTabs.sort((a, b) => (b.activatedAt || b.lastUpdated) - (a.activatedAt || a.lastUpdated));
      selected = playingTabs[0];
      activeSessionTabId = selected.tabId;
    } else {
      // 3. No tabs are playing: retain current session if present
      if (activeSessionTabId && mediaTabs.has(activeSessionTabId)) {
        selected = mediaTabs.get(activeSessionTabId);
      } else {
        // Fallback to most recently updated tab
        allMedia.sort((a, b) => b.lastUpdated - a.lastUpdated);
        selected = allMedia[0];
        activeSessionTabId = selected.tabId;
      }
    }
  }

  currentActiveMedia = selected;
  scheduleBroadcast(selected);
}

// Discover audible tabs and inject scripts if they were opened before extension loaded
async function scanAudibleTabs() {
  try {
    const tabs = await chrome.tabs.query({ audible: true });
    for (const tab of tabs) {
      if (!tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) continue;

      chrome.tabs.sendMessage(tab.id, { action: 'GET_MEDIA_STATE' }, (resp) => {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-main.js'],
            world: 'MAIN'
          }).catch(() => {});

          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-isolated.js']
          }).then(() => {
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, { action: 'GET_MEDIA_STATE' }, () => {});
            }, 200);
          }).catch(() => {});
        }
      });
    }
  } catch (e) {}
}

// Listen for messages from content scripts and newtab.html
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Update from content-isolated.js
  if (request.action === 'MEDIA_STATE_UPDATE') {
    if (sender.frameId !== 0) {
      sendResponse({ ok: false });
      return true;
    }

    const tab = sender.tab;
    if (tab && tab.id) {
      if (request.data && (request.data.hasMedia || request.data.title)) {
        const prev = mediaTabs.get(tab.id);
        const wasPlaying = prev ? prev.isPlaying : false;
        const nowPlaying = !!request.data.isPlaying;

        // If tab newly starts playing or transitions to playing, activate it
        let activatedAt = prev ? (prev.activatedAt || 0) : 0;
        if (nowPlaying && !wasPlaying) {
          activatedAt = Date.now();
          activeSessionTabId = tab.id;
        }

        mediaTabs.set(tab.id, {
          ...request.data,
          tabId: tab.id,
          windowId: tab.windowId,
          favIconUrl: tab.favIconUrl || '',
          tabTitle: tab.title || '',
          lastUpdated: Date.now(),
          activatedAt: activatedAt
        });

        evaluateActiveMedia();
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  // Request from newtab.html: get current media immediately
  if (request.action === 'GET_CURRENT_MEDIA') {
    sendResponse({ activeMedia: currentActiveMedia });
    scanAudibleTabs();
    return true;
  }

  // Request from newtab.html: execute playback command
  if (request.action === 'EXECUTE_COMMAND') {
    const targetTabId = request.tabId || (currentActiveMedia && currentActiveMedia.tabId) || activeSessionTabId;
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, {
        action: 'MEDIA_COMMAND',
        command: request.command,
        payload: request.payload
      }, (res) => {
        if (chrome.runtime.lastError) {
          mediaTabs.delete(targetTabId);
          if (activeSessionTabId === targetTabId) activeSessionTabId = null;
          evaluateActiveMedia();
        }
      });
      sendResponse({ status: 'forwarded' });
    } else {
      sendResponse({ status: 'no_target_tab' });
    }
    return true;
  }

  // Request from newtab.html: focus/switch to the media tab
  if (request.action === 'FOCUS_TAB') {
    const targetTabId = request.tabId || (currentActiveMedia && currentActiveMedia.tabId) || activeSessionTabId;
    if (targetTabId) {
      chrome.tabs.get(targetTabId, (tab) => {
        if (!chrome.runtime.lastError && tab) {
          chrome.tabs.update(tab.id, { active: true });
          if (tab.windowId) {
            chrome.windows.update(tab.windowId, { focused: true });
          }
        }
      });
      sendResponse({ status: 'focused' });
    }
    return true;
  }

  // Scan trigger
  if (request.action === 'SCAN_TABS') {
    scanAudibleTabs();
    sendResponse({ status: 'scanning' });
    return true;
  }
});

// Tab closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (mediaTabs.has(tabId)) {
    mediaTabs.delete(tabId);
    if (activeSessionTabId === tabId) {
      activeSessionTabId = null;
    }
    evaluateActiveMedia();
  }
});

// Tab updated (navigation or audible change)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    if (mediaTabs.has(tabId) && changeInfo.url) {
      const prev = mediaTabs.get(tabId);
      if (prev && prev.url && prev.url !== changeInfo.url) {
        mediaTabs.delete(tabId);
        if (activeSessionTabId === tabId) {
          activeSessionTabId = null;
        }
        evaluateActiveMedia();
      }
    }
  }

  if (changeInfo.audible === true) {
    scanAudibleTabs();
  }
});

// Lifecycle events
chrome.runtime.onInstalled.addListener(() => {
  scanAudibleTabs();
});

chrome.runtime.onStartup.addListener(() => {
  scanAudibleTabs();
});
