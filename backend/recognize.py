import sys
sys.path.append("..")

from fingerprint import fingerprint
from database import query_fingerprints, get_song_by_id
from collections import Counter

def recognize(audio_file: str):
    print(f"🔍 Fingerprinting clip: {audio_file}")
    hashes = fingerprint(audio_file)
    print(f"   Got {len(hashes)} hashes from clip")

    # extract just the hash strings (ignore time offsets for now)
    hash_vals = [h[0] for h in hashes]

    # query DB for matches
    print("🔎 Querying database...")
    matches = query_fingerprints(hash_vals)
    print(f"   Found {len(matches)} matching fingerprints")

    if not matches:
        print("❌ No match found.")
        return None

    # vote — which song_id appears most?
    song_id_counts = Counter(m["song_id"] for m in matches)
    best_song_id, hit_count = song_id_counts.most_common(1)[0]

    print(f"\n🏆 Best match: song_id={best_song_id} with {hit_count} matching hashes")

    # fetch full song details
    song = get_song_by_id(best_song_id)
    
    print(f"\n🎵 RESULT:")
    print(f"   Title  : {song['title']}")
    print(f"   Artist : {song['artist']}")
    print(f"   YouTube: {song['youtube_url']}")

    return song


if __name__ == "__main__":
    from record import record_clip

    # Step 1: record from mic
    clip_path = record_clip(duration=10)

    # Step 2: recognize it
    recognize(clip_path)
