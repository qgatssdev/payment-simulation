import { captureLogger } from '../../../test/helpers';
import { requestContext } from './request-context';

describe('logger', () => {
  it('redacts card data wherever it is nested', () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        card: { number: '4242424242424242', cvc: '123', last4: '4242' },
        body: { card: { number: '4242424242424242', cvc: '999' } },
      },
      'payment received',
    );
    const [line] = lines();
    expect(line).toMatchObject({
      card: { number: '[REDACTED]', cvc: '[REDACTED]', last4: '4242' },
      body: { card: { number: '[REDACTED]', cvc: '[REDACTED]' } },
    });
    expect(JSON.stringify(line)).not.toContain('4242424242424242');
  });

  it('adds the async context to every line written inside it', async () => {
    const { logger, lines } = captureLogger();
    await requestContext.run({ requestId: 'req-1' }, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      requestContext.run({ jobId: 7 }, () => logger.info('nested'));
      logger.info('after await');
    });
    logger.info('outside');

    expect(
      lines().map(({ msg, requestId, jobId }) => ({ msg, requestId, jobId })),
    ).toEqual([
      { msg: 'nested', requestId: 'req-1', jobId: 7 },
      { msg: 'after await', requestId: 'req-1', jobId: undefined },
      { msg: 'outside', requestId: undefined, jobId: undefined },
    ]);
  });

  it('uses string level labels and ISO timestamps', () => {
    const { logger, lines } = captureLogger();
    logger.warn('careful');
    const [line] = lines();
    expect(line?.level).toBe('warn');
    expect(new Date(line?.time as string).toISOString()).toBe(line?.time);
  });
});
