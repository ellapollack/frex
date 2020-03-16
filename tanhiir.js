class TanhIIRProcessor extends AudioWorkletProcessor {
  constructor() { super(); }

  process (inputs, outputs, parameters) {
    let offset = 0;
    output.forEach(channel => {
      for (let i = 0; i < channel.length; i++) {
        channel[i] = tanh(inputs[0][i] + offset);
        offset = inputs[0][i] - channel[i];
      }
    });
    return true;
  }
}

registerProcessor('tanh-iir-processor', TanhIIRProcessor);
