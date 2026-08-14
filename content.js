(function () {
  const VERSION = '0.8.0';
  const TRACK_RE = /\/album\/(\d+)\/track\/(\d+)/;
  const SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 4v11M7.5 11.5 12 16l4.5-4.5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function ylog(...a) {
    try {
      console.log('[YMD]', a.map((x) => (typeof x === 'string' ? x : x && x.message ? x.message : JSON.stringify(x))).join(' '));
    } catch (e) {}
  }

  window.addEventListener('error', (e) => ylog('window.onerror:', e.message, 'at', e.filename + ':' + e.lineno));

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'api-fetch') return;
    fetch(msg.url, { credentials: 'include', headers: msg.headers || {} })
      .then(async (res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const data = ct.includes('json') ? await res.json() : await res.text();
        sendResponse({ ok: true, data });
      })
      .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'YMD_CAPTURE' || !d.url) return;
    ylog('capture post', d.url.slice(0, 110), d.src ? 'SRC=' + d.src.slice(0, 80) : '', d.key ? 'KEY=yes' : '', d.debugBody ? 'BODY=' + d.debugBody : '');
    try {
      chrome.runtime.sendMessage({ type: 'capture', url: d.url, src: d.src, codec: d.codec, key: d.key, trackId: d.trackId, headers: d.headers, debugBody: d.debugBody }).catch(() => {});
    } catch (err) {
      ylog('capture send ERROR:', err.message);
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'dl-progress') return;
    dlUi.update(msg);
    return false;
  });

  const style = document.createElement('style');
  style.id = 'ymd-style';
  style.textContent =
    '.ymd-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;margin:0 4px;border:none;border-radius:50%;background:transparent;color:currentColor;cursor:pointer}' +
    '.ymd-btn:hover{background:rgba(128,128,128,.25)}' +
    '.ymd-btn[disabled]{cursor:default;opacity:.5}' +
    '.ymd-btn.busy svg{display:none}' +
    '.ymd-btn.busy::before{content:"..."}' +
    '.ymd-btn.error{color:#e04444}' +
    '.ymd-dl{position:fixed;right:12px;top:12px;z-index:2147483646;width:340px;background:linear-gradient(160deg,rgba(28,32,48,.97),rgba(16,18,28,.97));border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px 16px;color:#e8eaf0;font:13px/1.5 system-ui,sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.6);display:none;box-sizing:border-box}' +
    '.ymd-dl .hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-weight:700;font-size:13px;letter-spacing:.02em;color:#ffd43b}' +
    '.ymd-dl .x{cursor:pointer;border:none;background:none;color:#9aa0b0;font:16px/1 monospace;padding:0 2px}' +
    '.ymd-dl .x:hover{color:#fff}' +
    '.ymd-dl .tt{font-size:14px;font-weight:600;line-height:1.35;word-break:break-word}' +
    '.ymd-dl .ar{color:#9aa0b0;font-size:12px;margin-top:2px}' +
    '.ymd-dl .meta{color:#6f7689;font-size:11px;margin-top:8px}' +
    '.ymd-dl .trk{height:6px;border-radius:3px;background:rgba(255,255,255,.08);margin:12px 0 8px;overflow:hidden}' +
    '.ymd-dl .bar{height:100%;width:0%;border-radius:3px;background:linear-gradient(90deg,#ffd43b,#ff922b);transition:width .25s ease}' +
    '.ymd-dl .row{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:#9aa0b0}' +
    '.ymd-dl .pct{font-weight:700;color:#ffd43b;font-variant-numeric:tabular-nums}' +
    '.ymd-dl.ok .st{color:#69db7c}' +
    '.ymd-dl.err .st{color:#ff6b6b}' +
    '.ymd-dl .tm{margin-top:6px;display:flex;justify-content:space-between;font-size:11px;color:#6f7689;font-variant-numeric:tabular-nums}' +
    '.ymd-dl .st{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}' +
    '.ymd-dl .main{display:flex;gap:12px;align-items:center;margin-bottom:10px}' +
    '.ymd-dl .cov{flex:none}' +
    '.ymd-dl .cov img{width:64px;height:64px;border-radius:10px;object-fit:cover;display:block;background:rgba(255,255,255,.06);box-shadow:0 2px 10px rgba(0,0,0,.35)}' +
    '.ymd-dl .info{flex:1;min-width:0}' +
    '.ymd-dl .tt{font-size:14px;font-weight:600;line-height:1.35;word-break:break-word}' +
    '.ymd-dl .ar{color:#9aa0b0;font-size:12px;margin-top:2px}';
  (document.head || document.documentElement).appendChild(style);

  const dlUi = (function () {
    let root = null;
    let timer = null;
    let startTs = 0;
    let lastElapsed = 0;
    const els = {};
    function build() {
      root = document.createElement('div');
      root.className = 'ymd-dl';
      root.innerHTML =
        '<div class="hdr"><span>Download</span><button type="button" class="x" title="Hide">✕</button></div>' +
        '<div class="main"><div class="cov"><img alt="" loading="lazy"></div><div class="info">' +
        '<div class="tt"></div>' +
        '<div class="ar"></div>' +
        '</div></div>' +
        '<div class="meta"></div>' +
        '<div class="trk"><div class="bar"></div></div>' +
        '<div class="row"><span class="pct">0%</span><span class="st">Requesting link…</span></div>' +
        '<div class="tm"><span class="tm-el">⏱ 0:00</span><span class="tm-eta"></span></div>';
      root.querySelector('.x').addEventListener('click', () => hide());
      Object.assign(els, {
        cov: root.querySelector('.cov'),
        covImg: root.querySelector('.cov img'),
        tt: root.querySelector('.tt'),
        ar: root.querySelector('.ar'),
        meta: root.querySelector('.meta'),
        bar: root.querySelector('.bar'),
        pct: root.querySelector('.pct'),
        st: root.querySelector('.st'),
        tmEl: root.querySelector('.tm-el'),
        tmEta: root.querySelector('.tm-eta')
      });
      document.documentElement.appendChild(root);
    }
    function fmt(sec) {
      sec = Math.max(0, Math.floor(sec));
      return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }
    function tick() {
      if (!root) return;
      lastElapsed = (Date.now() - startTs) / 1000;
      els.tmEl.textContent = '⏱ ' + fmt(lastElapsed);
    }
    function show(st) {
      if (!root) build();
      root.classList.remove('ok', 'err');
      root.style.display = 'block';
      els.tt.textContent = st.title || 'Untitled';
      els.ar.textContent = st.artists || '';
      if (st.cover) {
        const up = st.cover.replace(/M\d+x\d+/, '200x200').replace(/[\/_](\d+x\d+)([.\/?#]|$)/, '/200x200$2');
        els.covImg.onerror = () => { els.cov.style.display = 'none'; };
        els.covImg.src = up;
        els.cov.style.display = 'block';
      } else {
        els.covImg.removeAttribute('src');
        els.cov.style.display = 'none';
      }
      els.meta.textContent = 'AAC 192 · ' + (st.artists ? st.artists + ' - ' : '') + (st.title || '') + '.m4a';
      els.bar.style.width = '0%';
      els.pct.textContent = '0%';
      els.st.textContent = 'Requesting link…';
      els.tmEta.textContent = '';
      startTs = Date.now();
      tick();
      if (timer) clearInterval(timer);
      timer = setInterval(tick, 1000);
    }
    function update(p) {
      if (!root || root.style.display === 'none') return;
      if (p.phase === 'meta') {
        const codec = String(p.codec || '').toLowerCase();
        const label = codec.includes('mp3') ? 'MP3' : codec.includes('flac') ? 'FLAC' : 'AAC 192';
        const ext = codec.includes('mp3') ? 'mp3' : codec.includes('flac') ? 'flac' : 'm4a';
        const name = (els.meta.textContent.split('·')[1] || '').trim();
        els.meta.textContent = label + ' · ' + name;
      }
      if (p.phase === 'fetch') {
        const pct = p.total > 0 ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
        els.bar.style.width = pct + '%';
        els.pct.textContent = pct + '%';
        els.st.textContent = 'Downloading stream…';
        if (p.total > 0 && p.received > 0 && lastElapsed > 3) {
          const left = ((p.total - p.received) / p.received) * lastElapsed;
          els.tmEta.textContent = '~' + fmt(left) + ' left';
        }
      }
      if (p.phase === 'decrypt') {
        els.bar.style.width = '100%';
        els.pct.textContent = '100%';
        els.st.textContent = 'Decrypting…';
      }
      if (p.phase === 'encode') {
        els.st.textContent = 'Preparing file…';
      }
      if (p.phase === 'download') {
        els.st.textContent = 'Saving file…';
      }
    }
    function finish(ok, filename, error) {
      if (!root) return;
      root.classList.toggle('ok', ok);
      root.classList.toggle('err', !ok);
      els.bar.style.width = ok ? '100%' : '0%';
      els.pct.textContent = ok ? '✓' : '—';
      els.st.textContent = ok ? 'Saved: ' + (filename || '') : 'Error: ' + (error || '');
      if (ok) els.tmEta.textContent = 'done in ' + fmt(lastElapsed);
      if (timer) clearInterval(timer);
      timer = setTimeout(() => hide(), ok ? 5000 : 8000);
    }
    function hide() {
      if (timer) clearInterval(timer);
      timer = null;
      if (root) root.style.display = 'none';
    }
    return { show, update, finish, hide };
  })();

  function setButtonState(btn, mode, title) {
    btn.classList.remove('busy', 'error');
    if (mode === 'busy') btn.classList.add('busy');
    if (mode === 'error') btn.classList.add('error');
    btn.title = title;
  }

  function sendDownloadMsg(payload) {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ ok: false, error: 'timeout 90s: worker did not respond' });
      }, 90000);
      try {
        chrome.runtime.sendMessage(payload, (r) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          let err = null;
          if (chrome.runtime.lastError) err = chrome.runtime.lastError.message;
          resolve(r || { ok: false, error: err || 'empty worker response' });
        });
      } catch (err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: err.message || String(err) });
      }
    });
  }

  async function downloadTrack(btn, st) {
    if (st.busy) return;
    st.busy = true;
    btn.disabled = true;
    setButtonState(btn, 'busy', 'Downloading...');
    ylog('click download trackId=' + st.trackId, 'albumId=' + st.albumId, 'origin=' + location.origin);
    dlUi.show(st);
    try {
      const res = await sendDownloadMsg({
        type: 'download',
        trackId: st.trackId,
        albumId: st.albumId,
        origin: location.origin,
        pageUrl: location.href,
        title: st.title,
        artists: st.artists
      });
      ylog('download result:', res && res.ok ? 'OK id=' + res.id + ' file=' + res.filename : JSON.stringify(res));
      if (!res || !res.ok) {
        dlUi.finish(false, null, res && res.error ? res.error : 'download failed');
        throw new Error(res && res.error ? res.error : 'download failed');
      }
      dlUi.finish(true, res.filename);
      setButtonState(btn, null, 'Download AAC');
    } catch (err) {
      setButtonState(btn, 'error', 'Error: ' + err.message);
      ylog('download ERROR:', err.message);
      setTimeout(() => setButtonState(btn, null, 'Download AAC'), 5000);
    } finally {
      st.busy = false;
      btn.disabled = false;
    }
  }

  function processRow(row, trackId, albumId, title) {
    if (row.querySelector('.ymd-btn')) return;
    const bar = row.querySelector('[class*="CommonControlsBar_controls"]') || row;
    const artists = ((row.querySelector('[class*="Meta_artists"]') || {}).textContent || '').trim();
    let cover = '';
    try {
      const img = row.querySelector('img[src*="avatars.yandex"], img[src*="get-music-content"], img[src*="music-player"]');
      if (img) cover = img.currentSrc || img.src || '';
    } catch (e) {}
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ymd-btn';
    btn.innerHTML = SVG;
    setButtonState(btn, null, 'Download AAC');
    const st = { trackId, albumId, title, artists, cover, busy: false };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadTrack(btn, st);
    });
    for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      btn.addEventListener(ev, (e) => e.stopPropagation());
    }
    bar.prepend(btn);
  }

  function scan() {
    document.querySelectorAll('a[href*="/track/"]').forEach((a) => {
      const m = (a.getAttribute('href') || '').match(TRACK_RE);
      if (!m) return;
      const row = a.closest('[class*="CommonTrack_root"]');
      if (!row) return;
      processRow(row, m[2], m[1], (a.textContent || '').trim());
    });
  }

  let scheduled = false;
  const mo = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  });
  try {
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  scan();
  setInterval(scan, 3000);

  ylog('content.js v' + VERSION + ' loaded, origin=' + location.origin);
})();