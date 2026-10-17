import type { Metadata } from 'next';
import NewPaymentView from './components/newPaymentView';

export const metadata: Metadata = { title: 'New payment' };

const NewPaymentPage = () => {
  return <NewPaymentView />;
};

export default NewPaymentPage;
