package fr.pisteo.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Navigation ou enregistrement en cours : service « de premier plan » (notification permanente)
 * qui garde le GPS actif écran verrouillé ou appli en arrière-plan, et transmet chaque position à la page.
 */
public class LocationService extends Service implements LocationListener {
    static final String CHANNEL = "nav";
    static final String EXTRA_TEXT = "text";
    private static final int NOTIF_ID = 1;
    static volatile boolean running;

    private LocationManager lm;
    private PowerManager.WakeLock wake;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent != null && intent.getStringExtra(EXTRA_TEXT) != null ? intent.getStringExtra(EXTRA_TEXT) : "Navigation en cours";
        Notification n = buildNotification(text);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIF_ID, n);
        } catch (Exception e) { // autorisation de position retirée entre-temps
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!running) {
            running = true;
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pisteo:nav");
            wake.acquire(12 * 60 * 60 * 1000L); // au plus 12 h
            lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            try {
                if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                    lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this, Looper.getMainLooper());
                if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                    lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000, 0, this, Looper.getMainLooper());
            } catch (SecurityException ignored) { }
        }
        return START_NOT_STICKY;
    }

    private Notification buildNotification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Navigation en cours", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Garde le GPS actif pendant la navigation et l'enregistrement");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_nav).setContentTitle("Pisteo").setContentText(text)
                .setContentIntent(pi).setOngoing(true).setShowWhen(false).setColor(0xFF2F5E45);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    @Override
    public void onLocationChanged(Location loc) {
        // le GPS est prioritaire : une position réseau n'est transmise que si le GPS se tait
        if (!LocationManager.GPS_PROVIDER.equals(loc.getProvider()) && System.currentTimeMillis() - lastGps < 10000) return;
        if (LocationManager.GPS_PROVIDER.equals(loc.getProvider())) lastGps = System.currentTimeMillis();
        MainActivity a = MainActivity.instance;
        if (a != null) a.pushPosition(loc);
    }
    private long lastGps;

    @Override public void onStatusChanged(String p, int s, Bundle b) { }
    @Override public void onProviderEnabled(String p) { }
    @Override public void onProviderDisabled(String p) { }

    @Override
    public void onDestroy() {
        running = false;
        if (lm != null) try { lm.removeUpdates(this); } catch (Exception ignored) { }
        if (wake != null && wake.isHeld()) wake.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
