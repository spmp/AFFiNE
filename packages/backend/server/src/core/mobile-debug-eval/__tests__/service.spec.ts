import test from 'ava';

import type { Config } from '../../../base';
import { MobileDebugEvalService } from '../service';

const TOKEN = 'secret';

function createService(enabled = true) {
  const config = { mobileDebugEval: { enabled, token: TOKEN } };
  return new MobileDebugEvalService(config as unknown as Config);
}

const phone = { id: 'tab-phone', label: 'mobile iPhone Safari' };
const desktop = { id: 'tab-desktop', label: 'desktop Chrome' };

test('a command without a target goes to the first client that polls', t => {
  const service = createService();
  const { id } = service.submit('1 + 1', TOKEN);
  t.deepEqual(service.consumePending(desktop), { id, code: '1 + 1' });
  t.is(service.consumePending(phone), null);
});

test('a targeted command skips clients that do not match', t => {
  const service = createService();
  const { id } = service.submit('document.title', TOKEN, 'desktop');
  t.is(service.consumePending(phone), null);
  t.deepEqual(service.consumePending(desktop), { id, code: 'document.title' });
});

test('a target can be a client id', t => {
  const service = createService();
  const { id } = service.submit('1', TOKEN, 'tab-phone');
  t.is(service.consumePending(desktop), null);
  t.deepEqual(service.consumePending(phone), { id, code: '1' });
});

test('clients that polled recently are listed, with the token only', t => {
  const service = createService();
  service.consumePending(phone);
  service.consumePending(desktop);
  t.throws(() => service.listClients(undefined));
  t.deepEqual(
    service
      .listClients(TOKEN)
      .map(client => ({ id: client.id, label: client.label }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    [desktop, phone]
  );
});

test('polling while disabled says so, so clients can slow down', t => {
  const service = createService(false);
  t.deepEqual(service.consumePending(phone), { disabled: true });
});
