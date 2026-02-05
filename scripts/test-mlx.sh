#!/bin/bash
cd /Users/kempb/Projects && HF_HUB_DISABLE_SSL_VERIFY=1 uv run python -m mlx_lm.server --model mlx-community/Ministral-3-14B-Instruct-2512-4bit --host 127.0.0.1 --port 8080
