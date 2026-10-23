import { cutSelectedEvents, stickSelectedEvents } from '../application/event-tools.mjs';
import { t } from '../i18n.mjs';

export function runEventTool(session, action, notify, beat) {
  try {
    const result = action === 'cut' ? cutSelectedEvents(session, { division: session.division, density: session.cutDensity, beat, tempo: session.tempo, factor: session.line?.bpmfactor ?? 1 }) : stickSelectedEvents(session);
    const message = result.changed ? action === 'cut' ? t('event-tools.sdf97600', { p0: result.changed, p1: result.generated }) : t('event-tools.s6d2d710', { p0: result.changed }) : t('event-tools.s955964e');
    notify(t('event-tools.s42cc575', { p0: message, p1: result.skipped ? t('event-tools.sfb31a17', { p0: result.skipped }) : '' }), result.changed ? 'success' : 'warning');
  } catch (error) { notify(error.message, 'error'); }
}
