import type { PaymentView } from '@payment-sim/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { statsKey } from '../stats/queries';
import { updatePaymentStatus } from '.';
import { paymentEventsKey, paymentKey, rememberPayment } from './queries';
import type { UpdateStatusPayload } from './types';

type OnSuccess = (payment: PaymentView) => void;
type OnError = (error: Error, payload: UpdateStatusPayload) => void;

/**
 * Cancel or refund, conditional on the version shown. The UI updates at once and rolls back
 * if the API refuses (illegal transition, someone else changed it first, network).
 */
export const useUpdateStatus = (
  payment: PaymentView,
  onSuccess: OnSuccess,
  onError: OnError,
) => {
  const queryClient = useQueryClient();
  const key = paymentKey(payment.id);
  return useMutation({
    mutationFn: (payload: UpdateStatusPayload) =>
      updatePaymentStatus(payment.id, payload, payment.version),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PaymentView>(key);
      queryClient.setQueryData<PaymentView>(key, (current) =>
        current ? { ...current, status: payload.status } : current,
      );
      return { previous };
    },
    onError: (error, payload, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      void queryClient.invalidateQueries({ queryKey: key });
      onError(error, payload);
    },
    onSuccess: (updated) => {
      rememberPayment(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: paymentEventsKey(payment.id) });
      void queryClient.invalidateQueries({ queryKey: statsKey });
      onSuccess(updated);
    },
  });
};
