import numpy as np
import librosa
import hashlib
from scipy.ndimage import maximum_filter
from scipy.ndimage import generate_binary_structure, iterate_structure

# Spectrogram Settings
SAMPLE_RATE = 22050

# Peak Detection
PEAK_NEIGHBOURHOOD_SIZE = 10
AMP_MIN = -30  # dB threshold — keeps peaks within 30dB of the loudest point

# Hashing
FAN_VALUE = 5
MIN_HASH_TIME_DELTA = 0
MAX_HASH_TIME_DELTA = 200


def load_audio(file_path):
    audio, sr = librosa.load(file_path, sr=SAMPLE_RATE)
    return audio, sr


def generate_spectrogram(audio, sr):
    spectrogram = np.abs(librosa.stft(audio))
    # FIX: Convert to dB scale so AMP_MIN is a stable threshold across all songs
    spectrogram = librosa.amplitude_to_db(spectrogram, ref=np.max)
    return spectrogram


def find_peaks(spectrogram):
    struct = generate_binary_structure(2, 1)
    neighbourhood = iterate_structure(struct, PEAK_NEIGHBOURHOOD_SIZE)

    local_max = maximum_filter(spectrogram, footprint=neighbourhood) == spectrogram
    detected_peaks = local_max & (spectrogram > AMP_MIN)

    peaks = np.argwhere(detected_peaks)

    # Convert to (freq, time) tuples
    peaks = [(int(freq), int(time)) for freq, time in peaks]

    # FIX: Sort by time so hash pairs are always in chronological order
    peaks.sort(key=lambda x: x[1])

    return peaks


def generate_hashes(peaks):
    hashes = []

    for i in range(len(peaks)):
        # FIX: range(1, FAN_VALUE + 1) to get exactly FAN_VALUE pairs per anchor
        for j in range(1, FAN_VALUE + 1):
            if i + j < len(peaks):
                freq1, t1 = peaks[i]
                freq2, t2 = peaks[i + j]

                t_delta = t2 - t1

                if MIN_HASH_TIME_DELTA <= t_delta <= MAX_HASH_TIME_DELTA:
                    # Use a real hash function for efficient DB indexing later
                    raw = f"{freq1}|{freq2}|{t_delta}"
                    hash_val = hashlib.sha1(raw.encode()).hexdigest()[:16]
                    hashes.append((hash_val, t1))

    return hashes


def fingerprint(file_path):
    audio, sr = load_audio(file_path)
    spectrogram = generate_spectrogram(audio, sr)
    peaks = find_peaks(spectrogram)
    hashes = generate_hashes(peaks)
    return hashes


if __name__ == "__main__":
    test_file = "../data/songs/test2.mp3"

    hashes = fingerprint(test_file)

    print(f"Generated {len(hashes)} hashes")
    print(hashes[:10])