import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { ActionForbidden, Config } from '../../base';
import type { EvalResult, PendingCommand } from './types';

const MAX_CODE_LENGTH = 20_000;
const MAX_RESULT_LENGTH = 20_000;
// Ephemeral, in-memory, single-process, single-outstanding-command store.
// This is a throwaway debug tool (see module doc comment) -- no DB, no
// multi-instance fanout, no history beyond the last few results.
const MAX_RESULTS_RETAINED = 20;

@Injectable()
export class MobileDebugEvalService {
  private readonly logger = new Logger('MobileDebugEval');
  private pending: PendingCommand | null = null;
  private readonly results = new Map<string, EvalResult>();

  constructor(private readonly config: Config) {}

  private assertEnabled() {
    // Read fresh on every call (never cached) so a live admin config update
    // takes effect without a server restart -- same convention as
    // MobileDebugLogService.
    if (!this.config.mobileDebugEval.enabled) {
      throw new ActionForbidden('Mobile debug eval is disabled');
    }
  }

  private assertToken(token: string | undefined) {
    const expected = this.config.mobileDebugEval.token;
    if (!expected || token !== expected) {
      throw new ActionForbidden('Invalid or missing debug-eval token');
    }
  }

  submit(code: string, token: string | undefined): { id: string } {
    this.assertEnabled();
    this.assertToken(token);

    if (typeof code !== 'string' || !code.trim()) {
      throw new ActionForbidden('code must be a non-empty string');
    }
    const trimmed = code.slice(0, MAX_CODE_LENGTH);

    const id = randomUUID();
    this.pending = {
      id,
      code: trimmed,
      createdAt: Date.now(),
      consumedAt: null,
    };
    this.logger.log(`submitted id=${id} len=${trimmed.length}`);
    return { id };
  }

  // Called by the PWA client's poll loop. Hands the pending command out
  // exactly once (marks it consumed immediately), so a command is never
  // re-executed by a later poll tick.
  consumePending(): { id: string; code: string } | null {
    this.assertEnabled();

    const current = this.pending;
    if (!current || current.consumedAt !== null) {
      return null;
    }
    current.consumedAt = Date.now();
    return { id: current.id, code: current.code };
  }

  reportResult(
    id: string,
    ok: boolean,
    result: string | undefined,
    error: string | undefined
  ): { ok: true } {
    this.assertEnabled();

    if (typeof id !== 'string' || !id) {
      throw new ActionForbidden('id is required');
    }

    if (this.results.size >= MAX_RESULTS_RETAINED) {
      const oldestKey = this.results.keys().next().value;
      if (oldestKey !== undefined) this.results.delete(oldestKey);
    }

    this.results.set(id, {
      id,
      ok,
      result: result?.slice(0, MAX_RESULT_LENGTH),
      error: error?.slice(0, MAX_RESULT_LENGTH),
      receivedAt: Date.now(),
    });
    this.logger.log(`result id=${id} ok=${ok}`);
    return { ok: true };
  }

  getResult(
    id: string,
    token: string | undefined
  ): EvalResult | { pending: true } {
    this.assertEnabled();
    this.assertToken(token);

    const found = this.results.get(id);
    return found ?? { pending: true };
  }
}
