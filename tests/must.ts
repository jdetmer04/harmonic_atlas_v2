// Unwrap a value the test knows is there, failing loudly if it isn't.
export function must<T>(x: T | null | undefined, what = 'value'): T {
  if (x === null || x === undefined) throw new Error(`expected a ${what}`);
  return x;
}
