package com.martialdex.testbuild;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Process;
import android.util.Log;

import java.io.File;
import java.io.RandomAccessFile;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The on-device AI runtime (llama.cpp via local_llm.cpp). Process-wide singleton, owned by the
 * app process: nothing runs unless the user starts it or a feature asks for an installed model,
 * and it is freed on 종료, on low-memory signals, after IDLE_UNLOAD_MS without requests, and when
 * the activity is destroyed. All native work runs on ONE background-priority thread, never on the
 * UI thread.
 */
final class LocalLlmEngine {

    interface TokenCallback {
        /** @return false to stop generating (cancel). */
        boolean onToken(String piece);
    }

    private static final String TAG = "MartialdexLlm";
    private static volatile boolean libraryLoaded = false;
    private static volatile String libraryError = null;

    static {
        try {
            System.loadLibrary("martialdex_llm");
            libraryLoaded = true;
        } catch (Throwable t) {
            libraryError = String.valueOf(t.getMessage());
        }
    }

    static native void nativeInit(String nativeLibDir);
    static native int nativeLoad(String path, int nCtx, int nThreads);
    static native void nativeUnload();
    static native long nativeModelBytes();
    static native String nativeGenerate(String[] roles, String[] contents, int maxTokens, float temperature, boolean json, TokenCallback cb);

    /** Single worker: inference + load/unload are serialized; UI thread is never blocked. */
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(() -> {
            // OpenMP workers inherit this thread's nice value — the UI and camera stay ahead of inference
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
            r.run();
        }, "martialdex-llm");
        t.setDaemon(true);
        return t;
    });

    private final Context app;
    private volatile String phase = "off"; // off · loading · running · error
    private volatile String loadedModelId = null;
    private volatile long loadedBytes = 0;
    private volatile String errorCode = null;
    private volatile String errorMessage = null;
    private volatile boolean generating = false;
    private volatile long lastUse = 0;
    private volatile int nCtx = 4096;
    private volatile int nThreads = 2;
    private volatile long lastLoadMs = 0;

    LocalLlmEngine(Context context) {
        this.app = context.getApplicationContext();
    }

    static boolean libraryAvailable() {
        return libraryLoaded;
    }

    static String libraryError() {
        return libraryError;
    }

    ExecutorService worker() {
        return worker;
    }

    String phase() {
        return phase;
    }

    String loadedModelId() {
        return loadedModelId;
    }

    long loadedBytes() {
        return loadedBytes;
    }

    String errorCode() {
        return errorCode;
    }

    String errorMessage() {
        return errorMessage;
    }

    boolean generating() {
        return generating;
    }

    long lastUse() {
        return lastUse;
    }

    int contextSize() {
        return nCtx;
    }

    int threads() {
        return nThreads;
    }

    long lastLoadMs() {
        return lastLoadMs;
    }

    static long deviceRamBytes(Context c) {
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mi);
        return mi.totalMem;
    }

    static long availRamBytes(Context c) {
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mi);
        return mi.availMem;
    }

    /** Performance cores only (big.LITTLE): cores whose max frequency is ≥ 80% of the fastest; 2–4 threads. */
    static int performanceCores() {
        int n = Runtime.getRuntime().availableProcessors();
        long[] freq = new long[n];
        long max = 0;
        for (int i = 0; i < n; i++) {
            try (RandomAccessFile f = new RandomAccessFile("/sys/devices/system/cpu/cpu" + i + "/cpufreq/cpuinfo_max_freq", "r")) {
                freq[i] = Long.parseLong(f.readLine().trim());
                max = Math.max(max, freq[i]);
            } catch (Exception ignored) {
                freq[i] = 0;
            }
        }
        int big = 0;
        for (long f : freq) if (max > 0 && f >= max * 0.8) big++;
        if (big == 0) big = Math.max(1, n / 2);
        return Math.max(2, Math.min(4, big));
    }

    /** Runs on the worker. Loads `m` unless it is already in RAM. → null ok, else "CODE:message". */
    String loadBlocking(LocalLlmModels.Model m) {
        if (!libraryLoaded) return fail("UNSUPPORTED_DEVICE", "이 기기에서는 로컬 AI 엔진 라이브러리를 불러올 수 없습니다 (" + libraryError + ").");
        if (m.id.equals(loadedModelId) && "running".equals(phase)) return null;
        File f = LocalLlmModels.fileOf(app, m);
        if (!LocalLlmModels.installed(app, m)) return fail("MODEL_MISSING", "모델 " + m.id + "이(가) 아직 설치되지 않았습니다.");
        // the model file is memory-mapped; what must fit in free RAM is roughly the file + KV cache + working buffers
        long need = m.bytes + 600L * 1024 * 1024;
        long avail = availRamBytes(app);
        if (avail < need) {
            return fail("LOW_MEMORY", String.format("지금 사용할 수 있는 메모리(%.1fGB)가 모델 실행에 필요한 양(약 %.1fGB)보다 적습니다. 다른 앱을 닫거나 더 작은 모델을 선택해 주세요.", avail / 1e9, need / 1e9));
        }
        phase = "loading";
        errorCode = null;
        errorMessage = null;
        LocalLlmPlugin.notifyChanged();
        nativeInit(app.getApplicationInfo().nativeLibraryDir);
        nCtx = deviceRamBytes(app) >= 7_500_000_000L ? 8192 : 4096;
        nThreads = performanceCores();
        long t0 = System.currentTimeMillis();
        int r = nativeLoad(f.getAbsolutePath(), nCtx, nThreads);
        lastLoadMs = System.currentTimeMillis() - t0;
        if (r != 0) {
            loadedModelId = null;
            loadedBytes = 0;
            return fail(r == -2 ? "LOW_MEMORY" : "LOAD_FAILED", r == -2 ? "메모리가 부족해 모델 실행 공간을 만들지 못했습니다." : "모델 파일을 불러오지 못했습니다.");
        }
        loadedModelId = m.id;
        loadedBytes = nativeModelBytes();
        phase = "running";
        lastUse = System.currentTimeMillis();
        Log.i(TAG, "loaded " + m.id + " in " + lastLoadMs + "ms ctx=" + nCtx + " threads=" + nThreads);
        LocalLlmPlugin.notifyChanged();
        return null;
    }

    /** Runs on the worker. */
    void unloadBlocking() {
        if (libraryLoaded) nativeUnload();
        loadedModelId = null;
        loadedBytes = 0;
        phase = "off";
        errorCode = null;
        errorMessage = null;
        LocalLlmPlugin.notifyChanged();
    }

    /** Runs on the worker. Throws IllegalStateException("CODE:message") from native on failure. */
    String generateBlocking(String[] roles, String[] contents, int maxTokens, float temperature, boolean json, TokenCallback cb) {
        generating = true;
        try {
            lastUse = System.currentTimeMillis();
            return nativeGenerate(roles, contents, maxTokens, temperature, json, cb);
        } finally {
            generating = false;
            lastUse = System.currentTimeMillis();
        }
    }

    private String fail(String code, String message) {
        phase = "MODEL_MISSING".equals(code) ? phase : "error";
        errorCode = code;
        errorMessage = message;
        LocalLlmPlugin.notifyChanged();
        return code + ":" + message;
    }
}
