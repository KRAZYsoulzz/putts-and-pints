# Division Closeout & Finance Protocol Review

**Worktree:** `local-finance`  
**Review Type:** Read-Only Audit  
**Target Files:**
- `src/lib/closeout.ts`
- `src/lib/closeout-protocol.test.ts`
- `src/components/DivisionCloseoutPanel.tsx`
- `src/components/CorrectionDraftPanel.tsx`
- `supabase/pp_finance_010_division_closeout.sql`

---

## 1. Executive Summary & Area Classifications

Each of the four evaluated areas is classified below as either a **complete implementation** or a **partial reference function**:

| Area | Classification | Summary |
|---|---|---|
| **P3 Activation** | **Partial Reference Function** | `activationDecision` in `closeout.ts` is an isolated, in-memory predicate validating status and clean entry/ledger counts. No database migration, stored procedure, API route, or application state transition actually activates split closeout mode on events or seasons. |
| **Idempotent Close** | **Partial Reference Function** | Request caching, advisory key calculation, checksum generation, and close admission exist only as disconnected TypeScript helper functions. Database tables in `pp_private` are empty and locked down with no access policies or executing RPCs. `pp_preview_close` in SQL explicitly raises an error stating canonical close is not yet installed. |
| **P4 UI** | **Partial Reference Function (Stubs)** | `DivisionCloseoutPanel` and `CorrectionDraftPanel` are orphaned, read-only/mock presentation components that are not rendered in any application view. They provide no interactive controls, mutation handlers, or real-time event subscriptions. |
| **P5 Correction Cash Custody** | **Partial Reference Function** | `planCorrection` and `cashWindow` are pure helper algorithms. The UI bypasses physical custody verification via hardcoded props, `planCorrection` hardcodes the Men's division, and database tables for cash audit and settlement holds lack operational procedures or triggers. |

---

## 2. Analysis of the Four Functional Areas

### 2.1 P3 Activation: Partial Reference Function
- **Implementation Reality:** `activationDecision` (`src/lib/closeout.ts:801-819`) checks whether `status === 'scheduled'`, `entryCount === 0`, `ledgerCount === 0`, and ensures the event is not Week 1.
- **Missing Integration:** There is no persistence mechanism. It does not update `pp_events.pp_close_mode`, set stages (`pp_stage_men`, `pp_stage_women`), toggle `pp_season_state.split_enabled`, or coordinate with Supabase queries in `src/lib/store.ts`.
- **Database Support:** In `supabase/pp_finance_010_division_closeout.sql`, columns like `pp_close_mode` and `pp_stage_men` are defined on `pp_events`, but no RPC or trigger exists to execute the activation transition.

### 2.2 Idempotent Close: Partial Reference Function
- **Implementation Reality:** In `src/lib/closeout.ts`, functions such as `idempotentCloseResult` (`lines 840-863`), `requestCacheDecision` (`lines 158-173`), `closeAdmission` (`lines 821-838`), `revisionsMatch` (`lines 142-156`), and `ledgerChecksum` (`lines 113-131`) outline the protocol for cache deduplication and concurrency control.
- **Missing Integration:** None of these functions are hooked into an active transactional pipeline. `planSplitClose` calculates first- and second-division legs in-memory, but no service calls it, validates it against live database rows, or writes the result to `pp_ledger` and `pp_postings`.
- **Database Support:** While `pp_private.pp_requests` and `pp_private.pp_postings` are created in `pp_finance_010_division_closeout.sql`, permissions are completely revoked from `authenticated`, `anon`, and `public` with no RLS policies or `SECURITY DEFINER` access procedures. Furthermore, `pp_preview_close(p_event_id)` (`lines 161-176`) explicitly raises exception `0A000` (`'canonical close is not installed for execution yet'`).

### 2.3 P4 UI: Partial Reference Function / Orphaned Stubs
- **Implementation Reality:** 
  - `DivisionCloseoutPanel.tsx` takes primitive props (`closed`, `sharedPosted`, `correctionPending`, `deficit`) and displays text outputs formatted by `closeoutReader`.
  - `CorrectionDraftPanel.tsx` accepts `cashDue` and `handled`, invoking `cashWindow`.
- **Missing Integration:** Neither panel is imported or rendered anywhere in the application (absent from `src/pages/Tonight.tsx`, `src/App.tsx`, and all navigation routes).
- **Functional Deficits:** Neither panel contains buttons (e.g., "Close Division", "Submit Correction", "Acknowledge Settlement"), loading indicators, confirmation dialogs, or event dispatchers.

### 2.4 P5 Correction Cash Custody: Partial Reference Function
- **Implementation Reality:** `planCorrection` (`src/lib/closeout.ts:865-909`) computes a single adjustment leg for cash variance, and `cashWindow` (`lines 911-945`) models custody states (`'applied'`, `'cash confirmed, posting pending'`, `'awaiting'`).
- **Defects & Gaps:**
  - `planCorrection` unconditionally sets `division: 'M'`, preventing corrections for the Women's division.
  - In `CorrectionDraftPanel.tsx`, `acknowledged: true` and the confirmation string `CONFIRMATION_SENTENCE` are hardcoded directly into the component call, completely circumventing real custody sign-off by the director.
  - In the database schema, `pp_private.pp_corrections`, `pp_private.pp_settlement_holds`, and `pp_private.pp_cash_audit` are empty definitions with revoked access and no procedures to track physical handoff or custody audits.

