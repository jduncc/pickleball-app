import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Styles } from "./PickleballApp.jsx";
import Footer from "./Footer.jsx";
import { RELEASES } from "./changelog.js";
import "./help.css";

// In-app user manual (/help) and version history (/help/history).
//
// When a feature changes, update the matching section below and add an entry
// to changelog.js. Screenshots live in client/public/manual-img and are
// regenerated with docs/make-screenshots.mjs — see CLAUDE.md.

function Fig({ name, alt, caption }) {
  return (
    <figure className="pbr-help-fig">
      <img src={`/manual-img/${name}.png`} alt={alt} loading="lazy" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

const SECTIONS = [
  ["signin", "Signing in"],
  ["sessions", "My sessions"],
  ["setup", "Setting up a session"],
  ["courts", "Running the games"],
  ["queue", "The queue"],
  ["standings", "Standings"],
  ["log", "Game log and fixing scores"],
  ["share", "Sharing with players"],
  ["end", "Ending a session"],
  ["admin", "Admin"],
  ["faq", "Quick answers"],
];

function Manual() {
  return (
    <>
      <section className="pbr-card">
        <h2>Welcome</h2>
        <p>
          Pickleball Round Robin keeps a group of friends rotating fairly through the courts. You add the players,
          the app decides who plays whom and who sits, and everyone can follow along live from their own phone.
        </p>
        <ul className="pbr-help-toc">
          {SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}
        </ul>
      </section>

      <section className="pbr-card" id="signin">
        <h2>Signing in</h2>
        <p>
          Tap <strong>Sign in with Google</strong>. Access is by invitation: only Google accounts the admin has added can
          sign in. If you see a message that your account isn't on the list, ask the admin to add your email address.
        </p>
        <p>
          <strong>Players don't need an account.</strong> They just open the share link you send them (see{" "}
          <a href="#share">Sharing with players</a>).
        </p>
        <div className="pbr-help-note">
          <strong>On an iPhone:</strong> open the app in Safari, tap the Share button, then{" "}
          <strong>Add to Home Screen</strong>. It then opens full screen like any other app.
        </div>
        <Fig name="signin" alt="The sign-in page" caption="The sign-in page" />
      </section>

      <section className="pbr-card" id="sessions">
        <h2>My sessions</h2>
        <p>
          After signing in you land on <strong>My sessions</strong>. Tap <strong>New session</strong> to start one. You'll be
          asked for an optional name; if you leave it alone it's called <strong>RR</strong> followed by today's date, like
          RR 10/7/2026.
        </p>
        <ul>
          <li><strong>Active</strong> sessions are marked <strong>Live</strong>. Tap one to carry on where you left off, or tap <strong>Copy share link</strong> to send it to players.</li>
          <li><strong>Past sessions</strong> are marked <strong>Ended</strong> and show the session name followed by the winner, like "RR 10/4/2026 - Alex". Tap one to look back at its standings and game log.</li>
          <li>Use <strong>Sign out</strong> at the bottom when you're done on a shared device.</li>
        </ul>
        <Fig name="dashboard" alt="My sessions list with one live and two ended sessions" caption="My sessions" />
      </section>

      <section className="pbr-card" id="setup">
        <h2>Setting up a session</h2>
        <p>A new session starts on the setup screen. Work down the page, then tap <strong>Start session</strong>.</p>
        <ol>
          <li><strong>Players.</strong> Type a name and tap <strong>+</strong> (or press Enter). Tap the <strong>×</strong> on a name to remove it.</li>
          <li>
            <strong>Format.</strong> <em>Everyone for themselves</em> rotates partners and opponents every game, spreading
            everyone out evenly. <em>Fixed partners</em> keeps teams together all session while they rotate opponents.
          </li>
          <li>
            <strong>Teams</strong> (fixed partners only). Tap two players to pair them, or tap <strong>Auto-pair randomly</strong>.
            Tap the <strong>×</strong> on a team to break it up. Anyone left unpaired sits out until they have a partner.
          </li>
          <li>
            <strong>Play order.</strong> The top of the list plays the first game and the bottom sits out first. It starts in
            the order you added people. Use the arrows to reorder (move a late arriver to the bottom so they sit first) or
            tap <strong>Randomize</strong> to shuffle.
          </li>
          <li>
            <strong>Courts available.</strong> Use <strong>−</strong> and <strong>+</strong> to set how many courts you have.
            With more than one court you can type each court's real name (Court 7, Court 8...).
          </li>
        </ol>
        <p className="dim">You need at least 4 players, or 2 teams in fixed-partner mode, before the Start button works.</p>
        <div className="pbr-help-figs">
          <Fig name="setup-players" alt="Setup screen with six players added" caption="Players and format" />
          <Fig name="setup-teams" alt="Setup screen in fixed partners mode with two teams" caption="Fixed partners: pairing teams" />
          <Fig name="setup-courts" alt="Play order list and courts available" caption="Play order and courts" />
        </div>
      </section>

      <section className="pbr-card" id="courts">
        <h2>Running the games</h2>
        <p>
          The <strong>Courts</strong> tab shows each court's current game. A banner at the top lists who is
          <strong> sitting out</strong>, and the card at the bottom of each court shows <strong>Next up</strong>, so players
          know who is coming on.
        </p>
        <h3 className="pbr-help-h3">Entering a score</h3>
        <ul>
          <li>Tap <strong>+</strong> and <strong>−</strong> to set each side's points. The <strong>trophy</strong> button jumps straight to 11.</li>
          <li>Tap <strong>Submit score</strong>. It stays greyed out until the two scores are different.</li>
          <li>The next game starts right away, and the standings and log update for everyone watching.</li>
        </ul>
        <Fig name="courts" alt="A court with a score of 11 to 7 ready to submit" caption="Entering a score" />

        <h3 className="pbr-help-h3">When someone needs to sit out</h3>
        <p>
          Tap that player's name on the court. The app asks you to confirm, then swaps in whoever is next in line. For a
          different swap, tap <strong>Edit lineup</strong>, choose the replacement in the drop-downs, and tap <strong>Done</strong>.
        </p>
        <Fig name="courts-edit-lineup" alt="Edit lineup mode with drop-downs for each player" caption="Edit lineup" />

        <h3 className="pbr-help-h3">Adding a court during a session</h3>
        <p>
          Forgot a court, or more people showed up? The host sees a <strong>Courts</strong> counter at the top of the Courts
          tab. Tap <strong>+</strong> and a new court opens right away with the players who have waited longest. The{" "}
          <strong>+</strong> greys out when there aren't enough players to fill another court. A court can only be removed
          while it has no game on it. If a shuffle is waiting (see below), the new court starts once the shuffle is applied
          or cancelled.
        </p>

        <h3 className="pbr-help-h3">More than one court</h3>
        <p>
          With two or more courts, the same groups can end up playing together all night. Tap <strong>Shuffle courts</strong> to
          fix that. It waits for every court to finish its current game, then reshuffles everyone across all the courts.
          Tap <strong>Cancel</strong> if you change your mind.
        </p>
        <Fig name="multi-court" alt="Two courts with the shuffle courts banner" caption="Two courts" />

        <h3 className="pbr-help-h3">Undo</h3>
        <p>
          The arrow button at the top right (and <strong>Undo last</strong> on the Log tab) takes back the last submitted score.
          Use it when the wrong players were on court. To fix a mistyped score, use <strong>Edit score</strong> instead
          (see <a href="#log">Game log</a>).
        </p>
        <div className="pbr-help-note">
          Undo puts that game back on the court, but the app may then choose a different next matchup than the one it had
          lined up before. Edit score never does this.
        </div>
      </section>

      <section className="pbr-card" id="queue">
        <h2>The queue</h2>
        <p>The <strong>Queue</strong> tab (host only) manages who is waiting and who is playing.</p>
        <ul>
          <li><strong>Up next</strong> lists everyone waiting, in the order they'll play, with how many games each has played. Tap <strong>Sit out</strong> next to a name to rest someone (for example, a tired player or someone who has to leave).</li>
          <li><strong>Sitting out</strong> shows people you've rested. Tap <strong>+</strong> on a name to bring them back into the rotation.</li>
          <li><strong>Add a player mid-session</strong> adds a late arrival. They're counted as having played as many games as whoever has played the fewest so far, so they join the rotation without a pile of catch-up games.</li>
        </ul>
        <Fig name="queue" alt="The queue tab showing who is up next" caption="The Queue tab" />
      </section>

      <section className="pbr-card" id="standings">
        <h2>Standings</h2>
        <p>
          Everyone is ranked by win percentage, then point difference, then points scored. The columns are games played
          (GP), wins (W), losses (L), points for (PF), points against (PA) and point difference (Diff).
        </p>
        <Fig name="standings" alt="The standings table" caption="Standings" />
      </section>

      <section className="pbr-card" id="log">
        <h2>Game log and fixing scores</h2>
        <p>
          The <strong>Log</strong> tab lists every finished game, newest first, with the winners highlighted. At the top you can
          export the session as a <strong>CSV</strong> (for spreadsheets) or a <strong>PDF</strong> (for sharing or printing). Both
          include the session name.
        </p>
        <h3 className="pbr-help-h3">Fixing a wrong score</h3>
        <ol>
          <li>Tap the <strong>pencil</strong> at the right of the game.</li>
          <li>Type the correct scores. They can't be tied.</li>
          <li>Tap <strong>Save</strong> (or <strong>Cancel</strong> to leave it as it was).</li>
        </ol>
        <p>
          Wins, losses and points update everywhere. <strong>Who plays next doesn't change.</strong> Only the host can edit
          scores, and only while the session is still active.
        </p>
        <div className="pbr-help-figs">
          <Fig name="log" alt="The game log with a pencil beside each game" caption="The game log" />
          <Fig name="log-edit" alt="Editing the score of a finished game" caption="Editing a score" />
        </div>
      </section>

      <section className="pbr-card" id="share">
        <h2>Sharing with players</h2>
        <p>
          Every session has its own <strong>share link</strong>. Tap the banner at the top of your session, or
          <strong> Copy share link</strong> on My sessions, then paste it into your group chat.
        </p>
        <ul>
          <li>Anyone with the link can watch live and <strong>submit scores</strong>, with no sign-in.</li>
          <li>They can't change players, lineups, courts, or end the session. Those controls are only on the host's screen.</li>
          <li>After you end the session the link keeps working, but read-only.</li>
        </ul>
        <div className="pbr-help-note">
          Because anyone with the link can enter scores, only share it with the people playing.
        </div>
        <Fig name="guest" alt="What a player sees through the share link" caption="A player's view through the share link" />
        <p className="dim">
          A small icon at the top right shows the connection: green means live, red means the phone is reconnecting. It
          catches up on its own when the connection returns.
        </p>
      </section>

      <section className="pbr-card" id="end">
        <h2>Ending a session</h2>
        <p>
          When you're done, open the <strong>Log</strong> tab and tap <strong>End session</strong>, then confirm. The session
          becomes read-only for everyone and moves to Past sessions with the winner next to its name. You can still open it
          later to see the standings or export the results.
        </p>
      </section>

      <section className="pbr-card" id="admin">
        <h2>Admin</h2>
        <p>
          Admins have an extra page at <strong>/admin</strong> on the same address as the app. When you're signed in as an
          admin, an <strong>Admin</strong> link appears in the footer at the bottom of the screen. It's where you:
        </p>
        <ul>
          <li>See <strong>overall usage</strong>: allowed users, total and active sessions, and database size.</li>
          <li><strong>Add an instance user</strong> by entering their Google email address. They can then sign in and create their own sessions.</li>
          <li><strong>Revoke</strong> someone's access, or open <strong>view sessions</strong> to look at (or delete) a user's sessions.</li>
          <li><strong>Download the database</strong> as a backup file.</li>
        </ul>
        <p className="dim">Which accounts are admins is set on the server, not on this page.</p>
        <Fig name="admin" alt="The admin page" caption="The admin page" />
      </section>

      <section className="pbr-card" id="faq">
        <h2>Quick answers</h2>
        <ul>
          <li><strong>We entered the wrong score.</strong> Log tab, tap the pencil, correct it, Save.</li>
          <li><strong>The wrong people are on the court.</strong> Tap a name, or use Edit lineup.</li>
          <li><strong>Someone arrived late.</strong> Queue tab, Add a player mid-session.</li>
          <li><strong>Someone has to leave early.</strong> Queue tab, tap Sit out next to their name.</li>
          <li><strong>A player can't see the session.</strong> Check they used the share link for this session, and that they have a connection.</li>
        </ul>
      </section>
    </>
  );
}

function History() {
  return (
    <section className="pbr-card">
      <h2>Version history</h2>
      <p className="dim">
        Version numbers look like 1.1.7. The first two numbers change when features change, and those releases are listed
        here, newest first. The last number goes up automatically with every update, including small behind-the-scenes
        fixes that aren't listed.
      </p>
      {RELEASES.map((r) => (
        <div className="pbr-release" key={r.version}>
          <div className="pbr-release-head">
            <h3>Version {r.version}</h3>
            <span className="pbr-release-date">{formatDate(r.date)}</span>
          </div>
          <ul>
            {r.changes.map((c, i) => {
              const m = c.match(/^(New|Improved|Fixed):\s*(.*)$/);
              return (
                <li key={i}>
                  {m ? <><span className={"pbr-release-tag " + m[1].toLowerCase()}>{m[1]}</span> {m[2]}</> : c}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function Help({ view = "manual" }) {
  const navigate = useNavigate();
  const goBack = () => {
    // Opened in a new tab or straight from a link? There's nothing to go back to.
    if (window.history.length > 1) navigate(-1);
    else navigate("/app");
  };

  return (
    <div className="pbr-app">
      <Styles />
      <div className="pbr-help">
        <div className="pbr-help-top">
          <button className="pbr-help-back" onClick={goBack} aria-label="Back"><ArrowLeft size={18} /></button>
          <h1>Help</h1>
        </div>
        <nav className="pbr-help-tabs">
          <Link className={"pbr-help-tab" + (view === "manual" ? " active" : "")} to="/help">User manual</Link>
          <Link className={"pbr-help-tab" + (view === "history" ? " active" : "")} to="/help/history">Version history</Link>
        </nav>
        {view === "history" ? <History /> : <Manual />}
      </div>
      <Footer />
    </div>
  );
}
