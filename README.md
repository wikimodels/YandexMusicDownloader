# Yandex Music Downloader

MV3-расширение Chrome: добавляет кнопку скачивания AAC/MP3-треков на странице Яндекс Музыки
(music.yandex.ru / music.yandex.com). Извлекает поток из трафика страницы и сохраняет файл
с именем «Исполнитель - Название.ext» в папку Загрузки.

## Архитектура (три контекста)

| Файл | Контекст | Роль |
|---|---|---|
| `inject-main.js` | MAIN world, `document_start` | Перехватывает `window.fetch`/`XMLHttpRequest` на URL-ы, подходящие под `rx` (`get-file-info`, `strm.`, `music-v2` и т.д.), и вытаскивает из JSON-ответа `src` (прямой CDN-URL) и `key` (ключ AES). Отправляет данные в content script через `window.postMessage` (`YMD_CAPTURE`). Также принимает байты на скачивание (`YMD_DL`) и запускает загрузку через `<a download>`. |
| `content.js` | Isolated world, `document_idle` | Мост между страницей и сервис-воркером: слушает `window` messages от MAIN-мира и `chrome.runtime.onMessage` от SW (`dl-blob`), продолжает `YMD_CAPTURE` в SW (кэширует src/key по треку). Не имеет доступа к `chrome.downloads`. |
| `background.js` | Service worker | Обработка очереди скачивания: `handleDownload` определяет `cached=src` и делает `fetch` crypt-потока `ext-strm-*.strm.yandex.net/music-v2/crypt/...`, дешифрует AES-CTR ключом `key` (извлечённым из перехвата), затем инициирует сохранение через вкладку. Диагностика пишется в `logs/ymd.log` двумя путями: `saveLogToFile()` — напрямую в файл (работает только в режиме разработчика браузера, иначе молча игнорируется), а `log()` — через localhost-сервер. |

`md5.js` — реализация MD5 (используется для подписи параметров, если нужна).

### Сеть между SW и страницей

- SW → content script: `chrome.tabs.sendMessage(tabId, {type: 'dl-blob', data: ArrayBuffer, mime, filename})` с колбэком.
- content script → SW: `chrome.runtime.sendMessage({type: 'capture', ...})` → SW кэширует
  `pendingCaptures[trackId] = {src, key, codec}` → content script `{type:'get-capture', trackId}`.
- content script → страница (MAIN): `window.postMessage({source: 'YMD_DL', data, mime, filename}, '*')`.

## Поток скачивания

1. Пользователь жмёт кнопку → content script берёт id трека, шлёт `get-capture`.
2. SW: `handleDownload` → если `cached=src`: `fetch(stream)` 200 → `decrypt AES-CTR` → Blob.
3. SW просит content script сделать `pageDownloadBlob(tabId, buffer, mime, filename)`.
4. content script ретранслирует байты в MAIN-мир (`YMD_DL`).
5. `inject-main.js`: `new Blob([data])` → `URL.createObjectURL` → `<a href=blobURL download="Исполнитель - Название.m4a">.click()` → revoke через 6 мин.
6. Браузер сам сохраняет в Загрузки с указанным именем (конфликты → «(1)»).

## Грабли (проверено экспериментально, не повторять) — главное для будущих доработок

Как НЕЛЬЗЯ скачивать расширением из SW-схемы и почему:

1. **`data:` URL + `chrome.downloads.download({filename})`** → Chrome игнорирует `filename`
   для data:-URL (crbug 174799) и сохраняет как `download.m4a`. Коварно тем, что не выдаёт никакой ошибки.
2. **Blob-URL, созданный в service worker** → в SW нет `URL.createObjectURL`
   (`URL.createObjectURL is not a function`).
3. **`chrome.downloads` из content script** → `chrome.downloads` недоступен в isolated world
   (`Cannot read properties of undefined (reading 'download')`). API есть только в SW/extension-страницах.
4. **Blob-URL вкладки + `downloads.download` из SW** → работает, но имя всё равно игнорируется:
   blob-URL кросс-происхождения для SW → файл сохраняется под UUID blob-URL (`960a94ba-….m4a`).
5. **`<a download>` с программным кликом** → для `blob:`-URL **работает** без
   user gesture (тихое сохранение, без prompts); атрибут уважается только при
   совпадении origin (это и есть решение).

Решение: **инициировать загрузку в MAIN-мире страницы (инъекция) через `<a download>`** —
blob имеет origin страницы, атрибут применяется, имя сохраняется. Ограничение:
подпапка в `download`-атрибуте не создаётся (файл падает в корень Загрузок).

## Примечания по Yandex API

- `https://api.music.yandex.com/get-file-info?...` (получение подписанного URL) часто
  возвращает `HTTP 403` (geo/aqua). Это штатная ситуация: рабочий фолбэк — использовать
  `src` из перехваченного трафика (`cached=src`), расширение на это заточено.
- Поток `music-v2/crypt/...` — MPEG-4 с AES-CTR шифрованием; без `key` из перехвата
  (поле `key=yes` в логе) декод невозможен.

## Логи

`logs/ymd.log` — единственный источник диагностики. Механизм:
`log()` (SW) → `fetch('http://127.0.0.1:8976/append')` — работает, только если запущен помощник:

```
node server.js
```

Папка `logs/` в корне репо содержит хвост лога с реальными прогонами (искать
`download started`, `fetch/decrypt FAILED`, `page download FAILED`, `player-sign refresh FAIL`).

## Установка

1. `chrome://extensions` → «Режим разработчика» → «Загрузить распакованное» → выбрать папку.
2. Открыть music.yandex.ru/com, **Ctrl+Shift+R** (после любого обновления расширения) —
   кнопка появляется вместе с инжектом MAIN-мира.
3. (Опционально) `node server.js` для лога.