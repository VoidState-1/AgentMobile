/** Copies an already validated JSON DTO; optional undefined fields are omitted.
 * Not for capabilities, typed bytes, maps, leases or opaque provider messages.
 */
export function cloneJsonDto<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Freezes the same validated DTO vocabulary; does not validate arbitrary data. */
export function freezeJsonDto<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeJsonDto);
    Object.freeze(value);
  }
  return value;
}
