import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AI_JOBS, type AiJob, type AiModelsResponse } from '@whiteboard/shared';
import { fetchAiModels, formatPrice, saveAiModel } from '@/board/ai-models';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Which OpenRouter model runs each AI job, priced as it is chosen. Opened from
 * the dashboard's account menu and from a board's actions menu; the choice is
 * app-wide either way.
 */

export const JOB_LABEL: Record<AiJob, string> = {
  vision: 'Handwriting → LaTeX and graphs',
  text: 'Description → LaTeX',
  stt: 'Dictation',
  image: 'Stickers',
  agent: 'Board assistant',
  check: 'Work checker',
};

/**
 * One job's picker: the chosen model, which opens into a search over every
 * model that can do the job. Not a `<datalist>`: browsers filter that by the
 * field's current text, so with the chosen model filled in it listed only
 * that model.
 */
function ModelRow({
  job,
  models,
  selected,
  open,
  onOpenChange,
  onSaved,
}: {
  job: AiJob;
  models: AiModelsResponse['options'][AiJob];
  selected: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (model: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const current = models.find((m) => m.id === selected);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(needle) ||
          m.name.toLowerCase().includes(needle),
      )
    : models;

  const choose = (model: string) => {
    onOpenChange(false);
    setQuery('');
    if (model === selected) return;
    setStatus('Saving…');
    saveAiModel(job, model)
      .then(() => {
        onSaved(model);
        setStatus(null);
      })
      .catch((cause: unknown) =>
        setStatus(cause instanceof Error ? cause.message : 'Not saved'),
      );
  };

  return (
    <li className="flex flex-col gap-1.5">
      <span id={`ai-job-${job}`} className="text-sm font-medium text-fg">
        {JOB_LABEL[job]}
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-labelledby={`ai-job-${job}`}
        onClick={() => onOpenChange(!open)}
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-control-border bg-surface px-2 text-left text-sm text-fg outline-none hover:border-fg-muted focus-visible:border-focus focus-visible:shadow-focus"
      >
        <span className="min-w-0 flex-1 truncate">{current?.name ?? selected}</span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 shrink-0 text-fg-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-border p-1.5">
          <Input
            autoFocus
            value={query}
            placeholder={`Search ${models.length} models`}
            aria-label={`Search models for ${JOB_LABEL[job]}`}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && shown[0]) choose(shown[0].id);
            }}
          />
          <ul
            aria-label={`Models for ${JOB_LABEL[job]}`}
            className="max-h-64 overflow-y-auto"
          >
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  aria-current={m.id === selected || undefined}
                  onClick={() => choose(m.id)}
                  className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left outline-none hover:bg-surface-hover focus-visible:bg-surface-hover aria-[current]:bg-surface-hover aria-[current]:font-semibold"
                >
                  <span className="flex w-full items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-fg">{m.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                      {formatPrice(job, m.pricing)}
                    </span>
                  </span>
                  <span className="truncate font-mono text-2xs text-fg-subtle">{m.id}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-fg-muted">No model matches</li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <span aria-live="polite" className="truncate text-xs tabular-nums text-fg-muted">
        {status ??
          (current
            ? `${current.id} · ${formatPrice(job, current.pricing)}`
            : 'Not in OpenRouter’s current list')}
      </span>
    </li>
  );
}

export function AiModelsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<AiModelsResponse | null>(null);
  const [error, setError] = useState(false);
  // One list open at a time: four open lists would push the rest off-screen.
  const [openJob, setOpenJob] = useState<AiJob | null>(null);

  // Fetched on each open: the server caches OpenRouter's list for an hour, and
  // the other entry point may have changed a choice since.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(false);
    fetchAiModels(controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader className="pr-10">
          <DialogTitle>AI models</DialogTitle>
          <DialogDescription>
            Applies to every board. Only models that accept each job’s input are
            listed.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-fg-muted">
            OpenRouter’s model list didn’t load. Close and try again.
          </p>
        ) : !data ? (
          <div className="flex flex-col gap-5">
            {AI_JOBS.map((job) => (
              <div key={job} className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-40 rounded-full" />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-5">
            {AI_JOBS.map((job) => (
              <ModelRow
                key={job}
                job={job}
                models={data.options[job]}
                selected={data.selected[job]}
                open={openJob === job}
                onOpenChange={(open) => setOpenJob(open ? job : null)}
                onSaved={(model) =>
                  setData((prev) =>
                    prev && { ...prev, selected: { ...prev.selected, [job]: model } },
                  )
                }
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
