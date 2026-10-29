package fr.pisteo.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
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
import android.os.PowerManager;
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
 * Pisteo pour Android : l'appli web (https://pisteo.app/) affichée dans une WebView,
 * avec ce que le navigateur ne fournit pas ici : la voix du téléphone, l'écran allumé, le GPS,
 * l'ouverture et l'enregistrement de fichiers, le partage et le bouton retour.
 */
public class MainActivity extends Activity {
    static volatile MainActivity instance;
    private static final String HOME = "https://pisteo.app/";
    private static final String HOST = "pisteo.app";
    // ancienne adresse (jusqu'à la version 2.1) : on y récupère une fois les données pour les emporter sur pisteo.app
    private static final String OLD_HOME = "https://paul12102021.github.io/balise-gpx/";
    private static final String OLD_HOST = "paul12102021.github.io";
    private String pendingUrl;
    private boolean clearHist;
    private final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
    private static final int REQ_FILE = 1, REQ_LOC = 2, REQ_NOTIF = 3, REQ_STRAVA = 4, REQ_DRIVE = 5;
    private static final int BAR = Color.parseColor("#1d2a24");

    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private Uri camUri; // photo en cours de prise (bouton « Photo » ou appareil proposé avec la galerie)
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
        instance = this;
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
            public void onPageFinished(WebView view, String url) {
                if (clearHist && url != null && url.startsWith(HOME)) { clearHist = false; view.clearHistory(); }
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
            @android.annotation.SuppressLint({"NewApi", "WrongConstant"}) // sélecteur de photos : vérifié par photoPickerAvailable()
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb; camUri = null;
                String[] acc = params.getAcceptTypes();
                boolean img = acc != null && acc.length > 0 && acc[0] != null && acc[0].startsWith("image");
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(img ? "image/*" : "*/*"); // les GPX n'ont pas toujours le bon type : on laisse tout choisir
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                // photos à choisir (pas le bouton « Photo ») : le sélecteur de photos d'Android, où l'on coche
                // plusieurs photos d'un toucher (Android 11 et plus ; sinon la galerie classique ci-dessous)
                if (img && !params.isCaptureEnabled() && photoPickerAvailable()) {
                    Intent pick = new Intent(MediaStore.ACTION_PICK_IMAGES);
                    if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE)
                        pick.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, Math.min(30, MediaStore.getPickImagesMaxLimit()));
                    try { startActivityForResult(pick, REQ_FILE); return true; } catch (ActivityNotFoundException e) { /* galerie classique */ }
                }
                Intent chooser = Intent.createChooser(i, null);
                // photos : l'appareil photo est proposé avec la galerie (ou directement, pour le bouton « Photo »)
                if (img) {
                    try {
                        File dir = new File(getCacheDir(), "share");
                        if (!dir.exists()) dir.mkdirs();
                        File f = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
                        camUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                        Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        cam.putExtra(MediaStore.EXTRA_OUTPUT, camUri);
                        cam.setClipData(ClipData.newRawUri("", camUri));
                        cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        if (params.isCaptureEnabled()) {
                            try { startActivityForResult(cam, REQ_FILE); return true; } catch (ActivityNotFoundException e) { /* pas d'appareil photo : galerie */ }
                        } else chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
                    } catch (Exception e) { camUri = null; }
                }
                try { startActivityForResult(chooser, REQ_FILE); }
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

        String back = appLink(getIntent());
        if (back == null) readShared(getIntent());
        if (state != null) web.restoreState(state);
        if (state == null && !getPreferences(MODE_PRIVATE).getBoolean("moved", false)) startMove(back);
        else if (back != null) web.loadUrl(back);
        else if (web.getUrl() == null) web.loadUrl(HOME);
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
        String back = appLink(intent);
        if (back != null) { web.loadUrl(back); return; }
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
        if (instance == this) instance = null;
        stopService(new Intent(this, LocationService.class)); // appli fermée : plus de GPS en arrière-plan
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

    // liens : l'appli reste dans Pisteo, le reste s'ouvre dans l'appli adaptée
    private boolean openOutside(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        // la connexion Strava (et Google) se fait dans le navigateur ou l'appli Strava : Google refuse les WebView
        if ((scheme.equals("https") || scheme.equals("http")) && (host.equals(HOST) || host.equals(OLD_HOST))
                && !String.valueOf(u.getPath()).contains("/retour-strava")) return false;
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

    // sélecteur de photos d'Android : intégré à Android 13, ajouté par mise à jour système sur Android 11 et 12
    private static boolean photoPickerAvailable() {
        if (Build.VERSION.SDK_INT >= 33) return true;
        return Build.VERSION.SDK_INT >= 30 && android.os.ext.SdkExtensions.getExtensionVersion(Build.VERSION_CODES.R) >= 2;
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == REQ_DRIVE) {
            try {
                com.google.android.gms.auth.api.identity.AuthorizationResult r = com.google.android.gms.auth.api.identity.Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data);
                driveResult(r.getAccessToken(), r.getAccessToken() == null ? "refus" : null);
            } catch (Exception e) { driveResult(null, result == RESULT_CANCELED ? "annulé" : String.valueOf(e.getMessage())); }
            return;
        }
        if (code == REQ_STRAVA) {
            String id = data != null ? data.getStringExtra(StravaActivity.RESULT_ID) : null;
            web.evaluateJavascript("window.pisteoStravaDone && window.pisteoStravaDone(" + (id == null ? "null" : org.json.JSONObject.quote(id)) + ")", null);
            return;
        }
        if (code == REQ_FILE && fileCb != null) {
            Uri[] uris = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    uris = new Uri[data.getClipData().getItemCount()];
                    for (int k = 0; k < uris.length; k++) uris[k] = data.getClipData().getItemAt(k).getUri();
                } else if (data.getData() != null) uris = new Uri[]{data.getData()};
            }
            // photo prise avec l'appareil : elle est dans le fichier préparé, sans réponse dans « data »
            if (uris == null && result == RESULT_OK && camUri != null) {
                File f = new File(new File(getCacheDir(), "share"), camUri.getLastPathSegment());
                if (f.exists() && f.length() > 0) uris = new Uri[]{camUri};
            }
            camUri = null;
            fileCb.onReceiveValue(uris);
            fileCb = null;
        }
    }

    // déménagement vers pisteo.app : on ouvre l'ancienne adresse avec ?migrate=1, la page y rassemble sorties, traces,
    // réglages et liste des cartes et les rend par migrateOut ; on ouvre alors pisteo.app, qui les reprend (takeMigration).
    // Sans réponse au bout de 25 s (pas de réseau…), on ouvre pisteo.app et on réessaiera au prochain lancement (3 fois au plus).
    private void startMove(String then) {
        pendingUrl = then;
        android.content.SharedPreferences pr = getPreferences(MODE_PRIVATE);
        int tries = pr.getInt("moveTries", 0);
        if (tries >= 3) { pr.edit().putBoolean("moved", true).apply(); web.loadUrl(then != null ? then : HOME); return; }
        pr.edit().putInt("moveTries", tries + 1).apply();
        web.loadUrl(OLD_HOME + "?migrate=1");
        ui.postDelayed(() -> { if (!getPreferences(MODE_PRIVATE).getBoolean("moved", false)) finishMove(); }, 25000);
    }
    private void finishMove() {
        if (web == null) return;
        clearHist = true;
        String u = pendingUrl != null ? pendingUrl : HOME; pendingUrl = null;
        web.loadUrl(u);
    }

    // lien vers le site qui ouvre l'appli (retour de la connexion Strava) : la page à charger, ou null
    private String appLink(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return null;
        Uri u = intent.getData();
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") || !(HOST.equalsIgnoreCase(u.getHost()) || OLD_HOST.equalsIgnoreCase(u.getHost()))) return null;
        String q = u.getEncodedQuery(), f = u.getEncodedFragment();
        return HOME + (q == null ? "" : "?" + q) + (f == null ? "" : "#" + f); // lien de parcours : tout est après « # »
    }

    // position venue du service de navigation (GPS actif même écran verrouillé) : transmise à la page
    void pushPosition(android.location.Location l) {
        String js = String.format(Locale.ROOT, "window.pisteoPos&&pisteoPos(%.7f,%.7f,%s,%.1f,%s,%s,%d)",
                l.getLatitude(), l.getLongitude(), l.hasAltitude() ? String.format(Locale.ROOT, "%.1f", l.getAltitude()) : "null",
                l.hasAccuracy() ? l.getAccuracy() : 50f, l.hasSpeed() ? String.format(Locale.ROOT, "%.2f", l.getSpeed()) : "null",
                l.hasBearing() ? String.format(Locale.ROOT, "%.1f", l.getBearing()) : "null", l.getTime());
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
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

    // « Ouvrir avec » : l'appli de la montre ou du compteur (Garmin Connect, Wahoo…) reçoit le fichier
    private void openWith(String name, String mime, String content, String title) {
        try {
            File f = writeCache(name, content);
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, mime);
            i.setClipData(android.content.ClipData.newRawUri(name, uri));
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(i, title));
        } catch (Exception e) {
            Toast.makeText(this, "Aucune appli pour ouvrir ce fichier", Toast.LENGTH_LONG).show();
        }
    }

    /** Enregistre dans Téléchargements et renvoie le nom réel du fichier ("" si échec).
     *  Android ne connaît pas l'extension .gpx : en cas de doublon il ajoute « (1) » APRÈS
     *  « .gpx » (fichier illisible par Strava). On choisit donc nous-mêmes « nom-2.gpx », etc. */
    private String saveToDownloads(String name, String mime, String content) {
        if (Build.VERSION.SDK_INT < 29) { share(name, mime, content); return ""; }
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
        try {
            for (int i = 1; i <= 50; i++) {
                String cand = i == 1 ? name : base + "-" + i + ext;
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, cand);
                cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) throw new Exception("insert");
                String got = cand;
                try (android.database.Cursor c = getContentResolver().query(uri, new String[]{ MediaStore.Downloads.DISPLAY_NAME }, null, null, null)) {
                    if (c != null && c.moveToFirst()) got = c.getString(0);
                }
                if (!cand.equals(got)) { getContentResolver().delete(uri, null, null); continue; }
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os == null) throw new Exception("open");
                    os.write(content.getBytes(StandardCharsets.UTF_8));
                }
                return cand;
            }
            throw new Exception("names");
        } catch (Exception e) {
            share(name, mime, content);
            return "";
        }
    }

    // ---------- Google Drive : jeton d'accès au dossier caché de l'appli (drive.appdata) ----------
    private void driveAuthorize(boolean interactive) {
        com.google.android.gms.auth.api.identity.AuthorizationRequest req = com.google.android.gms.auth.api.identity.AuthorizationRequest.builder()
                .setRequestedScopes(java.util.Collections.singletonList(new com.google.android.gms.common.api.Scope("https://www.googleapis.com/auth/drive.appdata")))
                .build();
        com.google.android.gms.auth.api.identity.Identity.getAuthorizationClient(this).authorize(req)
                .addOnSuccessListener(res -> {
                    if (res.hasResolution()) {
                        // il faut choisir le compte ou accepter : seulement si l'utilisateur l'a demandé
                        if (!interactive || res.getPendingIntent() == null) { driveResult(null, "consent"); return; }
                        try { startIntentSenderForResult(res.getPendingIntent().getIntentSender(), REQ_DRIVE, null, 0, 0, 0); }
                        catch (Exception e) { driveResult(null, String.valueOf(e.getMessage())); }
                    } else driveResult(res.getAccessToken(), res.getAccessToken() == null ? "refus" : null);
                })
                .addOnFailureListener(e -> driveResult(null, String.valueOf(e.getMessage())));
    }

    private void driveResult(String token, String err) {
        String js = "window.pisteoDrive && window.pisteoDrive(" + (token == null ? "null" : org.json.JSONObject.quote(token)) + "," + (err == null ? "null" : org.json.JSONObject.quote(err)) + ")";
        runOnUiThread(() -> { if (web != null) web.evaluateJavascript(js, null); });
    }

    private void openPlayPage() {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + getPackageName()))); }
        catch (Exception e) { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + getPackageName()))); } catch (Exception ignored) {} }
    }

    /** Ce que la page peut demander au téléphone (window.PisteoAndroid). */
    private class Bridge {
        // sauvegarde Drive : demande un jeton (interactive = fenêtre Google si besoin) ; réponse par window.pisteoDrive
        @JavascriptInterface
        public void driveAuth(boolean interactive) { runOnUiThread(() -> driveAuthorize(interactive)); }

        // import Strava dans l'appli : la page d'import reçoit directement le GPX de la sortie (2.3.0)
        @JavascriptInterface
        public boolean stravaImport(String name, String content, String labels) {
            try {
                File f = writeCache(name, content);
                runOnUiThread(() -> {
                    Intent i = new Intent(MainActivity.this, StravaActivity.class);
                    i.putExtra(StravaActivity.EXTRA_FILE, f.getAbsolutePath());
                    i.putExtra(StravaActivity.EXTRA_LABELS, labels);
                    startActivityForResult(i, REQ_STRAVA);
                });
                return true;
            } catch (Exception e) { return false; }
        }

        // navigation ou enregistrement : GPS gardé actif en arrière-plan (notification « Pisteo · … en cours »)
        @JavascriptInterface
        public void tracking(boolean on, String text) {
            runOnUiThread(() -> {
                Intent i = new Intent(MainActivity.this, LocationService.class);
                if (!on) { stopService(i); return; }
                if (!hasLocation()) return;
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
                i.putExtra(LocationService.EXTRA_TEXT, text);
                try {
                    if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void openExternal(String url) { openExternal(url, false); }

        // browser = true : dans le navigateur, même si une autre appli (ex. Strava) sait ouvrir ce lien
        @JavascriptInterface
        public void openExternal(String url, boolean browser) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                if (browser) {
                    android.content.pm.ResolveInfo ri = getPackageManager().resolveActivity(
                            new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com/")), PackageManager.MATCH_DEFAULT_ONLY);
                    if (ri != null && ri.activityInfo != null && !"android".equals(ri.activityInfo.packageName)) i.setPackage(ri.activityInfo.packageName);
                }
                try { startActivity(i); }
                catch (Exception e) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                    catch (Exception e2) { Toast.makeText(MainActivity.this, "Aucune appli pour ouvrir ce lien", Toast.LENGTH_SHORT).show(); }
                }
            });
        }

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

        // partager un texte (lien de parcours) : WhatsApp, SMS, mail…
        @JavascriptInterface
        public void shareText(String text, String title) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND).setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                i.putExtra(Intent.EXTRA_SUBJECT, title);
                try { startActivity(Intent.createChooser(i, title)); }
                catch (Exception e) { Toast.makeText(MainActivity.this, "Partage impossible", Toast.LENGTH_SHORT).show(); }
            });
        }

        @JavascriptInterface
        public void openWith(String name, String mime, String content, String title) {
            runOnUiThread(() -> MainActivity.this.openWith(name, mime, content, title));
        }

        // déménagement : la page de l'ancienne adresse rend toutes ses données (vide si rien à emporter)
        @JavascriptInterface
        public void migrateOut(String json) {
            try {
                if (json != null && json.length() > 2)
                    try (OutputStream os = new FileOutputStream(new File(getFilesDir(), "move.json"))) { os.write(json.getBytes(StandardCharsets.UTF_8)); }
            } catch (Exception ignored) { }
            getPreferences(MODE_PRIVATE).edit().putBoolean("moved", true).apply();
            runOnUiThread(MainActivity.this::finishMove);
        }

        // pisteo.app reprend ces données une fois (puis le fichier est effacé)
        @JavascriptInterface
        public String takeMigration() {
            File f = new File(getFilesDir(), "move.json");
            if (!f.exists()) return null;
            try (InputStream is = new java.io.FileInputStream(f)) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] buf = new byte[65536]; int n;
                while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
                return bo.toString(StandardCharsets.UTF_8.name());
            } catch (Exception e) { return null; }
            finally { f.delete(); }
        }

        @JavascriptInterface
        public String saveDownload(String name, String mime, String content) {
            return saveToDownloads(name, mime, content);
        }

        @JavascriptInterface
        public String takeShared() {
            String t = sharedText;
            sharedText = null;
            return t;
        }

        // économie d'énergie d'Android : peut couper le GPS écran éteint (2.5.0)
        @JavascriptInterface
        public boolean powerSave() {
            try { PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE); return pm != null && pm.isPowerSaveMode(); }
            catch (Exception e) { return false; }
        }
        @JavascriptInterface
        public void openBatterySettings() {
            runOnUiThread(() -> {
                try { startActivity(new Intent(android.provider.Settings.ACTION_BATTERY_SAVER_SETTINGS)); }
                catch (Exception e) { try { startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS)); } catch (Exception ignored) {} }
            });
        }
        // note dans l'appli (fenêtre Google Play) ; sinon la fiche Play Store (2.5.0)
        @JavascriptInterface
        public void askReview() {
            runOnUiThread(() -> {
                try {
                    com.google.android.play.core.review.ReviewManager rm = com.google.android.play.core.review.ReviewManagerFactory.create(MainActivity.this);
                    rm.requestReviewFlow().addOnCompleteListener(t -> {
                        if (t.isSuccessful()) rm.launchReviewFlow(MainActivity.this, t.getResult());
                        else openPlayPage();
                    });
                } catch (Exception e) { openPlayPage(); }
            });
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
