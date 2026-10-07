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
    version: "1.1.0",
    date: "2026-10-07",
    changes: [
      "New: A built-in user manual and this version history, linked from the bottom of the app.",
      "New: Edit score. Fix the score of a finished game from the Log tab (tap the pencil). It only changes the score and the standings, so the next matchup stays exactly as it was.",
      "Fixed: On iPhones, the app no longer zooms in when you tap a text box or double-tap a button.",
    ],
  },
];
