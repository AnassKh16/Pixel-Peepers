export function scoreView(projection) {
  const {events,...view}=projection;
  return {...view,score:`${view.home.score} - ${view.away.score}`};
}
