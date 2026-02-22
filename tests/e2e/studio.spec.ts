import { test, expect } from '@playwright/test';

test('studio smoke', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start Audio' })).toBeVisible();
});
