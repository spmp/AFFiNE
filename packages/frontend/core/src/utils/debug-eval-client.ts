/**
 * Debug-only remote-eval client: polls the server for a pending JS snippet,
 * runs it in this live page and posts the result back. Used by the mobile
 * app and the desktop web app.
 *
 * Paired with `packages/backend/server/src/core/mobile-debug-eval`, which is
 * disabled by default (`AFFINE_MOBILE_DEBUG_EVAL_ENABLED`); that is the kill
 * switch. While it is disabled the server says so and this client polls
 * only once a minute, so a page left open notices when it is turned on.
 *
 * Each page sends a per-tab id and a label ("desktop Chrome", "mobile
 * iPhone Safari"), so a command can be aimed at one client when several
 * are open (`scripts/mobile-debug-eval.sh -t desktop ...`).
 */

const PENDING_ENDPOINT = '/api/mobile-debug-eval/pending';
const RESULT_ENDPOINT = '/api/mobile-debug-eval/result';
const POLL_INTERVAL_MS = 2000;
const DISABLED_POLL_INTERVAL_MS = 60_000;
const CLIENT_ID_KEY = 'affine-debug-eval-client-id';

type PendingResponse = { id: string; code: string } | { disabled: true };

function serializeResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// Runs `code` as the body of an async function, so plain expressions
// ("document.title"), multi-statement snippets, and `await`-ing a promise
// all work the same way without the caller needing to know which shape
// their snippet is.
async function runSnippet(code: string): Promise<unknown> {
  const fn = new Function(`return (async () => { ${code} })()`);
  return fn();
}

function browserName(userAgent: string) {
  if (/Edg\//.test(userAgent)) return 'Edge';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Chrome\//.test(userAgent)) return 'Chrome';
  if (/iPhone|iPad/.test(userAgent)) {
    return /iPad/.test(userAgent) ? 'iPad Safari' : 'iPhone Safari';
  }
  if (/Safari\//.test(userAgent)) return 'Safari';
  return 'browser';
}

/** "desktop Chrome", "mobile iPhone Safari", ... */
export function debugEvalClientLabel(
  platform: 'mobile' | 'desktop',
  userAgent = navigator.userAgent
) {
  return `${platform} ${browserName(userAgent)}`;
}

function tabClientId() {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export interface DebugEvalPollOptions {
  platform: 'mobile' | 'desktop';
  /** For tests. */
  fetch?: typeof fetch;
  clientId?: string;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/**
 * One poll: runs a pending snippet, if there is one, and posts its result.
 * Returns how long to wait before the next poll.
 */
export async function pollDebugEvalOnce(
  options: Required<Pick<DebugEvalPollOptions, 'fetch' | 'clientId'>> & {
    label: string;
  }
): Promise<number> {
  const { fetch: doFetch, clientId, label } = options;
  const pendingRes = await doFetch(PENDING_ENDPOINT, {
    credentials: 'same-origin',
    headers: {
      'x-debug-eval-client': clientId,
      'x-debug-eval-label': label,
    },
  }).catch(() => null);
  if (!pendingRes || !pendingRes.ok) return POLL_INTERVAL_MS;

  const pending = (await pendingRes
    .json()
    .catch(() => null)) as PendingResponse | null;
  if (pending && 'disabled' in pending) return DISABLED_POLL_INTERVAL_MS;
  if (!pending || !pending.id || !pending.code) return POLL_INTERVAL_MS;

  let ok = true;
  let result: string | undefined;
  let error: string | undefined;
  try {
    result = serializeResult(await runSnippet(pending.code));
  } catch (err) {
    ok = false;
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  await doFetch(RESULT_ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: pending.id, ok, result, error }),
  }).catch(() => {
    // Best-effort: if this fails, the submitter's result poll just times
    // out and they resubmit. Never allowed to throw into the app.
  });
  return POLL_INTERVAL_MS;
}

/** Starts polling; returns a function that stops it. */
export function installDebugEvalPoll(options: DebugEvalPollOptions) {
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const schedule = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel =
    options.clearTimeout ??
    (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const clientId = options.clientId ?? tabClientId();
  const label = debugEvalClientLabel(options.platform);
  let stopped = false;
  let handle: unknown;

  const tick = () => {
    pollDebugEvalOnce({ fetch: doFetch, clientId, label })
      .catch(() => POLL_INTERVAL_MS)
      .then(delay => {
        if (!stopped) handle = schedule(tick, delay);
      })
      .catch(() => {});
  };
  handle = schedule(tick, POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    cancel(handle);
  };
}
