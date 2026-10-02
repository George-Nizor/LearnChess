/// <reference lib="dom" />
import { expect, test } from '@playwright/test';

test.describe('Play vs Engine', () => {
  test('renders the board, strength controls, and local engine', async ({ page }) => {
    await page.goto('/play');
    await expect(page.getByRole('radiogroup', { name: 'Strength' })).toBeVisible();
    await expect(page.getByRole('button', { name: /new game/i })).toBeVisible();
    await expect(page.locator('.cg-wrap')).toBeVisible();
    await expect(page.getByText('Stockfish ready', { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test('advanced skill slider updates the visible value', async ({ page }) => {
    await page.goto('/play');
    await page.getByText('Customise (advanced)', { exact: true }).click();
    await page.getByLabel(/skill level/i).fill('15');
    await expect(page.locator('label[for="skill"]')).toContainText('15');
  });

  test('plays a complete turn and starts a new game', async ({ page }) => {
    await page.goto('/play');
    await expect(page.getByText('Stockfish ready', { exact: true })).toBeVisible({ timeout: 20_000 });
    const board = page.locator('cg-board');
    const bounds = await board.boundingBox();
    if (!bounds) throw new Error('Chess board is missing');
    await board.click({ position: { x: bounds.width * 4.5 / 8, y: bounds.height * 6.5 / 8 } });
    await board.click({ position: { x: bounds.width * 4.5 / 8, y: bounds.height * 4.5 / 8 } });
    const fen = page.getByText(/^FEN:/);
    await expect(fen).not.toContainText('PPPPPPPP/RNBQKBNR w');
    await expect(fen).toContainText(' w ', { timeout: 20_000 });
    await page.getByRole('button', { name: /new game/i }).click();
    await expect(fen).toContainText('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  test('primary navigation keeps the upgraded router functional', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/play');
    for (const route of ['openings', 'endgames', 'tactics', 'analysis', 'play', 'dashboard']) {
      await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name: new RegExp(`^${route}$`, 'i') }).click();
      await expect(page).toHaveURL(new RegExp(`/${route}$`));
      await expect(page.getByRole('main')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
  test('redistributable artwork and generated sound packs load', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('learnchess.pieceSet', 'alpha'));
    await page.goto('/settings');
    await expect(page.locator('link[href*="piece-sets/alpha"]')).toHaveCount(0);
    const durations = await page.evaluate(async () => {
      const context = new AudioContext();
      try {
        const results: number[] = [];
        for (const pack of ['standard', 'piano', 'nes', 'futuristic']) {
          for (const kind of ['move', 'capture', 'check', 'genericNotify']) {
            const response = await fetch(`/sounds/${pack}/${kind}.wav`);
            if (!response.ok) throw new Error('Missing sound ' + pack + '/' + kind);
            results.push((await context.decodeAudioData(await response.arrayBuffer())).duration);
          }
        }
        return results;
      } finally { await context.close(); }
    });
    expect(durations).toHaveLength(16);
    expect(durations.every(duration => duration > 0 && duration < 1)).toBe(true);
  });

});
