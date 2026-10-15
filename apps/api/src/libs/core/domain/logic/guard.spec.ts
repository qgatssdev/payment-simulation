import { Type } from 'class-transformer';
import { IsInt, IsString, Min, ValidateNested } from 'class-validator';
import { Guard } from './guard';

class Inner {
  @IsInt()
  @Min(1)
  count!: number;
}

class Outer {
  @IsString()
  name!: string;

  @ValidateNested()
  @Type(() => Inner)
  inner!: Inner;
}

describe('Guard.validate', () => {
  it('returns a class instance for valid input', async () => {
    const result = await Guard.validate(
      Outer,
      { name: 'a', inner: { count: 2 } },
      'body',
    );
    expect(result.isSuccess).toBe(true);
    expect(result.getValue()).toBeInstanceOf(Outer);
    expect(result.getValue().inner).toBeInstanceOf(Inner);
  });

  it('reports every issue with dot paths and its location', async () => {
    const result = await Guard.validate(Outer, { name: 1, inner: { count: 0 } }, 'body');
    expect(result.errorValue()).toEqual([
      { location: 'body', field: 'name', messages: ['name must be a string'] },
      {
        location: 'body',
        field: 'inner.count',
        messages: ['count must not be less than 1'],
      },
    ]);
  });

  it('rejects properties the DTO does not declare', async () => {
    const result = await Guard.validate(
      Outer,
      { name: 'a', inner: { count: 1 }, admin: true },
      'query',
    );
    expect(result.errorValue()).toEqual([
      {
        location: 'query',
        field: 'admin',
        messages: ['property admin should not exist'],
      },
    ]);
  });

  it.each([null, 'text', 5, [1, 2]])('rejects a non-object payload %p', async (input) => {
    const result = await Guard.validate(Outer, input, 'body');
    expect(result.errorValue()).toEqual([
      { location: 'body', field: '', messages: ['body must be a JSON object'] },
    ]);
  });
});
