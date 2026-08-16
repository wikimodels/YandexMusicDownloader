importScripts('md5.js');

const SECRET = 'XGRlBW9FXlekgbPrRHuSiA';
const captured = new Map();
let stopFlag = false;
const logBuf = [];
const MAX_LOG = 2000;
let sentIdx = 0;
let flushTimer = null;
const LOG_SERVER = 'http://127.0.0.1:8976/append';

function log(...a) {
  const line =
    '[' + new Date().toTimeString().slice(0, 8) + '] ' +
    a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  logBuf.push(line);
  if (logBuf.length > MAX_LOG) logBuf.splice(0, logBuf.length - MAX_LOG);
  try { console.log('[YMD]', ...a); } catch (e) {}
  scheduleFlush();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushLogs, 500);
}

function flushLogs() {
  flushTimer = null;
  if (sentIdx >= logBuf.length) return;
  const lines = logBuf.slice(sentIdx);
  sentIdx = logBuf.length;
  fetch(LOG_SERVER, { method: 'POST', body: lines.join('\n') }).catch(() => {});
}

function saveLogToFile(extra) {
  if (extra) log(extra);
  scheduleFlush();
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function mimeForCodec(codec) {
  const c = String(codec || '').toLowerCase();
  if (c === 'mp3') return 'audio/mpeg';
  if (c.includes('flac')) return 'audio/flac';
  return 'audio/mp4';
}

async function fetchToBlob(url, headers, keyHex, codec, tag, onProgress) {
  const r = await fetch(url, { credentials: 'include', headers });
  log('fetch[' + tag + ']', r.status, url.slice(0, 110));
  if (!r.ok) throw new Error('HTTP ' + r.status + ' (' + url.slice(0, 120) + ')');
  const total = parseInt(r.headers.get('content-length') || '0', 10) || 0;
  const reader = r.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    if (stopFlag) throw new Error('stopped');
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (onProgress) onProgress({ phase: 'fetch', received, total });
  }
  let buf = concatUint8(chunks, received);
  if (keyHex) {
    if (onProgress) onProgress({ phase: 'decrypt' });
    log('decrypt AES-CTR', 'bytes=' + buf.byteLength, 'key=' + keyHex);
    const raw = hexToBytes(keyHex);
    const ck = await crypto.subtle.importKey('raw', raw, { name: 'AES-CTR' }, false, ['decrypt']);
    buf = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CTR', counter: new Uint8Array(16), length: 32 }, ck, buf));
    log('decrypted', 'bytes=' + buf.byteLength);
  }
  if (onProgress) onProgress({ phase: 'encode' });
  return new Blob([buf], { type: mimeForCodec(codec) });
}

function concatUint8(chunks, total) {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

const pendingBlobs = new Map();
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
    const info = pendingBlobs.get(delta.id);
    if (info) {
      pendingBlobs.delete(delta.id);
      try {
        chrome.tabs.sendMessage(info.tabId, { type: 'dl-blob-revoke', url: info.url }).catch(() => {});
      } catch (e) {}
      log('blob url revoked', 'id=' + delta.id);
    }
  }
});

