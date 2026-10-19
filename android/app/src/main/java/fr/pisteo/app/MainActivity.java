package fr.pisteo.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.core.content.FileProvider;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Pisteo pour Android : l'appli web (https://paul12102021.github.io/balise-gpx/) affichée dans une WebView,
 * avec ce que le navigateur ne fournit pas ici : la voix du téléphone, l'écran allumé, le GPS,
 * l'ouverture et l'enregistrement de fichiers, le partage et le bouton retour.
 */
public class MainActivity extends Activity {
    private static final String HOME = "https://paul12102021.github.io/balise-gpx/";
    private static final String HOST = "paul12102021.github.io";
    private static final int REQ_FILE = 1, REQ_LOC = 2;
    private static final int BAR = Color.parseColor("#1d2a24");

    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private GeolocationPermissions.Callback geoCb;
    private String geoOrigin;
    private volatile String sharedText;

    private TextToSpeech tts;
    private volatile boolean ttsReady;
    private String ttsLang = "";
    private Runnable pendingSpeech;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private final AtomicInteger uttId = new AtomicInteger();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(BAR);
        getWindow().setNavigationBarColor(BAR);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BAR);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#E4E9DC"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        // affichage bord à bord (Android 15+) : la page reste entre la barre d'état et la barre de navigation / le clavier
        root.setOnApplyWindowInsetsListener((v, in) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets s = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
                l = s.left; t = s.top; r = s.right; b = Math.max(s.bottom, ime.bottom);
            } else {
                l = in.getSystemWindowInsetLeft(); t = in.getSystemWindowInsetTop();
                r = in.getSystemWindowInsetRight(); b = in.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return in;
        });

        boolean debug = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debug);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setGeolocationEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setSupportMultipleWindows(false);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(true);
        ws.setTextZoom(100);
        String version = "";
        try { version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) {}
        ws.setUserAgentString(ws.getUserAgentString() + " PisteoAndroid/" + version);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Bridge(), "PisteoAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return openOutside(req.getUrl());
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                recreate(); // le moteur de la page s'est arrêté : on relance proprement
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (hasLocation()) { cb.invoke(origin, true, false); return; }
                geoOrigin = origin; geoCb = cb;
                requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*"); // les GPX n'ont pas toujours le bon type : on laisse tout choisir
                try { startActivityForResult(Intent.createChooser(i, null), REQ_FILE); }
                catch (ActivityNotFoundException e) { fileCb = null; return false; }
                return true;
            }
        });

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }

        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (!ttsReady) return;
            tts.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { takeFocus(); }
                @Override public void onDone(String id) { releaseFocusIfIdle(); }
                @Override public void onError(String id) { releaseFocusIfIdle(); }
                @Override public void onStop(String id, boolean interrupted) { releaseFocusIfIdle(); }
            });
            Runnable p = pendingSpeech; pendingSpeech = null;
            if (p != null) runOnUiThread(p);
        });

        readShared(getIntent());
        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) web.loadUrl(HOME);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (readShared(intent)) web.evaluateJavascript("window.pisteoCheckShared && window.pisteoCheckShared()", null);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        // la page n'est pas mise en pause : le guidage et l'enregistrement continuent en arrière-plan
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { goBack(); }

    // retour : la page ferme d'abord son panneau ouvert ; sinon on remet l'appli en arrière-plan (la navigation continue)
    private void goBack() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(window.pisteoBack && window.pisteoBack()) ? 1 : 0", v -> {
            if ("1".equals(v)) return;
            if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
        });
    }

    // liens : l'appli et la connexion Strava restent dans Pisteo, le reste s'ouvre dans l'appli adaptée
    private boolean openOutside(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        if ((scheme.equals("https") || scheme.equals("http"))
                && (host.equals(HOST) || host.equals("strava.com") || host.endsWith(".strava.com"))) return false;
        try {
            Intent i = scheme.equals("intent") ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
            if (scheme.equals("intent")) { i.addCategory(Intent.CATEGORY_BROWSABLE); i.setComponent(null); i.setSelector(null); }
            if (scheme.equals("mailto")) i = new Intent(Intent.ACTION_SENDTO, u);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "Aucune appli pour ouvrir ce lien", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == REQ_LOC && geoCb != null) {
            geoCb.invoke(geoOrigin, hasLocation(), false);
            geoCb = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == REQ_FILE && fileCb != null) {
            Uri[] uris = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    uris = new Uri[data.getClipData().getItemCount()];
                    for (int k = 0; k < uris.length; k++) uris[k] = data.getClipData().getItemAt(k).getUri();
                } else if (data.getData() != null) uris = new Uri[]{data.getData()};
            }
            fileCb.onReceiveValue(uris);
            fileCb = null;
        }
    }

    // GPX reçu par « Partager » ou « Ouvrir avec » : gardé de côté, la page vient le chercher
    private boolean readShared(Intent intent) {
        if (intent == null) return false;
        Uri u = null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        else if (Intent.ACTION_VIEW.equals(intent.getAction())) u = intent.getData();
        if (u == null) {
            String t = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (t != null && t.contains("<gpx")) { sharedText = t; return true; }
            return false;
        }
        try (InputStream is = getContentResolver().openInputStream(u)) {
            if (is == null) return false;
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n, total = 0;
            while ((n = is.read(buf)) > 0) { bo.write(buf, 0, n); total += n; if (total > 50_000_000) break; }
            sharedText = bo.toString(StandardCharsets.UTF_8.name());
            return true;
        } catch (Exception e) {
            Toast.makeText(this, "Impossible de lire le fichier partagé.", Toast.LENGTH_LONG).show();
            return false;
        }
    }

    // ---------- voix ----------
    private void takeFocus() {
        if (focus == null) {
            focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).build();
        }
        audio.requestAudioFocus(focus); // la musique baisse le temps de l'annonce
    }

    private void releaseFocusIfIdle() {
        if (focus != null && tts != null && !tts.isSpeaking()) audio.abandonAudioFocusRequest(focus);
    }

    private void speakNow(String text, String lang, float rate, float pitch, boolean queue) {
        if (!ttsReady) { pendingSpeech = () -> speakNow(text, lang, rate, pitch, queue); return; }
        if (lang != null && !lang.equals(ttsLang)) {
            ttsLang = lang;
            int r = tts.setLanguage(Locale.forLanguageTag(lang));
            if (r < 0) tts.setLanguage(Locale.forLanguageTag(lang.substring(0, 2)));
        }
        tts.setSpeechRate(rate > 0 ? rate : 1f);
        tts.setPitch(pitch > 0 ? pitch : 1f);
        tts.speak(text, queue ? TextToSpeech.QUEUE_ADD : TextToSpeech.QUEUE_FLUSH, null, "p" + uttId.incrementAndGet());
    }

    // ---------- fichiers ----------
    private File writeCache(String name, String content) throws Exception {
        File dir = new File(getCacheDir(), "share");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("cache");
        File f = new File(dir, name.replaceAll("[^A-Za-z0-9._-]", "_"));
        try (OutputStream os = new FileOutputStream(f)) { os.write(content.getBytes(StandardCharsets.UTF_8)); }
        return f;
    }

    private void share(String name, String mime, String content) {
        try {
            File f = writeCache(name, content);
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(mime);
            i.putExtra(Intent.EXTRA_STREAM, uri);
            i.putExtra(Intent.EXTRA_TITLE, name);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(i, name));
        } catch (Exception e) {
            Toast.makeText(this, "Partage impossible", Toast.LENGTH_SHORT).show();
        }
    }

    private boolean saveToDownloads(String name, String mime, String content) {
        if (Build.VERSION.SDK_INT < 29) { share(name, mime, content); return false; }
        try {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
            cv.put(MediaStore.Downloads.MIME_TYPE, mime);
            cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new Exception("insert");
            try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                if (os == null) throw new Exception("open");
                os.write(content.getBytes(StandardCharsets.UTF_8));
            }
            return true;
        } catch (Exception e) {
            share(name, mime, content);
            return false;
        }
    }

    /** Ce que la page peut demander au téléphone (window.PisteoAndroid). */
    private class Bridge {
        @JavascriptInterface
        public void speak(String text, String lang, double rate, double pitch, boolean queue) {
            runOnUiThread(() -> speakNow(text, lang, (float) rate, (float) pitch, queue));
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> { if (tts != null) tts.stop(); releaseFocusIfIdle(); });
        }

        @JavascriptInterface
        public boolean ttsAvailable() { return ttsReady; }

        @JavascriptInterface
        public void keepAwake(boolean on) {
            runOnUiThread(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void shareFile(String name, String mime, String content) {
            runOnUiThread(() -> share(name, mime, content));
        }

        @JavascriptInterface
        public boolean saveDownload(String name, String mime, String content) {
            return saveToDownloads(name, mime, content);
        }

        @JavascriptInterface
        public String takeShared() {
            String t = sharedText;
            sharedText = null;
            return t;
        }

        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(() -> {
                try { startActivity(new Intent("com.android.settings.TTS_SETTINGS")); }
                catch (Exception e) { startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS)); }
            });
        }
    }
}
