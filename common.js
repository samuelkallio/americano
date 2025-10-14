/* common.js (module)
   Käyttää Firebase v12 moduuleja (CDN). Tämä tiedosto alustaa Firebase,
   kuuntelee reaaliaikaisesti Firestore-kokoelmia ja tarjoaa CRUD + pairing -funktiot.
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  orderBy,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

/* ---------- CONFIG (Sijoita oma Firebase-konfiguraatiosi tähän) ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyAOZEmizq6jJGBRJA6HJTXnQB8yYv7kA7s",
  authDomain: "americano-turnaus.firebaseapp.com",
  projectId: "americano-turnaus",
  storageBucket: "americano-turnaus.firebasestorage.app",
  messagingSenderId: "869391351319",
  appId: "1:869391351319:web:a2446fface2030c97fe652",
  measurementId: "G-LTDDXGVSJQ"
};

/* ---------- Initialize Firebase & Firestore ---------- */
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
window.db = db; // helpperiksi muille skripteille

/* ---------- Local store (peilataan Firestoreen) ---------- */
const store = {
  players: [],   // array of player docs {id, name, wins, totalPoints, games, byeCount, permanentBreak}
  rounds: [],    // array of round docs {id, date, courts:[{courtNumber, home:[ids], away:[ids], scoreHome, scoreAway}], byes:[]}
  settings: { courts: 3, winPoints: 11 }
};

const LS_KEY = 'americano_store_v1';
function saveLocal(){
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch(e){}
}
function loadLocal(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed.players) store.players = parsed.players;
    if(parsed.rounds) store.rounds = parsed.rounds;
    if(parsed.settings) store.settings = parsed.settings;
  } catch(e){}
}

/* ---------- Utility ---------- */
function makeId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id' + Date.now() + Math.floor(Math.random()*1000);
}
function showBanner(msg, type='success'){
  const el = document.getElementById('banner');
  if(!el) return;
  el.textContent = msg;
  el.className = `banner ${type}`;
  el.style.display = 'block';
  setTimeout(()=>{ el.style.display = 'none'; }, 2500);
}

/* ---------- Firestore live sync ---------- */
let unsubPlayers = null, unsubRounds = null, unsubSettings = null;

export function startLiveSync(){
  // players
  const playersRef = collection(db, 'players');
  const qPlayers = query(playersRef, orderBy('name')); // ordering for stable listing
  unsubPlayers = onSnapshot(qPlayers, snap => {
    store.players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    saveLocal();
    if(window.updatePlayersUI) window.updatePlayersUI(store.players);
  });

  // rounds
  const roundsRef = collection(db, 'rounds');
  const qRounds = query(roundsRef, orderBy('date','desc'));
  unsubRounds = onSnapshot(qRounds, snap => {
    store.rounds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    saveLocal();
    if(window.updateRoundsUI) window.updateRoundsUI(store.rounds);
  });

  // settings (single doc)
  const settingsDoc = doc(db, 'settings', 'main');
  unsubSettings = onSnapshot(settingsDoc, snap => {
    if(snap.exists()){
      store.settings = snap.data();
      saveLocal();
      if(window.updateSettingsUI) window.updateSettingsUI(store.settings);
    } else {
      // if no settings doc, write defaults
      setDoc(settingsDoc, store.settings).catch(()=>{});
    }
  });

  console.log('Live sync started');
  showBanner('🔄 Live sync käynnissä', 'success');
}

/* ---------- CRUD helperit ---------- */
export async function addPlayerToDB(player){
  // player: { id?, name, permanentBreak?, wins?, totalPoints?, games?, byeCount? }
  if (!player.name || !player.name.trim()) {
    showBanner('Nimi ei kelpaa','error');
    throw new Error('Tyhjä nimi');
  }
  const id = player.id || makeId();
  console.log("Lisätään pelaaja Firestoreen:", id, player.name);
  await setDoc(doc(db,'players', id), { 
    name: player.name.trim(), 
    permanentBreak: !!player.permanentBreak,
    wins: player.wins||0, 
    totalPoints: player.totalPoints||0, 
    games: player.games||0, 
    byeCount: player.byeCount||0 
  }, { merge:true });
  return id;
}
export async function updatePlayerInDB(id, data){
  await setDoc(doc(db,'players', id), data, { merge:true });
}
export async function deletePlayerFromDB(id){
  await deleteDoc(doc(db,'players', id));
}

export async function saveRoundToDB(round){
  const id = round.id || makeId();
  await setDoc(doc(db,'rounds', id), round, { merge:true });
  return id;
}
export async function deleteRoundFromDB(id){
  await deleteDoc(doc(db,'rounds', id));
}

export async function saveSettingsToDB(settings){
  await setDoc(doc(db,'settings','main'), settings, { merge:true });
}

