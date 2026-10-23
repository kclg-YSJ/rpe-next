// Translates static markup without touching the templates: elements opt in with
// `data-i18n` (text), `data-i18n-title`, `data-i18n-aria-label`,
// `data-i18n-placeholder` and `data-i18n-alt`. `data-i18n-group` marks a
// subtree (a header, a dialog…) whose `aria-label` is translated too.
import { t, subscribe } from '../i18n.mjs';

const ATTRIBUTES = [['title', 'i18nTitle'], ['aria-label', 'i18nAriaLabel'], ['placeholder', 'i18nPlaceholder'], ['alt', 'i18nAlt']];

function translateElement(element) {
  const { i18n, i18nGroup } = element.dataset;
  if (i18n) element.textContent = t(i18n);
  for (const [attribute, property] of ATTRIBUTES) {
    const key = element.dataset[property];
    if (key) element.setAttribute(attribute, t(key));
  }
  if (i18nGroup) element.setAttribute('aria-label', t(i18nGroup));
}

export function translateDom(root = document) {
  for (const element of root.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-alt], [data-i18n-group]')) translateElement(element);
}

// Elements created dynamically can ask for the same treatment.
export function localize(element) {
  if (!element) return element;
  if (element.dataset?.i18n || element.dataset?.i18nGroup) translateElement(element);
  translateDom(element);
  return element;
}

let installed = false;
// Re-translates the whole document whenever the language changes, then lets
// the app redraw dynamic content through `onChange`.
export function installDomTranslation(onChange) {
  if (installed) return;
  installed = true;
  subscribe(() => {
    translateDom(document);
    try { onChange?.(); } catch { /* the app reports its own errors */ }
  });
  translateDom(document);
}
