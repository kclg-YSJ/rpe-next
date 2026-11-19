/*
 * Re:PhiEdit Next — Android save bridge.
 *
 * The editor exports charts and videos by creating an <a download href="blob:..."> and clicking it.
 * A WebView cannot save a blob: URL, so this shim intercepts those clicks, streams the blob to the
 * native side in chunks (RpenNativeSave), and shows the result.
 *
 * Loaded as a classic script before the editor module, and inert in a normal browser.
 */
(function () {
  'use strict';

  var api = window.RpenNativeSave;
  if (!api || typeof api.begin !== 'function') return;

  var CHUNK = 512 * 1024;

  function toBase64(bytes) {
    var parts = [];
    for (var offset = 0; offset < bytes.length; offset += 0x8000) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000)));
    }
    return btoa(parts.join(''));
  }

  function toast(message, failed) {
    var host = document.getElementById('rpen-android-toast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rpen-android-toast';
      host.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483647;'
        + 'max-width:78vw;padding:10px 16px;border-radius:8px;font:13px/1.5 system-ui,sans-serif;'
        + 'box-shadow:0 4px 18px #0009;pointer-events:none;transition:opacity .2s;white-space:pre-wrap';
      document.body.appendChild(host);
    }
    host.style.background = failed ? '#5c2222' : '#24402c';
    host.style.color = '#f2f2f2';
    host.style.opacity = '1';
    host.textContent = message;
    clearTimeout(host.__timer);
    host.__timer = setTimeout(function () { host.style.opacity = '0'; }, failed ? 6000 : 3500);
  }

  async function saveBlob(url, name) {
    var response = await fetch(url);
    var blob = await response.blob();
    var mime = blob.type || response.headers.get('content-type') || 'application/octet-stream';
    var token = api.begin(name, mime);
    if (!token || token.charAt(0) === '!') throw new Error(String(token || '无法开始保存').slice(1));
    try {
      for (var offset = 0; offset < blob.size; offset += CHUNK) {
        var slice = blob.slice(offset, Math.min(offset + CHUNK, blob.size));
        var bytes = new Uint8Array(await slice.arrayBuffer());
        if (!api.append(token, toBase64(bytes))) throw new Error('写入失败，存储空间可能不足');
      }
      var where = api.finish(token);
      if (where && where.charAt(0) === '!') throw new Error(where.slice(1));
      return where;
    } catch (error) {
      try { api.abort(token); } catch (ignored) { /* already finished */ }
      throw error;
    }
  }

  document.addEventListener('click', function (event) {
    var anchor = event.target instanceof Element ? event.target.closest('a[download]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href') || '';
    if (href.indexOf('blob:') !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var name = anchor.getAttribute('download') || 'rpe-next-export';
    saveBlob(href, name).catch(function (error) {
      console.error('[android-save]', error);
      toast('保存失败：' + (error && error.message ? error.message : error), true);
    });
  }, true);
})();
