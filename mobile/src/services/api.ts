export type Role = 'Super Admin' | 'League Organizer' | 'Club Manager' | 'Player' | 'Viewer';
export type Session = { token: string; email: string; role: Role };
const roles: Record<string, Role> = {
  admin: 'Super Admin', organizer: 'League Organizer', manager: 'Club Manager',
  player: 'Player', viewer: 'Viewer',
};

// Mock implementation. Replace the implementation here when the REST contract is ready.
export async function signIn(email: string, password: string): Promise<Session> {
  await new Promise(resolve => setTimeout(resolve, 500));
  const normalized = email.trim().toLowerCase();
  const role = roles[normalized.split('@')[0]];
  if (!role || normalized !== `${normalized.split('@')[0]}@nascon.test` || password !== 'Nascon@26') {
    throw new Error('The email or password is incorrect. Please try again.');
  }
  return { token: `mock-session-${role}`, email: normalized, role };
}
