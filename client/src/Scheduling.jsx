import React from "react";

// "How scheduling works" (/help/scheduling): the plain-language rules the
// server uses to decide who plays, who sits, who partners whom and who serves
// first. The code is server/reducer.js.
//
// KEEP THIS IN SYNC. Any change to those rules in reducer.js must be reflected
// here in the same commit, and SCHEDULING_DOC_VERSION below bumped to the
// release that changed it (see CLAUDE.md).
export const SCHEDULING_DOC_VERSION = "1.5.0";

export default function Scheduling() {
  return (
    <>
      <section className="pbr-card">
        <h2>How the app decides who plays next</h2>
        <p>
          Every time a court needs a game, the app makes two separate decisions, always in this order:
        </p>
        <ol>
          <li><strong>Who plays.</strong> This is about fairness and is never traded away for better teams.</li>
          <li><strong>How they're arranged.</strong> Among the people who must or may play, it picks the teams with the most variety.</li>
        </ol>
        <p>
          Finally it decides which team is on top (serves first). Everything below describes those steps in the order they
          are applied: the first rule that separates two options wins, and later rules only break ties.
        </p>
        <p className="dim">This page describes release {SCHEDULING_DOC_VERSION}.</p>
        <ul className="pbr-help-toc">
          <li><a href="#who">1. Who plays and who sits</a></li>
          <li><a href="#teams">2. How teams are picked</a></li>
          <li><a href="#nobench">3. When everyone is playing</a></li>
          <li><a href="#shuffle">4. Shuffle courts</a></li>
          <li><a href="#serve">5. Who serves first</a></li>
          <li><a href="#hand">6. What happens when you change things by hand</a></li>
          <li><a href="#limits">7. Things to know</a></li>
        </ul>
      </section>

      <section className="pbr-card" id="who">
        <h2>1. Who plays and who sits</h2>
        <p>
          When a court is free, everyone who is active and not on a court is "waiting". They are ranked by these checks, in
          this order. The first check where two people differ decides who is more overdue:
        </p>
        <ol>
          <li><strong>Sat out last time.</strong> If you were skipped the last time courts were filled and you're still waiting, you play now. This is what stops anyone sitting twice in a row.</li>
          <li><strong>Fewest sits so far wins</strong> (more sits means more overdue). So nobody sits a second time while someone is still waiting for their first.</li>
          <li><strong>Fewer games played.</strong> The person with fewer games is more overdue.</li>
          <li><strong>Who has waited longest</strong> since finishing their last game (actual time).</li>
          <li>If it's still an exact tie, the order they were added.</li>
        </ol>
        <p>
          Anyone ranked strictly ahead of the cut-off <strong>must</strong> play. Players who are tied exactly at the cut-off
          are "contested": the app chooses among them using the team rules in section 2, so the tie is used to get better
          teams instead of being settled at random.
        </p>

        <h3 className="pbr-help-h3">What counts as a sit</h3>
        <ul>
          <li>A sit is counted when a court is actually filled and you were waiting but not picked. Waiting while no court is free yet is not a sit.</li>
          <li>Someone who arrives late starts with the lowest sit count among active players, so they aren't made to wait extra, and nobody has to "catch up".</li>
          <li>Someone who steps out by choice and comes back keeps no penalty: they return at least level with the others.</li>
          <li>If the host swaps a player out of a game (tap a name, or Edit lineup), that player is counted as having sat and plays next, and the player coming in has a sit taken back.</li>
        </ul>
        <p>
          If a game isn't played, or the same game is re-dealt with Randomize, nobody's sit count changes.
        </p>
      </section>

      <section className="pbr-card" id="teams">
        <h2>2. How teams are picked</h2>
        <p>
          Once the players are known, the app looks at every way to split them into two teams and ranks the options by these
          checks, in order:
        </p>
        <ol>
          <li><strong>Fewest repeated partners.</strong> Everyone partners everyone else once before any pair partners again.</li>
          <li><strong>Avoid the exact same game</strong> (the same two teams against each other again).</li>
          <li><strong>If a repeat is unavoidable, repeat the pair that last played together longest ago</strong>, so you don't get the same partner two games in a row.</li>
          <li><strong>Fewest repeated opponents</strong> (how often each person has faced each other person).</li>
          <li><strong>Who has waited longest</strong> (the order from section 1).</li>
          <li>Anything still tied is chosen at random.</li>
        </ol>
        <p>
          A "repeat" of two teams meeting again counts the same whichever side or court they are on, and whichever order
          the names are in.
        </p>
        <p>
          You can see the partner history on the court: the small number beside each pair is how many finished games
          those two have already played together (0 is fresh, red means a repeat).
        </p>
        <h3 className="pbr-help-h3">Fixed teams (partners stay together)</h3>
        <p>
          When the session uses fixed teams, partners never change, so only opponents are chosen: fewest repeated
          opponents, then avoid an exact rematch, then who has waited longest. The sit rules in section 1 apply to teams.
        </p>
        <h3 className="pbr-help-h3">The "Next up" preview</h3>
        <p>
          The <strong>Next up</strong> line under a game is a commitment, not a guess: when that court finishes, that is the
          game that starts, unless something changed in between (a player added or removed, someone swapped, an undo).
          If it would replay an earlier game it says "(repeat of game N)". A game already on a court that repeats one shows a "Repeat of game N" label.
        </p>
      </section>

      <section className="pbr-card" id="nobench">
        <h2>3. When everyone is playing</h2>
        <p>
          If the number of active players exactly fills the courts (for example 8 players on 2 courts), nobody ever sits and
          the only question is who partners whom. After a shuffle the app uses a full rotation, built so every player
          partners every other player exactly once over the rounds (7 rounds for 8 players).
        </p>
        <p>
          Before each round it also searches <strong>every possible way to pair everyone up</strong> and compares it with the
          rotation's next round. If the search can avoid a repeated partner that the rotation round would cause (which happens
          when games were played in a different pattern first, for example when the courts were running out of sync), the
          search result is used and the rotation is rebuilt around the games actually played.
        </p>
      </section>

      <section className="pbr-card" id="shuffle">
        <h2>4. Shuffle courts</h2>
        <p>
          With two or more courts, <strong>Shuffle courts</strong> waits until every court has finished, then re-deals everyone
          across all the courts at once. Who plays is decided first, for all the courts together, using section 1. The
          chosen players are then spread across the courts and split into teams, searching every arrangement for the fewest
          repeated partners and exact rematches (section 2). Very large groups are searched by sampling instead.
        </p>
        <p>
          Shuffle stays armed until you cancel it. While it waits, a court that finishes stays empty until the others are
          done, so a new court or a late arrival joins at the next shuffle.
        </p>
        <h3 className="pbr-help-h3">Without Shuffle</h3>
        <p>
          Each court refills on its own as it finishes, from whoever is waiting at that moment. That means the players who
          just finished are part of the pool, and the choices can be narrower than a full shuffle. It is also why two courts
          that run out of sync can give someone a second sit a little early.
        </p>
      </section>

      <section className="pbr-card" id="serve">
        <h2>5. Who serves first</h2>
        <p>
          The team shown <strong>on top (Side A) always serves first</strong>. To keep it fair, the app counts how many games
          each player has started on top. For every new game, the team whose players have the lower total goes on top; if it's
          equal, it is random. A rematch of the same two teams therefore flips the sides.
        </p>
      </section>

      <section className="pbr-card" id="hand">
        <h2>6. What happens when you change things by hand</h2>
        <ul>
          <li><strong>Tap a name / Edit lineup, swapping in a waiting player.</strong> The player coming out counts as a sit and plays next; the player going in has a sit taken back. Nothing already played changes.</li>
          <li><strong>Edit lineup, trading places with someone already playing.</strong> Nobody sits or plays extra; no counts change.</li>
          <li><strong>Randomize / Randomize all.</strong> Re-deals the teams for games in progress using the section 2 rules, never giving the same lineup back. The same people keep playing, so no sit counts change.</li>
          <li><strong>Edit score.</strong> Only the standings change. Who plays next does not.</li>
          <li><strong>Undo last.</strong> Puts the game back on the court and reverses its results and its partner and opponent history. The next matchup may then be chosen differently.</li>
          <li><strong>Delete game (admin).</strong> Removes the game from the log, standings and partner and opponent history. Sit counts and the waiting order are left alone.</li>
          <li><strong>Sit out / come back, add or remove a player, add or remove a court.</strong> Sit counts are adjusted as in section 1, and empty courts are filled right away (unless a shuffle is waiting).</li>
        </ul>
      </section>

      <section className="pbr-card" id="limits">
        <h2>7. Things to know</h2>
        <ul>
          <li><strong>Small groups can't avoid every repeat.</strong> A group of four has only three ways to split into teams, so with 5 to 6 players on one court, repeat partners eventually happen. The app picks the least bad option (section 2).</li>
          <li><strong>Fairness comes before variety.</strong> Because who plays is decided first, the four chosen players sometimes have already partnered in every combination, which forces a repeat even though other players could have given a fresh pairing.</li>
          <li><strong>One court with exactly twice as many players as a court holds</strong> (8 on 1 court) tends to alternate the same two groups of four. Use Edit lineup to mix them.</li>
          <li><strong>Two courts out of sync</strong> can bring a second sit earlier for someone, because the other court's players haven't had their turn yet. Using Shuffle courts keeps the courts in step.</li>
          <li><strong>Everything is decided on the server</strong> and the same for everyone watching, so the order doesn't depend on whose phone you look at.</li>
        </ul>
      </section>
    </>
  );
}
