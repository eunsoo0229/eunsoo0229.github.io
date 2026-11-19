// MARTIALDEX on-device AI engine — JNI bridge to llama.cpp for LocalLlmEngine.java.
//
// One model + one context at a time (the engine is a single-user, single-request runtime):
//   nativeInit(libDir)                     load the CPU backend variant that fits this phone
//   nativeLoad(path, nCtx, nThreads)       model + context into RAM            → 0 ok / <0 error
//   nativeGenerate(roles, contents, ...)   one chat completion, tokens streamed to the callback;
//                                          the callback returning false stops generation (cancel)
//   nativeUnload()                         frees model + context (RAM back to the OS)
// Every request starts from an empty KV cache: requests are independent (the app sends the whole
// conversation each time, same as the desktop path), so nothing leaks between features.

#include <android/log.h>
#include <jni.h>

#include <algorithm>
#include <atomic>
#include <string>
#include <vector>

#include "common.h"
#include "llama.h"

#define TAG "MartialdexLlm"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

namespace {

constexpr int BATCH_SIZE = 256;

// Same JSON grammar as llama.cpp's grammars/json.gbnf (JSON mode for structured features).
const char *JSON_GRAMMAR = R"GBNF(
root   ::= object | array
value  ::= object | array | string | number | ("true" | "false" | "null") ws
object ::= "{" ws ( string ":" ws value ("," ws string ":" ws value)* )? "}" ws
array  ::= "[" ws ( value ("," ws value)* )? "]" ws
string ::= "\"" ( [^"\\\x7F\x00-\x1F] | "\\" (["\\bfnrt] | "u" [0-9a-fA-F]{4}) )* "\"" ws
number ::= ("-"? ([0-9] | [1-9] [0-9]{0,15})) ("." [0-9]+)? ([eE] [-+]? [0-9] [1-9]{0,15})? ws
ws     ::= | " " | "\n" [ \t]{0,20}
)GBNF";

llama_model *g_model = nullptr;
llama_context *g_ctx = nullptr;
std::atomic<bool> g_backend_ready{false};

void log_cb(ggml_log_level level, const char *text, void *) {
    if (level >= GGML_LOG_LEVEL_WARN) __android_log_print(level >= GGML_LOG_LEVEL_ERROR ? ANDROID_LOG_ERROR : ANDROID_LOG_WARN, TAG, "%s", text);
}

void free_all() {
    if (g_ctx) llama_free(g_ctx);
    if (g_model) llama_model_free(g_model);
    g_ctx = nullptr;
    g_model = nullptr;
}

std::string jstr(JNIEnv *env, jstring s) {
    if (!s) return {};
    const char *c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

// Complete UTF-8 prefix length (a token can end in the middle of a Korean syllable).
size_t valid_utf8_prefix(const std::string &s) {
    size_t i = 0, last_ok = 0;
    while (i < s.size()) {
        const auto c = (unsigned char) s[i];
        const size_t n = c < 0x80 ? 1 : (c >> 5) == 0x6 ? 2 : (c >> 4) == 0xE ? 3 : (c >> 3) == 0x1E ? 4 : 0;
        if (n == 0) { i++; last_ok = i; continue; } // invalid byte: skip it
        if (i + n > s.size()) break;
        i += n;
        last_ok = i;
    }
    return last_ok;
}

// Java's NewStringUTF expects modified UTF-8; go through a byte[] + new String(bytes, UTF_8) instead.
jstring to_jstring(JNIEnv *env, const std::string &s) {
    jbyteArray bytes = env->NewByteArray((jsize) s.size());
    env->SetByteArrayRegion(bytes, 0, (jsize) s.size(), (const jbyte *) s.data());
    jclass str_cls = env->FindClass("java/lang/String");
    jmethodID ctor = env->GetMethodID(str_cls, "<init>", "([BLjava/lang/String;)V");
    jstring charset = env->NewStringUTF("UTF-8");
    auto out = (jstring) env->NewObject(str_cls, ctor, bytes, charset);
    env->DeleteLocalRef(bytes);
    env->DeleteLocalRef(charset);
    env->DeleteLocalRef(str_cls);
    return out;
}

} // namespace

