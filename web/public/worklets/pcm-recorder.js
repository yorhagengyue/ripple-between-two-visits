/**
 * AudioWorklet for the visit recorder (M2): copies each 128-sample block of the first input channel to the
 * main thread as Float32 PCM. The page turns the blocks into a 16 kHz mono 16-bit WAV (never WebM).
 * Message in: { paused: boolean }. Message out: Float32Array (transferred).
 */
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.paused = false;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.paused === "boolean") this.paused = e.data.paused;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!this.paused && input && input[0] && input[0].length) {
      const copy = new Float32Array(input[0]);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-recorder", PcmRecorder);