---

## 3. Concrete Defects

1. **Hardcoded Men's Division in `planCorrection` (`src/lib/closeout.ts:896`)**
   - The adjustment leg created by `planCorrection` hardcodes `division: 'M'`:
     ```ts
     const leg: Leg = {
       division: 'M',
       fund: 'purse',
       kind: 'adjustment',
       amount: cents(-cashDelta),
       note: 'Correction',
       player_id: null,
     }
     ```
   - Corrections cannot be planned or posted for Women's division purse adjustments, breaking division isolation.

2. **Unused `externalPerfect4` Parameter in `planCorrection` (`src/lib/closeout.ts:869, 886`)**
   - `input.externalPerfect4` is accepted and echoed back as `passThroughPerfect4`, but no ledger leg, adjustment, or verification logic is generated for the Perfect 4 pot.

3. **Inverted Sign / Misleading Delta Semantics in `planCorrection` (`src/lib/closeout.ts:899`)**
   - When target cash exceeds booked cash (`cashDelta > 0`), the generated leg posts `amount: cents(-cashDelta)`. Debiting the payout purse when additional cash is collected conflicts with standard accounting conventions without explanatory documentation or compensating custody entries.

4. **Hardcoded Cash Custody Bypass in `CorrectionDraftPanel` (`src/components/CorrectionDraftPanel.tsx:17-18`)**
   - `CorrectionDraftPanel` passes hardcoded confirmation parameters into `cashWindow`:
     ```ts
     const windowState = cashWindow({
       cashDue,
       handled,
       acknowledged: true,
       confirmation: CONFIRMATION_SENTENCE,
     })
     ```
   - Because `acknowledged: true` and `confirmation: CONFIRMATION_SENTENCE` are static, the component automatically marks cash settled as soon as `handled === cashDue`, completely bypassing actual manual director confirmation.

5. **Strict Men-First Division Ordering & Zero Women's Reserve in `planSplitClose` (`src/lib/closeout.ts:464-478, 534-614, 618-789`)**
   - `planSplitClose` hardcodes `heldReserve.W` to 0 for both `perfect4` and `perfect5`. Men's division calculations are hardcoded into `firstLegs`, while Women's division, shared pots, and Men's reserve release are hardcoded into `secondLegs`.
   - The architecture cannot support closing the Women's division prior to the Men's division.

6. **Uncalled `debitSolvency` in `planSplitClose` (`src/lib/closeout.ts:214-262, 370-799`)**
   - The `debitSolvency` function was written to ensure that generated debit legs do not force any division-fund combination into an illegal negative balance. However, `planSplitClose` never calls `debitSolvency` before returning generated legs.

7. **Tiebreak Fallback Omission in `distributeTiedChecks` (`src/lib/closeout.ts:292-302`)**
   - When sorting tied players for leftover unit allocations, `distributeTiedChecks` compares timestamps via `Date.parse` and string comparison, but lacks a deterministic tie-breaker (such as player ID or entry ID) when `created_at` values are identical, leading to unstable round-robin check distribution.

8. **Unconditional Exception in `pp_preview_close` (`supabase/pp_finance_010_division_closeout.sql:161-176`)**
   - The canonical database entrypoint raises SQLSTATE `0A000` (`feature_not_supported`):
     ```sql
     raise exception 'canonical close is not installed for execution yet'
       using errcode = '0A000';
     ```
   - No callable backend logic exists to preview or execute division closeout.

9. **Locked-Down Private Tables Without RLS Policies or RPCs (`supabase/pp_finance_010_division_closeout.sql:58-143`)**
   - All newly created tables in `pp_private` (`pp_protected_event`, `pp_protected_ledger`, `pp_season_state`, `pp_postings`, `pp_corrections`, `pp_settlement_holds`, `pp_cash_audit`, `pp_requests`, `pp_legacy_journal`) have RLS enabled and all privileges revoked from `anon`, `authenticated`, and `public`.
   - Because no policies (`CREATE POLICY`) or `SECURITY DEFINER` procedures were authored to query or write to these tables, they are completely unusable by application clients.

10. **Incomplete Protocol Test Suite (`src/lib/closeout-protocol.test.ts:1-128`)**
    - The test script exercises only 6 helper functions (`activationDecision`, `closeAdmission`, `idempotentCloseResult`, `planCorrection`, `cashWindow`, and `closeoutReader`).
    - Critical domain algorithms in `closeout.ts`—including `planSplitClose`, `debitSolvency`, `resolveWeek1Identity`, `ledgerChecksum`, and `seasonFinanceAdvisoryKey`—have zero automated test assertions in this file.

---

## 4. Readiness Conclusion

NOT READY — The reviewed closeout protocol, components, and SQL schema consist of partial reference functions and isolated stubs rather than an integrated, executable system; the SQL entrypoint throws an uninstalled feature exception; the private tables lack RLS access policies or RPCs; `planCorrection` hardcodes division 'M'; `CorrectionDraftPanel` hardcodes custody acknowledgement; and the UI panels remain entirely disconnected from the application.
