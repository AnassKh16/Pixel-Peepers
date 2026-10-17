// Custom Edmonds blossom feasibility check; vertices may form a non-bipartite graph.
function feasible(vertices,allowed,cost) {
  const n=vertices.length;
  const graph=vertices.map(a=>vertices.map((b,i)=>({b,i})).filter(({b})=>a!==b&&allowed[a][b]).sort((x,y)=>cost(a,x.b)-cost(a,y.b)||x.b-y.b).map(({i})=>i));
  const match=Array(n).fill(-1);
  let parent,base,used,blossom;
  function lca(a,b) {
    const visited=Array(n).fill(false);
    while(true){a=base[a];visited[a]=true;if(match[a]===-1)break;a=parent[match[a]];}
    while(true){b=base[b];if(visited[b])return b;b=parent[match[b]];}
  }
  function markPath(v,b,child) {
    while(base[v]!==b){blossom[base[v]]=blossom[base[match[v]]]=true;parent[v]=child;child=match[v];v=parent[match[v]];}
  }
  function augment(root) {
    used=Array(n).fill(false);parent=Array(n).fill(-1);base=Array.from({length:n},(_,i)=>i);
    const queue=[root];used[root]=true;
    for(let cursor=0;cursor<queue.length;cursor++) {
      const v=queue[cursor];
      for(let u of graph[v]) {
        if(base[v]===base[u]||match[v]===u)continue;
        if(u===root||(match[u]!==-1&&parent[match[u]]!==-1)) {
          const b=lca(v,u);blossom=Array(n).fill(false);markPath(v,b,u);markPath(u,b,v);
          for(let i=0;i<n;i++)if(blossom[base[i]]){base[i]=b;if(!used[i]){used[i]=true;queue.push(i);}}
        } else if(parent[u]===-1) {
          parent[u]=v;
          if(match[u]===-1) {
            for(let current=u;current!==-1;){const previous=parent[current],next=previous===-1?-1:match[previous];match[current]=previous;if(previous!==-1)match[previous]=current;current=next;}
            return true;
          }
          u=match[u];used[u]=true;queue.push(u);
        }
      }
    }
    return false;
  }
  for(let i=0;i<n;i++)if(match[i]===-1&&!augment(i))return null;
  return match.flatMap((partner,i)=>i<partner?[[vertices[i],vertices[partner]]]:[]);
}

// Exact branch-and-bound with memoization. Sorted adjacent scores and incident-edge
// minima provide admissible lower bounds; blossom supplies feasible upper bounds.
export function minimumPairing(vertices,allowed,scores) {
  const cost=(a,b)=>Math.abs(scores[a]-scores[b]),memo=new Map(),bounds=new Map();
  const bits=scores.map((_,i)=>1n<<BigInt(i));
  const members=mask=>vertices.filter(v=>(mask&bits[v])!==0n);
  const maskOf=list=>list.reduce((mask,v)=>mask|bits[v],0n);
  function bound(mask) {
    if(bounds.has(mask))return bounds.get(mask);
    const list=members(mask).sort((a,b)=>scores[a]-scores[b]||a-b);
    let adjacent=0,incident=0;
    for(let i=0;i<list.length;i+=2)adjacent+=cost(list[i],list[i+1]);
    for(const a of list){let least=Infinity;for(const b of list)if(a!==b&&allowed[a][b])least=Math.min(least,cost(a,b));incident+=least;}
    const result=Math.max(adjacent,Math.ceil(incident/2));bounds.set(mask,result);return result;
  }
  function solve(mask) {
    if(mask===0n)return {cost:0,pairs:[]};
    if(memo.has(mask))return memo.get(mask);
    const list=members(mask),unvisited=new Set(list),components=[];
    while(unvisited.size) {
      const component=[unvisited.values().next().value];unvisited.delete(component[0]);
      for(let i=0;i<component.length;i++)for(const v of [...unvisited])if(allowed[component[i]][v]){unvisited.delete(v);component.push(v);}
      if(component.length%2){memo.set(mask,null);return null;}components.push(component);
    }
    if(components.length>1) {
      const pieces=components.map(component=>solve(maskOf(component)));
      const result=pieces.some(piece=>piece===null)?null:{cost:pieces.reduce((sum,piece)=>sum+piece.cost,0),pairs:pieces.flatMap(piece=>piece.pairs)};
      memo.set(mask,result);return result;
    }
    const lower=bound(mask);
    if(!Number.isFinite(lower)){memo.set(mask,null);return null;}
    const initial=feasible([...list].sort((a,b)=>scores[a]-scores[b]||a-b),allowed,cost);
    if(initial===null){memo.set(mask,null);return null;}
    let best={cost:initial.reduce((sum,[a,b])=>sum+cost(a,b),0),pairs:initial};
    if(best.cost!==lower) {
      const degree=a=>list.filter(b=>a!==b&&allowed[a][b]).length;
      const a=[...list].sort((a,b)=>degree(a)-degree(b)||scores[a]-scores[b]||a-b)[0];
      const candidates=list.filter(b=>a!==b&&allowed[a][b]).sort((x,y)=>cost(a,x)-cost(a,y)||x-y);
      for(const b of candidates) {
        const rest=mask^bits[a]^bits[b],edge=cost(a,b);
        if(edge+bound(rest)>=best.cost)continue;
        const sub=solve(rest);
        if(sub&&edge+sub.cost<best.cost)best={cost:edge+sub.cost,pairs:[[a,b],...sub.pairs]};
        if(best.cost===lower)break;
      }
    }
    memo.set(mask,best);return best;
  }
  const result=solve(maskOf(vertices));
  return result?.pairs??null;
}
