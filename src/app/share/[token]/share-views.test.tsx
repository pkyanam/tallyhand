// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InvoiceShareView } from './share-views';
const invoice = { id: 'i', invoiceNumber: 'EUR-1', status: 'sent', total: 12, currency: 'EUR', dueDate: 1, lineItems: [{ description: 'Work', quantity: 1, rate: 12, amount: 12 }], client: null };
const empty = { receipts: [], attempts: [], refunds: [] };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { window.history.replaceState({}, '', '/share/token'); fetchMock = vi.fn().mockResolvedValue(Response.json(empty)); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function view() { render(<InvoiceShareView token="token" invoice={invoice as never} paymentsConfigured />); }
it('uses invoice currency for total and line prices', async () => { view(); await screen.findByText('No online payment receipt is recorded.'); expect(screen.getByRole('heading').textContent).toContain('€12.00'); expect(screen.getAllByText('€12.00')).toHaveLength(4); });
it('does not turn a checkout return query into a payment receipt', async () => { window.history.replaceState({}, '', '/share/token?paid=1'); view(); await screen.findByText('No online payment receipt is recorded.'); expect(screen.queryByLabelText('Payment receipts')).toBeNull(); });
it('shows pending checkout without redirecting even when a URL accompanies HTTP 202', async () => { fetchMock.mockImplementation((url: string) => Promise.resolve(Response.json(url.endsWith('/pay') ? { checkoutUrl: 'https://checkout.stripe.com/unsafe' } : empty, { status: url.endsWith('/pay') ? 202 : 200 }))); view(); const before = window.location.href; fireEvent.click(screen.getByRole('button', { name: 'Pay this invoice' })); await screen.findByText(/awaiting confirmation/); expect(window.location.href).toBe(before); expect(screen.queryByLabelText('Payment receipts')).toBeNull(); });
it('separates confirmed net collection from pending and failed refunds and bank settlement', async () => { fetchMock.mockResolvedValue(Response.json({ receipts: [{ id: 'p', money: { currency: 'EUR', minorUnits: 1200 }, confirmedRefundMinorUnits: 200, netMinorUnits: 1000 }], attempts: [], refunds: [{ id: 'r1', money: { currency: 'EUR', minorUnits: 300 }, state: 'pending' }, { id: 'r2', money: { currency: 'EUR', minorUnits: 400 }, state: 'failed' }] })); view(); const receipts = await screen.findByLabelText('Payment receipts'); expect(receipts.textContent).toContain('Net collected: €10.00'); expect(receipts.textContent).toContain('Refund pending: €3.00'); expect(receipts.textContent).toContain('Refund failed: €4.00'); expect(receipts.textContent).toContain("do not confirm funds have reached the sender's bank"); });

it('reports an unresolved provider attempt as pending instead of collected', async () => { fetchMock.mockResolvedValue(Response.json({ ...empty, attempts: [{ id: 'a', state: 'unknown' }] })); view(); await screen.findByText('Payment confirmation is pending. Returning from checkout does not confirm payment.'); expect(screen.queryByLabelText('Payment receipts')).toBeNull(); });

it('retains operation identity for transport retries and replaces it after a terminal expired attempt', async () => {
  const keys: string[] = [];
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    if (!url.endsWith('/pay')) return Response.json(empty);
    keys.push(new Headers(init.headers).get('Idempotency-Key')!);
    if (keys.length === 1) throw new Error('network interrupted');
    return Response.json({ error: 'Payment attempt is terminal; use a new operation identity' }, { status: 409 });
  });
  view();
  fireEvent.click(screen.getByRole('button', { name: 'Pay this invoice' }));
  await screen.findByText('network interrupted');
  fireEvent.click(screen.getByRole('button', { name: 'Pay this invoice' }));
  await screen.findByText('Payment attempt is terminal; use a new operation identity');
  fireEvent.click(screen.getByRole('button', { name: 'Pay this invoice' }));
  await vi.waitFor(() => expect(keys).toHaveLength(3));
  expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});
