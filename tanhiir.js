class TanhIIRProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.offset=0; }

  process (inputs, outputs, parameters) {

    for (let i=0; i<inputs[0].length; i++) {
      outputs.forEach(channel => {channel[i] = Math.tanh(inputs[0][i] + this.offset);});
      this.offset = inputs[0][i] - outputs[0][i];
    }

    return true;
  }
}

registerProcessor('tanh-iir-processor', TanhIIRProcessor);
