import { Table } from 'typeorm';
import { SnakeNamingStrategy, snakeCase } from './snake-naming.strategy';
import { bigintTransformer } from './transformers';

describe('SnakeNamingStrategy', () => {
  const naming = new SnakeNamingStrategy();

  it.each([
    ['createdAt', 'created_at'],
    ['last4', 'last4'],
    ['expMonth', 'exp_month'],
    ['paymentId', 'payment_id'],
    ['id', 'id'],
  ])('snakeCase(%s) = %s', (input, expected) => expect(snakeCase(input)).toBe(expected));

  it('prefixes embedded columns', () => {
    expect(naming.columnName('expMonth', undefined, ['card'])).toBe('card_exp_month');
    expect(naming.columnName('ignored', 'customName', [])).toBe('custom_name');
  });

  it('keeps explicit table names and snake-cases class names', () => {
    expect(naming.tableName('PaymentEvent', 'payment_events')).toBe('payment_events');
    expect(naming.tableName('PaymentEvent', undefined)).toBe('payment_event');
  });

  it('produces readable constraint names from a table name or a Table', () => {
    const jobs = new Table({ name: 'public.jobs' });
    expect(naming.primaryKeyName('payments')).toBe('pk_payments');
    expect(naming.foreignKeyName(jobs, ['payment_id'])).toBe('fk_jobs_payment_id');
    expect(naming.indexName('payments', ['created_at', 'id'])).toBe(
      'idx_payments_created_at_id',
    );
    expect(naming.uniqueConstraintName('payment_events', ['sequence'])).toBe(
      'uq_payment_events_sequence',
    );
    expect(naming.joinColumnName('payment', 'id')).toBe('payment_id');
    expect(naming.relationName('paymentMethod')).toBe('payment_method');
  });
});

describe('bigintTransformer', () => {
  const from = (value: string | null) => bigintTransformer.from(value) as number | null;

  it('parses safe integers and passes nulls through', () => {
    expect(from('9999999999')).toBe(9_999_999_999);
    expect(from(null)).toBeNull();
    expect(bigintTransformer.to(42)).toBe(42);
  });

  it('refuses values that would lose precision', () => {
    expect(() => from('9007199254740993')).toThrow(RangeError);
  });
});
