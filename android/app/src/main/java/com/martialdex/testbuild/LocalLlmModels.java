package com.martialdex.testbuild;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.File;

/**
 * Models the on-device engine can run (GGUF, Q4_K_M). Sizes and SHA-256 are the official
 * Qwen repositories' published values (huggingface.co/Qwen/…-GGUF, LFS oid) — a download is
 * accepted only when its hash matches. qwen2.5:3b is the common model on every platform; the
 * 1.5B model is offered as the user's own choice, never switched to automatically.
 */
final class LocalLlmModels {

    static final class Model {
        final String id;
        final String label;
        final String file;
        final String url;
        final long bytes;
        final String sha256;
        /** RAM guidance shown to the user (not a hard block — measured behaviour decides). */
        final int minRamGb;

        Model(String id, String label, String file, String url, long bytes, String sha256, int minRamGb) {
            this.id = id;
            this.label = label;
            this.file = file;
            this.url = url;
            this.bytes = bytes;
            this.sha256 = sha256;
            this.minRamGb = minRamGb;
        }
    }

    static final Model[] ALL = {
        new Model(
            "qwen2.5:3b",
            "Qwen2.5 3B (기본 · 공통 모델)",
            "qwen2.5-3b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf",
            2104932768L,
            "626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d",
            6
        ),
        new Model(
            "qwen2.5:1.5b",
            "Qwen2.5 1.5B (가벼움 · 답변 품질 낮음)",
            "qwen2.5-1.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
            1117320736L,
            "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
            4
        ),
        new Model(
            "qwen2.5:0.5b",
            "Qwen2.5 0.5B (매우 가벼움 · 간단한 답변만)",
            "qwen2.5-0.5b-instruct-q4_k_m.gguf",
            "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
            491400032L,
            "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
            3
        ),
    };

    static final String DEFAULT_ID = "qwen2.5:3b";
    private static final String PREFS = "martialdex_local_llm";

    private LocalLlmModels() {}

    static Model byId(String id) {
        for (Model m : ALL) if (m.id.equals(id)) return m;
        return null;
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static Model selected(Context c) {
        Model m = byId(prefs(c).getString("model", DEFAULT_ID));
        return m != null ? m : byId(DEFAULT_ID);
    }

    static void select(Context c, String id) {
        prefs(c).edit().putString("model", id).apply();
    }

    static File dir(Context c) {
        File d = new File(c.getFilesDir(), "models");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    static File fileOf(Context c, Model m) {
        return new File(dir(c), m.file);
    }

    static File partOf(Context c, Model m) {
        return new File(dir(c), m.file + ".part");
    }

    /** Installed = the complete file is there AND its hash was verified once (marker stored after the check). */
    static boolean installed(Context c, Model m) {
        File f = fileOf(c, m);
        return f.isFile() && f.length() == m.bytes && m.sha256.equals(prefs(c).getString("verified:" + m.id, null));
    }

    static void markVerified(Context c, Model m) {
        prefs(c).edit().putString("verified:" + m.id, m.sha256).apply();
    }

    static void forget(Context c, Model m) {
        prefs(c).edit().remove("verified:" + m.id).apply();
    }
}
