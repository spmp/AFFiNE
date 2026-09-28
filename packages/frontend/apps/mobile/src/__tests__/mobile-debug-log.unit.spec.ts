/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMobileDebugLogCapture, MARKER } from '../mobile-debug-log';

describe('installMobileDebugLogCapture', () => {
  let originalConsoleDebug: typeof console.debug;
  let originalFetch: typeof fetch;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    originalConsoleDebug = console.debug;
    originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    console.debug = originalConsoleDebug;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('enqueues marker-prefixed console.debug calls and still forwards to the original console.debug', () => {
    const preInstallDebug = vi.fn();
    console.debug = preInstallDebug;

    dispose = installMobileDebugLogCapture();
    console.debug(`${MARKER} keyboard-toolbar-style-bottom`, { foo: 'bar' });

    expect(preInstallDebug).toHaveBeenCalledWith(
      `${MARKER} keyboard-toolbar-style-bottom`,
      { foo: 'bar' }
    );
  });

  it('does not enqueue or fetch for non-marker console.debug calls', () => {
    dispose = installMobileDebugLogCapture();
    console.debug('some unrelated debug line');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('persists the client id across two installer calls within the same storage', () => {
    dispose = installMobileDebugLogCapture();
    const firstId = localStorage.getItem('affine-mobile-debug-log-client-id');
    dispose();

    dispose = installMobileDebugLogCapture();
    const secondId = localStorage.getItem('affine-mobile-debug-log-client-id');

    expect(firstId).toBeTruthy();
    expect(secondId).toBe(firstId);
  });

  it('fires an immediate POST to /api/mobile-debug-log/collect once MAX_BATCH_SIZE is reached', () => {
    dispose = installMobileDebugLogCapture();
    const clientId = localStorage.getItem('affine-mobile-debug-log-client-id');

    for (let i = 0; i < 50; i++) {
      console.debug(`${MARKER} entry-${i}`);
    }

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('/api/mobile-debug-log/collect');
    const body = JSON.parse(options.body);
    expect(body.clientId).toBe(clientId);
    expect(body.entries).toHaveLength(50);
  });

  it('does not throw or produce an unhandled rejection when the fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('boom'));
    dispose = installMobileDebugLogCapture();

    expect(() => {
      for (let i = 0; i < 50; i++) {
        console.debug(`${MARKER} entry-${i}`);
      }
    }).not.toThrow();

    // let the rejected promise's .catch handler run
    await Promise.resolve();
    await Promise.resolve();
  });
});
