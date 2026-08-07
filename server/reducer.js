// Authoritative game state + scheduling logic.
// This runs ONLY on the server. Clients never compute matches themselves —
// they send actions and render whatever state the server broadcasts back.

const pairKey = (a, b) => [a, b].sort().join("|");

function combinations(arr, k) {
  const res = [];
  const rec = (start, combo) => {
    if (combo.length === k) { res.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) { combo.push(arr[i]); rec(i + 1, combo); combo.pop(); }
  };
  rec(0, []);
  return res;
}

const cmpKey = (a, b) => {
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
};

export function computeWaitingIds(units) {
  return Object.values(units)
    .filter((u) => u.active && !u.onCourt)
    .sort((a, b) => a.gamesPlayed - b.gamesPlayed || a.lastFinishedOrder - b.lastFinishedOrder || a.order - b.order)
    .map((u) => u.id);
}

function pickBest(waitingIds, unitsMap, mode, opponentHist, partnerHist) {
  const poolSize = Math.min(waitingIds.length, 8);
  const pool = waitingIds.slice(0, poolSize);
  const posIndex = {};
  waitingIds.forEach((id, i) => (posIndex[id] = i));

  if (mode === "fixed") {
    if (pool.length < 2) return null;
    let best = null;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i], b = pool[j];
        const repeatScore = opponentHist[pairKey(a, b)] || 0;
        const gp = unitsMap[a].gamesPlayed + unitsMap[b].gamesPlayed;
        const posSum = posIndex[a] + posIndex[b];
        const key = [repeatScore, gp, posSum];
        if (!best || cmpKey(key, best.key) < 0) best = { sideA: [a], sideB: [b], key };
      }
    }
    return best;
  }

  if (pool.length < 4) return null;
  let best = null;
  const combos = combinations(pool, 4);
  for (const combo of combos) {
    const splits = [
      [[combo[0], combo[1]], [combo[2], combo[3]]],
      [[combo[0], combo[2]], [combo[1], combo[3]]],
      [[combo[0], combo[3]], [combo[1], combo[2]]],
    ];
    for (const [sideA, sideB] of splits) {
      const partnerScore = (partnerHist[pairKey(...sideA)] || 0) + (partnerHist[pairKey(...sideB)] || 0);
      let oppScore = 0;
      for (const x of sideA) for (const y of sideB) oppScore += opponentHist[pairKey(x, y)] || 0;
      const repeatScore = partnerScore * 2 + oppScore;
      const gp = combo.reduce((s, id) => s + unitsMap[id].gamesPlayed, 0);
      const posSum = combo.reduce((s, id) => s + posIndex[id], 0);
      const key = [repeatScore, gp, posSum];
      if (!best || cmpKey(key, best.key) < 0) best = { sideA, sideB, key };
    }
  }
  return best;
}

function fillAllEmptyCourts(courtsState, unitsIn, mode, opponentHist, partnerHist) {
  const units = { ...unitsIn };
  const courts = courtsState.map((c) => ({ ...c }));
  for (const court of courts) {
    if (court.match) continue;
    const waitingIds = computeWaitingIds(units);
    const result = pickBest(waitingIds, units, mode, opponentHist, partnerHist);
    if (!result) continue;
    const { sideA, sideB } = result;
    [...sideA, ...sideB].forEach((id) => { units[id] = { ...units[id], onCourt: true }; });
    court.match = { sideA, sideB };
  }
  return { courts, units };
}

export const initialState = {
  phase: "setup",
  mode: "individual",
  players: [],
  teams: [],
  courtCount: 1,
  units: {},
  opponentHist: {},
  partnerHist: {},
  courtsState: [],
  log: [],
  orderCounter: 0,
};

