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

declare -A MODEL_FILES=(
  [tiny]="ggml-tiny.bin"
  [base]="ggml-base.bin"
  [small]="ggml-small.bin"
  [medium]="ggml-medium.bin"
)

download_model() {
  local size="$1"
  local file="${MODEL_FILES[$size]}"
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
  for size in tiny base small medium; do
    download_model "$size"
  done
else
  if [[ -z "${MODEL_FILES[$TARGET]+x}" ]]; then
    echo "Unknown model size: $TARGET"
    echo "Available: tiny, base, small, medium, all"
    exit 1
  fi
  download_model "$TARGET"
fi

echo ""
echo "Done. To make models available to the iOS simulator, add the models/"
echo "folder to Xcode as a bundle resource (see INSTRUCTIONS.md)."
