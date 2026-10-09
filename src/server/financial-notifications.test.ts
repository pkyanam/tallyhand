import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { SqliteFinancialStore } from '@/lib/financial/sqlite-store';
import { snapshotInvoice } from '@/core/financial/snapshot';
import { pluginRegistry } from '@/plugins/registry';
import { drainFinancialNotifications } from './financial-notifications';
const mocks = vi.hoisted(() => ({ getInvoice: vi.fn() }));
vi.mock('./provider', () => ({ getServerProviderForUser: () => ({ getInvoice: mocks.getInvoice }) }));
const scope = { userId: 'local', workspaceId: 'local', provider: 'stripe' as const, accountId: 'acct', mode: 'test' as const };
let store: SqliteFinancialStore;
const invoice = { id: 'invoice', status: 'sent', total: 12, currency: 'EUR', updatedAt: 1, notes: 'Paid revision' };
beforeEach(() => { store = new SqliteFinancialStore(':memory:'); vi.spyOn(Date, 'now').mockReturnValue(1000); });
afterEach(() => { store.close(); pluginRegistry.unregister('financial-test'); vi.restoreAllMocks(); });
async function confirm(changed = false) {
  const db = (store as unknown as { db: DatabaseSync }).db;
  db.exec('CREATE TABLE invoices(id TEXT,status TEXT,updated_at INTEGER,data TEXT)');
  db.prepare('INSERT INTO invoices VALUES(?,?,?,?)').run(invoice.id, 'sent', 1, JSON.stringify(invoice));
  const { attempt } = await store.prepareAttempt({ scope, invoice: snapshotInvoice(invoice as never), operationId: 'op', requestFingerprint: 'request', actor: { kind: 'owner', id: 'local' }, now: 1 });
  if (changed) db.prepare('UPDATE invoices SET data=?').run(JSON.stringify({ ...invoice, total: 99, notes: 'Edited revision' }));
  const { event } = await store.receiveProviderEvent({ scope, providerEventId: 'event', type: 'paid', payload: '{}', receivedAt: 2 });
  await store.applyPaymentOutcome({ scope, attemptId: attempt.id, providerPaymentId: 'pi', money: attempt.invoice.money, confirmedAt: 3, source: { kind: 'event', eventId: event.id } });
}
it('retries a failed plugin through the actual durable outbox with the same event identity', async () => {
  const received = vi.fn().mockRejectedValueOnce(new Error('consumer unavailable')).mockResolvedValue(undefined);
  pluginRegistry.register({ manifest: { name: 'financial-test', version: '1', description: 'test' }, activate: ctx => { ctx.hooks.on('onPaymentReceived', received); } });
  await confirm(); mocks.getInvoice.mockResolvedValue({ ...invoice, status: 'paid' });
  await drainFinancialNotifications(store, scope); expect(received).toHaveBeenCalledTimes(1);
  await drainFinancialNotifications(store, scope); expect(received).toHaveBeenCalledTimes(1);
  vi.mocked(Date.now).mockReturnValue(32000); await drainFinancialNotifications(store, scope);
  expect(received).toHaveBeenCalledTimes(2); expect(received.mock.calls[0][0].eventId).toBe(received.mock.calls[1][0].eventId);
  await drainFinancialNotifications(store, scope); expect(received).toHaveBeenCalledTimes(2);
});
it('delivers the frozen receipt without falsely announcing the edited invoice as paid', async () => {
  const received = vi.fn(); const paid = vi.fn();
  pluginRegistry.register({ manifest: { name: 'financial-test', version: '1', description: 'test' }, activate: ctx => { ctx.hooks.on('onPaymentReceived', received); ctx.hooks.on('onInvoicePaid', paid); } });
  await confirm(true); mocks.getInvoice.mockResolvedValue({ ...invoice, total: 99, notes: 'Edited revision', status: 'paid' });
  await drainFinancialNotifications(store, scope);
  expect(paid).not.toHaveBeenCalled(); expect(received).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 1200, currency: 'EUR', invoice: expect.objectContaining({ total: 12, notes: 'Paid revision' }) }));
});
