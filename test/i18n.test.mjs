import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_LOCALES, setLocale, currentLocale, normalizeLocale, numberText, dateText, joinList, registerCatalog, localizedValue, subscribe, t } from '../src/i18n.mjs';
import { createLine } from '../src/core/chart.mjs';
import { groupDisplayName, isUngrouped } from '../src/core/labels.mjs';
import { isDefaultLineName, lineNameLabel } from '../src/core/line-groups.mjs';

test('语言匹配保留完整标签，同语种回退返回有效目录，未知语言回退中文', context => {
  context.after(() => setLocale('zh-CN'));
  for (const locale of ['en-US', 'en', 'en-GB', 'EN_au']) {
    assert.equal(setLocale(locale).locale, 'en-US'); assert.equal(currentLocale().base, 'en');
    assert.equal(t('settings.language'), 'Interface language');
  }
  for (const locale of ['zh-CN', 'zh', 'zh-Hant-TW', 'not-a-language']) assert.equal(setLocale(locale).locale, 'zh-CN');
  assert.equal(normalizeLocale('zh_hant_tw'), 'zh-Hant-TW');
  assert.equal(normalizeLocale('EN_us'), 'en-US'); assert.equal(normalizeLocale(''), '');
});

test('切换语言后数字、日期和列表格式缓存刷新，订阅者只收到实际变更', context => {
  context.after(() => setLocale('zh-CN')); setLocale('zh-CN');
  registerCatalog({ locale: 'de-DE', label: 'Deutsch', messages: { 'i18n.list': '{items}' } });
  registerCatalog({ locale: 'en-US', label: 'English', messages: { ...BUILTIN_LOCALES[1].messages, 'i18n.list': '{items}' } });
  context.after(() => registerCatalog(BUILTIN_LOCALES[1]));
  const updates = [], off = subscribe(locale => updates.push(locale.locale)); context.after(off);
  const instant = new Date('2026-02-18T12:00:00Z'), options = { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' };
  for (const locale of ['en-US', 'de-DE', 'en-US']) {
    setLocale(locale); assert.equal(numberText(1234.5), new Intl.NumberFormat(locale).format(1234.5));
    assert.equal(dateText(instant, options), new Intl.DateTimeFormat(locale, options).format(instant));
    assert.equal(t('i18n.list', { items: ['A', 'B'] }), new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(['A', 'B']));
  }
  setLocale('en-US'); assert.deepEqual(updates, ['en-US', 'de-DE', 'en-US']);
});

test('列表连接、括号和默认判定线名称跟随界面语言', context => {
  context.after(() => setLocale('zh-CN'));
  setLocale('en-US');
  assert.equal(joinList(['A', 'B', 'C']), 'A, B, and C');
  assert.equal(t('common.parenthesized', { text: '3' }), ' (3)');
  assert.equal(t('editor.noteCount', { count: 1 }), '1 note');
  assert.equal(t('editor.noteCount', { count: 2 }), '2 notes');
  assert.equal(createLine().Name, 'Judge line');
  setLocale('zh-CN');
  assert.equal(joinList(['A', 'B', 'C']), 'A、B和C');
  assert.equal(t('common.parenthesized', { text: '3' }), '（3）');
  assert.equal(t('editor.noteCount', { count: 1 }), '1 音符');
  assert.equal(t('editor.noteCount', { count: 2 }), '2 音符');
  assert.equal(createLine().Name, '判定线');
});

test('缺少翻译的计数消息使用回退语言的复数规则，多语言值保持原始数据', context => {
  context.after(() => { registerCatalog(BUILTIN_LOCALES[0]); setLocale('zh-CN'); });
  registerCatalog({ ...BUILTIN_LOCALES[0], messages: { ...BUILTIN_LOCALES[0].messages, 'i18n.count.one': 'wrong category', 'i18n.count.other': '中文 {count}' } });
  setLocale('en-US'); assert.equal(t('i18n.count', { count: 1 }), '中文 1'); assert.equal(t('i18n.count', { count: 2 }), '中文 2');
  const labels = { 'zh-CN': '名称', 'en-GB': 'Name' }, before = structuredClone(labels);
  assert.equal(localizedValue(labels), 'Name'); setLocale('de-DE'); assert.equal(localizedValue(labels), '名称'); assert.deepEqual(labels, before);
});

test('历史默认分组和判定线名称识别不依赖当前界面语言', context => {
  context.after(() => setLocale('zh-CN'));
  for (const locale of ['en-US', 'zh-CN']) {
    setLocale(locale);
    for (const value of ['', '未分组', 'Ungrouped']) { assert.equal(isUngrouped(value), true); assert.equal(groupDisplayName(value), t('units.ungrouped')); }
    assert.equal(groupDisplayName('My group'), 'My group');
    for (const name of ['Line 1', '判定线 1', '判定线1']) { assert.equal(isDefaultLineName({ Name: name }, 0), true); assert.equal(lineNameLabel({ Name: name }, 0), locale === 'en-US' ? 'Line 0' : '线 0'); }
    assert.equal(lineNameLabel({ Name: 'My line' }, 0), 'My line');
  }
});
