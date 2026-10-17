import { CreatePaymentForm } from '@/common/createPaymentForm';
import PageHeader from '@/components/layout/pageHeader';

export default function NewPaymentView() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="New payment"
        description="Validated here with the same rules the API enforces, then accepted for processing in the background."
      />
      <CreatePaymentForm />
    </div>
  );
}
