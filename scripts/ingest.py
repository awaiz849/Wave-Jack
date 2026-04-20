import os
import sys

# point to backend folder
sys.path.append(os.path.join(os.path.dirname(__file__), "../backend"))

from fingerprint import fingerprint
from database import store_song_with_fingerprints

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

SONGS_DIR = os.path.join(os.path.dirname(__file__), "../data/songs")

# ─────────────────────────────────────────────
# HELPER: extract a clean title from filename
# ─────────────────────────────────────────────

def parse_filename(filename: str):
    """
    Tries to extract title and artist from filename.
    
    Supported formats:
      "Artist - Title.mp3"  →  artist="Artist", title="Title"
      "songname.mp3"        →  artist="Unknown", title="songname"
    """
    name = os.path.splitext(filename)[0]  # remove .mp3
    
    if " - " in name:
        parts = name.split(" - ", 1)
        return parts[0].strip(), parts[1].strip()  # artist, title
    else:
        return "Unknown", name.strip()  # artist, title

# ─────────────────────────────────────────────
# MAIN INGESTION LOOP
# ─────────────────────────────────────────────

def ingest_all():
    # get all mp3 files in the songs directory
    all_files = [f for f in os.listdir(SONGS_DIR) if f.endswith(".mp3")]

    if not all_files:
        print("❌ No MP3 files found in data/songs/")
        return

    print(f"🎵 Found {len(all_files)} MP3 file(s) to ingest\n")

    success = 0
    failed = 0

    for i, filename in enumerate(all_files, 1):
        filepath = os.path.join(SONGS_DIR, filename)
        artist, title = parse_filename(filename)

        print(f"[{i}/{len(all_files)}] Processing: {filename}")
        print(f"   Title  : {title}")
        print(f"   Artist : {artist}")

        try:
            print(f"   Fingerprinting...")
            hashes = fingerprint(filepath)
            print(f"   Got {len(hashes)} hashes")

            print(f"   Storing in Supabase...")
            song_id = store_song_with_fingerprints(
                title=title,
                artist=artist,
                filename=filename,
                hashes=hashes,
                youtube_url=None
            )

            print(f"   ✅ Done! song_id={song_id}\n")
            success += 1

        except Exception as e:
            print(f"   ❌ Failed: {e}\n")
            failed += 1

    print("─────────────────────────────")
    print(f"✅ Success : {success} songs")
    print(f"❌ Failed  : {failed} songs")
    print("─────────────────────────────")


if __name__ == "__main__":
    ingest_all()
