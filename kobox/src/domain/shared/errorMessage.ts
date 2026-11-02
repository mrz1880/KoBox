// What a caught value says, for a log line or a report: JavaScript lets any
// value be thrown, so one that is not an Error is spelled out as it is.
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
