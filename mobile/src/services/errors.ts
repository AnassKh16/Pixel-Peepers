// Keep native errors, HTTP codes, and backend enum names out of user-facing copy.
export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.') {
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').trim();
  if (!message || message.length > 300 || /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b(?:Error|HTTP)(?:\s+code)?[\s:]*\d+\b|\b(?:SQLITE|NativeDatabase|Exception|EACCES|EBUSY|ENOENT)\b|\b(?:file:\/\/|[A-Z]:\\)|\n\s*at\s/i.test(message)) return fallback;
  if (/^[A-Z0-9_:-]+$/.test(message)) return fallback;
  if (/network request failed|failed to fetch/i.test(message)) return 'Cannot reach the server. Check your Wi-Fi and server address, then try again.';
  return message;
}
