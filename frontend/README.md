# 🎵 WaveJack — Identify Any Song in Seconds

WaveJack is a beautiful, real-time audio fingerprinting app that identifies songs from short audio clips — like Shazam, but built from scratch. Drop or record an audio snippet and WaveJack tells you the title, artist, and confidence score in seconds.

![WaveJack Hero](https://img.shields.io/badge/Built%20with-Lovable-7c3aed) ![License](https://img.shields.io/badge/license-MIT-cyan)

---

## 📖 Table of Contents

1. [Project Overview](#1-project-overview)
2. [Project Structure](#2-project-structure)
3. [Frontend Setup](#3-frontend-setup)
4. [Backend Setup](#4-backend-setup)
5. [Supabase Database Setup](#5-supabase-database-setup)
6. [API Endpoints](#6-api-endpoints)
7. [How Audio Fingerprinting Works](#7-how-audio-fingerprinting-works)
8. [Features](#8-features)
9. [How to Add Songs](#9-how-to-add-songs)
10. [Deployment Guide](#10-deployment-guide)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Project Overview

### What is WaveJack?

WaveJack is a full-stack song identification platform. Users tap a microphone, record ~7 seconds of audio (or upload a file), and WaveJack matches the clip against a database of known songs using **acoustic fingerprinting**.

### How it works (in simple terms)

Every song has a unique "audio DNA" — a pattern of loud peaks at specific frequencies and times. WaveJack:

1. **Listens** to a short clip of the unknown song.
2. **Converts** it into a visual map of frequency vs. time (a spectrogram).
3. **Picks out** the loudest peaks — these are robust against noise.
4. **Hashes** pairs of peaks into compact fingerprints.
5. **Looks them up** in a database of pre-fingerprinted songs.
6. **Returns** the song with the most matching aligned hashes.

This is the same approach Shazam invented in 2003, simplified and self-hosted.

### Tech Stack

| Layer        | Technology                                                |
|--------------|-----------------------------------------------------------|
| Frontend     | React 19 · TanStack Start v1 · Vite 7 · TypeScript        |
| Styling      | Tailwind CSS v4 · Framer Motion · Lucide Icons            |
| Backend      | Python 3.11 · FastAPI · Uvicorn · NumPy · SciPy           |
| Database     | Supabase (PostgreSQL) · Lovable Cloud                     |
| Audio DSP    | librosa · scipy.signal · custom FAN-style hashing         |
| Auth         | localStorage (demo) — upgrade-ready for Supabase Auth     |

---

## 2. Project Structure

```
wavejack/
├── frontend/                          # React + TanStack Start app
│   ├── src/
│   │   ├── routes/
│   │   │   ├── __root.tsx             # Root layout (HTML shell, meta, 404)
│   │   │   ├── index.tsx              # Home page — mic orb, upload, result
│   │   │   ├── history.tsx            # Past identifies list
│   │   │   ├── discover.tsx           # Grid of all songs in library
│   │   │   └── admin.tsx              # Admin-only panel (songs, stats, logs)
│   │   ├── components/
│   │   │   ├── wavejack/
│   │   │   │   ├── Auth.tsx           # Auth modals + localStorage helpers + history store
│   │   │   │   ├── Visuals.tsx        # MicOrb, ParticleField, WaveRibbons, LiveWaveform
│   │   │   │   ├── RecentSearches.tsx # Glass card listing latest identifies
│   │   │   │   └── PageShell.tsx      # Shared navbar + background for sub-pages
│   │   │   └── ui/                    # shadcn/ui primitives (Button, Card, Input, ...)
│   │   ├── hooks/                     # Reusable React hooks (e.g. use-mobile)
│   │   ├── lib/utils.ts               # cn() class merger and helpers
│   │   ├── styles.css                 # Tailwind v4 tokens, gradients, animations
│   │   ├── router.tsx                 # TanStack Router config
│   │   └── routeTree.gen.ts           # AUTO-GENERATED — do not edit
│   ├── vite.config.ts                 # Vite plugins (TanStack Start, Tailwind)
│   ├── components.json                # shadcn config
│   ├── tsconfig.json                  # Strict TypeScript config
│   └── package.json                   # Frontend dependencies & scripts
│
└── backend/                           # FastAPI fingerprinting server
    ├── main.py                        # FastAPI app, route handlers, CORS
    ├── fingerprint.py                 # FFT, peak detection, FAN hashing
    ├── matcher.py                     # Hash lookup + offset-alignment scoring
    ├── db.py                          # Supabase client + query helpers
    ├── models.py                      # Pydantic request/response schemas
    ├── youtube.py                     # yt-dlp helper for ingesting from URLs
    ├── requirements.txt               # Python deps (fastapi, librosa, supabase, ...)
    └── .env.example                   # Template for SUPABASE_URL / SUPABASE_KEY
```

---

## 3. Frontend Setup

### Install dependencies

```bash
cd frontend
npm install
```

### Run locally

```bash
npm run dev
```

The app starts at **http://localhost:8080** (or whichever port Vite picks).

### Environment variables

Create `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
```

Then in code, replace hardcoded `http://localhost:8000` with `import.meta.env.VITE_API_URL`.

### Build for production

```bash
npm run build      # outputs to .output/
npm run start      # serves the production build
```

---

## 4. Backend Setup

### Create a virtual environment

```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # macOS/Linux
# venv\Scripts\activate            # Windows
```

### Install requirements

```bash
pip install -r requirements.txt
```

Typical `requirements.txt`:

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
python-multipart==0.0.12
numpy==1.26.4
scipy==1.13.1
librosa==0.10.2
supabase==2.7.4
yt-dlp==2024.10.7
python-dotenv==1.0.1
```

### Run the server

```bash
python main.py
# or
uvicorn main:app --reload --port 8000
```

The API runs at **http://localhost:8000**. Swagger docs at **/docs**.

### Environment variables

Create `backend/.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_KEY=YOUR_SERVICE_ROLE_KEY
```

> ⚠️ Use the **service role key** on the backend (never expose it in the frontend).

---

## 5. Supabase Database Setup

### Create the project

1. Go to [supabase.com](https://supabase.com) → **New Project**.
2. Copy the **Project URL** and **service_role key** into `backend/.env`.
3. Open the **SQL Editor** and run the schema below.

### Schema

```sql
-- ============ SONGS ============
create table public.songs (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  artist       text not null,
  duration     real,
  youtube_url  text,
  created_at   timestamptz default now()
);

-- ============ FINGERPRINTS ============
-- Hash → song mapping. Heavily indexed for fast lookup.
create table public.fingerprints (
  id        bigserial primary key,
  hash      bigint not null,
  song_id   uuid references public.songs(id) on delete cascade,
  offset_t  integer not null    -- time offset within the song (frames)
);
create index idx_fp_hash on public.fingerprints (hash);
create index idx_fp_song on public.fingerprints (song_id);

-- ============ PROFILES ============
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text unique,
  username   text,
  created_at timestamptz default now()
);

-- ============ SEARCH HISTORY ============
create table public.search_history (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  song_id     uuid references public.songs(id) on delete set null,
  confidence  real,
  identified_at timestamptz default now()
);
create index idx_history_user on public.search_history (user_id);

-- ============ USER ROLES (for admin) ============
create type public.app_role as enum ('admin', 'user');
create table public.user_roles (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role    app_role not null,
  unique (user_id, role)
);

-- Security definer function to check role without recursive RLS
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;
```

### Enable RLS on user-facing tables

```sql
alter table public.profiles      enable row level security;
alter table public.search_history enable row level security;
alter table public.user_roles    enable row level security;

create policy "users read own profile"   on public.profiles
  for select using (auth.uid() = id);
create policy "users read own history"   on public.search_history
  for select using (auth.uid() = user_id);
```

---

## 6. API Endpoints

Base URL: `http://localhost:8000`

### `POST /identify`
Identify a song from an uploaded audio clip.

**Request:** `multipart/form-data` with field `audio` (any audio format).

**Response:**
```json
{
  "title": "Midnight City",
  "artist": "M83",
  "confidence": 0.94,
  "offset": 42,
  "hashes_matched": 318
}
```

### `GET /songs`
List every song in the library.

**Response:**
```json
[
  { "id": "uuid", "title": "Strobe", "artist": "deadmau5", "fingerprints": 12480 }
]
```

### `POST /add`
Add a new song. Accepts either an uploaded file **or** a YouTube URL.

**Request:** `multipart/form-data`
- `title` (string, required)
- `artist` (string, required)
- `youtube_url` (string, optional)
- `audio` (file, optional)

**Response:**
```json
{ "id": "uuid", "title": "...", "artist": "...", "fingerprints": 12480 }
```

### `DELETE /songs/{id}`
Removes a song and cascades all its fingerprints.

**Response:** `{ "deleted": true }`

### `GET /admin/stats`
Aggregate metrics for the admin dashboard.

**Response:**
```json
{ "total_songs": 42, "identifies_today": 17, "total_users": 128 }
```

### `GET /admin/logs`
Recent identification attempts.

**Response:**
```json
[
  { "title": "Levitating", "artist": "Dua Lipa", "confidence": 0.93, "at": 1730000000000 }
]
```

### `POST /recognize`
Original alias for `/identify` — kept for backwards compatibility. Same request and response shape.

---

## 7. How Audio Fingerprinting Works

```
 Raw Audio  →  Sampling  →  FFT  →  Spectrogram  →  Peak Detection
                                                            ↓
       Result  ←  Matching  ←  Database  ←  FAN Hashing  ←
```

### Step 1 — Raw Audio
Audio is just air pressure over time. The mic captures it as a waveform — a 1D array of numbers.

### Step 2 — Sampling
We resample to a fixed rate (e.g. 22,050 Hz mono). This makes every clip comparable.

### Step 3 — FFT (Fast Fourier Transform)
We slice the audio into ~100ms windows and run FFT on each window. FFT answers: **"which frequencies are present right now, and how loud?"**

### Step 4 — Spectrogram
Stack the FFT results side by side and you get a 2D image: **time × frequency × loudness**. Bright spots = loud notes at that moment.

### Step 5 — Peak Detection
We find local maxima — the brightest, most distinctive points in the spectrogram. Peaks survive noise and compression because they're the loudest things around.

### Step 6 — FAN Hashing (Fast Audio Network)
We pick an "anchor" peak and pair it with each peak in a small "target zone" ahead of it. Each pair becomes a hash:

```
hash = (freq_anchor, freq_target, time_delta)
```

These hashes are tiny (a single 64-bit int) and incredibly distinctive.

### Step 7 — Database
For every song we precompute thousands of hashes and store `(hash, song_id, offset)` rows. The `hash` column is indexed for O(log n) lookup.

### Step 8 — Matching
For an unknown clip, we generate its hashes and look each one up. Many songs may share a few hashes — but only the **right** song will have hashes that line up at a **consistent time offset**. We score each candidate by the largest aligned cluster.

### Step 9 — Result
Highest-aligned candidate wins. Confidence = aligned hashes ÷ total hashes in clip.

---

## 8. Features

- 🎤 **Real-time mic orb** — animated 3D microphone with pulsing rings
- 🆓 **Guest mode** — 2 free identifies, no signup needed
- ♾️ **Unlimited after signup** — instant email/password auth
- 📜 **History page** — every past identify with timestamp & confidence
- 🌐 **Discover page** — beautiful grid of every song in the library
- 🛡️ **Admin panel** — protected by email allowlist, manage songs, view stats & logs
- 📊 **Live waveform** — bouncing bars during recording
- 📁 **Drag & drop** — upload any audio file to identify
- ✨ **Particle field & wave ribbons** — animated dark purple/cyan background

---

## 9. How to Add Songs

### Via Admin Panel (recommended)
1. Sign in as `mohd.awaiz388@gmail.com` (the admin email).
2. Click **Admin** in the navbar → `/admin`.
3. Scroll to **Add Song**, fill in:
   - **Title** & **Artist** (required)
   - **YouTube URL** (optional — backend downloads & fingerprints it)
   - **Audio file** (optional — direct upload)
4. Click **Add Song**. The backend computes ~10,000 fingerprints and stores them.

### Via API (programmatic)

```bash
curl -X POST http://localhost:8000/add \
  -F "title=Strobe" \
  -F "artist=deadmau5" \
  -F "audio=@strobe.mp3"
```

Or with a YouTube URL:

```bash
curl -X POST http://localhost:8000/add \
  -F "title=Strobe" \
  -F "artist=deadmau5" \
  -F "youtube_url=https://youtube.com/watch?v=tKi9Z-f6qX4"
```

---

## 10. Deployment Guide

### Frontend → Vercel

1. Push your repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → **New Project** → import the repo.
3. **Framework preset:** Other (TanStack Start auto-detects).
4. **Build command:** `npm run build`
5. **Output directory:** `.output/public`
6. Add environment variable: `VITE_API_URL = https://your-backend.up.railway.app`
7. **Deploy**.

### Backend → Railway (or Render)

**Railway:**
1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
2. Pick the `backend/` directory as the root.
3. Add **Variables**: `SUPABASE_URL`, `SUPABASE_KEY`, `PORT=8000`.
4. **Start command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Generate a public domain → copy the URL.

**Render:**
1. [render.com](https://render.com) → **New Web Service** → connect repo.
2. **Runtime:** Python 3.11.
3. **Build:** `pip install -r requirements.txt`
4. **Start:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add the same env vars.

### Update `VITE_API_URL` after deployment

1. Vercel dashboard → your project → **Settings → Environment Variables**.
2. Edit `VITE_API_URL` to your live backend URL (e.g. `https://wavejack-api.up.railway.app`).
3. **Redeploy** the frontend (Deployments → … → Redeploy).

---

## 11. Troubleshooting

### 🎙️ Silent recording / mic captures nothing
- Browser blocked mic permission → check the address-bar lock icon → allow.
- Wrong input device selected at the OS level. On macOS: System Settings → Sound → Input. On Windows: Settings → Sound → Input.
- In code, when calling `getUserMedia`, pass a specific `deviceId` from `navigator.mediaDevices.enumerateDevices()` to let users pick.
- Test the mic at [mictests.com](https://mictests.com) to rule out hardware.

### 🚫 CORS errors (`Access-Control-Allow-Origin`)
Add this near the top of `backend/main.py`:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "https://your-frontend.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 🗄️ Supabase connection issues
- `Invalid API key` → make sure you're using the **service_role** key on the backend, not the anon key.
- `relation "songs" does not exist` → re-run the SQL schema in section 5.
- Network timeouts from Railway/Render → in Supabase **Settings → Database**, allow `0.0.0.0/0` for outbound (or whitelist the specific egress IP).

### 🐛 Common errors

| Error                                       | Cause                                | Fix                                                       |
|---------------------------------------------|--------------------------------------|-----------------------------------------------------------|
| `Failed to fetch` in browser                | Backend not running or wrong URL     | Verify `VITE_API_URL` and that `localhost:8000` is up     |
| `librosa.load` segfault                     | Missing `ffmpeg` on the system       | `brew install ffmpeg` / `apt install ffmpeg`              |
| `No matching distribution for numpy==1.26.4`| Python version too new/old           | Use Python 3.10–3.12                                      |
| Identify always returns same song           | Database has only one song           | Add more songs via `/admin`                               |
| Confidence always < 0.3                     | Recording too short or too noisy     | Record at least 5 s in a quiet room                       |
| 401 on `/admin/*`                           | Not signed in as the admin email     | Sign in with `mohd.awaiz388@gmail.com`                    |

---

## 📜 License

MIT — do whatever you want, just keep the copyright notice.

## 💜 Built with

[Lovable](https://lovable.dev) · [TanStack](https://tanstack.com) · [Supabase](https://supabase.com) · [FastAPI](https://fastapi.tiangolo.com)
