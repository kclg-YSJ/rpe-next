import { currentLocale } from '@rpen/core/i18n-core.mjs';

export const classicText=(chinese,english)=>currentLocale().locale.startsWith('zh')?chinese:english;
