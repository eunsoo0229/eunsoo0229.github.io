package com.martialdex.testbuild;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Speech OUTPUT on Android. The Android System WebView does not implement
 * the Web Speech API (window.speechSynthesis is missing), so every coach line
 * and every mitt call was silent in the APK. This speaks through the
 * device's own TextToSpeech engine instead (src/lib/voice/tts.ts uses it
 * automatically on Android).
 *
 *   speak({ text, id, rate, flush })  resolves when the line really finished:
 *                                    { done: true } / { canceled: true } / reject(error)
 *   stop()                           drops what is speaking and queued (pending calls resolve canceled)
 *   isAvailable()                    { available, korean }
 *
 * "start" events ({ id }) are sent when the engine actually starts a line.
 */
@CapacitorPlugin(name = "NativeTts")
public class NativeTtsPlugin extends Plugin {

    private TextToSpeech tts;
    private volatile boolean ready = false;
    private volatile boolean failed = false;
    private volatile boolean korean = false;
    private final Map<String, PluginCall> pending = new ConcurrentHashMap<>();

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), status -> {
            if (status != TextToSpeech.SUCCESS) {
                failed = true;
                return;
            }
            int r = tts.setLanguage(Locale.KOREAN);
            korean = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) {
                    JSObject ev = new JSObject();
                    ev.put("id", id);
                    notifyListeners("start", ev);
                }

                @Override
                public void onDone(String id) {
                    PluginCall call = pending.remove(id);
                    if (call != null) {
                        JSObject res = new JSObject();
                        res.put("done", true);
                        call.resolve(res);
                    }
                }

                @Override
                public void onStop(String id, boolean interrupted) {
                    PluginCall call = pending.remove(id);
                    if (call != null) {
                        JSObject res = new JSObject();
                        res.put("canceled", true);
                        call.resolve(res);
                    }
                }

                @Override
                @SuppressWarnings("deprecation")
                public void onError(String id) {
                    PluginCall call = pending.remove(id);
                    if (call != null) call.reject("synthesis-failed");
                }

                @Override
                public void onError(String id, int errorCode) {
                    PluginCall call = pending.remove(id);
                    if (call != null) call.reject(errorCode == TextToSpeech.ERROR_NETWORK || errorCode == TextToSpeech.ERROR_NETWORK_TIMEOUT ? "network" : "synthesis-failed");
                }
            });
            ready = true;
            // Warm the engine up silently: the first real line otherwise waits while the voice model loads
            Bundle warm = new Bundle();
            warm.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 0f);
            tts.speak("준비", TextToSpeech.QUEUE_ADD, warm, "warmup");
        });
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject res = new JSObject();
        res.put("available", ready && !failed);
        res.put("initializing", !ready && !failed);
        res.put("korean", korean);
        call.resolve(res);
    }

    @PluginMethod(returnType = PluginMethod.RETURN_PROMISE)
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String id = call.getString("id", String.valueOf(System.nanoTime()));
        if (failed) {
            call.reject("synthesis-unavailable");
            return;
        }
        if (!ready) {
            call.reject("initializing");
            return;
        }
        if (text == null || text.trim().isEmpty()) {
            JSObject res = new JSObject();
            res.put("done", true);
            call.resolve(res);
            return;
        }
        Double rate = call.getDouble("rate", 1.0);
        boolean flush = Boolean.TRUE.equals(call.getBoolean("flush", false));
        tts.setSpeechRate(rate == null ? 1.0f : rate.floatValue());
        if (flush) cancelPending();
        call.setKeepAlive(false);
        pending.put(id, call);
        Bundle params = new Bundle();
        int r = tts.speak(text, flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, params, id);
        if (r != TextToSpeech.SUCCESS) {
            pending.remove(id);
            call.reject("synthesis-failed");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        cancelPending();
        call.resolve();
    }

    private void cancelPending() {
        for (Map.Entry<String, PluginCall> e : pending.entrySet()) {
            JSObject res = new JSObject();
            res.put("canceled", true);
            e.getValue().resolve(res);
        }
        pending.clear();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        super.handleOnDestroy();
    }
}
