import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

BATCH_SIZE = 500


def get_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY in .env file")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ─────────────────────────────────────────────
# STORING A SONG
# ─────────────────────────────────────────────

def store_song(title: str, artist: str, filename: str, youtube_url: str = None) -> int:
    """
    Insert a song into the songs table.
    Returns the new song's id.
    """
    client = get_client()

    response = (
        client.table("songs")
        .insert({
            "title": title,
            "artist": artist,
            "filename": filename,
            "youtube_url": youtube_url
        })
        .execute()
    )

    song_id = response.data[0]["id"]
    print(f"Stored '{title}' by {artist} with id={song_id}")
    return song_id


# ─────────────────────────────────────────────
# STORING FINGERPRINTS
# ─────────────────────────────────────────────

def store_fingerprints(hashes: list[tuple], song_id: int) -> None:
    """
    Bulk insert all hashes for a song into the fingerprints table.

    hashes: list of (hash_val, time_offset) tuples from fingerprint.py
    song_id: the id returned by store_song()
    """
    client = get_client()

    rows = [
        {
            "hash": hash_val,
            "time_offset": time_offset,
            "song_id": song_id
        }
        for hash_val, time_offset in hashes
    ]

    total = len(rows)
    inserted = 0

    for i in range(0, total, BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        client.table("fingerprints").insert(batch).execute()
        inserted += len(batch)
        print(f"  Inserted {inserted}/{total} fingerprints...")

    print(f"Done — {total} fingerprints stored for song_id={song_id}")


# ─────────────────────────────────────────────
# QUERYING FINGERPRINTS (used during recognition)
# ─────────────────────────────────────────────

def query_fingerprints(hash_vals: list[str]) -> list[dict]:
    client = get_client()
    
    QUERY_CHUNK_SIZE = 200  # smaller chunks
    all_results = []

    for i in range(0, len(hash_vals), QUERY_CHUNK_SIZE):
        chunk = hash_vals[i : i + QUERY_CHUNK_SIZE]
        
        response = (
            client.table("fingerprints")
            .select("hash, time_offset, song_id")
            .in_("hash", chunk)
            .execute()
        )
        
        all_results.extend(response.data)

    return all_results


# ─────────────────────────────────────────────
# FETCHING SONG DETAILS (used to return the result)
# ─────────────────────────────────────────────

def get_song_by_id(song_id: int) -> dict:
    """
    Fetch a song's full details by its id.
    Returns a dict like:
    { "id": 3, "title": "Blinding Lights", "artist": "The Weeknd", "filename": "...", "youtube_url": "..." }
    """
    client = get_client()

    response = (
        client.table("songs")
        .select("*")
        .eq("id", song_id)
        .execute()
    )

    if not response.data:
        return None

    return response.data[0]


# ─────────────────────────────────────────────
# CONVENIENCE: STORE A FULL SONG IN ONE CALL
# ─────────────────────────────────────────────

def store_song_with_fingerprints(
    title: str,
    artist: str,
    filename: str,
    hashes: list[tuple],
    youtube_url: str = None
) -> int:
    """
    Convenience wrapper — stores the song row then all its fingerprints.
    Use this from your ingestion script.
    Returns the song_id.
    """
    song_id = store_song(title, artist, filename, youtube_url)
    store_fingerprints(hashes, song_id)
    return song_id


# ─────────────────────────────────────────────
# QUICK TEST
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    sys.path.append("..")
    from fingerprint import fingerprint

    test_file = "../data/songs/test6.mp3"

    print("Fingerprinting...")
    hashes = fingerprint(test_file)
    print(f"Got {len(hashes)} hashes")

    print("\nStoring in Supabase...")
    song_id = store_song_with_fingerprints(
        title="Test Song",
        artist="Test Artist",
        filename="test6.mp3",
        hashes=hashes,
        youtube_url=None
    )

    print(f"\nVerifying — fetching song id={song_id}")
    song = get_song_by_id(song_id)
    print(f"Found: {song}")

    print(f"\nVerifying — querying first 5 hashes back")
    sample_hashes = [h[0] for h in hashes[:5]]
    results = query_fingerprints(sample_hashes)
    print(f"Got {len(results)} matching rows")
    print(results[:3])