function pageCreateBlobUrl(tabId, buffer, mime) {
  return new Promise((resolve) => {
    if (tabId == null) return resolve(null);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'dl-blob', data: buffer, mime }, (r) => {
        if (chrome.runtime.lastError || !r || !r.ok) {
          log('page blob URL FAILED', chrome.runtime.lastError ? chrome.runtime.lastError.message : (r && r.error) || 'no reply');
          return resolve(null);
        }
        resolve(r.blobUrl);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'capture') {
    const id = msg.trackId || trackIdFromUrl(msg.url);
    if (msg.debugBody) log('capture BODY', msg.debugBody);
    log('capture', 'id=' + id, msg.src ? 'src=' + msg.src.slice(0, 110) : 'url=' + String(msg.url).slice(0, 110), 'key=' + (msg.key ? 'yes' : 'no'), 'headers=' + (msg.headers ? Object.keys(msg.headers).join(',') : '-'));
    if (id) {
      const entry = { headers: msg.headers };
      if (/get-file-info|file-download-info|download-info|strm\.|music-v2|crypt/i.test(String(msg.url))) entry.infoUrl = msg.url;
      if (msg.src) {
        entry.src = msg.src;
        entry.codec = msg.codec;
        entry.key = msg.key;
        if (!entry.infoUrl) entry.url = msg.url;
      } else {
        entry.url = msg.url;
      }
      captured.set(id, entry);
    }
    return;
  }
  if (msg.type === 'save-log') {
    saveLogToFile('[save-log] called from page');
    return;
  }
  if (msg.type === 'get-capture') {
    const c = msg.trackId ? captured.get(String(msg.trackId)) : null;
    sendResponse({ captured: !!(c && (c.src || c.url)) });
    return false;
  }
  if (msg.type === 'stop') {
    stopFlag = true;
    log('stop requested');
    return false;
  }
  if (msg.type === 'download') {
    const tabId = sender.tab && sender.tab.id;
    const prog = (p) => {
      if (tabId == null) return;
      try {
        chrome.tabs.sendMessage(tabId, Object.assign({ type: 'dl-progress' }, p)).catch(() => {});
      } catch (e) {}
    };
    stopFlag = false;
    log('download msg', 'trackId=' + msg.trackId, 'albumId=' + msg.albumId, 'origin=' + msg.origin, 'title=' + msg.title);
    handleDownload(msg)
      .then((res) => {
        log('download resolved', 'url=' + String(res.url).slice(0, 130), 'codec=' + res.codec, 'fetchFirst=' + !!res.fetchFirst);
        const c = (res.codec || 'mp3').toLowerCase();
        const ext =
          c === 'mp3' ? 'mp3' :
          c === 'flac' ? 'flac' :
          c === 'ogg' ? 'ogg' :
          (c.includes('aac') || c.includes('mp4') || c === 'opus') ? 'm4a' : 'mp3';
        const filename = sanitize((msg.artists ? msg.artists + ' - ' : '') + msg.title) + '.' + ext;
        saveLogToFile('[auto-save] download resolved');
        prog({ phase: 'meta', codec: res.codec });
        if (res.fetchFirst) {
          fetchToBlob(res.url, res.headers || {}, res.key || null, res.codec, 'stream', prog)
            .then(async (blob) => {
              if (stopFlag) {
                log('download aborted by user');
                sendResponse({ ok: false, error: 'stopped' });
                return;
              }
              const mime = blob.type || 'audio/mp4';
              const pageBuf = await blob.arrayBuffer();
              log('fetch done', 'bytes=' + pageBuf.byteLength);
              const blobUrl = await pageCreateBlobUrl(tabId, pageBuf, mime);
              if (!blobUrl) {
                sendResponse({ ok: false, error: 'failed to create blob in page' });
                return;
              }
              log('blob url ready', blobUrl.slice(0, 40));
              prog({ phase: 'download' });
              chrome.downloads.download(
                { url: blobUrl, filename: 'YandexMusic/' + filename, conflictAction: 'uniquify' },
                (downloadId) => {
                  if (chrome.runtime.lastError) {
                    log('downloads.download ERROR', chrome.runtime.lastError.message);
                    try {
                      chrome.tabs.sendMessage(tabId, { type: 'dl-blob-revoke', url: blobUrl }).catch(() => {});
                    } catch (e) {}
                    sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                  } else {
                    log('download started', 'id=' + downloadId, 'filename=' + filename);
                    pendingBlobs.set(downloadId, { url: blobUrl, tabId });
                    prog({ phase: 'done', filename });
                    sendResponse({ ok: true, id: downloadId, filename });
                  }
                }
              );
            })
            .catch((err) => {
              log('fetch/decrypt FAILED', (err && err.message) || String(err));
              sendResponse({ ok: false, error: (err && err.message) || String(err) });
            });
        } else {
          if (stopFlag) {
            log('download aborted by user');
            sendResponse({ ok: false, error: 'stopped' });
            return;
          }
          prog({ phase: 'download' });
          chrome.downloads.download(
            { url: res.url, filename: 'YandexMusic/' + filename, conflictAction: 'uniquify' },
            (downloadId) => {
              if (chrome.runtime.lastError) {
                log('downloads.download ERROR', chrome.runtime.lastError.message);
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
              } else {
                log('download started', 'id=' + downloadId, 'filename=' + filename);
                prog({ phase: 'done', filename });
                sendResponse({ ok: true, id: downloadId, filename });
              }
            }
          );
        }
      })
      .catch((err) => {
        log('download FAILED', (err && err.message) || String(err));
        sendResponse({ ok: false, error: (err && err.message) || String(err) });
        saveLogToFile('[auto-save] download FAILED');
      });
    return true;
  }
});

