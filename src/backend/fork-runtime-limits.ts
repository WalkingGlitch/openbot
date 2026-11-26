const warned = new Set<string>();

function warnLimit(name: string, text: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[openbot-fork] ${name} is not valid; OpenBot keeps its default.`, text.slice(0, 64));
}

/** Absent or invalid is `undefined`. `0` is `null` (the silence watchdog is off). A positive whole number is milliseconds. */
export function acpTurnStallSetting(): number | null | undefined {
  const raw = process.env.OPENBOT_ACP_TURN_STALL_MS;
  if (raw === undefined || raw.trim() === "") return undefined;
  const text = raw.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(text) || !Number.isSafeInteger(Number(text))) {
    warnLimit("OPENBOT_ACP_TURN_STALL_MS", text);
    return undefined;
  }
  const value = Number(text);
  return value === 0 ? null : value;
}

/** An explicit `turnStallMs` wins. `0` is off. A bad number keeps the upstream limit. */
export function resolveAcpModelSilenceMs(configured: number | undefined): number | null | undefined {
  if (typeof configured === "number") {
    if (configured === 0) return null;
    if (Number.isSafeInteger(configured) && configured > 0) return configured;
    warnLimit("turnStallMs", String(configured));
    return undefined;
  }
  return acpTurnStallSetting();
}

const DAY_MS = 24 * 60 * 60_000;
const UPSTREAM_ENDPOINT_SILENCE_MS = 30 * 60_000;

/** OpenCode request timeouts. `0` is 24 hours. A positive setting is that many milliseconds. */
export function customEndpointRequestTimeoutMs(upstream = UPSTREAM_ENDPOINT_SILENCE_MS): number {
  const value = acpTurnStallSetting();
  if (value === null) return DAY_MS;
  return typeof value === "number" ? value : upstream;
}

/**
 * The custom-endpoint stall value that background flavors still read.
 * `0` leaves `upstream` in place, so those flavors do not inherit the 24 hour request timeout.
 */
export function customEndpointStallMs(upstream = UPSTREAM_ENDPOINT_SILENCE_MS): number {
  const value = acpTurnStallSetting();
  return typeof value === "number" ? value : upstream;
}

/** Share of the context window. Absent is 0.9. `90` means 0.9. Allowed range is 0.55 to 0.98. */
export function contextCompactionThreshold(): number {
  const raw = process.env.OPENBOT_CONTEXT_COMPACTION_THRESHOLD;
  if (raw === undefined || raw.trim() === "") return 0.9;
  const text = raw.trim();
  let value = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
  if (value > 1) value /= 100;
  if (!(value >= 0.55 && value <= 0.98)) {
    warnLimit("OPENBOT_CONTEXT_COMPACTION_THRESHOLD", text);
    return 0.9;
  }
  return value;
}

export function ineffectiveCompactionShare(): number {
  return contextCompactionThreshold() - 0.1;
}
