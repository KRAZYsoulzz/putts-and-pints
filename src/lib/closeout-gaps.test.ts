// Run: npx tsx src/lib/closeout-gaps.test.ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DEFAULT_SETTINGS as S } from "./settings"
import { planSplitClose, planCorrection } from "./closeout"

const week2 = { season_id: "81298495-f87c-4d7c-a344-89b97e587d9b", date: "2026-11-12", name: "Week 2" }
const failures: string[] = []
function check(name: string, fn: () => void) {
  try { fn() } catch (err) { failures.push(name + ": " + (err instanceof Error ? err.message : String(err))) }
}
function bal(over: Record<string, number> = {}) {
  return { perfect_round: 0, backup: 0, perfect5: 0, perfect4: 0, high_score: 0, tag_fund: 0, purse: 0, ...over }
}

check("correction division W", () => {
  const plan = planCorrection({ event: week2, bookedCash: 120, targetCash: 130, division: "W" })
  assert.equal(plan.ok, true)
  if (!plan.ok) throw new Error("refused")
  assert.equal(plan.legs[0].division, "W")
  assert.equal(plan.legs[0].amount, -10)
})

check("director confirmation is an input", () => {
  const source = readFileSync(fileURLToPath(new URL("../components/CorrectionDraftPanel.tsx", import.meta.url)), "utf8")
  assert.equal(source.includes("acknowledged: true"), false)
  assert.equal(source.includes("acknowledged"), true)
  assert.equal(source.includes("confirmation"), true)
})

check("planner calls debit solvency", () => {
  const plan = planSplitClose({
    settings: S,
    entries: [{ id: "m1", player_id: "m1", division: "M", created_at: "2026-11-12T00:00:01", awards: [], place: 1 }],
    balances: { M: bal({ purse: -1 }), W: bal() },
    bar: { M: 0, W: 0 },
    openingNight: true,
  })
  assert.equal(plan.ok, false)
  if (plan.ok) throw new Error("solvent")
  assert.equal(plan.reason, "insolvent")
  assert.deepEqual(plan.legs, [])
})

check("women can close first", () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    id: "w" + (i + 1),
    player_id: "w" + (i + 1),
    division: "W" as const,
    created_at: "2026-11-12T01:00:0" + (i + 1),
    awards: [] as string[],
    place: i + 1,
  }))
  const plan = planSplitClose({
    settings: S,
    entries,
    balances: { M: bal(), W: bal() },
    bar: { M: 0, W: 0 },
    openingNight: true,
    firstDivision: "W",
  })
  assert.equal(plan.ok, true)
  if (!plan.ok) throw new Error("refused")
  const entry = (rows: { fund: string; kind: string; division: string; amount: number }[]) =>
    rows.filter((r) => r.division === "W" && r.fund === "purse" && r.kind === "entry").reduce((s, r) => s + r.amount, 0)
  assert.equal(entry(plan.firstLegs), 40)
  assert.equal(entry(plan.secondLegs), 0)
  assert.equal(plan.firstLegs.some((r) => r.fund === "perfect4" || r.fund === "perfect5"), false)
})

check("preview sql executes and policies exist", () => {
  const sql = readFileSync(fileURLToPath(new URL("../../supabase/pp_finance_010_division_closeout.sql", import.meta.url)), "utf8")
  assert.equal(sql.includes("0A000"), false)
  assert.equal(/not installed/i.test(sql), false)
  assert.match(sql, /create policy/i)
  assert.match(sql, /returns jsonb/i)
  assert.match(sql, /pp_finance_owner/)
})

if (failures.length) {
  console.log(failures.join("\n"))
  process.exit(1)
}
console.log("closeout gap tests defined")
