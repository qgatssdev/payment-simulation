import type { Metadata } from 'next';
import PaymentDetailView from './components/paymentDetailView';

export const metadata: Metadata = { title: 'Payment' };

const PaymentPage = async ({ params }: PageProps<'/payments/[id]'>) => {
  const { id } = await params;
  return <PaymentDetailView id={id} />;
};

export default PaymentPage;
