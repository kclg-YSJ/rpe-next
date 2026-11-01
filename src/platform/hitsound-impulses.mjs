class HitSoundImpulses extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.frames = options.processorOptions.frames; this.weights = options.processorOptions.weights; this.blocks = []; this.next = 0; this.carry = 0; this.alive = true; this.shift = 0;
    this.port.onmessage = event => {
      if (event.data === 'stop') this.alive = false;
      else if (event.data.frames) this.blocks.push(event.data);
      else this.shift = event.data.shift;
    };
  }
  process(inputs, outputs) {
    if (!this.alive) return false;
    const output = outputs[0][0]; output[0] += this.carry; this.carry = 0;
    for (;;) {
      if (this.next >= this.frames.length && this.blocks.length) { const block = this.blocks.shift(); this.frames = block.frames; this.weights = block.weights; this.next = 0; }
      if (this.next >= this.frames.length || this.frames[this.next] + this.shift >= currentFrame + output.length) break;
      const weight = this.weights?.[this.next] ?? 1;
      const offset = Math.max(0, this.frames[this.next++] + this.shift - currentFrame), first = Math.floor(offset), fraction = offset - first;
      output[first] += (1 - fraction) * weight;
      if (first + 1 < output.length) output[first + 1] += fraction * weight; else this.carry += fraction * weight;
    }
    return true;
  }
}

registerProcessor('rpen-hit-impulses', HitSoundImpulses);
