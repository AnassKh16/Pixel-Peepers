// Day 2 defaults are ordinary records; scoring still uses the sport configuration.
export async function seedDay2(client, sign) {
  await client.query('INSERT INTO players(player_id,club_id) VALUES ($1,$2)', ['player-beta-2', 'club-beta-1']);
  await client.query('INSERT INTO matches(match_id,data) VALUES ($1,$2)', ['match-m1', {sport_id: 'football', league_id: 'league-alpha-1', home_team_id: 'club-alpha-1', away_team_id: 'club-alpha-2'}]);
  for (const [index, [type, payload]] of [['match_start', {}], ['score', {team_id: 'club-alpha-1', event_type: 'goal'}]].entries()) {
    const event_id = `day2-match-m1-${index + 1}`, sequence = index + 1;
    const request = {event_id, match_id: 'match-m1', type, payload};
    const response = {...request, sequence, match_version: sequence, signature: sign(event_id, payload)};
    delete response.payload;
    await client.query('INSERT INTO events(event_id,match_id,sequence,data) VALUES ($1,$2,$3,$4)', [event_id, 'match-m1', sequence, {request, response}]);
  }
  for (const [entity_id, entity_type, short_code] of [['match-m1', 'match', 'm1-live'], ['player-alpha-1', 'player', 'p-alpha-1'], ['club-alpha-1', 'club', 'c-alpha-1']])
    await client.query('INSERT INTO qr_mappings(entity_id,data) VALUES ($1,$2)', [entity_id, {entity_id, entity_type, short_code, short_url: `http://localhost:8080/q/${short_code}`, scan_count: 0}]);
  await client.query('INSERT INTO guest_tokens(guest_token,data) VALUES ($1,$2)', ['guest_anon_tok_7721', {role: 'guest', read_only: true, valid: true, merged: false, registered_user_id: null}]);
  await client.query('INSERT INTO user_carts(user_id,data) VALUES ($1,$2)', ['player-alpha-1', {items: []}]);
}
