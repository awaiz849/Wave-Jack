import { useCallback, useEffect, useState } from "react";

const MIC_KEY = "wavejack_mic_device";

/** The saved microphone deviceId, or "" for the system default. */
export function loadMicChoice(): string {
  try {
    return localStorage.getItem(MIC_KEY) || "";
  } catch {
    return "";
  }
}

export function saveMicChoice(deviceId: string) {
  try {
    if (deviceId) localStorage.setItem(MIC_KEY, deviceId);
    else localStorage.removeItem(MIC_KEY);
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}

/**
 * Audio inputs from enumerateDevices(). Labels (and stable ids) only appear
 * once the user has granted mic access, so call refresh() after getUserMedia.
 * Chrome's "default"/"communications" aliases are dropped: the picker has its
 * own "system default" entry.
 */
export function useAudioInputs() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all.filter(
          (d) =>
            d.kind === "audioinput" &&
            d.deviceId !== "" &&
            d.deviceId !== "default" &&
            d.deviceId !== "communications",
        ),
      );
    } catch {
      /* keep the previous list */
    }
  }, []);

  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.("devicechange", refresh);
    return () => md?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);

  return { devices, refresh };
}

export function MicPicker({
  devices,
  value,
  onChange,
  disabled,
}: {
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
}) {
  // A saved device that isn't listed (unplugged, or labels not available yet) shows as default.
  const shown = devices.some((d) => d.deviceId === value) ? value : "";
  return (
    <label className="font-signal mt-4 flex items-center gap-2 text-xs text-muted-foreground">
      mic
      <select
        value={shown}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="max-w-[240px] truncate rounded-sm border border-border bg-transparent px-2 py-1 text-foreground transition-colors focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
      >
        <option value="" className="bg-background">
          system default
        </option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId} className="bg-background">
            {d.label || `microphone ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
