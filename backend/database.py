import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
from postgrest.exceptions import APIError
from supabase import create_client, Client
from supabase.lib.client_options import SyncClientOptions

from config import SUPABASE_URL, SUPABASE_KEY, DB_QUERY_CONCURRENCY  # also loads the .env files

BATCH_SIZE = 500

_client: Client | None = None
_client_lock = threading.Lock()


def get_client() -> Client:
    """
    One shared Supabase client for the whole process. Creating a client costs
    ~0.3-0.5 s, and every query used to build a new one. Its HTTP connection
    pool (httpx) is safe to use from several threads at once.
    """
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                if not SUPABASE_URL or not SUPABASE_KEY:
                    raise ValueError("Missing SUPABASE_URL or SUPABASE_KEY in .env file")
                # supabase-py defaults to one HTTP/2 connection that every request
                # shares; used from several threads at once the server dropped it
                # (ConnectionTerminated). HTTP/1.1 with a small pool gives each
                # parallel lookup its own connection.
                http = httpx.Client(
                    http2=False,
                    # Not postgrest's 120 s default: on a stalled connection (seen on
                    # this network) one lookup could hang for minutes and, via the
                    # shared pool, block every recognition. Supabase cancels queries
                    # itself after ~8 s, so waiting 20 s for data means the
                    # connection is dead; _read_with_retry then tries a fresh one.
                    timeout=httpx.Timeout(20.0, connect=10.0),
                    follow_redirects=True,
                    limits=httpx.Limits(
                        max_connections=DB_QUERY_CONCURRENCY + 4,
                        max_keepalive_connections=DB_QUERY_CONCURRENCY + 4,
                    ),
                )
                client = create_client(SUPABASE_URL, SUPABASE_KEY, options=SyncClientOptions(httpx_client=http))
                client.postgrest  # build the lazily-created REST client now, not racily in a worker thread
                _client = client
    return _client


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

# Supabase (PostgREST) returns at most this many rows per request and silently
# drops the rest, so any response this size may be truncated.
PG_MAX_ROWS = 1000

# Postgres error code when a query exceeds Supabase's statement timeout.
STATEMENT_TIMEOUT = "57014"


# Lookups run on a shared, bounded pool: chunks are fetched DB_QUERY_CONCURRENCY at
# a time instead of one after another. The pool is process-wide, so several
# recognitions running at once still can't open more than that many requests.
_lookup_pool = ThreadPoolExecutor(max_workers=DB_QUERY_CONCURRENCY, thread_name_prefix="fp-lookup")

QUERY_CHUNK_SIZE = 200


def query_fingerprints(hash_vals: list[str]) -> list[dict]:
    """
    Every fingerprint row whose hash is in hash_vals.

    A 200-hash chunk can match more than PG_MAX_ROWS rows (common hashes repeat
    across songs), and the API would silently cut it off. So a chunk that comes
    back full is split in half and re-queried; a single hash with that many rows
    is paged through by id.
    """
    client = get_client()
    # A hash listed twice could land in two chunks (or two halves of a split one)
    # and have its rows returned twice. Callers already pass unique hashes; this
    # just makes the lookup itself safe.
    hash_vals = list(dict.fromkeys(hash_vals))
    chunks = [hash_vals[i : i + QUERY_CHUNK_SIZE] for i in range(0, len(hash_vals), QUERY_CHUNK_SIZE)]
    if len(chunks) <= 1:
        return _fetch_chunk(client, chunks[0]) if chunks else []

    # map() keeps chunk order, so the rows come back in the same order every run.
    all_results = []
    for rows in _lookup_pool.map(lambda chunk: _fetch_chunk(client, chunk), chunks):
        all_results.extend(rows)
    return all_results


def _fetch_chunk(client: Client, chunk: list[str]) -> list[dict]:
    """
    All rows for one chunk of hashes. A chunk is split in half and re-queried if
    its response hits the row cap, or if the database cancels it for running too
    long (rare, but it happened once under parallel load); smaller queries finish
    faster and return the same rows between them.
    """
    results = []
    pending = [chunk]
    timeout_retries_left = 1  # for a single hash that keeps timing out
    while pending:
        part = pending.pop()
        try:
            rows = _read_with_retry(
                lambda: client.table("fingerprints")
                .select("hash, time_offset, song_id")
                .in_("hash", part)
                .execute()
            ).data
        except APIError as e:
            if e.code != STATEMENT_TIMEOUT:
                raise
            if len(part) > 1:
                mid = len(part) // 2
                pending += [part[:mid], part[mid:]]
                continue
            if timeout_retries_left:
                timeout_retries_left -= 1
                pending.append(part)
                continue
            raise

        if len(rows) < PG_MAX_ROWS:
            results.extend(rows)
        elif len(part) > 1:
            mid = len(part) // 2
            pending += [part[:mid], part[mid:]]
        else:
            results.extend(_all_rows_for_hash(client, part[0]))
    return results


def _read_with_retry(run, attempts: int = 3):
    """
    Run a read-only query, retrying if the connection itself fails (dropped or
    reset sockets, brief network loss). Lookups are safe to repeat; HTTP and
    database errors are not retried.
    """
    for attempt in range(attempts):
        try:
            return run()
        except httpx.TransportError as e:
            if attempt == attempts - 1:
                raise
            print(f"DB lookup retry {attempt + 1}/{attempts - 1} after {type(e).__name__}", flush=True)
            time.sleep(0.25 * (attempt + 1))


def _all_rows_for_hash(client: Client, hash_val: str) -> list[dict]:
    rows, start = [], 0
    while True:
        page = _read_with_retry(
            lambda: client.table("fingerprints")
            .select("hash, time_offset, song_id")
            .eq("hash", hash_val)
            .order("id")
            .range(start, start + PG_MAX_ROWS - 1)
            .execute()
        ).data
        rows.extend(page)
        if len(page) < PG_MAX_ROWS:
            return rows
        start += PG_MAX_ROWS


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
