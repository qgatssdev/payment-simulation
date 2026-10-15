import type { PaymentView } from '@payment-sim/shared';
import { PaymentStatus } from '@payment-sim/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentActions } from './payment-actions';

const payment = (status: PaymentStatus): PaymentView =>
  ({ id: 'p1', status, version: 2 }) as PaymentView;

function renderActions(status: PaymentStatus) {
  const client = new QueryClient();
  client.setQueryData(['payments', 'detail', 'p1'], payment(status));
  return render(
    <QueryClientProvider client={client}>
      <PaymentActions payment={payment(status)} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('PaymentActions', () => {
  it('offers cancel for a pending payment and explains why refund is unavailable', () => {
    renderActions(PaymentStatus.PENDING);
    expect(screen.getByRole('button', { name: 'Cancel payment' })).toBeEnabled();
    const refund = screen.getByRole('button', { name: 'Refund payment' });
    expect(refund).toBeDisabled();
    expect(refund).toHaveAccessibleDescription(
      'Only succeeded payments can be refunded.',
    );
  });

  it('offers nothing for a failed payment', () => {
    renderActions(PaymentStatus.FAILED);
    for (const name of ['Cancel payment', 'Refund payment']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.queryByLabelText('Reason (optional)')).not.toBeInTheDocument();
  });

  it('sends the refund with the reason and the version it was shown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          message: 'ok',
          data: { ...payment(PaymentStatus.REFUNDED), version: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderActions(PaymentStatus.SUCCEEDED);

    await user.type(screen.getByLabelText('Reason (optional)'), 'Item returned');
    await user.click(screen.getByRole('button', { name: 'Refund payment' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/payments\/p1\/status$/);
    expect(JSON.parse(init.body as string)).toEqual({
      status: 'REFUNDED',
      reason: 'Item returned',
    });
    expect(init.headers).toMatchObject({ 'If-Match': '"2"' });
  });
});
