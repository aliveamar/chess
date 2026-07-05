"""
Setup script to download and extract the Stockfish chess engine binary.
Downloads Stockfish 17 for Windows from GitHub releases.
"""

import os
import sys
import zipfile
import requests
import shutil

STOCKFISH_URL = "https://github.com/official-stockfish/Stockfish/releases/download/sf_17/stockfish-windows-x86-64-avx2.zip"
STOCKFISH_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stockfish")
STOCKFISH_EXE = os.path.join(STOCKFISH_DIR, "stockfish.exe")


def download_stockfish():
    """Download and extract Stockfish binary."""
    if os.path.exists(STOCKFISH_EXE):
        print(f"[OK] Stockfish already exists at: {STOCKFISH_EXE}")
        return STOCKFISH_EXE

    print("[*] Downloading Stockfish...")
    os.makedirs(STOCKFISH_DIR, exist_ok=True)

    zip_path = os.path.join(STOCKFISH_DIR, "stockfish.zip")

    try:
        response = requests.get(STOCKFISH_URL, stream=True, timeout=60)
        response.raise_for_status()

        total_size = int(response.headers.get("content-length", 0))
        downloaded = 0

        with open(zip_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    pct = (downloaded / total_size) * 100
                    print(f"\r[*] Downloading: {pct:.1f}%", end="", flush=True)

        print("\n[*] Extracting...")

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(STOCKFISH_DIR)

        # Find the extracted exe (it's usually nested in a subfolder)
        for root, dirs, files in os.walk(STOCKFISH_DIR):
            for file in files:
                if file.endswith(".exe") and "stockfish" in file.lower():
                    src = os.path.join(root, file)
                    if src != STOCKFISH_EXE:
                        shutil.move(src, STOCKFISH_EXE)
                    break

        # Clean up zip and empty dirs
        os.remove(zip_path)
        for item in os.listdir(STOCKFISH_DIR):
            item_path = os.path.join(STOCKFISH_DIR, item)
            if os.path.isdir(item_path):
                shutil.rmtree(item_path)

        if os.path.exists(STOCKFISH_EXE):
            print(f"[OK] Stockfish installed at: {STOCKFISH_EXE}")
            return STOCKFISH_EXE
        else:
            print("[ERROR] Could not find stockfish executable after extraction.")
            sys.exit(1)

    except requests.RequestException as e:
        print(f"\n[ERROR] Failed to download Stockfish: {e}")
        print("[*] Please download manually from: https://stockfishchess.org/download/")
        print(f"[*] Place the .exe file at: {STOCKFISH_EXE}")
        sys.exit(1)
    except zipfile.BadZipFile:
        print("[ERROR] Downloaded file is not a valid zip.")
        if os.path.exists(zip_path):
            os.remove(zip_path)
        sys.exit(1)


if __name__ == "__main__":
    exe_path = download_stockfish()
    print(f"\n[OK] Setup complete! Stockfish path: {exe_path}")
    print("[*] Run 'python app.py' to start the chess server.")
