/**
 * OLED New Tab - Media Bridge (Runs in ISOLATED world)
 * Bridges communication between MAIN world content-main.js and background.js.
 */
(() => {
  // Игнорировать любые подфреймы и рекламу, работать только в основном окне вкладки
  if (window !== window.top) return;

  // Listen for media status updates from content-main.js (MAIN world)
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'OLED_TAB_MEDIA_MAIN') return;
    
    try {
      chrome.runtime.sendMessage({
        action: 'MEDIA_STATE_UPDATE',
        data: event.data.payload
      }).catch(() => {
        // Background might be temporarily inactive, ignore
      });
    } catch (e) {}
  });

  // Listen for commands from background.js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'MEDIA_COMMAND') {
      window.postMessage({
        source: 'OLED_TAB_MEDIA_CMD',
        action: msg.command,
        payload: msg.payload
      }, '*');
      sendResponse({ status: 'sent' });
      return true;
    }

    if (msg.action === 'GET_MEDIA_STATE') {
      window.postMessage({
        source: 'OLED_TAB_MEDIA_CMD',
        action: 'request_state'
      }, '*');
      sendResponse({ status: 'requested' });
      return true;
    }
  });
})();