import { expect, test } from '@playwright/test';

test.describe('Play vs Engine', () => {
  test('renders the board and sidebar controls', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /play vs engine/i })).toBeVisible();
    await expect(page.getByLabel(/skill level/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /new game/i })).toBeVisible();

    // chessground renders a .cg-wrap inside our host div
    await expect(page.locator('.cg-wrap')).toBeVisible({ timeout: 10_000 });
  });

  test('skill slider updates the visible value', async ({ page }) => {
    await page.goto('/');
    const slider = page.getByLabel(/skill level/i);
    await slider.fill('15');
    await expect(page.locator('label[for="skill"]')).toContainText('15');
  });

  test('new game button resets state', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /new game/i }).click();
    // After reset, the FEN line should still be the starting position.
    await expect(page.getByText(/rnbqkbnr\/pppppppp/)).toBeVisible();
  });
});
