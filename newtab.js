// Immediate early wallpaper setup (Eliminates CSP inline-script violations while maintaining instant background render)
try {
  const earlyBg = localStorage.getItem('oled_custom_wallpaper');
  const earlyMode = localStorage.getItem('oled_wallpaper_mode') || 'cover';
  const sizeMap = { fit: 'contain', stretch: '100% 100%', cover: 'cover', original: 'auto' };
  const bgSize = sizeMap[earlyMode] || 'cover';
  if (earlyBg) {
    document.documentElement.style.backgroundImage = 'url("' + earlyBg + '")';
  }
  document.documentElement.style.backgroundSize = bgSize;
  document.documentElement.style.backgroundPosition = 'center';
  document.documentElement.style.backgroundRepeat = 'no-repeat';
} catch (e) {}

// Autofocus search input
window.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.focus();
});

// ============================================================
// MEDIA PLAYER CONTROLLER (Conflict-Free & Zero-Flicker)
// ============================================================
let currentMedia = null;
let currentSeconds = 0;
let totalDuration = 0;
let tickerInterval = null;

const widget = document.getElementById('media-widget');
const idleBar = document.getElementById('idle-bar');
const coverImg = document.getElementById('track-cover');
const coverFallback = document.getElementById('cover-fallback');
const titleEl = document.getElementById('track-title');
const artistEl = document.getElementById('track-artist');
const sourceName = document.getElementById('source-name');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const progressFill = document.getElementById('progress-fill');
const curTimeEl = document.getElementById('time-current');
const totTimeEl = document.getElementById('time-total');
const progressWrap = document.getElementById('progress-wrap');

// Render caching to eliminate DOM thrashing and image blinking
let lastRenderedTabId = null;
let lastRenderedTitle = null;
let lastRenderedArtist = null;
let lastRenderedArtwork = null;
let lastRenderedIsPlaying = null;
let lastRenderedDomain = null;

coverImg.addEventListener('error', () => {
  coverImg.style.display = 'none';
  coverFallback.style.display = 'flex';
});

coverImg.addEventListener('load', () => {
  coverImg.style.display = 'block';
  coverFallback.style.display = 'none';
});

function formatTime(sec) {
  if (isNaN(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function updateProgressUI() {
  if (totalDuration > 0) {
    const pct = Math.min(100, Math.max(0, (currentSeconds / totalDuration) * 100));
    progressFill.style.width = `${pct}%`;
    curTimeEl.textContent = formatTime(currentSeconds);
    totTimeEl.textContent = formatTime(totalDuration);
  } else {
    progressFill.style.width = (currentMedia && currentMedia.isPlaying) ? '100%' : '0%';
    curTimeEl.textContent = formatTime(currentSeconds);
    totTimeEl.textContent = (currentMedia && currentMedia.isPlaying) ? 'LIVE' : '--:--';
  }
}

function startTicker() {
  stopTicker();
  tickerInterval = setInterval(() => {
    if (currentMedia && currentMedia.isPlaying && totalDuration > 0) {
      currentSeconds = Math.min(currentSeconds + 1, totalDuration);
      updateProgressUI();
    }
  }, 1000);
}

function stopTicker() {
  if (tickerInterval) {
    clearInterval(tickerInterval);
    tickerInterval = null;
  }
}

function renderMedia(data) {
  currentMedia = data;

  if (!data || !data.hasMedia || !data.title) {
    widget.classList.add('idle');
    widget.classList.remove('playing');
    stopTicker();
    lastRenderedTabId = null;
    lastRenderedTitle = null;
    lastRenderedArtist = null;
    lastRenderedArtwork = null;
    lastRenderedIsPlaying = null;
    lastRenderedDomain = null;
    return;
  }

  widget.classList.remove('idle');

  // Title update (guarded against unnecessary DOM operations)
  if (lastRenderedTitle !== data.title) {
    lastRenderedTitle = data.title;
    titleEl.textContent = data.title;
    titleEl.title = `${data.title} (Click to open tab)`;
  }

  // Artist update
  const artistText = data.artist || data.album || 'Unknown Artist';
  if (lastRenderedArtist !== artistText) {
    lastRenderedArtist = artistText;
    artistEl.textContent = artistText;
  }

  // Source Platform Name
  let domain = data.hostname || '';
  if (domain.includes('youtube.com')) domain = 'YouTube';
  else if (domain.includes('soundcloud.com')) domain = 'SoundCloud';
  else if (domain.includes('spotify.com')) domain = 'Spotify';
  else if (domain.includes('music.yandex')) domain = 'Yandex Music';
  else if (domain.includes('vk.com')) domain = 'VK';
  else if (domain) domain = domain.replace(/^www\./, '');
  else domain = 'Tab';

  if (lastRenderedDomain !== domain) {
    lastRenderedDomain = domain;
    sourceName.textContent = domain;
  }

  // Cover Art: strictly guard against re-assigning same src to prevent visual blinking
  const artworkUrl = data.artwork || '';
  if (lastRenderedArtwork !== artworkUrl) {
    lastRenderedArtwork = artworkUrl;
    if (artworkUrl) {
      coverImg.src = artworkUrl;
    } else {
      coverImg.removeAttribute('src');
      coverImg.style.display = 'none';
      coverFallback.style.display = 'flex';
    }
  }

  // Playing / Paused state transitions
  if (lastRenderedIsPlaying !== data.isPlaying) {
    lastRenderedIsPlaying = data.isPlaying;
    if (data.isPlaying) {
      widget.classList.add('playing');
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
      startTicker();
    } else {
      widget.classList.remove('playing');
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      stopTicker();
    }
  }

  // Progress bar sync
  currentSeconds = data.currentTime || 0;
  totalDuration = data.duration || 0;
  updateProgressUI();
}

// Communication with background service worker
function sendCommand(command, payload) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({
      action: 'EXECUTE_COMMAND',
      command: command,
      payload: payload,
      tabId: currentMedia?.tabId
    });
  }
}

function focusMediaTab() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({
      action: 'FOCUS_TAB',
      tabId: currentMedia?.tabId
    });
  }
}

