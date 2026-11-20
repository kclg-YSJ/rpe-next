package com.rpen.next;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Android host for the Re:PhiEdit Next web editor.
 *
 * Additions over the plain Capacitor shell:
 *  - RpenNativeSave: writes exports (JSON / RPE / PEZ / video) that the web editor hands to a
 *    blob: download anchor, which a WebView cannot save on its own.
 *  - Back button: closes the topmost dialog, otherwise returns to the chart library, and only
 *    exits the app from the library screen.
 */
public class MainActivity extends BridgeActivity {

    private final Map<String, PendingSave> saves = new HashMap<>();

    private static final class PendingSave {
        OutputStream stream;
        String name;
        Uri uri;
        File file;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            configureViewport(webView);
            webView.addJavascriptInterface(new FileBridge(), "RpenNativeSave");
        }
    }

    /**
     * The editor is a desktop UI and declares a 1280px layout width in its viewport meta.
     * Android WebView ignores that (and any other viewport meta) unless wide viewport support is
     * enabled, in which case it scales the page down to fit the screen instead of reflowing it.
     * Capacitor does not enable it, so without this the page lays out at device width and the
     * note timeline collapses to zero height on a phone.
     */
    private void configureViewport(WebView webView) {
        WebSettings settings = webView.getSettings();
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(function(){"
                        + "var dialog=document.querySelector('dialog[open]');"
                        + "if(dialog){dialog.close();return 'dialog';}"
                        + "var home=document.getElementById('home');"
                        + "var library=document.getElementById('library');"
                        + "if(home&&library&&home.hidden){library.click();return 'library';}"
                        + "return 'exit';"
                        + "})()",
                value -> {
                    if (value != null && value.contains("exit")) {
                        MainActivity.this.finish();
                    }
                });
    }

    private final class FileBridge {

        /** Opens a pending download and returns a token, or "!reason". */
        @JavascriptInterface
        public String begin(String name, String mime) {
            try {
                String safeName = sanitizeName(name);
                String safeMime = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
                PendingSave pending = new PendingSave();
                pending.name = safeName;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, safeMime);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/RePhiEditNext");
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return "!无法创建下载文件";
                    pending.uri = uri;
                    OutputStream raw = getContentResolver().openOutputStream(uri);
                    if (raw == null) {
                        getContentResolver().delete(uri, null, null);
                        return "!无法写入下载文件";
                    }
                    pending.stream = new BufferedOutputStream(raw, 1 << 16);
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "RePhiEditNext");
                    if (!dir.exists() && !dir.mkdirs()) return "!无法创建下载目录";
                    pending.file = new File(dir, safeName);
                    pending.stream = new BufferedOutputStream(new FileOutputStream(pending.file), 1 << 16);
                }
                String token = UUID.randomUUID().toString();
                saves.put(token, pending);
                return token;
            } catch (Exception error) {
                return "!" + error.getMessage();
            }
        }

        /** Appends one base64 chunk. Returns false when the stream is gone. */
        @JavascriptInterface
        public boolean append(String token, String base64) {
            PendingSave pending = saves.get(token);
            if (pending == null || pending.stream == null) return false;
            try {
                pending.stream.write(Base64.decode(base64, Base64.NO_WRAP));
                return true;
            } catch (Exception error) {
                return false;
            }
        }

        /** Closes the download and returns where it landed, or "!reason". */
        @JavascriptInterface
        public String finish(String token) {
            PendingSave pending = saves.remove(token);
            if (pending == null) return "!保存已取消";
            try {
                pending.stream.flush();
                pending.stream.close();
                String where;
                if (pending.uri != null) {
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(pending.uri, done, null, null);
                    where = "下载/RePhiEditNext/" + pending.name;
                } else {
                    where = pending.file.getAbsolutePath();
                }
                toast("已保存到 " + where);
                return where;
            } catch (Exception error) {
                discard(pending);
                return "!" + error.getMessage();
            }
        }

        /** Drops a pending download. */
        @JavascriptInterface
        public void abort(String token) {
            PendingSave pending = saves.remove(token);
            if (pending == null) return;
            discard(pending);
        }
    }

    private void discard(PendingSave pending) {
        try {
            if (pending.stream != null) pending.stream.close();
        } catch (Exception ignored) {
        }
        try {
            if (pending.uri != null) getContentResolver().delete(pending.uri, null, null);
            else if (pending.file != null) pending.file.delete();
        } catch (Exception ignored) {
        }
    }

    private void toast(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    private static String sanitizeName(String name) {
        String value = name == null ? "" : name.trim();
        if (value.isEmpty()) value = "rpe-next-export";
        value = value.replace('\\', '_').replace('/', '_').replace(':', '_');
        if (value.startsWith(".")) value = "_" + value;
        return value.length() > 120 ? value.substring(0, 120) : value;
    }
}
