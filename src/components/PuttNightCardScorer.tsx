import { Fragment, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Lock, Unlock } from 'lucide-react'
import { Dialog } from './ui'
import type { PPCard } from '../lib/cards'
import type { StationPlayerPayload } from '../lib/store'
import {
  PUTT_STATIONS_9,
  clampStationMake,
  nextStationIndexForCard,
  normalizeStationArray,
  summarizeStationRound,
  type PuttCardRound,
  type StationMake,
} from '../lib/putt-stations'
import { displayedBack, displayedFront, totals } from '../lib/scoring'
import { AWARD_SHORT, type Entry, type PPEvent, type Player } from '../lib/types'

interface PuttNightCardScorerProps {
  event: PPEvent
  round: PuttCardRound
  cards: PPCard[]
  initialCardId: string
  entries: Entry[]
  playerById: Map<string, Player>
  isAdmin: boolean
  isLocked: boolean
  isCardUnlocked: (eventId: string, cardId: string) => boolean
  unlockCardWithPin: (eventId: string, cardId: string, pin: string) => Promise<boolean>
  onSubmitStationScores: (
    eventId: string,
    cardId: string,
    round: PuttCardRound,
    playerStations: StationPlayerPayload,
  ) => Promise<boolean>
  onClose: () => void
}

function entriesForCard(card: PPCard, eventEntries: readonly Entry[], round: PuttCardRound): Entry[] {
  const byPlayer = new Map(eventEntries.map(e => [e.player_id, e]))
  return card.playerIds
    .map(pid => byPlayer.get(pid))
    .filter((ent): ent is Entry => Boolean(ent && (round === '18' || ent.made_final)))
}

