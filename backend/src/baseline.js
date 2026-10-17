export const tieBreakOrder = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];
export const sports = [
  { sport_id: 'football', name: 'Football', scoring_model: 'event', periods: {count: 2, duration_minutes: 45}, scoring_events: {goal: {points: 1}}, draw_allowed: true, overtime: {policy: 'none'}, roster: {min_squad_size: 11, max_squad_size: 25, required_positions: {gk: 1}} },
  { sport_id: 'basketball', name: 'Basketball', scoring_model: 'event', periods: {count: 4, duration_minutes: 12}, scoring_events: {free_throw: {points: 1}, two_pointer: {points: 2}, three_pointer: {points: 3}}, draw_allowed: false, overtime: {policy: 'extra_time', duration_minutes: 5}, roster: {min_squad_size: 5, max_squad_size: 15, required_positions: {}} },
  { sport_id: 'cricket', name: 'Cricket', scoring_model: 'innings', periods: {innings_per_team: 1, overs_per_innings: 20, balls_per_over: 6, wickets_per_innings: 10}, scoring_events: {dot_ball: {runs: 0, legal_ball: true, wicket: false}, single: {runs: 1, legal_ball: true, wicket: false}, two: {runs: 2, legal_ball: true, wicket: false}, four: {runs: 4, legal_ball: true, wicket: false}, six: {runs: 6, legal_ball: true, wicket: false}, wide: {runs: 1, legal_ball: false, wicket: false}, no_ball: {runs: 1, legal_ball: false, wicket: false}, wicket: {runs: 0, legal_ball: true, wicket: true}}, draw_allowed: true, overtime: {policy: 'super_over'}, roster: {min_squad_size: 11, max_squad_size: 18, required_positions: {wicketkeeper: 1}} },
  { sport_id: 'esports', name: 'Esports', scoring_model: 'round', periods: {best_of: 3}, scoring_events: {round_win: {rounds: 1}}, draw_allowed: false, overtime: {policy: 'none'}, roster: {min_squad_size: 5, max_squad_size: 8, required_positions: {}} }
].map(config => ({...config, tie_break_order: tieBreakOrder}));
export const defaultStock = {'var-jersey-001-M': 1, 'var-jersey-001-L': 5};
export function validateReset(body) {
  const fields = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  if (body.seed !== undefined && !Number.isSafeInteger(body.seed)) fields.push('seed');
  if (body.stock !== undefined) {
    if (!body.stock || typeof body.stock !== 'object' || Array.isArray(body.stock)) fields.push('stock');
    else for (const [id, amount] of Object.entries(body.stock)) {
      if (!Object.hasOwn(defaultStock, id) || !Number.isSafeInteger(amount) || amount < 0) fields.push(`stock.${id}`);
    }
  }
  return fields;
}
