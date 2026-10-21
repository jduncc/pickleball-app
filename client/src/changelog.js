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
