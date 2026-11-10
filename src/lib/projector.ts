import { useEffect, useRef } from 'react'

export interface AutoScrollState {
  phase: 'top_pause' | 'scrolling' | 'bottom_pause'
  scrollTop: number
  pauseRemainingMs: number
}

export interface AutoScrollConfig {
  speedPxPerSec?: number
  pauseBottomMs?: number
  pauseTopMs?: number
}

export interface PageScrollState {
  scrollTop: number
  pauseRemainingMs: number
}

export interface PageScrollConfig {
  pauseMs?: number
  pageSizeRatio?: number
}

export function initialAutoScrollState(pauseTopMs = 2500): AutoScrollState {
  return {
    phase: 'top_pause',
    scrollTop: 0,
    pauseRemainingMs: pauseTopMs,
  }
}

/**
 * Pure calculation for one continuous frame step of auto-scrolling.
 * Returns the updated state, the target scrollTop, and whether scrolling is needed.
 */
export function autoScrollNextStep(
  state: AutoScrollState,
  metrics: { clientHeight: number; scrollHeight: number; currentScrollTop: number },
  deltaMs: number,
  config: AutoScrollConfig = {}
): { nextState: AutoScrollState; nextScrollTop: number; shouldScroll: boolean } {
  const speed = config.speedPxPerSec ?? 30
  const pauseBottom = config.pauseBottomMs ?? 3500
  const pauseTop = config.pauseTopMs ?? 2500

  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight)

  // Lists that fit don't scroll
  if (maxScroll <= 4) {
    return {
      nextState: { phase: 'top_pause', scrollTop: 0, pauseRemainingMs: pauseTop },
      nextScrollTop: 0,
      shouldScroll: false,
    }
  }

  let currentScrollTop = metrics.currentScrollTop
  if (Math.abs(currentScrollTop - state.scrollTop) > 50) {
    currentScrollTop = state.scrollTop
  }

  if (state.phase === 'top_pause') {
    const remaining = state.pauseRemainingMs - deltaMs
    if (remaining <= 0) {
      return {
        nextState: { phase: 'scrolling', scrollTop: 0, pauseRemainingMs: 0 },
        nextScrollTop: 0,
        shouldScroll: true,
      }
    }
    return {
      nextState: { ...state, pauseRemainingMs: remaining, scrollTop: 0 },
      nextScrollTop: 0,
      shouldScroll: true,
    }
  }

  if (state.phase === 'scrolling') {
    const advance = (speed * deltaMs) / 1000
    const targetScroll = currentScrollTop + advance
    if (targetScroll >= maxScroll - 1) {
      return {
        nextState: { phase: 'bottom_pause', scrollTop: maxScroll, pauseRemainingMs: pauseBottom },
        nextScrollTop: maxScroll,
        shouldScroll: true,
      }
    }
    return {
      nextState: { phase: 'scrolling', scrollTop: targetScroll, pauseRemainingMs: 0 },
      nextScrollTop: targetScroll,
      shouldScroll: true,
    }
  }

  // phase === 'bottom_pause'
  const remaining = state.pauseRemainingMs - deltaMs
  if (remaining <= 0) {
    // Pause completed at bottom -> jump back to top
    return {
      nextState: { phase: 'top_pause', scrollTop: 0, pauseRemainingMs: pauseTop },
      nextScrollTop: 0,
      shouldScroll: true,
    }
  }
  return {
    nextState: { ...state, pauseRemainingMs: remaining, scrollTop: maxScroll },
    nextScrollTop: maxScroll,
    shouldScroll: true,
  }
}

export function initialPageScrollState(pauseMs = 4000): PageScrollState {
  return {
    scrollTop: 0,
    pauseRemainingMs: pauseMs,
  }
}

/**
 * Pure calculation for stepped paging (for prefers-reduced-motion).
 */
export function autoScrollPageStep(
  state: PageScrollState,
  metrics: { clientHeight: number; scrollHeight: number; currentScrollTop: number },
  deltaMs: number,
  config: PageScrollConfig = {}
): { nextState: PageScrollState; nextScrollTop: number; shouldScroll: boolean } {
  const pauseMs = config.pauseMs ?? 4000
  const ratio = config.pageSizeRatio ?? 0.75

  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight)

  if (maxScroll <= 4) {
    return {
      nextState: { scrollTop: 0, pauseRemainingMs: pauseMs },
      nextScrollTop: 0,
      shouldScroll: false,
    }
  }

  const remaining = state.pauseRemainingMs - deltaMs
  if (remaining > 0) {
    return {
      nextState: { ...state, pauseRemainingMs: remaining },
      nextScrollTop: state.scrollTop,
      shouldScroll: true,
    }
  }

  // Time to advance or reset
  const pageSize = Math.max(80, metrics.clientHeight * ratio)
  if (state.scrollTop >= maxScroll - 2) {
    // Jump back to top
    return {
      nextState: { scrollTop: 0, pauseRemainingMs: pauseMs },
      nextScrollTop: 0,
      shouldScroll: true,
    }
  }

  const nextScroll = Math.min(maxScroll, state.scrollTop + pageSize)
  return {
    nextState: { scrollTop: nextScroll, pauseRemainingMs: pauseMs },
    nextScrollTop: nextScroll,
    shouldScroll: true,
  }
}

/**
 * React hook that auto-scrolls an element top-to-bottom with bottom pause, top jump,
 * and paging fallback when prefers-reduced-motion is active.
 */
export function useAutoScroll<T extends HTMLElement>(
  active: boolean,
  dependencyKey?: unknown
) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion) {
      let state = initialPageScrollState(4000)
      let lastTime = performance.now()
      let timer: number | null = null

      const tick = () => {
        const now = performance.now()
        const delta = Math.min(now - lastTime, 500)
        lastTime = now

        const metrics = {
          clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight,
          currentScrollTop: el.scrollTop,
        }

        const res = autoScrollPageStep(state, metrics, delta)
        state = res.nextState
        if (res.shouldScroll && el.scrollTop !== res.nextScrollTop) {
          el.scrollTop = res.nextScrollTop
        }

        timer = window.setTimeout(tick, 200)
      }

      timer = window.setTimeout(tick, 200)
      return () => {
        if (timer != null) clearTimeout(timer)
      }
    }

    // Smooth scrolling via requestAnimationFrame
    let state = initialAutoScrollState(2500)
    let lastTime = performance.now()
    let rafId: number | null = null

    const frame = (time: number) => {
      const delta = Math.min(time - lastTime, 100)
      lastTime = time

      const metrics = {
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        currentScrollTop: el.scrollTop,
      }

      const res = autoScrollNextStep(state, metrics, delta)
      state = res.nextState
      if (res.shouldScroll && Math.abs(el.scrollTop - res.nextScrollTop) >= 0.5) {
        el.scrollTop = res.nextScrollTop
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [active, dependencyKey])

  return ref
}

/**
 * Resolves whether projector mode is active based on component props or query string.
 */
export function isProjectorMode(projectorModeProp?: boolean, search = ''): boolean {
  if (projectorModeProp) return true
  const query = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(query)
  return params.get('view') === 'public' || params.get('projector') === 'true'
}

/**
 * Resolves effective admin status for viewing tonight.
 * In projector mode (/tv and ?view=public), admin privileges are treated as false
 * so the page renders identically to the public/signed-out view with zero admin controls.
 */
export function effectiveIsAdmin(authIsAdmin: boolean, isProjector: boolean): boolean {
  return authIsAdmin && !isProjector
}
