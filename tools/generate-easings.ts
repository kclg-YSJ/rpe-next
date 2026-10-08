import { mkdir, writeFile } from 'node:fs/promises';
import { easingPicture } from '../src/core/easing-picture.ts';
const directory = new URL('../public/assets/easing/', import.meta.url);
await mkdir(directory, { recursive: true });
for (let type = 1; type <= 29; type++) await writeFile(new URL(`${type}.svg`, directory), easingPicture(type));
console.log('Generated 29 easing curves from the actual RPE easing functions.');
