import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreatePaymentForm } from './createPaymentForm';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const accepted = () =>
  new Response(JSON.stringify({ success: true, message: 'ok', data: { id: 'pay_1' } }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
const unavailable = () =>
  new Response(
    JSON.stringify({
      success: false,
      message: 'Storage is temporarily unavailable, please retry',
      error: { code: 'SERVICE_UNAVAILABLE' },
      requestId: 'r1',
    }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );

const keyOf = (call: unknown[]) =>
  ((call[1] as RequestInit).headers as Record<string, string>)['Idempotency-Key'];

afterEach(() => vi.unstubAllGlobals());

describe('CreatePaymentForm', () => {
  it('validates on submit with the API rules and sends nothing when invalid', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<CreatePaymentForm onCreated={vi.fn()} />);

    const number = screen.getByLabelText('Card number');
    await user.clear(number);
    await user.type(number, '4242424242424241');
    await user.click(screen.getByRole('button', { name: 'Create payment' }));

    expect(await screen.findByText('card number is invalid')).toBeInTheDocument();
    expect(number).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fills the card number from the test-card picker', async () => {
    const user = userEvent.setup();
    render(<CreatePaymentForm onCreated={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: /Declined/ }));
    expect(screen.getByLabelText('Card number')).toHaveValue('4000000000000002');
    expect(screen.getByRole('radio', { name: /Declined/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('reuses the idempotency key when retrying after a server error, then starts a new one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(accepted())
      .mockResolvedValueOnce(accepted());
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<CreatePaymentForm onCreated={onCreated} />);
    const submit = screen.getByRole('button', { name: 'Create payment' });

    await user.click(submit); // 503: may or may not have been created
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.click(submit); // retry: must be the same request
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('pay_1'));
    await user.click(submit); // a new submission after success
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const [first, retry, next] = fetchMock.mock.calls.map(keyOf);
    expect(retry).toBe(first);
    expect(next).not.toBe(first);
    expect(screen.getByText(next as string)).toBeInTheDocument();
  });
});
