/**
 * Success-or-failure value for domain operations whose failure is an expected outcome
 * (e.g. an illegal state transition), not an exceptional one. Ported from the nest-template's
 * Result, with a typed error channel and without logging from inside a value object.
 */
export class Result<T, E = string> {
  private constructor(
    readonly isSuccess: boolean,
    private readonly value: T | undefined,
    private readonly failure: E | undefined,
  ) {
    Object.freeze(this);
  }

  get isFailure(): boolean {
    return !this.isSuccess;
  }

  static ok<T, E = never>(value: T): Result<T, E>;
  static ok<E = never>(): Result<void, E>;
  static ok<T, E>(value?: T): Result<T | undefined, E> {
    return new Result<T | undefined, E>(true, value, undefined);
  }

  static fail<T = never, E = string>(error: E): Result<T, E> {
    return new Result<T, E>(false, undefined, error);
  }

  getValue(): T {
    if (!this.isSuccess) {
      throw new Error(
        'Cannot read the value of a failed Result; read errorValue() instead',
      );
    }
    return this.value as T;
  }

  errorValue(): E {
    if (this.isSuccess) {
      throw new Error('Cannot read the error of a successful Result');
    }
    return this.failure as E;
  }

  /** The first failure, or ok() when every result succeeded. */
  static combine<E>(results: ReadonlyArray<Result<unknown, E>>): Result<void, E> {
    const failed = results.find((r) => r.isFailure);
    return failed ? Result.fail(failed.errorValue()) : Result.ok();
  }
}