/* ---------- Recompute stats from rounds and persist to DB ---------- */
export async function recomputeAndSavePlayers(){
  // recompute from store.rounds onto store.players in-memory, then write each player doc.
  // We compute wins, totalPoints, games, byeCount
  // Start fresh
  const stats = {};
  store.players.forEach(p => stats[p.id] = { wins:0, totalPoints:0, games:0, byeCount: p.byeCount||0, permanentBreak: !!p.permanentBreak, name: p.name });

  (store.rounds || []).forEach(r=>{
    (r.byes || []).forEach(bid=>{
      if(stats[bid]) stats[bid].byeCount = (stats[bid].byeCount||0) + 1;
    });
    (r.courts || []).forEach(c=>{
      const a = Number(c.scoreHome||0);
      const b = Number(c.scoreAway||0);
      (c.home||[]).forEach(pid => {
        if(stats[pid]) { stats[pid].totalPoints += a; stats[pid].games++; if(a > b) stats[pid].wins++; }
      });
      (c.away||[]).forEach(pid => {
        if(stats[pid]) { stats[pid].totalPoints += b; stats[pid].games++; if(b > a) stats[pid].wins++; }
      });
    });
  });

  // write back to Firestore
  const promises = [];
  Object.keys(stats).forEach(pid => {
    const s = stats[pid];
    promises.push(setDoc(doc(db,'players', pid), {
      name: s.name,
      wins: s.wins,
      totalPoints: s.totalPoints,
      games: s.games,
      byeCount: s.byeCount,
      permanentBreak: s.permanentBreak
    }, { merge:true }));
  });
  await Promise.all(promises);
  showBanner('🔢 Pelaajatilastot päivitetty', 'success');
}

/* ---------- Pairing/Americano helpers ---------- */
function getPastPartnerSets(rounds){
  const map = {};
  (rounds||[]).forEach(r=>{
    (r.courts||[]).forEach(c=>{
      const teams = [c.home||[], c.away||[]];
      teams.forEach(team=>{
        team.forEach(a=>{
          map[a] = map[a] || new Set();
          team.forEach(b => { if(a!==b) map[a].add(b); });
        });
      });
    });
  });
  return map;
}

function makeAmericanoPairs(playersList, pastPartners){
  // playersList assumed sorted best-first
  const pool = playersList.slice();
  const pairs = [];
  while(pool.length > 1){
    const p = pool.shift();
    let idx = pool.findIndex(q => !(pastPartners[p.id] && pastPartners[p.id].has(q.id)));
    if(idx === -1) idx = 0; // fallback
    const partner = pool.splice(idx,1)[0];
    pairs.push([p, partner]);
  }
  return pairs;
}

/* ---------- autoCreateRound etc. ---------- */
export function autoCreateRound(){
  // create round from current store.players and store.rounds
  const settings = store.settings || { courts:3, winPoints:11 };
  const courts = Math.max(1, settings.courts || 3);

  // active players: not permanentBreak
  const active = store.players.filter(p => !p.permanentBreak).slice();

  // sort best-first by wins, then totalPoints
  active.sort((a,b) => (b.wins||0) - (a.wins||0) || (b.totalPoints||0) - (a.totalPoints||0));

  // determine byes if more than courts*4 players
  const maxPlayers = courts * 4;
  let byes = [];
  if(active.length > maxPlayers){
    // choose byes fairly: fewest byeCount and weaker first
    const byeCandidates = active.slice().sort((a,b)=> (a.byeCount||0) - (b.byeCount||0) || (a.wins||0) - (b.wins||0) || (a.totalPoints||0) - (b.totalPoints||0));
    byes = byeCandidates.slice(0, active.length - maxPlayers).map(p=>p.id);
  }

  // avail players for pairing
  const avail = active.filter(p => !byes.includes(p.id));

  // get past partners
  const pastPartners = getPastPartnerSets(store.rounds);
  const pairs = makeAmericanoPairs(avail, pastPartners); // array of [p,partner]

  // create courts: take pairs in order, 2 pairs per court
  const courtsArr = [];
  for(let i=0;i<Math.floor(pairs.length/2) && i<courts; i++){
    const A = pairs[i*2];
    const B = pairs[i*2+1];
    if(!A || !B) continue;
    // map: higher court number for stronger pairs: we'll use courtNumber = courts - i
    courtsArr.push({
      courtNumber: courts - i,
      home: [A[0].id, A[1].id],
      away: [B[0].id, B[1].id],
      scoreHome: 0,
      scoreAway: 0
    });
  }

  const round = {
    id: makeId(),
    date: new Date().toISOString(),
    courts: courtsArr,
    byes
  };

  // push to Firestore
  return saveRoundToFirestore(round);
}

/* ---------- helper: write round to firestore (and update local store) ---------- */
async function saveRoundToFirestore(round){
  await setDoc(doc(db,'rounds', round.id), round, { merge:true });
  // local store will be updated by onSnapshot
  return round.id;
}

/* ---------- Public API (attach to window) ---------- */
window.startLiveSync = startLiveSync;
window.store = store;
window.addPlayerToDB = addPlayerToDB;
window.updatePlayerInDB = updatePlayerInDB;
window.deletePlayerFromDB = deletePlayerFromDB;
window.saveRoundToDB = saveRoundToDB;
window.deleteRoundFromDB = deleteRoundFromDB;
window.saveSettingsToDB = saveSettingsToDB;
window.recomputeAndSavePlayers = recomputeAndSavePlayers;
window.autoCreateRound = autoCreateRound;
window.showBanner = showBanner;

/* ---------- load from local fallback and export for debugging ---------- */
loadLocal();
console.log('common.js loaded, store initial (local copy):', store);
