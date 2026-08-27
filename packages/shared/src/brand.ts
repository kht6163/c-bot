export type Brand<T, B extends string> = T & { readonly __brand: B };

export function brand<B extends string>(value: string): Brand<string, B> {
  return value as Brand<string, B>;
}
