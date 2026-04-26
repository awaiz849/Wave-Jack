import { useState, useRef } from "react";

const WS_URL = "ws://localhost:8000/ws/recognize";

interface MatchResult {
  title: string;
  artist: string;
  youtube_url?: string;
  confidence: number;
  song_id: number;
}

export default function RecognizeButton() {
  const [status, setStatus] = useState<"idle" | "listening" | "match" | "error">("idle");
  const [result, setResult] = useState<MatchResult | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const startListening = async () => {
    setStatus("listening");
    setResult(null);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.status === "match") {
        setResult(data.result);
        setStatus("match");
        stopListening();
      }
    };

    ws.onerror = () => setStatus("error");

    ws.onclose = () => {
      if (status !== "match") {
        setStatus("idle");
        setResult(null);
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(e.data);
      }
    };

    recorder.start(2000);
  };

  const stopListening = () => {
    recorderRef.current?.stop();
    wsRef.current?.close();
    if (status === "listening") setStatus("idle");
  };

  return (
    <div className="flex flex-col items-center gap-4">
      {status === "idle" && (
        <button
          onClick={startListening}
          className="px-6 py-3 bg-indigo-600 text-white rounded-full text-lg font-semibold hover:bg-indigo-700"
        >
          🎵 Identify Song
        </button>
      )}

      {status === "listening" && (
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 rounded-full bg-indigo-600 animate-pulse" />
          <p className="text-gray-500">Listening...</p>
          <button onClick={stopListening} className="text-sm text-red-400 underline">
            Cancel
          </button>
        </div>
      )}

      {status === "match" && result && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-center">
          <p className="text-green-700 font-bold text-xl">{result.title}</p>
          <p className="text-green-600">{result.artist}</p>
          {result.youtube_url && (
            <a href={result.youtube_url} className="text-indigo-500 underline text-sm mt-1 block">
              Watch on YouTube
            </a>
          )}
          <button
            onClick={() => { setStatus("idle"); setResult(null); }}
            className="mt-3 text-sm text-gray-400 underline"
          >
            Try again
          </button>
        </div>
      )}

      {status === "error" && (
        <p className="text-red-500">Something went wrong. Try again.</p>
      )}
    </div>
  );
}