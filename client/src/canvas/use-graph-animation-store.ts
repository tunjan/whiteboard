import { create } from 'zustand';

/**
 * Live values for graph sliders that are currently animating.
 *
 * A playing slider sweeps its parameter at ~60fps. Written straight to the
 * document that is 60 shape updates a second, each one retained by the CRDT for
 * the life of the board and broadcast to every peer — a few seconds of watching
 * a curve move cost more document bytes than drawing the curve did.
 *
 * The sweep is exploration, not content, so it lives here instead: the shape
 * renders from these values while they exist, the document is written on a
 * slower cadence so collaborators still see the motion, and the value the
 * animation stops on is committed once when it stops.
 */
interface GraphAnimationState {
  /** shape id → parameter name → live value. Empty when nothing is playing. */
  values: Record<string, Record<string, number>>;
  setValue: (shapeId: string, name: string, value: number) => void;
  clearValue: (shapeId: string, name: string) => void;
}

export const useGraphAnimationStore = create<GraphAnimationState>((set) => ({
  values: {},
  setValue: (shapeId, name, value) =>
    set((state) => ({
      values: {
        ...state.values,
        [shapeId]: { ...state.values[shapeId], [name]: value },
      },
    })),
  clearValue: (shapeId, name) =>
    set((state) => {
      const shapeValues = state.values[shapeId];
      if (!shapeValues || !(name in shapeValues)) return state;
      const { [name]: _removed, ...rest } = shapeValues;
      const values = { ...state.values };
      if (Object.keys(rest).length === 0) delete values[shapeId];
      else values[shapeId] = rest;
      return { values };
    }),
}));
