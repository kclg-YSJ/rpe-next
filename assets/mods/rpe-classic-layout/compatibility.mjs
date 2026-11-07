import { Timeline } from '@rpen/ui/timeline.mjs';
import { EDITOR_SKIN_API } from '@rpen/core/editor-skin.mjs';
import { classicText } from './messages.mjs';

const selectors=['.transport','.workspace','.stage','.canvases','.inspector','.timeline-head','body > footer','#settings-modal','#event-curve-threshold','#realtime-alpha','#properties','#event-properties','#multi-editor','#notes','#events','#notes-only','#layer','#preferences','#chart-info','#chart-info-toggle','#line-select','#seek-beat','#settings-search'];

export function classicCompatibility(api){
  if(api.version!==1||EDITOR_SKIN_API!==3)return 'API';
  if(typeof api.patch!=='function'||typeof api.hook!=='function')return 'mod capabilities';
  const editor=api.editor,timeline=editor?.timeline;
  if(!timeline||!editor.editorSkins?.runtime||!editor.eventSampler)return 'editor';
  for(const key of ['noiseEditor','globalEvents','directPlacement','preview'])if(!editor[key])return key;
  if(typeof Object.getOwnPropertyDescriptor(Timeline.prototype,'referenceNoteScale')?.get!=='function')return 'referenceNoteScale';
  for(const key of ['draw','drawEvents','drawShaderEvents','syncMultiLineChrome','baseline','vertical','verticalForLine','eventColumnBounds','noteBaseWidth','multiLineLayout','getSession'])if(typeof timeline[key]!=='function')return key;
  for(const key of ['previewRectangles','previewEvent','draw'])if(typeof timeline.eventInteraction?.[key]!=='function')return 'eventInteraction.'+key;
  for(const selector of selectors)if(!document.querySelector(selector))return selector;
  if(!document.querySelector('#event-curve-threshold').closest('.settings-group')?.querySelector('.settings-reset'))return 'settings-reset';
  return '';
}

export const compatibilityNotice=detail=>classicText('RPE Classic 与当前编辑器界面不兼容，已保留墨线布局。缺少：','RPE Classic cannot adapt this editor interface. Inkline layout remains available. Missing: ')+detail;
