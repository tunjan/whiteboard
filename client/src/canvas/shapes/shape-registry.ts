import type { Shape, ShapeType } from '@whiteboard/shared';
import type { ShapeUtil } from './types';

/**
 * Registry of shape implementations, keyed by type. The core canvas renders,
 * hit-tests, and bounds shapes purely by looking them up here — it has no
 * hardcoded knowledge of any specific shape. Shapes register themselves from
 * Phase 6 on.
 */
class ShapeRegistry {
  private readonly utils = new Map<ShapeType, ShapeUtil>();

  register<T extends ShapeType>(util: ShapeUtil<T>): void {
    // The map is keyed generically; each util's methods are sound for its own
    // shape type, which is what we always call them with.
    this.utils.set(util.type, util as unknown as ShapeUtil);
  }

  get(type: ShapeType): ShapeUtil | undefined {
    return this.utils.get(type);
  }

  getFor(shape: Shape): ShapeUtil | undefined {
    return this.utils.get(shape.type);
  }

  has(type: ShapeType): boolean {
    return this.utils.has(type);
  }

  list(): ShapeUtil[] {
    return [...this.utils.values()];
  }
}

export const shapeRegistry = new ShapeRegistry();
