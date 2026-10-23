package fr.pisteo.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Import Strava dans l'appli : la page d'import du site Strava s'ouvre ici, et quand elle demande un
 * fichier, on lui donne directement le GPX de la sortie (pas besoin d'aller le chercher dans Téléchargements).
 * Strava refuse l'envoi direct par son API sans abonnement : on passe donc par son site, comme une personne.
 * Résultat renvoyé à Pisteo : l'identifiant de l'activité créée, « chrome » (repli sur le navigateur) ou rien.
 */
public class StravaActivity extends Activity {
    static final String EXTRA_FILE = "file", EXTRA_LABELS = "labels", RESULT_ID = "id";
    private static final String UPLOAD = "https://www.strava.com/upload/select";
    // affichage « ordinateur » : la page d'import mobile renvoie vers l'appli Strava, qui n'importe pas les GPX
    private static final String DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    private static final Pattern ACTIVITY = Pattern.compile("^https://(www\\.)?strava\\.com/activities/(\\d+)(?:[/?#].*)?$");

    private WebView web;
    private TextView hint;
    private ProgressBar bar;
    private Uri gpx;
    private boolean fileGiven, done;
    private JSONObject labels;

    private String t(String key, String fr) { return labels != null ? labels.optString(key, fr) : fr; }
    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        try { labels = new JSONObject(getIntent().getStringExtra(EXTRA_LABELS)); } catch (Exception e) { labels = null; }
        File f = new File(getIntent().getStringExtra(EXTRA_FILE));
        gpx = FileProvider.getUriForFile(this, getPackageName() + ".files", f);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#1F2B25"));

        // barre du haut : titre, « Chrome » (repli), « Fermer »
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(16), dp(8), dp(8), dp(8));
        TextView title = new TextView(this);
        title.setText(t("title", "Mettre sur Strava"));
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        top.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        top.addView(pill(t("chrome", "Chrome"), v -> finishWith("chrome")));
        top.addView(pill("✕ " + t("close", "Fermer"), v -> finishWith(null)));
        root.addView(top);

        hint = new TextView(this);
        hint.setTextColor(Color.parseColor("#E6EDE8"));
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        hint.setLineSpacing(0, 1.15f);
        hint.setPadding(dp(16), dp(10), dp(16), dp(10));
        hint.setBackgroundColor(Color.parseColor("#28332C"));
        hint.setText(t("hint", "Touche « Sélect. fichiers » : ta sortie est choisie toute seule. Puis « Enregistrer et afficher »."));
        root.addView(hint);

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(bar, new LinearLayout.LayoutParams(-1, dp(3)));

        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);

        root.setOnApplyWindowInsetsListener((v, in) -> {
            int l, tp, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets s = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
                l = s.left; tp = s.top; r = s.right; b = Math.max(s.bottom, ime.bottom);
            } else {
                l = in.getSystemWindowInsetLeft(); tp = in.getSystemWindowInsetTop();
                r = in.getSystemWindowInsetRight(); b = in.getSystemWindowInsetBottom();
            }
            v.setPadding(l, tp, r, b);
            return in;
        });

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setUserAgentString(DESKTOP_UA);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String s = req.getUrl().getScheme(), h = String.valueOf(req.getUrl().getHost());
                // Google refuse toute connexion dans une appli : on le dit tout de suite plutôt que d'afficher son erreur
                if (h.equals("accounts.google.com") || h.endsWith(".accounts.google.com")) {
                    hint.setBackgroundColor(Color.parseColor("#8A3A12"));
                    hint.setText(t("google", "Google refuse la connexion dans une appli. Connecte-toi avec ton e-mail Strava (« Mot de passe oublié » pour t'en créer un), ou touche « Chrome » en haut."));
                    return true;
                }
                // liens vers l'appli Strava ou le Play Store : on reste sur le site
                return s == null || !(s.equals("https") || s.equals("http"));
            }
            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean reload) { check(url); }
            @Override
            public void onPageFinished(WebView view, String url) { check(url); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                // Strava demande un fichier : c'est celui de la sortie
                cb.onReceiveValue(new Uri[]{ gpx });
                fileGiven = true;
                hint.setText(t("sent", "Ta sortie est choisie. Vérifie le titre et le type, puis « Enregistrer et afficher »."));
                return true;
            }
            @Override
            public void onProgressChanged(WebView view, int p) {
                bar.setProgress(p);
                bar.setVisibility(p >= 100 ? View.INVISIBLE : View.VISIBLE);
            }
        });
        web.loadUrl(UPLOAD);
    }

    private TextView pill(String text, View.OnClickListener click) {
        TextView b = new TextView(this);
        b.setText(text);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setPadding(dp(14), dp(8), dp(14), dp(8));
        b.setOnClickListener(click);
        b.setBackgroundResource(android.R.drawable.list_selector_background);
        return b;
    }

    // l'import est fini quand Strava affiche la nouvelle activité
    private void check(String url) {
        if (done || !fileGiven || url == null) return;
        Matcher m = ACTIVITY.matcher(url);
        if (!m.matches()) return;
        done = true;
        hint.setText("✓ " + t("done", "Sortie publiée sur Strava"));
        new Handler(Looper.getMainLooper()).postDelayed(() -> finishWith(m.group(2)), 1500);
    }

    private void finishWith(String id) {
        Intent r = new Intent();
        if (id != null) r.putExtra(RESULT_ID, id);
        setResult(RESULT_OK, r);
        finish();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else finishWith(null);
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
}
