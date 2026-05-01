/*
 * Opening-id ↔ Lichess opening-tag slug mapping.
 *
 * The Lichess puzzle DB tags positions with opening slugs like
 * `Italian_Game` or `Sicilian_Defense_Najdorf_Variation` (American
 * spelling, underscores between every word). Our curated openings use
 * British spelling and "Defence", so for half the courses there's a
 * one-to-one rename and we keep the override map here.
 *
 * Lives in `openings/` rather than `routes/Tactics.tsx` because both
 * the Tactics route AND the Openings detail's Puzzles tab need to
 * derive the same slug to filter the same set of puzzles. Keeping it
 * route-local would invite drift.
 */

const OPENING_SLUG_OVERRIDES: Record<string, string> = {
  'ruylopez-white': 'Ruy_Lopez',
  'sicilian-black': 'Sicilian_Defense',
  'french-black': 'French_Defense',
  'carokann-black': 'Caro-Kann_Defense',
  'kid-black': "King's_Indian_Defense",
  'qgd-white': "Queen's_Gambit_Declined",
  'london-white': 'London_System',
  'english-white': 'English_Opening',
  'scandinavian-black': 'Scandinavian_Defense',
  'pirc-black': 'Pirc_Defense',
  'slav-black': 'Slav_Defense',
  'vienna-white': 'Vienna_Game',
  'italian-white': 'Italian_Game',
  'scotch-white': 'Scotch_Game',
};

/**
 * Derive the Lichess opening-slug prefix for one of our curated
 * openings. Returns the bare slug (without trailing `%`) — callers
 * that want a SQL LIKE prefix should append `%` themselves.
 */
export function openingSlugPrefix(openingId: string, name: string): string {
  return OPENING_SLUG_OVERRIDES[openingId] ?? name.replace(/\s+/g, '_');
}

/**
 * Display-friendly version of a Lichess slug:
 *   `Sicilian_Defense_Najdorf_Variation` → `Sicilian Defense Najdorf Variation`
 * Strips a trailing `%` first if present.
 */
export function formatOpeningTag(tag: string): string {
  const clean = tag.endsWith('%') ? tag.slice(0, -1) : tag;
  return clean.replace(/_/g, ' ');
}
