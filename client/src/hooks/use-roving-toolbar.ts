import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react';

const ITEM_SELECTOR = '[data-toolbar-item]';

export type ToolbarNavigationKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End';

export function nextToolbarIndex(
  current: number,
  length: number,
  key: ToolbarNavigationKey,
): number {
  if (length <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  return key === 'ArrowRight'
    ? (current + 1) % length
    : (current - 1 + length) % length;
}

function enabledItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
    (item) =>
      !item.hasAttribute('disabled') &&
      item.getAttribute('aria-disabled') !== 'true' &&
      // A folded slot keeps its box while it animates shut, so a rect alone
      // does not mean the key is reachable.
      !item.closest('[inert]') &&
      item.getClientRects().length > 0,
  );
}

function setTabStop(items: HTMLElement[], next: HTMLElement): void {
  for (const item of items) item.tabIndex = item === next ? 0 : -1;
}

/**
 * Implements the ARIA toolbar roving-tabindex pattern with event delegation.
 * Children opt in with `data-toolbar-item`; one item enters the page Tab order,
 * while arrow keys, Home, and End move within the toolbar.
 */
export function useRovingToolbar<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  const sync = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const items = enabledItems(root);
    if (!items.length) return;
    const current = items.find((item) => item.tabIndex === 0);
    const selected = items.find(
      (item) =>
        item.getAttribute('aria-pressed') === 'true' ||
        item.getAttribute('aria-current') === 'true',
    );
    setTabStop(items, current ?? selected ?? items[0]!);
  }, []);

  useEffect(() => {
    sync();
    const root = ref.current;
    if (!root) return;
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ['aria-current', 'aria-disabled', 'aria-pressed', 'class', 'disabled', 'inert'],
    });
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [sync]);

  const onFocusCapture = useCallback((event: ReactFocusEvent<T>) => {
    const root = ref.current;
    const target = (event.target as HTMLElement).closest<HTMLElement>(ITEM_SELECTOR);
    if (!root || !target || !root.contains(target)) return;
    setTabStop(enabledItems(root), target);
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<T>) => {
    if (
      event.key !== 'ArrowLeft' &&
      event.key !== 'ArrowRight' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }

    const root = ref.current;
    const target = (event.target as HTMLElement).closest<HTMLElement>(ITEM_SELECTOR);
    if (!root || !target || !root.contains(target)) return;
    const items = enabledItems(root);
    const index = items.indexOf(target);
    if (index < 0 || !items.length) return;

    event.preventDefault();
    const nextIndex = nextToolbarIndex(
      index,
      items.length,
      event.key as ToolbarNavigationKey,
    );
    const next = items[nextIndex]!;
    setTabStop(items, next);
    next.focus();
  }, []);

  return { ref, onFocusCapture, onKeyDown, sync };
}
