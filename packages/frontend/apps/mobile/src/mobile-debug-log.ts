/**
 * Debug-only capture-and-transport for verbose `console.debug` instrumentation
 * emitted by mobile-specific code (notably the keyboard-toolbar's Y-positioning
 * logic in `blocksuite/affine/widgets/keyboard-toolbar`).
 *
 * BlockSuite packages must not import AFFiNE app-shell code, so the only
 * bridge between blocksuite instrumentation and this HTTP transport is the
 * global `console.debug` function itself: instrumentation call sites just
 * call plain `console.debug(MARKER, ...)`, and this module monkey-patches
 * `console.debug` (once, from the app shell) to also capture and forward
 * matching calls — while always still calling the original console.debug
 * first, so on-device Safari remote debugging keeps seeing every call live.
 */

export const MARKER = '[MobileDebugLog]';

const STORAGE_KEY = 'affine-mobile-debug-log-client-id';
const COLLECT_ENDPOINT = '/api/mobile-debug-log/collect';
const MAX_BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;

interface BufferedEntry {
  message: string;
  timestampMs: number;
}

function getOrCreateClientId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    // localStorage may throw (e.g. private-browsing restrictions) — fall
    // back to an in-memory-only id for the lifetime of this page load.
    return crypto.randomUUID();
  }
}

function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

export function installMobileDebugLogCapture(): () => void {
  const clientId = getOrCreateClientId();
  const buffer: BufferedEntry[] = [];
  const originalConsoleDebug = console.debug.bind(console);

  function flush() {
    if (buffer.length === 0) return;
    const entries = buffer.splice(0, buffer.length);
    fetch(COLLECT_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId, entries }),
    }).catch(() => {
      // Best-effort debug telemetry: disabled endpoint, unauthenticated,
      // offline, whatever — never allowed to throw into the app.
    });
  }

  console.debug = (...args: unknown[]) => {
    originalConsoleDebug(...args);

    if (typeof args[0] !== 'string' || !args[0].startsWith(MARKER)) {
      return;
    }

    const message = args.map(serializeArg).join(' ');
    buffer.push({ message, timestampMs: Date.now() });

    if (buffer.length >= MAX_BATCH_SIZE) {
      flush();
    }
  };

  const intervalId = setInterval(flush, FLUSH_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
    console.debug = originalConsoleDebug;
  };
}
