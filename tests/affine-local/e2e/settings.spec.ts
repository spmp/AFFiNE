import { test } from '@affine-test/kit/playwright';
import { openHomePage } from '@affine-test/kit/utils/load-page';
import { waitForEditorLoad } from '@affine-test/kit/utils/page-logic';
import {
  confirmExperimentalPrompt,
  openAboutPanel,
  openAppearancePanel,
  openEditorSetting,
  openExperimentalFeaturesPanel,
  openSettingModal,
  openShortcutsPanel,
} from '@affine-test/kit/utils/setting';
import { expect } from '@playwright/test';

test('Open settings modal', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openSettingModal(page);

  const modal = page.getByTestId('setting-modal');
  await expect(modal).toBeVisible();
});

test('change language using keyboard', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openSettingModal(page);

  const locator = page.getByTestId('language-menu-button');
  const oldName = await locator.textContent();
  await locator.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowDown', {
    delay: 50,
  });
  // incase the current language is the top one
  await page.keyboard.press('ArrowDown', {
    delay: 50,
  });
  await page.keyboard.press('Enter', {
    delay: 50,
  });
  {
    const newName = await locator.textContent();
    expect(oldName).not.toBe(newName);
  }
});

test('Change theme', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openSettingModal(page);
  await openAppearancePanel(page);
  const root = page.locator('html');

  await page.getByTestId('light-theme-trigger').click();
  const lightMode = await root.evaluate(element => element.dataset.theme);
  expect(lightMode).toBe('light');

  await page.getByTestId('dark-theme-trigger').click();
  const darkMode = await root.evaluate(element => element.dataset.theme);
  expect(darkMode).toBe('dark');
});

test('Change layout width', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openEditorSetting(page);

  await page.getByTestId('full-width-trigger').click();

  const editorWrapper = page.locator('.editor-wrapper');
  const className = await editorWrapper.getAttribute('class');
  expect(className).toContain('full-screen');
});

test('Connector shape includes rounded option in editor settings', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openEditorSetting(page);

  const elbowed = page.getByTestId('connector-shape-elbowed-trigger');
  const rounded = page.getByTestId('connector-shape-rounded-trigger');
  const curve = page.getByTestId('connector-shape-curve-trigger');

  await elbowed.scrollIntoViewIfNeeded();
  await expect(elbowed).toBeVisible();
  await expect(rounded).toBeVisible();
  await expect(curve).toBeVisible();

  const elbowedBox = await elbowed.boundingBox();
  const roundedBox = await rounded.boundingBox();
  const curveBox = await curve.boundingBox();

  expect(elbowedBox).not.toBeNull();
  expect(roundedBox).not.toBeNull();
  expect(curveBox).not.toBeNull();

  expect((roundedBox?.x ?? 0) > (elbowedBox?.x ?? 0)).toBe(true);
  expect((curveBox?.x ?? 0) > (roundedBox?.x ?? 0)).toBe(true);

  await rounded.click();
  await expect(rounded).toHaveAttribute('data-state', 'checked');
});

test('Connector corner radius slider is present and updates value', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openEditorSetting(page);

  const rounded = page.getByTestId('connector-shape-rounded-trigger');
  await rounded.scrollIntoViewIfNeeded();
  await rounded.click();

  const slider = page
    .getByTestId('connector-corner-radius-slider')
    .getByRole('slider');
  await expect(page.getByTestId('connector-corner-radius-row')).toBeVisible();
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute('aria-valuenow', '20');

  await slider.click();
  await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '24');
});

test('Connector hover to initiate defaults on and can be toggled', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openEditorSetting(page);

  const hoverToggle = page
    .getByTestId('connector-hover-to-initiate-trigger')
    .locator('input[type="checkbox"]');

  await expect(hoverToggle).toBeVisible();
  await expect(hoverToggle).toBeChecked();

  await hoverToggle.click();
  await expect(hoverToggle).not.toBeChecked();
});

test('Open shortcuts panel', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openSettingModal(page);
  await openShortcutsPanel(page);
  const title = page.getByTestId('keyboard-shortcuts-title');
  await expect(title).toBeVisible();
});

test('Open about panel', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openSettingModal(page);
  await openAboutPanel(page);
  const title = page.getByTestId('about-title');
  await expect(title).toBeVisible();
});