// Event listeners for player controls
document.getElementById('btn-play-pause').addEventListener('click', (e) => {
  e.stopPropagation();
  sendCommand('toggle_play');
  if (currentMedia) {
    currentMedia.isPlaying = !currentMedia.isPlaying;
    renderMedia(currentMedia);
  }
});

document.getElementById('btn-prev').addEventListener('click', (e) => {
  e.stopPropagation();
  sendCommand('previoustrack');
});

document.getElementById('btn-next').addEventListener('click', (e) => {
  e.stopPropagation();
  sendCommand('nexttrack');
});

document.getElementById('cover-box').addEventListener('click', focusMediaTab);
titleEl.addEventListener('click', focusMediaTab);
document.getElementById('btn-jump-tab').addEventListener('click', focusMediaTab);

idleBar.addEventListener('click', () => {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'SCAN_TABS' });
  }
});

// Seeking on progress rail click
progressWrap.addEventListener('click', (e) => {
  if (!currentMedia || totalDuration <= 0) return;
  const rail = document.getElementById('progress-rail');
  const rect = rail.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
  const seekTime = Math.round(ratio * totalDuration);

  currentSeconds = seekTime;
  updateProgressUI();
  sendCommand('seekto', { time: seekTime });
});

// Chrome Extension Media Integration (Debounced to RAF to ensure 60 FPS)
let pendingMediaUpdate = null;
let mediaRaf = null;

function queueMediaRender(data) {
  pendingMediaUpdate = data;
  if (!mediaRaf) {
    mediaRaf = requestAnimationFrame(() => {
      mediaRaf = null;
      renderMedia(pendingMediaUpdate);
    });
  }
}

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get('activeMedia', (res) => {
    if (res && res.activeMedia) {
      renderMedia(res.activeMedia);
    }
  });

  if (chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'GET_CURRENT_MEDIA' }, (res) => {
      if (res && res.activeMedia) {
        renderMedia(res.activeMedia);
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'ACTIVE_MEDIA_CHANGED') {
      queueMediaRender(msg.data);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.activeMedia) {
      queueMediaRender(changes.activeMedia.newValue);
    }
  });
}

