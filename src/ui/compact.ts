import { useEffect, useState } from 'react';

/**
 * "Compact" is a phone held sideways: the screen is only about 360 to 420 CSS pixels tall, so the table switches to a
 * tighter layout (see the "Compact" section at the end of styles.css). Nothing else in the game cares about this:
 * the rules, the computer players and every desktop window (which are never this short) are unaffected.
 */
export const COMPACT_QUERY = '(max-height: 520px)';

export function isCompact(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches;
}

/** True while the window is phone-sized (re-evaluated when it is resized or rotated). */
export function useCompact(): boolean {
  const [compact, setCompact] = useState(isCompact);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return compact;
}
