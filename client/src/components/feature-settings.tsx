import { useEffect, useState, type ComponentType } from 'react';
import {
  ChartSpline,
  DraftingCompass,
  FileText,
  LayoutTemplate,
  Link,
  MessageSquare,
  Mic,
  Music,
  Pointer,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  Sticker,
} from 'lucide-react';
import { FEATURES, type Feature, type FeatureSet } from '@whiteboard/shared';
import { fetchBoardShare } from '@/board/board-access';
import {
  fetchDefaultFeatures,
  setBoardFeatures,
  setDefaultFeatures,
  useFeaturesStore,
} from '@/board/features';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

const FEATURE_ROWS: Record<Feature, { label: string; Icon: ComponentType }> = {
  ai: { label: 'AI', Icon: Sparkles },
  stickers: { label: 'Stickers', Icon: Sticker },
  voice: { label: 'Voice and video', Icon: Mic },
  music: { label: 'Music', Icon: Music },
  comments: { label: 'Comments', Icon: MessageSquare },
  documents: { label: 'Files', Icon: FileText },
  media: { label: 'YouTube and links', Icon: Link },
  graphs: { label: 'Graphs', Icon: ChartSpline },
  equations: { label: 'Equations', Icon: Sigma },
  construction: { label: 'Compass and ruler', Icon: DraftingCompass },
  templates: { label: 'Templates', Icon: LayoutTemplate },
  laser: { label: 'Laser', Icon: Pointer },
};

const fail = (error: unknown) =>
  toast.add({
    title: error instanceof Error ? error.message : 'Saving features failed',
    type: 'error',
  });

/**
 * The board ⋯ menu's Features submenu (tutor only): this board's set. Any
 * change gives the board a set of its own; "Use my defaults" hands it back.
 */
export function FeaturesSubmenu({ boardId }: { boardId: string }) {
  const features = useFeaturesStore((s) => s.features);
  // Whether the board has its own set; unknown until the share settings answer.
  const [custom, setCustom] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetchBoardShare(boardId)
      .then((share) => live && setCustom(share.features !== null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [boardId]);

  const save = (next: FeatureSet | null) => {
    if (next) useFeaturesStore.setState({ features: next });
    setCustom(next !== null);
    // The server's answer arrives as FEATURES_MESSAGE and is refetched,
    // which also brings back the defaults after a reset.
    setBoardFeatures(boardId, next).catch(fail);
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <SlidersHorizontal />
        Features
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {FEATURES.map((f) => {
          const { label, Icon } = FEATURE_ROWS[f];
          return (
            <DropdownMenuCheckboxItem
              key={f}
              checked={features[f]}
              closeOnClick={false}
              onCheckedChange={(on) => save({ ...features, [f]: on })}
            >
              <Icon />
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={custom === false}
          disabled={custom !== true}
          onCheckedChange={() => save(null)}
        >
          Use my defaults
        </DropdownMenuCheckboxItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The tutor's defaults, for every board without a set of its own. */
export function FeaturesDialog({
  open,
  onOpenChange,
  aiNeedsPro = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** AI is sold with Pro here and this tutor is on Free. */
  aiNeedsPro?: boolean;
}) {
  const [features, setFeatures] = useState<FeatureSet | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetchDefaultFeatures()
      .then((set) => live && setFeatures(set))
      .catch(fail);
    return () => {
      live = false;
    };
  }, [open]);

  const toggle = (f: Feature, on: boolean) => {
    if (!features) return;
    const next = { ...features, [f]: on };
    setFeatures(next);
    setDefaultFeatures(next).then(setFeatures).catch(fail);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-sm">
        <DialogHeader className="pr-10">
          <DialogTitle>Features</DialogTitle>
          <DialogDescription>
            What your boards offer. A board can change its own from its ⋯ menu.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1">
          {FEATURES.map((f) => {
            const { label, Icon } = FEATURE_ROWS[f];
            return (
              <li key={f}>
                <label className="flex h-9 items-center gap-3 text-sm text-fg [&_svg:not([class*='size-'])]:size-4">
                  <Icon />
                  <span className="flex-1">
                    {label}
                    {f === 'ai' && aiNeedsPro ? (
                      <span className="ml-2 text-xs text-fg-muted">with Pro</span>
                    ) : null}
                  </span>
                  <Switch
                    checked={features?.[f] ?? false}
                    disabled={!features || (f === 'ai' && aiNeedsPro)}
                    onCheckedChange={(on) => toggle(f, on)}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