// ============================================================
// GOOGLE SEARCH & AI MODE CONTROLLER (Auto-Resize & Shift+Enter)
// ============================================================
(function initSearchController() {
  const searchForm = document.getElementById('search-form');
  const searchBox = document.getElementById('search-box');
  const searchInput = document.getElementById('search-input');
  const btnAttach = document.getElementById('btn-attach');
  const fileInput = document.getElementById('file-input');
  const btnMic = document.getElementById('btn-mic');
  const btnAiMode = document.getElementById('btn-ai-mode');
  const btnClear = document.getElementById('btn-clear');
  const attachmentsList = document.getElementById('attachments-list');
  const btnSubmit = document.getElementById('btn-submit');

  if (!searchBox || !searchInput) return;

  let attachedFiles = [];
  let isAiModeActive = false;

  try {
    isAiModeActive = localStorage.getItem('oled_ai_mode') === 'true';
  } catch (e) {}

  // Dynamically auto-resize textarea up to 180px
  function autoResizeSearchInput() {
    searchInput.style.height = 'auto';
    const scrollH = searchInput.scrollHeight;
    const targetH = Math.min(Math.max(24, scrollH), 180);
    searchInput.style.height = `${targetH}px`;
    searchInput.style.overflowY = scrollH > 180 ? 'auto' : 'hidden';
  }

  function updateUIState() {
    const hasFiles = attachedFiles.length > 0;
    const hasText = searchInput.value.length > 0;

    if (hasFiles) {
      searchBox.classList.add('has-files');
    } else {
      searchBox.classList.remove('has-files');
    }

    if (isAiModeActive) {
      btnAiMode.classList.add('active');
      searchInput.placeholder = 'Ask anything';
    } else {
      btnAiMode.classList.remove('active');
      searchInput.placeholder = hasFiles ? 'Ask anything' : 'Ask Google';
    }

    if (hasFiles || hasText) {
      btnClear.classList.remove('hidden');
    } else {
      btnClear.classList.add('hidden');
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function renderAttachments() {
    attachmentsList.innerHTML = '';

    attachedFiles.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'attachment-card';
      card.title = `${item.file.name} (${formatFileSize(item.file.size)})`;

      if (item.isImage && item.previewUrl) {
        const img = document.createElement('img');
        img.className = 'attachment-thumb';
        img.src = item.previewUrl;
        img.alt = item.file.name;
        card.appendChild(img);
      } else {
        const badge = document.createElement('div');
        badge.className = 'attachment-badge';
        const extText = (item.ext || 'FILE').substring(0, 4).toUpperCase();
        badge.textContent = extText;
        card.appendChild(badge);
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'attachment-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'Remove';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeAttachment(index);
      });

      card.appendChild(removeBtn);
      attachmentsList.appendChild(card);
    });

    updateUIState();
  }

  function addFiles(files) {
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImg = file.type.startsWith('image/');
      const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
      let previewUrl = null;
      if (isImg) {
        try {
          previewUrl = URL.createObjectURL(file);
        } catch (e) {
          console.error('Error creating object URL', e);
        }
      }

      attachedFiles.push({
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        file: file,
        previewUrl: previewUrl,
        ext: ext,
        isImage: isImg
      });
    }

    renderAttachments();
    searchInput.focus();
  }

  function removeAttachment(index) {
    if (index >= 0 && index < attachedFiles.length) {
      const item = attachedFiles[index];
      if (item.previewUrl) {
        try {
          URL.revokeObjectURL(item.previewUrl);
        } catch (e) {}
      }
      attachedFiles.splice(index, 1);
      renderAttachments();
    }
  }

  function clearAll() {
    attachedFiles.forEach(item => {
      if (item.previewUrl) {
        try {
          URL.revokeObjectURL(item.previewUrl);
        } catch (e) {}
      }
    });
    attachedFiles = [];
    searchInput.value = '';
    autoResizeSearchInput();
    renderAttachments();
    searchInput.focus();
  }

  function submitSearch() {
    const query = searchInput.value.trim();

    if (attachedFiles.length > 0) {
      const uploadForm = document.createElement('form');
      uploadForm.action = 'https://lens.google.com/upload';
      uploadForm.method = 'POST';
      uploadForm.enctype = 'multipart/form-data';
      uploadForm.style.display = 'none';

      const hiddenFileInput = document.createElement('input');
      hiddenFileInput.type = 'file';
      hiddenFileInput.name = 'encoded_image';

      const dt = new DataTransfer();
      for (const item of attachedFiles) {
        dt.items.add(item.file);
      }
      hiddenFileInput.files = dt.files;
      uploadForm.appendChild(hiddenFileInput);

      if (query) {
        const qInput = document.createElement('input');
        qInput.type = 'hidden';
        qInput.name = 'q';
        qInput.value = query;
        uploadForm.appendChild(qInput);
      }

      if (isAiModeActive) {
        const udmInput = document.createElement('input');
        udmInput.type = 'hidden';
        udmInput.name = 'udm';
        udmInput.value = '50';
        uploadForm.appendChild(udmInput);
      }

      document.body.appendChild(uploadForm);
      uploadForm.submit();
    } else {
      if (!query && !isAiModeActive) return;

      const params = new URLSearchParams();
      if (query) params.set('q', query);

      if (isAiModeActive) {
        params.set('sourceid', 'chrome');
        params.set('udm', '50');
      }

      window.location.href = `https://www.google.com/search?${params.toString()}`;
    }
  }

  function startVoiceSearch() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;

    btnMic.classList.add('listening');

    recognition.onresult = (e) => {
      let transcript = '';
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      searchInput.value = transcript;
      autoResizeSearchInput();
      updateUIState();
    };

    recognition.onerror = () => {
      btnMic.classList.remove('listening');
    };

    recognition.onend = () => {
      btnMic.classList.remove('listening');
      if (searchInput.value.trim()) {
        searchInput.focus();
      }
    };

    recognition.start();
  }

  // Listeners
  if (btnAttach) {
    btnAttach.addEventListener('click', () => fileInput.click());
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      addFiles(e.target.files);
      fileInput.value = '';
    });
  }

  if (btnAiMode) {
    btnAiMode.addEventListener('click', () => {
      const query = searchInput.value.trim();
      if (query && !isAiModeActive) {
        isAiModeActive = true;
        try { localStorage.setItem('oled_ai_mode', 'true'); } catch (e) {}
        updateUIState();
        submitSearch();
      } else {
        isAiModeActive = !isAiModeActive;
        try { localStorage.setItem('oled_ai_mode', isAiModeActive ? 'true' : 'false'); } catch (e) {}
        updateUIState();
        searchInput.focus();
      }
    });
  }

  if (btnClear) {
    btnClear.addEventListener('click', clearAll);
  }

  if (btnMic) {
    btnMic.addEventListener('click', startVoiceSearch);
  }

  if (btnSubmit) {
    btnSubmit.addEventListener('click', (e) => {
      e.preventDefault();
      submitSearch();
    });
  }

  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitSearch();
    });
  }

  // Auto-resize on input
  searchInput.addEventListener('input', () => {
    autoResizeSearchInput();
    updateUIState();
  });

  // Enter vs Shift+Enter Keyboard Handling
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Shift + Enter: Allow natural line break, prevent form submission
        requestAnimationFrame(autoResizeSearchInput);
      } else {
        // Enter: Submit search query
        e.preventDefault();
        submitSearch();
      }
    } else if (e.key === 'Escape') {
      if (attachedFiles.length > 0 || searchInput.value) {
        clearAll();
      }
    }
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    searchBox.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      searchBox.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    searchBox.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      searchBox.classList.remove('drag-over');
    });
  });

  searchBox.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  });

  window.addEventListener('paste', (e) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      addFiles(e.clipboardData.files);
    }
  });

  updateUIState();
})();

