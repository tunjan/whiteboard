import { useEffect, useId, useState } from 'react';
import {
  usePdfImportStore,
  type PdfRangeRequest,
} from '@/canvas/use-pdf-import-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * Shown when a pasted PDF has more pages than the import limit allows, which
 * makes it the notice of the limit as well as the way past it — a separate
 * toast would only repeat what the reader is already looking at.
 *
 * Two number fields rather than a "1-3, 7" range string: the range that can be
 * imported is contiguous anyway, so a parser would buy nothing but its own
 * error cases.
 */
export function PdfRangeDialog({ isTutor }: { isTutor: boolean }) {
  const pending = usePdfImportStore((s) => s.pending);
  const resolve = usePdfImportStore((s) => s.resolve);

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) resolve(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {pending ? (
          <RangeForm
            // Remount per request so a second PDF starts from its own defaults.
            key={pending.fileName + pending.pageCount}
            request={pending}
            isTutor={isTutor}
            onSubmit={resolve}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RangeForm({
  request,
  isTutor,
  onSubmit,
}: {
  request: PdfRangeRequest;
  isTutor: boolean;
  onSubmit: (range: { from: number; to: number } | null) => void;
}) {
  const { fileName, pageCount, limit } = request;
  const fromId = useId();
  const toId = useId();
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState(String(Math.min(limit, pageCount)));

  // Follow the start page, so moving the range is one edit rather than two.
  useEffect(() => {
    const start = Number(from);
    if (!Number.isInteger(start) || start < 1) return;
    setTo(String(Math.min(start + limit - 1, pageCount)));
  }, [from, limit, pageCount]);

  const error = rangeError(from, to, pageCount, limit);
  const submit = () => {
    if (error) return;
    onSubmit({ from: Number(from), to: Number(to) });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose pages to import</DialogTitle>
        <DialogDescription>
          {fileName} has {pageCount} pages. Up to {limit}{' '}
          {limit === 1 ? 'page' : 'pages'} can be placed on the board at once.
          {isTutor ? ' Change the limit in the board ⋯ menu.' : ''}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <div className="flex gap-4">
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={fromId}>First page</FieldLabel>
            <Input
              id={fromId}
              autoFocus
              type="number"
              inputMode="numeric"
              min={1}
              max={pageCount}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              aria-invalid={error !== null}
            />
          </Field>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={toId}>Last page</FieldLabel>
            <Input
              id={toId}
              type="number"
              inputMode="numeric"
              min={1}
              max={pageCount}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              aria-invalid={error !== null}
            />
          </Field>
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
      <DialogFooter>
        <Button variant="outline" onClick={() => onSubmit(null)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={error !== null}>
          Import pages
        </Button>
      </DialogFooter>
    </>
  );
}

/** The reason this range cannot be imported, or `null` when it can. */
export function rangeError(
  fromInput: string,
  toInput: string,
  pageCount: number,
  limit: number,
): string | null {
  const from = Number(fromInput);
  const to = Number(toInput);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    fromInput.trim() === '' ||
    toInput.trim() === ''
  ) {
    return 'Enter a page number in each box.';
  }
  if (from < 1 || to > pageCount) {
    return `This PDF only has pages 1 to ${pageCount}.`;
  }
  if (to < from) return 'The last page comes before the first.';
  if (to - from + 1 > limit) {
    return `That is ${to - from + 1} pages; the limit is ${limit}.`;
  }
  return null;
}
