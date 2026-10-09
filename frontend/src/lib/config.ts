// Single source of truth for where the WaveJack backend lives.
// Set VITE_API_URL in frontend/.env.local (see .env.example); defaults to the local dev server.
export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(
  /\/+$/,
  "",
);

// http -> ws, https -> wss
export const WS_URL = API_URL.replace(/^http/, "ws");
