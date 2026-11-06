import { t } from '../i18n.mjs';
const protectedSelector = '#ai-panel,#ai-config,#ai-tab,#ai-tool,[data-agent-private]';
const interactive = 'button,input,select,textarea,a[href],summary,[role=button],canvas';
export class AgentControls {
  constructor(root = document) { this.root = root; this.handles = new Map(); this.serial = 0; }
  allowed(node) { return node && !node.closest(protectedSelector) && !node.closest('[hidden],[inert]') && node.getClientRects().length > 0 && !['password', 'file', 'hidden'].includes(node.type); }
  inspect(query = '') {
    this.handles.clear();
    const entries = [];
    for (const node of this.root.querySelectorAll(interactive)) {
      if (!this.allowed(node)) continue;
      const label = (node.getAttribute('aria-label') || node.labels?.[0]?.textContent || node.title || node.textContent || node.id || node.tagName).trim().slice(0, 120);
      if (query && ![label, node.id, node.dataset.panel].some(value => value?.toLowerCase().includes(query.toLowerCase()))) continue;
      const handle = 'control_' + ++this.serial; this.handles.set(handle, node);
      const rect = node.getBoundingClientRect();
      entries.push({ handle, id: node.id, kind: node.type || node.tagName.toLowerCase(), label, disabled: Boolean(node.disabled), value: node.value ?? undefined, checked: node.type === 'checkbox' ? node.checked : undefined,
        options: node.tagName === 'SELECT' ? [...node.options].map(option => ({ value: option.value, label: option.textContent })) : undefined,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
      if (entries.length >= 180) break;
    }
    return { controls: entries, more: entries.length >= 180, hint: t('agent-controls.s6d76d26') };
  }
  prepare({ handle, action, value, x, y, button = 0, key, ctrl = false, shift = false, alt = false, meta = false }) {
    const node = this.handles.get(handle);
    if (!this.allowed(node) || !node.isConnected || node.disabled) throw Error(t('agent-controls.s3651132'));
    const revision = node.outerHTML, originalValue = node.value, originalChecked = node.checked;
    const ordinaryField = action === 'set' && Boolean(node.closest('#settings-modal,#properties,#event-properties,#metadata-editor,#bpm-editor,.line-properties-form,#noise-properties,#global-event-inspector,.transport,.editor-toolbar'));
    const navigation = action === 'click' && Boolean(node.matches('[data-pane],[data-return-chart],#spatial-tool,#metadata,#bpm,#assets,#audio-analysis-tool,#noise-areas-tool,#global-events-tool,#curve-notes,#curve-trajectory,#text-lines-tool,#noise-fit-tool,#noise-tracking-tool,#multi-line-tool,#diagnose,#history-panel,#version-control-tool,#preferences,#help,#play,#rewind,#view-toggle,#notes-only,#game-ui,#reset-camera'));
    return { access: ordinaryField || navigation ? 'edit' : 'dangerous', summary: t('agent-controls.seecc1a2', { p0: node.getAttribute('aria-label') || node.textContent?.trim().slice(0, 80) || node.id, p1: action }),
      details: { handle, action, value, x, y, key, ctrl, shift, alt, meta }, valid: () => node.isConnected && this.allowed(node) && node.outerHTML === revision && node.value === originalValue && node.checked === originalChecked,
      apply: ({ permission } = {}) => {
        if (action === 'click') {
          const confirm = window.confirm;
          if (permission === 'full') window.confirm = () => true;
          try { node.click(); } finally { window.confirm = confirm; }
        }
        else if (action === 'set') {
          if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName) || node.readOnly) throw Error(t('agent-controls.s2d525b1'));
          const previous = node.value, checked = node.checked;
          if (node.type === 'checkbox') { if (typeof value !== 'boolean') throw Error(t('agent-controls.sa02501c')); node.checked = value; }
          else node.value = String(value);
          if (node.checkValidity && !node.checkValidity()) { node.value = previous; node.checked = checked; throw Error(t('agent-controls.s3319841')); }
          node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (action === 'pointer') {
          if (node.tagName !== 'CANVAS' || !Number.isFinite(x) || !Number.isFinite(y)) throw Error(t('agent-controls.s28aed8e'));
          const rect = node.getBoundingClientRect();
          if (x < 0 || x > rect.width || y < 0 || y > rect.height) throw Error(t('agent-controls.sfca3535'));
          const options = { bubbles: true, cancelable: true, pointerId: 734, button, clientX: rect.left + x, clientY: rect.top + y };
          const capture = node.setPointerCapture, release = node.releasePointerCapture, has = node.hasPointerCapture;
          node.setPointerCapture = () => {}; node.releasePointerCapture = () => {}; node.hasPointerCapture = () => false;
          try { for (const type of ['pointermove', 'pointerdown', 'pointerup']) node.dispatchEvent(new PointerEvent(type, options)); }
          finally { node.setPointerCapture = capture; node.releasePointerCapture = release; node.hasPointerCapture = has; }
        } else if (action === 'key') {
          if (typeof key !== 'string' || !key || key.length > 30) throw Error(t('agent-controls.sf2c7901'));
          const options = { key, ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta, bubbles: true, cancelable: true };
          for (const type of ['keydown', 'keyup']) node.dispatchEvent(new KeyboardEvent(type, options));
        } else throw Error(t('agent-controls.s5d3b1bf'));
        this.handles.clear(); return { dispatched: true, message: t('agent-controls.s5f27e8f') };
      } };
  }
}
