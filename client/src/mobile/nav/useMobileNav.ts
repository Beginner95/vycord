import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Screen, Stack, TabId } from './types';
import { TAB_ROOT, isStack, push as pushScreen, pop, tabOf } from './navReducer';

export interface NavState { m: Stack; b: number }

export interface MobileNav {
  stack: Stack;
  top: Screen;
  tab: TabId;
  valid: boolean;
  push(s: Screen): void;
  pushMany(s: readonly Screen[]): void;
  back(): void;
  replaceStack(s: Stack): void;
  switchTab(t: TabId): void;
}

// Синхронно актуальный стек. navigate() меняет location только к следующему
// рендеру, а useBackDismiss решает «моя ли запись наверху» в микрозадаче —
// ему нужен стек сразу после вызова push/replace, а не после рендера.
let latest: Stack | null = null;
export const latestStack = (): Stack | null => latest;

// Синхронно актуальная глубина — тот же приём, что и `latest`, и по той же
// причине: несколько push/pushMany подряд в одном тике должны видеть друг
// друга, а не значение `b`, захваченное на последнем рендере. Инвариант:
// глубина никогда не превышает число экранов над корнем (m.length - 1) —
// применяется в go() при каждой записи.
let latestDepth: number | null = null;

function readState(raw: unknown): { nav: NavState | null } {
  const s = raw as Partial<NavState> | null | undefined;
  return { nav: s && isStack(s.m) ? { m: s.m, b: typeof s.b === 'number' ? s.b : 0 } : null };
}

export function useMobileNav(fallback: Screen = TAB_ROOT.servers): MobileNav {
  const location = useLocation();
  const navigate = useNavigate();
  const { nav } = readState(location.state);
  const stack: Stack = nav?.m ?? [fallback];
  const depth = nav?.b ?? 0;
  latest = stack;
  latestDepth = depth;

  const go = useCallback(
    (m: Stack, b: number, replace: boolean) => {
      // Инвариант: глубина никогда не превышает число экранов над корнем —
      // иначе back() может решить, что есть ещё свои push'и под текущей
      // записью, и уйти в navigate(-1) за пределы того, что реально было
      // положено в history (см. Task 6 Fix round 1, находки A/B).
      const safeB = Math.max(0, Math.min(b, m.length - 1));
      latest = m;
      latestDepth = safeB;
      const base = (location.state && typeof location.state === 'object') ? location.state : {};
      navigate(`${location.pathname}${location.search}`, { state: { ...base, m, b: safeB }, replace });
    },
    [location, navigate],
  );

  return useMemo<MobileNav>(() => ({
    stack,
    top: stack[stack.length - 1],
    tab: tabOf(stack),
    valid: nav !== null,
    push: (s) => {
      const cur = latest ?? stack;
      const curDepth = latestDepth ?? depth;
      const next = pushScreen(cur, s);
      // push поверх sheet'а заменяет его запись (navReducer.push) → replace в history.
      go(next, next.length > cur.length ? curDepth + 1 : curDepth, next.length === cur.length);
    },
    pushMany: (list) => {
      let cur = latest ?? stack;
      let b = latestDepth ?? depth;
      for (const s of list) {
        const next = pushScreen(cur, s);
        const grew = next.length > cur.length;
        if (grew) b += 1;
        go(next, b, !grew);
        cur = next;
      }
    },
    back: () => {
      const cur = latest ?? stack;
      const curDepth = latestDepth ?? depth;
      if (cur.length <= 1) return;
      if (curDepth > 0) navigate(-1);
      else go(pop(cur), 0, true);
    },
    replaceStack: (m) => go(m, depth, true),
    switchTab: (t) => go([TAB_ROOT[t]], depth, true),
  }), [stack, nav, depth, go, navigate]);
}
