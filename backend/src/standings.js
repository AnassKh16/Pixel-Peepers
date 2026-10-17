import {createHash} from 'node:crypto';
import {projectScore} from './scoring.js';
import {DomainError} from './validation.js';
export const lotsKey=(seed,league,team)=>createHash('sha256').update(`${seed}|${league}|${team}`,'utf8').digest('hex');
// Rational NRR rounded to three decimals, using half-even for exact halfway values.
function netRate(stats,bpo) {
  const faced=BigInt(stats.faced),bowled=BigInt(stats.bowled),unit=BigInt(bpo);
  const a=faced===0n?0n:BigInt(stats.scored)*unit,b=bowled===0n?0n:BigInt(stats.conceded)*unit;
  const x=faced||1n,y=bowled||1n,numerator=(a*y-b*x)*1000n,denominator=x*y,negative=numerator<0n;
  const value=negative?-numerator:numerator;let rounded=value/denominator;const remainder=value%denominator;
  if(remainder*2n>denominator||(remainder*2n===denominator&&rounded%2n===1n))rounded++;
  return Number(negative?-rounded:rounded)/1000;
}
const empty=team_id=>({team_id,played:0,won:0,drawn:0,lost:0,scored:0,conceded:0,points:0,fair_play:0,faced:0,bowled:0});
const zeroH2H=()=>({played:0,points:0,scored:0,conceded:0});
function balls(side,sport) {
  return side.wickets>=sport.periods.wickets_per_innings?sport.periods.overs_per_innings*sport.periods.balls_per_over:side.balls;
}
function add(stats,side,opponent,result,league,sport) {
  const won=result.winner_team_id===side.team_id,draw=result.outcome==='draw',points=draw?league.points.draw:won?league.points.win:league.points.loss;
  stats.played++;stats[draw?'drawn':won?'won':'lost']++;stats.scored+=side.score;stats.conceded+=opponent.score;stats.points+=points;stats.fair_play+=side.fair_play;
  if(sport.scoring_model==='innings'){stats.faced+=balls(side,sport);stats.bowled+=balls(opponent,sport);}
  return points;
}
const difference=(stats,sport)=>sport.scoring_model==='innings'?netRate(stats,sport.periods.balls_per_over):stats.scored-stats.conceded;
export function calculateStandings(league,sport,streams) {
  const rows=new Map(league.teams.map(team=>[team,empty(team)])),remaining=new Map(league.teams.map(team=>[team,0]));
  const h2h=Object.fromEntries(league.teams.map(a=>[a,Object.fromEntries(league.teams.map(b=>[b,zeroH2H()]))]));
  const byMatch=new Map(streams.map(stream=>[stream.match_id,stream])),played=[];
  for(const fixture of league.fixtures) {
    const stream=byMatch.get(fixture.match_id),result=stream?projectScore(stream.match_id,stream.meta,sport,stream.records):null;
    if(!result||result.status!=='completed'||result.outcome==='undecided'){remaining.set(fixture.home,remaining.get(fixture.home)+1);remaining.set(fixture.away,remaining.get(fixture.away)+1);continue;}
    played.push(result);
    for(const [side,other]of [[result.home,result.away],[result.away,result.home]]) {
      const points=add(rows.get(side.team_id),side,other,result,league,sport),cell=h2h[side.team_id][other.team_id];
      cell.played++;cell.points+=points;cell.scored+=side.score;cell.conceded+=other.score;
    }
  }
  for(const row of rows.values())row.diff=difference(row,sport);
  const resolved=new Map(),criteria=[...league.tie_break_order.filter(key=>key!=='draw_lots'),'draw_lots'];
  function resolve(group) {
    if(group.length<2)return group;
    const members=new Set(group),mini=new Map(group.map(team=>[team,empty(team)]));
    for(const result of played)if(members.has(result.home.team_id)&&members.has(result.away.team_id))for(const [side,other]of [[result.home,result.away],[result.away,result.home]])add(mini.get(side.team_id),side,other,result,league,sport);
    for(const criterion of criteria) {
      const value=team=>criterion==='draw_lots'?lotsKey(league.lots_seed,league.league_id,team):criterion==='h2h_points'?mini.get(team).points:criterion==='h2h_diff'?difference(mini.get(team),sport):criterion==='overall_diff'?rows.get(team).diff:rows.get(team)[criterion==='scored'?'scored':'fair_play'];
      const values=new Map(group.map(team=>[team,value(team)])),sorted=[...group].sort((a,b)=>criterion==='draw_lots'?values.get(a).localeCompare(values.get(b)):values.get(b)-values.get(a));
      const buckets=[];for(const team of sorted){if(!buckets.length||values.get(buckets.at(-1)[0])!==values.get(team))buckets.push([]);buckets.at(-1).push(team);}
      if(buckets.length<2)continue;
      const pieces=buckets.map(bucket=>resolve(bucket));
      for(let i=0;i<pieces.length-1;i++)resolved.set(pieces[i].at(-1),criterion);
      return pieces.flat();
    }
    return group;
  }
  const byPoints=[...league.teams].sort((a,b)=>rows.get(b).points-rows.get(a).points),groups=[];
  for(const team of byPoints){if(!groups.length||rows.get(groups.at(-1)[0]).points!==rows.get(team).points)groups.push([]);groups.at(-1).push(team);}
  const ordered=groups.flatMap(resolve),k=league.qualification.spots,max=team=>rows.get(team).points+league.points.win*remaining.get(team);
  const table=ordered.map((team,index)=>{
    const {faced,bowled,...row}=rows.get(team),others=league.teams.filter(other=>other!==team);
    const clinched=others.filter(other=>max(other)>=row.points).length<k;
    const eliminated=others.filter(other=>rows.get(other).points>max(team)).length>=k;
    return {rank:index+1,...row,status:clinched?'clinched':eliminated?'eliminated':'still_possible',resolved_by:resolved.get(team)??null};
  });
  return {league_id:league.league_id,sport_id:league.sport_id,qualification_spots:k,table,h2h};
}
export async function getStandings(pool,leagueId) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row=(await client.query("SELECT l.config,s.config AS sport FROM leagues l LEFT JOIN sports s ON s.sport_id=l.config->>'sport_id' WHERE l.league_id=$1",[leagueId])).rows[0];
    if(!row?.sport)throw new DomainError(404,'LEAGUE_NOT_FOUND','Registered standings league does not exist');
    const streams=(await client.query("SELECT m.match_id,m.data AS meta,COALESCE(jsonb_agg(e.data ORDER BY e.sequence) FILTER (WHERE e.event_id IS NOT NULL),'[]'::jsonb) AS records FROM matches m LEFT JOIN events e ON e.match_id=m.match_id WHERE m.match_id=ANY($1::text[]) GROUP BY m.match_id,m.data",[row.config.fixtures.map(fixture=>fixture.match_id)])).rows;
    await client.query('COMMIT');
    return calculateStandings(row.config,row.sport,streams);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
