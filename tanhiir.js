class TanhIIRProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.offset=0; }

  process (inputs, outputs, parameters) {
    let input = inputs[0];
    let output = outputs[0];
    for (let i=0; i<input[0].length; i++) {
      output.forEach(channel => {channel[i] = Math.tanh(input[0][i] + this.offset);});
      this.offset = input[0][i] - output[0][i];
    }

    return true;
  }
}

registerProcessor('tanh-iir-processor', TanhIIRProcessor);
