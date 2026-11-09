import React from 'react'
import assert from 'node:assert/strict'
import { Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScoreInput } from '../src/components/ui'
import { DEFAULT_SETTINGS } from '../src/lib/settings'
import {
  computeNineCommit,
  final9EntryOrder,
  isSeason9Week1,
  tonightBoard,
  MAX_FINAL,
  MAX_NINE,
} from '../src/lib/scoring'
import { requestRefresh, type ScoreBoard } from '../src/lib/score-refresh'
import type { Entry, Division } from '../src/lib/types'

let idCounter = 1
function makeEntry(p: Partial<Entry> = {}): Entry {
  const n = idCounter++
  const id = p.id ?? `entry-${n}`
  const division: Division = p.division ?? 'M'
  return {
    id,
    event_id: 'ev-smoke',
    player_id: `player-${n}`,
    division,
    paid: true,
    tag_in: null,
    tag_out: null,
    r1_b1: null,
    r1_b2: null,
    r2_b1: null,
    r2_b2: null,
    f_b1: null,
    f_b2: null,
    score_front: null,
    score_back: null,
    score_18: null,
    score_final: null,
    awards: [],
    made_final: false,
    tiebreak: null,
    place: null,
    payout: 0,
    points: 0,
    created_at: `2026-11-08T18:00:0${n}.000Z`,
    ...p,
  }
}

// ---------------------------------------------------------------------------
// 1. A save of both nines sets score_18 to the sum, and clearing one nine clears that derived score_18.
// ---------------------------------------------------------------------------
{
  let entry = makeEntry({ score_front: null, score_back: null, score_18: null })

  const frontPatch = computeNineCommit(entry, 'front', 42)
  entry = { ...entry, ...frontPatch }
  assert.equal(entry.score_front, 42)
  assert.equal(entry.score_back, null)
  assert.equal(entry.score_18, null, 'only front nine does not derive score_18')

  const backPatch = computeNineCommit(entry, 'back', 38)
  entry = { ...entry, ...backPatch }
  assert.equal(entry.score_front, 42)
  assert.equal(entry.score_back, 38)
  assert.equal(entry.score_18, 80, 'both nines set score_18 to the sum (42 + 38 = 80)')

  // Clearing back nine clears the derived score_18
  const clearBackPatch = computeNineCommit(entry, 'back', null)
  entry = { ...entry, ...clearBackPatch }
  assert.equal(entry.score_front, 42)
  assert.equal(entry.score_back, null)
  assert.equal(entry.score_18, null, 'clearing back nine clears derived score_18')

  // Re-saving back nine sets score_18 to the sum again
  entry = { ...entry, ...computeNineCommit(entry, 'back', 40) }
  assert.equal(entry.score_18, 82, 'both nines recomputed score_18 to 82')

  // Clearing front nine clears the derived score_18
  const clearFrontPatch = computeNineCommit(entry, 'front', null)
  entry = { ...entry, ...clearFrontPatch }
  assert.equal(entry.score_front, null)
  assert.equal(entry.score_back, 40)
  assert.equal(entry.score_18, null, 'clearing front nine clears derived score_18')
}

// ---------------------------------------------------------------------------
// 2. requestRefresh with a typed draft does not fetch. A clean board does fetch.
// ---------------------------------------------------------------------------
{
  const draftBoard: ScoreBoard = {
    server: { 'entry-1': 45 },
    local: { 'entry-1': 45 },
    draft: { id: 'entry-1', raw: '4' },
    savesInFlight: 0,
    refreshing: false,
    status: null,
  }
  const draftRefresh = requestRefresh(draftBoard)
  assert.equal(draftRefresh.fetch, false, 'requestRefresh with typed draft does not fetch')
  assert.ok(draftRefresh.board.status != null && draftRefresh.board.status.length > 0)
  assert.equal(draftRefresh.board.refreshing, false)

  const cleanBoard: ScoreBoard = {
    server: { 'entry-1': 45 },
    local: { 'entry-1': 45 },
    draft: null,
    savesInFlight: 0,
    refreshing: false,
    status: null,
  }
  const cleanRefresh = requestRefresh(cleanBoard)
  assert.equal(cleanRefresh.fetch, true, 'requestRefresh with clean board does fetch')
  assert.equal(cleanRefresh.board.refreshing, true)
  assert.ok(cleanRefresh.board.status != null && cleanRefresh.board.status.length > 0)
}

