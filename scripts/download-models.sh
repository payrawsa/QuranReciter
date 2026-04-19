#!/usr/bin/env bash
#
# Download Whisper GGML models from Hugging Face.
#
# Usage:
#   ./scripts/download-models.sh           # downloads the default (tiny) model
#   ./scripts/download-models.sh tiny      # downloads tiny only
#   ./scripts/download-models.sh small     # downloads small only
#   ./scripts/download-models.sh all       # downloads all models
#
# Models are saved to the models/ directory at the project root.
# This directory is git-ignored.

set -euo pipefail

BASE_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"
MODELS_DIR="$(cd "$(dirname "$0")/.." && pwd)/models"

get_model_file() {
  case "$1" in
    tiny)             echo "ggml-tiny.bin" ;;
    base)             echo "ggml-base.bin" ;;
    small)            echo "ggml-small.bin" ;;
    medium)           echo "ggml-medium.bin" ;;
    large-v3-turbo)   echo "ggml-large-v3-turbo.bin" ;;
    *)                echo "" ;;
  esac
}

ALL_SIZES="tiny base small medium large-v3-turbo"

download_model() {
  local size="$1"
  local file
  file="$(get_model_file "$size")"
  if [[ -z "$file" ]]; then
    echo "Unknown model size: $size"
    echo "Available: $ALL_SIZES all"
    return 1
  fi
  local dest="$MODELS_DIR/$file"

  if [[ -f "$dest" ]]; then
    echo "✓ $size model already exists at $dest"
    return 0
  fi

  echo "Downloading $size model ($file)..."
  curl -L --progress-bar -o "$dest" "$BASE_URL/$file"
  echo "✓ $size model saved to $dest"
}

mkdir -p "$MODELS_DIR"

TARGET="${1:-tiny}"

if [[ "$TARGET" == "all" ]]; then
  for size in $ALL_SIZES; do
    download_model "$size"
  done
else
  download_model "$TARGET"
fi

echo ""
echo "Done. To make models available to the iOS simulator, add the models/"
echo "folder to Xcode as a bundle resource (see INSTRUCTIONS.md)."
