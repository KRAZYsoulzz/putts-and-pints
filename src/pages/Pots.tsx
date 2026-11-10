import { useMemo, useState } from 'react'
import { PlusCircle, ShieldAlert, Sparkles, Tag } from 'lucide-react'
import { messageOf } from '../lib/notify'
import { useData, must } from '../lib/store'
import { supabase } from '../lib/supabase'
import { balances, sharedPotBalance } from '../lib/money'
import { seasonHighScoreRecord } from '../lib/scoring'
import {
  FUND_LABEL,
  KIND_LABEL,
  type Division,
  type Fund,
  type LedgerKind,
} from '../lib/types'
import { Dialog, DivisionSeg, MoneyInput, PageHead, fmtDate, money } from '../components/ui'

export default function Pots() {
  const { ledger, players, events, entries, playerById, season, settings, isAdmin, reload } = useData()
  const [division, setDivision] = useState<Division>('M')
  const [adjustModal, setAdjustModal] = useState(false)

  // Form states for manual adjustments / transfers
  const [targetFund, setTargetFund] = useState<Fund>('perfect_round')
  const [targetDivision, setTargetDivision] = useState<Division | 'ALL'>('M')
  const [kind, setKind] = useState<LedgerKind>('adjustment')
  const [amount, setAmount] = useState<number>(0)
  const [note, setNote] = useState('')
  const [adjustError, setAdjustError] = useState('')

  const menBalances = useMemo(() => balances(ledger, 'M'), [ledger])
  const womenBalances = useMemo(() => balances(ledger, 'W'), [ledger])
  const curBalances = division === 'M' ? menBalances : womenBalances
  const sharedPerfect5 = useMemo(() => sharedPotBalance(ledger, 'perfect5'), [ledger])
  const sharedPerfect4 = useMemo(() => sharedPotBalance(ledger, 'perfect4'), [ledger])
  const sharedTagFund = useMemo(() => sharedPotBalance(ledger, 'tag_fund'), [ledger])
  const inTagsCount = players.filter(p => p.in_tags).length

  const highScoreRecord = useMemo(() => {
    return seasonHighScoreRecord({
      entries,
      events,
      division,
      playerById,
    })
  }, [entries, events, division, playerById])

  const isPublicVisible = (potKey: string) => {
    const isPerDiv = potKey === 'perfect_round' || potKey === 'backup'
    const divKey = `${potKey}_${division}`
    if (isPerDiv && settings.pp_pot_visibility?.[divKey] !== undefined) {
      return settings.pp_pot_visibility[divKey] !== false
    }
    if (settings.pp_pot_visibility?.[potKey] !== undefined) {
      return settings.pp_pot_visibility[potKey] !== false
    }
    return settings.potsVisibility?.[potKey as Fund] !== false
  }

  const isPotVisible = (potKey: string) => {
    if (isAdmin) return true
    return isPublicVisible(potKey)
  }

  const togglePotVisibility = async (potKey: string) => {
    if (!isAdmin || !season) return
    const isPerDiv = potKey === 'perfect_round' || potKey === 'backup'
    const targetKey = isPerDiv ? `${potKey}_${division}` : potKey
    const current = isPublicVisible(potKey)
    const nextVal = !current

    const nextPpVis = {
      ...(season.settings?.pp_pot_visibility ?? {}),
      [targetKey]: nextVal,
      [potKey]: nextVal,
    }
    const nextPotsVis = {
      ...settings.potsVisibility,
      [potKey]: nextVal,
    }
    const nextSettings = {
      ...season.settings,
      potsVisibility: nextPotsVis,
      pp_pot_visibility: nextPpVis,
    }

    try {
      await must(
        supabase.from('pp_seasons').update({ settings: nextSettings }).eq('id', season.id)
      )
      reload()
    } catch (err) {
      console.error(err)
    }
  }

  // Filtered ledger history
  const filteredLedger = useMemo(() => {
    return [...ledger]
      .filter((r) => r.division == null || r.division === division)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [ledger, division])

  const handlePostAdjustment = async () => {
    if (!season) {
      setAdjustError('Create or activate a season before posting to the ledger.')
      return
    }
    if (!amount) {
      setAdjustError('Enter an amount.')
      return
    }
    setAdjustError('')
    const isShared = targetFund === 'tag_fund' || targetFund === 'perfect5' || targetFund === 'perfect4'
    const div = isShared ? null : targetDivision === 'ALL' ? division : targetDivision
    try {
      await must(
        supabase.from('pp_ledger').insert({
          season_id: season.id,
          division: div,
          fund: targetFund,
          kind,
          amount,
          note: note.trim() || 'Manual adjustment by admin',
        }),
      )
    } catch (err) {
      setAdjustError(messageOf(err))
      return
    }

    setAdjustModal(false)
    setAmount(0)
    setNote('')
    reload()
  }

  const capPct = Math.min(100, Math.round((curBalances.perfect_round / settings.perfectRoundCap) * 100))

  return (
    <div className="pots-page">
      <PageHead eyebrow="Ledger & Financials" title="Pot Balances & Funds">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <DivisionSeg value={division} onChange={setDivision} />
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setAdjustModal(true)}>
              <PlusCircle size={16} /> Adjust / Transfer Pot
            </button>
          )}
        </div>
      </PageHead>

      {/* Pots Grid */}
      <div className="grid-cols section">
        {/* Perfect Round Pot Card */}
        {isPotVisible('perfect_round') && (
          <div className="panel panel-pad stack">
            <div className="eyebrow" style={{ color: 'var(--orange)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Perfect Round Pot ({division === 'M' ? "Men's" : "Women's"})
              </span>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {!isPublicVisible('perfect_round') && (
                    <span className="chip chip-tag" style={{ fontSize: 11, color: 'var(--text)' }}>Hidden from public</span>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => togglePotVisibility('perfect_round')}
                  >
                    {isPublicVisible('perfect_round') ? 'Hide' : 'Show'}
                  </button>
                </div>
              )}
            </div>
            <div className="display" style={{ fontSize: 38, color: 'var(--orange)' }}>
              {money(curBalances.perfect_round)}
            </div>
            <div className="bar">
              <i style={{ width: `${capPct}%` }} />
            </div>
            <div className="kv" style={{ border: 0, padding: 0 }}>
              <span className="faint" style={{ fontSize: 12 }}>Cap: ${settings.perfectRoundCap}</span>
              <span className="faint" style={{ fontSize: 12 }}>{capPct}% filled</span>
            </div>
          </div>
        )}

        {/* Backup Pot Card */}
        {isPotVisible('backup') && (
          <div className="panel panel-pad stack">
            <div className="eyebrow" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <ShieldAlert size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Backup Pot ({division === 'M' ? "Men's" : "Women's"})
              </span>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {!isPublicVisible('backup') && (
                    <span className="chip chip-tag" style={{ fontSize: 11 }}>Hidden from public</span>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => togglePotVisibility('backup')}
                  >
                    {isPublicVisible('backup') ? 'Hide' : 'Show'}
                  </button>
                </div>
              )}
            </div>
            <div className="display" style={{ fontSize: 38, color: 'var(--teal)' }}>
              {money(curBalances.backup)}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Overflow dollars beyond the ${settings.perfectRoundCap} Perfect Round cap.
            </p>
          </div>
        )}

        {/* Perfect 5 Pot Card (Shared across both divisions) */}
        {isPotVisible('perfect5') && (
          <div className="panel panel-pad stack">
            <div className="eyebrow" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Perfect 5 Pot · Shared (Men's &amp; Women's)</span>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {!isPublicVisible('perfect5') && (
                    <span className="chip chip-tag" style={{ fontSize: 11 }}>Hidden from public</span>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => togglePotVisibility('perfect5')}
                  >
                    {isPublicVisible('perfect5') ? 'Hide' : 'Show'}
                  </button>
                </div>
              )}
            </div>
            <div className="display" style={{ fontSize: 38 }}>
              {money(sharedPerfect5)}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              One shared pot for both divisions. A win adds {money(settings.bonus.perfect5)} once, split across everyone who hits it.
            </p>
          </div>
        )}

        {/* Perfect 4 Pot Card (Shared across both divisions) */}
        {isPotVisible('perfect4') && (
          <div className="panel panel-pad stack">
            <div className="eyebrow" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Perfect 4 Pot · Shared (Men's &amp; Women's)</span>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {!isPublicVisible('perfect4') && (
                    <span className="chip chip-tag" style={{ fontSize: 11 }}>Hidden from public</span>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => togglePotVisibility('perfect4')}
                  >
                    {isPublicVisible('perfect4') ? 'Hide' : 'Show'}
                  </button>
                </div>
              )}
            </div>
            <div className="display" style={{ fontSize: 38 }}>
              {money(sharedPerfect4)}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              One shared pot for both divisions. A win adds {money(settings.bonus.perfect4)} once, split across everyone who hits it.
            </p>
          </div>
        )}

        {/* High Score Record Card */}
        {isPotVisible('high_score') && (
          <div className="panel panel-pad stack">
            <div className="eyebrow" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>High Score Record ({division === 'M' ? "Men's" : "Women's"})</span>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {!isPublicVisible('high_score') && (
                    <span className="chip chip-tag" style={{ fontSize: 11 }}>Hidden from public</span>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => togglePotVisibility('high_score')}
                  >
                    {isPublicVisible('high_score') ? 'Hide' : 'Show'}
                  </button>
                </div>
              )}
            </div>
            <div className="display" style={{ fontSize: 38 }}>
              {highScoreRecord.score != null ? `${highScoreRecord.score} pts` : 'No record yet'}
            </div>
            {highScoreRecord.holders.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                <span className="faint" style={{ fontSize: 12 }}>Record holder{highScoreRecord.holders.length > 1 ? 's' : ''}:</span>
                {highScoreRecord.holders.map(name => (
                  <span key={name} className="chip chip-tag" style={{ fontWeight: 600 }}>
                    {name}
                  </span>
                ))}
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              ${settings.bonus.highScore} bonus for beating the season high score record (including Final 9).
            </p>
          </div>
        )}

        {/* Unallocated night purse */}
        {isPotVisible('purse') && (
          <div className="panel panel-pad stack">
            <div className="eyebrow" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Payout Purse ({division === 'M' ? "Men's" : "Women's"})</span>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {!isPublicVisible('purse') && (
                    <span className="chip chip-tag" style={{ fontSize: 11 }}>Hidden from public</span>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => togglePotVisibility('purse')}
                  >
                    {isPublicVisible('purse') ? 'Hide' : 'Show'}
                  </button>
                </div>
              )}
            </div>
            <div className="display" style={{ fontSize: 38 }}>
              {money(curBalances.purse)}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Entry payout share plus the bar match, minus bonuses and place checks. Zero means the night was fully paid out.
            </p>
          </div>
        )}

        {/* Tag Fund Card */}
        {isPotVisible('tag_fund') && (
          <div className="panel panel-pad stack">
            <div className="eyebrow" style={{ color: 'var(--lime)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <Tag size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Tag Fund (Season-Wide)
              </span>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {!isPublicVisible('tag_fund') && (
                    <span className="chip chip-tag" style={{ fontSize: 11, color: 'var(--text)' }}>Hidden from public</span>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => togglePotVisibility('tag_fund')}
                  >
                    {isPublicVisible('tag_fund') ? 'Hide' : 'Show'}
                  </button>
                </div>
              )}
            </div>
            <div className="display" style={{ fontSize: 38, color: 'var(--lime)' }}>
              {money(sharedTagFund)}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {inTagsCount} in tags × {money(settings.tagPrice)}. The balance itself is still posted by hand.
            </p>
          </div>
        )}
      </div>

      {/* Ledger Audit Table */}
      {isAdmin && (
        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Ledger Activity &amp; Audit Trail</span>
            <span className="faint" style={{ fontSize: 12 }}>Every dollar accounted for</span>
          </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Date</th>
                <th>Fund</th>
                <th className="c" style={{ width: 100 }}>Type</th>
                <th>Notes / Details</th>
                <th className="r bl" style={{ width: 100 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {filteredLedger.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '36px 0' }} className="muted">
                    No ledger entries recorded yet.
                  </td>
                </tr>
              ) : (
                filteredLedger.map((row) => {
                  const isPositive = row.amount >= 0
                  return (
                    <tr key={row.id}>
                      <td className="faint">{fmtDate(row.created_at.slice(0, 10))}</td>
                      <td className="strong">{FUND_LABEL[row.fund]}</td>
                      <td className="c">
                        <span className="chip chip-tag">{KIND_LABEL[row.kind] ?? row.kind}</span>
                      </td>
                      <td className="muted">{row.note ?? '—'}</td>
                      <td
                        className="r bl num strong"
                        style={{ color: isPositive ? 'var(--teal)' : 'var(--danger)' }}
                      >
                        {isPositive ? `+${money(row.amount)}` : money(row.amount)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Adjust Pot Dialog */}
      {adjustModal && (
        <Dialog title="Adjust / Transfer Pot" onClose={() => setAdjustModal(false)}>
          <div className="stack">
            <div className="field">
              <span>Select Fund</span>
              <select
                className="select"
                value={targetFund}
                onChange={(e) => setTargetFund(e.target.value as Fund)}
              >
                <option value="perfect_round">Perfect Round Pot</option>
                <option value="backup">Backup Pot</option>
                <option value="perfect5">Perfect 5 Pot</option>
                <option value="perfect4">Perfect 4 Pot</option>
                <option value="high_score">High Score Pot</option>
                <option value="tag_fund">Tag Fund (Season-Wide)</option>
                <option value="purse">Payout Purse</option>
              </select>
            </div>

            {targetFund !== 'tag_fund' && targetFund !== 'perfect5' && targetFund !== 'perfect4' && (
              <div className="field">
                <span>Division</span>
                <select
                  className="select"
                  value={targetDivision}
                  onChange={(e) => setTargetDivision(e.target.value as Division)}
                >
                  <option value="M">Men's Division</option>
                  <option value="W">Women's Division</option>
                </select>
              </div>
            )}

            <div className="field">
              <span>Transaction Type</span>
              <select
                className="select"
                value={kind}
                onChange={(e) => setKind(e.target.value as LedgerKind)}
              >
                <option value="carryover">Last Year Carryover</option>
                <option value="adjustment">Manual Adjustment</option>
                <option value="transfer">Transfer from Another Pot</option>
                <option value="tag_sale">Tag Sale ($20)</option>
                <option value="expense">Expense (Trophy, Tags)</option>
              </select>
            </div>

            <div className="field">
              <span>Amount ($) — use negative for deductions</span>
              <MoneyInput value={amount} allowNegative onChange={setAmount} />
            </div>

            <div className="field">
              <span>Explanation Note (Required for records)</span>
              <input
                className="input"
                type="text"
                placeholder="e.g. Carried over from 2025 season"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {adjustError && <small className="field-error">{adjustError}</small>}
            <div style={{ marginTop: 14 }}>
              <button
                className="btn btn-primary btn-block"
                onClick={handlePostAdjustment}
              >
                Save Ledger Entry
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
