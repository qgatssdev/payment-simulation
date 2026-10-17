import { niceCeil, sideScale } from './throughputChart';

describe('chart scale', () => {
  it('rounds the scale up to 1, 2 or 5 × 10ⁿ', () => {
    expect([1, 3, 7, 23, 51, 180].map(niceCeil)).toEqual([1, 5, 10, 50, 100, 200]);
  });

  it('fits the scale to the rest when one bucket towers over it, and says so', () => {
    expect(sideScale([12, 18, 9, 317])).toEqual({ max: 50, clipped: true });
    expect(sideScale([12, 18, 9, 40])).toEqual({ max: 50, clipped: false });
    expect(sideScale([0, 0])).toEqual({ max: 0, clipped: false });
  });
});
