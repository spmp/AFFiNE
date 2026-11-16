import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { ActionForbidden, Config } from '../../base';
import type { EvalClient, EvalResult, PendingCommand } from './types';

const MAX_CODE_LENGTH = 20_000;
const MAX_RESULT_LENGTH = 20_000;
// Ephemeral, in-memory, single-process, single-outstanding-command store.
// This is a throwaway debug tool (see module doc comment) -- no DB, no
// multi-instance fanout, no history beyond the last few results.
const MAX_RESULTS_RETAINED = 20;
// Clients poll every 2s while eval is on; one not seen for this long has
// gone (tab closed, phone asleep).
const CLIENT_TTL_MS = 60_000;
const MAX_LABEL_LENGTH = 200;

@Injectable()
export class MobileDebugEvalService {
  private readonly logger = new Logger('MobileDebugEval');
  private pending: PendingCommand | null = null;
  private readonly results = new Map<string, EvalResult>();
  private readonly clients = new Map<string, EvalClient>();

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

  submit(
    code: string,
    token: string | undefined,
    target?: string
  ): { id: string } {
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
      target: target?.trim() || undefined,
      createdAt: Date.now(),
      consumedAt: null,
    };
    this.logger.log(
      `submitted id=${id} len=${trimmed.length} target=${this.pending.target ?? '*'}`
    );
    return { id };
  }

  // Called by the PWA client's poll loop -- every 2s, from every open tab,
  // regardless of whether this feature is enabled (there is no client-side
  // gate, by design: see mobile-debug-eval.ts's doc comment). That makes
  // this by far the highest-frequency call into this service, so unlike
  // the other methods it must NOT throw when disabled: `assertEnabled()`'s
  // ActionForbidden is a UserFriendlyError, and every UserFriendlyError
  // gets logged at full stack-trace length by the global exception filter
  // (base/nestjs/exception.ts's `error.log('HTTP', ...)`) -- on a 2s poll
  // from multiple clients, that's a permanent, significant log-spam source
  // for a condition that isn't exceptional, it's the expected steady state
  // of this disabled-by-default tool. Return the same "nothing pending"
  // shape a real poll would see when there's just no command queued,
  // instead of a distinguishable error. `{ disabled: true }` lets the client
  // slow its polling down.
  //
  // `client` identifies the polling page (its tab id and a label such as
  // "desktop Chrome"), so a command can be aimed at one of several open
  // clients, and `listClients` can show which are there.
  consumePending(client?: {
    id?: string;
    label?: string;
  }): { id: string; code: string } | { disabled: true } | null {
    if (!this.config.mobileDebugEval.enabled) {
      return { disabled: true };
    }

    const clientId = client?.id?.slice(0, MAX_LABEL_LENGTH);
    const label = client?.label?.slice(0, MAX_LABEL_LENGTH) ?? '';
    if (clientId) {
      this.clients.set(clientId, { id: clientId, label, lastSeen: Date.now() });
    }

    const current = this.pending;
    if (!current || current.consumedAt !== null) {
      return null;
    }
    if (
      current.target &&
      current.target !== clientId &&
      !label.toLowerCase().includes(current.target.toLowerCase())
    ) {
      return null;
    }
    current.consumedAt = Date.now();
    return { id: current.id, code: current.code };
  }

  /** Clients that polled in the last minute, most recent first. */
  listClients(token: string | undefined): EvalClient[] {
    this.assertEnabled();
    this.assertToken(token);
    const cutoff = Date.now() - CLIENT_TTL_MS;
    for (const [id, client] of this.clients) {
      if (client.lastSeen < cutoff) this.clients.delete(id);
    }
    return [...this.clients.values()].sort((a, b) => b.lastSeen - a.lastSeen);
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
