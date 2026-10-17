import type { Metadata } from 'next';
import PaymentDetailView from './components/paymentDetailView';

export const metadata: Metadata = { title: 'Payment' };

const PaymentPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return <PaymentDetailView id={id} />;
};

export default PaymentPage;
