import { t } from '../i18n.mjs';
import { localPreferences } from '../platform/local-preferences.mjs';

const SKIN = 'rpe-classic', MOD = 'rpe-classic-layout';
const DISABLED = 'rpe-next-classic-layout-disabled-v1';

// A bundled layout follows the selected skin, not the user's ordinary mod list.
// No frame callback, package import or DOM observer is needed for other skins.
export class BuiltinSkinLayout {
  constructor(manager) {
    this.manager = manager; this.pending = Promise.resolve();
    try { this.suppressed = localPreferences.getItem(DISABLED) === 'true'; } catch { this.suppressed = false; }
    document.addEventListener('rpen-editor-skin-changed', () => this.schedule());
  }
  isCompanion(id) { return id === MOD && this.manager.records.get(id)?.builtin === true; }
  start() {
    this.ready = Promise.all([this.manager.ready, this.manager.editor.editorSkins.ready]).then(() => { this.lastSkin = this.manager.editor.editorSkins.current; this.started = true; return this.schedule(); });
  }
  schedule() {
    if (!this.started) return this.pending;
    this.pending = this.pending.catch(() => {}).then(() => this.sync()).catch(error => {
      if (this.manager.errors.get(MOD) !== error.message) this.manager.notify(error.message, 'warning');
      this.manager.errors.set(MOD, error.message);
    });
    return this.pending;
  }
  async prepare(id) {
    if (!this.isCompanion(id)) return;
    const skins = this.manager.editor.editorSkins;
    await skins.ready;
    const skin = skins.records.get(SKIN), mod = this.manager.records.get(MOD);
    if (!skin?.builtin || skin.skin.skinVersion !== mod.manifest.version) throw Error(t('builtin-skin-layout.version'));
    this.suppressed = false; this.manual = true; localPreferences.removeItem(DISABLED);
    if (skins.current !== SKIN) await skins.use(SKIN);
  }
  disabled(id = MOD) { if (id === MOD) { this.suppressed = true; localPreferences.setItem(DISABLED, 'true'); } }
  async sync() {
    const manager = this.manager, skins = manager.editor.editorSkins, current = skins.current;
    if (current !== this.lastSkin) { this.lastSkin = current; this.suppressed = false; localPreferences.removeItem(DISABLED); }
    if (!this.isCompanion(MOD)) return;
    if (current !== SKIN || this.suppressed || manager.safe && !this.manual) {
      if (manager.runtime.loaded.has(MOD)) await manager.runtime.unload(MOD);
      return;
    }
    if (skins.records.get(SKIN)?.skin.skinVersion !== manager.records.get(MOD).manifest.version) throw Error(t('builtin-skin-layout.version'));
    await manager.enable(MOD, false, new Set(), true);
    // A skin may change while its layout is being imported.
    if (skins.current !== SKIN || this.suppressed) await manager.runtime.unload(MOD);
  }
}
