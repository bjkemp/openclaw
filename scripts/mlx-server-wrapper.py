#!/usr/bin/env python3
"""Wrapper to start MLX server with SSL verification disabled."""
import ssl
import sys
import os

# Disable SSL verification globally
ssl._create_default_https_context = ssl._create_unverified_context

# Patch httpx to disable SSL verification
try:
    import httpx

    # Monkey-patch the Client class to always use verify=False
    original_init = httpx.Client.__init__
    def patched_init(self, *args, **kwargs):
        kwargs['verify'] = False
        return original_init(self, *args, **kwargs)
    httpx.Client.__init__ = patched_init

    # Also patch AsyncClient
    original_async_init = httpx.AsyncClient.__init__
    def patched_async_init(self, *args, **kwargs):
        kwargs['verify'] = False
        return original_async_init(self, *args, **kwargs)
    httpx.AsyncClient.__init__ = patched_async_init

    print("SSL verification disabled for httpx")
except ImportError:
    pass

# Now run the MLX server
from mlx_lm import server
sys.argv = [
    'mlx_lm.server',
    '--model', 'mlx-community/Ministral-3-14B-Instruct-2512-4bit',
    '--host', '127.0.0.1',
    '--port', '8080'
]
server.main()
