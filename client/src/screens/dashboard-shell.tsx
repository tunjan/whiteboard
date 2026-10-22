import { type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { BarChart2, ChevronsUpDown, LogOut, Moon, Sun } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { navigate } from '@/router';
import { useThemeStore } from '@/use-theme-store';
import './dashboard.css';

// The sheet is a whiteboard, and a whiteboard has a dot lattice. It is
// invisible until a mouse is over the sheet, then wakes in a soft circle
// around the pointer. Written straight to CSS variables: no React render per
// move. Touch has no hover, so it never lights.
function lightLattice(event: ReactPointerEvent<HTMLElement>) {
  if (event.pointerType === 'touch') return;
  const sheet = event.currentTarget;
  const box = sheet.getBoundingClientRect();
  sheet.style.setProperty('--mx', `${event.clientX - box.left}px`);
  sheet.style.setProperty('--my', `${event.clientY - box.top}px`);
  sheet.style.setProperty('--lit', '1');
}

function dimLattice(event: ReactPointerEvent<HTMLElement>) {
  event.currentTarget.style.setProperty('--lit', '0');
}

/**
 * The frame both tutor pages share: a porcelain tray with a quiet rail on the
 * left and one white sheet holding the page. Nothing on the rail competes with
 * the sheet — it is labels and a count, set in the tray's own tone.
 */
export function DashboardShell({
  nav,
  account,
  children,
  mainId,
  busy,
}: {
  nav: ReactNode;
  account: ReactNode | null;
  children: ReactNode;
  mainId?: string;
  busy?: boolean;
}) {
  return (
    <div className="flex h-dvh w-full bg-[var(--d-sheet)] font-sans text-[var(--d-ink)] antialiased md:bg-[var(--d-tray)] md:p-3 md:pl-0">
      {/* Every leading glyph — brand mark, nav icons, avatar — shares one
          centre line 19px in from the rail's padding edge. */}
      <aside className="hidden w-60 shrink-0 flex-col px-3 pt-6 pb-3 md:flex">
        <div className="flex h-9 items-center gap-2.5 px-[7px]">
          <BrandMark className="size-6 rounded-[7px]" />
          <span className="d-display text-[16px] font-semibold">
            Whiteboard
          </span>
        </div>

        <nav aria-label="Library" className="mt-8 flex flex-col gap-1">
          {nav}
        </nav>

        <div className="mt-auto border-t border-[var(--d-rule)] pt-3">
          {account ?? <Skeleton className="h-10 w-full rounded-xl" />}
        </div>
      </aside>

      <main
        id={mainId}
        aria-busy={busy}
        onPointerMove={lightLattice}
        onPointerLeave={dimLattice}
        // The gutter is held so a list growing past the fold doesn't shift the
        // sheet sideways; the thumb is a rule-coloured hairline, not a slab.
        className="isolate flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--d-sheet)] [scrollbar-color:var(--d-rule)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] md:rounded-[22px] md:shadow-[var(--d-lift)] md:ring-1 md:ring-[var(--d-rule)]"
      >
        {/* Zero-height sticky anchor: the lattice stays put while the sheet
            scrolls under it, and sits behind every tile and word. */}
        <div aria-hidden="true" className="sticky top-0 h-0">
          <div className="d-lattice absolute top-0 left-0 -z-10 h-dvh w-full" />
        </div>
        {children}
      </main>
    </div>
  );
}

export function NavItem({
  icon,
  label,
  count,
  live,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  /** Students in a board right now — the one number worth a glance here. */
  live?: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-9 w-full items-center gap-3 rounded-[10px] px-2.5 text-(length:--d-fs-body) transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--d-blue)] [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:stroke-[1.6]',
        active
          ? 'bg-[var(--d-sheet)] font-medium text-[var(--d-ink)] [&_svg]:text-[var(--d-blue)]'
          : 'text-[var(--d-graphite)] hover:bg-[var(--d-hover)] hover:text-[var(--d-ink)] [&_svg]:text-[var(--d-pencil)] hover:[&_svg]:text-[var(--d-graphite)]',
      )}
    >
      {icon}
      <span className="flex-1 truncate text-left">{label}</span>
      {live ? (
        <span
          aria-label={`${live} live`}
          className="flex h-5 items-center gap-1.5 rounded-full bg-[var(--d-live-wash)] px-2 text-(length:--d-fs-caption) font-semibold tabular-nums text-[var(--d-live)]"
        >
          <span aria-hidden="true" className="d-pulse size-1.5 rounded-full bg-current" />
          {live}
        </span>
      ) : count ? (
        <span className="text-(length:--d-fs-caption) tabular-nums text-[var(--d-pencil)]">
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function initials(name: string, fallback: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    // Punctuation is not a letter: "Oksana (Sofia)" is "OS", not "O(".
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
  return letters || fallback;
}

const MARKERS = 5;

/** A student's marker ink: the same name always writes in the same colour. */
export function markerFor(name: string): string {
  let hash = 0;
  for (const ch of name.trim().toLocaleLowerCase()) {
    hash = (hash * 31 + ch.codePointAt(0)!) | 0;
  }
  return `var(--d-m${Math.abs(hash) % MARKERS})`;
}

export function AccountMenu({
  name,
  onLogout,
  compact,
}: {
  name: string;
  onLogout: () => void;
  compact?: boolean;
}) {
  const { theme, toggle: toggleTheme } = useThemeStore();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Account menu for ${name}`}
            className={cn(
              'flex items-center gap-3 rounded-xl transition-colors duration-150 outline-none hover:bg-[var(--d-hover)] focus-visible:ring-2 focus-visible:ring-[var(--d-blue)] aria-expanded:bg-[var(--d-press)]',
              compact ? 'p-1' : 'h-11 w-full px-[5px] pr-2.5',
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--d-ink)] text-(length:--d-fs-caption) font-semibold text-[var(--d-sheet)]">
              {initials(name, '?')}
            </span>
            {compact ? null : (
              <>
                <span className="flex-1 truncate text-left text-(length:--d-fs-body) font-medium text-[var(--d-ink)]">
                  {name}
                </span>
                <ChevronsUpDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-[var(--d-pencil)]"
                />
              </>
            )}
          </button>
        }
      />
      <DropdownMenuContent
        align={compact ? 'end' : 'start'}
        side={compact ? 'bottom' : 'top'}
        className="w-52"
      >
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="md:hidden"
            onClick={() => navigate('/analytics')}
          >
            <BarChart2 data-icon="inline-start" />
            Attendance
          </DropdownMenuItem>
          <DropdownMenuItem onClick={toggleTheme}>
            {theme === 'dark' ? (
              <Sun data-icon="inline-start" />
            ) : (
              <Moon data-icon="inline-start" />
            )}
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onLogout}>
          <LogOut data-icon="inline-start" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A page's title block: the display face at a size that lets the sheet breathe. */
export function PageTitle({
  title,
  eyebrow,
  detail,
  leading,
  actions,
}: {
  title: string;
  /** A line in the tutor's own handwriting above the title. */
  eyebrow?: string;
  detail?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mx-auto flex w-full max-w-[1180px] flex-wrap items-end gap-x-6 gap-y-5 px-5 pt-8 md:px-12 md:pt-16">
      <div className="flex min-w-0 flex-[1_1_18rem] items-center gap-3">
        {leading}
        <div className="min-w-0">
          {eyebrow ? (
            <p className="d-hand d-write mb-1 text-[26px] leading-none text-[var(--d-pencil)]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="d-display text-(length:--d-fs-display) leading-[1.05] font-semibold text-balance md:text-(length:--d-fs-page)">
            {title}
          </h1>
          {detail ? (
            <p className="mt-2 text-(length:--d-fs-lead) text-pretty text-[var(--d-graphite)]">{detail}</p>
          ) : null}
        </div>
      </div>
      {actions}
    </header>
  );
}
