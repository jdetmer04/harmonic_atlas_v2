// Proves the architecture lint rules actually fire, so a typo in a regex
// can't silently turn a boundary off.
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: process.cwd() });

async function isRestricted(filePath: string, code: string): Promise<boolean> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).some((m) => m.ruleId === 'no-restricted-imports');
}

describe('core/ imports nothing outside core/', () => {
  it.each([
    ['../state/store', 'import { x } from "../state/store"; export { x };'],
    ['../engine/synths', 'import { x } from "../engine/synths"; export { x };'],
    ['./../views/x', 'import { x } from "./../views/x"; export { x };'],
    ['react', 'import { useState } from "react"; export { useState };'],
    ['tone', 'import * as Tone from "tone"; export { Tone };'],
    ['type-only import', 'import type { X } from "../state/store"; export type { X };'],
  ])('rejects %s', async (_, code) => {
    expect(await isRestricted('src/core/example.ts', code)).toBe(true);
  });

  it.each([
    ['sibling module', 'import { x } from "./pcset"; export { x };'],
    ['tonal', 'import { Chord } from "tonal"; export { Chord };'],
    ['tonal subpath', 'import { x } from "tonal/sub"; export { x };'],
  ])('allows %s', async (_, code) => {
    expect(await isRestricted('src/core/example.ts', code)).toBe(false);
  });
});

describe('views/ never import engine/', () => {
  it('rejects engine from a view', async () => {
    const code = 'import { x } from "../../engine/synths"; export { x };';
    expect(await isRestricted('src/views/tonnetz/draw.ts', code)).toBe(true);
  });

  it('allows core and state from a view', async () => {
    const code = [
      'import { a } from "../../core/tonnetz";',
      'import { b } from "../../state/selectors";',
      'export { a, b };',
    ].join('\n');
    expect(await isRestricted('src/views/tonnetz/draw.ts', code)).toBe(false);
  });

  it('still lets engine/ and app/ import engine/', async () => {
    const code = 'import { x } from "../engine/synths"; export { x };';
    expect(await isRestricted('src/app/App.tsx', code)).toBe(false);
  });
});

describe('only state/commands.ts mutates the sketch', () => {
  const code = 'import { setSketch } from "./mutate"; export { setSketch };';

  it('allows commands.ts', async () => {
    expect(await isRestricted('src/state/commands.ts', code)).toBe(false);
  });

  it.each([
    ['src/state/store.ts', code],
    ['src/state/selectors.ts', code],
    ['src/engine/transport.ts', 'import { s } from "../state/mutate"; export { s };'],
    ['src/views/tonnetz/draw.ts', 'import { s } from "../../state/mutate"; export { s };'],
    ['src/app/App.tsx', 'import { s } from "../state/mutate"; export { s };'],
  ])('rejects %s', async (filePath, source) => {
    expect(await isRestricted(filePath, source)).toBe(true);
  });
});
