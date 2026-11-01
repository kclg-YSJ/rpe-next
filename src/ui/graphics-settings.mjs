import { t } from '../i18n.mjs';

const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
const button = (label, handler) => { const element = node('button', label); element.type = 'button'; element.onclick = handler; return element; };

export class GraphicsSettings {
  constructor(settings, { bridge = globalThis.rpenGraphics, startupReady = async () => {}, notify = () => {} } = {}) {
    Object.assign(this, { settings, bridge, notify });
    this.ready = bridge ? bridge.call('status').then(state => {
      if (state.platform !== 'win32') return;
      this.state = state; this.build(); this.render();
      startupReady().then(() => {
        if (this.state.preferences.warnOnIntegrated) setTimeout(() => this.check(true), 1000);
      }).catch(() => {});
    }).catch(() => {}) : Promise.resolve();
  }
  build() {
    this.root = node('section'); this.root.id = 'graphics-settings'; this.root.className = 'settings-group'; this.root.dataset.settingsCategory = 'general';
    const heading = node('div', undefined, 'settings-group-heading'); heading.append(node('h3', t('graphics.title')));
    const reset = button(t('settings.sa191935'), () => {
      if (confirm(t('settings.s7d6ffba', { p0: t('graphics.title') }))) this.preferences({ preferDiscrete: true, warnOnIntegrated: true });
    }); reset.className = 'settings-reset'; heading.append(reset); this.root.append(heading);
    const toggle = (id, label, key) => {
      const field = node('label', undefined, 'field'), input = node('input'); input.type = 'checkbox'; input.id = id;
      field.append(label, input); input.onchange = () => this.preferences({ [key]: input.checked }); this.root.append(field); return input;
    };
    this.prefer = toggle('graphics-prefer-discrete', t('graphics.prefer'), 'preferDiscrete');
    this.warn = toggle('graphics-warn', t('graphics.warn'), 'warnOnIntegrated');
    const devices = node('dl', undefined, 'graphics-devices'); this.renderer = node('dd'); devices.append(node('dt', t('graphics.current')), this.renderer); this.root.append(devices);
    this.restart = node('p', t('graphics.restart'), 'hint'); this.root.append(this.restart);
    this.checkButton = button(t('graphics.check'), () => this.check());
    const actions = node('div', undefined, 'graphics-actions'); actions.append(this.checkButton, button(t('graphics.settings'), () => this.run('open-settings')), button(t('graphics.copy'), () => this.copy())); this.root.append(actions);
    this.message = node('p', '', 'hint'); this.message.setAttribute('role', 'status'); this.root.append(this.message);
    settingsBody(this.settings).append(this.root);
  }
  render() {
    this.prefer.checked = this.state.preferences.preferDiscrete; this.warn.checked = this.state.preferences.warnOnIntegrated;
    this.renderer.textContent = this.state.detection?.renderer ?? t('graphics.unknown'); this.restart.hidden = !this.state.restartNeeded;
  }
  async run(action, value) {
    try { this.state = await this.bridge.call(action, value); this.message.textContent = ''; this.render(); return true; }
    catch { this.message.textContent = t('graphics.failed'); return false; }
  }
  async preferences(value) {
    this.prefer.disabled = this.warn.disabled = true;
    try { await this.run('preferences', value); }
    finally { this.prefer.disabled = this.warn.disabled = false; }
  }
  async check(startup = false) {
    if (this.checking) return;
    this.checking = true; this.checkButton.disabled = true;
    try {
      if (await this.run('check') && this.state.detection?.needsWarning && this.state.preferences.warnOnIntegrated && !this.offered) this.offerWarning();
      else if (!startup && this.state.detection && !this.state.detection.needsWarning) this.message.textContent = t('graphics.checked');
    } finally { this.checking = false; this.checkButton.disabled = false; }
  }
  async copy() { if (await this.run('copy-path')) this.notify(t('graphics.copied'), 'success'); }
  offerWarning() {
    this.offered = true;
    const dialog = node('dialog', undefined, 'update-dialog graphics-dialog'); dialog.id = 'graphics-warning-dialog'; dialog.setAttribute('aria-labelledby', 'graphics-warning-title');
    const heading = node('h2', t('graphics.warning')); heading.id = 'graphics-warning-title';
    const devices = node('dl', undefined, 'graphics-devices'); devices.append(node('dt', t('graphics.current')), node('dd', this.state.detection.renderer ?? t('graphics.software')), node('dt', t('graphics.available')), node('dd', this.state.detection.candidates.join(' / ')));
    const instruction = node('p', t('graphics.instruction'));
    const never = node('label', undefined, 'graphics-never'), input = node('input'); input.type = 'checkbox'; never.append(input, t('graphics.never'));
    input.onchange = () => this.preferences({ warnOnIntegrated: !input.checked });
    const actions = node('div', undefined, 'modal-actions'); actions.append(button(t('graphics.settings'), () => this.run('open-settings')), button(t('graphics.copy'), () => this.copy()), button(t('graphics.dismiss'), () => dialog.close()));
    dialog.append(heading, devices, instruction, never, actions); document.body.append(dialog);
    let observer;
    const cleanup = () => { observer?.disconnect(); document.removeEventListener('visibilitychange', show); };
    const show = () => {
      if (!this.state.preferences.warnOnIntegrated) { cleanup(); dialog.remove(); return; }
      if (document.hidden || document.querySelector('dialog[open]')) return;
      cleanup(); dialog.showModal();
    };
    observer = new MutationObserver(show); observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    document.addEventListener('visibilitychange', show);
    dialog.addEventListener('close', () => { cleanup(); dialog.remove(); }, { once: true }); show();
  }
}

const settingsBody = settings => settings.querySelector('.settings-body');
