# MARTIALDEX on-device AI engine (LocalLlmPlugin → local_llm.cpp → llama.cpp).
# llama.cpp source: android/third_party/llama.cpp, fetched by scripts/fetch-llama-cpp.sh (pinned tag).
# Build flags follow llama.cpp's own Android example (examples/llama.android): CPU backend variants are
# built as separate libraries and the best one for the phone's CPU is loaded at runtime (no SIGILL on
# older ARM cores).
cmake_minimum_required(VERSION 3.22.1)

project("martialdex_llm" LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED true)

if(ANDROID_ABI STREQUAL "arm64-v8a")
    set(GGML_SYSTEM_ARCH "ARM")
    set(GGML_CPU_KLEIDIAI ON)
    set(GGML_OPENMP ON)
elseif(ANDROID_ABI STREQUAL "x86_64")
    # emulator only (functional tests) — performance numbers from it are not representative
    set(GGML_SYSTEM_ARCH "x86")
    set(GGML_CPU_KLEIDIAI OFF)
    set(GGML_OPENMP OFF)
else()
    message(FATAL_ERROR "Unsupported ABI: ${ANDROID_ABI}")
endif()

set(LLAMA_SRC ${CMAKE_CURRENT_LIST_DIR}/../../../../third_party/llama.cpp)
if(NOT EXISTS ${LLAMA_SRC}/CMakeLists.txt)
    message(FATAL_ERROR "llama.cpp source missing — run scripts/fetch-llama-cpp.sh")
endif()
add_subdirectory(${LLAMA_SRC} build-llama)

add_library(martialdex_llm SHARED local_llm.cpp)

target_include_directories(martialdex_llm PRIVATE
        ${LLAMA_SRC}/include
        ${LLAMA_SRC}/common
        ${LLAMA_SRC}/ggml/include)

target_link_libraries(martialdex_llm llama llama-common android log)
