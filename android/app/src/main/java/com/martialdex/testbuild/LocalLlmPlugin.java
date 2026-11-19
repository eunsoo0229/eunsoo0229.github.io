package com.martialdex.testbuild;

import android.content.ComponentCallbacks2;
import android.content.Context;
import android.content.res.Configuration;
import android.net.ConnectivityManager;
import android.os.Debug;
import android.os.StatFs;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * MARTIALDEX 로컬 AI 엔진 (Android) — the renderer's `LocalLlm` plugin (src/lib/localAi/engineControl.ts).
 * Same contract as the desktop engine (electron/localEngine.cjs): status / start / stop / setModel /
 * download / cancelDownload / chat / cancel, events "changed" and "delta".
 *
 * Rules:
 *  - nothing loads at app start; the engine loads when the user presses 시작 or a feature asks for an
 *    INSTALLED model (no re-approval needed once installed);
 *  - a model is downloaded only by download({ model, approved: true }) — the UI shows name, size, free
 *    storage and purpose and the user presses the button; never automatically, never in the APK;
 *  - a download is accepted only after its SHA-256 matches the official value;
 *  - the engine runs inside the app process (no separate process, no foreground service): it is freed
 *    on 종료, on critical memory pressure, after 15 idle minutes, and when the activity is destroyed.
 */
@CapacitorPlugin(name = "LocalLlm")
public class LocalLlmPlugin extends Plugin {

    private static final long IDLE_UNLOAD_MS = 15 * 60 * 1000L;
    private static volatile LocalLlmPlugin instance;

    private LocalLlmEngine engine;
    private final ScheduledExecutorService timers = Executors.newSingleThreadScheduledExecutor();
    private final Map<String, AtomicBoolean> cancels = new ConcurrentHashMap<>();
    private volatile Download download = null;
    private volatile JSObject lastRun = null;
    private ComponentCallbacks2 memoryCallbacks;

    private static final class Download {
        final LocalLlmModels.Model model;
        final AtomicBoolean cancel = new AtomicBoolean(false);
        volatile String status = "starting";
        volatile long completed = 0;

        Download(LocalLlmModels.Model m) {
            model = m;
        }
    }

    static void notifyChanged() {
        LocalLlmPlugin p = instance;
        if (p != null) p.notifyListeners("changed", new JSObject());
    }

