import { test, expect } from '@playwright/test';

test('studio smoke and tabs', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start Audio' })).toBeVisible();
  await page.getByRole('button', { name: 'Patch' }).click();
  await expect(page.getByRole('button', { name: 'Save Local' })).toBeVisible();
  expect(errors).toEqual([]);
});