// ---------------------------------------------------------------------------
// 3. Two divisions rendered from tonightBoard, one with saved cut 1,
//    showing the leader above the cut and a front-only row outside it.
// ---------------------------------------------------------------------------
{
  const mLeader = makeEntry({
    id: 'm-leader',
    division: 'M',
    score_front: 22,
    score_back: 20,
    score_18: 42,
    created_at: '2026-11-08T18:00:01.000Z',
  })
  const mSecond = makeEntry({
    id: 'm-second',
    division: 'M',
    score_front: 18,
    score_back: 18,
    score_18: 36,
    created_at: '2026-11-08T18:00:02.000Z',
  })
  const mFrontOnly = makeEntry({
    id: 'm-front-only',
    division: 'M',
    score_front: 25,
    score_back: null,
    score_18: null,
    created_at: '2026-11-08T18:00:03.000Z',
  })

  const wLeader = makeEntry({
    id: 'w-leader',
    division: 'W',
    score_front: 20,
    score_back: 20,
    score_18: 40,
    created_at: '2026-11-08T18:00:04.000Z',
  })
  const wFollower = makeEntry({
    id: 'w-follower',
    division: 'W',
    score_front: 19,
    score_back: 19,
    score_18: 38,
    created_at: '2026-11-08T18:00:05.000Z',
  })

  const mEntries = [mLeader, mSecond, mFrontOnly]
  const wEntries = [wLeader, wFollower]

  const mBoard = tonightBoard(mEntries, DEFAULT_SETTINGS, 'scoring', 1)
  const wBoard = tonightBoard(wEntries, DEFAULT_SETTINGS, 'scoring', null)

  assert.equal(mBoard.cutAfterId, 'm-leader', 'saved cut 1 sets cutAfterId to leader')
  assert.equal(mBoard.completed.length, 2)
  assert.equal(mBoard.partial.length, 1)
  assert.equal(mBoard.partial[0].id, 'm-front-only', 'front-only row is in partial list')

  function TonightBoardSection({
    title,
    division,
    board,
  }: {
    title: string
    division: Division
    board: ReturnType<typeof tonightBoard>
  }) {
    return (
      <section className={`division-board division-${division}`}>
        <h3>{title}</h3>
        <table>
          <tbody>
            {board.completed.map(row => (
              <Fragment key={row.id}>
                <tr data-row-id={row.id} className={row.place === 1 ? 'leader' : ''}>
                  <td className="place">{row.place ?? '—'}</td>
                  <td className="id">{row.id}</td>
                  <td className="front">{row.front ?? '—'}</td>
                  <td className="back">{row.back ?? '—'}</td>
                  <td className="t18">{row.t18 ?? '—'}</td>
                </tr>
                {row.id === board.cutAfterId && (
                  <tr className="cut-line" data-cut-after={row.id}>
                    <td colSpan={5}>
                      Cut line ({board.provisional ? 'provisional' : 'confirmed'})
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {board.partial.map(row => (
              <tr key={row.id} data-row-id={row.id} className="partial-row">
                <td className="place">—</td>
                <td className="id">{row.id}</td>
                <td className="front">{row.front ?? '—'}</td>
                <td className="back">{row.back ?? '—'}</td>
                <td className="t18">{row.t18 ?? '—'}</td>
              </tr>
            ))}
            {board.unscored.map(row => (
              <tr key={row.id} data-row-id={row.id} className="unscored-row">
                <td className="place">—</td>
                <td className="id">{row.id}</td>
                <td className="front">—</td>
                <td className="back">—</td>
                <td className="t18">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    )
  }

  const renderedHtml = renderToStaticMarkup(
    <div>
      <TonightBoardSection title="Men's Division" division="M" board={mBoard} />
      <TonightBoardSection title="Women's Division" division="W" board={wBoard} />
    </div>,
  )

  assert.ok(renderedHtml.includes('division-M'))
  assert.ok(renderedHtml.includes('division-W'))

  const leaderIdx = renderedHtml.indexOf('data-row-id="m-leader"')
  const cutLineIdx = renderedHtml.indexOf('class="cut-line" data-cut-after="m-leader"')
  const secondIdx = renderedHtml.indexOf('data-row-id="m-second"')
  const partialIdx = renderedHtml.indexOf('data-row-id="m-front-only"')

  assert.ok(leaderIdx !== -1, 'leader row is rendered')
  assert.ok(cutLineIdx !== -1, 'cut line is rendered')
  assert.ok(secondIdx !== -1, 'second row is rendered')
  assert.ok(partialIdx !== -1, 'front-only row is rendered')

  assert.ok(leaderIdx < cutLineIdx, 'leader is rendered above the cut line')
  assert.ok(cutLineIdx < secondIdx, 'second completed row is below cut line')
  assert.ok(cutLineIdx < partialIdx, 'front-only row is outside the cut (below cut line)')
}

// ---------------------------------------------------------------------------
// 4. A disabled ScoreInput for a Week 1 front score renders the disabled attribute.
// ---------------------------------------------------------------------------
{
  const week1Event = {
    season_id: '81298495-f87c-4d7c-a344-89b97e587d9b',
    event_date: '2026-11-05',
    name: 'Week 1',
  }
  assert.equal(isSeason9Week1(week1Event), true, 'event is Season 9 Week 1')

  const week1Entry = makeEntry({ score_front: 36 })
  const week1DisabledMarkup = renderToStaticMarkup(
    <ScoreInput
      value={week1Entry.score_front}
      max={MAX_NINE}
      disabled={isSeason9Week1(week1Event)}
      onCommit={() => {}}
    />,
  )
  assert.match(week1DisabledMarkup, /\bdisabled\b/, 'disabled ScoreInput must render disabled attribute')
  assert.match(week1DisabledMarkup, /value="36"/, 'shows front score value 36')

  const otherEvent = {
    season_id: '81298495-f87c-4d7c-a344-89b97e587d9b',
    event_date: '2026-11-12',
    name: 'Week 2',
  }
  assert.equal(isSeason9Week1(otherEvent), false, 'Week 2 is not Season 9 Week 1')
  const enabledMarkup = renderToStaticMarkup(
    <ScoreInput
      value={week1Entry.score_front}
      max={MAX_NINE}
      disabled={isSeason9Week1(otherEvent)}
      onCommit={() => {}}
    />,
  )
  assert.doesNotMatch(enabledMarkup, /\bdisabled\b/, 'enabled ScoreInput must not render disabled attribute')
}

// ---------------------------------------------------------------------------
// 5. A blank Final 9 renders as an empty value, and a typed 0 renders as 0.
// ---------------------------------------------------------------------------
{
  // ScoreInput component
  const blankFinalMarkup = renderToStaticMarkup(
    <ScoreInput value={null} max={MAX_FINAL} onCommit={() => {}} />,
  )
  assert.match(blankFinalMarkup, /value=""/, 'blank Final 9 renders empty value')
  assert.doesNotMatch(blankFinalMarkup, /value="0"/, 'blank Final 9 does not render 0')

  const zeroFinalMarkup = renderToStaticMarkup(
    <ScoreInput value={0} max={MAX_FINAL} onCommit={() => {}} />,
  )
  assert.match(zeroFinalMarkup, /value="0"/, 'typed 0 renders as 0')

  // Table cell display
  function FinalCell({ score }: { score: number | null }) {
    return <td className="final-val">{score != null ? score : ''}</td>
  }
  assert.equal(renderToStaticMarkup(<FinalCell score={null} />), '<td class="final-val"></td>')
  assert.equal(renderToStaticMarkup(<FinalCell score={0} />), '<td class="final-val">0</td>')
}

// ---------------------------------------------------------------------------
// 6. final9EntryOrder ids stay the same after score_final changes,
//    and the rendered row order uses those ids.
// ---------------------------------------------------------------------------
{
  const finLead = makeEntry({
    id: 'fin-lead',
    division: 'M',
    score_front: 20,
    score_back: 20,
    score_18: 40,
    made_final: true,
    score_final: null,
    created_at: '2026-11-08T18:00:01.000Z',
  })
  const finMid = makeEntry({
    id: 'fin-mid',
    division: 'M',
    score_front: 18,
    score_back: 18,
    score_18: 36,
    made_final: true,
    score_final: null,
    created_at: '2026-11-08T18:00:02.000Z',
  })
  const finTrail = makeEntry({
    id: 'fin-trail',
    division: 'M',
    score_front: 15,
    score_back: 15,
    score_18: 30,
    made_final: true,
    score_final: null,
    created_at: '2026-11-08T18:00:03.000Z',
  })
  const cutRow = makeEntry({
    id: 'fin-cut',
    division: 'M',
    score_front: 14,
    score_back: 14,
    score_18: 28,
    made_final: false,
    score_final: null,
    created_at: '2026-11-08T18:00:04.000Z',
  })

  const field = [finMid, cutRow, finLead, finTrail]

  const orderBefore = final9EntryOrder(field, DEFAULT_SETTINGS)
  const idsBefore = orderBefore.map(e => e.id)
  assert.deepEqual(idsBefore, ['fin-lead', 'fin-mid', 'fin-trail', 'fin-cut'])

  // Change score_final: trailing player shoots 50, leader shoots 0
  const updatedLead = { ...finLead, score_final: 0 }
  const updatedMid = { ...finMid, score_final: 25 }
  const updatedTrail = { ...finTrail, score_final: 50 }
  const fieldAfter = [updatedMid, cutRow, updatedLead, updatedTrail]

  const orderAfter = final9EntryOrder(fieldAfter, DEFAULT_SETTINGS)
  const idsAfter = orderAfter.map(e => e.id)
  assert.deepEqual(idsAfter, idsBefore, 'final9EntryOrder ids stay the same after score_final changes')

  function Final9Grid({ rows }: { rows: Entry[] }) {
    return (
      <table>
        <tbody>
          {rows.map(ent => (
            <tr key={ent.id} data-entry-id={ent.id}>
              <td className="id">{ent.id}</td>
              <td className="t18">{ent.score_18}</td>
              <td className="final">
                <ScoreInput
                  value={ent.made_final ? ent.score_final : null}
                  max={MAX_FINAL}
                  disabled={!ent.made_final}
                  onCommit={() => {}}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  function extractRowIds(html: string): string[] {
    const matches = [...html.matchAll(/data-entry-id="([^"]+)"/g)]
    return matches.map(m => m[1])
  }

  const beforeHtml = renderToStaticMarkup(<Final9Grid rows={orderBefore} />)
  const renderedBeforeIds = extractRowIds(beforeHtml)
  assert.deepEqual(
    renderedBeforeIds,
    idsBefore,
    'rendered row order uses final9EntryOrder ids before score_final changes',
  )

  const afterHtml = renderToStaticMarkup(<Final9Grid rows={orderAfter} />)
  const renderedAfterIds = extractRowIds(afterHtml)
  assert.deepEqual(
    renderedAfterIds,
    idsAfter,
    'rendered row order uses final9EntryOrder ids after score_final changes',
  )
  assert.deepEqual(
    renderedBeforeIds,
    renderedAfterIds,
    'rendered row order remains identical before and after score_final changes',
  )
}

// ---------------------------------------------------------------------------
// All checks passed
// ---------------------------------------------------------------------------
console.log('SMOKE_OK')
