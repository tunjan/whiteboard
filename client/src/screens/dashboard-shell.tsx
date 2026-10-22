import { type ReactNode, useState } from 'react';
import { BarChart2, ChevronRight, LogOut, Menu, Moon, Sun } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { navigate } from '@/router';
import { useThemeStore } from '@/use-theme-store';
import './dashboard.css';

/** Atlassian's focus treatment: a 2px `border.focused` ring, offset 2px. */
export const FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-border-focused)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ds-surface)]';

/** The default (neutral) button: Atlassian's grey fill, no border. */
export const NEUTRAL_BUTTON =
  'bg-[var(--ds-background-neutral)] font-medium text-[var(--ds-text)] hover:bg-[var(--ds-background-neutral-hovered)] active:bg-[var(--ds-background-neutral-pressed)] aria-expanded:bg-[var(--ds-background-neutral-pressed)]';

/**
 * The page frame, after Atlassian's Nav 4 layout: a 56px top nav (logo, then
 * search and Create in the middle, account at the end) over a side nav and a
 * left-aligned main area. Below 1024px the side nav collapses into an overlay
 * that the top nav's menu button opens, as the layout spec describes.
 */
export function DashboardShell({
  nav,
  account,
  topNavMiddle,
  children,
  mainId,
  busy,
}: {
  nav: ReactNode;
  account: ReactNode | null;
  /** Search and the create action: the top nav's middle slot. */
  topNavMiddle?: ReactNode;
  children: ReactNode;
  mainId?: string;
  busy?: boolean;
}) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-dvh w-full flex-col bg-[var(--ds-surface)] font-sans text-(length:--d-fs-body) text-[var(--ds-text)] antialiased">
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] px-3">
        <div className="flex shrink-0 items-center gap-1 lg:w-[calc(15rem-1.5rem)]">
          <button
            type="button"
            aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
            className={cn(
              'flex size-8 items-center justify-center rounded-[var(--ds-radius-medium)] text-[var(--ds-icon)] hover:bg-[var(--ds-background-neutral-subtle-hovered)] active:bg-[var(--ds-background-neutral-subtle-pressed)] lg:hidden',
              FOCUS,
            )}
          >
            <Menu className="size-4" />
          </button>
          <a
            href="/"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              navigate('/');
            }}
            aria-label="Whiteboard home"
            className={cn(
              'flex h-8 items-center gap-2 rounded-[var(--ds-radius-medium)] px-1.5 hover:bg-[var(--ds-background-neutral-subtle-hovered)]',
              FOCUS,
            )}
          >
            <BrandMark className="size-6 rounded-[var(--ds-radius-small)]" />
            <span className="hidden text-base font-semibold text-[var(--ds-text)] sm:inline">
              Whiteboard
            </span>
          </a>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          {topNavMiddle}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {account ?? <Skeleton className="size-8 rounded-full" />}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {navOpen ? (
          <div
            aria-hidden="true"
            onClick={() => setNavOpen(false)}
            className="fixed inset-x-0 top-14 bottom-0 z-30 bg-[var(--ds-blanket)] lg:hidden"
          />
        ) : null}

        <aside
          className={cn(
            'z-40 flex w-60 shrink-0 flex-col border-r border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-3',
            'max-lg:fixed max-lg:top-14 max-lg:bottom-0 max-lg:left-0 max-lg:shadow-[var(--ds-shadow-overlay)] max-lg:transition-transform max-lg:duration-200 motion-reduce:max-lg:transition-none',
            !navOpen && 'max-lg:-translate-x-full max-lg:invisible',
          )}
        >
          <nav
            aria-label="Library"
            onClick={() => setNavOpen(false)}
            className="flex flex-col gap-0.5"
          >
            {nav}
          </nav>
        </aside>

        <main
          id={mainId}
          aria-busy={busy}
          className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--ds-surface)] [scrollbar-gutter:stable]"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * A menu item in the side nav: 32px tall, icon then label, a count or status
 * at the trailing edge. The selected item takes the selected fill, not a bar.
 */
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
        'flex h-8 w-full items-center gap-3 rounded-[var(--ds-radius-medium)] px-3 text-(length:--d-fs-body) transition-colors duration-100 [&_svg]:size-4 [&_svg]:shrink-0',
        FOCUS,
        active
          ? 'bg-[var(--ds-background-selected)] font-semibold text-[var(--ds-text-selected)] hover:bg-[var(--ds-background-selected-hovered)] active:bg-[var(--ds-background-selected-pressed)] [&_svg]:text-[var(--ds-icon-selected)]'
          : 'text-[var(--ds-text)] hover:bg-[var(--ds-background-neutral-subtle-hovered)] active:bg-[var(--ds-background-neutral-subtle-pressed)] [&_svg]:text-[var(--ds-icon)]',
      )}
    >
      {icon}
      <span className="flex-1 truncate text-left">{label}</span>
      {live ? (
        <Lozenge tone="success" label={`${live} live`}>
          <span aria-hidden="true" className="d-pulse size-1.5 rounded-full bg-current" />
          {live}
        </Lozenge>
      ) : count ? (
        <span className="text-(length:--d-fs-caption) tabular-nums text-[var(--ds-text-subtlest)]">
          {count}
        </span>
      ) : null}
    </button>
  );
}

