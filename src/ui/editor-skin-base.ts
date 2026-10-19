// Only installed while a skin is active. The default editor keeps styles.css.
export const EDITOR_SKIN_DEFAULT_TOKENS = Object.freeze({
  background: '#303030', surface: '#303030', 'surface-alt': '#282828', elevated: '#202020', input: '#383838', hover: '#505050',
  text: '#f0f0f0', muted: '#aaaaaa', border: '#666666', 'border-strong': '#888888', accent: '#ffdc70', 'accent-text': '#ffe49b',
  selected: '#4d4632', 'selected-border': '#aa9251', success: '#65c878', warning: '#e6c65c', error: '#e46e6e', info: '#8dd6ee',
  radius: '1px', 'radius-panel': '4px', 'font-family': 'RPE, "Microsoft YaHei", sans-serif', 'font-size': '13px',
  'control-height': '29px', 'control-padding': '6px 10px', gap: '6px', 'inspector-width': '29.7%', 'panel-shadow': '0 4px 16px #0005',
  'motion-fast': '120ms', 'motion-normal': '220ms', 'motion-easing': 'ease', 'icon-filter': 'none', 'scrollbar-thumb': '#777777',
});

export function baseEditorSkinCss(skin: { id?: string }): string {
  const scope = `:root[data-editor-skin="${skin.id ?? ''}"]`;
  const vars = Object.entries(EDITOR_SKIN_DEFAULT_TOKENS).map(([key, value]) => `--rpen-${key}:${value}`).join(';');
  return `${scope}{${vars};--accent:var(--rpen-accent);--muted:var(--rpen-muted);--line:var(--rpen-border);font-family:var(--rpen-font-family);font-size:var(--rpen-font-size);color:var(--rpen-text);background:var(--rpen-background)}
${scope} body{background:var(--rpen-background);color:var(--rpen-text)}
${scope} :where(.inspector,.editor){--accent:var(--rpen-accent);--muted:var(--rpen-muted);--line:var(--rpen-border);font-family:var(--rpen-font-family);font-size:var(--rpen-font-size)}
${scope} :where(button,input,select,textarea){font-family:inherit;color:var(--rpen-text);background:var(--rpen-input);border-color:var(--rpen-border);border-radius:var(--rpen-radius)}
${scope} button:not(.batch-ball){transition:background-color var(--rpen-motion-fast) var(--rpen-motion-easing),border-color var(--rpen-motion-fast) var(--rpen-motion-easing)}
${scope} :where(.action-grid button,.modal-actions button,.editor-skin-actions button,header nav button){padding:var(--rpen-control-padding);min-height:var(--rpen-control-height)}
${scope} :where(button,input,select,textarea):focus-visible{outline:2px solid var(--rpen-accent);outline-offset:1px}
${scope} button:hover{background:var(--rpen-hover);border-color:var(--rpen-border-strong)}
${scope} :where(button.active,button.primary,.asset-row.selected,.clipboard-card.active,.line-switcher-card.selected,.multi-line-row.selected){color:var(--rpen-accent-text);background:var(--rpen-selected);border-color:var(--rpen-selected-border)}
${scope} :where(input[type=range],input[type=checkbox],input[type=radio]){accent-color:var(--rpen-accent)}
${scope} :where(header,.transport,body > footer,.inspector-tabs){background:var(--rpen-elevated);border-color:var(--rpen-border)}
${scope} :where(.editor,.inspector,#home,.home-heading,.settings-body,.noise-fit-scroll,.noise-tracking-scroll,.text-lines-scroll){background:var(--rpen-surface);color:var(--rpen-text)}
${scope} :where(.editor-toolbar,.editor-footer,.timeline-head,.panel-title,.line-switcher,.asset-details,.batch-panel-actions,.noise-fit-footer,.noise-tracking-footer,.text-lines-footer,.trajectory-footer,.asset-folder > summary,#multi-line-labels,.noise-layer-panel,.clipboard-card,.timeline-strip){background:var(--rpen-surface-alt);border-color:var(--rpen-border);color:var(--rpen-text)}
${scope} :where(dialog,.timeline-context-menu,.collaboration-chat){background:var(--rpen-surface);color:var(--rpen-text);border-color:var(--rpen-border);border-radius:var(--rpen-radius-panel);box-shadow:var(--rpen-panel-shadow)}
${scope} dialog::backdrop{background:#0007}
${scope} :where(.note-skin-card,.note-skin-form details,.note-skin-materials){background:var(--rpen-surface-alt);border-color:var(--rpen-border);color:var(--rpen-text)}
${scope} .note-skin-card[aria-pressed=true]{border-color:var(--rpen-accent);outline-color:var(--rpen-accent)}
${scope} :where(.hint,#document-name,#selection-info,#hotkey-help,.project-detail,.project-credits,.chart-info,.asset-details p,footer,#compatibility,.clipboard-select span){color:var(--rpen-muted)}
${scope} :where(h1,h2,h3,.panel-title,strong,.chart-info dd,.project-title){color:var(--rpen-text)}
${scope} label,${scope} #clock{color:var(--rpen-text)}
${scope} #beat-display{color:var(--rpen-muted)}
${scope} #document-name,${scope} #selection-info,${scope} #hotkey-help,${scope} small,${scope} .view-controls-inline label span{color:var(--rpen-muted)}
${scope} summary,${scope} .home-heading p,${scope} .project-card time{color:var(--rpen-muted)}
${scope} .multi-line-width-controls output,${scope} #noise-properties h3{color:var(--rpen-text)}
${scope} .editor.noise-mode .timeline-head::before{color:var(--rpen-text)}
${scope} .editor.global-events-mode .timeline-head::before{color:var(--rpen-text)}
${scope} .editor.noise-mode .noise-toolbar-close,${scope} .noise-input-controls > button{color:var(--rpen-info)}
${scope} .multi-line-head-controls button.active,${scope} .multi-line-controls button.active,${scope} .analysis-mode-buttons button.active,${scope} .layer-buttons button.active{color:var(--rpen-accent-text);background:var(--rpen-selected);border-color:var(--rpen-selected-border)}
${scope} .noise-sample-bar,${scope} .hotkey-toolbar{background:var(--rpen-elevated);border-color:var(--rpen-border)}
${scope} .noise-sample-bar .hint{color:var(--rpen-muted)}
${scope} .batch-ball,${scope} .batch-ball:hover,${scope} .batch-ball:active{background:var(--ball-color);padding:0;border-radius:50%;min-height:18px}
${scope} :where(.line-group-label,.multi-line-group-name,.line-switcher-group,.asset-folder > summary,.asset-details strong){color:var(--rpen-info)}
${scope} :where(.line-feature,.multi-line-features,.line-list-features){color:var(--rpen-warning)}
${scope} :where(.line-entry,.multi-line-row,.project-card,.asset-row,.asset-tree,.batch-parameters,.noise-layer-card,.curve-presets details,.trajectory-preset-grid > button,.trajectory-preset-editor,.curve-syntax){background:var(--rpen-surface-alt);border-color:var(--rpen-border);color:var(--rpen-text)}
${scope} :where(.project-cover,.asset-row img,.asset-details > img,.asset-editor-canvas,.trajectory-preview,.curve-preview,.trajectory-preset-thumbnail){background:var(--rpen-background);border-color:var(--rpen-border)}
${scope} :where(.editor-notification,.collaboration-chat-message,#note-source-toast){background:var(--rpen-elevated);color:var(--rpen-text);box-shadow:var(--rpen-panel-shadow)}
${scope} .editor-notification.success{border-color:var(--rpen-success)}
${scope} .editor-notification.warning{border-color:var(--rpen-warning)}
${scope} :where(.editor-notification.error,.error,.batch-error,.export-error){color:var(--rpen-error);border-color:var(--rpen-error)}
${scope} :where(.multi-line-group > summary,.line-group > summary,.asset-folder > summary){background:var(--rpen-surface-alt)}
${scope} :where(.line-switcher-card,.line-switcher-filters,.line-switcher-meta,.line-switcher-title){color:var(--rpen-text);background:var(--rpen-surface-alt)}
${scope} button[data-icon]::before,${scope} #mute-current-line img{filter:var(--rpen-icon-filter)}
${scope} *{scrollbar-color:var(--rpen-scrollbar-thumb) var(--rpen-surface-alt)}
@media(min-width:701px){${scope} .workspace{grid-template-columns:minmax(0,1fr) minmax(240px,var(--rpen-inspector-width))}}
`;
}
