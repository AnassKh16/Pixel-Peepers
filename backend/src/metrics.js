export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4';

const definitions = [
  ['nascon_active_ws_connections', 'gauge', 'Currently connected WebSocket and SSE subscribers.', 'activeWsConnections'],
  ['nascon_active_streams_total', 'gauge', 'Currently active solo and co-stream sessions.', 'activeStreams'],
  ['nascon_stream_bitrate_kbps', 'gauge', 'Current aggregate stream bitrate in kilobits per second.', 'streamBitrateKbps'],
  ['nascon_dlq_depth', 'gauge', 'Failed notifications waiting in the persistent dead-letter queue.', 'dlqDepth'],
  ['nascon_qr_scans_total', 'counter', 'Total privacy-safe QR scans since the last reset.', 'qrScans'],
];

/** Getters may be sync or async and may use the exact metric name or the short alias. */
export async function renderMetrics(getters) {
  const blocks = await Promise.all(definitions.map(async ([name, type, help, alias]) => {
    const getter = getters[name] ?? getters[alias];
    if (typeof getter !== 'function') throw new TypeError('Missing metric getter: ' + name);
    const value = Number(await getter());
    if (!Number.isFinite(value) || value < 0) throw new TypeError('Invalid metric value: ' + name);
    return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
  }));
  return blocks.join('\n');
}