function sanitize(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'track';
}

function trackIdFromUrl(url) {
  const q = String(url).match(/[?&]track-?[Ii]d=(\d+)/);
  if (q) return q[1];
  const p = String(url).match(/file-download-info\/([^\/?]+?)\/preview/);
  if (p) {
    const parts = p[1].split('.');
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) return last;
  }
  const m = String(url).match(/\.(\d{6,})\/(?:aac|mp3|flac|hq|opus)/);
  if (m) return m[1];
  return null;
}

function fetchJson(url, headers) {
  return fetch(url, { credentials: 'include', headers }).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status + ' (' + url.slice(0, 120) + ')');
    return res.json();
  });
}

function asList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.result)) return data.result;
  if (data.src || data.downloadInfoUrl) return [data];
  return [];
}

function pickEntry(datas) {
  let items = datas;
  const full = items.filter((e) => e.preview === false || e.preview === undefined);
  if (full.length) items = full;
  const mp3 = items.filter((e) => e.codec && e.codec.toLowerCase() === 'mp3');
  const pool = (mp3.length ? mp3 : items).slice();
  pool.sort((a, b) => (b.bitrateInKbps || b.bitrate || 0) - (a.bitrateInKbps || a.bitrate || 0));
  return pool[0];
}

function buildDownloadUrl(trackId, fd) {
  const key = md5(SECRET + String(fd.path).slice(1) + (fd.s || ''));
  let base = fd.host;
  if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
  return base + '/get-mp3/' + key + '/' + fd.ts + fd.path + '?track-id=' + trackId;
}

function isStream(url) {
  return /strm\.yandex|music-v2|crypt/i.test(String(url));
}

async function resolveFromSrc(trackId, src, codec, headers) {
  if (!src) throw new Error('no source');
  if (/\/get-mp3\//.test(src)) {
    const u = /^https?:/i.test(src) ? src : /^\/\//.test(src) ? 'https:' + src : 'https://' + src;
    return { url: u, codec: codec || 'mp3', headers, key: null, fetchFirst: false };
  }
  if (/(get-file-info|music-v2|crypt)/i.test(src)) {
    log('resolve: get-file-info fetch', src.slice(0, 120));
    const fd = await fetchJson(src, headers);
    const info = extractFileInfoSrc(fd);
    if (info && info.url) return { url: info.url, codec: info.codec || codec || 'aac', headers, key: info.key || null, fetchFirst: isStream(info.url) || !!info.key };
    throw new Error('empty get-file-info response');
  }
  let u = src;
  if (/^\/\//.test(u)) u = 'https:' + u;
  if (!/^https?:/i.test(u)) u = 'https://' + u;
  const sep = u.indexOf('?') >= 0 ? '&' : '?';
  log('resolve: download-info fetch', u.slice(0, 120));
  const fd = await fetchJson(u + sep + 'format=json', Object.assign({}, headers, { 'X-Requested-With': 'XMLHttpRequest' }));
  if (!fd.host || !fd.path) throw new Error('invalid download-info response');
  const url = buildDownloadUrl(trackId, fd);
  return { url, codec: (codec || 'mp3').toLowerCase(), headers, key: null, fetchFirst: false };
}

function extractFileInfoSrc(j) {
  if (!j) return null;
  const dl = j.downloadInfo || (Array.isArray(j.downloadInfos) && j.downloadInfos[0]);
  const collect = (d) => {
    if (!d) return null;
    const urls = Array.isArray(d.urls) ? d.urls : d.src ? [d.src] : [];
    if (urls.length) return { url: urls[0], codec: d.codec || null, key: d.key || null };
    return null;
  };
  if (dl) {
    const hit = collect(dl);
    if (hit) return hit;
  }
  if (j.src) return { url: j.src, codec: j.codec || null, key: null };
  const res = j.results || j.result;
  if (res && typeof res === 'object') {
    const first = Array.isArray(res) ? res[0] : Object.values(res)[0];
    const hit = collect(first);
    if (hit) return hit;
  }
  return null;
}

async function tryApi(origin, msg) {
  const headers = {
    'X-Requested-With': 'XMLHttpRequest',
    'X-Retpath-Y': msg.pageUrl || origin
  };
  const base = origin + '/api/v2.1/handlers/track/';
  const urls = [];
  if (msg.albumId) {
    urls.push(base + msg.trackId + ':' + msg.albumId + '/web-album_track-track-track-main/download/m?hq=1');
    urls.push(base + msg.trackId + ':' + msg.albumId + '/web-album_track-track-track-main/download/m');
  }
  urls.push(base + msg.trackId + '/download/info?hq=1');
  urls.push(base + msg.trackId + '/download/info');
  let lastErr = new Error('no working API endpoints');
  for (const url of urls) {
    try {
      log('tryApi', url.slice(0, 130));
      const data = await fetchJson(url, headers);
      log('tryApi OK', url.slice(0, 130));
      const entry = pickEntry(asList(data));
      const src = srcUrl(entry);
      if (src) return resolveFromSrc(msg.trackId, src, entry.codec);
    } catch (e) {
      log('tryApi FAIL', url.slice(0, 130), '->', e.message);
      lastErr = e;
    }
  }
  throw lastErr;
}

function srcUrl(entry) {
  if (!entry) return null;
  if (entry.src) return entry.src;
  if (entry.downloadInfoUrl) return entry.downloadInfoUrl;
  return null;
}

function pageFetch(url, headers) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ url: ['https://music.yandex.ru/*', 'https://music.yandex.com/*'] }, (tabs) => {
        if (!tabs || !tabs.length) return resolve(undefined);
        const tab = tabs.find((t) => t.active) || tabs[0];
        try {
          chrome.tabs.sendMessage(tab.id, { type: 'api-fetch', url, headers }, (r) => {
            if (chrome.runtime.lastError || !r) return resolve(undefined);
            if (r.ok) return resolve(r.data);
            resolve({ __err: r.error || 'page fetch fail' });
          });
        } catch (e) {
          resolve(undefined);
        }
      });
    } catch (e) {
      resolve(undefined);
    }
  });
}

