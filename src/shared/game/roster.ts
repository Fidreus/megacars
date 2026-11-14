// Who is in a race: paint colours, computer driver names and skill levels.
// Shared so the server and the client set up identical worlds.

/** Car paint colours, one per grid slot. */
export const CAR_COLORS = ['#e8322a', '#2f6fe0', '#f2c230', '#2fae4e', '#f07a1a', '#9a45d8', '#28c4d0', '#e8e8e8'];

// Computer drivers. All made up.
export const AI_NAMES = [
  'BLITZ', 'NITRO NINA', 'TURBO TOM', 'VIXEN', 'DIESEL DAN', 'ROXY', 'MAX POWER', 'ACE', 'SPARKY', 'LUCKY LOU',
];

/** AI skill by difficulty (EASY, MEDIUM, HARD); 1 is the flawless driver, HARD a little below it. */
export const AI_SKILL = [0.72, 0.86, 0.97];
