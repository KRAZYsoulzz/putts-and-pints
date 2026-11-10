import assert from 'node:assert/strict'
import fs from 'node:fs'

// 1. App CSS Mobile and Responsive Rules
{
  const css = fs.readFileSync(new URL('../styles/app.css', import.meta.url), 'utf-8')

  // 1a. @media (max-width: 1100px) sets .grid-2 to minmax(0, 1fr) so tables swipe inside .table-wrap
  const media1100Match = css.match(/@media\s*\(\s*max-width:\s*1100px\s*\)\s*\{([^}]+)\}/)
  assert.ok(media1100Match, '@media (max-width: 1100px) block must exist')
  const media1100Content = media1100Match[1]
  assert.ok(
    /\.grid-2\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(media1100Content),
    '.grid-2 under @media (max-width: 1100px) must use grid-template-columns: minmax(0, 1fr)',
  )

  // 1b. .scrim uses grid-template-columns: minmax(0, 1fr) to prevent sizing to max-content
  assert.ok(
    /\.scrim\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css),
    '.scrim must include grid-template-columns: minmax(0, 1fr)',
  )

  // 1c. .dialog uses min-width: 0 and justify-self: center to stay within padding
  const dialogMatch = css.match(/\.dialog\s*\{([^}]+)\}/)
  assert.ok(dialogMatch, '.dialog rule must exist')
  assert.ok(
    /min-width:\s*0/.test(dialogMatch[1]) && /justify-self:\s*center/.test(dialogMatch[1]),
    '.dialog must specify min-width: 0 and justify-self: center',
  )

  // 1d. .dialog-body .table-wrap constrained to 100% width
  assert.ok(
    /\.dialog-body\s+\.table-wrap\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/.test(css),
    '.dialog-body .table-wrap must have min-width: 0 and max-width: 100%',
  )

  // 1e. /tv projector view uses width: 100% (not 100vw)
  const projectorMatch = css.match(/\.projector-page\s*\{([^}]+)\}/)
  assert.ok(projectorMatch, '.projector-page rule must exist')
  assert.ok(
    /width:\s*100%/.test(projectorMatch[1]),
    '.projector-page must use width: 100% instead of 100vw to prevent horizontal scrollbars',
  )
  assert.ok(
    !/width:\s*100vw/.test(projectorMatch[1]),
    '.projector-page must not use 100vw',
  )

  // 1f. /tv projector stacks division columns under <=700px
  const media700Match = css.match(new RegExp('@media\\s*\\(max-width:\\s*700px\\)\\s*\\{([\\s\\S]+?)\\n\\}'))
  assert.ok(media700Match, '@media (max-width: 700px) must exist')
  assert.ok(
    /\.projector-page\s+\.leaderboard-grid\s*\{[^}]*grid-template-columns:\s*1fr\s*!important/.test(media700Match[1]),
    '.projector-page .leaderboard-grid must stack columns (1fr !important) under @media (max-width: 700px)',
  )

  // 1g. .hide-sm hides elements completely
  assert.ok(
    /\.hide-sm\s*\{\s*display:\s*none\s*!important;\s*\}/.test(css),
    '.hide-sm must have display: none !important',
  )

  // 1h. .players-table .col-tag width constraints
  assert.ok(
    /\.players-table\s+\.col-tag\s*\{[^}]*width:\s*75px/.test(css),
    '.players-table .col-tag must have mobile width of 75px',
  )
}

// 2. Standings page column hiding
{
  const standings = fs.readFileSync(new URL('../pages/Standings.tsx', import.meta.url), 'utf-8')

  // Events column is marked hide-sm in COLUMNS definition and td cell
  assert.ok(
    /key:\s*'events'[^}]+className:\s*'hide-sm'/.test(standings),
    'Standings COLUMNS definition must mark events with className: "hide-sm"',
  )
  assert.ok(
    /<td className="c hide-sm">\{item\.eventsPlayed\}<\/td>/.test(standings),
    'Standings td for eventsPlayed must have hide-sm class',
  )

  // 1st Wins column is marked hide-sm in COLUMNS definition and td cell
  assert.ok(
    /key:\s*'wins'[^}]+className:\s*'hide-sm'/.test(standings),
    'Standings COLUMNS definition must mark wins with className: "hide-sm"',
  )
  assert.ok(
    /<td className="c hide-sm">\{item\.firstPlaces > 0 \?/.test(standings),
    'Standings td for firstPlaces must have hide-sm class',
  )
}

// 3. Players page small screen adjustments
{
  const players = fs.readFileSync(new URL('../pages/Players.tsx', import.meta.url), 'utf-8')

  // Table has players-table class
  assert.ok(
    /<table className="table players-table">/.test(players),
    'Players table must have className="table players-table"',
  )

  // Tag column has col-tag on th and td
  assert.ok(
    /<th className="c col-tag">Tag<\/th>/.test(players),
    'Tag th must have col-tag class',
  )
  assert.ok(
    /<td className="c col-tag">/.test(players),
    'Tag td must have col-tag class',
  )

  // In tags chip is hidden on small screens
  assert.ok(
    /\{p\.in_tags && <span className="chip hide-sm" style=\{\{[^}]*\}\}>In tags<\/span>\}/.test(players),
    'In tags chip must have hide-sm class',
  )

  // Action column is hidden on small screens
  assert.ok(
    /<th className="c bl hide-sm"[^>]*>Action<\/th>/.test(players),
    'Action th must have hide-sm class',
  )
  assert.ok(
    /<td className="c bl hide-sm">/.test(players),
    'Action td must have hide-sm class',
  )
}

console.log('Mobile width and responsiveness tests passed ✔')
