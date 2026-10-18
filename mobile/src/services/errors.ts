// Keep native errors, HTTP codes, and backend enum names out of user-facing copy.
export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.') {
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').trim();
  if (!message || message.length > 300 || /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|\b(?:Error|HTTP)(?:\s+code)?[\s:]*\d+\b|\b(?:SQLITE|NativeDatabase|Exception|EACCES|EBUSY|ENOENT)\b|\b(?:file:\/\/|[A-Z]:\\)|\n\s*at\s/i.test(message)) return fallback;
  if (/^[A-Z0-9_:-]+$/.test(message)) return fallback;
  if (/network request failed|failed to fetch/i.test(message)) return 'Cannot reach the server. Check your Wi-Fi and server address, then try again.';
  return message;
}

export function isAuthExpired(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && (error as { status?: number }).status === 401) return true;
  if (typeof error === 'object' && (error as { code?: string }).code === 'UNAUTHENTICATED') return true;
  const message = (error instanceof Error ? error.message : typeof error === 'string' ? error : '').toLowerCase();
  return message.includes('sign-in has expired') || message.includes('sign-in expired') || message.includes('unauthenticated') || message.includes('please sign in');
}
