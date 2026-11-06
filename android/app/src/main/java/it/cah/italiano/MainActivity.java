package it.cah.italiano;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.View;
import java.io.File;
import org.json.JSONObject;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// Guscio minimo: mostra il gioco incluso nell'app (assets/index.html).
// Il gioco online si collega al server indicato nel menu.
public class MainActivity extends Activity {
    private WebView web;
    private long dlId = -1;
    private BroadcastReceiver dlDone;

    // Ponte per il gioco.
    public class Bridge {
        // Scarica l'aggiornamento dentro l'app e, a download finito, chiede di installarlo. Nessuna pagina web.
        @JavascriptInterface
        public void installUpdate(String url) {
            if (url == null || !url.startsWith("https://")) return;
            runOnUiThread(() -> scaricaAggiornamento(url));
        }

        // Vecchio percorso: apre un link con il telefono.
        @JavascriptInterface
        public void openUrl(String url) {
            if (url == null || !url.startsWith("https://")) return;
            runOnUiThread(() -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
        }
    }

    // Avvisi per la pagina, al posto di una chiusura improvvisa dell'app.
    // Il nome dell'errore e il suo testo, così si capisce la causa.
    private static String dettaglio(Exception e) {
        return e.getClass().getSimpleName() + (e.getMessage() == null ? "" : " - " + e.getMessage());
    }

    private void avvisa(String msg) {
        if (web == null) return;
        web.post(() -> web.evaluateJavascript(
            "window.onNativeError && window.onNativeError(" + JSONObject.quote(msg) + ")", null));
    }

    private void scaricaAggiornamento(String url) {
        try {
            final DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm == null) { avvisa("Aggiornamento non disponibile su questo telefono."); return; }
            // Un file rimasto da una prova precedente va tolto, altrimenti il download può fallire.
            File vecchio = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "aggiornamento.apk");
            if (vecchio.exists() && !vecchio.delete()) { avvisa("Non riesco a sostituire il file dell'aggiornamento."); return; }
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setTitle("Cards Against Humanity");
            r.setDescription("Aggiornamento");
            r.setMimeType("application/vnd.android.package-archive");
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "aggiornamento.apk");
            dlId = dm.enqueue(r);
            if (dlDone != null) return;
            dlDone = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent i) {
                    try {
                        long id = i.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                        if (id != dlId) return;
                        Uri apk = dm.getUriForDownloadedFile(id);
                        if (apk == null) { avvisa("Download dell'aggiornamento non riuscito. Riprova."); return; }
                        Intent install = new Intent(Intent.ACTION_VIEW);
                        install.setDataAndType(apk, "application/vnd.android.package-archive");
                        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(install);
                    } catch (Exception e) {
                        avvisa("Non riesco ad avviare l'installazione: " + dettaglio(e));
                    }
                }
            };
            IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(dlDone, f, Context.RECEIVER_EXPORTED);
            else registerReceiver(dlDone, f);
        } catch (Exception e) {
            dlDone = null;
            avvisa("Non riesco ad avviare l'aggiornamento: " + dettaglio(e));
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
        nascondiBarre();
    }

    @Override
    protected void onDestroy() {
        if (dlDone != null) {
            try { unregisterReceiver(dlDone); } catch (IllegalArgumentException ignored) { }
            dlDone = null;
        }
        super.onDestroy();
    }

    // Schermo intero: niente barra di stato né tasti di sistema; tornano solo se li tocchi dal bordo.
    private void nascondiBarre() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) nascondiBarre();
    }
}
