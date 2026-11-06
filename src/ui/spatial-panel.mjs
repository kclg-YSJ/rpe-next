import { SamplingControls } from './sampling-controls.mjs';
import { t } from '../i18n.mjs';
import { SpatialLineControls } from './spatial-line-controls.mjs';
import { SpatialEasingControls } from './spatial-easing.mjs';

const node = (tag, content, className) => {
  const element = document.createElement(tag);
  if (content) element.textContent = content;
  if (className) element.className = className;
  return element;
};
export const spatialButton = (label, run, title = label) => {
  const button = node('button', label); button.type = 'button'; button.title = title;
  button.onclick = run; return button;
};
export function buildSpatialPanel(panel) {
  const host = panel.host; host.replaceChildren(); host.classList.add('spatial-panel');
  const header = node('div', null, 'tool-panel-header');
  header.append(node('strong', t('spatial.title')));
  const helpButton = spatialButton('?', () => {
    panel.help.hidden = !panel.help.hidden;
    helpButton.setAttribute('aria-expanded', String(!panel.help.hidden));
  }, t('spatial.help'));
  helpButton.setAttribute('aria-label', t('spatial.help'));
  header.append(helpButton); host.append(header);
  panel.help = node('section', null, 'spatial-help'); panel.help.hidden = true;
  panel.help.append(node('strong', t('spatial.help')));
  for (const key of ['workspace', 'pointer', 'node', 'drag', 'escape', 'place', 'trails', 'lines', 'currentElements', 'highlightPlane', 'easing']) {
    panel.help.append(node('p', t(`spatial.help.${key}`, panel.context.hotkeys?.() ?? {})));
  }
  host.append(panel.help);

  panel.enable = document.createElement('input'); panel.enable.type = 'checkbox';
  panel.enable.dataset.spatial = 'enabled'; panel.enable.checked = panel.visible;
  panel.enable.onchange = () => panel.enable.checked ? panel.start() : panel.disable();
  const enableLabel = node('label', null, 'field tool-field');
  enableLabel.append(node('span', t('spatial.enabled')), panel.enable); host.append(enableLabel);
  panel.lineControls = new SpatialLineControls(host, panel);

  const pointer = node('div', null, 'tool-section');
  const planeLabel = node('label', null, 'field tool-field');
  panel.planeInput = document.createElement('input'); panel.planeInput.type = 'text';
  panel.planeInput.title = t('spatial.help.pointer');
  panel.planeInput.onchange = () => panel.setPlane(panel.planeInput.value);
  planeLabel.append(node('span', t('spatial.planeBeat')), panel.planeInput);
  pointer.append(planeLabel);
  panel.channel = document.createElement('select');
  for (const type of ['position', 'rotateEvents', 'alphaEvents', 'scaleXEvents', 'scaleYEvents', 'textEvents']) {
    panel.channel.append(new Option(t(`spatial.${type}`), type));
  }
  const channelLabel = node('label', null, 'field tool-field');
  channelLabel.append(node('span', t('spatial.channel')), panel.channel); pointer.append(channelLabel);
  host.append(pointer);

  panel.nodeForm = node('section', null, 'spatial-node-form tool-section');
  const heading = node('div', null, 'tool-section-header');
  panel.owner = node('strong');
  panel.exitNode = spatialButton(t('spatial.finishNode'), () => panel.deselect());
  panel.exitNode.dataset.spatial = 'finishNode';
  heading.append(panel.owner, panel.exitNode); panel.nodeForm.append(heading);
  panel.overlapSelect = document.createElement('select'); panel.overlapSelect.hidden = true;
  panel.overlapSelect.className = 'tool-wide';
  panel.overlapSelect.onchange = () => panel.selectNode(panel.overlaps[Number(panel.overlapSelect.value)]);
  panel.sourceSelect = document.createElement('select'); panel.sourceSelect.className = 'tool-wide';
  panel.sourceSelect.onchange = () => {
    panel.cancelEasingPreview();
    panel.source = panel.selected.sources[Number(panel.sourceSelect.value)];
    panel.syncInspector(false); panel.invalidate();
  };
  panel.nodeForm.append(panel.overlapSelect, panel.sourceSelect);
  panel.inputs = new Map();
  const position = node('div', null, 'field tool-field');
  const pair = node('div', null, 'spatial-coordinate-pair');
  position.append(node('span', t('spatial.position')), pair);
  pair.append(node('span', '('));
  for (const key of ['beat', 'x', 'y', 'rotation', 'alpha', 'scaleX', 'scaleY', 'text']) {
    const label = node('label', null, 'field tool-field');
    const input = document.createElement('input'); input.type = 'text'; input.dataset.spatial = key;
    if(key==='x'||key==='y'){
      input.setAttribute('aria-label',t(`spatial.${key}`));
      if(key==='x'){panel.nodeForm.append(position);pair.append(input,node('span',','));}
      else pair.append(input,node('span',')'));
    }else{label.append(node('span', t(`spatial.${key}`)), input); panel.nodeForm.append(label);}
    panel.inputs.set(key, input);
    input.onfocus = () => {
      panel.inputBase = panel.context.session.chart; panel.inputValid = true;
      if (input.dataset.exactValue !== undefined) input.value = input.dataset.exactValue;
    };
    input.oninput = () => panel.editInput(key, input);
    input.onchange = () => panel.applyInput();
    input.onblur = () => panel.syncInspector(false);
    input.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); panel.applyInput(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); panel.deselect(); input.blur(); }
    };
  }
  const easing = node('section', null, 'spatial-node-easing tool-section');easing.dataset.spatialSection='easing';
  panel.easing = new SpatialEasingControls(easing, panel);panel.nodeForm.append(easing);
  panel.field(panel.nodeForm, 'continuous', 'checkbox');
  const actions = node('div', null, 'tool-actions');
  actions.append(spatialButton(t('spatial.delete'), () => panel.remove()),
    spatialButton(t('spatial.locate'), () => panel.selected && panel.seek(panel.selected.beat)));
  panel.nodeForm.append(actions);
  const remove = spatialButton(t('spatial.deleteEvent'), () => panel.remove(true)); remove.className = 'tool-wide';
  panel.nodeForm.append(remove); host.append(panel.nodeForm);

  const view = node('details', null, 'tool-section'); view.append(node('summary', t('spatial.viewOptions')));
  for (const args of [
    ['tilt', 'range', 0, 65, 1], ['future', 'number', 1, 128, 1], ['past', 'number', 0, 32, 1],
    ['size', 'range', .3, .95, .01], ['depth', 'range', 15, 180, 1],
    ['perspective', 'checkbox'], ['highlightPlane', 'checkbox'], ['forceOpaque', 'checkbox'], ['nodeNumbers', 'checkbox'], ['width', 'range', .5, 8, .25], ['nodeSize', 'range', 2, 9, .5],
    ['notes', 'checkbox'], ['fade', 'range', .25, 8, .25], ['animation', 'checkbox'],
  ]) panel.field(view, ...args);
  view.append(spatialButton(t('spatial.resetView'), () => panel.resetView())); host.append(view);
  const elements = node('details', null, 'tool-section'); elements.dataset.spatialSection = 'current-plane';
  elements.append(node('summary', t('spatial.currentElements')));
  for (const key of ['planeLines', 'planeNotes', 'planeHits', 'planeUI', 'planeNumbers', 'planeArrows', 'planeNoise', 'planeShaders']) panel.field(elements, key, 'checkbox');
  host.append(elements);
  panel.sampling = new SamplingControls(host, { change: () => panel.invalidate() });
  panel.sampling.readout.hidden = true;
  panel.message = node('p', null, 'hint tool-status'); panel.message.setAttribute('role', 'status');
  host.append(panel.message, spatialButton(t('spatial.back'), () => {
    panel.activate('chart');
  }));
  panel.syncInspector();
}
