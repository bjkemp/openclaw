#!/bin/bash
set -e

MODEL_DIR="${HOME}/.cache/mlx-models/ministral-3-14b"
mkdir -p "${MODEL_DIR}"

echo "Downloading Ministral-3-14B model files..."
echo "This will download ~8.4GB to: ${MODEL_DIR}"
echo ""

BASE_URL="https://huggingface.co/mlx-community/Ministral-3-14B-Instruct-2512-4bit/resolve/main"

FILES=(
    "config.json"
    "model-00001-of-00003.safetensors"
    "model-00002-of-00003.safetensors"
    "model-00003-of-00003.safetensors"
    "model.safetensors.index.json"
    "special_tokens_map.json"
    "tokenizer.json"
    "tokenizer.model"
    "tokenizer_config.json"
)

cd "${MODEL_DIR}"

for file in "${FILES[@]}"; do
    if [ -f "${file}" ]; then
        echo "✓ ${file} already exists, skipping"
    else
        echo "Downloading ${file}..."
        curl -L --insecure "${BASE_URL}/${file}" -o "${file}"
    fi
done

echo ""
echo "Download complete! Model at: ${MODEL_DIR}"
echo "Update openclaw-service.sh to use: --model ${MODEL_DIR}"
