/** A speech loudness display, scaled from RMS decibels into [0, 1]. */
export function microphoneLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
  return Math.min(1, Math.max(0, (20 * Math.log10(Math.max(rms, 0.00001)) + 60) / 60));
}

/** Reads only a local analyser. No recording, audio playback, storage, or audio upload. */
export function observeMicrophone(
  level: (value: number) => void,
  unavailable: () => void,
): () => void {
  let closed = false;
  let context: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let frame: number | undefined;
  const stop = () => {
    if (closed) return;
    closed = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
    source?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") void context.close().catch(() => undefined);
  };
  const fail = () => {
    if (closed) return;
    stop();
    unavailable();
  };
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      fail();
      return stop;
    }
    context = new AudioContext();
    const audio = context;
    void audio.resume().catch(fail);
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((media) => {
        if (closed) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        source = audio.createMediaStreamSource(media);
        const analyser = audio.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let previous = -Infinity;
        const sample = (time: number) => {
          if (closed) return;
          if (time - previous >= 50) {
            analyser.getFloatTimeDomainData(samples);
            level(microphoneLevel(samples));
            previous = time;
          }
          frame = requestAnimationFrame(sample);
        };
        frame = requestAnimationFrame(sample);
      })
      .catch(fail);
  } catch {
    fail();
  }
  return stop;
}
