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
