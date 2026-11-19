package com.martialdex.testbuild;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom (non-npm) plugins — must be registered manually before
        // super.onCreate() so the Bridge picks it up. See
        // SparringCameraPlugin.java / BackgroundRecordingService.java /
        // InAppBrowserPlugin.java / NativeTtsPlugin.java.
        registerPlugin(SparringCameraPlugin.class);
        registerPlugin(InAppBrowserPlugin.class);
        // Android WebView has no speechSynthesis — coach voice / mitt calls go through this (src/lib/voice/tts.ts).
        registerPlugin(NativeTtsPlugin.class);
        // 로컬 AI 엔진 (llama.cpp on the device) — src/lib/localAi/engineControl.ts.
        registerPlugin(LocalLlmPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
