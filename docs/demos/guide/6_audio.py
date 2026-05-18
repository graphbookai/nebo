import numpy as np
import nebo as nb


@nb.fn()
def synthesize():
    sr = 22050
    duration = 2.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    wave = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
    nb.log_audio(wave, sr=sr, name="A4")


synthesize()
