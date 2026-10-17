import { validationError } from './validation.js';
import { bracketMatch,seededFirstRound,resolveBracket } from './brackets.js';
export function doubleElimination(teams,params) {
  if(params.bracket_reset!==undefined&&typeof params.bracket_reset!=='boolean')validationError(['params.bracket_reset']);
  const reset=params.bracket_reset??false,size=2**Math.ceil(Math.log2(teams.length)),k=Math.log2(size);
  const make=(id,bracket,round,index)=>({...bracketMatch(id,bracket,round,index),conditional:false,required:true});
  const winners=Array.from({length:k},(_,r)=>({round:r+1,matches:Array.from({length:size/2**(r+1)},(_,i)=>make(`WR${r+1}M${i+1}`,'winners',r+1,i+1))}));
  const losers=Array.from({length:2*(k-1)},(_,r)=>({round:r+1,matches:Array.from({length:size/2**(Math.ceil((r+1)/2)+1)},(_,i)=>make(`LR${r+1}M${i+1}`,'losers',r+1,i+1))}));
  const grand_final=[make('GF1','grand_final',1,1)];
  if(reset)grand_final.push({...make('GF2','grand_final',2,1),conditional:true,required:null});
  for(const round of winners)for(const match of round.matches) {
    match.winner_to=round.round===k?{match_id:'GF1',slot:'home'}:{match_id:`WR${round.round+1}M${Math.ceil(match.index/2)}`,slot:match.index%2?'home':'away'};
    if(round.round===1)match.loser_to={match_id:`LR1M${Math.ceil(match.index/2)}`,slot:match.index%2?'home':'away'};
    else match.loser_to={match_id:`LR${2*round.round-2}M${round.matches.length+1-match.index}`,slot:'away'};
  }
  for(const round of losers)for(const match of round.matches) {
    if(round.round===losers.length)match.winner_to={match_id:'GF1',slot:'away'};
    else if(round.round%2)match.winner_to={match_id:`LR${round.round+1}M${match.index}`,slot:'home'};
    else match.winner_to={match_id:`LR${round.round+1}M${Math.ceil(match.index/2)}`,slot:match.index%2?'home':'away'};
  }
  if(reset){grand_final[0].winner_to={match_id:'GF2',slot:'home'};grand_final[0].loser_to={match_id:'GF2',slot:'away'};}
  seededFirstRound(winners[0].matches,teams,size);
  const all=[...winners.flatMap(round=>round.matches),...losers.flatMap(round=>round.matches),...grand_final];
  resolveBracket(all,new Set(winners[0].matches.map(match=>match.match_id)),teams,params.results,(match,byId,slots)=>{
    if(match.match_id!=='GF2')return;
    const first=byId.get('GF1');
    match.required=first.winner===null?null:first.winner===first.away;
    if(first.winner===null){match.home=first.home;match.away=first.away;match.home_seed=first.home_seed;match.away_seed=first.away_seed;}
    if(match.required!==true){slots.home=false;slots.away=false;}
  });
  return {format:'double_elim',bracket_size:size,bracket_reset:reset,winners,losers,grand_final};
}
