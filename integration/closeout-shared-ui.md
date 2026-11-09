NOT APPLIED. Do not copy this into .worktrees/local-scoring.

# Closeout Shared UI Integration

Tonight.tsx and scoring.ts stay with the scoring worktree and are not modified in this finance worktree. No patch editing those scoring-owned files is included.

For a later combined review, Tonight can render DivisionCloseoutPanel and CorrectionDraftPanel from src/components:
- `DivisionCloseoutPanel` (`src/components/DivisionCloseoutPanel.tsx`) calls `closeoutReader` from `../lib/closeout` to display division closeout status, shared pot status, pending correction flags, and deficit funding notices.
- `CorrectionDraftPanel` (`src/components/CorrectionDraftPanel.tsx`) displays physical cash confirmation ("All cash differences shown have been physically settled.") and calls `cashWindow` from `../lib/closeout` to present actionable amounts and settlement state.
