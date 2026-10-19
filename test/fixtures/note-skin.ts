import { NOTE_SKIN_IMAGES } from '../../src/core/note-skin.ts';
export const encodeSkin = (value: string): Uint8Array => new TextEncoder().encode(value);
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes=new Uint8Array(33);bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);const view=new DataView(bytes.buffer);view.setUint32(8,13);view.setUint32(16,width);view.setUint32(20,height);return bytes;
}
export function noteSkinFixture(info = ''): Map<string, Uint8Array> {
  return new Map([['info.yml',encodeSkin('name: Test\nauthor: Local\nhitFx: [4, 4]\nholdAtlas: [12, 18]\nholdAtlasMH: [16, 22]\n'+info)],...NOTE_SKIN_IMAGES.map((name): [string, Uint8Array] => [name,pngHeader(name==='hit_fx.png'?512:160,name==='hit_fx.png'?512:name.startsWith('hold')?300:64)])]);
}
