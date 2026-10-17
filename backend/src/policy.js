// Single role x action x scope policy. Empty cells deny by default.
export const policy = {
  super_admin: {tenants: ['platform'], fixtures: ['any'], roster: ['any'], products: ['any'], player: ['any'], club: ['any'], config: ['platform']},
  league_organizer: {fixtures: ['own_league'], club: ['tenant']},
  club_manager: {roster: ['own_club'], products: ['own_club'], player: ['own_club'], club: ['tenant']},
  player: {player: ['self'], club: ['tenant']},
  viewer: {club: ['tenant']}
};
export function permits(user, action, target) {
  const scopes = policy[user.role]?.[action] ?? [];
  if (!target) return scopes.includes('platform');
  if (scopes.includes('any')) return true;
  if (target.tenant_id !== user.tenant_id) return false;
  return scopes.includes('tenant') ||
    (scopes.includes('own_league') && target.league_id === user.league_id) ||
    (scopes.includes('own_club') && target.club_id === user.club_id) ||
    (scopes.includes('self') && target.player_id === user.player_id);
}
// Only these constant queries are selected; identifiers are always parameters.
const queries = {
  league: 'SELECT league_id, tenant_id FROM leagues WHERE league_id=$1',
  club: 'SELECT club_id, tenant_id FROM clubs WHERE club_id=$1',
  player: 'SELECT p.player_id, p.club_id, c.tenant_id FROM players p JOIN clubs c USING (club_id) WHERE p.player_id=$1'
};
export async function findTarget(pool, kind, id) {
  return (await pool.query(queries[kind], [id])).rows[0];
}