export default function PuttNightCardScorer({
  event,
  round,
  cards,
  initialCardId,
  entries,
  playerById,
  isAdmin,
  isLocked,
  isCardUnlocked,
  unlockCardWithPin,
  onSubmitStationScores,
  onClose,
}: PuttNightCardScorerProps) {
  const initialCard = cards.find(c => c.id === initialCardId) ?? cards[0]
  const [selectedCardId, setSelectedCardId] = useState(initialCard?.id ?? initialCardId)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState('')
  const [activeStation, setActiveStation] = useState(() => {
    if (!initialCard) return 0
    return nextStationIndexForCard(round, entriesForCard(initialCard, entries, round))
  })
  const [showSummaryTable, setShowSummaryTable] = useState(false)
  const headerRef = useRef<HTMLDivElement | null>(null)

  const goToStation = (idx: number) => {
    setActiveStation(idx)
    const body = headerRef.current?.closest('.dialog-body')
    if (body) body.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const card = cards.find(c => c.id === selectedCardId) ?? initialCard
  if (!card) return null

  const cardEntries = entriesForCard(card, entries, round)
  const unlocked = isCardUnlocked(event.id, card.id)
  const totalStations = round === '18' ? 18 : 9
  const safeStationIdx = Math.min(totalStations - 1, Math.max(0, activeStation))
  const inRoundIdx = safeStationIdx % 9
  const meta = PUTT_STATIONS_9[inRoundIdx]
  const roundKey: 'front' | 'back' | 'final' =
    round === 'final' ? 'final' : safeStationIdx < 9 ? 'front' : 'back'
  const halfLabel =
    round === 'final'
      ? 'Final 9'
      : safeStationIdx < 9
        ? 'Front 9 (1–9)'
        : 'Back 9 (10–18)'

  const firstMissing = nextStationIndexForCard(round, cardEntries)
  const isNineComplete = (e: Entry, key: 'front' | 'back' | 'final') => {
    const arr = e.station_scores?.[key]
    if (arr) return summarizeStationRound(arr).isComplete
    if (key === 'front') return e.score_front != null
    if (key === 'back') return e.score_back != null
    return e.score_final != null
  }
  const allComplete =
    cardEntries.length > 0 &&
    (round === 'final'
      ? cardEntries.every(e => isNineComplete(e, 'final'))
      : cardEntries.every(e => isNineComplete(e, 'front') && isNineComplete(e, 'back')))

  const handleSelectCard = (nextCard: PPCard) => {
    setSelectedCardId(nextCard.id)
    setPinInput('')
    setPinError('')
    setActiveStation(nextStationIndexForCard(round, entriesForCard(nextCard, entries, round)))
  }

  const handleTapMake = async (ent: Entry, make: StationMake) => {
    if (isLocked) return
    const existingArr = normalizeStationArray(ent.station_scores?.[roundKey])
    existingArr[inRoundIdx] = make
    await onSubmitStationScores(event.id, card.id, round, {
      [ent.player_id]: { [roundKey]: existingArr },
    })
  }

  const prevIdx = (safeStationIdx - 1 + totalStations) % totalStations
  const nextIdx = (safeStationIdx + 1) % totalStations
  const nextMeta = PUTT_STATIONS_9[nextIdx % 9]

  return (
    <Dialog wide title={`${card.name} · ${round === 'final' ? 'Final 9' : '18 Holes'}`} onClose={onClose}>
      {!unlocked ? (
        <form
          className="stack"
          onSubmit={async e => {
            e.preventDefault()
            const ok = await unlockCardWithPin(event.id, card.id, pinInput)
            if (!ok) {
              setPinError('Incorrect 4-digit PIN. Ask the director for your card PIN.')
              return
            }
            setPinError('')
            setPinInput('')
          }}
        >
          {cards.length > 1 && (
            <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
              {cards.map(c => {
                const cUnlocked = isCardUnlocked(event.id, c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`btn btn-sm ${c.id === card.id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => handleSelectCard(c)}
                  >
                    {cUnlocked ? <Unlock size={12} /> : <Lock size={12} />} {c.name}
                  </button>
                )
              })}
            </div>
          )}

          <div className="panel panel-pad stack" style={{ gap: 6 }}>
            <div className="eyebrow">Players on {card.name}</div>
            {cardEntries.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No active players on this card.</div>
            ) : (
              cardEntries.map(ent => (
                <div key={ent.id} className="strong" style={{ fontSize: 14 }}>
                  · {playerById.get(ent.player_id)?.name ?? 'Unknown Player'}
                </div>
              ))
            )}
          </div>

          <div className="field">
            <span>Enter 4-Digit Card PIN</span>
            <input
              className="input num"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              placeholder="4-digit PIN"
              style={{ fontSize: 22, letterSpacing: '0.28em', textAlign: 'center', height: 48 }}
              value={pinInput}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                setPinInput(digits)
                setPinError('')
              }}
            />
            {pinError && <small className="field-error">{pinError}</small>}
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={pinInput.length !== 4}
          >
            <Unlock size={15} /> Unlock {card.name}
          </button>
        </form>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {cards.length > 1 && (
            <div className="row" style={{ gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
              {cards.map(c => {
                const cUnlocked = isCardUnlocked(event.id, c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`btn btn-sm ${c.id === card.id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => handleSelectCard(c)}
                  >
                    {!isAdmin && (cUnlocked ? <Unlock size={12} /> : <Lock size={12} />)} {c.name}
                  </button>
                )
              })}
            </div>
          )}

          {/* Station Navigation Header */}
          <div
            ref={headerRef}
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 4,
              padding: '10px 12px',
              borderRadius: 'var(--r)',
              background: 'var(--surface-2)',
              border: '1px solid var(--line-strong)',
              boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
            }}
            className="stack"
          >
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => goToStation(prevIdx)}
                aria-label="Previous station"
              >
                <ChevronLeft size={16} /> S{prevIdx + 1}
              </button>
              <div style={{ textAlign: 'center', minWidth: 0 }}>
                <div className="display" style={{ fontSize: 24, lineHeight: 1.05 }}>
                  {meta.label}
                </div>
                <div className="muted num" style={{ fontSize: 12, marginTop: 3 }}>
                  <strong>{meta.pointsPerPutt} {meta.pointsPerPutt === 1 ? 'pt' : 'pts'} per putt</strong> · max {meta.maxPoints} pts
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => goToStation(nextIdx)}
                aria-label="Next station"
              >
                S{nextIdx + 1} <ChevronRight size={16} />
              </button>
            </div>

            <div className="row" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`chip ${roundKey === 'back' ? 'chip-teal' : 'chip-orange'}`}>
                {halfLabel} · Station {safeStationIdx + 1} of {totalStations}
              </span>
              {isAdmin && (
                <span className="faint" style={{ fontSize: 11 }}>
                  Director edit enabled
                </span>
              )}
            </div>
          </div>

          {/* Per-Player Station Tap Pads with Live Running Total */}
          <div className="stack" style={{ gap: 10 }}>
            {cardEntries.length === 0 ? (
              <div className="muted" style={{ textAlign: 'center', padding: '18px 0' }}>
                No players assigned to this card yet.
              </div>
            ) : (
              cardEntries.map(ent => {
                const name = playerById.get(ent.player_id)?.name ?? 'Unknown Player'
                const currentMake = clampStationMake(ent.station_scores?.[roundKey]?.[inRoundIdx])
                const fVal = displayedFront(ent)
                const bVal = displayedBack(ent)
                const t = totals(ent)
                const running18 =
                  fVal != null || bVal != null
                    ? (fVal ?? 0) + (bVal ?? 0)
                    : t.t18
                const finalPts = ent.score_final ?? t.f
                const runningNight =
                  t.t18 != null ? t.t18 + (finalPts ?? 0) : finalPts

                return (
                  <div key={ent.id} className="stroke-pad">
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span className="strong" style={{ fontSize: 15 }}>{name}</span>
                        {ent.awards?.length > 0 && (
                          <span className="chips" style={{ marginLeft: 0 }}>
                            {ent.awards.map(a => (
                              <span key={a} className="chip chip-teal">{AWARD_SHORT[a]}</span>
                            ))}
                          </span>
                        )}
                      </div>

                      <div className="num" style={{ fontSize: 13, textAlign: 'right' }}>
                        {round === '18' ? (
                          <>
                            <strong style={{ color: 'var(--orange)', fontSize: 15 }}>
                              {running18 != null ? `${running18} pts` : '--'}
                            </strong>
                            <span className="muted" style={{ marginLeft: 6 }}>
                              F9 {fVal ?? '--'} · B9 {bVal ?? '--'}
                            </span>
                          </>
                        ) : (
                          <>
                            <strong style={{ color: 'var(--orange)', fontSize: 15 }}>
                              {runningNight != null ? `${runningNight} pts` : '--'}
                            </strong>
                            <span className="muted" style={{ marginLeft: 6 }}>
                              18h {t.t18 ?? '--'} + F9 {finalPts ?? '--'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="station-pills">
                      {([0, 1, 2] as const).map(makes => {
                        const selected = currentMake === makes
                        const ptsEarned = makes * meta.pointsPerPutt
                        return (
                          <button
                            key={makes}
                            type="button"
                            disabled={isLocked}
                            className={`stroke-pill ${selected ? 'on' : ''}`}
                            onClick={() => void handleTapMake(ent, makes)}
                          >
                            <span className="num strong" style={{ fontSize: 18 }}>{makes}</span>
                            <span style={{ fontSize: 11, opacity: 0.9 }}>
                              {ptsEarned === 0 ? '0 pts' : `+${ptsEarned} ${ptsEarned === 1 ? 'pt' : 'pts'}`}
                            </span>
                          </button>
                        )
                      })}
                    </div>

                    {currentMake != null && !isLocked && (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ height: 24, fontSize: 11 }}
                          onClick={() => void handleTapMake(ent, null)}
                        >
                          Clear station
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Primary Next Station CTA */}
          {(() => {
            const onLastWithGap =
              !allComplete &&
              safeStationIdx === totalStations - 1 &&
              firstMissing !== safeStationIdx
            const ctaTarget = onLastWithGap ? firstMissing : nextIdx
            return (
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => {
                  if (allComplete) {
                    onClose()
                  } else {
                    goToStation(ctaTarget)
                  }
                }}
              >
                {allComplete ? (
                  <>
                    <Check size={16} /> All Stations Complete — View Leaderboard
                  </>
                ) : onLastWithGap ? (
                  <>
                    Finish Missing Station (Station {firstMissing + 1}) <ChevronRight size={16} />
                  </>
                ) : round === '18' && safeStationIdx === 8 ? (
                  <>
                    Start Back 9 ({nextMeta.label}) <ChevronRight size={16} />
                  </>
                ) : (
                  <>
                    Next Station ({nextMeta.label}) <ChevronRight size={16} />
                  </>
                )}
              </button>
            )
          })()}

          {/* Station Scrubber Strip */}
          <div className="hole-scrubber" aria-label="Station selector">
            {Array.from({ length: totalStations }, (_, idx) => {
              const arrKey: 'front' | 'back' | 'final' =
                round === 'final' ? 'final' : idx < 9 ? 'front' : 'back'
              const inner = idx % 9
              const enteredCount = cardEntries.filter(
                e => clampStationMake(e.station_scores?.[arrKey]?.[inner]) != null,
              ).length
              const allEntered = cardEntries.length > 0 && enteredCount === cardEntries.length
              const someEntered = enteredCount > 0 && !allEntered
              let cls = 'hole-pill'
              if (idx === safeStationIdx) cls += ' active'
              if (allEntered) cls += ' done'
              else if (someEntered) cls += ' partial'

              return (
                <Fragment key={idx}>
                  {round === '18' && idx === 9 && (
                    <span className="hole-scrubber-sep" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    className={cls}
                    title={`Station ${idx + 1}: ${PUTT_STATIONS_9[inner].label} (${enteredCount}/${cardEntries.length} scored)`}
                    onClick={() => goToStation(idx)}
                  >
                    <span>{idx + 1}</span>
                  </button>
                </Fragment>
              )
            })}
          </div>

          {/* Expandable Full Card Summary */}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowSummaryTable(v => !v)}
            >
              {showSummaryTable ? 'Hide Card Summary' : 'Show Card Summary'}
            </button>
            <span className="faint" style={{ fontSize: 11 }}>
              {isLocked ? 'Scores locked' : 'Saves automatically on tap'}
            </span>
          </div>

          {showSummaryTable && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="table-wrap">
                <table className="table mini-scorecard">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>{halfLabel}</th>
                      {PUTT_STATIONS_9.map((st, idx) => (
                        <th key={st.index} title={`${st.label} (${st.pointsPerPutt} pt/putt)`}>
                          {roundKey === 'back' ? idx + 10 : idx + 1}
                        </th>
                      ))}
                      <th className="bl">Tot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cardEntries.map(ent => {
                      const pName = playerById.get(ent.player_id)?.name ?? 'Unknown'
                      const arr = ent.station_scores?.[roundKey]
                      const manualNine =
                        !arr &&
                        (roundKey === 'front'
                          ? ent.score_front
                          : roundKey === 'back'
                            ? ent.score_back
                            : ent.score_final)
                      const sumPts = arr ? summarizeStationRound(arr).totalPoints : manualNine
                      return (
                        <tr key={ent.id}>
                          <td className="strong" style={{ textAlign: 'left' }}>{pName}</td>
                          {PUTT_STATIONS_9.map((st, idx) => {
                            const mk = arr ? clampStationMake(arr[idx]) : null
                            return (
                              <td key={st.index} className="num">
                                {mk != null ? mk : manualNine != null ? '·' : '—'}
                              </td>
                            )
                          })}
                          <td className="bl num strong" style={{ color: 'var(--orange)' }}>
                            {sumPts ?? '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="table-wrap">
                <table className="table">
                  <thead>
                    {round === '18' ? (
                      <tr>
                        <th>Player</th>
                        <th className="c">F9 (/50)</th>
                        <th className="c">B9 (/50)</th>
                        <th className="c bl">18 Total</th>
                        <th className="c">Awards</th>
                      </tr>
                    ) : (
                      <tr>
                        <th>Player</th>
                        <th className="c">18 Total</th>
                        <th className="c">F9 B1 (/30)</th>
                        <th className="c">F9 B2 (/20)</th>
                        <th className="c bl">Final 9</th>
                        <th className="c bl">27 Total</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {cardEntries.map(ent => {
                      const pName = playerById.get(ent.player_id)?.name ?? 'Unknown'
                      const f = displayedFront(ent)
                      const b = displayedBack(ent)
                      const t = totals(ent)
                      if (round === '18') {
                        const run18 = f != null || b != null ? (f ?? 0) + (b ?? 0) : t.t18
                        return (
                          <tr key={ent.id}>
                            <td className="strong">{pName}</td>
                            <td className="c num">{f ?? '--'}</td>
                            <td className="c num">{b ?? '--'}</td>
                            <td className="c bl num strong" style={{ color: 'var(--orange)' }}>
                              {run18 ?? '--'}
                            </td>
                            <td className="c">
                              {ent.awards?.length > 0
                                ? ent.awards.map(a => AWARD_SHORT[a]).join(', ')
                                : '--'}
                            </td>
                          </tr>
                        )
                      }
                      const finB1 = summarizeStationRound(ent.station_scores?.final).basket1Points ?? ent.f_b1
                      const finB2 = summarizeStationRound(ent.station_scores?.final).basket2Points ?? ent.f_b2
                      const finTot = ent.score_final ?? t.f
                      const night = t.t18 != null ? t.t18 + (finTot ?? 0) : finTot
                      return (
                        <tr key={ent.id}>
                          <td className="strong">{pName}</td>
                          <td className="c num">{t.t18 ?? '--'}</td>
                          <td className="c num">{finB1 ?? '--'}</td>
                          <td className="c num">{finB2 ?? '--'}</td>
                          <td className="c bl num strong">{finTot ?? '--'}</td>
                          <td className="c bl num strong" style={{ color: 'var(--orange)' }}>
                            {night ?? '--'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
