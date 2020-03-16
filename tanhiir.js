class TanhIIRProcessor extends AudioWorkletProcessor {
  constructor() { super(); }

  process (inputs, outputs, parameters) {
    let offset = 0;
    outputs.forEach(channel => {
      for (let i = 0; i < channel.length; i++) {
        channel[i] = Math.tanh(inputs[0][i] + offset);
        offset = inputs[0][i] - channel[i];
      }
    });
    return true;
  }
}

registerProcessor('tanh-iir-processor', TanhIIRProcessor);
