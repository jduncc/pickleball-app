// Version history shown in the app at /help/history.
//
// Newest release first. To record a change: add a new object at the TOP of
// RELEASES (don't edit old entries), and bump the minor version in
// server/package.json to match — see CLAUDE.md for the full checklist.
//
//   version  the release the change shipped in, e.g. "1.2.0"
//   date     YYYY-MM-DD, the day the release was made
//   changes  short, plain-language lines a player or host would understand.
//            Start each with a kind: "New:", "Improved:" or "Fixed:".
//
// The third number of the version (1.1.x) is bumped automatically by CI on
// every build, so builds of a release show as 1.1.1, 1.1.2 ... Only the
// releases listed here are described.

export const RELEASES = [
  {
    version: "1.6.0",
    date: "2026-10-21",
    changes: [
      "New: The \"How scheduling works\" page has a Print or save as PDF button, and prints cleanly on a light background without the menus.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-10-21",
    changes: [
      "Fixed: when everyone is playing (for example 8 players on 2 courts), a reshuffle could pair people who had already partnered even though a fresh pairing existed. It now searches every possible pairing first.",
      "New: Randomize on a court, or Randomize all, re-deals the teams for games in progress.",
      "New: Edit lineup now works with no one waiting. Pick a player who is already on a court to trade places with them.",
      "New: Admins can delete a game from the log while editing it.",
      "New: A game on the court that repeats an earlier matchup is now labelled \"Repeat of game N\", and the Next up line says which game it would repeat.",
      "New: A small number to the left of each pair of partners shows how many finished games those two have already played together (0 = a fresh pairing, red when it is a repeat).",
      "New: The Log tab now shows the game number on each game.",
      "New: A \"How scheduling works\" page explains exactly how the app decides who plays, who sits, who partners whom and who serves first.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-10-21",
    changes: [
      "New: The CSV and PDF exports now show which games were repeats (the same two teams meeting again) and which earlier game each one repeated.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-10-21",
    changes: [
      "New: Serves first. The top team on each court serves first, with a green label, and the app balances who is on top so serving first is shared fairly. When the same two teams meet again, the sides flip.",
      "Fixed: In small groups the app could replay the exact same game (the same two teams against each other) over and over. It now avoids replaying a game before trying other matchups.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-14",
    changes: [
      "Improved: Fairer sit-outs. The app now counts how many times each person has sat, so nobody sits a second time while someone is still waiting for their first.",
      "Improved: Partners. When a repeat partner can't be avoided, the app repeats the pair that played together longest ago, so you don't get the same partner in back-to-back games.",
      "Fixed: Swapping someone out of a game (Edit lineup, or tapping a name to sit out) no longer sends them to the back of the line. They keep their place and play the next game.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-07",
    changes: [
      "New: A built-in user manual and this version history, linked from the bottom of the app.",
      "New: Edit score. Fix the score of a finished game from the Log tab (tap the pencil). It only changes the score and the standings, so the next matchup stays exactly as it was.",
      "New: Admins now see an Admin link in the footer, next to the manual and version history.",
      "New: Add a court in the middle of a session. Use the Courts counter at the top of the Courts tab; the new court starts a game right away.",
      "Fixed: On iPhones, the app no longer zooms in when you tap a text box or double-tap a button.",
    ],
  },
];