extern "C" JNIEXPORT void JNICALL
Java_com_martialdex_testbuild_LocalLlmEngine_nativeInit(JNIEnv *env, jclass, jstring lib_dir) {
    if (g_backend_ready.exchange(true)) return;
    llama_log_set(log_cb, nullptr);
    const std::string dir = jstr(env, lib_dir);
    ggml_backend_load_all_from_path(dir.c_str());
    llama_backend_init();
    LOGI("backend ready: %s", llama_print_system_info());
}

/** → 0 ok · -1 model load failed · -2 context failed (usually out of memory) */
extern "C" JNIEXPORT jint JNICALL
Java_com_martialdex_testbuild_LocalLlmEngine_nativeLoad(JNIEnv *env, jclass, jstring jpath, jint n_ctx, jint n_threads) {
    free_all();
    const std::string path = jstr(env, jpath);
    llama_model_params mp = llama_model_default_params();
    mp.load_mode = LLAMA_LOAD_MODE_MMAP; // weights stay file-backed: the OS can page them out under memory pressure
    g_model = llama_model_load_from_file(path.c_str(), mp);
    if (!g_model) return -1;
    llama_context_params cp = llama_context_default_params();
    cp.n_ctx = (uint32_t) n_ctx;
    cp.n_batch = BATCH_SIZE;
    cp.n_ubatch = BATCH_SIZE;
    cp.n_threads = n_threads;
    cp.n_threads_batch = n_threads;
    g_ctx = llama_init_from_model(g_model, cp);
    if (!g_ctx) {
        free_all();
        return -2;
    }
    LOGI("loaded %s ctx=%d threads=%d", path.c_str(), n_ctx, n_threads);
    return 0;
}

extern "C" JNIEXPORT void JNICALL
Java_com_martialdex_testbuild_LocalLlmEngine_nativeUnload(JNIEnv *, jclass) {
    free_all();
}

extern "C" JNIEXPORT jlong JNICALL
Java_com_martialdex_testbuild_LocalLlmEngine_nativeModelBytes(JNIEnv *, jclass) {
    return g_model ? (jlong) llama_model_size(g_model) : 0;
}

/**
 * One chat completion. callback: an object with `boolean onToken(String piece)` (false = stop).
 * Returns the generated text; throws IllegalStateException("CODE:message") on failure
 * (NOT_LOADED · TOO_LONG · DECODE_FAILED · TEMPLATE_FAILED).
 */