// ============================================================
// DYNAMIC SHORTCUTS, WALLPAPER & SETTINGS PANEL CONTROLLER
// ============================================================
(function initShortcutsAndSettings() {
  const shortcutsGrid = document.getElementById('shortcuts-grid');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsBackdrop = document.getElementById('settings-backdrop');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnAddShortcut = document.getElementById('btn-add-shortcut');
  const shortcutsListEl = document.getElementById('settings-shortcuts-list');

  const wallpaperInput = document.getElementById('wallpaper-file-input');
  const btnResetWallpaper = document.getElementById('btn-reset-wallpaper');

  const toggleSearch = document.getElementById('toggle-search');
  const toggleShortcuts = document.getElementById('toggle-shortcuts');
  const togglePlayer = document.getElementById('toggle-player');
  const toggleGuide = document.getElementById('toggle-guide');

  const searchWidget = document.getElementById('search-form');
  const mediaWidget = document.getElementById('media-widget');
  const guideWidget = document.getElementById('settings-hint');

  // ==========================================
  // 1. CUSTOM WALLPAPER MANAGEMENT & SIZING MODES
  // ==========================================
  let currentWallpaperMode = 'cover';
  try {
    const savedMode = localStorage.getItem('oled_wallpaper_mode');
    if (savedMode && ['fit', 'stretch', 'cover', 'original'].includes(savedMode)) {
      currentWallpaperMode = savedMode;
    }
  } catch (e) {}

  function getBgSizeValue(mode) {
    switch (mode) {
      case 'fit': return 'contain';
      case 'stretch': return '100% 100%';
      case 'original': return 'auto';
      case 'cover':
      default: return 'cover';
    }
  }

  function updateWallpaperModeUI() {
    const modeBtns = document.querySelectorAll('.btn-wp-mode');
    modeBtns.forEach((btn) => {
      const mode = btn.getAttribute('data-mode');
      btn.classList.toggle('active', mode === currentWallpaperMode);
    });
  }

  function applyWallpaper(dataUrl, mode = currentWallpaperMode) {
    currentWallpaperMode = mode;
    const bgSize = getBgSizeValue(mode);

    if (dataUrl) {
      document.body.style.backgroundImage = `url("${dataUrl}")`;
      document.body.style.backgroundSize = bgSize;
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundRepeat = 'no-repeat';
      document.documentElement.style.backgroundImage = `url("${dataUrl}")`;
      document.documentElement.style.backgroundSize = bgSize;
      document.documentElement.style.backgroundPosition = 'center';
      document.documentElement.style.backgroundRepeat = 'no-repeat';
      if (btnResetWallpaper) btnResetWallpaper.classList.remove('hidden');
    } else {
      document.body.style.backgroundImage = "url('wallpaper.jpg')";
      document.body.style.backgroundSize = bgSize;
      document.body.style.backgroundPosition = 'center';
      document.body.style.backgroundRepeat = 'no-repeat';
      document.documentElement.style.backgroundImage = '';
      document.documentElement.style.backgroundSize = bgSize;
      document.documentElement.style.backgroundPosition = 'center';
      document.documentElement.style.backgroundRepeat = 'no-repeat';
      if (btnResetWallpaper) btnResetWallpaper.classList.add('hidden');
    }

    updateWallpaperModeUI();
  }

  // Load custom wallpaper on startup
  try {
    const savedWallpaper = localStorage.getItem('oled_custom_wallpaper');
    applyWallpaper(savedWallpaper || null, currentWallpaperMode);
  } catch (e) {
    applyWallpaper(null, currentWallpaperMode);
  }

  // Bind click on wallpaper mode buttons
  const modeBtns = document.querySelectorAll('.btn-wp-mode');
  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      if (!mode) return;
      currentWallpaperMode = mode;
      try {
        localStorage.setItem('oled_wallpaper_mode', mode);
      } catch (err) {}

      let savedWallpaper = null;
      try {
        savedWallpaper = localStorage.getItem('oled_custom_wallpaper');
      } catch (err) {}
      applyWallpaper(savedWallpaper || null, mode);
    });
  });

  if (wallpaperInput) {
    wallpaperInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const base64 = evt.target.result;
        try {
          localStorage.setItem('oled_custom_wallpaper', base64);
          applyWallpaper(base64, currentWallpaperMode);
        } catch (err) {
          // If large image exceeds localStorage quota, safely compress via canvas
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const maxDimension = 1920;
            let width = img.width;
            let height = img.height;
            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL('image/jpeg', 0.85);
            try {
              localStorage.setItem('oled_custom_wallpaper', compressed);
              applyWallpaper(compressed, currentWallpaperMode);
            } catch (e2) {
              console.error('Failed to store wallpaper in localStorage', e2);
            }
          };
          img.src = base64;
          return;
        }
      };
      reader.readAsDataURL(file);
      wallpaperInput.value = '';
    });
  }

  if (btnResetWallpaper) {
    btnResetWallpaper.addEventListener('click', () => {
      try {
        localStorage.removeItem('oled_custom_wallpaper');
      } catch (e) {}
      applyWallpaper(null, currentWallpaperMode);
    });
  }

  // ==========================================
  // 2. SHORTCUTS DATA & FAVICON CACHING
  // ==========================================
  const DEFAULT_SHORTCUTS = [
    { id: 'sc_1', title: 'Gemini', url: 'https://gemini.google.com' },
    { id: 'sc_2', title: 'Drive', url: 'https://drive.google.com' },
    { id: 'sc_3', title: 'Gmail', url: 'https://mail.google.com' },
    { id: 'sc_4', title: 'SoundCloud', url: 'https://soundcloud.com' },
    { id: 'sc_5', title: 'Keep', url: 'https://keep.google.com' },
    { id: 'sc_6', title: 'Pinterest', url: 'https://www.pinterest.com' },
    { id: 'sc_7', title: 'Tasks', url: 'https://tasks.google.com' }
  ];

  let shortcuts = [];
  try {
    const saved = localStorage.getItem('oled_shortcuts');
    shortcuts = saved ? JSON.parse(saved) : DEFAULT_SHORTCUTS;
  } catch (e) {
    shortcuts = DEFAULT_SHORTCUTS;
  }

  function saveShortcuts() {
    try {
      localStorage.setItem('oled_shortcuts', JSON.stringify(shortcuts));
    } catch (e) {
      console.warn('Failed to save shortcuts to localStorage', e);
    }
  }

  let saveShortcutsTimer = null;
  function debouncedSaveShortcuts() {
    if (saveShortcutsTimer) clearTimeout(saveShortcutsTimer);
    saveShortcutsTimer = setTimeout(() => {
      saveShortcuts();
    }, 200);
  }

  // Deduplicated Favicon Fetching & Caching as Base64
  const pendingFaviconRequests = new Map();

  async function fetchFaviconAsBase64(url) {
    try {
      let hostname = '';
      try {
        hostname = new URL(url).hostname;
      } catch (e) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          hostname = new URL('https://' + url).hostname;
        } else {
          return null;
        }
      }
      if (!hostname) return null;

      const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
      const res = await fetch(faviconUrl);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }

  async function ensureFavicon(shortcut) {
    if (shortcut.faviconBase64) return shortcut.faviconBase64;
    if (!shortcut.url || shortcut.url === 'https://') return null;

    if (pendingFaviconRequests.has(shortcut.url)) {
      return pendingFaviconRequests.get(shortcut.url);
    }

    const promise = fetchFaviconAsBase64(shortcut.url).then((base64) => {
      pendingFaviconRequests.delete(shortcut.url);
      if (base64) {
        shortcut.faviconBase64 = base64;
        saveShortcuts();
      }
      return base64;
    });

    pendingFaviconRequests.set(shortcut.url, promise);
    return promise;
  }

  // ==========================================
  // 3. HORIZONTAL SHORTCUTS ROW RENDERING & DYNAMIC SCALING
  // ==========================================
  function adjustShortcutsScale() {
    if (!shortcutsGrid) return;
    const count = shortcuts.length;
    if (count === 0) return;

    const availableWidth = Math.max(280, window.innerWidth - 48);

    // Default base sizes (designed for up to 7 items or spacious screens)
    let gap = 16;
    let itemWidth = 68;
    let iconSize = 50;
    let imgSize = 24;
    let avatarFont = 18;
    let titleFont = 11.5;

    const naturalWidth = (count * itemWidth) + ((count - 1) * gap);

    if (naturalWidth > availableWidth || count > 8) {
      // Intelligently shrink gap and itemWidth to fit 100% within available width
      gap = Math.max(3, Math.min(14, Math.floor((availableWidth * 0.12) / Math.max(1, count - 1))));
      const remainingWidth = availableWidth - ((count - 1) * gap);
      itemWidth = Math.max(26, Math.min(68, Math.floor(remainingWidth / count)));

      const ratio = Math.max(0.42, Math.min(1.0, itemWidth / 68));
      iconSize = Math.max(24, Math.round(50 * ratio));
      imgSize = Math.max(12, Math.round(24 * ratio));
      avatarFont = Math.max(9, Math.round(18 * ratio));
      titleFont = Math.max(8, Math.round(11.5 * ratio * 10) / 10);
    }

    shortcutsGrid.style.setProperty('--sc-gap', `${gap}px`);
    shortcutsGrid.style.setProperty('--sc-item-width', `${itemWidth}px`);
    shortcutsGrid.style.setProperty('--sc-icon-size', `${iconSize}px`);
    shortcutsGrid.style.setProperty('--sc-img-size', `${imgSize}px`);
    shortcutsGrid.style.setProperty('--sc-avatar-size', `${avatarFont}px`);
    shortcutsGrid.style.setProperty('--sc-title-size', `${titleFont}px`);
  }

  function renderShortcutsGrid() {
    if (!shortcutsGrid) return;
    shortcutsGrid.innerHTML = '';

    shortcuts.forEach((sc) => {
      const item = document.createElement('a');
      item.className = 'shortcut-item';
      item.href = sc.url;
      item.title = sc.title || sc.url;
      item.setAttribute('data-id', sc.id);

      item.addEventListener('click', () => {
        ensureFavicon(sc);
      });

      const iconWrap = document.createElement('div');
      iconWrap.className = 'shortcut-icon-wrap';

      const firstChar = (sc.title || sc.url || 'S').trim().charAt(0).toUpperCase();

      const avatar = document.createElement('div');
      avatar.className = 'shortcut-avatar';
      avatar.textContent = firstChar;

      const img = document.createElement('img');
      img.className = 'shortcut-icon';
      img.alt = '';

      if (sc.faviconBase64) {
        img.src = sc.faviconBase64;
        avatar.style.display = 'none';
      } else {
        img.style.display = 'none';
        avatar.style.display = 'flex';

        // Load favicon in background and update DOM node directly without re-rendering grid
        ensureFavicon(sc).then((base64) => {
          if (base64) {
            img.src = base64;
            img.style.display = 'block';
            avatar.style.display = 'none';
          }
        });
      }

      img.addEventListener('error', () => {
        img.style.display = 'none';
        avatar.style.display = 'flex';
      });

      iconWrap.appendChild(img);
      iconWrap.appendChild(avatar);

      const titleEl = document.createElement('span');
      titleEl.className = 'shortcut-title';
      titleEl.textContent = sc.title || sc.url;

      item.appendChild(iconWrap);
      item.appendChild(titleEl);
      shortcutsGrid.appendChild(item);
    });

    adjustShortcutsScale();
  }

  // ==========================================
  // 4. SHORTCUTS MANAGER IN SETTINGS (Locked 60 FPS)
  // ==========================================
  function createShortcutManagerRow(sc) {
    const row = document.createElement('div');
    row.className = 'settings-shortcut-item';
    row.setAttribute('data-id', sc.id);

    const iconPreview = document.createElement('div');
    iconPreview.className = 'settings-sc-icon-preview';
    const firstChar = (sc.title || sc.url || 'S').trim().charAt(0).toUpperCase();

    const previewImg = document.createElement('img');
    previewImg.alt = '';

    const previewAvatar = document.createElement('span');
    previewAvatar.className = 'avatar';
    previewAvatar.textContent = firstChar;

    if (sc.faviconBase64) {
      previewImg.src = sc.faviconBase64;
      previewAvatar.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      previewAvatar.style.display = 'inline';

      ensureFavicon(sc).then((base64) => {
        if (base64) {
          previewImg.src = base64;
          previewImg.style.display = 'block';
          previewAvatar.style.display = 'none';
        }
      });
    }

    previewImg.addEventListener('error', () => {
      previewImg.style.display = 'none';
      previewAvatar.style.display = 'inline';
    });

    iconPreview.appendChild(previewImg);
    iconPreview.appendChild(previewAvatar);

    const inputsWrap = document.createElement('div');
    inputsWrap.className = 'settings-sc-inputs';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'settings-sc-input';
    titleInput.placeholder = 'Title';
    titleInput.value = sc.title || '';
    titleInput.addEventListener('input', () => {
      sc.title = titleInput.value.trim();
      debouncedSaveShortcuts();
      // Surgically update the corresponding shortcut title in the main row
      const gridTitle = shortcutsGrid.querySelector(`.shortcut-item[data-id="${sc.id}"] .shortcut-title`);
      if (gridTitle) gridTitle.textContent = sc.title || sc.url;
    });

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'settings-sc-input';
    urlInput.placeholder = 'https://...';
    urlInput.value = sc.url || '';
    urlInput.addEventListener('change', async () => {
      let val = urlInput.value.trim();
      if (val && !val.startsWith('http://') && !val.startsWith('https://')) {
        val = 'https://' + val;
        urlInput.value = val;
      }
      sc.url = val;
      sc.faviconBase64 = null;
      debouncedSaveShortcuts();

      // Update link in grid
      const gridItem = shortcutsGrid.querySelector(`.shortcut-item[data-id="${sc.id}"]`);
      if (gridItem) gridItem.href = sc.url;

      const base64 = await ensureFavicon(sc);
      if (base64) {
        previewImg.src = base64;
        previewImg.style.display = 'block';
        previewAvatar.style.display = 'none';

        if (gridItem) {
          const gImg = gridItem.querySelector('.shortcut-icon');
          const gAvatar = gridItem.querySelector('.shortcut-avatar');
          if (gImg) {
            gImg.src = base64;
            gImg.style.display = 'block';
          }
          if (gAvatar) gAvatar.style.display = 'none';
        }
      }
    });

    inputsWrap.appendChild(titleInput);
    inputsWrap.appendChild(urlInput);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-delete-shortcut';
    delBtn.title = 'Delete Shortcut';
    delBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    delBtn.addEventListener('click', () => {
      const idx = shortcuts.findIndex(item => item.id === sc.id);
      if (idx !== -1) {
        shortcuts.splice(idx, 1);
        debouncedSaveShortcuts();
        row.remove();
        renderShortcutsGrid();
      }
    });

    row.appendChild(iconPreview);
    row.appendChild(inputsWrap);
    row.appendChild(delBtn);
    return row;
  }

  function renderShortcutsManager() {
    if (!shortcutsListEl) return;
    shortcutsListEl.innerHTML = '';
    shortcuts.forEach((sc) => {
      shortcutsListEl.appendChild(createShortcutManagerRow(sc));
    });
  }

  if (btnAddShortcut) {
    btnAddShortcut.addEventListener('click', () => {
      const newSc = {
        id: 'sc_' + Date.now(),
        title: 'New Shortcut',
        url: 'https://',
        faviconBase64: null
      };
      shortcuts.push(newSc);
      debouncedSaveShortcuts();
      renderShortcutsGrid();

      const newRow = createShortcutManagerRow(newSc);
      shortcutsListEl.appendChild(newRow);

      const urlInput = newRow.querySelectorAll('.settings-sc-input')[1];
      if (urlInput) {
        urlInput.focus();
        urlInput.select();
      }
    });
  }

  // ==========================================
  // 5. WIDGET VISIBILITY CONTROLS
  // ==========================================
  let widgetsVisibility = { search: true, shortcuts: true, player: true, guide: true };
  try {
    const savedVis = localStorage.getItem('oled_widgets_visibility');
    if (savedVis) widgetsVisibility = Object.assign(widgetsVisibility, JSON.parse(savedVis));
  } catch (e) {}

  let saveVisTimer = null;
  function debouncedSaveVisibility() {
    if (saveVisTimer) clearTimeout(saveVisTimer);
    saveVisTimer = setTimeout(() => {
      try {
        localStorage.setItem('oled_widgets_visibility', JSON.stringify(widgetsVisibility));
      } catch (e) {}
    }, 200);
  }

  function applyWidgetVisibility() {
    if (searchWidget) searchWidget.classList.toggle('hidden', !widgetsVisibility.search);
    if (shortcutsGrid) shortcutsGrid.classList.toggle('hidden', !widgetsVisibility.shortcuts);
    if (mediaWidget) mediaWidget.classList.toggle('hidden', !widgetsVisibility.player);
    if (guideWidget) guideWidget.classList.toggle('hidden', !widgetsVisibility.guide);

    if (toggleSearch) toggleSearch.checked = widgetsVisibility.search;
    if (toggleShortcuts) toggleShortcuts.checked = widgetsVisibility.shortcuts;
    if (togglePlayer) togglePlayer.checked = widgetsVisibility.player;
    if (toggleGuide) toggleGuide.checked = widgetsVisibility.guide;
  }

  if (toggleSearch) {
    toggleSearch.addEventListener('change', () => {
      widgetsVisibility.search = toggleSearch.checked;
      if (searchWidget) searchWidget.classList.toggle('hidden', !widgetsVisibility.search);
      debouncedSaveVisibility();
    });
  }
  if (toggleShortcuts) {
    toggleShortcuts.addEventListener('change', () => {
      widgetsVisibility.shortcuts = toggleShortcuts.checked;
      if (shortcutsGrid) shortcutsGrid.classList.toggle('hidden', !widgetsVisibility.shortcuts);
      debouncedSaveVisibility();
    });
  }
  if (togglePlayer) {
    togglePlayer.addEventListener('change', () => {
      widgetsVisibility.player = togglePlayer.checked;
      if (mediaWidget) mediaWidget.classList.toggle('hidden', !widgetsVisibility.player);
      debouncedSaveVisibility();
    });
  }
  if (toggleGuide) {
    toggleGuide.addEventListener('change', () => {
      widgetsVisibility.guide = toggleGuide.checked;
      if (guideWidget) guideWidget.classList.toggle('hidden', !widgetsVisibility.guide);
      debouncedSaveVisibility();
    });
  }

  // ==========================================
  // 6. SETTINGS PANEL (RIGHT-SIDE DOCKED, EASEOUT ANIMATION, LOCKED 60 FPS)
  // ==========================================
  let isSettingsOpen = false;

  function openSettings() {
    if (!settingsPanel) return;
    isSettingsOpen = true;
    renderShortcutsManager();
    settingsPanel.classList.add('open');
    if (settingsBackdrop) settingsBackdrop.classList.add('open');
  }

  function closeSettings() {
    if (!settingsPanel) return;
    isSettingsOpen = false;
    settingsPanel.classList.remove('open');
    if (settingsBackdrop) settingsBackdrop.classList.remove('open');
  }

  function toggleSettings() {
    if (isSettingsOpen) closeSettings();
    else openSettings();
  }

  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettings);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettings);

  // Passive debounced resize handler
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      adjustShortcutsScale();
    }, 60);
  }, { passive: true });

  // Keybindings: 's' and 'ы' toggle settings panel (safely ignores input/textarea fields)
  window.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isInput = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable
    );
    if (isInput) return;

    if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') {
      e.preventDefault();
      toggleSettings();
    } else if (e.key === 'Escape' && isSettingsOpen) {
      closeSettings();
    }
  });

  // Initial render
  renderShortcutsGrid();
  applyWidgetVisibility();
})();
