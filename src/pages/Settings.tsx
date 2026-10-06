import { useState } from 'react'
import { Check, RotateCcw, Save } from 'lucide-react'
import { useData, must } from '../lib/store'
import { supabase } from '../lib/supabase'
import { DEFAULT_SETTINGS } from '../lib/settings'
import type { Settings } from '../lib/types'
import { MoneyInput, PageHead } from '../components/ui'

export default function SettingsPage() {
  const { season, settings: initialSettings, isAdmin, reload } = useData()
  const [form, setForm] = useState<Settings>(initialSettings)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    if (!season) return
    await must(
      supabase
        .from('pp_seasons')
        .update({ settings: form })
        .eq('id', season.id),
    )
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    reload()
  }

  const handleResetDefaults = () => {
    if (confirm('Reset all settings to default tournament rules?')) {
      setForm(DEFAULT_SETTINGS)
    }
  }

  return (
    <div className="settings-page">
      <PageHead eyebrow="Tournament Rules & Configuration" title="Season Settings">
        {isAdmin && (
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={handleResetDefaults}>
              <RotateCcw size={14} /> Reset Defaults
            </button>
            <button className="btn btn-primary" onClick={handleSave}>
              {saved ? <Check size={16} /> : <Save size={16} />}
              {saved ? 'Saved!' : 'Save Settings'}
            </button>
          </div>
        )}
      </PageHead>

      <div className="grid-cols" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Entry & Pot Finances */}
        <div className="panel panel-pad stack">
          <div className="eyebrow">Entry &amp; Finances</div>

          <div className="field">
            <span>Entry Fee ($)</span>
            <MoneyInput
              value={form.entryFee}
              onChange={(v) => setForm((s) => ({ ...s, entryFee: v }))}
            />
            <small>Default $10 per player</small>
          </div>

          <div className="field">
            <span>Perfect Round Pot Share ($)</span>
            <MoneyInput
              value={form.perfectRoundShare}
              onChange={(v) => setForm((s) => ({ ...s, perfectRoundShare: v }))}
            />
            <small>Default $2 subtracted from entry towards the Perfect Round pot</small>
          </div>

          <div className="field">
            <span>Bar Match Percentage (%)</span>
            <input
              className="input num"
              type="number"
              value={form.barMatchPct}
              onChange={(e) =>
                setForm((s) => ({ ...s, barMatchPct: parseFloat(e.target.value) || 0 }))
              }
            />
            <small>Default 50% match of total entry fees by the bar</small>
          </div>

          <div className="field">
            <span>Perfect Round Pot Cap ($)</span>
            <MoneyInput
              value={form.perfectRoundCap}
              onChange={(v) => setForm((s) => ({ ...s, perfectRoundCap: v }))}
            />
            <small>Default $250. Dollars past cap flow to the Backup Pot</small>
          </div>

          <div className="field">
            <span>Tag Price ($)</span>
            <MoneyInput
              value={form.tagPrice}
              onChange={(v) => setForm((s) => ({ ...s, tagPrice: v }))}
            />
            <small>One-time $20 fee going to the Tag Fund</small>
          </div>
        </div>

        {/* Bonus Amounts */}
        <div className="panel panel-pad stack">
          <div className="eyebrow">Bonus Awards ($)</div>

          <div className="field">
            <span>Perfect 5 Bonus ($)</span>
            <MoneyInput
              value={form.bonus.perfect5}
              onChange={(v) =>
                setForm((s) => ({ ...s, bonus: { ...s.bonus, perfect5: v } }))
              }
            />
            <small>Basket 1 all 5 stations made (both discs)</small>
          </div>

          <div className="field">
            <span>Perfect 4 Bonus ($)</span>
            <MoneyInput
              value={form.bonus.perfect4}
              onChange={(v) =>
                setForm((s) => ({ ...s, bonus: { ...s.bonus, perfect4: v } }))
              }
            />
            <small>Basket 2 all 4 stations made (both discs)</small>
          </div>

          <div className="field">
            <span>High Score Record Bonus ($)</span>
            <MoneyInput
              value={form.bonus.highScore}
              onChange={(v) =>
                setForm((s) => ({ ...s, bonus: { ...s.bonus, highScore: v } }))
              }
            />
            <small>Awarded when beating the division season high score (tied does not count)</small>
          </div>
        </div>

        {/* Ties & Cut Configuration */}
        <div className="panel panel-pad stack">
          <div className="eyebrow">Tiebreaks &amp; Final 9 Cut</div>

          <div className="field">
            <span>Placement Ties Handling</span>
            <select
              className="select"
              value={form.ties.placement}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  ties: { ...s.ties, placement: e.target.value as any },
                }))
              }
            >
              <option value="split">Split Evenly (Share place &amp; average payouts/points)</option>
              <option value="playoff">Playoff (Manual tiebreak input by Les)</option>
              <option value="countback">Countback (Auto-break by Final 9, Round 2, Round 1)</option>
            </select>
          </div>

          <div className="field">
            <span>Final 9 Cut Line Ties</span>
            <select
              className="select"
              value={form.ties.cut}
              onChange={(e) =>
                setForm((s) => ({
                  ...s,
                  ties: { ...s.ties, cut: e.target.value as any },
                }))
              }
            >
              <option value="include">Include All Tied at Cut Line</option>
              <option value="playoff">Playoff for Final Spot</option>
              <option value="countback">Countback</option>
            </select>
          </div>

          <div className="field">
            <span>Cut Calculation Rounding</span>
            <select
              className="select"
              value={form.cutRounding}
              onChange={(e) =>
                setForm((s) => ({ ...s, cutRounding: e.target.value as any }))
              }
            >
              <option value="down">Round Down (e.g. 13 players → 6 advance)</option>
              <option value="up">Round Up (e.g. 13 players → 7 advance)</option>
            </select>
          </div>

          <div className="field">
            <span>Payout Depth (1 in every X players)</span>
            <input
              className="input num"
              type="number"
              value={form.paidEvery}
              onChange={(e) =>
                setForm((s) => ({ ...s, paidEvery: parseInt(e.target.value, 10) || 5 }))
              }
            />
            <small>Default 1 place paid per 5 players entered</small>
          </div>
        </div>
      </div>
    </div>
  )
}