extern "C" JNIEXPORT jstring JNICALL
Java_com_martialdex_testbuild_LocalLlmEngine_nativeGenerate(JNIEnv *env, jclass, jobjectArray jroles, jobjectArray jcontents,
                                                           jint max_tokens, jfloat temperature, jboolean json, jobject callback) {
    jclass ise = env->FindClass("java/lang/IllegalStateException");
    if (!g_model || !g_ctx) {
        env->ThrowNew(ise, "NOT_LOADED:모델이 메모리에 없습니다.");
        return nullptr;
    }
    const llama_vocab *vocab = llama_model_get_vocab(g_model);

    // 1. chat template (Qwen2.5 = ChatML, from the GGUF's own template)
    const jsize n = env->GetArrayLength(jroles);
    std::vector<std::string> roles(n), contents(n);
    std::vector<llama_chat_message> msgs(n);
    for (jsize i = 0; i < n; i++) {
        roles[i] = jstr(env, (jstring) env->GetObjectArrayElement(jroles, i));
        contents[i] = jstr(env, (jstring) env->GetObjectArrayElement(jcontents, i));
    }
    for (jsize i = 0; i < n; i++) msgs[i] = {roles[i].c_str(), contents[i].c_str()};
    const char *tmpl = llama_model_chat_template(g_model, nullptr);
    std::vector<char> buf(16384);
    int len = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true, buf.data(), (int32_t) buf.size());
    if (len > (int) buf.size()) {
        buf.resize(len + 1);
        len = llama_chat_apply_template(tmpl, msgs.data(), msgs.size(), true, buf.data(), (int32_t) buf.size());
    }
    if (len < 0) {
        env->ThrowNew(ise, "TEMPLATE_FAILED:대화 형식을 만들지 못했습니다.");
        return nullptr;
    }
    const std::string prompt(buf.data(), len);

    // 2. prompt → tokens; must leave room for the answer
    const std::vector<llama_token> tokens = common_tokenize(vocab, prompt, true, true);
    const int n_ctx = (int) llama_n_ctx(g_ctx);
    const int budget = std::max(16, std::min((int) max_tokens, n_ctx - (int) tokens.size() - 4));
    if ((int) tokens.size() + 16 > n_ctx) {
        env->ThrowNew(ise, "TOO_LONG:로컬 AI에 보내기에는 내용이 너무 깁니다.");
        return nullptr;
    }

    // 3. sampler: repeat penalty for free text only (JSON copies quotes verbatim), grammar for JSON mode
    llama_sampler *smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (json) llama_sampler_chain_add(smpl, llama_sampler_init_grammar(vocab, JSON_GRAMMAR, "root"));
    else llama_sampler_chain_add(smpl, llama_sampler_init_penalties(llama_vocab_n_tokens(vocab), 256, 1.1f, 0.0f, 0.0f));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.9f, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(std::max(0.0f, (float) temperature)));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    jclass cb_cls = env->GetObjectClass(callback);
    jmethodID on_token = env->GetMethodID(cb_cls, "onToken", "(Ljava/lang/String;)Z");

    // 4. prefill in batches from an empty cache
    llama_memory_clear(llama_get_memory(g_ctx), true);
    common_batch batch(g_ctx);
    for (int i = 0; i < (int) tokens.size(); i += BATCH_SIZE) {
        const int m = std::min((int) tokens.size() - i, BATCH_SIZE);
        batch.clear();
        for (int j = 0; j < m; j++) batch.add(tokens[i + j], i + j, 0, i + j == (int) tokens.size() - 1);
        if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch.get()) != 0) {
            llama_sampler_free(smpl);
            env->ThrowNew(ise, "DECODE_FAILED:프롬프트 처리에 실패했습니다 (메모리 부족일 수 있습니다).");
            return nullptr;
        }
    }

    // 5. generate
    std::string out, pending;
    llama_pos pos = (llama_pos) tokens.size();
    bool stopped = false;
    for (int k = 0; k < budget && !stopped; k++) {
        const llama_token id = llama_sampler_sample(smpl, g_ctx, -1);
        if (llama_vocab_is_eog(vocab, id)) break;
        pending += common_token_to_piece(vocab, id, false);
        const size_t ok = valid_utf8_prefix(pending);
        if (ok > 0) {
            const std::string piece = pending.substr(0, ok);
            pending.erase(0, ok);
            out += piece;
            jstring jp = to_jstring(env, piece);
            const jboolean go = env->CallBooleanMethod(callback, on_token, jp);
            env->DeleteLocalRef(jp);
            if (env->ExceptionCheck() || !go) stopped = true;
        }
        if (stopped) break;
        batch.clear();
        batch.add(id, pos++, 0, true);
        if (llama_process(g_ctx, LLAMA_PROCESS_TYPE_DECODE, batch.get()) != 0) {
            llama_sampler_free(smpl);
            env->ThrowNew(ise, "DECODE_FAILED:답변 생성 중 오류가 발생했습니다.");
            return nullptr;
        }
    }
    llama_sampler_free(smpl);
    llama_memory_clear(llama_get_memory(g_ctx), true);
    if (env->ExceptionCheck()) return nullptr;
    return to_jstring(env, out);
}
