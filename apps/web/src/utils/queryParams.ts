/**
 * "?status=FAILED&limit=10" from an object, skipping undefined and empty values.
 */
export const buildQueryParams = (
  params: Record<string, string | number | undefined>,
): string => {
  const validParams = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== '',
  );

  if (validParams.length === 0) return '';

  const queryString = validParams
    .map(
      ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join('&');

  return `?${queryString}`;
};
