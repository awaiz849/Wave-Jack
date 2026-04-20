import sounddevice as sd
import soundfile as sf
import numpy as np
import os

DURATION = 10
SAMPLE_RATE = 22050
AUDIO_INPUT_DEVICE = 2  # Intel built-in mic — change to 3 if using G-009 headset
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "../data/clips/recorded_clip.wav")

def record_clip(duration=DURATION, output_file=OUTPUT_FILE):
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    
    print(f"🎙️ Recording for {duration} seconds... Play your song!")
    
    audio = sd.rec(
        int(duration * SAMPLE_RATE),
        samplerate=SAMPLE_RATE,
        channels=1,
        dtype='float32',
        device=AUDIO_INPUT_DEVICE  # ← fix for silent recording
    )
    sd.wait()
    
    sf.write(output_file, audio, SAMPLE_RATE)
    print(f"✅ Saved to {output_file}")
    return output_file

if __name__ == "__main__":
    record_clip()