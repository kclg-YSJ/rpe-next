/**
 * One row of a settings group.
 *
 * Tuples rather than objects because the group tables below are dense and positional; the trailing
 * three entries are the HTML `min`/`max`/`step` attributes and are omitted for `checkbox` rows,
 * which have no range.
 */
export type SettingsFieldType = 'range' | 'checkbox' | 'number' | 'color';
export type SettingsField = [
  id: string,
  text: string,
  type: SettingsFieldType,
  value: number | boolean | string,
  minimum?: number,
  maximum?: number,
  step?: number | 'any',
];

export function createSettingsPanel(): HTMLDialogElement {
  const dialog = document.createElement('dialog'); dialog.id = 'settings-modal';
  const title = document.createElement('h2'); title.textContent = '设置'; dialog.append(title);
  const body = document.createElement('div'); body.className = 'settings-body'; dialog.append(body);
  const skins = document.createElement('section'); skins.id = 'editor-skin-settings'; body.append(skins);
  const group = (heading: string, fields: SettingsField[]): void => {
    const section = document.createElement('section'); const title = document.createElement('h3'); title.textContent = heading; section.append(title);
    for (const [id, text, type, value, minimum, maximum, step] of fields) {
      const label = document.createElement('label'); label.className = 'field'; label.append(text);
      const input = document.createElement('input'); input.id = id; input.type = type; input.setAttribute('aria-label', text);
      input.dataset.rpenField = id; label.dataset.rpenField = id;
      if (type === 'checkbox') input.checked = Boolean(value); else input.value = String(value);
      if (minimum !== undefined) input.min = String(minimum); if (maximum !== undefined) input.max = String(maximum); if (step !== undefined) input.step = String(step);
      label.append(input); section.append(label);
    }
    body.append(section);
  };
  group('帧率', [['fps-unlimited', '无上限', 'checkbox', true], ['fps-limit', '帧率上限（FPS，大于 10）', 'number', 120, 10, undefined, 'any']]);
  // Both lookups are for elements `group` has just appended, so they exist; the narrowing keeps the
  // `HTMLInputElement` members (`disabled`) and the `Element` members (`append`) reachable.
  const fpsInput = body.querySelector<HTMLInputElement>('#fps-limit'); if (fpsInput) fpsInput.disabled = true;
  const fpsError = document.createElement('p'); fpsError.id = 'fps-limit-error'; fpsError.className = 'hint'; fpsError.hidden = true; fpsError.setAttribute('role', 'status'); fpsError.textContent = '请输入大于 10 的有限数字；无上限请勾选上方选项。'; body.lastElementChild?.append(fpsError);
  const fpsHint = document.createElement('p'); fpsHint.className = 'hint'; fpsHint.textContent = '实时生效并保存在本机。无上限表示编辑器不额外限帧；实际帧率仍受屏幕刷新率、浏览器、系统节能及性能影响。底栏显示实际绘制帧率，静止时按需绘制。'; body.lastElementChild?.append(fpsHint);
  group('显示与网格', [['bar-width', '节拍线宽度', 'range', 3, 0.5, 10, 0.1], ['bar-alpha', '节拍线亮度', 'range', 1, 0.1, 2, 0.05], ['judgement-offset', '底部判定线高度', 'range', 92, 42, 240, 1], ['event-value-size', '事件数值字号', 'range', 13, 8, 28, 1], ['event-value-threshold', '事件数值最小宽度', 'range', 30, 10, 180, 1], ['draw-event-curves', '绘制事件曲线', 'checkbox', true], ['event-curve-threshold', '事件曲线最小宽度', 'range', 24, 8, 180, 1], ['event-opacity', '事件条不透明度', 'range', 0.25, 0.05, 1, 0.05], ['event-bar-width', '事件条宽度比例', 'range', 0.82, 0.35, 1, 0.01], ['highlight-notes', '同时音符高亮', 'checkbox', true], ['seamless-events', '连续事件无接缝', 'checkbox', true], ['background-blur', '背景高斯模糊', 'range', 10.5, 0, 30, 0.5]]);
  group('音频与播放', [['volume', '音乐音量', 'range', 0.75, 0, 1, 0.01], ['hit-volume', '打击音效音量', 'range', 0.3, 0, 1, 0.01], ['hit-enabled', '启用打击音效', 'checkbox', true], ['autoplay-view', '进入预览自动播放', 'checkbox', true], ['scroll-speed', '滚轮时间调整速度', 'range', 5, 0.1, 100, 0.1], ['wheel-limit-audio-start', '滚轮调时不早于音频开头', 'checkbox', true]]);
  const wheelHint = document.createElement('p'); wheelHint.className = 'hint'; wheelHint.textContent = '默认最多退到音频 0 秒；谱面延迟可能使此处为负拍数。关闭限制后可继续向前调时。'; body.lastElementChild?.append(wheelHint);
  group('实时预览判定线', [['line-numbers', '显示判定线编号', 'checkbox', true], ['line-arrows', '显示方向箭头', 'checkbox', true], ['line-tint', '当前判定线染色', 'checkbox', true], ['merge-line-numbers', '合并相近且同向的编号', 'checkbox', true], ['pick-preview-lines', '点击预览判定线切换编辑线', 'checkbox', true]]);
  group('提示与通知', [['tips-enabled', '显示右下角 Tips', 'checkbox', true], ['success-notifications', '显示绿色完成通知', 'checkbox', true], ['note-source-hover', '悬停音符显示来源线', 'checkbox', true]]);
  group('噪域预览', [['pick-preview-noise-areas', '点击预览噪域进入编辑（优先于音符和判定线）', 'checkbox', true], ['seamless-noise-areas', '融合连贯噪域，隐藏内部接缝', 'checkbox', true], ['force-simple-noise', '忽略皮肤，使用简易渲染', 'checkbox', false]]);
  group('事件编辑', [['event-cut-density', '事件切割密度（每横线间隔的段数）', 'number', 4, 0.1, 128, 0.1], ['sample-auto-fit', '取样时自动扩大视野（结束后恢复）', 'checkbox', true]]);
  group('文本输入', [['text-selection-drag', '允许拖拽文本框中已选中的文字', 'checkbox', false]]);
  group('判定线切换', [['line-switcher-enabled', 'Ctrl+滚轮切线时显示附近线缩略图', 'checkbox', true]]);
  group('剪贴板', [['clipboard-history-enabled', '启用剪贴板历史（长按 Ctrl+V）', 'checkbox', true]]);
  const clipboardHint = document.createElement('p'); clipboardHint.className = 'hint'; clipboardHint.textContent = '历史仅保存在本机浏览器。固定项不会被新记录挤出；关闭功能暂停记录，保留已有历史。'; body.lastElementChild?.append(clipboardHint);
  group('默认判定线外观', [['default-line-thickness', '默认判定线宽度（粗细倍数）', 'number', 1.5, 0.1, 10, 0.1]]);
  const lineHint = document.createElement('p'); lineHint.className = 'hint'; lineHint.textContent = '实时生效，仅调整默认 line.png 的粗细，不改变长度、自定义贴图或谱面事件。1 为此前粗细，默认 1.5。'; body.lastElementChild?.append(lineHint);
  group('自动保存', [['autosave-enabled', '启用自动保存', 'checkbox', true], ['autosave-seconds', '自动保存间隔（秒）', 'number', 60, 1, 3600, 1], ['autosave-limit', '每谱保留备份数', 'number', 10, 1, 100, 1]]);
  const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '按固定间隔保存包含媒体的恢复副本，持续编辑不会推迟保存；手动保存更新谱面库。Y 缩放为绝对像素/秒，不随 BPM 或预览比例变化。'; body.append(hint);
  // The markup ships these three sections inside the settings dialog's origin; they are moved in
  // here so the panel owns the whole dialog body. Absent sections are skipped.
  group('编辑区域判定线', [['judgement-color', '底部判定线颜色', 'color', '#ffffff']]);
  for (const selector of ['.preview-settings', '.display-settings', '.compatibility-details']) { const section = document.querySelector(selector); if (section) body.append(section); }
  const hotkeys = document.createElement('button'); hotkeys.id = 'advanced-preferences'; hotkeys.textContent = '快捷键设置';
  const close = document.createElement('button'); close.textContent = '完成'; close.onclick = () => dialog.close();
  const actions = document.createElement('div'); actions.className = 'modal-actions'; actions.append(hotkeys, close); dialog.append(actions); document.body.append(dialog);
  return dialog;
}
