// Demo-only content. Sport ids and scoring-event names here are ordinary seed data.
export const demo = {
  sport_id:'football',league_id:'league-alpha-1',name:'Alpha Premier League',
  teams:['team-alpha-1','team-alpha-2','team-alpha-3','team-alpha-4'],
  team_names:['Alpha United','Alpha Rangers','Campus Stars','City Falcons'],
  fixtures:[
    {match_id:'demo-match-alpha-1',home:'team-alpha-1',away:'team-alpha-2',starts_at:'2026-10-17T07:00:00Z',events:[['match_start',{}],['score',{team_id:'team-alpha-1',event_type:'goal'}],['match_end',{}]]},
    {match_id:'demo-match-alpha-2',home:'team-alpha-3',away:'team-alpha-4',starts_at:'2026-10-17T08:00:00Z',events:[['match_start',{}],['score',{team_id:'team-alpha-3',event_type:'goal'}],['score',{team_id:'team-alpha-4',event_type:'goal'}],['score',{team_id:'team-alpha-4',event_type:'goal'}],['match_end',{}]]},
    {match_id:'demo-match-alpha-3',home:'team-alpha-1',away:'team-alpha-3',starts_at:'2026-10-17T09:00:00Z',events:[['match_start',{}],['score',{team_id:'team-alpha-1',event_type:'goal'}],['score',{team_id:'team-alpha-3',event_type:'goal'}]]},
    {match_id:'demo-match-alpha-4',home:'team-alpha-2',away:'team-alpha-4',starts_at:'2026-10-18T07:00:00Z',events:[]},
    {match_id:'demo-match-alpha-5',home:'team-alpha-1',away:'team-alpha-4',starts_at:'2026-10-18T08:00:00Z',events:[]},
    {match_id:'demo-match-alpha-6',home:'team-alpha-2',away:'team-alpha-3',starts_at:'2026-10-18T09:00:00Z',events:[]}
  ]
};
export async function seedDemo(client,seed,sign) {
  const rows=(await client.query('SELECT config FROM sports WHERE sport_id=$1',[demo.sport_id])).rows;
  const sport=rows[0].config;
  for(const [league_id,tenant_id,teams,name,fixtures]of [
    [demo.league_id,'tenant-alpha',demo.teams,demo.name,demo.fixtures],
    ['league-alpha-2','tenant-alpha',['team-alpha-5','team-alpha-6'],'Alpha Reserve League',[]],
    ['league-beta-1','tenant-beta',['team-beta-1','team-beta-2'],'Beta League',[{match_id:'demo-match-beta-1',home:'team-beta-1',away:'team-beta-2',starts_at:'2026-10-18T10:00:00Z',events:[]}]]
  ]) {
    const config={league_id,sport_id:demo.sport_id,name,teams,team_names:Object.fromEntries(teams.map((id,i)=>[id,league_id===demo.league_id?demo.team_names[i]:`Team ${i+1}`])),fixtures:fixtures.map(({events,...fixture})=>fixture),points:{win:3,draw:1,loss:0},tie_break_order:sport.tie_break_order,qualification:{spots:Math.min(2,teams.length)},lots_seed:seed};
    await client.query('UPDATE leagues SET config=$2 WHERE league_id=$1',[league_id,config]);
    for(const fixture of fixtures) {
      await client.query('INSERT INTO matches(match_id,data) VALUES ($1,$2)',[fixture.match_id,{league_id,sport_id:demo.sport_id,home_team_id:fixture.home,away_team_id:fixture.away}]);
      for(const [i,[type,payload]]of fixture.events.entries()) {
        const event_id=`demo-event-${fixture.match_id}-${i+1}`,request={event_id,match_id:fixture.match_id,type,payload},response={event_id,match_id:fixture.match_id,type,sequence:i+1,match_version:i+1,signature:sign(event_id,payload)};
        await client.query('INSERT INTO events(event_id,match_id,sequence,data) VALUES ($1,$2,$3,$4)',[event_id,fixture.match_id,i+1,{request,response}]);
      }
    }
  }
  const staff=[{name:'Ayesha Khan',role:'coach'},{name:'Hamza Malik',role:'manager'},{name:'Sara Ahmed',role:'physio'}];
  for(const [club_id,name,tenant]of [['club-alpha-1','Alpha United','tenant-alpha'],['club-alpha-2','Alpha Rangers','tenant-alpha'],['club-beta-1','Beta Athletics','tenant-beta']]) {
    await client.query('INSERT INTO club_profiles VALUES ($1,$2)',[club_id,{club_id,name,tenant_id:tenant,description:`The home of ${name}.`,home_venue:{name:'Campus Sports Ground',latitude:33.6518,longitude:73.1566,address:'Islamabad, Pakistan'},social_handles:{instagram:'@alphasports'},staff}]);
  }
  const positions=['gk','df','df','df','df','mf','mf','mf','mf','fw','fw','fw'];
  const players=[];
  for(let i=0;i<12;i++) {
    const player_id=i===0?'player-alpha-1':`demo-player-alpha-${String(i+1).padStart(2,'0')}`;
    if(i)await client.query('INSERT INTO players VALUES ($1,$2)',[player_id,'club-alpha-1']);
    const profile={player_id,name:i===0?'Ali Ahmed':`Alpha Player ${i+1}`,position:positions[i]};
    await client.query('INSERT INTO player_profiles VALUES ($1,$2)',[player_id,profile]);
    players.push({...profile,squad_id:'squad-alpha-1',role:i===0?'captain':i===11?'substitute':'starter',parent_squad_id:null,registration_type:'registration',start_date:'2026-01-01',loan_end_date:null});
  }
  for(const [id,name]of [['player-alpha-2','Bilal Hassan'],['player-beta-1','Usman Ali']])await client.query('INSERT INTO player_profiles VALUES ($1,$2)',[id,{player_id:id,name,position:'gk'}]);
  players.push({player_id:'player-alpha-2',name:'Bilal Hassan',position:'gk',squad_id:'squad-alpha-2',role:'captain',parent_squad_id:null,registration_type:'registration',start_date:'2026-01-01',loan_end_date:null});
  await client.query('INSERT INTO rosters VALUES ($1,$2)',[demo.league_id,{league:{league_id:demo.league_id,tenant_id:'tenant-alpha',sport_id:demo.sport_id,transfer_window:{open:'2026-01-01',close:'2026-12-31'},max_squad_size:sport.roster.max_squad_size,required_positions:sport.roster.required_positions},squads:[{squad_id:'squad-alpha-1',club_id:'club-alpha-1',tenant_id:'tenant-alpha',name:'Alpha United'},{squad_id:'squad-alpha-2',club_id:'club-alpha-2',tenant_id:'tenant-alpha',name:'Alpha Rangers'}],players,matches_in_progress:[{match_id:'demo-match-alpha-3',home_squad_id:'squad-alpha-1',away_squad_id:null}]}]);
  await client.query('INSERT INTO product_profiles VALUES ($1,$2)',['prod-jersey-001',{name:'Alpha Home Jersey',description:'Official Alpha Sports home jersey.',club_id:'club-alpha-1',category:'apparel',variants:{'var-jersey-001-M':{size:'M',color:'Blue'},'var-jersey-001-L':{size:'L',color:'Blue'}}}]);
}
