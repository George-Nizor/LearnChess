/** Generate LearnChess's original notification sounds; no third-party recordings. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const target = resolve(dirname(fileURLToPath(import.meta.url)), '../public/sounds');
const rate = 24000;
const packs = ['standard', 'piano', 'nes', 'futuristic'] as const;
const notes: Record<string, number[]> = {
  move: [330], capture: [220, 440], check: [660, 660], genericNotify: [440, 550, 660],
};
for (const pack of packs) {
  mkdirSync(join(target, pack), { recursive: true });
  for (const [kind, frequencies] of Object.entries(notes)) {
    const noteSeconds = pack === 'standard' ? 0.09 : 0.14;
    const count = Math.ceil((frequencies.length * noteSeconds + 0.04) * rate);
    const wav = Buffer.alloc(44 + count * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
    for (let i = 0; i < count; i++) {
      const seconds = i / rate;
      const note = Math.floor(seconds / noteSeconds);
      if (note >= frequencies.length) continue;
      const t = seconds - note * noteSeconds;
      const phase = 2 * Math.PI * frequencies[note] * t;
      let wave = Math.sin(phase);
      if (pack === 'nes') wave = Math.tanh(wave * 4) * 0.7;
      if (pack === 'piano') wave = (wave + 0.3 * Math.sin(phase * 2) + 0.12 * Math.sin(phase * 3)) / 1.42;
      if (pack === 'futuristic') wave = Math.sin(phase + 2 * Math.sin(phase * 0.5));
      const envelope = Math.min(1, t / 0.004) * Math.exp(-t * 40) * Math.min(1, (noteSeconds - t) / 0.008);
      wav.writeInt16LE(Math.round(wave * envelope * 0.22 * 32767), 44 + i * 2);
    }
    writeFileSync(join(target, pack, `${kind}.wav`), wav);
    if (pack === 'standard') writeFileSync(join(target, `${kind}.wav`), wav);
  }
}
console.log('Generated four original LearnChess sound packs.');
