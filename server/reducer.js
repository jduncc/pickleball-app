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
    .sort((a, b) =>
      (b.missStreak || 0) - (a.missStreak || 0) ||
      a.gamesPlayed - b.gamesPlayed ||
      (a.lastPlayedAt || 0) - (b.lastPlayedAt || 0) ||
      (a.lastPlayedSeq || 0) - (b.lastPlayedSeq || 0) ||
      a.order - b.order
    )
    .map((u) => u.id);
}

function pickBest(waitingIds, unitsMap, mode, opponentHist, partnerHist, matchHistory) {
  const required = mode === "fixed" ? 2 : 4; // units needed to fill this court
  if (waitingIds.length < required) return null;

  const posIndex = {};
  waitingIds.forEach((id, i) => (posIndex[id] = i));

  // Fairness comes first and is non-negotiable, ranked in this order:
  //   1. consecutive-miss streak (someone who was already skipped for the
  //      immediately preceding scheduling decision, on any court, and is
  //      STILL waiting must get this spot — this is what actually caps
  //      "sat out twice in a row" at once, overriding games-played if the
  //      two conflict. Without this, a player whose court happens to cycle
  //      faster than another can legitimately pull ahead on total games
  //      played, sit once fairly, and then have to wait again while a
  //      slower court catches up — which looks and feels like two misses
  //      in a row even though each individual decision was locally fair.
  //   2. games played (fewer games = more overdue to play)
  //   3. among players tied on both, actual elapsed time since they last
  //      finished playing (longer ago = more overdue) — real wall-clock
  //      time (ms since epoch), so it lines up with what "sitting order"
  //      intuitively means. A monotonic sequence number breaks any exact
  //      timestamp ties (e.g. two courts finishing in the same millisecond)
  //      so equally-timed events still resolve to a strict, unambiguous
  //      order rather than colliding into a false tie.
  // waitingIds is already sorted by exactly (missStreak, gamesPlayed,
  // lastPlayedAt, lastPlayedSeq, order), so anyone strictly better than the
  // cutoff on these MUST play this round — no pairing-variety preference is
  // allowed to bump them for someone less overdue. Only players tied on ALL
  // of these are "contested" — free to be arranged for pairing variety and
  // randomized among ties.
  const cutoffUnit = unitsMap[waitingIds[required - 1]];
  const cutoffMiss = cutoffUnit.missStreak || 0;
  const cutoffGP = cutoffUnit.gamesPlayed;
  const cutoffLPA = cutoffUnit.lastPlayedAt || 0;
  const cutoffSeq = cutoffUnit.lastPlayedSeq || 0;
  const mandatory = waitingIds.filter((id) => {
    const u = unitsMap[id];
    const miss = u.missStreak || 0;
    if (miss !== cutoffMiss) return miss > cutoffMiss;
    if (u.gamesPlayed !== cutoffGP) return u.gamesPlayed < cutoffGP;
    const lpa = u.lastPlayedAt || 0;
    if (lpa !== cutoffLPA) return lpa < cutoffLPA;
    return (u.lastPlayedSeq || 0) < cutoffSeq;
  });
  let contested = waitingIds.filter((id) => {
    const u = unitsMap[id];
    return (u.missStreak || 0) === cutoffMiss && u.gamesPlayed === cutoffGP && (u.lastPlayedAt || 0) === cutoffLPA && (u.lastPlayedSeq || 0) === cutoffSeq;
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

// For a synchronized shuffle: decide WHO PLAYS this round vs who sits, once,
// across every court combined — not court by court. That's the fairness
// step, using the same rule as everywhere else (games played, then real
// elapsed time since last played). Ties beyond what's needed are broken
// randomly (not by pairing history), because the pairing/court assignment
// itself is handled entirely separately next — mixing that in here is what
// let the old per-court logic silently lock groups in place.
function determineShufflePlayingSet(units, totalRequired) {
  const waitingIds = computeWaitingIds(units);
  if (waitingIds.length < totalRequired) return null;
  const cutoffUnit = units[waitingIds[totalRequired - 1]];
  const cutoffMiss = cutoffUnit.missStreak || 0;
  const cutoffGP = cutoffUnit.gamesPlayed;
  const cutoffLPA = cutoffUnit.lastPlayedAt || 0;
  const cutoffSeq = cutoffUnit.lastPlayedSeq || 0;
  const mandatory = waitingIds.filter((id) => {
    const u = units[id];
    const miss = u.missStreak || 0;
    if (miss !== cutoffMiss) return miss > cutoffMiss;
    if (u.gamesPlayed !== cutoffGP) return u.gamesPlayed < cutoffGP;
    const lpa = u.lastPlayedAt || 0;
    if (lpa !== cutoffLPA) return lpa < cutoffLPA;
    return (u.lastPlayedSeq || 0) < cutoffSeq;
  });
  const contested = waitingIds.filter((id) => {
    const u = units[id];
    return (u.missStreak || 0) === cutoffMiss && u.gamesPlayed === cutoffGP && (u.lastPlayedAt || 0) === cutoffLPA && (u.lastPlayedSeq || 0) === cutoffSeq;
  });
  const slotsNeeded = totalRequired - mandatory.length;
  const shuffledContested = [...contested];
  for (let i = shuffledContested.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledContested[i], shuffledContested[j]] = [shuffledContested[j], shuffledContested[i]];
  }
  return [...mandatory, ...shuffledContested.slice(0, slotsNeeded)];
}

// Score + best partner split for a single court's group of players, with NO
// fairness constraint at all (fairness was already decided by
// determineShufflePlayingSet) — only repeat-avoidance for variety.
function bestSplitForGroup(group, mode, opponentHist, partnerHist, matchHistory) {
  if (mode === "fixed") {
    const [x, y] = group;
    const repeatScore = opponentHist[pairKey(x, y)] || 0;
    const exactCount = (matchHistory && matchHistory[matchSig([x], [y])]) || 0;
    return { sideA: [x], sideB: [y], score: repeatScore * 2 + exactCount * 3 };
  }
  const splits = [
    [[group[0], group[1]], [group[2], group[3]]],
    [[group[0], group[2]], [group[1], group[3]]],
    [[group[0], group[3]], [group[1], group[2]]],
  ];
  let best = null;
  let bestScore = Infinity;
  for (const [sideA, sideB] of splits) {
    const partnerScore = (partnerHist[pairKey(...sideA)] || 0) + (partnerHist[pairKey(...sideB)] || 0);
    let oppScore = 0;
    for (const x of sideA) for (const y of sideB) oppScore += opponentHist[pairKey(x, y)] || 0;
    const exactCount = (matchHistory && matchHistory[matchSig(sideA, sideB)]) || 0;
    const score = partnerScore * 2 + oppScore + exactCount * 3;
    if (score < bestScore) { bestScore = score; best = { sideA, sideB }; }
  }
  return { ...best, score: bestScore };
}

// Every way to partition the playing set across the courts, tried in full,
// keeping whichever complete layout minimizes total repeat score across
// every court at once (ties broken randomly). This is what guarantees a
// repeat-free arrangement gets used whenever one genuinely exists — sampling
// random layouts and hoping to stumble on the optimum (the previous
// approach) verifiably does not: tested against real sessions it settled for
// partner repeats after using only ~24 of the 28 possible pairs for 8
// players, well short of the full rotation a true search finds.
function exhaustiveAssign(courtIds, remainingPlayers, mode, opponentHist, partnerHist, matchHistory) {
  const perCourt = mode === "fixed" ? 2 : 4;
  if (courtIds.length === 0) return { layout: [], score: 0 };
  const [courtId, ...restCourts] = courtIds;
  let best = null;
  for (const group of combinations(remainingPlayers, perCourt)) {
    const groupSet = new Set(group);
    const rest = remainingPlayers.filter((p) => !groupSet.has(p));
    const split = bestSplitForGroup(group, mode, opponentHist, partnerHist, matchHistory);
    const sub = exhaustiveAssign(restCourts, rest, mode, opponentHist, partnerHist, matchHistory);
    const total = split.score + sub.score;
    if (!best || total < best.score || (total === best.score && Math.random() < 0.5)) {
      best = { score: total, layout: [{ courtId, sideA: split.sideA, sideB: split.sideB }, ...sub.layout] };
    }
  }
  return best;
}

// Safety valve: exhaustive search over every full court layout is only run
// when the space is small enough to finish instantly. Realistic group sizes
// (well into the dozens of players) stay comfortably under this cap; only
// pathologically large groups fall back to randomized sampling, which can't
// guarantee the optimum but still performs well in practice.
const ASSIGNMENT_SEARCH_CAP = 200000;

function estimateAssignmentSpace(totalPlayers, perCourt) {
  let remaining = totalPlayers;
  let space = 1;
  while (remaining > 0 && space <= ASSIGNMENT_SEARCH_CAP) {
    let c = 1;
    for (let i = 0; i < perCourt; i++) c = (c * (remaining - i)) / (i + 1);
    space *= c;
    remaining -= perCourt;
  }
  return space;
}

// Once the fair "who plays" set is fixed, freely shuffle them across courts
// and into partner/opponent splits with no fairness constraint — searched
// exhaustively when feasible (see above), otherwise sampled randomly.
function shuffleAssignCourts(courtIds, playingSet, mode, opponentHist, partnerHist, matchHistory) {
  const perCourt = mode === "fixed" ? 2 : 4;
  const searchSpace = estimateAssignmentSpace(playingSet.length, perCourt);
  if (searchSpace <= ASSIGNMENT_SEARCH_CAP) {
    return exhaustiveAssign(courtIds, playingSet, mode, opponentHist, partnerHist, matchHistory).layout;
  }
  const attempts = 40;
  let bestScore = Infinity;
  let candidates = [];
  for (let a = 0; a < attempts; a++) {
    const shuffled = [...playingSet];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const layout = [];
    let score = 0;
    for (let c = 0; c < courtIds.length; c++) {
      const group = shuffled.slice(c * perCourt, (c + 1) * perCourt);
      const split = bestSplitForGroup(group, mode, opponentHist, partnerHist, matchHistory);
      score += split.score;
      layout.push({ courtId: courtIds[c], sideA: split.sideA, sideB: split.sideB });
    }
    if (score < bestScore) { bestScore = score; candidates = [layout]; }
    else if (score === bestScore) { candidates.push(layout); }
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// --- Guaranteed round-robin partner scheduling ------------------------------
// shuffleAssignCourts above picks the best layout for THIS round only. That's
// a greedy choice: avoiding a repeat now can back the schedule into a corner
// where every option left repeats something later, even when a genuinely
// repeat-free full rotation exists (confirmed by testing — real sessions
// were settling for ~24 of the 28 possible partner pairs for 8 players
// before a repeat, not the full 28). The only way to actually guarantee "no
// repeat until everyone's partnered with everyone" is to plan the whole
// rotation at once instead of one round at a time — the classic "circle
// method" used for round-robin tournament scheduling does exactly that.
//
// This only applies when every active player is always on a court — active
// count exactly fills every court, nobody ever sits — and only in individual
// mode, since that's the only case where "partner" is a meaningful, fixed
// per-round concept. A session with a bench rotates who's sitting every
// round for fairness, which a fixed pre-built rotation can't account for, so
// those fall back to the dynamic per-round logic above.

function roundRobinPartnerRounds(playerIds) {
  // Fixes the first player, rotates the rest around it. Produces n-1 rounds
  // of n/2 pairs; every one of the C(n,2) unique pairs appears in exactly
  // one round. Requires an even player count.
  const n = playerIds.length;
  if (n < 2 || n % 2 !== 0) return [];
  const fixed = playerIds[0];
  let rotating = playerIds.slice(1);
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const ring = [fixed, ...rotating];
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([ring[i], ring[n - 1 - i]]);
    rounds.push(pairs);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

// Only WHICH court a partner-pair plays on (and which pair it faces) is
// decided here — the partner pairing itself is already fixed and guaranteed
// repeat-free by the circle method above, so this step only affects
// secondary opponent variety. Grouping m pre-formed pairs onto courts grows
// combinatorially in m (a perfect-matching count), which turned out to matter:
// tested against a 20-player/5-court session, exhaustively searching every
// grouping for every round of the plan took 18+ seconds — long enough to hang
// a real reshuffle. So it's only run exhaustively up to PAIR_ASSIGNMENT_CAP;
// larger groups fall back to randomly sampling groupings and keeping the
// best found, same pattern as shuffleAssignCourts's own fallback.
const PAIR_ASSIGNMENT_CAP = 5000;

function estimatePairAssignmentSpace(pairCount) {
  let space = 1;
  let remaining = pairCount;
  while (remaining > 0 && space <= PAIR_ASSIGNMENT_CAP) {
    space *= (remaining * (remaining - 1)) / 2;
    remaining -= 2;
  }
  return space;
}

function assignPairsToCourts(courtIds, pairs, opponentHist, matchHistory) {
  function scorePairing(pairA, pairB) {
    let oppScore = 0;
    for (const x of pairA) for (const y of pairB) oppScore += opponentHist[pairKey(x, y)] || 0;
    const exactCount = (matchHistory && matchHistory[matchSig(pairA, pairB)]) || 0;
    return oppScore + exactCount * 3;
  }

  if (estimatePairAssignmentSpace(pairs.length) > PAIR_ASSIGNMENT_CAP) {
    const attempts = 60;
    let bestScore = Infinity;
    let candidates = [];
    for (let a = 0; a < attempts; a++) {
      const shuffled = [...pairs];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const layout = [];
      let score = 0;
      for (let c = 0; c < courtIds.length; c++) {
        const [pairA, pairB] = [shuffled[c * 2], shuffled[c * 2 + 1]];
        score += scorePairing(pairA, pairB);
        layout.push({ courtId: courtIds[c], sideA: pairA, sideB: pairB });
      }
      if (score < bestScore) { bestScore = score; candidates = [layout]; }
      else if (score === bestScore) { candidates.push(layout); }
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function assign(remainingCourts, remainingPairs) {
    if (remainingCourts.length === 0) return { layout: [], score: 0 };
    const [courtId, ...restCourts] = remainingCourts;
    let best = null;
    for (const combo of combinations(remainingPairs, 2)) {
      const [pairA, pairB] = combo;
      const restPairs = remainingPairs.filter((p) => p !== pairA && p !== pairB);
      const score = scorePairing(pairA, pairB);
      const sub = assign(restCourts, restPairs);
      const total = score + sub.score;
      if (!best || total < best.score || (total === best.score && Math.random() < 0.5)) {
        best = { score: total, layout: [{ courtId, sideA: pairA, sideB: pairB }, ...sub.layout] };
      }
    }
    return best;
  }
  return assign(courtIds, pairs).layout;
}

// Builds a complete no-repeat rotation for the current active roster. Rounds
// are ordered so that any pair already used (e.g. right after the rotation
// is rebuilt mid-session because a player joined or left) is deferred to the
// end — genuinely fresh pairings get used first, already-seen ones only once
// there's no better option. Returns null when the precondition (individual
// mode, active count exactly fills every court) doesn't hold.
function buildGuaranteedShufflePlan(playerIds, courtIds, opponentHist, partnerHist, matchHistory) {
  const n = playerIds.length;
  if (n === 0 || n !== courtIds.length * 4) return null;
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const rawRounds = roundRobinPartnerRounds(shuffled);
  if (rawRounds.length === 0) return null;
  const scoredRounds = rawRounds.map((pairs) => ({
    pairs,
    score: pairs.reduce((s, [a, b]) => s + (partnerHist[pairKey(a, b)] || 0), 0),
  }));
  scoredRounds.sort((a, b) => a.score - b.score || Math.random() - 0.5);
  const rounds = scoredRounds.map(({ pairs }) => assignPairsToCourts(courtIds, pairs, opponentHist, matchHistory));
  const playerSetKey = [...playerIds].sort().join(",") + "|" + courtIds.join(",");
  return { playerSetKey, rounds, index: 0 };
}

function fillAllEmptyCourts(courtsState, unitsIn, mode, opponentHist, partnerHist, matchHistory, preferredMatches) {
  const units = { ...unitsIn };
  const courts = courtsState.map((c) => ({ ...c }));
  // Snapshot who's eligible-and-waiting before this batch of assignments, so
  // we know afterward who got picked (streak resets) vs who was available
  // but skipped again (streak grows) — this is what lets "already missed
  // once" become its own hard priority tier for the *next* decision.
  const initialWaitingIds = computeWaitingIds(units);
  for (const court of courts) {
    if (court.match) continue;
    let result = null;
    const preferred = preferredMatches && preferredMatches[court.id];
    if (preferred && isPreferredValid(preferred, units)) {
      result = preferred;
    } else {
      const waitingIds = computeWaitingIds(units);
      result = pickBest(waitingIds, units, mode, opponentHist, partnerHist, matchHistory);
    }
    if (!result) continue;
    const { sideA, sideB } = result;
    [...sideA, ...sideB].forEach((id) => { units[id] = { ...units[id], onCourt: true }; });
    court.match = { sideA, sideB, startedAt: Date.now() };
  }
  initialWaitingIds.forEach((id) => {
    units[id] = { ...units[id], missStreak: units[id].onCourt ? 0 : (units[id].missStreak || 0) + 1 };
  });
  return { courts, units };
}

// A previously-committed "next match" preview is only safe to reuse as-is
// if every one of its players is still exactly where the preview assumed:
// active and not already claimed by another court in the meantime.
function isPreferredValid(preferred, unitsMap) {
  if (!preferred || !Array.isArray(preferred.sideA) || !Array.isArray(preferred.sideB)) return false;
  const ids = [...preferred.sideA, ...preferred.sideB];
  return ids.every((id) => unitsMap[id] && unitsMap[id].active && !unitsMap[id].onCourt);
}

// Predicts what would be scheduled next on a court if its current game ended
// right now, by running the exact same scheduling logic against a
// hypothetical "this game just finished" state. This is only meaningful
// (and only guaranteed accurate) when there's exactly one court, since with
// more than one court the outcome can depend on what happens on the others
// in between.
function computeNextPreview(state, court) {
  if (!court.match) return null;
  const { sideA, sideB } = court.match;
  const units = { ...state.units };
  const now = Date.now();
  [...sideA, ...sideB].forEach((id) => {
    units[id] = { ...units[id], gamesPlayed: units[id].gamesPlayed + 1, onCourt: false, lastPlayedAt: now, lastPlayedSeq: state.orderCounter };
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
  const waitingIds = computeWaitingIds(units);
  const result = pickBest(waitingIds, units, state.mode, opponentHist, partnerHist, matchHistory);
  if (!result) return null;

  // Who'd be sitting out for that predicted match, and whether that exact
  // matchup has already happened earlier this session (checked against
  // matchHistory as it stands once the CURRENT game finishes, i.e. before
  // the predicted one has actually been played).
  const nextPlayingIds = new Set([...result.sideA, ...result.sideB]);
  const sittingOut = Object.keys(units).filter((id) => !nextPlayingIds.has(id) && !units[id].onCourt);
  const repeat = (matchHistory[matchSig(result.sideA, result.sideB)] || 0) > 0;

  return { sideA: result.sideA, sideB: result.sideB, sittingOut, repeat };
}

// Recomputes and commits the "next match" preview for the sole court,
// whenever something that could change it just happened (a new game
// started, a lineup swap, a player added, someone benched/unbenched). The
// SAME committed object is what SUBMIT_SCORE will later hand to
// fillAllEmptyCourts as the preferred match, so as long as nothing
// invalidating happens between now and then, what gets shown is exactly
// what gets scheduled — not just a probable guess.
function withNextPreview(state) {
  if (state.phase !== "session" || state.courtsState.length !== 1) return state;
  const court = state.courtsState[0];
  if (!court.match) {
    if (!("nextPreview" in court) || court.nextPreview === undefined) return state;
    return { ...state, courtsState: [{ ...court, nextPreview: undefined }] };
  }
  const preview = computeNextPreview(state, court);
  return { ...state, courtsState: [{ ...court, nextPreview: preview || undefined }] };
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
  shuffleArmed: false,
  shufflePlan: null,
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
        units[s.id] = { id: s.id, name: s.name, gamesPlayed: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, active: true, onCourt: false, lastPlayedAt: 0, lastPlayedSeq: 0, missStreak: 0, order };
        order++;
      });
      const courtsState = Array.from({ length: state.courtCount }, (_, i) => ({ id: i, name: (state.courtNames && state.courtNames[i]) || `Court ${i + 1}`, match: null }));
      const filled = fillAllEmptyCourts(courtsState, units, state.mode, {}, {}, {});
      return withNextPreview({ ...state, phase: "session", units: filled.units, courtsState: filled.courts, opponentHist: {}, partnerHist: {}, matchHistory: {}, log: [], orderCounter: 0 });
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
      const endedAt = Date.now();

      sideA.forEach((id) => {
        const u = { ...units[id] };
        u.gamesPlayed += 1; u.pointsFor += scoreA; u.pointsAgainst += scoreB;
        if (aWon) u.wins += 1; else u.losses += 1;
        u.onCourt = false; u.lastPlayedAt = endedAt; u.lastPlayedSeq = order;
        units[id] = u;
      });
      sideB.forEach((id) => {
        const u = { ...units[id] };
        u.gamesPlayed += 1; u.pointsFor += scoreB; u.pointsAgainst += scoreA;
        if (!aWon) u.wins += 1; else u.losses += 1;
        u.onCourt = false; u.lastPlayedAt = endedAt; u.lastPlayedSeq = order;
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

      // Who was sitting out while this game was played: everyone not on
      // this court and not on another court right now (captured at the
      // moment this game ends, so it reflects any mid-game lineup swaps).
      const playingIds = new Set([...sideA, ...sideB]);
      const sittingOut = Object.keys(units).filter((id) => !playingIds.has(id) && !units[id].onCourt);

      const startedAt = court.match.startedAt || endedAt;
      const durationMs = Math.max(0, endedAt - startedAt);
      const logEntry = { id: rid("g"), courtId, sideA, sideB, scoreA, scoreB, ts: endedAt, startedAt, durationMs, sittingOut };
      let courtsState = state.courtsState.map((c) => (c.id === courtId ? { ...c, match: null } : c));

      if (state.shuffleArmed) {
        // Hold this court empty rather than refilling it right away. Once
        // every court is simultaneously empty, everyone becomes available
        // at once and we fill them all together from the full pool — that's
        // what actually breaks players out of their existing court "pods".
        // A court's startedAt only gets set the moment it's actually given
        // a new match (inside fillAllEmptyCourts), so nobody's next game
        // duration includes this waiting period.
        const anyStillPlaying = courtsState.some((c) => c.match);
        if (anyStillPlaying) {
          return withNextPreview({ ...state, units, courtsState, opponentHist, partnerHist, matchHistory, log: [...state.log, logEntry], orderCounter: order + 1 });
        }
        // Everyone is now simultaneously free. Decide who plays this round
        // fairly (games played, then real time since last played — treating
        // a court that finished a moment earlier as no more "overdue" than
        // one that just finished this instant, so a few seconds of
        // incidental timing doesn't quietly decide anything), then freely
        // shuffle whoever's playing across every court and pairing with no
        // further fairness constraint — that's what actually mixes people
        // instead of re-forming the same groups.
        const normalizedUnits = { ...units };
        Object.keys(normalizedUnits).forEach((id) => {
          const u = normalizedUnits[id];
          if (u.active && !u.onCourt) normalizedUnits[id] = { ...u, lastPlayedAt: 0, lastPlayedSeq: 0 };
        });
        const perCourt = state.mode === "fixed" ? 2 : 4;
        const totalRequired = courtsState.length * perCourt;
        const courtIdList = courtsState.map((c) => c.id);
        let newCourtsState = courtsState;
        let finalUnits = normalizedUnits;
        let shufflePlan = state.shufflePlan;

        // Guaranteed round-robin scheduling: only when every active player
        // is always on a court (nobody ever sits) in individual mode. Build
        // or reuse a full no-repeat rotation for the current roster instead
        // of picking one good round at a time.
        const activeIds = Object.values(normalizedUnits).filter((u) => u.active).map((u) => u.id);
        const noBench = state.mode === "individual" && activeIds.length === totalRequired && totalRequired > 0;
        if (noBench) {
          const key = [...activeIds].sort().join(",") + "|" + courtIdList.join(",");
          if (!shufflePlan || shufflePlan.playerSetKey !== key || shufflePlan.index >= shufflePlan.rounds.length) {
            shufflePlan = buildGuaranteedShufflePlan(activeIds, courtIdList, opponentHist, partnerHist, matchHistory);
          }
        } else {
          shufflePlan = null;
        }

        const layout = noBench && shufflePlan
          ? shufflePlan.rounds[shufflePlan.index]
          : (() => {
              const playingSet = determineShufflePlayingSet(normalizedUnits, totalRequired);
              return playingSet ? shuffleAssignCourts(courtIdList, playingSet, state.mode, opponentHist, partnerHist, matchHistory) : null;
            })();

        if (layout) {
          finalUnits = { ...normalizedUnits };
          layout.forEach((m) => {
            [...m.sideA, ...m.sideB].forEach((id) => { finalUnits[id] = { ...finalUnits[id], onCourt: true }; });
          });
          // Same miss-streak bookkeeping fillAllEmptyCourts does normally:
          // anyone eligible for this round who didn't end up on a court has
          // now missed again; anyone who's playing has their streak cleared.
          computeWaitingIds(units).forEach((id) => {
            finalUnits[id] = { ...finalUnits[id], missStreak: finalUnits[id].onCourt ? 0 : (finalUnits[id].missStreak || 0) + 1 };
          });
          const startedAt = Date.now();
          newCourtsState = courtsState.map((c) => {
            const m = layout.find((l) => l.courtId === c.id);
            return m ? { ...c, match: { sideA: m.sideA, sideB: m.sideB, startedAt } } : c;
          });
          if (noBench && shufflePlan) shufflePlan = { ...shufflePlan, index: shufflePlan.index + 1 };
        } else {
          // Not enough active players to fill every court at once — fall
          // back to filling whatever's possible with the normal logic.
          const filled = fillAllEmptyCourts(courtsState, normalizedUnits, state.mode, opponentHist, partnerHist, matchHistory);
          newCourtsState = filled.courts;
          finalUnits = filled.units;
        }
        // Stay armed by default: shuffle mode is now a standing preference
        // rather than a one-shot action, so a completed reshuffle re-arms
        // itself for the next round instead of silently turning off. It only
        // turns off when the user explicitly cancels it (CANCEL_SHUFFLE).
        return withNextPreview({ ...state, units: finalUnits, courtsState: newCourtsState, opponentHist, partnerHist, matchHistory, log: [...state.log, logEntry], orderCounter: order + 1, shuffleArmed: true, shufflePlan });
      }

      // If we already committed to a "next match" preview for this court and
      // nothing has invalidated it since, honor that exact match rather than
      // letting the scheduler pick independently — that's what makes the
      // preview a guarantee instead of a guess.
      const preferredMatches = court.nextPreview ? { [courtId]: court.nextPreview } : undefined;
      const filled = fillAllEmptyCourts(courtsState, units, state.mode, opponentHist, partnerHist, matchHistory, preferredMatches);

      return withNextPreview({ ...state, units: filled.units, courtsState: filled.courts, opponentHist, partnerHist, matchHistory, log: [...state.log, logEntry], orderCounter: order + 1 });
    }

    case "ARM_SHUFFLE": {
      if (state.phase !== "session" || state.courtsState.length < 2) return state;
      const allPlaying = state.courtsState.every((c) => c.match);
      if (!allPlaying) return state;
      return { ...state, shuffleArmed: true };
    }

    case "CANCEL_SHUFFLE": {
      if (!state.shuffleArmed) return state;
      // Anything already sitting empty while we were waiting needs to be
      // filled normally right away rather than left stranded.
      const filled = fillAllEmptyCourts(state.courtsState, state.units, state.mode, state.opponentHist, state.partnerHist, state.matchHistory);
      return withNextPreview({ ...state, shuffleArmed: false, shufflePlan: null, units: filled.units, courtsState: filled.courts });
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

      return withNextPreview({ ...state, units, opponentHist, partnerHist, matchHistory, courtsState, log: state.log.slice(0, -1) });
    }

    case "EDIT_SCORE": {
      // Corrects the score of an already-finished game WITHOUT touching the
      // schedule. Standings (wins/losses/points) are the only thing a score
      // feeds; pairing and sit-out order depend on games played, sit streaks,
      // last-played times and matchup history — none of which change here.
      // That is why this is preferred over "undo, then re-enter": undo rolls
      // back a game's stats but not the fairness bookkeeping, so re-entering
      // it could line up a different next game.
      const { gameId, scoreA, scoreB } = action;
      const isScore = (n) => typeof n === "number" && Number.isInteger(n) && n >= 0;
      if (!isScore(scoreA) || !isScore(scoreB) || scoreA === scoreB) return state;
      const idx = state.log.findIndex((e) => e.id === gameId);
      if (idx === -1) return state;
      const old = state.log[idx];
      if (old.scoreA === scoreA && old.scoreB === scoreB) return state;

      const wasAWin = old.scoreA > old.scoreB;
      const isAWin = scoreA > scoreB;
      const units = { ...state.units };
      const adjust = (ids, oldFor, oldAgainst, newFor, newAgainst, wasWin, isWin) => {
        ids.forEach((id) => {
          const u = units[id];
          if (!u) return; // unit removed since the game was played
          units[id] = {
            ...u,
            pointsFor: u.pointsFor - oldFor + newFor,
            pointsAgainst: u.pointsAgainst - oldAgainst + newAgainst,
            wins: u.wins - (wasWin ? 1 : 0) + (isWin ? 1 : 0),
            losses: u.losses - (wasWin ? 0 : 1) + (isWin ? 0 : 1),
          };
        });
      };
      adjust(old.sideA, old.scoreA, old.scoreB, scoreA, scoreB, wasAWin, isAWin);
      adjust(old.sideB, old.scoreB, old.scoreA, scoreB, scoreA, !wasAWin, !isAWin);

      const log = state.log.map((e, i) => (i === idx ? { ...e, scoreA, scoreB } : e));
      return { ...state, units, log };
    }

    case "TOGGLE_ACTIVE": {
      const u = state.units[action.id];
      if (!u || u.onCourt) return state;
      const units = { ...state.units, [action.id]: { ...u, active: !u.active } };
      if (state.shuffleArmed) return { ...state, units }; // don't disturb courts being held for the pending shuffle
      const filled = fillAllEmptyCourts(state.courtsState, units, state.mode, state.opponentHist, state.partnerHist, state.matchHistory);
      return withNextPreview({ ...state, units: filled.units, courtsState: filled.courts });
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
      units[outUnitId] = { ...units[outUnitId], onCourt: false, lastPlayedAt: Date.now(), lastPlayedSeq: state.orderCounter, missStreak: 0 };
      units[inUnitId] = { ...units[inUnitId], onCourt: true, missStreak: 0 };

      return withNextPreview({ ...state, courtsState, units, orderCounter: state.orderCounter + 1 });
    }

    case "ADD_UNIT_MIDSESSION": {
      const name = (action.name || "").trim();
      if (!name) return state;
      const vals = Object.values(state.units);
      const gp = vals.length ? Math.min(...vals.map((u) => u.gamesPlayed)) : 0;
      const id = rid(state.mode === "fixed" ? "t" : "p");
      const units = { ...state.units, [id]: { id, name, gamesPlayed: gp, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, active: true, onCourt: false, lastPlayedAt: Date.now(), lastPlayedSeq: state.orderCounter, missStreak: 0, order: state.orderCounter } };
      if (state.shuffleArmed) return { ...state, units, orderCounter: state.orderCounter + 1 }; // don't disturb courts being held for the pending shuffle
      const filled = fillAllEmptyCourts(state.courtsState, units, state.mode, state.opponentHist, state.partnerHist, state.matchHistory);
      return withNextPreview({ ...state, units: filled.units, courtsState: filled.courts, orderCounter: state.orderCounter + 1 });
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
      if (state.shuffleArmed) return { ...state, courtsState, courtCount: courtsState.length }; // don't disturb courts being held for the pending shuffle
      const filled = fillAllEmptyCourts(courtsState, state.units, state.mode, state.opponentHist, state.partnerHist, state.matchHistory);
      return withNextPreview({ ...state, courtsState: filled.courts, units: filled.units, courtCount: filled.courts.length });
    }

    default:
      return state;
  }
}
