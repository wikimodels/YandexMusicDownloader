(function () {
  const rx = /(get-file-info|file-download-info|download-info|get-mp3|strm\.|master\.m3u8|music-v2)/i;

  function post(msg, extra) {
    try {
      const body = extra && extra.debugBody ? ' BODY=' + extra.debugBody : '';
      console.log('[YMD] capture', String(msg.url).slice(0, 120), extra && extra.src ? 'SRC=' + extra.src.slice(0, 80) : '', extra && extra.key ? 'KEY=yes' : '', body);
      window.postMessage(
        {
          source: 'YMD_CAPTURE',
          url: String(msg.url),
          src: extra && extra.src,
          codec: extra && extra.codec,
          key: extra && extra.key,
          trackId: extra && extra.trackId,
          headers: extra && extra.headers,
          debugBody: extra && extra.debugBody
        },
        '*'
      );
    } catch (e) {}
  }

  function pickHeaders(init) {
    try {
      if (!init) return null;
      let h = init.headers;
      if (!h) return null;
      if (h instanceof Headers) h = Object.fromEntries(h.entries());
      if (typeof h === 'string') return null;
      const out = {};
      const want = ['X-Yandex-Music-Client', 'X-Retpath-Y', 'X-Requested-With', 'Origin', 'Referer'];
      const keys = Object.keys(h);
      for (const w of want) {
        const hit = keys.find((k) => k.toLowerCase() === w.toLowerCase());
        if (hit) out[w] = h[hit];
      }
      return Object.keys(out).length ? out : null;
    } catch (e) {
      return null;
    }
  }

  function listFromJson(j) {
    try {
      if (!j) return [];
      const out = [];
      const pushDl = (dl) => {
        if (!dl) return;
        const urls = Array.isArray(dl.urls) ? dl.urls : dl.src ? [dl.src] : [];
        if (urls.length) out.push({ trackId: dl.trackId || null, src: urls[0], codec: dl.codec || null, key: dl.key || null });
      };
      if (j.downloadInfo) pushDl(j.downloadInfo);
      if (Array.isArray(j.downloadInfos)) j.downloadInfos.forEach(pushDl);
      if (!out.length && j.src) out.push({ trackId: null, src: j.src, codec: j.codec || null, key: null });
      const res = j.results || j.result;
      if (!out.length && res && typeof res === 'object') {
        const entries = Array.isArray(res) ? res : Object.entries(res).map(([k, v]) => Object.assign({}, v, { __tid: k }));
        for (const e of entries) {
          const urls = Array.isArray(e.urls) ? e.urls : e.src ? [e.src] : [];
          if (urls.length) out.push({ trackId: e.__tid || e.trackId || null, src: urls[0], codec: e.codec || null, key: e.key || null });
        }
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  if (window.fetch) {
    const orig = window.fetch;
    window.fetch = function (input, init) {
      try {
        const u = typeof input === 'string' ? input : input && input.url;
        if (u && rx.test(u) && !/\/log\?/i.test(u)) {
          const headers = pickHeaders(init);
          const p = orig.apply(this, arguments);
          p.then((res) => {
            try {
              if (res && res.status >= 200 && res.status < 300) {
                res.clone().json().then((j) => {
                  const list = listFromJson(j);
                  if (list.length) {
                    for (const it of list) post({ url: u }, Object.assign({ headers }, it));
                  } else {
                    post({ url: u }, { debugBody: JSON.stringify(j).slice(0, 400) });
                  }
                }).catch(() => {
                  res.clone().text().then((t) => post({ url: u }, { debugBody: (t || '').slice(0, 400) })).catch(() => post({ url: u }));
                });
              } else {
                post({ url: u }, null);
              }
            } catch (e) {
              post({ url: u });
            }
          }).catch(() => post({ url: u }));
          return p;
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
  }

  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    const origOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      try {
        if (rx.test(String(url)) && !/\/log\?/i.test(String(url))) post({ url: String(url) });
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
  }
})();