    @Override
    public void load() {
        instance = this;
        engine = new LocalLlmEngine(getContext());
        memoryCallbacks = new ComponentCallbacks2() {
            @Override
            public void onTrimMemory(int level) {
                // the system is about to kill background apps / is critically low: give the model's RAM back
                if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL && level != ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN && !engine.generating() && engine.loadedModelId() != null) {
                    engine.worker().execute(engine::unloadBlocking);
                }
            }

            @Override
            public void onConfigurationChanged(Configuration newConfig) {}

            @Override
            public void onLowMemory() {
                if (!engine.generating() && engine.loadedModelId() != null) engine.worker().execute(engine::unloadBlocking);
            }
        };
        getContext().getApplicationContext().registerComponentCallbacks(memoryCallbacks);
        timers.scheduleWithFixedDelay(() -> {
            if (engine.loadedModelId() != null && !engine.generating() && System.currentTimeMillis() - engine.lastUse() > IDLE_UNLOAD_MS) {
                engine.worker().execute(engine::unloadBlocking);
            }
        }, 1, 1, TimeUnit.MINUTES);
    }

    @Override
    protected void handleOnDestroy() {
        for (AtomicBoolean c : cancels.values()) c.set(true);
        Download d = download;
        if (d != null) d.cancel.set(true);
        engine.worker().execute(engine::unloadBlocking);
        engine.worker().shutdown();
        timers.shutdownNow();
        try {
            getContext().getApplicationContext().unregisterComponentCallbacks(memoryCallbacks);
        } catch (Exception ignored) {
        }
        if (instance == this) instance = null;
    }

    // ------------------------------------------------------------------ status

    private long freeStorage() {
        StatFs s = new StatFs(getContext().getFilesDir().getAbsolutePath());
        return s.getAvailableBytes();
    }

    private boolean metered() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            return cm != null && cm.isActiveNetworkMetered();
        } catch (RuntimeException e) {
            return false; // no network-state access: the warning is skipped, never a crash
        }
    }

    private JSObject statusObject() {
        Context c = getContext();
        LocalLlmModels.Model sel = LocalLlmModels.selected(c);
        JSObject o = new JSObject();
        o.put("platform", "android");
        String phase = engine.phase();
        if (!LocalLlmEngine.libraryAvailable()) phase = "unsupported";
        o.put("phase", phase);
        if (engine.errorCode() != null || !LocalLlmEngine.libraryAvailable()) {
            JSObject e = new JSObject();
            e.put("code", LocalLlmEngine.libraryAvailable() ? engine.errorCode() : "UNSUPPORTED_DEVICE");
            e.put("message", LocalLlmEngine.libraryAvailable() ? engine.errorMessage() : "이 기기에서는 로컬 AI 엔진을 실행할 수 없습니다.");
            o.put("error", e);
        } else {
            o.put("error", JSONObject.NULL);
        }
        o.put("model", sel.id);
        JSArray models = new JSArray();
        for (LocalLlmModels.Model m : LocalLlmModels.ALL) {
            JSObject mo = new JSObject();
            mo.put("id", m.id);
            mo.put("label", m.label);
            mo.put("downloadBytes", m.bytes);
            mo.put("minRamGb", m.minRamGb);
            mo.put("installed", LocalLlmModels.installed(c, m));
            File part = LocalLlmModels.partOf(c, m);
            mo.put("partialBytes", part.isFile() ? part.length() : 0);
            models.put(mo);
        }
        o.put("models", models);
        o.put("owned", engine.loadedModelId() != null);
        o.put("external", false);
        o.put("modelInstalled", LocalLlmModels.installed(c, sel));
        if (engine.loadedModelId() != null) {
            JSObject l = new JSObject();
            l.put("name", engine.loadedModelId());
            l.put("sizeBytes", engine.loadedBytes());
            o.put("loaded", l);
        } else {
            o.put("loaded", JSONObject.NULL);
        }
        Download d = download;
        if (d != null) {
            JSObject p = new JSObject();
            p.put("model", d.model.id);
            p.put("status", d.status);
            p.put("completed", d.completed);
            p.put("total", d.model.bytes);
            o.put("pull", p);
        } else {
            o.put("pull", JSONObject.NULL);
        }
        o.put("deviceRamBytes", LocalLlmEngine.deviceRamBytes(c));
        o.put("availRamBytes", LocalLlmEngine.availRamBytes(c));
        o.put("freeStorageBytes", freeStorage());
        o.put("metered", metered());
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    /** Measurement data for the performance report (process memory, last load / generation numbers). */
    @PluginMethod
    public void diagnostics(PluginCall call) {
        Debug.MemoryInfo mi = new Debug.MemoryInfo();
        Debug.getMemoryInfo(mi);
        JSObject o = new JSObject();
        o.put("pssKb", mi.getTotalPss());
        o.put("nativePssKb", mi.nativePss);
        o.put("nativeHeapKb", Debug.getNativeHeapAllocatedSize() / 1024);
        o.put("loadMs", engine.lastLoadMs());
        o.put("contextSize", engine.contextSize());
        o.put("threads", engine.threads());
        o.put("cores", Runtime.getRuntime().availableProcessors());
        o.put("lastRun", lastRun != null ? lastRun : JSONObject.NULL);
        call.resolve(o);
    }

    // ------------------------------------------------------------------ start / stop / model

    @PluginMethod
    public void start(PluginCall call) {
        Context c = getContext();
        String id = call.getString("model");
        LocalLlmModels.Model m = id != null && LocalLlmModels.byId(id) != null ? LocalLlmModels.byId(id) : LocalLlmModels.selected(c);
        if (!LocalLlmModels.installed(c, m)) {
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("code", "MODEL_MISSING");
            r.put("message", "모델 " + m.id + "이(가) 아직 설치되지 않았습니다.");
            r.put("model", m.id);
            call.resolve(r);
            return;
        }
        engine.worker().execute(() -> call.resolve(result(engine.loadBlocking(m))));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        for (AtomicBoolean cflag : cancels.values()) cflag.set(true);
        engine.worker().execute(() -> {
            engine.unloadBlocking();
            JSObject r = new JSObject();
            r.put("ok", true);
            r.put("stoppedServer", true);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void setModel(PluginCall call) {
        String id = call.getString("model");
        if (LocalLlmModels.byId(id) == null) {
            call.resolve(result("BAD_MODEL:지원하지 않는 모델입니다."));
            return;
        }
        LocalLlmModels.select(getContext(), id);
        // a different model than the one in RAM: free it (the next start / request loads the new one)
        if (engine.loadedModelId() != null && !engine.loadedModelId().equals(id)) engine.worker().execute(engine::unloadBlocking);
        notifyChanged();
        call.resolve(result(null));
    }

    /** Removes a downloaded model file (frees storage). */
    @PluginMethod
    public void deleteModel(PluginCall call) {
        LocalLlmModels.Model m = LocalLlmModels.byId(call.getString("model"));
        if (m == null) {
            call.resolve(result("BAD_MODEL:지원하지 않는 모델입니다."));
            return;
        }
        engine.worker().execute(() -> {
            if (m.id.equals(engine.loadedModelId())) engine.unloadBlocking();
            LocalLlmModels.forget(getContext(), m);
            //noinspection ResultOfMethodCallIgnored
            LocalLlmModels.fileOf(getContext(), m).delete();
            //noinspection ResultOfMethodCallIgnored
            LocalLlmModels.partOf(getContext(), m).delete();
            notifyChanged();
            call.resolve(result(null));
        });
    }

    // ------------------------------------------------------------------ download (explicit approval only)

    @PluginMethod
    public void download(PluginCall call) {
        LocalLlmModels.Model m = LocalLlmModels.byId(call.getString("model"));
        if (m == null) {
            call.resolve(result("BAD_MODEL:지원하지 않는 모델입니다."));
            return;
        }
        if (!Boolean.TRUE.equals(call.getBoolean("approved", false))) {
            call.resolve(result("NOT_APPROVED:사용자가 다운로드를 승인하지 않았습니다."));
            return;
        }
        if (download != null) {
            call.resolve(result("BUSY:이미 다른 모델을 다운로드하고 있습니다."));
            return;
        }
        if (LocalLlmModels.installed(getContext(), m)) {
            call.resolve(result(null));
            return;
        }
        File part = LocalLlmModels.partOf(getContext(), m);
        long have = part.isFile() ? part.length() : 0;
        long margin = 300L * 1024 * 1024;
        if (freeStorage() < (m.bytes - have) + margin) {
            call.resolve(result(String.format("INSUFFICIENT_STORAGE:저장 공간이 부족합니다. 약 %.1fGB의 여유 공간이 필요합니다.", ((m.bytes - have) + margin) / 1e9)));
            return;
        }
        Download d = new Download(m);
        download = d;
        notifyChanged();
        new Thread(() -> {
            String err = runDownload(d, part);
            download = null;
            notifyChanged();
            call.resolve(result(err));
        }, "martialdex-llm-download").start();
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        Download d = download;
        if (d != null) d.cancel.set(true);
        JSObject r = new JSObject();
        r.put("ok", d != null);
        call.resolve(r);
    }

    /** → null ok, else "CODE:message". Resumes a .part file (HTTP Range); the hash is checked before the file is accepted. */
    private String runDownload(Download d, File part) {
        LocalLlmModels.Model m = d.model;
        HttpURLConnection conn = null;
        try {
            long have = part.isFile() ? part.length() : 0;
            if (have > m.bytes) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                have = 0;
            }
            if (have < m.bytes) {
                d.status = "downloading";
                d.completed = have;
                URL url = new URL(m.url);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                if (have > 0) conn.setRequestProperty("Range", "bytes=" + have + "-");
                int code = conn.getResponseCode();
                boolean append = code == HttpURLConnection.HTTP_PARTIAL;
                if (code != HttpURLConnection.HTTP_OK && !append) return "DOWNLOAD_FAILED:다운로드 서버 응답 오류 (HTTP " + code + ").";
                if (!append) {
                    have = 0;
                    d.completed = 0;
                }
                long lastNotify = 0;
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part, append)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (d.cancel.get()) return "CANCELLED:다운로드를 취소했습니다. 다시 누르면 이어서 받습니다.";
                        out.write(buf, 0, n);
                        d.completed += n;
                        long now = System.currentTimeMillis();
                        if (now - lastNotify > 500) {
                            lastNotify = now;
                            notifyChanged();
                        }
                    }
                }
                if (part.length() != m.bytes) return "DOWNLOAD_FAILED:다운로드가 끝나기 전에 연결이 끊어졌습니다. 다시 누르면 이어서 받습니다.";
            }
            d.status = "verifying";
            notifyChanged();
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream in = new FileInputStream(part)) {
                byte[] buf = new byte[1 << 20];
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (d.cancel.get()) return "CANCELLED:무결성 검사를 취소했습니다.";
                    md.update(buf, 0, n);
                }
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest()) hex.append(String.format("%02x", b));
            if (!hex.toString().equals(m.sha256)) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                return "INTEGRITY_FAILED:받은 모델 파일이 공식 파일과 일치하지 않아 삭제했습니다. 다시 다운로드해 주세요.";
            }
            File dst = LocalLlmModels.fileOf(getContext(), m);
            if (!part.renameTo(dst)) return "DOWNLOAD_FAILED:모델 파일을 저장하지 못했습니다.";
            LocalLlmModels.markVerified(getContext(), m);
            return null;
        } catch (Exception e) {
            return "DOWNLOAD_FAILED:다운로드 중 오류가 발생했습니다 (" + e.getClass().getSimpleName() + "). 다시 누르면 이어서 받습니다.";
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ------------------------------------------------------------------ chat

    @PluginMethod
    public void chat(PluginCall call) {
        final String requestId = call.getString("requestId", "req");
        JSONArray msgs = call.getArray("messages");
        final boolean json = Boolean.TRUE.equals(call.getBoolean("json", false));
        final int maxTokens = Math.max(16, Math.min(json ? 1536 : 900, call.getInt("maxTokens", 600)));
        Double t = call.getDouble("temperature");
        final float temperature = t != null ? (float) Math.max(0, Math.min(1, t)) : 0.3f;
        if (msgs == null || msgs.length() == 0) {
            call.resolve(chatError("EMPTY", "대화 내용이 비어 있습니다.", null));
            return;
        }
        final String[] roles = new String[msgs.length()];
        final String[] contents = new String[msgs.length()];
        try {
            for (int i = 0; i < msgs.length(); i++) {
                JSONObject mo = msgs.getJSONObject(i);
                roles[i] = mo.optString("role", "user");
                contents[i] = mo.optString("content", "");
            }
        } catch (Exception e) {
            call.resolve(chatError("EMPTY", "대화 형식이 올바르지 않습니다.", null));
            return;
        }
        final LocalLlmModels.Model m = LocalLlmModels.selected(getContext());
        if (!LocalLlmModels.installed(getContext(), m)) {
            call.resolve(chatError("MODEL_MISSING", "로컬 AI 모델 " + m.id + "이(가) 아직 설치되지 않았습니다.", null));
            return;
        }
        final AtomicBoolean cancel = new AtomicBoolean(false);
        cancels.put(requestId, cancel);
        engine.worker().execute(() -> {
            StringBuilder partial = new StringBuilder();
            try {
                // installed model + not in RAM → load it now (approval was given once at download)
                String err = engine.loadBlocking(m);
                if (err != null) {
                    String[] p = err.split(":", 2);
                    call.resolve(chatError(p[0], p.length > 1 ? p[1] : err, null));
                    return;
                }
                final long t0 = System.currentTimeMillis();
                final long[] first = {0};
                final int[] count = {0};
                String text = engine.generateBlocking(roles, contents, maxTokens, temperature, json, piece -> {
                    if (first[0] == 0) first[0] = System.currentTimeMillis() - t0;
                    count[0]++;
                    partial.append(piece);
                    JSObject ev = new JSObject();
                    ev.put("requestId", requestId);
                    ev.put("delta", piece);
                    notifyListeners("delta", ev);
                    return !cancel.get();
                });
                long ms = System.currentTimeMillis() - t0;
                JSObject run = new JSObject();
                run.put("firstTokenMs", first[0]);
                run.put("totalMs", ms);
                run.put("pieces", count[0]);
                run.put("piecesPerSec", ms > first[0] && count[0] > 1 ? (count[0] - 1) * 1000.0 / (ms - first[0]) : 0);
                run.put("promptChars", totalChars(contents));
                lastRun = run;
                if (cancel.get()) {
                    call.resolve(chatError("CANCELLED", "요청을 취소했습니다.", partial.toString()));
                    return;
                }
                if (text == null || text.trim().isEmpty()) {
                    call.resolve(chatError("BAD_RESPONSE", "로컬 AI가 빈 답변을 보냈습니다.", null));
                    return;
                }
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("text", text);
                r.put("model", m.id);
                r.put("evalCount", count[0]);
                r.put("ms", ms);
                call.resolve(r);
            } catch (IllegalStateException e) {
                String[] p = String.valueOf(e.getMessage()).split(":", 2);
                call.resolve(chatError(p[0], p.length > 1 ? p[1] : "로컬 AI 오류", partial.toString()));
            } catch (Throwable e) {
                call.resolve(chatError("UNKNOWN", "로컬 AI 엔진 오류가 발생했습니다.", partial.toString()));
            } finally {
                cancels.remove(requestId);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        AtomicBoolean c = cancels.get(call.getString("requestId", ""));
        if (c != null) c.set(true);
        JSObject r = new JSObject();
        r.put("ok", c != null);
        call.resolve(r);
    }

    // ------------------------------------------------------------------ helpers

    private static int totalChars(String[] s) {
        int n = 0;
        for (String x : s) n += x.length();
        return n;
    }

    private static JSObject chatError(String code, String message, String partial) {
        JSObject r = new JSObject();
        r.put("ok", false);
        r.put("code", "NOT_LOADED".equals(code) ? "NOT_RUNNING" : code);
        r.put("message", message);
        if (partial != null && !partial.isEmpty()) r.put("partial", partial);
        return r;
    }

    /** null → { ok: true } · "CODE:message" → { ok: false, code, message } */
    private static JSObject result(String err) {
        JSObject r = new JSObject();
        if (err == null) {
            r.put("ok", true);
            return r;
        }
        String[] p = err.split(":", 2);
        r.put("ok", false);
        r.put("code", p[0]);
        r.put("message", p.length > 1 ? p[1] : err);
        return r;
    }
}
