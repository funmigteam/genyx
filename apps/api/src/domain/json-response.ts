// Monetary integers must remain exact across JSON transport.
export function jsonResponse(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
}
