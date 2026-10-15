import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../../libs/core/base/base.repository';
import { Payment } from '../entity/payment.entity';

export class PaymentRepository extends BaseRepository<Payment> {
  constructor(manager: EntityManager) {
    super(manager.getRepository(Payment));
  }
}