const LOZENGE_TONES = {
  success:
    'bg-[var(--ds-background-success)] text-[var(--ds-text-success)]',
  neutral: 'bg-[var(--ds-background-neutral)] text-[var(--ds-text)]',
  information:
    'bg-[var(--ds-background-information)] text-[var(--ds-text-information)]',
} as const;

/** Atlassian's lozenge: a compact semantic label, 4px radius, 12px semibold. */
export function Lozenge({
  tone,
  label,
  children,
  className,
}: {
  tone: keyof typeof LOZENGE_TONES;
  /** Spoken in place of the visible text, when that is only a glyph and count. */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-label={label}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[var(--ds-radius-small)] px-1.5 text-(length:--d-fs-caption) leading-4 font-semibold tabular-nums',
        LOZENGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
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

/** A student's avatar colour: the same name always gets the same accent. */
export function markerFor(name: string): string {
  let hash = 0;
  for (const ch of name.trim().toLocaleLowerCase()) {
    hash = (hash * 31 + ch.codePointAt(0)!) | 0;
  }
  return `var(--d-m${Math.abs(hash) % MARKERS})`;
}

/** The profile button at the end of the top nav, and the menu it opens. */
export function AccountMenu({
  name,
  onLogout,
}: {
  name: string;
  onLogout: () => void;
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
              'flex size-8 items-center justify-center rounded-full bg-[var(--ds-background-accent-blue-bolder)] text-(length:--d-fs-caption) font-semibold text-[var(--ds-text-inverse)] transition-[filter] hover:brightness-110 aria-expanded:brightness-90',
              FOCUS,
            )}
          >
            {initials(name, '?')}
          </button>
        }
      />
      <DropdownMenuContent align="end" side="bottom" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate text-(length:--d-fs-body) font-semibold text-[var(--ds-text)]">
            {name}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="lg:hidden"
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

/**
 * Atlassian's page header: breadcrumbs, then the title at heading.large with
 * the page's actions at the end of the same row, and an optional description.
 */
export function PageTitle({
  title,
  breadcrumbs,
  detail,
  leading,
  actions,
}: {
  title: string;
  /** Where this page sits, outermost first. Read-only text, not links. */
  breadcrumbs?: string[];
  detail?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex w-full flex-col gap-1 px-6 pt-6 md:px-10">
      {breadcrumbs?.length ? (
        <nav aria-label="Breadcrumbs">
          <ol className="flex items-center gap-1 text-(length:--d-fs-body) text-[var(--ds-text-subtle)]">
            {breadcrumbs.map((crumb, i) => (
              <li key={crumb} className="flex items-center gap-1">
                {i > 0 ? (
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3 text-[var(--ds-icon-subtlest)]"
                  />
                ) : null}
                {crumb}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
          {leading}
          <h1 className="min-w-0 text-[length:var(--d-fs-page)] leading-7 font-bold text-balance text-[var(--ds-text)] [font-family:var(--ds-font-family-heading)]">
            {title}
          </h1>
        </div>
        {actions}
      </div>
      {detail ? (
        <p className="text-(length:--d-fs-body) text-pretty text-[var(--ds-text-subtle)]">
          {detail}
        </p>
      ) : null}
    </header>
  );
}
