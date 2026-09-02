// Authoritative game state + scheduling logic.
// This runs ONLY on the server. Clients never compute matches themselves —
// they send actions and render whatever state the server broadcasts back.

const pairKey = (a, b) => [a, b].sort().join("|");
// Canonical signature for a full match (both full sides), independent of
// side order or player order within a side — used to detect "we already
// played this exact matchup" separately from individual pairwise counts.
const matchSig = (sideA, sideB) => {
  const a = [...sideA].sort().join(",");
  const b = [...sideB].sort().join(",");
  return [a, b].sort().join("|");
};

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

function pickBest(waitingIds, unitsMap, mode, opponentHist, partnerHist, matchHistory) {
  const required = mode === "fixed" ? 2 : 4; // units needed to fill this court
  if (waitingIds.length < required) return null;

  const posIndex = {};
  waitingIds.forEach((id, i) => (posIndex[id] = i));

  // Fairness comes first and is non-negotiable, on TWO dimensions:
  //   1. games played (fewer games = more overdue to play)
  //   2. among players tied on games played, how long they've been waiting
  //      since they last played (older lastFinishedOrder = more overdue)
  // waitingIds is already sorted by exactly (gamesPlayed, lastFinishedOrder,
  // order), so anyone whose (gamesPlayed, lastFinishedOrder) is strictly
  // better than the cutoff MUST play this round — no pairing-variety
  // preference is allowed to bump them for someone less overdue. Handling
  // only dimension 1 isn't enough: once several players are tied on games
  // played (which happens constantly, e.g. once everyone's played the same
  // number of rounds), whoever sat out most recently still needs a hard
  // guarantee, or they can get skipped for pairing variety and end up
  // sitting out two rounds in a row. Only players tied on BOTH dimensions
  // are "contested" — free to be arranged for pairing variety and
  // randomized among ties.
  const cutoffUnit = unitsMap[waitingIds[required - 1]];
  const cutoffGP = cutoffUnit.gamesPlayed;
  const cutoffLFO = cutoffUnit.lastFinishedOrder;
  const mandatory = waitingIds.filter((id) => {
    const u = unitsMap[id];
    return u.gamesPlayed < cutoffGP || (u.gamesPlayed === cutoffGP && u.lastFinishedOrder < cutoffLFO);
  });
  let contested = waitingIds.filter((id) => {
    const u = unitsMap[id];
    return u.gamesPlayed === cutoffGP && u.lastFinishedOrder === cutoffLFO;
  });
  // Cap the contested-candidate search only as a safety valve against truly
  // pathological input sizes (hundreds of people waiting for one court).
  // A tighter cap here is a real fairness bug: once a session runs long
  // enough that many players become exactly tied on games played (which
  // happens naturally and often), a small cap can arbitrarily exclude
  // someone who's just as overdue to play as everyone else, letting them
  // sit out again unfairly. 30 comfortably covers any realistic group size
  // while keeping the combinatorial search fast.
  if (contested.length > 30) contested = contested.slice(0, 30);
  const slotsToFill = required - mandatory.length;
  const contestedCombos = combinations(contested, slotsToFill);

  if (mode === "fixed") {
    let bestKey = null;
    let candidates = [];
    for (const chosen of contestedCombos) {
      const [a, b] = [...mandatory, ...chosen];
      const repeatScore = opponentHist[pairKey(a, b)] || 0;
      const exactCount = (matchHistory && matchHistory[matchSig([a], [b])]) || 0;
      const posSum = posIndex[a] + posIndex[b];
      const key = [repeatScore, exactCount, posSum];
      const cmp = bestKey ? cmpKey(key, bestKey) : -1;
      if (!bestKey || cmp < 0) {
        bestKey = key;
        candidates = [{ sideA: [a], sideB: [b] }];
      } else if (cmp === 0) {
        candidates.push({ sideA: [a], sideB: [b] });
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  let bestKey = null;
  let candidates = [];
  for (const chosen of contestedCombos) {
    const combo = [...mandatory, ...chosen];
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
      const exactCount = (matchHistory && matchHistory[matchSig(sideA, sideB)]) || 0;
      const posSum = combo.reduce((s, id) => s + posIndex[id], 0);
      const key = [repeatScore, exactCount, posSum];
      const cmp = bestKey ? cmpKey(key, bestKey) : -1;
      if (!bestKey || cmp < 0) {
        bestKey = key;
        candidates = [{ sideA, sideB }];
      } else if (cmp === 0) {
        candidates.push({ sideA, sideB });
      }
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function fillAllEmptyCourts(courtsState, unitsIn, mode, opponentHist, partnerHist, matchHistory) {
  const units = { ...unitsIn };
  const courts = courtsState.map((c) => ({ ...c }));
  for (const court of courts) {
    if (court.match) continue;
    const waitingIds = computeWaitingIds(units);
    const result = pickBest(waitingIds, units, mode, opponentHist, partnerHist, matchHistory);
    if (!result) continue;
    const { sideA, sideB } = result;
    [...sideA, ...sideB].forEach((id) => { units[id] = { ...units[id], onCourt: true }; });
    court.match = { sideA, sideB, startedAt: Date.now() };
  }
  return { courts, units };
}

export const initialState = {
  phase: "setup",
  mode: "individual",
  players: [],
  teams: [],
  courtCount: 1,
  courtNames: ["Court 1"],
  units: {},
  opponentHist: {},
  partnerHist: {},
  matchHistory: {},
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

    case "IMPORT_ROSTER": {
      if (state.phase !== "setup") return state;
      const names = Array.isArray(action.names) ? action.names.map((n) => (n || "").trim()).filter(Boolean) : [];
      if (names.length === 0) return state;
      const players = names.map((name) => ({ id: rid("p"), name }));
      const mode = action.mode === "fixed" || action.mode === "individual" ? action.mode : state.mode;
      let teams = [];
      if (mode === "fixed" && Array.isArray(action.teamPairs)) {
        const byName = {};
        players.forEach((p) => { if (!(p.name in byName)) byName[p.name] = p.id; });
        teams = action.teamPairs
          .filter((pair) => Array.isArray(pair) && pair.length === 2 && byName[pair[0]] && byName[pair[1]])
          .map((pair) => ({ id: rid("t"), name: `${pair[0]} & ${pair[1]}`, playerIds: [byName[pair[0]], byName[pair[1]]] }));
      }
      return { ...state, mode, players, teams };
    }

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

    case "SHUFFLE_ORDER": {
      if (state.mode === "fixed") {
        const teams = [...state.teams];
        for (let i = teams.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [teams[i], teams[j]] = [teams[j], teams[i]];
        }
        return { ...state, teams };
      }
      const players = [...state.players];
      for (let i = players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [players[i], players[j]] = [players[j], players[i]];
      }
      return { ...state, players };
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

    case "SET_COURTS": {
      const count = Math.max(1, action.count);
      const courtNames = Array.isArray(state.courtNames) ? [...state.courtNames] : [];
      while (courtNames.length < count) courtNames.push(`Court ${courtNames.length + 1}`);
      courtNames.length = count;
      return { ...state, courtCount: count, courtNames };
    }

    case "RENAME_COURT": {
      const idx = action.index;
      if (typeof idx !== "number" || idx < 0) return state;
      const name = (action.name || "").trim() || `Court ${idx + 1}`;
      if (state.phase === "session") {
        if (!Array.isArray(state.courtsState) || idx >= state.courtsState.length) return state;
        const courtsState = state.courtsState.map((c) => (c.id === idx ? { ...c, name } : c));
        return { ...state, courtsState };
      }
      const existing = Array.isArray(state.courtNames) ? state.courtNames : [];
      if (idx >= existing.length) return state;
      const courtNames = [...existing];
      courtNames[idx] = name;
      return { ...state, courtNames };
    }

    case "START_SESSION": {
      const units = {};
      let order = 0;
      const source = state.mode === "fixed" ? state.teams : state.players;
      source.forEach((s) => {
        units[s.id] = { id: s.id, name: s.name, gamesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, active: true, onCourt: false, lastFinishedOrder: order, order };
        order++;
      });
      const courtsState = Array.from({ length: state.courtCount }, (_, i) => ({ id: i, name: (state.courtNames && state.courtNames[i]) || `Court ${i + 1}`, match: null }));
      const filled = fillAllEmptyCourts(courtsState, units, state.mode, {}, {}, {});
      return { ...state, phase: "session", units: filled.units, courtsState: filled.courts, opponentHist: {}, partnerHist: {}, matchHistory: {}, log: [], orderCounter: 0 };
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

      const matchHistory = { ...state.matchHistory };
      const msig = matchSig(sideA, sideB);
      matchHistory[msig] = (matchHistory[msig] || 0) + 1;

      const endedAt = Date.now();
      const startedAt = court.match.startedAt || endedAt;
      const durationMs = Math.max(0, endedAt - startedAt);
      const logEntry = { id: rid("g"), courtId, sideA, sideB, scoreA, scoreB, ts: endedAt, startedAt, durationMs };
      let courtsState = state.courtsState.map((c) => (c.id === courtId ? { ...c, match: null } : c));
      const filled = fillAllEmptyCourts(courtsState, units, state.mode, opponentHist, partnerHist, matchHistory);

      return { ...state, units: filled.units, courtsState: filled.courts, opponentHist, partnerHist, matchHistory, log: [...state.log, logEntry], orderCounter: order + 1 };
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

      const matchHistory = { ...state.matchHistory };
      const msig = matchSig(lastEntry.sideA, lastEntry.sideB);
      matchHistory[msig] = Math.max(0, (matchHistory[msig] || 0) - 1);

      const courtsState = state.courtsState.map((c) => (c.id === lastEntry.courtId ? { ...c, match: { sideA: lastEntry.sideA, sideB: lastEntry.sideB, startedAt: lastEntry.startedAt } } : c));

      return { ...state, units, opponentHist, partnerHist, matchHistory, courtsState, log: state.log.slice(0, -1) };
    }

    case "TOGGLE_ACTIVE": {
      const u = state.units[action.id];
      if (!u || u.onCourt) return state;
      const units = { ...state.units, [action.id]: { ...u, active: !u.active } };
      const filled = fillAllEmptyCourts(state.courtsState, units, state.mode, state.opponentHist, state.partnerHist, state.matchHistory);
      return { ...state, units: filled.units, courtsState: filled.courts };
    }

    case "SWAP_LINEUP": {
      // Manually swap one unit in a not-yet-played match for a unit currently
      // waiting (e.g. a late arrival takes the spot of someone who wants to
      // sit this game out). Doesn't touch history/stats since this game
      // hasn't been submitted yet — future matches still auto-schedule as
      // normal once this one is submitted.
      const { courtId, outUnitId, inUnitId } = action;
      if (!outUnitId || !inUnitId || outUnitId === inUnitId) return state;
      const courtIdx = state.courtsState.findIndex((c) => c.id === courtId);
      if (courtIdx < 0) return state;
      const court = state.courtsState[courtIdx];
      if (!court.match) return state;

      const inUnit = state.units[inUnitId];
      if (!inUnit || !inUnit.active || inUnit.onCourt) return state; // must be a valid, currently-waiting unit

      let side = null;
      let slotIdx = -1;
      if (court.match.sideA.includes(outUnitId)) { side = "sideA"; slotIdx = court.match.sideA.indexOf(outUnitId); }
      else if (court.match.sideB.includes(outUnitId)) { side = "sideB"; slotIdx = court.match.sideB.indexOf(outUnitId); }
      if (!side) return state;

      const newMatch = { sideA: [...court.match.sideA], sideB: [...court.match.sideB], startedAt: court.match.startedAt };
      newMatch[side][slotIdx] = inUnitId;

      const courtsState = state.courtsState.map((c, i) => (i === courtIdx ? { ...c, match: newMatch } : c));
      const units = { ...state.units };
      units[outUnitId] = { ...units[outUnitId], onCourt: false, lastFinishedOrder: state.orderCounter };
      units[inUnitId] = { ...units[inUnitId], onCourt: true };

      return { ...state, courtsState, units, orderCounter: state.orderCounter + 1 };
    }

    case "ADD_UNIT_MIDSESSION": {
      const name = (action.name || "").trim();
      if (!name) return state;
      const vals = Object.values(state.units);
      const gp = vals.length ? Math.min(...vals.map((u) => u.gamesPlayed)) : 0;
      const id = rid(state.mode === "fixed" ? "t" : "p");
      const units = { ...state.units, [id]: { id, name, gamesPlayed: gp, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, active: true, onCourt: false, lastFinishedOrder: state.orderCounter, order: state.orderCounter } };
      const filled = fillAllEmptyCourts(state.courtsState, units, state.mode, state.opponentHist, state.partnerHist, state.matchHistory);
      return { ...state, units: filled.units, courtsState: filled.courts, orderCounter: state.orderCounter + 1 };
    }

    case "SET_COURT_COUNT_MIDSESSION": {
      const count = Math.max(1, action.count);
      let courtsState = [...state.courtsState];
      if (count > courtsState.length) {
        for (let i = courtsState.length; i < count; i++) courtsState.push({ id: i, name: (state.courtNames && state.courtNames[i]) || `Court ${i + 1}`, match: null });
      } else if (count < courtsState.length) {
        const removable = [...courtsState].reverse().filter((c) => !c.match).slice(0, courtsState.length - count).map((c) => c.id);
        courtsState = courtsState.filter((c) => !removable.includes(c.id));
      }
      const filled = fillAllEmptyCourts(courtsState, state.units, state.mode, state.opponentHist, state.partnerHist, state.matchHistory);
      return { ...state, courtsState: filled.courts, units: filled.units, courtCount: filled.courts.length };
    }

    default:
      return state;
  }
}
