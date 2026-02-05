#!/usr/bin/env python3
"""Download HuggingFace model with SSL verification disabled."""
import os
import sys
import ssl
import warnings

# Suppress warnings
warnings.filterwarnings('ignore')

# Disable SSL verification at the lowest level
ssl._create_default_https_context = ssl._create_unverified_context
os.environ['PYTHONHTTPSVERIFY'] = '0'

# Patch httpx before importing huggingface_hub
try:
    import httpx._client
    original_init = httpx._client.Client.__init__

    def new_init(self, *args, **kwargs):
        # Force verify=False
        kwargs.pop('verify', None)
        return original_init(self, *args, verify=False, **kwargs)

    httpx._client.Client.__init__ = new_init
    print("✓ Patched httpx Client")
except Exception as e:
    print(f"Warning: Could not patch httpx: {e}")

# Now import and use huggingface_hub
from huggingface_hub import snapshot_download

model_id = "mlx-community/Ministral-3-14B-Instruct-2512-4bit"
local_dir = os.path.expanduser("~/.cache/mlx-models/ministral-3-14b")

print(f"Downloading {model_id}")
print(f"To: {local_dir}")
print("This will download ~8.4GB...")
print()

try:
    path = snapshot_download(
        repo_id=model_id,
        local_dir=local_dir,
        local_dir_use_symlinks=False,
    )
    print(f"\n✓ Download complete!")
    print(f"Model saved to: {path}")
except Exception as e:
    print(f"\n✗ Download failed: {e}")
    sys.exit(1)
