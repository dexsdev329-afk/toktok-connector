// Génère les illustrations des jeux du site (originales, sans logo ni personnage existant) avec l'API
// d'images d'OpenAI, puis les convertit en WebP pour public/img/jeux/.
//
//   OPENAI_API_KEY=... node scripts/generate-game-images.mjs            (toutes les images)
//   OPENAI_API_KEY=... node scripts/generate-game-images.mjs gamepad    (une seule)
//
// La clé est lue dans l'environnement : ne jamais l'écrire dans un fichier du dépôt.
// Conversion : ImageMagick (`magick` ou `convert`) doit être installé.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/img/jeux/', import.meta.url));
if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY manquante');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const STYLE =
  'Original stylized digital illustration for a gaming website banner, wide composition, dark navy background, ' +
  'vibrant neon pink (#ff2d75) and cyan (#22e3ff) accent lighting, cinematic depth, high detail. ' +
  'Absolutely no text, no letters, no logos, no watermarks, no real brands, no existing copyrighted characters.';
const SUBJECTS = {
  'minecraft-java':
    'A blocky voxel-art world at night: cube-shaped grassy hills, square pixel trees, a glowing cube portal, small blocky creature silhouettes and a red explosive cube about to burst.',
  'minecraft-bedrock':
    'A voxel-art village of cube houses on a floating island at sunset, tiny blocky builders placing glowing cubes.',
  'gta-chaos':
    'A neon-lit modern city street at night with fast sports cars, a huge swirling purple chaos vortex in the sky, cars and objects floating in low gravity.',
  'unity-mods':
    'Glowing 3D puzzle pieces and gears assembling a miniature game world inside a holographic cube, futuristic modding workshop.',
  'any-pc':
    'A glowing RGB mechanical gaming keyboard and mouse on a desk, a colorful action game on a monitor in the background, light trails from key presses.',
  gamepad:
    'A futuristic game controller floating in space with glowing buttons and energy trails, signal waves around it.',
  'browser-games':
    'Floating web browser windows in space each showing a colorful 3D mini game, connected by beams of light to a glowing globe.',
  'home-games':
    'A cozy creator room with a small handmade arcade cabinet showing a homemade game, string lights, sketches on the wall.',
  webhook:
    'An abstract network of glowing nodes and cables connecting servers, chat bubbles and game icons, data packets flowing as light.',
};
const only = process.argv[2] ? process.argv[2].split(',') : Object.keys(SUBJECTS);
await Promise.all(
  only.map(async (id) => {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: `${SUBJECTS[id]} ${STYLE}`,
        size: '1536x1024',
        quality: 'medium',
        n: 1,
      }),
    });
    const json = await res.json();
    if (!res.ok) return console.log(id, 'ERROR', res.status, JSON.stringify(json).slice(0, 300));
    const png = `${OUT}${id}.png`;
    writeFileSync(png, Buffer.from(json.data[0].b64_json, 'base64'));
    const magick = process.platform === 'win32' ? 'magick' : 'convert';
    execFileSync(magick, [
      png,
      '-resize',
      '960x640^',
      '-gravity',
      'center',
      '-extent',
      '960x640',
      '-quality',
      '78',
      `${OUT}${id}.webp`,
    ]);
    rmSync(png);
    console.log(id, 'ok');
  }),
);
