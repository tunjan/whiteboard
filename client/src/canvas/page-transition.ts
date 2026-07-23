type InteractionCompleter = () => void;

let completeInteraction: InteractionCompleter | null = null;

/** The mounted canvas owns pointer details; the page store invokes them synchronously. */
export function registerPageSwitchInteractionCompleter(
  completer: InteractionCompleter,
): () => void {
  completeInteraction = completer;
  return () => {
    if (completeInteraction === completer) completeInteraction = null;
  };
}

export function completeInteractionBeforePageSwitch(): void {
  completeInteraction?.();
}
