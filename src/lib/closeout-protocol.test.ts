// Run: npx tsx src/lib/closeout-protocol.test.ts
import assert from "node:assert/strict"
import {
  activationDecision,
  closeAdmission,
  idempotentCloseResult,
  planCorrection,
  cashWindow,
  closeoutReader,
} from "./closeout"

const week1 = { season_id: "81298495-f87c-4d7c-a344-89b97e587d9b", date: "2026-11-05", name: "Week 1" }
const week2 = { season_id: week1.season_id, date: "2026-11-12", name: "Week 2" }

{
  const opened = activationDecision({ status: "scheduled", entryCount: 0, ledgerCount: 0, event: week2 })
  assert.equal(opened.ok, true)
  if (!opened.ok) throw new Error("activation")
  assert.deepEqual(opened.stages, { M: "checkin", W: "checkin" })
  assert.equal(activationDecision({ status: "scheduled", entryCount: 1, ledgerCount: 0, event: week2 }).ok, false)
  assert.equal(activationDecision({ status: "scheduled", entryCount: 1, ledgerCount: 0, event: week2 }).reason, "not_clean")
  assert.equal(activationDecision({ status: "scheduled", entryCount: 0, ledgerCount: 2, event: week2 }).reason, "not_clean")
  assert.equal(activationDecision({ status: "checkin", entryCount: 0, ledgerCount: 0, event: week2 }).reason, "not_scheduled")
  assert.equal(activationDecision({ status: "scheduled", entryCount: 0, ledgerCount: 0, event: week1 }).reason, "week1_frozen")
}

{
  assert.equal(closeAdmission({ legacyPending: true, week1: false, laterPosted: false }).reason, "legacy_pending")
  assert.equal(closeAdmission({ legacyPending: false, week1: true, laterPosted: false }).reason, "week1_frozen")
  assert.equal(closeAdmission({ legacyPending: false, week1: false, laterPosted: true }).reason, "chronology")
  assert.equal(closeAdmission({ legacyPending: false, week1: false, laterPosted: false }).ok, true)
}

{
  const cached = idempotentCloseResult({
    stored: { completed: true, hash: "h1", response: { posted: 1 } },
    hash: "h1",
    fresh: false,
    result: { posted: 2 },
  })
  assert.equal(cached.action, "cached")
  if (cached.action !== "cached") throw new Error("cache")
  assert.deepEqual(cached.result, { posted: 1 })
  assert.equal(idempotentCloseResult({
    stored: { completed: true, hash: "h1", response: { posted: 1 } },
    hash: "h2",
    fresh: true,
    result: { posted: 2 },
  }).action, "collision")
  assert.equal(idempotentCloseResult({ stored: null, hash: "h1", fresh: false, result: { posted: 1 } }).action, "stale")
  const proceed = idempotentCloseResult({ stored: null, hash: "h1", fresh: true, result: { posted: 1 } })
  assert.equal(proceed.action, "proceed")
  if (proceed.action !== "proceed") throw new Error("proceed")
  assert.deepEqual(proceed.result, { posted: 1 })
}

{
  const up = planCorrection({ event: week2, bookedCash: 120, targetCash: 130 })
  assert.equal(up.ok, true)
  if (!up.ok) throw new Error("up")
  assert.equal(up.cashDelta, 10)
  assert.equal(up.legs.find((row) => row.fund === "purse")?.amount, -10)
  const down = planCorrection({ event: week2, bookedCash: 130, targetCash: 125 })
  assert.equal(down.ok, true)
  if (!down.ok) throw new Error("down")
  assert.equal(down.cashDelta, -5)
  assert.equal(down.legs.find((row) => row.fund === "purse")?.amount, 5)
  const same = planCorrection({ event: week2, bookedCash: 125, targetCash: 125, externalPerfect4: 20 })
  assert.equal(same.ok, true)
  if (!same.ok) throw new Error("same")
  assert.equal(same.cashDelta, 0)
  assert.deepEqual(same.legs, [])
  const frozen = planCorrection({ event: week1, bookedCash: 120, targetCash: 130 })
  assert.equal(frozen.ok, false)
  if (frozen.ok) throw new Error("frozen")
  assert.equal(frozen.reason, "week1_frozen")
  assert.deepEqual(frozen.legs, [])
}

{
  const waiting = cashWindow({ cashDue: 10, acknowledged: false, handled: 0 })
  assert.equal(waiting.actionable, 10)
  assert.equal(waiting.state, "awaiting")
  const bad = cashWindow({
    cashDue: 10,
    acknowledged: true,
    confirmation: "paid",
    handled: 10,
  })
  assert.equal(bad.confirmationOk, false)
  const confirmed = cashWindow({
    cashDue: 10,
    acknowledged: true,
    confirmation: "All cash differences shown have been physically settled.",
    handled: 10,
  })
  assert.equal(confirmed.confirmationOk, true)
  assert.equal(confirmed.state, "applied")
  const pending = cashWindow({
    cashDue: 10,
    acknowledged: true,
    confirmation: "All cash differences shown have been physically settled.",
    handled: 10,
    applyFailed: true,
  })
  assert.equal(pending.state, "cash confirmed, posting pending")
  assert.equal(pending.actionable, 0)
  const short = cashWindow({
    cashDue: 10,
    acknowledged: true,
    confirmation: "All cash differences shown have been physically settled.",
    handled: 4,
  })
  assert.equal(short.state, "awaiting")
  assert.equal(short.actionable, 6)
}

{
  const view = closeoutReader({ closed: true, sharedPosted: false, correctionPending: true, deficit: 4 })
  assert.equal(view.closed, true)
  assert.equal(view.sharedPosted, false)
  assert.equal(view.correctionPending, true)
  assert.equal(view.fundingNeeded, "funding needed: $4.00; no payout posted")
  const clear = closeoutReader({ closed: false, sharedPosted: false, correctionPending: false, deficit: 0 })
  assert.equal(clear.fundingNeeded, null)
}

console.log("closeout protocol tests defined")