test('Open experimental features panel', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openSettingModal(page);
  await openExperimentalFeaturesPanel(page);
  const prompt = page.getByTestId('experimental-prompt');
  await expect(prompt).toBeVisible();
  await confirmExperimentalPrompt(page);
  const settings = page.getByTestId('experimental-settings');
  await expect(settings).toBeVisible();
});

test('palette gradient direction is clickable in appearance settings', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openSettingModal(page);
  await openAppearancePanel(page);

  await page.getByRole('button', { name: 'Add palette' }).click();

  await page.locator('button[aria-label*="swatch"]').last().click();

  const gradientToggle = page
    .locator('.mode-button')
    .filter({ hasText: 'Gradient' })
    .first();
  await gradientToggle.click();
  await expect(gradientToggle).toHaveClass(/active/);

  const directionButton = page.locator('[data-direction="NE"]').first();
  if (await directionButton.count()) {
    await directionButton.click();
    await expect(directionButton).toHaveClass(/active/);
  }
});

test('custom palette order persists after reload', async ({ page }) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openSettingModal(page);
  await openAppearancePanel(page);

  await page.getByRole('button', { name: 'Add palette' }).click();
  await page.getByRole('button', { name: 'Add palette' }).click();

  const customInputs = page.getByTestId('palette-name-input');
  await customInputs.first().fill('Persisted A');
  await customInputs.nth(1).fill('Persisted B');

  const editableCards = page
    .getByTestId('palette-card')
    .filter({ has: page.getByTestId('palette-name-input') });
  await editableCards.nth(1).dragTo(editableCards.first());

  const storageStateBefore = await page.evaluate(() => {
    const paletteKey = Object.keys(localStorage).find(
      key => key.startsWith('affine:workspace:') && key.includes(':palettes:v1')
    );
    if (!paletteKey) {
      throw new Error('workspace palette storage key not found');
    }
    return {
      paletteKey,
      value: localStorage.getItem(paletteKey),
    };
  });

  await page.reload();
  await waitForEditorLoad(page);

  const storageStateAfter = await page.evaluate(key => {
    return localStorage.getItem(key);
  }, storageStateBefore.paletteKey);

  expect(storageStateAfter).toBe(storageStateBefore.value);
});

test('custom palette persists when switching setting tabs', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openSettingModal(page);
  await openAppearancePanel(page);

  await page.getByRole('button', { name: 'Add palette' }).click();
  await page.getByTestId('palette-name-input').first().fill('Tab Persisted');

  await page.getByTestId('editor-panel-trigger').click();
  await openAppearancePanel(page);

  await expect(page.getByTestId('palette-name-input').first()).toHaveValue(
    'Tab Persisted'
  );
});

test('reset keeps default line and fill visibility from theme palettes', async ({
  page,
}) => {
  await openHomePage(page);
  await waitForEditorLoad(page);
  await openSettingModal(page);
  await openAppearancePanel(page);

  await page.getByRole('button', { name: 'Reset all' }).click();

  const initialPaletteState = await page.evaluate(() => {
    const paletteKey = Object.keys(localStorage).find(
      key => key.startsWith('affine:workspace:') && key.includes(':palettes:v1')
    );
    if (!paletteKey) throw new Error('workspace palette key not found');

    const value = JSON.parse(
      localStorage.getItem(paletteKey) ?? '[]'
    ) as Array<{
      name: string;
      showInLine?: boolean;
      showInFill?: boolean;
    }>;
    const gradient = value.find(item => item.name === 'material-gradient');
    return gradient;
  });

  expect(initialPaletteState?.showInLine).toBe(false);
  expect(initialPaletteState?.showInFill).toBe(true);

  const gradientLineLabel = page.getByTestId('line-visibility-label').nth(2);
  await gradientLineLabel.click();

  await page.getByRole('button', { name: 'Reset all' }).click();

  const resetPaletteState = await page.evaluate(() => {
    const paletteKey = Object.keys(localStorage).find(
      key => key.startsWith('affine:workspace:') && key.includes(':palettes:v1')
    );
    if (!paletteKey) throw new Error('workspace palette key not found');

    const value = JSON.parse(
      localStorage.getItem(paletteKey) ?? '[]'
    ) as Array<{
      name: string;
      showInLine?: boolean;
      showInFill?: boolean;
    }>;
    return value.find(item => item.name === 'material-gradient');
  });

  expect(resetPaletteState?.showInLine).toBe(false);
  expect(resetPaletteState?.showInFill).toBe(true);
});
