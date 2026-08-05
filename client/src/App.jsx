import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Plus, X, Trophy, Users, ListOrdered, History, Minus, Play, RotateCcw, Undo2, Check, UserPlus, Coffee, Shuffle, Wifi, WifiOff, Download, ChevronDown, ChevronUp } from "lucide-react";

/* ---------------------------------------------------------------------- */
/* Pure display helpers (server owns the real scheduling logic; these are */
/* just used to render the state the server sends us)                     */
/* ---------------------------------------------------------------------- */

function computeWaitingIds(units) {
  return Object.values(units)
    .filter((u) => u.active && !u.onCourt)
    .sort((a, b) => a.gamesPlayed - b.gamesPlayed || a.lastFinishedOrder - b.lastFinishedOrder || a.order - b.order)
    .map((u) => u.id);
}
function unitName(units, id) { return units[id] ? units[id].name : "?"; }
function sideLabel(units, ids) { return ids.map((id) => unitName(units, id)).join(" & "); }

function standingsRows(state) {
  return Object.values(state.units).slice().sort((a, b) => {
    const aWinPct = a.gamesPlayed ? a.wins / a.gamesPlayed : 0;
    const bWinPct = b.gamesPlayed ? b.wins / b.gamesPlayed : 0;
    if (bWinPct !== aWinPct) return bWinPct - aWinPct;
    const aDiff = a.pointsFor - a.pointsAgainst, bDiff = b.pointsFor - b.pointsAgainst;
    if (bDiff !== aDiff) return bDiff - aDiff;
    return b.pointsFor - a.pointsFor;
  });
}

/* ---------------------------------------------------------------------- */
/* CSV export                                                              */
/* ---------------------------------------------------------------------- */

