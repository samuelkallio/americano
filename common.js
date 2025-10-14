/* common.js - data, utilit, recompute, pairing, banner */
const STORAGE_KEY = 'americano_v3';

/* --- Storage helpers --- */
function getData(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) {
    const base = { settings:{courts:3, winPoints:11}, players:[], rounds:[] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
    return base;
  }
  try { return JSON.parse(raw); } catch(e){ return { settings:{courts:3, winPoints:11}, players:[], rounds:[] }; }
}
function saveData(d){ localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }
function navigate(url){ location.href = url; }

/* --- ID helper (fallback if crypto not available) --- */
function makeId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id' + Date.now() + Math.floor(Math.random()*1000);
}

/* --- Banner (toast) --- */
function showBanner(msg, type='success'){
  let el = document.getElementById('banner');
  if(!el){
    el = document.createElement('div'); el.id = 'banner'; el.className = 'banner';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `banner ${type} show`;
  setTimeout(()=>{ el.classList.remove('show'); }, 2500);
}

/* --- Player name helper --- */
function getPlayerNames(ids){
  const d = getData();
  return ids.map(id => (d.players.find(p=>p.id===id) || {name:'?' }).name).join(' & ');
}

/* --- Recompute players stats from all rounds --- */
function recomputePlayersFromRounds(){
  const d = getData();
  // init stats
  const map = {};
  d.players.forEach(p => {
    map[p.id] = { wins:0, totalPoints:0, byeCount:0, games:0, permanentBreak: !!p.permanentBreak };
  });
  (d.rounds || []).forEach(r=>{
    (r.byes || []).forEach(id => { if(map[id]) map[id].byeCount++; });
    (r.courts || []).forEach(c=>{
      const a = Number(c.scoreHome || 0);
      const b = Number(c.scoreAway || 0);
      // add points and games
      (c.home || []).forEach(id => { if(map[id]) { map[id].games++; map[id].totalPoints += a; }});
      (c.away || []).forEach(id => { if(map[id]) { map[id].games++; map[id].totalPoints += b; }});
      // winners: one team must have reached winPoints and higher
      const wp = d.settings?.winPoints ?? 11;
      if(a >= wp && a > b){
        (c.home || []).forEach(id => { if(map[id]) map[id].wins++; });
      } else if(b >= wp && b > a){
        (c.away || []).forEach(id => { if(map[id]) map[id].wins++; });
      }
    });
  });
  // write back keeping name and permanentBreak flag
  d.players = d.players.map(p=>{
    const s = map[p.id] || {wins:0,totalPoints:0,byeCount:0,games:0,permanentBreak: !!p.permanentBreak};
    return { id: p.id, name: p.name, wins: s.wins, totalPoints: s.totalPoints, byeCount: s.byeCount, games: s.games, permanentBreak: !!p.permanentBreak };
  });
  saveData(d);
  return d;
}

/* --- Played pairs set (to avoid repeating partners) --- */
function getPastPartnerSets(rounds){
  // map playerId => Set(partnerIds)
  const map = {};
  (rounds||[]).forEach(r=>{
    (r.courts||[]).forEach(c=>{
      const teams = [c.home||[], c.away||[]];
      teams.forEach(team=>{
        team.forEach(p1=>{
          if(!map[p1]) map[p1] = new Set();
          team.forEach(p2 => { if(p1 !== p2) map[p1].add(p2); });
        });
      });
    });
  });
  return map;
}

/* --- Pairing: make americano pairs avoiding past partners where possible --- */
function makeAmericanoPairs(availPlayers, pastPartners){
  // availPlayers: array of player objects sorted DESC (best first)
  const remaining = availPlayers.slice();
  const pairs = [];
  while(remaining.length > 1){
    const p = remaining.shift();
    // find first partner not in pastPartners[p.id]
    let idx = remaining.findIndex(q => !(pastPartners[p.id] && pastPartners[p.id].has(q.id)));
    if(idx === -1) idx = 0; // fallback: allow repeat
    const partner = remaining.splice(idx,1)[0];
    pairs.push([p, partner]);
  }
  return pairs;
}

/* --- choose bye ids fairly: players with fewest byeCount, weaker first --- */
function chooseByeIds(playersSortedAscBye, count){
  if(count <= 0) return [];
  // playersSortedAscBye should be array of players; we'll sort by byeCount asc, wins asc, totalPoints asc
  const copy = playersSortedAscBye.slice().sort((a,b)=>{
    const ba = a.byeCount||0, bb = b.byeCount||0;
    if(ba !== bb) return ba - bb;
    const wa = a.wins||0, wb = b.wins||0;
    if(wa !== wb) return wa - wb;
    const pa = a.totalPoints||0, pb = b.totalPoints||0;
    return pa - pb;
  });
  return copy.slice(0,count).map(p=>p.id);
}

/* --- Export/Import helpers (optional) --- */
/* Not used by core but handy later */
function exportData(){
  const d = getData();
  const blob = new Blob([JSON.stringify(d, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'americano_export.json'; a.click();
  URL.revokeObjectURL(url);
}
