// The live overlay, animation and blur listener are loaded only when enabled.
export class KeyDisplayTool {
  constructor(onError) { this.onError = onError; this.enabled = false; this.panel = null; this.loading = null; this.clock = null; }
  set(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) { this.panel?.dispose(); this.panel = null; return; }
    if (this.panel || this.loading) return;
    this.loading = import('./key-display.mjs').then(({ KeyDisplay }) => {
      if (!this.enabled) return;
      this.panel = new KeyDisplay();
      if (this.clock !== null) this.panel.beginRender(this.clock);
    }).catch(this.onError).finally(() => { this.loading = null; });
  }
  input(event) { if (this.enabled) this.panel?.input(event); }
  beginRender(timestamp) { this.clock = timestamp; this.panel?.beginRender(timestamp); }
  draw(timestamp) { this.clock = timestamp; this.panel?.draw(timestamp / 1000); }
  endRender() { this.clock = null; this.panel?.endRender(); }
}