function csvEscape(val) {
  const s = String(val ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvLine(cells) { return cells.map(csvEscape).join(","); }

function buildSessionCSV(state, label) {
  const who = state.mode === "fixed" ? "Team" : "Player";
  const lines = [];
  lines.push(`Session results${label ? " - " + label : ""}`);
  lines.push(`Format,${state.mode === "fixed" ? "Fixed partners" : "Everyone for themselves"}`);
  lines.push("");
  lines.push("STANDINGS");
  lines.push(csvLine(["Rank", who, "Wins", "Losses", "Points For", "Points Against", "Diff"]));
  standingsRows(state).forEach((u, i) => {
    lines.push(csvLine([i + 1, u.name, u.wins, u.losses, u.pointsFor, u.pointsAgainst, u.pointsFor - u.pointsAgainst]));
  });
  lines.push("");
  lines.push("GAME LOG");
  lines.push(csvLine(["Game #", "Court", "Side A", "Score A", "Score B", "Side B", "Winner"]));
  state.log.forEach((e, i) => {
    const aWon = e.scoreA > e.scoreB;
    const aNames = sideLabel(state.units, e.sideA);
    const bNames = sideLabel(state.units, e.sideB);
    lines.push(csvLine([i + 1, e.courtId + 1, aNames, e.scoreA, e.scoreB, bNames, aWon ? aNames : bNames]));
  });
  return lines.join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportSession(state, label) {
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadText(`pickleball-results-${dateStr}.csv`, buildSessionCSV(state, label));
}

/* ---------------------------------------------------------------------- */
/* Socket connection hook                                                  */
/* ---------------------------------------------------------------------- */

function useServerState() {
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io({ path: "/socket.io" });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("state", (s) => setState(s));
    socket.on("history", (h) => setHistory(h));
    return () => socket.disconnect();
  }, []);

  const dispatch = (action) => {
    if (socketRef.current) socketRef.current.emit("action", action);
  };

  return { state, history, connected, dispatch };
}

/* ---------------------------------------------------------------------- */
/* App                                                                      */
/* ---------------------------------------------------------------------- */

export default function App() {
  const { state, history, connected, dispatch } = useServerState();

  return (
    <div className="pbr-app">
      <Styles />
      <ConnBadge connected={connected} />
      {!state ? (
        <div className="pbr-loading">Connecting to server…</div>
      ) : state.phase === "setup" ? (
        <SetupScreen state={state} history={history} dispatch={dispatch} />
      ) : (
        <SessionScreen state={state} history={history} dispatch={dispatch} />
      )}
    </div>
  );
}

function ConnBadge({ connected }) {
  return (
    <div className={"pbr-conn-badge" + (connected ? "" : " offline")} title={connected ? "Connected" : "Reconnecting…"}>
      {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
    </div>
  );
}

/* ------------------------------- Setup ---------------------------------- */

function SetupScreen({ state, history, dispatch }) {
  const [nameInput, setNameInput] = useState("");
  const [selectedForPair, setSelectedForPair] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  const pairedIds = new Set(state.teams.flatMap((t) => t.playerIds));
  const unpaired = state.players.filter((p) => !pairedIds.has(p.id));

  const addPlayer = () => { dispatch({ type: "ADD_PLAYER", name: nameInput }); setNameInput(""); };

  const clickChip = (id) => {
    if (selectedForPair === null) { setSelectedForPair(id); return; }
    if (selectedForPair === id) { setSelectedForPair(null); return; }
    dispatch({ type: "CREATE_TEAM", playerIds: [selectedForPair, id] });
    setSelectedForPair(null);
  };

  const readyCount = state.mode === "fixed" ? state.teams.length : state.players.length;
  const minNeeded = state.mode === "fixed" ? 2 : 4;
  const canStart = readyCount >= minNeeded;
  const maxSensibleCourts = Math.max(1, Math.floor(readyCount / 2));

  return (
    <div className="pbr-setup">
      <header className="pbr-header">
        <CourtMark />
        <div>
          <h1>Round Robin Setup</h1>
          <p className="pbr-sub">Add your players, pick a format, then hit the courts. Everyone on this network sees the same session.</p>
          {history.length > 0 && (
            <button className="pbr-link-btn" onClick={() => setShowHistory((v) => !v)}>
              <History size={13} /> {showHistory ? "Hide" : "View"} past sessions ({history.length})
              {showHistory ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </div>
      </header>

      {showHistory && (
        <section className="pbr-card">
          <h2><History size={18} /> Past sessions</h2>
          <HistoryList history={history} />
        </section>
      )}

      <section className="pbr-card">
        <h2><Users size={18} /> Players</h2>
        <div className="pbr-add-row">
          <input
            className="pbr-input"
            placeholder="Player name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addPlayer(); }}
          />
          <button className="pbr-btn pbr-btn-primary pbr-btn-icon" onClick={addPlayer} aria-label="Add player"><Plus size={20} /></button>
        </div>
        <div className="pbr-chip-row">
          {state.players.length === 0 && <p className="pbr-empty">No players yet — add a few names above.</p>}
          {state.players.map((p) => (
            <span key={p.id} className="pbr-chip">
              {p.name}
              <button className="pbr-chip-x" onClick={() => dispatch({ type: "REMOVE_PLAYER", id: p.id })} aria-label={`Remove ${p.name}`}><X size={13} /></button>
            </span>
          ))}
        </div>
      </section>

      <section className="pbr-card">
        <h2>Format</h2>
        <div className="pbr-segmented">
          <button className={"pbr-seg" + (state.mode === "individual" ? " active" : "")} onClick={() => dispatch({ type: "SET_MODE", mode: "individual" })}>Everyone for themselves</button>
          <button className={"pbr-seg" + (state.mode === "fixed" ? " active" : "")} onClick={() => dispatch({ type: "SET_MODE", mode: "fixed" })}>Fixed partners</button>
        </div>
        <p className="pbr-hint">
          {state.mode === "individual"
            ? "Partners and opponents rotate every game — the app spreads everyone out evenly."
            : "Teams stay together all session and rotate who they play against."}
        </p>
      </section>

      {state.mode === "fixed" && (
        <section className="pbr-card">
          <h2>Teams</h2>
          {unpaired.length > 0 && (
            <>
              <p className="pbr-hint">Tap two players to pair them up.</p>
              <div className="pbr-chip-row">
                {unpaired.map((p) => (
                  <button key={p.id} className={"pbr-chip pbr-chip-tap" + (selectedForPair === p.id ? " selected" : "")} onClick={() => clickChip(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
              {unpaired.length >= 2 && (
                <button className="pbr-btn pbr-btn-ghost pbr-btn-small" onClick={() => dispatch({ type: "AUTO_PAIR" })}><Shuffle size={14} /> Auto-pair randomly</button>
              )}
            </>
          )}
          {state.teams.length > 0 && (
            <div className="pbr-team-list">
              {state.teams.map((t) => (
                <div key={t.id} className="pbr-team-row">
                  <span>{t.name}</span>
                  <button className="pbr-chip-x" onClick={() => dispatch({ type: "BREAK_TEAM", id: t.id })} aria-label="Break up team"><X size={13} /></button>
                </div>
              ))}
            </div>
          )}
          {unpaired.length === 1 && <p className="pbr-hint">{unpaired[0].name} is unpaired and will sit out until teamed up.</p>}
        </section>
      )}

      {(state.mode === "individual" ? state.players.length : state.teams.length) >= 2 && (
        <section className="pbr-card">
          <h2>Play order</h2>
          <p className="pbr-hint">
            Top plays the first game; the bottom sits out first. Defaults to the order added — reorder if that's not
            right (e.g. move the last arrival to the bottom so they sit first).
          </p>
          <ol className="pbr-order-list">
            {(state.mode === "individual" ? state.players : state.teams).map((item, i, arr) => (
              <li key={item.id} className="pbr-order-row">
                <span className="pbr-order-pos">{i + 1}</span>
                <span className="pbr-order-name">{item.name}</span>
                <div className="pbr-order-controls">
                  <button
                    className="pbr-btn pbr-btn-ghost pbr-btn-icon pbr-btn-tiny"
                    disabled={i === 0}
                    onClick={() => dispatch({ type: state.mode === "fixed" ? "MOVE_TEAM" : "MOVE_PLAYER", id: item.id, direction: -1 })}
                    aria-label={`Move ${item.name} up`}
                  ><ChevronUp size={15} /></button>
                  <button
                    className="pbr-btn pbr-btn-ghost pbr-btn-icon pbr-btn-tiny"
                    disabled={i === arr.length - 1}
                    onClick={() => dispatch({ type: state.mode === "fixed" ? "MOVE_TEAM" : "MOVE_PLAYER", id: item.id, direction: 1 })}
                    aria-label={`Move ${item.name} down`}
                  ><ChevronDown size={15} /></button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="pbr-card">
        <h2>Courts available</h2>
        <div className="pbr-stepper">
          <button className="pbr-btn pbr-btn-icon pbr-btn-ghost" onClick={() => dispatch({ type: "SET_COURTS", count: state.courtCount - 1 })}><Minus size={18} /></button>
          <span className="pbr-stepper-val">{state.courtCount}</span>
          <button className="pbr-btn pbr-btn-icon pbr-btn-ghost" onClick={() => dispatch({ type: "SET_COURTS", count: state.courtCount + 1 })}><Plus size={18} /></button>
        </div>
        {state.courtCount > maxSensibleCourts && readyCount > 0 && (
          <p className="pbr-hint pbr-warn">With {readyCount} {state.mode === "fixed" ? "teams" : "players"} ready, only about {maxSensibleCourts} court{maxSensibleCourts !== 1 ? "s" : ""} will be filled at first.</p>
        )}
      </section>

      <button className="pbr-btn pbr-btn-primary pbr-btn-large" disabled={!canStart} onClick={() => dispatch({ type: "START_SESSION" })}>
        <Play size={18} /> Start session
      </button>
      {!canStart && <p className="pbr-hint pbr-center">{state.mode === "fixed" ? "Create at least 2 teams to start." : "Add at least 4 players to start."}</p>}
    </div>
  );
}

/* ------------------------------ Session ---------------------------------- */

function SessionScreen({ state, history, dispatch }) {
  const [tab, setTab] = useState("courts");

  return (
    <div className="pbr-session">
      <header className="pbr-session-header">
        <CourtMark small />
        <div className="pbr-session-title">
          <span className="pbr-eyebrow">{state.mode === "fixed" ? "Fixed partners" : "Everyone for themselves"}</span>
          <span className="pbr-round-count">Game {state.log.length + 1}</span>
        </div>
        <button className="pbr-icon-btn" title="Undo last score" disabled={state.log.length === 0} onClick={() => dispatch({ type: "UNDO_LAST" })}><Undo2 size={18} /></button>
      </header>

      <main className="pbr-session-body">
        {tab === "courts" && <CourtsTab state={state} dispatch={dispatch} />}
        {tab === "queue" && <QueueTab state={state} dispatch={dispatch} />}
        {tab === "standings" && <StandingsTab state={state} />}
        {tab === "log" && <LogTab state={state} history={history} dispatch={dispatch} />}
      </main>

      <nav className="pbr-tabbar">
        <TabBtn active={tab === "courts"} onClick={() => setTab("courts")} icon={<Trophy size={20} />} label="Courts" />
        <TabBtn active={tab === "queue"} onClick={() => setTab("queue")} icon={<ListOrdered size={20} />} label="Queue" />
        <TabBtn active={tab === "standings"} onClick={() => setTab("standings")} icon={<Users size={20} />} label="Standings" />
        <TabBtn active={tab === "log"} onClick={() => setTab("log")} icon={<History size={20} />} label="Log" />
      </nav>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }) {
  return (
    <button className={"pbr-tab" + (active ? " active" : "")} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function CourtsTab({ state, dispatch }) {
  const [drafts, setDrafts] = useState({});

  const getDraft = (id) => drafts[id] || { a: 0, b: 0 };
  const setDraft = (id, next) => setDrafts((d) => ({ ...d, [id]: next }));

  const submit = (courtId) => {
    const d = getDraft(courtId);
    dispatch({ type: "SUBMIT_SCORE", courtId, scoreA: d.a, scoreB: d.b });
    setDrafts((prev) => { const n = { ...prev }; delete n[courtId]; return n; });
  };

  const waitingCount = computeWaitingIds(state.units).length;

  return (
    <div className="pbr-courts-tab">
      {state.courtsState.map((court) => (
        <div key={court.id} className="pbr-court-card">
          <div className="pbr-court-label">Court {court.id + 1}</div>
          {!court.match ? (
            <div className="pbr-court-empty"><Coffee size={18} /> Waiting for players{waitingCount > 0 ? ` (${waitingCount} in queue)` : ""}</div>
          ) : (
            <CourtMatch court={court} state={state} draft={getDraft(court.id)} setDraft={(v) => setDraft(court.id, v)} onSubmit={() => submit(court.id)} />
          )}
        </div>
      ))}
    </div>
  );
}

function CourtMatch({ court, state, draft, setDraft, onSubmit }) {
  const { sideA, sideB } = court.match;
  const canSubmit = draft.a !== draft.b;
  return (
    <div className="pbr-match">
      <div className="pbr-court-svg-wrap"><CourtLines /></div>
      <div className="pbr-side pbr-side-a">
        <div className="pbr-side-names">{sideLabel(state.units, sideA)}</div>
        <ScoreStepper value={draft.a} onChange={(v) => setDraft({ ...draft, a: v })} accent="a" />
      </div>
      <div className="pbr-vs">vs</div>
      <div className="pbr-side pbr-side-b">
        <div className="pbr-side-names">{sideLabel(state.units, sideB)}</div>
        <ScoreStepper value={draft.b} onChange={(v) => setDraft({ ...draft, b: v })} accent="b" />
      </div>
      <button className="pbr-btn pbr-btn-primary pbr-btn-large pbr-submit-btn" disabled={!canSubmit} onClick={onSubmit}>
        <Check size={18} /> Submit score
      </button>
    </div>
  );
}

function ScoreStepper({ value, onChange, accent }) {
  return (
    <div className={"pbr-stepper pbr-score-stepper accent-" + accent}>
      <button className="pbr-btn pbr-btn-icon pbr-btn-ghost pbr-btn-trophy" onClick={() => onChange(11)} aria-label="Set score to 11" title="Set to 11"><Trophy size={16} /></button>
      <button className="pbr-btn pbr-btn-icon pbr-btn-ghost" onClick={() => onChange(Math.max(0, value - 1))}><Minus size={18} /></button>
      <span className="pbr-score-val">{value}</span>
      <button className="pbr-btn pbr-btn-icon pbr-btn-ghost" onClick={() => onChange(value + 1)}><Plus size={18} /></button>
    </div>
  );
}

function QueueTab({ state, dispatch }) {
  const [nameInput, setNameInput] = useState("");
  const waitingIds = computeWaitingIds(state.units);
  const benched = Object.values(state.units).filter((u) => !u.active);
  const onCourt = Object.values(state.units).filter((u) => u.onCourt);

  const addMid = () => { dispatch({ type: "ADD_UNIT_MIDSESSION", name: nameInput }); setNameInput(""); };

  return (
    <div className="pbr-queue-tab">
      <section className="pbr-card">
        <h2>Up next</h2>
        {waitingIds.length === 0 && <p className="pbr-empty">Everyone is on a court.</p>}
        <ol className="pbr-queue-list">
          {waitingIds.map((id, i) => (
            <li key={id} className="pbr-queue-row">
              <span className="pbr-queue-pos">{i + 1}</span>
              <span className="pbr-queue-name">{state.units[id].name}</span>
              <span className="pbr-queue-games">{state.units[id].gamesPlayed} played</span>
              <button className="pbr-btn pbr-btn-ghost pbr-btn-small" onClick={() => dispatch({ type: "TOGGLE_ACTIVE", id })}>Sit out</button>
            </li>
          ))}
        </ol>
      </section>

      {onCourt.length > 0 && (
        <section className="pbr-card">
          <h2>Currently playing</h2>
          <div className="pbr-chip-row">
            {onCourt.map((u) => <span key={u.id} className="pbr-chip pbr-chip-playing">{u.name}</span>)}
          </div>
        </section>
      )}

      {benched.length > 0 && (
        <section className="pbr-card">
          <h2>Sitting out</h2>
          <div className="pbr-chip-row">
            {benched.map((u) => (
              <span key={u.id} className="pbr-chip">
                {u.name}
                <button className="pbr-chip-x" onClick={() => dispatch({ type: "TOGGLE_ACTIVE", id: u.id })} aria-label="Bring back"><Plus size={13} /></button>
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="pbr-card">
        <h2><UserPlus size={18} /> Add {state.mode === "fixed" ? "a team" : "a player"} mid-session</h2>
        <div className="pbr-add-row">
          <input className="pbr-input" placeholder={state.mode === "fixed" ? "Team name" : "Player name"} value={nameInput} onChange={(e) => setNameInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addMid(); }} />
          <button className="pbr-btn pbr-btn-primary pbr-btn-icon" onClick={addMid} aria-label="Add"><Plus size={20} /></button>
        </div>
      </section>
    </div>
  );
}

function StandingsTab({ state }) {
  const rows = standingsRows(state);

  return (
    <div className="pbr-standings-tab">
      <section className="pbr-card pbr-card-flush">
        <table className="pbr-table">
          <thead>
            <tr><th>#</th><th>{state.mode === "fixed" ? "Team" : "Player"}</th><th>W</th><th>L</th><th>PF</th><th>PA</th><th>Diff</th></tr>
          </thead>
          <tbody>
            {rows.map((u, i) => (
              <tr key={u.id} className={!u.active ? "pbr-row-inactive" : ""}>
                <td>{i + 1}</td>
                <td>{u.name}</td>
                <td>{u.wins}</td>
                <td>{u.losses}</td>
                <td>{u.pointsFor}</td>
                <td>{u.pointsAgainst}</td>
                <td className={u.pointsFor - u.pointsAgainst > 0 ? "pbr-pos" : u.pointsFor - u.pointsAgainst < 0 ? "pbr-neg" : ""}>{u.pointsFor - u.pointsAgainst > 0 ? "+" : ""}{u.pointsFor - u.pointsAgainst}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="pbr-empty">No games yet.</p>}
      </section>
    </div>
  );
}

function LogTab({ state, history, dispatch }) {
  const entries = [...state.log].reverse();

  return (
    <div className="pbr-log-tab">
      <section className="pbr-card">
        <div className="pbr-log-header-row">
          <h2>Game log</h2>
          <div className="pbr-log-header-actions">
            <button className="pbr-btn pbr-btn-ghost pbr-btn-small" disabled={state.log.length === 0} onClick={() => exportSession(state)}><Download size={14} /> Export CSV</button>
            <button className="pbr-btn pbr-btn-ghost pbr-btn-small" disabled={state.log.length === 0} onClick={() => dispatch({ type: "UNDO_LAST" })}><Undo2 size={14} /> Undo last</button>
          </div>
        </div>
        {entries.length === 0 && <p className="pbr-empty">No games logged yet.</p>}
        <ul className="pbr-log-list">
          {entries.map((e) => {
            const aWon = e.scoreA > e.scoreB;
            return (
              <li key={e.id} className="pbr-log-row">
                <span className="pbr-log-court">Court {e.courtId + 1}</span>
                <span className={"pbr-log-side" + (aWon ? " won" : "")}>{sideLabel(state.units, e.sideA)}</span>
                <span className="pbr-log-score">{e.scoreA} – {e.scoreB}</span>
                <span className={"pbr-log-side" + (!aWon ? " won" : "")}>{sideLabel(state.units, e.sideB)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <button className="pbr-btn pbr-btn-ghost pbr-btn-danger" onClick={() => { if (confirm("End this session for everyone and start a new one?")) dispatch({ type: "NEW_SESSION" }); }}>
        <RotateCcw size={15} /> End session &amp; start over
      </button>

      {history.length > 0 && (
        <section className="pbr-card">
          <h2>Past sessions</h2>
          <HistoryList history={history} />
        </section>
      )}
    </div>
  );
}

function HistoryList({ history }) {
  const [openId, setOpenId] = useState(null);

  return (
    <ul className="pbr-history-list">
      {history.map((h) => {
        const dt = new Date(h.endedAt);
        const rows = standingsRows(h.state);
        const top = rows[0];
        const open = openId === h.id;
        return (
          <li key={h.id} className="pbr-history-item">
            <button className="pbr-history-row" onClick={() => setOpenId(open ? null : h.id)}>
              <span className="pbr-history-main">
                <span>{dt.toLocaleDateString()} · {h.state.log.length} game{h.state.log.length !== 1 ? "s" : ""} · {h.mode === "fixed" ? "Fixed partners" : "Everyone for themselves"}</span>
                {top && <span className="pbr-history-winner">🏆 {top.name}</span>}
              </span>
              {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {open && (
              <div className="pbr-history-detail">
                <table className="pbr-table">
                  <thead>
                    <tr><th>#</th><th>{h.mode === "fixed" ? "Team" : "Player"}</th><th>W</th><th>L</th><th>Diff</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((u, i) => (
                      <tr key={u.id}>
                        <td>{i + 1}</td>
                        <td>{u.name}</td>
                        <td>{u.wins}</td>
                        <td>{u.losses}</td>
                        <td className={u.pointsFor - u.pointsAgainst > 0 ? "pbr-pos" : u.pointsFor - u.pointsAgainst < 0 ? "pbr-neg" : ""}>{u.pointsFor - u.pointsAgainst > 0 ? "+" : ""}{u.pointsFor - u.pointsAgainst}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="pbr-btn pbr-btn-ghost pbr-btn-small" onClick={() => exportSession(h.state, dt.toLocaleDateString())}><Download size={14} /> Export CSV</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------- bits ------------------------------------ */

function CourtMark({ small }) {
  const size = small ? 30 : 40;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect x="2" y="2" width="36" height="36" rx="4" fill="var(--green)" />
      <line x1="20" y1="2" x2="20" y2="38" stroke="var(--chalk)" strokeWidth="1.5" />
      <line x1="2" y1="20" x2="38" y2="20" stroke="var(--chalk)" strokeWidth="1.5" />
      <rect x="9" y="2" width="22" height="9" fill="none" stroke="var(--chalk)" strokeWidth="1.2" opacity="0.6" />
      <rect x="9" y="29" width="22" height="9" fill="none" stroke="var(--chalk)" strokeWidth="1.2" opacity="0.6" />
      <circle cx="20" cy="20" r="3.2" fill="var(--yellow)" />
    </svg>
  );
}

function CourtLines() {
  return (
    <svg viewBox="0 0 300 40" preserveAspectRatio="none" className="pbr-court-lines-svg">
      <line x1="0" y1="20" x2="300" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <line x1="150" y1="2" x2="150" y2="38" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <line x1="105" y1="2" x2="105" y2="38" stroke="currentColor" strokeWidth="1" opacity="0.2" />
      <line x1="195" y1="2" x2="195" y2="38" stroke="currentColor" strokeWidth="1" opacity="0.2" />
    </svg>
  );
}

/* -------------------------------- styles ---------------------------------- */

function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700;900&family=Inter:wght@400;500;600;700&display=swap');

      * { box-sizing: border-box; }
      html, body, #root { height: 100%; }

      .pbr-app {
        --navy: #14213A;
        --navy-2: #1C2E4C;
        --navy-3: #24395C;
        --green: #2FA37A;
        --green-dim: #1F7A5C;
        --yellow: #F5C242;
        --coral: #E8654F;
        --chalk: #F6F4EC;
        --chalk-dim: #A9B6C7;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        background: var(--navy);
        color: var(--chalk);
        min-height: 100vh;
        max-width: 520px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        position: relative;
      }
      .pbr-loading { padding: 60px 20px; text-align: center; color: var(--chalk-dim); }

      .pbr-conn-badge { position: fixed; top: 10px; right: 10px; z-index: 50; background: var(--navy-2); color: var(--green); border-radius: 999px; padding: 6px; display: flex; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
      .pbr-conn-badge.offline { color: var(--coral); }

      h1, h2 { font-family: 'Space Grotesk', 'Inter', sans-serif; margin: 0; }
      h1 { font-size: 22px; font-weight: 700; }
      h2 { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--chalk-dim); display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }

      .pbr-header { display: flex; align-items: center; gap: 14px; padding: 20px 18px 6px; }
      .pbr-sub { margin: 4px 0 0; color: var(--chalk-dim); font-size: 13px; }
      .pbr-link-btn { display: inline-flex; align-items: center; gap: 5px; background: none; border: none; color: var(--yellow); font-family: inherit; font-size: 12.5px; font-weight: 600; padding: 8px 0 0; cursor: pointer; }

      .pbr-setup { display: flex; flex-direction: column; gap: 14px; padding: 0 16px 32px; }

      .pbr-card { background: var(--navy-2); border-radius: 14px; padding: 16px; }
      .pbr-card-flush { padding: 0; overflow: hidden; }

      .pbr-add-row { display: flex; gap: 8px; margin-bottom: 10px; }
      .pbr-input { flex: 1; background: var(--navy); border: 1px solid var(--navy-3); color: var(--chalk); border-radius: 10px; padding: 12px 14px; font-size: 15px; font-family: inherit; }
      .pbr-input:focus { outline: 2px solid var(--yellow); outline-offset: 1px; }

      .pbr-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .pbr-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--navy-3); color: var(--chalk); border: none; border-radius: 999px; padding: 8px 12px; font-size: 14px; font-family: inherit; }
      .pbr-chip-tap { cursor: pointer; }
      .pbr-chip-tap.selected { background: var(--yellow); color: var(--navy); font-weight: 600; }
      .pbr-chip-playing { background: var(--green-dim); }
      .pbr-chip-x { background: none; border: none; color: inherit; opacity: 0.6; display: flex; padding: 0; cursor: pointer; }
      .pbr-chip-x:hover { opacity: 1; }
      .pbr-empty { color: var(--chalk-dim); font-size: 13px; margin: 4px 0; }

      .pbr-segmented { display: flex; background: var(--navy); border-radius: 10px; padding: 4px; gap: 4px; }
      .pbr-seg { flex: 1; border: none; background: transparent; color: var(--chalk-dim); padding: 10px 8px; border-radius: 8px; font-size: 13px; font-weight: 600; font-family: inherit; cursor: pointer; }
      .pbr-seg.active { background: var(--green); color: var(--navy); }
      .pbr-hint { font-size: 12.5px; color: var(--chalk-dim); margin: 8px 0 0; line-height: 1.5; }
      .pbr-warn { color: var(--yellow); }
      .pbr-center { text-align: center; }

      .pbr-team-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
      .pbr-team-row { display: flex; justify-content: space-between; align-items: center; background: var(--navy-3); border-radius: 10px; padding: 10px 12px; font-size: 14px; }

      .pbr-order-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .pbr-order-row { display: flex; align-items: center; gap: 10px; background: var(--navy-3); border-radius: 10px; padding: 7px 8px 7px 12px; }
      .pbr-order-pos { font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: var(--chalk-dim); width: 18px; font-size: 13px; }
      .pbr-order-name { flex: 1; font-size: 14px; font-weight: 600; }
      .pbr-order-controls { display: flex; gap: 4px; }
      .pbr-btn-tiny { padding: 6px; }

      .pbr-stepper { display: flex; align-items: center; gap: 14px; }
      .pbr-stepper-val { font-family: 'Space Grotesk', sans-serif; font-size: 20px; font-weight: 700; min-width: 24px; text-align: center; }

      .pbr-btn { border: none; border-radius: 10px; font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 11px 16px; transition: transform 0.05s ease; }
      .pbr-btn:active { transform: scale(0.97); }
      .pbr-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .pbr-btn-primary { background: var(--yellow); color: var(--navy); }
      .pbr-btn-ghost { background: var(--navy-3); color: var(--chalk); }
      .pbr-btn-danger { color: var(--coral); background: transparent; }
      .pbr-btn-icon { padding: 10px; }
      .pbr-btn-small { padding: 7px 12px; font-size: 12.5px; margin-top: 8px; }
      .pbr-btn-large { width: 100%; padding: 15px; font-size: 15px; }

      .pbr-session { display: flex; flex-direction: column; min-height: 100vh; }
      .pbr-session-header { display: flex; align-items: center; gap: 12px; padding: 16px; border-bottom: 1px solid var(--navy-3); }
      .pbr-session-title { flex: 1; display: flex; flex-direction: column; }
      .pbr-eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--chalk-dim); }
      .pbr-round-count { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 16px; }
      .pbr-icon-btn { background: var(--navy-3); border: none; color: var(--chalk); border-radius: 10px; padding: 9px; display: flex; cursor: pointer; }
      .pbr-icon-btn:disabled { opacity: 0.3; }

      .pbr-session-body { flex: 1; padding: 16px 16px 90px; display: flex; flex-direction: column; gap: 14px; }

      .pbr-courts-tab { display: flex; flex-direction: column; gap: 14px; }
      .pbr-court-card { background: var(--navy-2); border-radius: 16px; padding: 16px; }
      .pbr-court-label { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--chalk-dim); margin-bottom: 10px; }
      .pbr-court-empty { display: flex; align-items: center; gap: 8px; color: var(--chalk-dim); font-size: 13.5px; padding: 18px 4px; }

      .pbr-match { position: relative; }
      .pbr-court-svg-wrap { position: absolute; inset: 0; opacity: 0.5; pointer-events: none; color: var(--chalk-dim); }
      .pbr-court-lines-svg { width: 100%; height: 100%; }
      .pbr-side { position: relative; display: flex; justify-content: space-between; align-items: center; padding: 10px 4px; }
      .pbr-side-a { border-left: 3px solid var(--green); padding-left: 12px; }
      .pbr-side-b { border-left: 3px solid var(--coral); padding-left: 12px; }
      .pbr-side-names { font-size: 15px; font-weight: 600; }
      .pbr-vs { text-align: center; font-size: 11px; color: var(--chalk-dim); text-transform: uppercase; letter-spacing: 0.08em; margin: 2px 0; }
      .pbr-score-stepper .pbr-score-val { font-family: 'Space Grotesk', sans-serif; font-weight: 900; font-size: 26px; min-width: 34px; text-align: center; font-variant-numeric: tabular-nums; }
      .pbr-btn-trophy { color: var(--yellow); margin-right: 2px; }
      .pbr-btn-trophy:hover { background: var(--navy); }
      .accent-a .pbr-score-val { color: var(--green); }
      .accent-b .pbr-score-val { color: var(--coral); }
      .pbr-submit-btn { margin-top: 14px; }

      .pbr-queue-tab, .pbr-standings-tab, .pbr-log-tab { display: flex; flex-direction: column; gap: 14px; }
      .pbr-queue-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .pbr-queue-row { display: flex; align-items: center; gap: 10px; background: var(--navy-3); border-radius: 10px; padding: 9px 12px; font-size: 13.5px; }
      .pbr-queue-pos { font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: var(--chalk-dim); width: 18px; }
      .pbr-queue-name { flex: 1; font-weight: 600; }
      .pbr-queue-games { color: var(--chalk-dim); font-size: 12px; }

      .pbr-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
      .pbr-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--chalk-dim); padding: 12px 10px; border-bottom: 1px solid var(--navy-3); }
      .pbr-table td { padding: 10px 10px; border-bottom: 1px solid var(--navy); }
      .pbr-table tr:last-child td { border-bottom: none; }
      .pbr-row-inactive { opacity: 0.45; }
      .pbr-pos { color: var(--green); font-weight: 700; }
      .pbr-neg { color: var(--coral); font-weight: 700; }

      .pbr-log-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; gap: 8px; }
      .pbr-log-header-row h2 { margin-bottom: 0; }
      .pbr-log-header-actions { display: flex; gap: 6px; }
      .pbr-log-header-actions .pbr-btn-small { margin-top: 0; }
      .pbr-log-list { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
      .pbr-log-row { display: grid; grid-template-columns: auto 1fr auto 1fr; align-items: center; gap: 8px; background: var(--navy-3); border-radius: 10px; padding: 9px 11px; font-size: 12.5px; }
      .pbr-log-court { color: var(--chalk-dim); font-size: 11px; }
      .pbr-log-side { text-align: right; }
      .pbr-log-side.won { color: var(--yellow); font-weight: 700; }
      .pbr-log-side:nth-child(2) { text-align: left; }
      .pbr-log-score { font-family: 'Space Grotesk', sans-serif; font-weight: 700; text-align: center; }

      .pbr-history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .pbr-history-item { background: var(--navy-3); border-radius: 10px; overflow: hidden; }
      .pbr-history-row { width: 100%; display: flex; justify-content: space-between; align-items: center; background: none; border: none; color: var(--chalk); padding: 10px 12px; font-size: 12.5px; font-family: inherit; cursor: pointer; text-align: left; }
      .pbr-history-main { display: flex; flex-direction: column; gap: 3px; color: var(--chalk-dim); }
      .pbr-history-winner { color: var(--yellow); font-weight: 600; }
      .pbr-history-detail { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 10px; }
      .pbr-history-detail .pbr-table { background: var(--navy); border-radius: 8px; overflow: hidden; }
      .pbr-history-detail .pbr-table th, .pbr-history-detail .pbr-table td { padding: 7px 9px; }

      .pbr-tabbar { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 520px; display: flex; background: var(--navy-2); border-top: 1px solid var(--navy-3); padding: 6px 4px calc(6px + env(safe-area-inset-bottom)); }
      .pbr-tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: none; color: var(--chalk-dim); font-family: inherit; font-size: 10.5px; font-weight: 600; padding: 8px 4px; cursor: pointer; border-radius: 10px; }
      .pbr-tab.active { color: var(--yellow); }

      @media (max-width: 380px) {
        .pbr-side-names { font-size: 13.5px; }
        .pbr-score-stepper .pbr-score-val { font-size: 22px; }
      }
    `}</style>
  );
}
