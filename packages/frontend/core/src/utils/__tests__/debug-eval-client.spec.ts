import { describe, expect, test } from 'vitest';

import { debugEvalClientLabel, pollDebugEvalOnce } from '../debug-eval-client';

type Call = { url: string; init?: RequestInit };

function fakeFetch(pending: unknown) {
  const calls: Call[] = [];
  const doFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify(url.endsWith('/pending') ? pending : {})
    );
  }) as typeof fetch;
  return { calls, doFetch };
}

describe('debug eval client', () => {
  test('labels the client by platform and browser', () => {
    expect(
      debugEvalClientLabel(
        'desktop',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36'
      )
    ).toBe('desktop Chrome');
    expect(
      debugEvalClientLabel(
        'mobile',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1'
      )
    ).toBe('mobile iPhone Safari');
  });

  test('sends its id and label, runs the snippet and posts the result', async () => {
    const { calls, doFetch } = fakeFetch({ id: 'c1', code: 'return 6 * 7' });
    const delay = await pollDebugEvalOnce({
      fetch: doFetch,
      clientId: 'tab-1',
      label: 'desktop Chrome',
    });
    expect(calls[0]?.init?.headers).toEqual({
      'x-debug-eval-client': 'tab-1',
      'x-debug-eval-label': 'desktop Chrome',
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      id: 'c1',
      ok: true,
      result: '42',
    });
    expect(delay).toBe(2000);
  });

  test('polls once a minute while the server has eval disabled', async () => {
    const { calls, doFetch } = fakeFetch({ disabled: true });
    const delay = await pollDebugEvalOnce({
      fetch: doFetch,
      clientId: 'tab-1',
      label: 'desktop Chrome',
    });
    expect({ delay, calls: calls.length }).toEqual({ delay: 60_000, calls: 1 });
  });
});
