import { useEffect, useState } from 'react';

/** Navigate to a path (SPA, history API). */
export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Current pathname, reactive to back/forward and `navigate`. */
export function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

/** Extract the board id from a `/board/:id` path, or null. */
export function parseBoardId(path: string): string | null {
  const m = path.match(/^\/board\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]!) : null;
}
