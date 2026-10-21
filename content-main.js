/**
 * OLED New Tab - Media Hook (Runs in MAIN world)
 * Intercepts navigator.mediaSession, video/audio elements, and popular web players.
 */
(() => {
  if (window.__oledMediaHookInstalled) return;
  window.__oledMediaHookInstalled = true;

  const capturedHandlers = {};
  let lastSentState = null;
  let throttleTimer = null;

  // Best artwork selector: finds the highest resolution image
  function pickBestArtwork(artworkList) {
    if (!artworkList || !artworkList.length) return '';
    let best = artworkList[0];
    let maxArea = 0;
    for (const item of artworkList) {
      if (!item || !item.src) continue;
      if (item.sizes) {
        const match = item.sizes.match(/(\d+)x(\d+)/);
        if (match) {
          const area = parseInt(match[1], 10) * parseInt(match[2], 10);
          if (area > maxArea) {
            maxArea = area;
            best = item;
          }
        }
      } else {
        best = item;
      }
    }
    return best && best.src ? best.src : '';
  }

  // Intercept navigator.mediaSession
  if ('mediaSession' in navigator) {
    try {
      const origSetActionHandler = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = function (action, handler) {
        if (handler) {
          capturedHandlers[action] = handler;
        } else {
          delete capturedHandlers[action];
        }
        return origSetActionHandler(action, handler);
      };
    } catch (e) {}

    try {
      const OrigMediaMetadata = window.MediaMetadata;
      if (typeof OrigMediaMetadata !== 'undefined') {
        window.MediaMetadata = function (init) {
          const meta = new OrigMediaMetadata(init);
          setTimeout(reportMediaState, 50);
          return meta;
        };
        window.MediaMetadata.prototype = OrigMediaMetadata.prototype;
      }
    } catch (e) {}

    try {
      const metaDesc = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata');
      if (metaDesc && metaDesc.set) {
        Object.defineProperty(MediaSession.prototype, 'metadata', {
          get() {
            return metaDesc.get.call(this);
          },
          set(val) {
            const res = metaDesc.set.call(this, val);
            setTimeout(reportMediaState, 50);
            return res;
          },
          configurable: true,
          enumerable: true
        });
      }
    } catch (e) {}

    try {
      const psDesc = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'playbackState');
      if (psDesc && psDesc.set) {
        Object.defineProperty(MediaSession.prototype, 'playbackState', {
          get() {
            return psDesc.get.call(this);
          },
          set(val) {
            const res = psDesc.set.call(this, val);
            setTimeout(reportMediaState, 50);
            return res;
          },
          configurable: true,
          enumerable: true
        });
      }
    } catch (e) {}
  }

  // Listen to media DOM events (capture phase)
  const mediaEvents = ['play', 'playing', 'pause', 'ended', 'timeupdate', 'durationchange', 'ratechange'];
  mediaEvents.forEach(evt => {
    window.addEventListener(evt, (e) => {
      if (e.target && (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO')) {
        if (evt === 'timeupdate') {
          throttleReport();
        } else {
          reportMediaState();
        }
      }
    }, true);
  });

  function throttleReport() {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      reportMediaState();
    }, 1000);
  }

  function getActiveMediaElement() {
    const mediaEls = Array.from(document.querySelectorAll('video, audio'));
    const playing = mediaEls.find(m => !m.paused && !m.ended && m.currentTime > 0);
    if (playing) return playing;
    const withTime = mediaEls.find(m => m.duration > 0 || m.currentTime > 0);
    if (withTime) return withTime;
    return mediaEls[0] || null;
  }

  function extractMediaData() {
    let title = '';
    let artist = '';
    let album = '';
    let artwork = '';
    let isPlaying = false;
    let currentTime = 0;
    let duration = 0;

    // 1. From navigator.mediaSession
    if (navigator.mediaSession && navigator.mediaSession.metadata) {
      const m = navigator.mediaSession.metadata;
      title = (m.title || '').trim();
      artist = (m.artist || '').trim();
      album = (m.album || '').trim();
      if (m.artwork && m.artwork.length) {
        artwork = pickBestArtwork(m.artwork);
      }
    }

    const activeEl = getActiveMediaElement();
    if (activeEl) {
      if (!activeEl.paused && !activeEl.ended && activeEl.readyState >= 2) {
        isPlaying = true;
      }
      currentTime = activeEl.currentTime || 0;
      duration = activeEl.duration || 0;
      if (!artwork && activeEl.poster) {
        artwork = activeEl.poster;
      }
    }

    if (navigator.mediaSession && navigator.mediaSession.playbackState) {
      if (navigator.mediaSession.playbackState === 'playing') isPlaying = true;
      else if (navigator.mediaSession.playbackState === 'paused') isPlaying = false;
    }

    // Site-specific fallbacks
    const host = location.hostname;

    // YouTube
    if (host.includes('youtube.com') && !host.includes('music.youtube.com')) {
      if (!title) {
        const ytTitle = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #container > h1 > yt-formatted-string, .ytp-title-link');
        if (ytTitle) title = ytTitle.textContent.trim();
      }
      if (!artist) {
        const ytArtist = document.querySelector('#owner #channel-name a, ytd-channel-name a, #upload-info #channel-name');
        if (ytArtist) artist = ytArtist.textContent.trim();
      }
      if (!artwork) {
        const urlParams = new URLSearchParams(location.search);
        const vId = urlParams.get('v');
        if (vId) artwork = `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
      }
    }
    // YouTube Music
    else if (host.includes('music.youtube.com')) {
      if (!title) {
        const ytTitle = document.querySelector('ytmusic-player-bar .title');
        if (ytTitle) title = ytTitle.textContent.trim();
      }
      if (!artist) {
        const ytArtist = document.querySelector('ytmusic-player-bar .byline a');
        if (ytArtist) artist = ytArtist.textContent.trim();
      }
      if (!artwork) {
        const ytImg = document.querySelector('ytmusic-player-bar .image');
        if (ytImg && ytImg.src) artwork = ytImg.src;
      }
    }
    // SoundCloud
    else if (host.includes('soundcloud.com')) {
      if (!title) {
        const scTitle = document.querySelector('.playbackSoundBadge__titleLink');
        if (scTitle) title = scTitle.title || scTitle.textContent.trim();
      }
      if (!artist) {
        const scArtist = document.querySelector('.playbackSoundBadge__lightLink');
        if (scArtist) artist = scArtist.title || scArtist.textContent.trim();
      }
      if (!artwork) {
        const scArt = document.querySelector('.playbackSoundBadge__avatar span.sc-artwork');
        if (scArt) {
          const bg = scArt.style.backgroundImage;
          if (bg && bg.includes('url(')) {
            artwork = bg.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
          }
        }
      }
    }
    // Spotify Web Player
    else if (host.includes('spotify.com')) {
      if (!title) {
        const spTitle = document.querySelector('[data-testid="context-item-info-title"]');
        if (spTitle) title = spTitle.textContent.trim();
      }
      if (!artist) {
        const spArtist = document.querySelector('[data-testid="context-item-info-subtitles"]');
        if (spArtist) artist = spArtist.textContent.trim();
      }
      if (!artwork) {
        const spArt = document.querySelector('[data-testid="cover-art-image"]');
        if (spArt && spArt.src) artwork = spArt.src;
      }
    }
    // Yandex Music
    else if (host.includes('music.yandex')) {
      if (!title) {
        const ymTitle = document.querySelector('.track__title');
        if (ymTitle) title = ymTitle.textContent.trim();
      }
      if (!artist) {
        const ymArtist = document.querySelector('.track__artists');
        if (ymArtist) artist = ymArtist.textContent.trim();
      }
      if (!artwork) {
        const ymArt = document.querySelector('.track-cover img');
        if (ymArt && ymArt.src) artwork = ymArt.src;
      }
    }
    // VKontakte
    else if (host.includes('vk.com')) {
      if (!title) {
        const vkTitle = document.querySelector('.top_audio_player_title, .audio_page_player_title');
        if (vkTitle) title = vkTitle.textContent.trim();
      }
      if (!artist) {
        const vkArtist = document.querySelector('.top_audio_player_performer, .audio_page_player_performer');
        if (vkArtist) artist = vkArtist.textContent.trim();
      }
    }

    // Generic fallback for title from document.title if media is playing or exists
    if (!title && (isPlaying || (activeEl && (activeEl.duration > 0 || activeEl.currentTime > 0)))) {
      title = document.title
        .replace(/ - YouTube$/, '')
        .replace(/ \| SoundCloud$/, '')
        .replace(/ - Spotify$/, '')
        .trim();
    }

    // Fallback artist from hostname
    if (!artist && title) {
      if (host.includes('youtube.com')) artist = 'YouTube';
      else if (host.includes('soundcloud.com')) artist = 'SoundCloud';
      else if (host.includes('spotify.com')) artist = 'Spotify';
      else artist = host.replace(/^www\./, '');
    }

    // Fallback artwork from og:image
    if (!artwork && title) {
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg && ogImg.content) artwork = ogImg.content;
    }

    const hasMedia = !!(title || isPlaying || (activeEl && activeEl.duration > 0));

    return {
      hasMedia,
      title,
      artist,
      album,
      artwork,
      isPlaying,
      currentTime: Math.round(currentTime),
      duration: Math.round(duration),
      hostname: host,
      url: location.href
    };
  }

  function reportMediaState() {
    try {
      const data = extractMediaData();
      if (!data.hasMedia && (!lastSentState || !lastSentState.hasMedia)) {
        return;
      }
      lastSentState = data;
      window.postMessage({
        source: 'OLED_TAB_MEDIA_MAIN',
        payload: data
      }, '*');
    } catch (e) {}
  }

  // Periodic poll to keep state and time synchronized
  setInterval(reportMediaState, 2000);

  // Command handlers
  function clickButtonBySelectors(selectors) {
    for (const s of selectors) {
      const btn = document.querySelector(s);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  function handleCommand(action, payload) {
    const activeEl = getActiveMediaElement();

    switch (action) {
      case 'toggle_play':
        if (lastSentState && lastSentState.isPlaying) {
          handleCommand('pause', payload);
        } else {
          handleCommand('play', payload);
        }
        break;

      case 'play':
        if (capturedHandlers['play']) {
          try { capturedHandlers['play']({ action: 'play' }); } catch (e) {}
        } else if (activeEl) {
          activeEl.play().catch(() => {});
        } else {
          clickButtonBySelectors([
            '.ytp-play-button',
            '[data-testid="control-button-playpause"]',
            '.playControl',
            '.player-controls__btn_play',
            '.top_audio_player_play',
            'button[aria-label="Play"]',
            'button[title="Play"]',
            'button[aria-label="Воспроизвести"]'
          ]);
        }
        break;

      case 'pause':
        if (capturedHandlers['pause']) {
          try { capturedHandlers['pause']({ action: 'pause' }); } catch (e) {}
        } else if (activeEl) {
          activeEl.pause();
        } else {
          clickButtonBySelectors([
            '.ytp-play-button',
            '[data-testid="control-button-playpause"]',
            '.playControl',
            '.player-controls__btn_play',
            '.top_audio_player_play',
            'button[aria-label="Pause"]',
            'button[title="Pause"]',
            'button[aria-label="Пауза"]'
          ]);
        }
        break;

      case 'nexttrack':
        if (capturedHandlers['nexttrack']) {
          try { capturedHandlers['nexttrack']({ action: 'nexttrack' }); } catch (e) {}
        } else {
          clickButtonBySelectors([
            '.ytp-next-button',
            '[data-testid="control-button-skip-forward"]',
            '.skipControl__next',
            '.player-controls__btn_next',
            '.top_audio_player_next',
            'button[aria-label="Next"]',
            'button[title="Next"]',
            'button[aria-label="Следующий"]'
          ]);
        }
        break;

      case 'previoustrack':
        if (capturedHandlers['previoustrack']) {
          try { capturedHandlers['previoustrack']({ action: 'previoustrack' }); } catch (e) {}
        } else if (activeEl && activeEl.currentTime > 3) {
          activeEl.currentTime = 0;
        } else {
          clickButtonBySelectors([
            '.ytp-prev-button',
            '[data-testid="control-button-skip-back"]',
            '.skipControl__previous',
            '.player-controls__btn_prev',
            '.top_audio_player_prev',
            'button[aria-label="Previous"]',
            'button[title="Previous"]',
            'button[aria-label="Предыдущий"]'
          ]);
        }
        break;

      case 'seekto':
        if (payload && typeof payload.time === 'number') {
          if (capturedHandlers['seekto']) {
            try { capturedHandlers['seekto']({ seekTime: payload.time, fastSeek: false }); } catch (e) {}
          } else if (activeEl) {
            activeEl.currentTime = payload.time;
          }
        }
        break;

      case 'request_state':
        reportMediaState();
        break;
    }

    setTimeout(reportMediaState, 200);
  }

  // Listen to messages from isolated world
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'OLED_TAB_MEDIA_CMD') return;
    handleCommand(event.data.action, event.data.payload);
  });

  // Initial detection
  setTimeout(reportMediaState, 200);
  window.addEventListener('DOMContentLoaded', reportMediaState);
  window.addEventListener('load', reportMediaState);
})();

