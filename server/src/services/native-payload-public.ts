/** Call only for a known native payload row at its public response boundary.
 * Keep arbitrary nested user metadata intact; never walk or infer entities. */
export function publicNativePayloadRow<T extends object>(row: T): Omit<T, "payloadSourceProtocolVersion" | "payloadSourceSnapshot"> {
  const { payloadSourceProtocolVersion: _protocol, payloadSourceSnapshot: _snapshot, ...publicRow } = row as T & {
    payloadSourceProtocolVersion?: unknown; payloadSourceSnapshot?: unknown;
  };
  return publicRow;
}
