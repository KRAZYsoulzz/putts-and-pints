import assert from 'node:assert/strict'
import {
  initialAutoScrollState,
  autoScrollNextStep,
  initialPageScrollState,
  autoScrollPageStep,
} from './projector'

// 1. Lists that fit don't scroll
{
  const state = initialAutoScrollState()
  const res = autoScrollNextStep(state, {
    clientHeight: 600,
    scrollHeight: 400,
    currentScrollTop: 0,
  }, 100)

  assert.equal(res.shouldScroll, false)
  assert.equal(res.nextScrollTop, 0)
}

// 2. Top pause before scrolling
{
  let state = initialAutoScrollState(2000)
  const metrics = { clientHeight: 400, scrollHeight: 1000, currentScrollTop: 0 }

  // Step 1000ms: still paused
  let step = autoScrollNextStep(state, metrics, 1000)
  assert.equal(step.shouldScroll, true)
  assert.equal(step.nextState.phase, 'top_pause')
  assert.equal(step.nextScrollTop, 0)
  assert.equal(step.nextState.pauseRemainingMs, 1000)

  // Step another 1001ms: transitions to scrolling
  step = autoScrollNextStep(step.nextState, metrics, 1001)
  assert.equal(step.nextState.phase, 'scrolling')
  assert.equal(step.nextScrollTop, 0)
}

// 3. Smooth scrolling advances based on speed
{
  const state = { phase: 'scrolling' as const, scrollTop: 0, pauseRemainingMs: 0 }
  const metrics = { clientHeight: 400, scrollHeight: 1000, currentScrollTop: 0 }
  // At 30px/s, 500ms should advance by 15px
  const step = autoScrollNextStep(state, metrics, 500, { speedPxPerSec: 30 })
  assert.equal(step.nextState.phase, 'scrolling')
  assert.equal(step.nextScrollTop, 15)
}

// 4. Reaching bottom triggers bottom pause
{
  const state = { phase: 'scrolling' as const, scrollTop: 580, pauseRemainingMs: 0 }
  const metrics = { clientHeight: 400, scrollHeight: 1000, currentScrollTop: 580 } // maxScroll is 600
  // Advance 1000ms at 30px/s -> 30px -> reaches 600 (max)
  const step = autoScrollNextStep(state, metrics, 1000, { speedPxPerSec: 30, pauseBottomMs: 3000 })
  assert.equal(step.nextState.phase, 'bottom_pause')
  assert.equal(step.nextScrollTop, 600)
  assert.equal(step.nextState.pauseRemainingMs, 3000)
}

// 5. Bottom pause expires -> jumps back to top
{
  const state = { phase: 'bottom_pause' as const, scrollTop: 600, pauseRemainingMs: 500 }
  const metrics = { clientHeight: 400, scrollHeight: 1000, currentScrollTop: 600 }
  const step = autoScrollNextStep(state, metrics, 600, { pauseTopMs: 2500 })
  assert.equal(step.nextState.phase, 'top_pause')
  assert.equal(step.nextScrollTop, 0)
  assert.equal(step.nextState.pauseRemainingMs, 2500)
}

// 6. Reduced motion paging: lists that fit don't scroll
{
  const state = initialPageScrollState()
  const res = autoScrollPageStep(state, {
    clientHeight: 600,
    scrollHeight: 500,
    currentScrollTop: 0,
  }, 500)
  assert.equal(res.shouldScroll, false)
  assert.equal(res.nextScrollTop, 0)
}

// 7. Reduced motion paging: pages down and loops
{
  let state = initialPageScrollState(1000)
  const metrics = { clientHeight: 400, scrollHeight: 1000, currentScrollTop: 0 } // maxScroll = 600

  // While paused, stays at 0
  let step = autoScrollPageStep(state, metrics, 500)
  assert.equal(step.nextScrollTop, 0)
  assert.equal(step.nextState.pauseRemainingMs, 500)

  // Pause expires -> pages down (ratio 0.75 * 400 = 300px)
  step = autoScrollPageStep(step.nextState, metrics, 600, { pageSizeRatio: 0.75, pauseMs: 1000 })
  assert.equal(step.nextScrollTop, 300)

  // Second page down -> reaches maxScroll 600
  step = autoScrollPageStep({ ...step.nextState, pauseRemainingMs: 0 }, { ...metrics, currentScrollTop: 300 }, 10, { pageSizeRatio: 0.75, pauseMs: 1000 })
  assert.equal(step.nextScrollTop, 600)

  // At bottom, next page jump resets to 0
  step = autoScrollPageStep({ ...step.nextState, pauseRemainingMs: 0 }, { ...metrics, currentScrollTop: 600 }, 10, { pauseMs: 1000 })
  assert.equal(step.nextScrollTop, 0)
}

console.log('Projector auto-scroll tests passed ✔')