async function apiGetJson(url, headers) {
  const r = await pageFetch(url, headers);
  if (r && r.__err) throw new Error(r.__err);
  if (r === undefined) {
    log('SW fetch fallback', url.slice(0, 110));
    return fetchJson(url, headers);
  }
  if (typeof r === 'string') {
    try {
      return JSON.parse(r);
    } catch (e) {
      throw new Error('non-JSON response from page');
    }
  }
  return r;
}

async function handleDownload(msg) {
  const cached = captured.get(msg.trackId);
  log('handleDownload', 'trackId=' + msg.trackId, 'cached=' + (cached ? (cached.src ? 'src' : 'url') : 'NO'));
  if (cached && cached.infoUrl) {
    log('player-sign refresh', cached.infoUrl.slice(0, 120));
    try {
      const fd = await apiGetJson(cached.infoUrl, {});
      const info = extractFileInfoSrc(fd);
      if (info && info.url) return { url: info.url, codec: info.codec || 'aac', headers: {}, key: info.key || null, fetchFirst: isStream(info.url) || !!info.key };
      log('player-sign refresh: empty response');
    } catch (e) {
      log('player-sign refresh FAIL', e.message);
    }
  }
  const origins = [msg.origin || 'https://music.yandex.ru'];
  if (!/music\.yandex\.ru$/.test(origins[0])) origins.push('https://music.yandex.ru');
  let lastErr = null;
  if (cached) {
    try {
      if (cached.src) {
        log('using captured src', cached.src.slice(0, 130), 'key=' + (cached.key ? 'yes' : 'no'));
        return { url: cached.src, codec: cached.codec || 'aac', headers: cached.headers || {}, key: cached.key || null, fetchFirst: isStream(cached.src) || !!cached.key };
      }
      if (cached.url) {
        const headers = cached.headers || {};
        if (/(get-file-info|music-v2|crypt)/i.test(cached.url)) {
          log('using captured get-file-info url', cached.url.slice(0, 130));
          const fd = await fetchJson(cached.url, headers);
          const info = extractFileInfoSrc(fd);
          if (info && info.url) return { url: info.url, codec: info.codec || 'aac', headers, key: info.key || null, fetchFirst: isStream(info.url) || !!info.key };
          throw new Error('empty get-file-info response');
        }
        return await resolveFromSrc(msg.trackId, cached.url, 'mp3', headers);
      }
    } catch (e) {
      log('cached path FAILED', e.message);
      lastErr = e;
    }
  }
  for (const o of origins) {
    try {
      log('tryApi origin', o);
      return await tryApi(o, msg);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('failed to get link');
}