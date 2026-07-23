const MIN_LEVEL_DB = -60;
const GATE_HOLD_SECONDS = 0.16;
const LEVEL_REPORT_INTERVAL_FRAMES = 0.05 * sampleRate;
const ATTACK_COEFFICIENT = Math.exp(-1 / (sampleRate * 0.003));
const RELEASE_COEFFICIENT = Math.exp(-1 / (sampleRate * 0.025));

class VoiceGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.thresholdDb = -45;
    this.muted = true;
    this.gain = 0;
    this.smoothedRms = 0;
    this.openUntil = 0;
    this.speaking = false;
    this.framesUntilReport = 0;

    this.port.onmessage = ({ data }) => {
      if (data?.type === 'threshold' && Number.isFinite(data.value)) {
        this.thresholdDb = data.value;
      } else if (data?.type === 'muted') {
        this.muted = Boolean(data.value);
        if (this.muted) {
          this.gain = 0;
          this.openUntil = 0;
        }
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;

    let sumSquares = 0;
    if (input) {
      for (let index = 0; index < input.length; index += 1) {
        sumSquares += input[index] * input[index];
      }
    }
    const rms =
      input && input.length > 0 ? Math.sqrt(sumSquares / input.length) : 0;
    this.smoothedRms = Math.max(rms, this.smoothedRms * 0.92);
    const levelDb = Math.max(
      MIN_LEVEL_DB,
      20 * Math.log10(Math.max(this.smoothedRms, 0.001)),
    );
    const aboveThreshold = !this.muted && levelDb > this.thresholdDb;
    if (aboveThreshold) this.openUntil = currentTime + GATE_HOLD_SECONDS;
    const speaking =
      !this.muted &&
      (aboveThreshold || currentTime < this.openUntil);
    const targetGain = speaking ? 1 : 0;

    if (this.muted || !input) {
      output.fill(0);
      this.gain = 0;
    } else {
      for (let index = 0; index < output.length; index += 1) {
        const coefficient =
          targetGain > this.gain
            ? ATTACK_COEFFICIENT
            : RELEASE_COEFFICIENT;
        this.gain =
          targetGain + coefficient * (this.gain - targetGain);
        output[index] = input[index] * this.gain;
      }
    }

    this.framesUntilReport -= output.length;
    if (this.framesUntilReport <= 0 || speaking !== this.speaking) {
      this.framesUntilReport = LEVEL_REPORT_INTERVAL_FRAMES;
      this.port.postMessage({ levelDb, speaking });
    }
    this.speaking = speaking;
    return true;
  }
}

registerProcessor('whiteboard-voice-gate', VoiceGateProcessor);
