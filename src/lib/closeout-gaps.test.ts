// Run: npx tsx src/lib/closeout-gaps.test.ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { DEFAULT_SETTINGS as S } from "./settings"
import * as closeout from "./closeout"
import { planSplitClose, planCorrection } from "./closeout"

const week1 = { id: "ev-w1", season_id: "81298495-f87c-4d7c-a344-89b97e587d9b", date: "2026-11-05", name: "Week 1" }
const week2 = { id: "ev-w2", season_id: "81298495-f87c-4d7c-a344-89b97e587d9b", date: "2026-11-12", name: "Week 2" }
const week3 = { id: "ev-w3", season_id: "81298495-f87c-4d7c-a344-89b97e587d9b", date: "2026-11-19", name: "Week 3" }
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

check("correction calls debitSolvency and refuses when pots lack funds", () => {
  const insolvent = planCorrection({
    event: week2,
    division: "W",
    bookedCash: 120,
    targetCash: 135,
    balances: { M: bal({ purse: 100 }), W: bal({ purse: 10 }) },
  } as Parameters<typeof planCorrection>[0])
  assert.equal(insolvent.ok, false)
  if (insolvent.ok) throw new Error("should refuse insolvent correction")
  assert.equal((insolvent as { reason: string }).reason, "insolvent")
  assert.deepEqual(insolvent.legs, [])
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

check("women can close first and release held reserve to women perfect round and backup", () => {
  const entries = [
    ...Array.from({ length: 5 }, (_, i) => ({
      id: "w" + (i + 1),
      player_id: "w" + (i + 1),
      division: "W" as const,
      created_at: "2026-11-12T01:00:0" + (i + 1),
      awards: i === 0 ? (["perfect4"] as string[]) : ([] as string[]),
      place: i + 1,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      id: "m" + (i + 1),
      player_id: "m" + (i + 1),
      division: "M" as const,
      created_at: "2026-11-12T02:00:0" + (i + 1),
      awards: i === 0 ? (["perfect4"] as string[]) : ([] as string[]),
      place: i + 1,
    })),
  ]
  const plan = planSplitClose({
    settings: S,
    entries,
    balances: { M: bal(), W: bal({ perfect_round: 242 }) },
    bar: { M: 0, W: 0 },
    openingNight: true,
    firstDivision: "W",
  })
  assert.equal(plan.ok, true)
  if (!plan.ok) throw new Error("refused")
  const entry = (rows: { fund: string; kind: string; division: string; amount: number }[], div: string) =>
    rows.filter((r) => r.division === div && r.fund === "purse" && r.kind === "entry").reduce((s, r) => s + r.amount, 0)
  assert.equal(entry(plan.firstLegs, "W"), 40)
  assert.equal(entry(plan.secondLegs, "W"), 0)
  assert.equal(entry(plan.secondLegs, "M"), 40)
  assert.equal(plan.firstLegs.some((r) => r.fund === "perfect4" || r.fund === "perfect5"), false)
  assert.equal(plan.heldReserve.W.perfect4, 10)
  assert.equal(plan.heldReserve.M.perfect4, 0)
  assert.equal(plan.released.W, 5)
  // Women's PR started at 242, +8 fits from 5x$2 entries (2 overlaps to backup), so PR is at 250; the $5 released reserve overflows to Women's backup
  assert.ok(plan.secondLegs.some((r) => r.division === "W" && r.fund === "backup" && r.kind === "overflow" && r.amount === 5))
})

check("stepwise division close keeps first division places unchanged and is idempotent", () => {
  const closeStep = (closeout as Record<string, unknown>).closeDivisionStep as undefined | ((args: unknown) => unknown)
  assert.equal(typeof closeStep, "function", "closeDivisionStep should exist")
  if (typeof closeStep !== "function") return

  const entries = [
    { id: "w1", player_id: "w1", division: "W" as const, created_at: "2026-11-12T01:00:01", awards: ["perfect5"], place: 1 },
    { id: "w2", player_id: "w2", division: "W" as const, created_at: "2026-11-12T01:00:02", awards: [], place: 2 },
    { id: "m1", player_id: "m1", division: "M" as const, created_at: "2026-11-12T02:00:01", awards: ["perfect5"], place: 1 },
    { id: "m2", player_id: "m2", division: "M" as const, created_at: "2026-11-12T02:00:02", awards: [], place: 2 },
  ]
  const step1 = closeStep({
    event: week2,
    division: "W",
    requestId: "req-w",
    payloadHash: "hash-w",
    settings: S,
    entries,
    balances: { M: bal({ perfect5: 10 }), W: bal({ perfect5: 10 }) },
    bar: { M: 10, W: 10 },
    openingNight: true,
  }) as { ok: boolean; state: unknown; postedLegs: { division: string; fund: string; kind: string; amount: number; player_id: string | null }[]; paidPlaces: Record<string, Record<string, number>> }
  assert.equal(step1.ok, true)
  assert.equal(step1.postedLegs.some((l) => l.fund === "perfect5"), false, "shared P5 held on first close")
  const w1PaidAfterStep1 = step1.paidPlaces.W.w1
  assert.ok(w1PaidAfterStep1 > 0)

  // Repeat same close request idempotently
  const step1Repeat = closeStep({
    state: step1.state,
    event: week2,
    division: "W",
    requestId: "req-w",
    payloadHash: "hash-w",
    settings: S,
    entries,
    balances: { M: bal({ perfect5: 10 }), W: bal({ perfect5: 10 }) },
    bar: { M: 10, W: 10 },
    openingNight: true,
  }) as { ok: boolean; cached: boolean; postedLegs: unknown[] }
  assert.equal(step1Repeat.ok, true)
  assert.equal(step1Repeat.cached, true)
  assert.equal(step1Repeat.postedLegs.length, 0, "idempotent repeat posts no new legs")

  // Close second division (M)
  const step2 = closeStep({
    state: step1.state,
    event: week2,
    division: "M",
    requestId: "req-m",
    payloadHash: "hash-m",
    settings: S,
    entries,
    balances: { M: bal({ perfect5: 10 }), W: bal({ perfect5: 10 }) },
    bar: { M: 10, W: 10 },
    openingNight: true,
  }) as { ok: boolean; sharedPosted: boolean; postedLegs: { division: string; fund: string; kind: string; amount: number }[]; paidPlaces: Record<string, Record<string, number>> }
  assert.equal(step2.ok, true)
  assert.equal(step2.sharedPosted, true)
  assert.equal(step2.paidPlaces.W.w1, w1PaidAfterStep1, "places already paid never change")
  assert.equal(step2.postedLegs.filter((l) => l.fund === "perfect5" && l.kind === "bonus_payout").length, 2, "shared P5 settled once")
})

check("corrections apply only to latest posted night, preserve original payouts, and reopen via correction flow", () => {
  const createDraft = (closeout as Record<string, unknown>).createCorrectionDraft as undefined | ((args: unknown) => unknown)
  const applyDraft = (closeout as Record<string, unknown>).applyCorrectionDraft as undefined | ((args: unknown) => unknown)
  const canEditPayouts = (closeout as Record<string, unknown>).canEditDivisionPayouts as undefined | ((args: unknown) => boolean)
  assert.equal(typeof createDraft, "function", "createCorrectionDraft should exist")
  assert.equal(typeof applyDraft, "function", "applyCorrectionDraft should exist")
  assert.equal(typeof canEditPayouts, "function", "canEditDivisionPayouts should exist")
  if (!createDraft || !applyDraft || !canEditPayouts) return

  // Hand-editing payouts is blocked when division is closed
  assert.equal(canEditPayouts({ event: week2, divisionClosed: true, reopenViaCorrection: false }), false)
  assert.equal(canEditPayouts({ event: week1, divisionClosed: false, reopenViaCorrection: true }), false)

  // Cannot correct an earlier night when a later night is posted
  const events = [week1, week2, week3]
  const ledgerWithWeek3 = [{ id: "l1", event_id: "ev-w2" }, { id: "l2", event_id: "ev-w3" }]
  const staleNight = createDraft({
    event: week2,
    division: "W",
    events,
    ledger: ledgerWithWeek3,
    bookedCash: 50,
    targetCash: 45,
    balances: { M: bal({ purse: 50 }), W: bal({ purse: 50 }) },
    originalPayouts: [{ id: "e1", player_id: "w1", place: 1, payout: 50 }],
  }) as { ok: boolean; reason?: string }
  assert.equal(staleNight.ok, false)
  assert.equal(staleNight.reason, "chronology")

  // Latest posted night creates a draft and preserves original payouts
  const ledgerLatestWeek2 = [{ id: "l1", event_id: "ev-w2", division: "W", fund: "purse", kind: "place_payout", amount: -50 }]
  const draftRes = createDraft({
    event: week2,
    division: "W",
    events,
    ledger: ledgerLatestWeek2,
    bookedCash: 50,
    targetCash: 60,
    balances: { M: bal({ purse: 50 }), W: bal({ purse: 50 }) },
    originalPayouts: [{ id: "e1", player_id: "w1", place: 1, payout: 50 }],
    reopenDivision: true,
  }) as { ok: boolean; draft: unknown }
  assert.equal(draftRes.ok, true)

  // Unconfirmed apply is refused
  const unconfirmed = applyDraft({
    draft: draftRes.draft,
    handled: 10,
    acknowledged: false,
    confirmation: "",
  }) as { ok: boolean; state: string }
  assert.equal(unconfirmed.ok, false)
  assert.equal(unconfirmed.state, "awaiting")

  // Confirmed apply succeeds, keeps original payouts, appends adjustment leg, and reopens division
  const confirmed = applyDraft({
    draft: draftRes.draft,
    handled: 10,
    acknowledged: true,
    confirmation: "All cash differences shown have been physically settled.",
  }) as {
    ok: boolean
    state: string
    reopened: boolean
    originalPayouts: { id: string; payout: number }[]
    adjustmentLegs: { division: string; amount: number }[]
  }
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.state, "applied")
  assert.equal(confirmed.reopened, true)
  assert.deepEqual(confirmed.originalPayouts, [{ id: "e1", player_id: "w1", place: 1, payout: 50 }])
  assert.equal(confirmed.adjustmentLegs[0].division, "W")
  assert.equal(confirmed.adjustmentLegs[0].amount, -10)
})

check("preview sql executes and policies exist", () => {
  const sql = readFileSync(fileURLToPath(new URL("../../supabase/pp_finance_010_division_closeout.sql", import.meta.url)), "utf8")
  assert.equal(sql.includes("0A000"), false)
  assert.equal(/not installed/i.test(sql), false)
  assert.match(sql, /create policy/i)
  assert.match(sql, /returns jsonb/i)
  assert.match(sql, /pp_finance_owner/)
})

check("closeout panels are wired into Results section of Tonight.tsx", () => {
  const tonight = readFileSync(fileURLToPath(new URL("../pages/Tonight.tsx", import.meta.url)), "utf8")
  assert.match(tonight, /DivisionCloseoutPanel/)
  assert.match(tonight, /CorrectionDraftPanel/)
  assert.equal(tonight.includes("handleFinalize"), false, "legacy handleFinalize must be removed")
  assert.equal(tonight.includes("Finalize & Post Event"), false, "legacy Finalize & Post Event button must be removed")
  assert.equal(tonight.includes("from('pp_ledger')"), false, "Tonight.tsx must not insert or delete pp_ledger directly")
  assert.match(tonight, /executeDivisionCloseFlow/)
  assert.match(tonight, /executeCorrectionFlow/)
})

async function runAsyncChecks() {
  const checkAsync = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err) {
      failures.push(name + ": " + (err instanceof Error ? err.message : String(err)))
    }
  }

  await checkAsync("RPC division close flow calls pp_preview_close first, shows preview, then calls pp_execute_division_close per division", async () => {
    const rpcCalls: { fn: string; args?: Record<string, unknown> }[] = []
    let dbState = {
      closed_men: false,
      closed_women: false,
      shared_pots_posted: false,
      reserve_p4_men: 0,
      reserve_p5_men: 0,
      reserve_p4_women: 0,
      reserve_p5_women: 0,
    }

    const rpc: closeout.CloseoutRpcCaller = async (fn, args) => {
      rpcCalls.push({ fn, args })
      if (fn === "pp_preview_close") {
        return {
          data: {
            event_id: week2.id,
            season_id: week2.season_id,
            close_mode: dbState.closed_men || dbState.closed_women ? "split" : "legacy",
            ...dbState,
            week1_frozen: false,
            later_posted: false,
            can_close: true,
          },
          error: null,
        }
      }
      if (fn === "pp_execute_division_close") {
        const div = args?.p_division as "M" | "W"
        const closedM = dbState.closed_men || div === "M"
        const closedW = dbState.closed_women || div === "W"
        const shared = closedM && closedW
        dbState = {
          closed_men: closedM,
          closed_women: closedW,
          shared_pots_posted: shared,
          reserve_p4_men: div === "M" && !shared ? Number(args?.p_reserve_p4 ?? 0) : shared ? 0 : dbState.reserve_p4_men,
          reserve_p5_men: div === "M" && !shared ? Number(args?.p_reserve_p5 ?? 0) : shared ? 0 : dbState.reserve_p5_men,
          reserve_p4_women: div === "W" && !shared ? Number(args?.p_reserve_p4 ?? 0) : shared ? 0 : dbState.reserve_p4_women,
          reserve_p5_women: div === "W" && !shared ? Number(args?.p_reserve_p5 ?? 0) : shared ? 0 : dbState.reserve_p5_women,
        }
        return {
          data: {
            ok: true,
            cached: false,
            event_id: week2.id,
            posting_id: "post-" + div,
            division: div,
            closed_men: closedM,
            closed_women: closedW,
            shared_pots_posted: shared,
          },
          error: null,
        }
      }
      throw new Error("unexpected rpc: " + fn)
    }

    const entries = [
      { id: "m1", player_id: "m1", division: "M" as const, created_at: "2026-11-12T01:00:01", awards: ["perfect4"], place: 1 },
      { id: "m2", player_id: "m2", division: "M" as const, created_at: "2026-11-12T01:00:02", awards: [], place: 2 },
      { id: "w1", player_id: "w1", division: "W" as const, created_at: "2026-11-12T02:00:01", awards: ["perfect4"], place: 1 },
      { id: "w2", player_id: "w2", division: "W" as const, created_at: "2026-11-12T02:00:02", awards: [], place: 2 },
    ]

    let previewSeenM = ""
    const closeM = await closeout.executeDivisionCloseFlow({
      rpc,
      event: week2,
      division: "M",
      settings: S,
      entries,
      balances: { M: bal({ perfect4: 20 }), W: bal({ perfect4: 20 }) },
      bar: { M: 10, W: 10 },
      openingNight: true,
      payouts: { M: [15], W: [15] },
      confirmPreview: (summary) => {
        previewSeenM = summary.text
        // At confirmation time, only pp_preview_close has been called
        assert.equal(rpcCalls.length, 1)
        assert.equal(rpcCalls[0].fn, "pp_preview_close")
        return true
      },
    })

    assert.equal(closeM.ok, true)
    if (!closeM.ok) return
    assert.match(previewSeenM, /Men's division close preview/i)
    assert.match(previewSeenM, /Shared P4\/P5 reserve held/i)
    assert.equal(rpcCalls.length, 2)
    assert.equal(rpcCalls[0].fn, "pp_preview_close")
    assert.equal(rpcCalls[1].fn, "pp_execute_division_close")
    assert.equal(rpcCalls[1].args?.p_division, "M")
    assert.match(String(rpcCalls[1].args?.p_request_id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.equal(closeM.closed.M, true)
    assert.equal(closeM.closed.W, false)
    assert.equal(closeM.sharedPosted, false)
    assert.equal(closeM.postedLegs.some((l) => l.fund === "perfect4"), false, "shared P4 stays held on first close")
    assert.equal(closeM.postedLegs.every((l) => l.division === "M"), true, "first close only posts Men's legs")

    // Now close Women's after reload from DB (passing no local state, only DB flags on event)
    let previewSeenW = ""
    const closeW = await closeout.executeDivisionCloseFlow({
      rpc,
      event: {
        ...week2,
        pp_closed_men: dbState.closed_men,
        pp_closed_women: dbState.closed_women,
        pp_shared_pots_posted: dbState.shared_pots_posted,
        pp_reserve_p4_men: dbState.reserve_p4_men,
        pp_reserve_p5_men: dbState.reserve_p5_men,
      },
      division: "W",
      settings: S,
      entries,
      balances: { M: bal({ perfect4: 20 }), W: bal({ perfect4: 20 }) },
      bar: { M: 10, W: 10 },
      openingNight: true,
      payouts: { M: [15], W: [15] },
      confirmPreview: (summary) => {
        previewSeenW = summary.text
        return true
      },
    })

    assert.equal(closeW.ok, true)
    if (!closeW.ok) return
    assert.match(previewSeenW, /Women's division close preview/i)
    assert.match(previewSeenW, /settling shared P4\/P5 pots now/i)
    assert.equal(rpcCalls.length, 4)
    assert.equal(rpcCalls[2].fn, "pp_preview_close")
    assert.equal(rpcCalls[3].fn, "pp_execute_division_close")
    assert.equal(rpcCalls[3].args?.p_division, "W")
    assert.equal(closeW.closed.M, true)
    assert.equal(closeW.closed.W, true)
    assert.equal(closeW.sharedPosted, true)
    assert.equal(closeW.postedLegs.filter((l) => l.fund === "perfect4" && l.kind === "bonus_payout").length, 2, "shared P4 settled once when second division closes")
  })

  await checkAsync("cancelling the preview confirmation does not call pp_execute_division_close", async () => {
    const rpcCalls: string[] = []
    const rpc: closeout.CloseoutRpcCaller = async (fn) => {
      rpcCalls.push(fn)
      return {
        data: {
          event_id: week2.id,
          season_id: week2.season_id,
          closed_men: false,
          closed_women: false,
          shared_pots_posted: false,
          week1_frozen: false,
          later_posted: false,
          can_close: true,
        },
        error: null,
      }
    }
    const res = await closeout.executeDivisionCloseFlow({
      rpc,
      event: week2,
      division: "M",
      settings: S,
      entries: [{ id: "m1", player_id: "m1", division: "M", created_at: "2026-11-12T01:00:01", awards: [], place: 1 }],
      balances: { M: bal(), W: bal() },
      bar: { M: 0, W: 0 },
      openingNight: true,
      payouts: { M: [5], W: [] },
      confirmPreview: () => false,
    })
    assert.equal(res.ok, false)
    if (res.ok) return
    assert.equal(res.reason, "cancelled")
    assert.deepEqual(rpcCalls, ["pp_preview_close"])
  })

  await checkAsync("RPC correction flow calls pp_apply_correction and Week 1 event e1ff57b8-9569-485d-aaa2-d538470bf9f4 is blocked", async () => {
    const prodWeek1 = {
      id: "e1ff57b8-9569-485d-aaa2-d538470bf9f4",
      season_id: "81298495-f87c-4d7c-a344-89b97e587d9b",
      date: "2026-11-05",
      name: "Week 1",
    }
    assert.equal(closeout.isWeek1Event({ id: "e1ff57b8-9569-485d-aaa2-d538470bf9f4" }), true)

    const rpcCalls: { fn: string; args?: Record<string, unknown> }[] = []
    const rpc: closeout.CloseoutRpcCaller = async (fn, args) => {
      rpcCalls.push({ fn, args })
      return {
        data: {
          ok: true,
          event_id: week2.id,
          correction_id: "corr-1",
          division: args?.p_division,
          reopened: args?.p_reopen,
        },
        error: null,
      }
    }

    const blockedClose = await closeout.executeDivisionCloseFlow({
      rpc,
      event: prodWeek1,
      division: "M",
      settings: S,
      entries: [],
      balances: { M: bal(), W: bal() },
      bar: { M: 0, W: 0 },
      openingNight: true,
      payouts: { M: [], W: [] },
    })
    assert.equal(blockedClose.ok, false)
    if (!blockedClose.ok) assert.equal(blockedClose.reason, "week1_frozen")
    assert.equal(rpcCalls.length, 0, "Week 1 must not even invoke RPC")

    const draftRes = closeout.createCorrectionDraft({
      event: { ...week2, pp_closed_women: true },
      division: "W",
      events: [{ ...week2, pp_closed_women: true }],
      ledger: [{ event_id: week2.id }],
      bookedCash: 50,
      targetCash: 60,
      balances: { M: bal({ purse: 50 }), W: bal({ purse: 50 }) },
      originalPayouts: [{ id: "w1", player_id: "w1", place: 1, payout: 50 }],
      reopenDivision: true,
    })
    assert.equal(draftRes.ok, true)
    if (!draftRes.ok) return

    const confirmedDraft: closeout.CorrectionDraft = {
      ...draftRes.draft,
      handled: 10,
      acknowledged: true,
      confirmation: closeout.CONFIRMATION_SENTENCE,
    }

    const blockedCorr = await closeout.executeCorrectionFlow({
      rpc,
      event: prodWeek1,
      draft: confirmedDraft,
    })
    assert.equal(blockedCorr.ok, false)
    if (!blockedCorr.ok) assert.equal(blockedCorr.reason, "week1_frozen")
    assert.equal(rpcCalls.length, 0)

    const appliedCorr = await closeout.executeCorrectionFlow({
      rpc,
      event: week2,
      draft: confirmedDraft,
    })
    assert.equal(appliedCorr.ok, true)
    if (!appliedCorr.ok) return
    assert.equal(appliedCorr.reopened, true)
    assert.equal(rpcCalls.length, 1)
    assert.equal(rpcCalls[0].fn, "pp_apply_correction")
    assert.equal(rpcCalls[0].args?.p_division, "W")
    assert.equal(rpcCalls[0].args?.p_reopen, true)
    assert.equal(rpcCalls[0].args?.p_cash_due, 10)
    assert.equal(rpcCalls[0].args?.p_handled, 10)
    assert.equal(rpcCalls[0].args?.p_confirmation, closeout.CONFIRMATION_SENTENCE)
  })
}

await runAsyncChecks()

if (failures.length) {
  console.log(failures.join("\n"))
  process.exit(1)
}
console.log("closeout gap tests defined")

