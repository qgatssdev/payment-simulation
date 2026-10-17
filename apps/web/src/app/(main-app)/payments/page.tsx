import type { Metadata } from 'next';
import PaymentsView from './components/paymentsView';

export const metadata: Metadata = { title: 'Payments' };

const PaymentsPage = () => {
  return <PaymentsView />;
};

export default PaymentsPage;
