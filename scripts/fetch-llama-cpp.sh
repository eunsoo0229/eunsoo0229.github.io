#!/bin/sh
# Fetches the pinned llama.cpp source used by the Android on-device AI engine
# (android/app/src/main/cpp → LocalLlm plugin). Source only — no model files.
# Re-run after changing LLAMA_CPP_TAG. The folder is git-ignored.
set -e
LLAMA_CPP_TAG="b12034"
DIR="$(cd "$(dirname "$0")/.." && pwd)/android/third_party/llama.cpp"
if [ -f "$DIR/.martialdex-tag" ] && [ "$(cat "$DIR/.martialdex-tag")" = "$LLAMA_CPP_TAG" ]; then
  echo "llama.cpp $LLAMA_CPP_TAG already present"; exit 0
fi
rm -rf "$DIR"
git clone --depth 1 --branch "$LLAMA_CPP_TAG" https://github.com/ggml-org/llama.cpp.git "$DIR"
rm -rf "$DIR/.git"
echo "$LLAMA_CPP_TAG" > "$DIR/.martialdex-tag"
echo "llama.cpp $LLAMA_CPP_TAG → $DIR"
