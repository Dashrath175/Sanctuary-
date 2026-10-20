"""
Prepare the game's score from Blind Willie Johnson's "Dark Was the Night, Cold Was the Ground"
(recorded 1927, Columbia 14303-D): takes a transfer of the 78 (the Internet Archive's
78_dark-was-the-night-vocal-with-guitar-blind-willie-johnson), takes out the turntable rumble
and the sharpest record clicks, trims the lead-in, levels it and writes public/audio/score.mp3,
made to loop.

    pip install numpy scipy soundfile imageio-ffmpeg
    python scripts/prep-score.py "path/to/Dark was the night.mp3"
"""

import os
import subprocess
import sys

import imageio_ffmpeg
import numpy as np
import soundfile as sf
from scipy.ndimage import maximum_filter1d, median_filter
from scipy.signal import butter, sosfiltfilt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 44_100
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def load(path):
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def declick(x, over=25.0):
    """Swap the sharpest record clicks for the median around them. The transfer holds almost
    nothing above 4 kHz, so a click shows up there far above the level of the 50 ms around it;
    the threshold is high, so the guitar's own attacks are left alone."""
    e = np.abs(sosfiltfilt(butter(4, 4000, "high", fs=SR, output="sos"), x))
    local = median_filter(e[::8], int(0.05 * SR / 8)).repeat(8)[: len(e)] + 1e-7
    bad = (e > over * local) & (e > 4 * np.median(e))
    bad = maximum_filter1d(bad.astype(np.uint8), 24) > 0  # half a millisecond either side
    y = x.copy()
    y[bad] = median_filter(x, 15)[bad]
    return y, int(np.sum(np.diff(bad.astype(int)) == 1))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    x = load(sys.argv[1])
    # rumble below the guitar's low D (73 Hz), run both ways so nothing smears
    x = sosfiltfilt(butter(4, 50, "high", fs=SR, output="sos"), x)
    x, fixed = declick(x)
    # the lead-in groove: start just before the first note
    w = int(0.05 * SR)
    level = np.array([np.sqrt(np.mean(x[i:i + w] ** 2)) for i in range(0, len(x) - w, w)])
    first = int(np.argmax(level > 10 ** (-40 / 20)))
    x = x[max(0, first - 2) * w:]
    # level it, then short ends and a breath of silence before it comes round again
    x *= 10 ** (-20 / 20) / (np.sqrt(np.mean(x**2)) + 1e-9)
    x = np.clip(x, -0.98, 0.98)
    x[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
    x[-int(2 * SR):] *= np.linspace(1, 0, int(2 * SR)) ** 2
    x = np.concatenate([x, np.zeros(int(1.5 * SR))])
    out = os.path.join(ROOT, "public", "audio")
    os.makedirs(out, exist_ok=True)
    wav = os.path.join(out, "score.wav")
    sf.write(wav, x.astype(np.float32), SR)
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", wav, "-map_metadata", "-1", "-fflags", "+bitexact",
                    "-ac", "1", "-b:a", "112k", os.path.join(out, "score.mp3")], check=True)
    os.remove(wav)
    print(f"public/audio/score.mp3: {len(x) / SR:.0f} s, {fixed} clicks smoothed")


if __name__ == "__main__":
    main()
