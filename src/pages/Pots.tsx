import { useMemo, useState } from 'react'
import { PlusCircle, ShieldAlert, Sparkles, Tag } from 'lucide-react'
import { useData, must } from '../lib/store'
import { supabase } from '../lib/supabase'
import { balances } from '../lib/money'
import {
  FUND_LABEL,
  type Division,
  type Fund,
  type LedgerKind,
} from '../lib/types'
import { Dialog, DivisionSeg, MoneyInput, PageHead, fmtDate, money } from '../components/ui'

export default function Pots() {
  const { ledger, season, settings, isAdmin, reload } = useData()
  const [division, setDivision] = useState<Division>('M')
  const [adjustModal, setAdjustModal] = useState(false)

  // Form states for manual adjustments / transfers
  const [targetFund, setTargetFund] = useState<Fund>('perfect_round')
  const [targetDivision, setTargetDivision] = useState<Division | 'ALL'>('M')
  const [kind, setKind] = useState<LedgerKind>('adjustment')
  const [amount, setAmount] = useState<number>(0)
  const [note, setNote] = useState('')

  const curBalances = useMemo(() => balances(ledger, division), [ledger, division])

  // Filtered ledger history
  const filteredLedger = useMemo(() => {
    return [...ledger]
      .filter((r) => r.division == null || r.division === division)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [ledger, division])

  const handlePostAdjustment = async () => {
    if (!amount || !season) return
    const div = targetFund === 'tag_fund' ? null : targetDivision === 'ALL' ? division : targetDivision
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

    setAdjustModal(false)
    setAmount(0)
    setNote('')
    reload()
  }

  const capPct = Math.min(100, Math.round((curBalances.perfect_round / settings.perfectRoundCap) * 100))

  return (
    <div className="pots-page">
      <PageHead eyebrow="Ledger & Financials" title="Pot Balances & Funds">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
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
        {settings.potsVisibility?.perfect_round !== false && (
          <div className="panel panel-pad stack">
            <div className="eyebrow" style={{ color: 'var(--orange)' }}>
              <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Perfect Round Pot ({division === 'M' ? "Men's" : "Women's"})
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
        {settings.potsVisibility?.backup !== false && (
          <div className="panel panel-pad stack">
            <div className="eyebrow">
              <ShieldAlert size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Backup Pot ({division === 'M' ? "Men's" : "Women's"})
            </div>
            <div className="display" style={{ fontSize: 38, color: 'var(--teal)' }}>
              {money(curBalances.backup)}
            </div>
          </div>
        )}

        {/* Perfect 5 Pot Card */}
        {settings.potsVisibility?.perfect5 !== false && (
          <div className="panel panel-pad stack">
            <div className="eyebrow">Perfect 5 Pot</div>
            <div className="display" style={{ fontSize: 38 }}>
              {money(curBalances.perfect5)}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              $10 bonus for hitting all 5 stations on Basket 1. Multiple winners split.
            </p>
          </div>
        )}

        {/* Perfect 4 Pot Card */}
        {settings.potsVisibility?.perfect4 !== false && (
          <div className="panel panel-pad stack">
            <div className="eyebrow">Perfect 4 Pot</div>
            <div className="display" style={{ fontSize: 38 }}>
              {money(curBalances.perfect4)}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              $10 bonus for hitting all 4 stations on Basket 2. Multiple winners split.
            </p>
          </div>
        )}

        {/* High Score Pot Card */}
        {settings.potsVisibility?.high_score !== false && (
          <div className="panel panel-pad stack">
            <div className="eyebrow">High Score Pot</div>
            <div className="display" style={{ fontSize: 38 }}>
              {money(curBalances.high_score)}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              $10 bonus for beating the season high score record (including Final 9).
            </p>
          </div>
        )}

        {/* Tag Fund Card */}
        {settings.potsVisibility?.tag_fund !== false && (
          <div className="panel panel-pad stack">
            <div className="eyebrow" style={{ color: 'var(--lime)' }}>
              <Tag size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Tag Fund (Season-Wide)
            </div>
            <div className="display" style={{ fontSize: 38, color: 'var(--lime)' }}>
              {money(curBalances.tag_fund)}
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Funded by $20 tag purchases. Used for physical tags, trophy funds, and bonus subsidies.
            </p>
          </div>
        )}
      </div>

      {/* Ledger Audit Table */}
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
                        <span className="chip chip-tag">{row.kind}</span>
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
              </select>
            </div>

            {targetFund !== 'tag_fund' && (
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
              <MoneyInput value={amount} onChange={setAmount} />
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

            <div style={{ marginTop: 14 }}>
              <button
                className="btn btn-primary btn-block"
                disabled={!amount}
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
