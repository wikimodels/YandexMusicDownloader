// Offscreen document: receives audio blobs from the service worker and
// saves them via chrome.downloads.download with a relative subfolder
// ("AIMusicTools/YandexMusic/..."), which a plain <a download> can't do —
// the browser sanitizes the attribute value down to the bare filename.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'blob-save') return;
  try {
    const url = URL.createObjectURL(msg.blob);
    chrome.downloads.download(
      { url: url, filename: 'AIMusicTools/YandexMusic/' + msg.filename, conflictAction: 'uniquify' },
      (id) => {
        URL.revokeObjectURL(url);
        if (chrome.runtime.lastError) {
          console.error('[YMD] offscreen save failed', chrome.runtime.lastError.message);
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, id: id, filename: msg.filename });
        }
      }
    );
  } catch (e) {
    sendResponse({ ok: false, error: String((e && e.message) || e) });
  }
  return true;
});