import { t } from '../i18n.mjs';
let provider=null;
export const apiVersion=1;
export function installModApi(value){provider=value;}
export function getModHost(){if(!provider)throw Error(t('mod-api.sd95303b'));return provider;}
export function getEditor(){return getModHost().editor;}
export default getEditor;
