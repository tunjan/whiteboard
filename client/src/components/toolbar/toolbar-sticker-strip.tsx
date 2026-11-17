import { useEffect, useRef, useState } from 'react';
import {
  MAX_STICKER_PROMPT_CHARS,
  type CustomStickerMeta,
} from '@whiteboard/shared';
import { CloseGlyph, PlusGlyph, SparklesGlyph } from '@/components/ui/glyphs';
import { blobUrl } from '@/board/blobs';
import { generateSticker, pickAndAddStickers } from '@/board/custom-stickers';
import { aiLatexEnabled } from '@/board/latex-ai';
import { removeCustomSticker } from '@/canvas/board-records';
import { STICKERS, StickerPreview } from '@/canvas/shapes/sticker-catalog';
import {
  sortedCustomStickers,
  useCustomStickersStore,
} from '@/canvas/use-custom-stickers-store';
import { useStyleStore } from '@/canvas/use-style-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { KeyTip, refocusForKeyboard, useToolbarSide } from './toolbar-primitives';
import { arrowDelta } from './toolbar-tray-controls';

/** A board upload in the strip, with the key that removes it on hover. */
function CustomStickerItem({
  meta,
  selected,
  tabStop,
  onPick,
}: {
  meta: CustomStickerMeta;
  selected: boolean;
  tabStop: boolean;
  onPick: () => void;
}) {
  return (
    <div className="group relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              role="radio"
              aria-label={meta.label}
              aria-checked={selected}
              tabIndex={tabStop ? 0 : -1}
              onClick={onPick}
              className="tbar-item w-full"
            />
          }
        >
          <img
            src={blobUrl(meta.blobId)}
            alt=""
            className="object-contain"
            draggable={false}
          />
        </TooltipTrigger>
        <KeyTip label={meta.label} />
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${meta.label} from this board`}
              onClick={(e) => {
                e.stopPropagation();
                removeCustomSticker(meta.id);
              }}
              className={cn(
                'tbar-swatch-remove touch-reveal opacity-0 group-hover:opacity-100',
                'focus-visible:opacity-100 motion-reduce:transition-none',
              )}
            />
          }
        >
          <CloseGlyph />
        </TooltipTrigger>
        <KeyTip label="Remove for everyone" />
      </Tooltip>
    </div>
  );
}

/**
 * The spot after "Add sticker" that paints one from a description instead.
 * Rendered only when the server has an OpenRouter key; the result lands in the
 * same cut-out review an upload does.
 */
function GenerateStickerItem({ disabled }: { disabled: boolean }) {
  const side = useToolbarSide();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    let live = true;
    void aiLatexEnabled().then((on) => live && setEnabled(on));
    return () => {
      live = false;
    };
  }, []);

  if (!enabled) return null;

  const submit = () => {
    const text = prompt.trim();
    if (!text) return;
    setOpen(false);
    setPrompt('');
    void generateSticker(text);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label="Generate sticker"
                  disabled={disabled}
                  className="tbar-item tbar-sticker-add"
                />
              }
            />
          }
        >
          <SparklesGlyph />
        </TooltipTrigger>
        <KeyTip label="Generate sticker" />
      </Tooltip>
      <PopoverContent
        side={side}
        sideOffset={side === 'top' ? 12 : 8}
        finalFocus={refocusForKeyboard}
        className="drawer-popup w-64"
      >
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            aria-label="Describe the sticker"
            placeholder="A happy cat in a hat"
            maxLength={MAX_STICKER_PROMPT_CHARS}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!prompt.trim()}>
            Create
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The sticker tool's palette, on the style plate while the tool is armed: a
 * sheet of stickers, each drawn as it lands on the board — die-cut halo and
 * drop shadow — and the armed one peeled up off the sheet, the way the bar's
 * tool in hand rises from its slot. Switching is one click and the next canvas
 * click stamps it. The board's uploads continue the same run, scrolling once
 * they outgrow the plate, and end on a blank spot on the sheet that adds one —
 * where the new upload lands.
 */
export function StickerStrip() {
  const stickerId = useStyleStore((state) => state.stickerId);
  const setStickerId = useStyleStore((state) => state.setStickerId);
  const boardStickers = sortedCustomStickers(
    useCustomStickersStore((state) => state.stickers),
  );
  const pending = useCustomStickersStore((state) => state.pending);
  const error = useCustomStickersStore((state) => state.error);
  const rail = useToolbarSide() === 'right';
  const sheet = useRef<HTMLDivElement>(null);

  // The sticker in hand may sit past the strip's end: bring it into sight, and
  // again if the strip narrows, as it does when the generate key turns up late.
  useEffect(() => {
    const strip = sheet.current;
    if (!strip) return;
    const observer = new ResizeObserver(() => {
      strip
        .querySelector('[aria-checked="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [stickerId]);

  const ids = [...STICKERS.map((def) => def.id), ...boardStickers.map((meta) => meta.id)];
  // An upload removed by someone else leaves no choice: the first holds the tab stop.
  const chosen = ids.includes(stickerId) ? stickerId : ids[0];

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(event.key);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const group = event.currentTarget;
    const index = ids.indexOf(chosen!);
    setStickerId(ids[(index + delta + ids.length) % ids.length]!);
    requestAnimationFrame(() =>
      group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(),
    );
  };

  const addLabel = pending > 0 ? 'Working on it…' : 'Add sticker';

  const addKeys = (
    <div className="tbar-stickers tbar-sticker-keys">
      {Array.from({ length: pending }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="tbar-item tbar-sticker-pending animate-pulse motion-reduce:animate-none"
        />
      ))}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={error ? `${addLabel}. ${error}` : addLabel}
              disabled={pending > 0}
              onClick={() => void pickAndAddStickers()}
              className="tbar-item tbar-sticker-add"
              data-error={error ? true : undefined}
            />
          }
        >
          <PlusGlyph />
        </TooltipTrigger>
        <KeyTip label={error ?? addLabel} />
      </Tooltip>
      <GenerateStickerItem disabled={pending > 0} />
    </div>
  );

  return (
    <>
      {/* Under a bottom bar the sheet is one strip, and a mouse wheel only goes
          up and down. Beside a rail there is nothing to scroll sideways. */}
      <div
        ref={sheet}
        className="tbar-sheet"
        onWheel={(event) => {
          event.currentTarget.scrollLeft += event.deltaY;
        }}
      >
        <div
          role="radiogroup"
          aria-label="Sticker"
          onKeyDown={onKeyDown}
          className="tbar-stickers"
        >
          {STICKERS.map((def) => (
            <Tooltip key={def.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    role="radio"
                    aria-label={def.label}
                    aria-checked={def.id === stickerId}
                    tabIndex={def.id === chosen ? 0 : -1}
                    onClick={() => setStickerId(def.id)}
                    className="tbar-item"
                  />
                }
              >
                <StickerPreview def={def} size={46} />
              </TooltipTrigger>
              <KeyTip label={def.label} />
            </Tooltip>
          ))}
          {boardStickers.map((meta) => (
            <CustomStickerItem
              key={meta.id}
              meta={meta}
              selected={meta.id === stickerId}
              tabStop={meta.id === chosen}
              onPick={() => setStickerId(meta.id)}
            />
          ))}
        </div>
        {rail && addKeys}
      </div>
      {!rail && addKeys}
    </>
  );
}