function rid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function reducer(state, action) {
  switch (action.type) {
    case "NEW_SESSION":
      return { ...initialState };

    case "ADD_PLAYER": {
      const name = (action.name || "").trim();
      if (!name) return state;
      return { ...state, players: [...state.players, { id: rid("p"), name }] };
    }

    case "REMOVE_PLAYER": {
      const pid = action.id;
      return {
        ...state,
        players: state.players.filter((p) => p.id !== pid),
        teams: state.teams.filter((t) => !t.playerIds.includes(pid)),
      };
    }

    case "SET_MODE":
      return { ...state, mode: action.mode, teams: [] };

    case "CREATE_TEAM": {
      const [aId, bId] = action.playerIds || [];
      const a = state.players.find((p) => p.id === aId);
      const b = state.players.find((p) => p.id === bId);
      if (!a || !b) return state;
      return { ...state, teams: [...state.teams, { id: rid("t"), name: `${a.name} & ${b.name}`, playerIds: [aId, bId] }] };
    }

    case "BREAK_TEAM":
      return { ...state, teams: state.teams.filter((t) => t.id !== action.id) };

    case "MOVE_PLAYER": {
      const idx = state.players.findIndex((p) => p.id === action.id);
      if (idx < 0) return state;
      const newIdx = idx + action.direction;
      if (newIdx < 0 || newIdx >= state.players.length) return state;
      const players = [...state.players];
      [players[idx], players[newIdx]] = [players[newIdx], players[idx]];
      return { ...state, players };
    }

    case "MOVE_TEAM": {
      const idx = state.teams.findIndex((t) => t.id === action.id);
      if (idx < 0) return state;
      const newIdx = idx + action.direction;
      if (newIdx < 0 || newIdx >= state.teams.length) return state;
      const teams = [...state.teams];
      [teams[idx], teams[newIdx]] = [teams[newIdx], teams[idx]];
      return { ...state, teams };
    }

    case "AUTO_PAIR": {
      const paired = new Set(state.teams.flatMap((t) => t.playerIds));
      const unpaired = state.players.filter((p) => !paired.has(p.id));
      const shuffled = [...unpaired].sort(() => Math.random() - 0.5);
      const newTeams = [];
      for (let i = 0; i + 1 < shuffled.length; i += 2) {
        const a = shuffled[i], b = shuffled[i + 1];
        newTeams.push({ id: rid("t"), name: `${a.name} & ${b.name}`, playerIds: [a.id, b.id] });
      }
      return { ...state, teams: [...state.teams, ...newTeams] };
    }

    case "SET_COURTS":
      return { ...state, courtCount: Math.max(1, action.count) };

    case "START_SESSION": {
      const units = {};
      let order = 0;
      const source = state.mode === "fixed" ? state.teams : state.players;
      source.forEach((s) => {
        units[s.id] = { id: s.id, name: s.name, gamesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, active: true, onCourt: false, lastFinishedOrder: order, order };
        order++;
      });
      const courtsState = Array.from({ length: state.courtCount }, (_, i) => ({ id: i, match: null }));
      const filled = fillAllEmptyCourts(courtsState, units, state.mode, {}, {});
      return { ...state, phase: "session", units: filled.units, courtsState: filled.courts, opponentHist: {}, partnerHist: {}, log: [], orderCounter: 0 };
    }

    case "SUBMIT_SCORE": {
      const { courtId, scoreA, scoreB } = action;
      const court = state.courtsState.find((c) => c.id === courtId);
      if (!court || !court.match) return state;
      if (typeof scoreA !== "number" || typeof scoreB !== "number" || isNaN(scoreA) || isNaN(scoreB) || scoreA === scoreB) return state;
      const { sideA, sideB } = court.match;
      const aWon = scoreA > scoreB;
      const units = { ...state.units };
      const order = state.orderCounter;

      sideA.forEach((id) => {
        const u = { ...units[id] };
        u.gamesPlayed += 1; u.pointsFor += scoreA; u.pointsAgainst += scoreB;
        if (aWon) u.wins += 1; else u.losses += 1;
        u.onCourt = false; u.lastFinishedOrder = order;
        units[id] = u;
      });
      sideB.forEach((id) => {
        const u = { ...units[id] };
        u.gamesPlayed += 1; u.pointsFor += scoreB; u.pointsAgainst += scoreA;
        if (!aWon) u.wins += 1; else u.losses += 1;
        u.onCourt = false; u.lastFinishedOrder = order;
        units[id] = u;
      });

      const opponentHist = { ...state.opponentHist };
      sideA.forEach((a) => sideB.forEach((b) => { const k = pairKey(a, b); opponentHist[k] = (opponentHist[k] || 0) + 1; }));

      const partnerHist = { ...state.partnerHist };
      if (state.mode === "individual") {
        if (sideA.length === 2) { const k = pairKey(...sideA); partnerHist[k] = (partnerHist[k] || 0) + 1; }
        if (sideB.length === 2) { const k = pairKey(...sideB); partnerHist[k] = (partnerHist[k] || 0) + 1; }
      }

      const logEntry = { id: rid("g"), courtId, sideA, sideB, scoreA, scoreB, ts: Date.now() };
      let courtsState = state.courtsState.map((c) => (c.id === courtId ? { ...c, match: null } : c));
      const filled = fillAllEmptyCourts(courtsState, units, state.mode, opponentHist, partnerHist);

      return { ...state, units: filled.units, courtsState: filled.courts, opponentHist, partnerHist, log: [...state.log, logEntry], orderCounter: order + 1 };
    }

    case "UNDO_LAST": {
      if (state.log.length === 0) return state;
      const lastEntry = state.log[state.log.length - 1];
      const units = { ...state.units };
      const court = state.courtsState.find((c) => c.id === lastEntry.courtId);

      if (court && court.match) {
        [...court.match.sideA, ...court.match.sideB].forEach((id) => { units[id] = { ...units[id], onCourt: false }; });
      }

      const aWon = lastEntry.scoreA > lastEntry.scoreB;
      lastEntry.sideA.forEach((id) => {
        const u = { ...units[id] };
        u.gamesPlayed -= 1; u.pointsFor -= lastEntry.scoreA; u.pointsAgainst -= lastEntry.scoreB;
        if (aWon) u.wins -= 1; else u.losses -= 1;
        u.onCourt = true;
        units[id] = u;
      });
      lastEntry.sideB.forEach((id) => {
        const u = { ...units[id] };
        u.gamesPlayed -= 1; u.pointsFor -= lastEntry.scoreB; u.pointsAgainst -= lastEntry.scoreA;
        if (!aWon) u.wins -= 1; else u.losses -= 1;
        u.onCourt = true;
        units[id] = u;
      });

      const opponentHist = { ...state.opponentHist };
      lastEntry.sideA.forEach((a) => lastEntry.sideB.forEach((b) => { const k = pairKey(a, b); opponentHist[k] = Math.max(0, (opponentHist[k] || 0) - 1); }));

      const partnerHist = { ...state.partnerHist };
      if (state.mode === "individual") {
        if (lastEntry.sideA.length === 2) { const k = pairKey(...lastEntry.sideA); partnerHist[k] = Math.max(0, (partnerHist[k] || 0) - 1); }
        if (lastEntry.sideB.length === 2) { const k = pairKey(...lastEntry.sideB); partnerHist[k] = Math.max(0, (partnerHist[k] || 0) - 1); }
      }

      const courtsState = state.courtsState.map((c) => (c.id === lastEntry.courtId ? { ...c, match: { sideA: lastEntry.sideA, sideB: lastEntry.sideB } } : c));

      return { ...state, units, opponentHist, partnerHist, courtsState, log: state.log.slice(0, -1) };
    }

    case "TOGGLE_ACTIVE": {
      const u = state.units[action.id];
      if (!u || u.onCourt) return state;
      const units = { ...state.units, [action.id]: { ...u, active: !u.active } };
      const filled = fillAllEmptyCourts(state.courtsState, units, state.mode, state.opponentHist, state.partnerHist);
      return { ...state, units: filled.units, courtsState: filled.courts };
    }

    case "ADD_UNIT_MIDSESSION": {
      const name = (action.name || "").trim();
      if (!name) return state;
      const vals = Object.values(state.units);
      const gp = vals.length ? Math.min(...vals.map((u) => u.gamesPlayed)) : 0;
      const id = rid(state.mode === "fixed" ? "t" : "p");
      const units = { ...state.units, [id]: { id, name, gamesPlayed: gp, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, active: true, onCourt: false, lastFinishedOrder: state.orderCounter, order: state.orderCounter } };
      const filled = fillAllEmptyCourts(state.courtsState, units, state.mode, state.opponentHist, state.partnerHist);
      return { ...state, units: filled.units, courtsState: filled.courts, orderCounter: state.orderCounter + 1 };
    }

    case "SET_COURT_COUNT_MIDSESSION": {
      const count = Math.max(1, action.count);
      let courtsState = [...state.courtsState];
      if (count > courtsState.length) {
        for (let i = courtsState.length; i < count; i++) courtsState.push({ id: i, match: null });
      } else if (count < courtsState.length) {
        const removable = [...courtsState].reverse().filter((c) => !c.match).slice(0, courtsState.length - count).map((c) => c.id);
        courtsState = courtsState.filter((c) => !removable.includes(c.id));
      }
      const filled = fillAllEmptyCourts(courtsState, state.units, state.mode, state.opponentHist, state.partnerHist);
      return { ...state, courtsState: filled.courts, units: filled.units, courtCount: filled.courts.length };
    }

    default:
      return state;
  }
}
