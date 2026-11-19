# Android 음성(TTS) 확인

Android WebView에는 `speechSynthesis`가 없어서, 음성은 앱의 `NativeTts` 플러그인
(`android/app/src/main/java/com/martialdex/testbuild/NativeTtsPlugin.java`)으로 나갑니다.
에뮬레이터에서 확인하는 방법(창·소리 없이):

    ~/Library/Android/sdk/emulator/emulator -avd Pixel_3a_API_33_x86_64 -no-window -no-audio -no-boot-anim &
    adb install -r android/app/build/outputs/apk/debug/app-debug.apk
    adb shell am start -n com.martialdex.testbuild/.MainActivity
    adb forward tcp:9333 localabstract:$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_[0-9]*" | head -1)
    node .devtools/android-tts/cdp.mjs .devtools/android-tts/plugin-check.js            # 플러그인: 한국어·완료·끊고 말하기
    node .devtools/android-tts/cdp.mjs .devtools/android-tts/wrestling-command-voice.js # 앱 화면: 레슬링 공격 지시 음성
    adb logcat -d | grep -E "NativeTts|GoogleTTS"
