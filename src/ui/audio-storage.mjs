import { showDialog } from './dialog.mjs';
import { audioStorageCall } from '../platform/audio-storage.mjs';
import { t } from '../i18n.mjs';

const node = (tag, text = '', className = '') => { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; };

export async function clearAudioCaches(notify = () => {}, bridge = globalThis.rpenAudioStorage) {
  const result = await audioStorageCall('clear', undefined, bridge);
  if (result) notify(result.warnings.length ? t('audio-storage.se0bbda8') : t('audio-storage.sb6e5d0b', { p0: (result.bytes / 1024 ** 2).toFixed(1) }), result.warnings.length ? 'warning' : 'success');
  return result;
}

export async function showAudioStorage(notify = () => {}, bridge = globalThis.rpenAudioStorage) {
  if (bridge?.version !== 1) return;
  const content = showDialog(t('audio-storage.s7647031'), t('audio-storage.se79870c'));
  const host = node('div', '', 'audio-storage-panel'); content.append(host);
  const modal = document.querySelector('#modal'); let state, working = false, closed = false;
  const message = node('p', t('audio-storage.se3d062c'), 'hint audio-storage-message'), progress = node('progress'); progress.hidden = true;
  const call = (action, options) => audioStorageCall(action, options, bridge);
  const failed = error => { message.textContent = error.message; notify(error.message, 'error'); };
  const removeProgress = bridge.onProgress?.(value => {
    if (closed) return;
    message.textContent = value.message;
    progress.hidden = false;
    if (value.total > 0) { progress.max = value.total; progress.value = value.copied ?? 0; message.textContent += ` ${((value.copied ?? 0) / value.total * 100).toFixed(0)}%`; }
    else progress.removeAttribute('value');
    if (!working && ['done', 'error', 'cleared'].includes(value.stage)) call('status').then(result => { state = result; progress.hidden = true; render(); }).catch(failed);
  });
  modal.addEventListener('close', () => { closed = true; removeProgress?.(); }, { once: true });
  const button = (label, task) => { const control = node('button', label); control.type = 'button'; control.disabled = working || state?.migrating || state?.cleaning || Boolean(state?.error); control.onclick = async () => { try { await task(); } catch (error) { failed(error); } }; return control; };
  const render = () => {
    if (closed) return; host.replaceChildren();
    for (const tool of state?.tools ?? []) {
      const section = node('section', '', 'audio-storage-tool'); section.append(node('h3', tool.name), node('code', tool.root, 'audio-storage-path'));
      const actions = node('div', '', 'audio-source-actions');
      for (const [label, kind] of [[t('audio-storage.s09bbb3c'), 'models'], [t('audio-storage.sede8fe2'), 'cache'], [t('audio-storage.s93d53cf'), 'pip-cache'], [t('audio-storage.s35154ca'), 'root']]) actions.append(button(label, () => call('open', { id: tool.id, kind })));
      section.append(actions); const environment = node('details'); environment.append(node('summary', t('audio-storage.s598c40e')), node('code', tool.runtime, 'audio-storage-path')); section.append(environment); host.append(section);
    }
    host.append(node('p', state?.needsSetup ? t('audio-storage.s450d72e') : t('audio-storage.sa5f4af3'), 'hint'));
    if (state?.error) host.append(node('p', state.error, 'audio-storage-message'));
    for (const warning of state?.warnings ?? []) host.append(node('p', warning, 'hint audio-storage-message'));
    host.append(progress, message);
    const actions = node('div', '', 'audio-source-actions');
    actions.append(button(working ? t('audio-storage.sce9fd54') : state?.needsSetup ? t('audio-storage.sa13025a') : t('audio-storage.s8532de0'), async () => {
      working = true; message.textContent = t('audio-storage.sc8b2912'); render();
      try {
        const initial = state.needsSetup, result = await call(initial ? 'prepare' : 'migrate');
        state = await call('status');
        if (initial && result) { message.textContent = t('audio-storage.sa30f9f0'); notify(message.textContent, 'success'); }
        else if (result) { message.textContent = t('audio-storage.sea62668') + (result.bytes / 1024 ** 3).toFixed(2) + ' GiB' + t('common.period'); notify(result.warnings.length ? t('audio-storage.se16e781') : t('audio-storage.s5651912'), result.warnings.length ? 'warning' : 'success'); }
        else message.textContent = initial ? t('audio-storage.s2eff0ba') : t('audio-storage.sc62fb66');
      } catch (error) { try { state = await call('status'); } catch {} failed(error); }
      finally { working = false; progress.hidden = true; render(); }
    }), button(t('audio-storage.sd3b6b86'), async () => {
      working = true; render();
      try { const result = await clearAudioCaches(notify, bridge); if (result) message.textContent = result.warnings.length ? t('audio-storage.s3ff7103') + result.warnings.join('\n') : t('audio-storage.s7680f52'); state = await call('status'); }
      catch (error) { failed(error); }
      finally { working = false; progress.hidden = true; render(); }
    })); host.append(actions);
  };
  host.append(message);
  try { state = await call('status'); message.textContent = state.migrating ? t('audio-storage.s5c0cee3') : ''; render(); } catch (error) { failed(error); }
}
