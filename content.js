(function () {
  const VERSION = '0.9.0';
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

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'dl-blob') {
      try {
        const blob = new Blob([msg.data], { type: msg.mime || 'audio/mp4' });
        const u = URL.createObjectURL(blob);
        setTimeout(() => URL.revokeObjectURL(u), 6 * 60 * 1000);
        ylog('blob url created', u.slice(0, 30), 'bytes=' + blob.size);
        sendResponse({ ok: true, blobUrl: u });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
      return true;
    }
    if (msg.type === 'dl-blob-revoke') {
      try { URL.revokeObjectURL(msg.url); } catch (e) {}
      return false;
    }
  });

  const style = document.createElement('style');
  style.id = 'ymd-style';
  style.textContent =
    '.ymd-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;margin:0 4px;border:none;border-radius:50%;background:transparent;color:currentColor;cursor:pointer}' +
    '.ymd-btn:hover{background:rgba(128,128,128,.25)}' +
    '.ymd-btn[disabled]{cursor:default;opacity:.5}' +
    '.ymd-btn.busy svg{display:none}' +
    '.ymd-btn.busy::before{content:"..."}' +
    '.ymd-btn.error{color:#e04444}' +
    '.ymd-btn.dl{color:#ffd43b}' +
    '.ymd-btn.dl:hover{background:rgba(255,212,59,.15)}' +
    '.ymd-dl .q{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.07);display:none;max-height:132px;overflow-y:auto}' +
    '.ymd-dl .q-i{display:flex;align-items:center;gap:6px;font-size:11px;line-height:1.5;color:#9aa0b0;white-space:nowrap;padding:2px 4px;border-radius:6px}' +
    '.ymd-dl .q-i.cur{color:#ffd43b;background:rgba(255,212,59,.08)}' +
    '.ymd-dl .q-cov{width:24px;height:24px;border-radius:5px;object-fit:cover;flex:none;background:rgba(255,255,255,.08)}' +
    '.ymd-dl .q-st{flex:none;width:14px;text-align:center;color:#6f7689}' +
    '.ymd-dl .q-tx{overflow:hidden;text-overflow:ellipsis}' +
    '.ymd-dl .q-i.ok{color:#69db7c}' +
    '.ymd-dl .q-i.err{color:#ff6b6b}' +
    '.ymd-dl .qct{color:#ffd43b;font-weight:700;margin-left:4px}' +
    '.ymd-dl .stop{margin-left:auto;border:1px solid rgba(255,107,107,.5);border-radius:8px;background:rgba(255,107,107,.12);color:#ff6b6b;font:600 12px/1 system-ui,sans-serif;padding:6px 10px;cursor:pointer;display:none}' +
    '.ymd-dl .stop:hover{background:rgba(255,107,107,.22)}' +
    '.ymd-dl .q-i.stopped{color:#6f7689}' +
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
    let stopCb = null;
    function build() {
      root = document.createElement('div');
      root.className = 'ymd-dl';
      root.innerHTML =
        '<div class="hdr"><span>Download<span class="qct"></span></span><button type="button" class="stop" title="Stop downloads">⏹ Stop</button><button type="button" class="x" title="Hide">✕</button></div>' +
        '<div class="main"><div class="cov"><img alt="" loading="lazy"></div><div class="info">' +
        '<div class="tt"></div>' +
        '<div class="ar"></div>' +
        '</div></div>' +
        '<div class="meta"></div>' +
        '<div class="trk"><div class="bar"></div></div>' +
        '<div class="row"><span class="pct">0%</span><span class="st">Requesting link…</span></div>' +
        '<div class="tm"><span class="tm-el">⏱ 0:00</span><span class="tm-eta"></span></div>' +
        '<div class="q"></div>';
      root.querySelector('.x').addEventListener('click', () => hide());
      root.querySelector('.stop').addEventListener('click', () => { if (stopCb) stopCb(); });
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
        tmEta: root.querySelector('.tm-eta'),
        qct: root.querySelector('.qct'),
        q: root.querySelector('.q'),
        stop: root.querySelector('.stop')
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
    function show(st, pos, total) {
      if (!root) build();
      root.classList.remove('ok', 'err');
      root.style.display = 'block';
      els.qct.textContent = total > 1 ? ' ' + pos + '/' + total : '';
      els.q.style.display = 'none';
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
    function finish(ok, filename, error, keepOpen) {
      if (!root) return;
      const isStopped = error === 'stopped';
      root.classList.toggle('ok', ok);
      root.classList.toggle('err', !ok && !isStopped);
      els.bar.style.width = ok ? '100%' : '0%';
      els.pct.textContent = ok ? '✓' : isStopped ? '◼' : '—';
      els.st.textContent = ok ? 'Saved: ' + (filename || '') : isStopped ? 'Stopped' : 'Error: ' + (error || '');
      if (ok) els.tmEta.textContent = 'done in ' + fmt(lastElapsed);
      if (timer) clearInterval(timer);
      timer = keepOpen ? null : setTimeout(() => hide(), ok ? 5000 : 8000);
    }
    function setQueue(list) {
      if (!root) return;
      const q = els.q;
      const show = list.length > 1;
      q.style.display = show ? 'block' : 'none';
      if (!show) {
        q.innerHTML = '';
        return;
      }
      q.innerHTML = '';
      for (const it of list) {
        const row = document.createElement('div');
        row.className = 'q-i ' + (it.status === 'dl' ? 'cur' : it.status === 'ok' ? 'ok' : it.status === 'err' ? 'err' : it.status === 'stopped' ? 'stopped' : '');
        let img = null;
        if (it.cover) {
          img = document.createElement('img');
          img.className = 'q-cov';
          img.loading = 'lazy';
          img.onerror = () => { img.style.display = 'none'; };
          img.src = it.cover.replace(/M\d+x\d+/, '96x96').replace(/[\/_](\d+x\d+)([.\/?#]|$)/, '/96x96$2');
        }
        const stE = document.createElement('span');
        stE.className = 'q-st';
        stE.textContent = it.status === 'dl' ? '▸' : it.status === 'ok' ? '✓' : it.status === 'err' ? '✗' : it.status === 'stopped' ? '◼' : '#';
        const tx = document.createElement('span');
        tx.className = 'q-tx';
        const nm = (it.artists ? it.artists + ' - ' : '') + it.title;
        tx.title = nm;
        tx.textContent = nm;
        if (img) row.appendChild(img);
        row.appendChild(stE);
        row.appendChild(tx);
        q.appendChild(row);
      }
    }
    function hide() {
      if (timer) clearInterval(timer);
      timer = null;
      if (root) root.style.display = 'none';
    }
    function setStop(v) {
      if (root) els.stop.style.display = v ? 'block' : 'none';
    }
    function onStop(cb) {
      stopCb = cb;
    }
    return { show, update, finish, hide, setQueue, setStop, onStop };
  })();

  dlUi.onStop(stopQueue);

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

  const queue = [];
  const doneLog = [];
  let current = null;
  let queueBusy = false;
  let stopRequested = false;

  function stopQueue() {
    stopRequested = true;
    for (const i of queue) {
      i.status = 'stopped';
      doneLog.push({ title: i.st.title, artists: i.st.artists, cover: i.st.cover, status: 'stopped' });
      setButtonState(i.btn, null, 'Download AAC');
      i.btn.disabled = false;
      i.st.busy = false;
    }
    queue.length = 0;
    try {
      chrome.runtime.sendMessage({ type: 'stop' }).catch(() => {});
    } catch (e) {}
    dlUi.setStop(false);
    updateQueueList();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findPlayBtn(row) {
    const sels = [
      'button[class*="PlayButton"]',
      'button[class*="playButton"]',
      '.d-track__play',
      '.track__play',
      '[class*="PlayButton"]'
    ];
    for (const s of sels) {
      const el = row.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function clickBtn(el) {
    try {
      el.click();
    } catch (e) {
      ylog('clickBtn error:', e.message);
    }
  }

  function waitCapture(trackId, ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (Date.now() - t0 > ms) {
          clearInterval(iv);
          resolve(false);
          return;
        }
        try {
          chrome.runtime.sendMessage({ type: 'get-capture', trackId: String(trackId) }, (r) => {
            if (r && r.captured) {
              clearInterval(iv);
              resolve(true);
            } else if (chrome.runtime.lastError) {
              clearInterval(iv);
              resolve(false);
            }
          });
        } catch (e) {
          clearInterval(iv);
          resolve(false);
        }
      }, 150);
    });
  }

  function updateQueueList() {
    const list = [];
    if (current) list.push({ title: current.st.title, artists: current.st.artists, cover: current.st.cover, status: 'dl' });
    for (const i of queue) list.push({ title: i.st.title, artists: i.st.artists, cover: i.st.cover, status: 'wait' });
    for (const d of doneLog.slice(-8)) list.push({ title: d.title, artists: d.artists, cover: d.cover, status: d.status });
    dlUi.setQueue(list);
  }

  function enqueueDownload(btn, st, row) {
    if (st.busy) return;
    if (current && current.st.trackId === st.trackId) return;
if (queue.some((i) => i.st.trackId === st.trackId)) {
      ylog('already queued, skip', st.trackId);
      return;
    }
    if (!queueBusy) doneLog.length = 0;
    queue.push({ btn, st, row, status: 'wait' });
    setButtonState(btn, null, 'In queue');
    updateQueueList();
    runQueue();
  }

  async function runQueue() {
    if (queueBusy) return;
    queueBusy = true;
    stopRequested = false;
    dlUi.setStop(true);
    while (queue.length) {
      const item = queue.shift();
      current = item;
      item.status = 'dl';
      item.st.busy = true;
      item.btn.disabled = true;
      item.btn.classList.add('dl');
      setButtonState(item.btn, 'busy', 'Downloading...');
      const total = doneLog.length + queue.length + 1;
      dlUi.show(item.st, doneLog.length + 1, total);
      updateQueueList();
      ylog('queue: trackId=' + item.st.trackId, 'albumId=' + item.st.albumId, 'remaining=' + queue.length);
      const pb = findPlayBtn(item.row);
      if (pb) {
        clickBtn(pb);
        const captured = await waitCapture(item.st.trackId, 7000);
        ylog('capture for trackId=' + item.st.trackId + ':', captured ? 'OK' : 'none');
        await sleep(250);
        clickBtn(pb);
      } else {
        ylog('no play button for trackId=' + item.st.trackId + ', relying on API fallback');
      }
      let res;
      try {
        res = await sendDownloadMsg({
          type: 'download',
          trackId: item.st.trackId,
          albumId: item.st.albumId,
          origin: location.origin,
          pageUrl: location.href,
          title: item.st.title,
          artists: item.st.artists
        });
      } catch (err) {
        res = { ok: false, error: err.message || String(err) };
      }
      ylog('download result:', res && res.ok ? 'OK ' + res.filename : JSON.stringify(res));
      const stopped = stopRequested || (res && res.error === 'stopped');
      if (res && res.ok) {
        item.status = 'ok';
        dlUi.finish(true, res.filename, null, queue.length > 0);
        setButtonState(item.btn, null, 'Download AAC');
        item.btn.classList.remove('dl');
      } else if (stopped) {
        item.status = 'stopped';
        dlUi.finish(false, null, 'stopped', queue.length > 0);
        setButtonState(item.btn, null, 'Download AAC');
        item.btn.classList.remove('dl');
      } else {
        item.status = 'err';
        dlUi.finish(false, null, (res && res.error) || 'download failed', queue.length > 0);
        setButtonState(item.btn, 'error', 'Error: ' + ((res && res.error) || 'download failed'));
        item.btn.classList.remove('dl');
        setTimeout(() => setButtonState(item.btn, null, 'Download AAC'), 5000);
      }
      doneLog.push({ title: item.st.title, artists: item.st.artists, cover: item.st.cover, status: item.status });
      if (doneLog.length > 40) doneLog.shift();
      item.st.busy = false;
      item.btn.disabled = false;
      current = null;
      updateQueueList();
      if (queue.length) await sleep(400);
    }
    queueBusy = false;
    stopRequested = false;
    dlUi.setStop(false);
  }

  function placeBtn(btn, row) {
    const playBtn = findPlayBtn(row);
    let cell = playBtn ? playBtn.closest('[class*="PlayButtonWithCover_root"], [class*="PlayButton_root"]') : null;
    if (!cell && playBtn) cell = playBtn.parentNode;
    if (cell && cell.parentNode) {
      if (btn.parentNode !== cell.parentNode || btn.previousSibling !== cell) {
        cell.parentNode.insertBefore(btn, cell.nextSibling);
      }
    } else {
      const bar = row.querySelector('[class*="CommonControlsBar_controls"]') || row;
      if (btn.parentNode !== bar || btn !== bar.firstChild) bar.prepend(btn);
    }
  }

  function processRow(row, trackId, albumId, title) {
    const artists = ((row.querySelector('[class*="Meta_artists"]') || {}).textContent || '').trim();
    let cover = '';
    try {
      const img = row.querySelector('img[src*="avatars.yandex"], img[src*="get-music-content"], img[src*="music-player"]');
      if (img) cover = img.currentSrc || img.src || '';
    } catch (e) {}
    let btn = row.querySelector('.ymd-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ymd-btn';
      btn.innerHTML = SVG;
      setButtonState(btn, null, 'Download AAC');
      const st = { trackId, albumId, title, artists, cover, busy: false };
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        enqueueDownload(btn, st, row);
      });
      for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        btn.addEventListener(ev, (e) => e.stopPropagation());
      }
    }
    placeBtn(btn, row);
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