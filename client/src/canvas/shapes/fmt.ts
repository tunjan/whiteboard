/**
 * Allocation-light SVG path serialization at centi-pixel precision.
 *
 * Geometry code feeds integer hundredths to this writer. Commands are emitted
 * directly into a reusable byte buffer and decoded once when the path is
 * complete, avoiding the temporary strings produced by repeated `toFixed` and
 * concatenation on the render path.
 *
 * Instances are intentionally non-reentrant. A renderer owns one instance and
 * completes a path before beginning the next one.
 */

export const SVG_PATH_BUFFER_SIZE = 65_536;

const textDecoder = new TextDecoder();

export function toCenti(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function nextCapacity(current: number, required: number): number {
  let capacity = Math.max(SVG_PATH_BUFFER_SIZE, current);
  while (capacity < required) capacity *= 2;
  return capacity;
}

export class CentiPixelPathWriter {
  private bytes = new Uint8Array(SVG_PATH_BUFFER_SIZE);
  private length = 0;
  private currentX = 0;
  private currentY = 0;
  /** The control point of the last segment as a renderer will reflect it. */
  private controlX = 0;
  private controlY = 0;

  reset(estimatedBytes = 0): void {
    this.ensure(estimatedBytes);
    this.length = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.controlX = 0;
    this.controlY = 0;
  }

  private settle(x: number, y: number): void {
    this.currentX = this.controlX = x;
    this.currentY = this.controlY = y;
  }

  private ensure(required: number): void {
    if (required <= this.bytes.length) return;
    const replacement = new Uint8Array(
      nextCapacity(this.bytes.length, required),
    );
    replacement.set(this.bytes.subarray(0, this.length));
    this.bytes = replacement;
  }

  private writeByte(byte: number): void {
    if (this.length === this.bytes.length) this.ensure(this.bytes.length * 2);
    this.bytes[this.length++] = byte;
  }

  private writeLiteral(value: string): void {
    this.ensure(this.length + value.length);
    for (let i = 0; i < value.length; i++) {
      this.bytes[this.length++] = value.charCodeAt(i);
    }
  }

  private writeUnsignedInteger(value: number): void {
    if (value === 0) {
      this.writeByte(48);
      return;
    }
    this.ensure(this.length + 18);
    const start = this.length;
    while (value > 0) {
      const quotient = Math.floor(value / 10);
      this.bytes[this.length++] = 48 + (value - quotient * 10);
      value = quotient;
    }
    for (let lo = start, hi = this.length - 1; lo < hi; lo++, hi--) {
      const swap = this.bytes[lo]!;
      this.bytes[lo] = this.bytes[hi]!;
      this.bytes[hi] = swap;
    }
  }

  /** Write an integer number of hundredths as the shortest decimal form. */
  private writeFixed(value: number): void {
    if (value < 0) {
      this.writeByte(45);
      value = -value;
    }
    const integer = Math.floor(value / 100);
    const fraction = value - integer * 100;
    this.writeUnsignedInteger(integer);
    if (fraction === 0) return;
    this.writeByte(46);
    this.writeByte(48 + Math.floor(fraction / 10));
    if (fraction % 10 !== 0) this.writeByte(48 + (fraction % 10));
  }

  private writePair(x: number, y: number): void {
    this.writeFixed(x);
    this.writeByte(32);
    this.writeFixed(y);
  }

  moveTo(x: number, y: number): void {
    if (this.length > 0) this.writeByte(32);
    this.writeLiteral('M ');
    this.writePair(x, y);
    this.settle(x, y);
  }

  lineTo(targetX: number, targetY: number): void {
    this.writeLiteral(' l ');
    this.writePair(targetX - this.currentX, targetY - this.currentY);
    this.settle(targetX, targetY);
  }

  quadraticTo(
    controlX: number,
    controlY: number,
    targetX: number,
    targetY: number,
  ): void {
    this.writeLiteral(' q ');
    this.writePair(controlX - this.currentX, controlY - this.currentY);
    this.writeByte(32);
    this.writePair(targetX - this.currentX, targetY - this.currentY);
    this.currentX = targetX;
    this.currentY = targetY;
    this.controlX = controlX;
    this.controlY = controlY;
  }

  cubicTo(
    control1X: number,
    control1Y: number,
    control2X: number,
    control2Y: number,
    targetX: number,
    targetY: number,
  ): void {
    this.writeLiteral(' c ');
    this.writePair(control1X - this.currentX, control1Y - this.currentY);
    this.writeByte(32);
    this.writePair(control2X - this.currentX, control2Y - this.currentY);
    this.writeByte(32);
    this.writePair(targetX - this.currentX, targetY - this.currentY);
    this.settle(targetX, targetY);
  }

  smoothTo(targetX: number, targetY: number): void {
    this.writeLiteral(' t ');
    this.writePair(targetX - this.currentX, targetY - this.currentY);
    this.controlX = 2 * this.currentX - this.controlX;
    this.controlY = 2 * this.currentY - this.controlY;
    this.currentX = targetX;
    this.currentY = targetY;
  }

  /**
   * `t` onto the midpoint between the control this segment reflects and the
   * one the next segment should have, given in unrounded hundredths.
   *
   * A `t` has no control of its own: the renderer reflects the previous one
   * about the start point. Rounding each midpoint on its own let that
   * reflection walk — measured at half a world unit by a 600-sample stroke —
   * because every rounding error is mirrored into all the controls after it.
   * Choosing the midpoint against the control actually in force keeps every
   * control within one hundredth of where it was meant to be.
   */
  smoothToward(nextControlX: number, nextControlY: number): void {
    this.smoothTo(
      Math.round((2 * this.currentX - this.controlX + nextControlX) / 2),
      Math.round((2 * this.currentY - this.controlY + nextControlY) / 2),
    );
  }

  /** Clockwise half-circle used by the ink outline's round caps. */
  arcTo(radius: number, targetX: number, targetY: number): void {
    this.ellipticArcTo(radius, radius, 0, false, true, targetX, targetY);
  }

  ellipticArcTo(
    radiusX: number,
    radiusY: number,
    rotationDegrees: number,
    largeArc: boolean,
    sweep: boolean,
    targetX: number,
    targetY: number,
  ): void {
    this.writeLiteral(' a ');
    this.writeFixed(radiusX);
    this.writeByte(32);
    this.writeFixed(radiusY);
    this.writeByte(32);
    this.writeFixed(rotationDegrees);
    this.writeByte(32);
    this.writeByte(largeArc ? 49 : 48);
    this.writeByte(32);
    this.writeByte(sweep ? 49 : 48);
    this.writeByte(32);
    this.writePair(targetX - this.currentX, targetY - this.currentY);
    this.settle(targetX, targetY);
  }

  close(): void {
    this.writeLiteral(' Z');
  }

  finish(): string {
    return textDecoder.decode(this.bytes.subarray(0, this.length));
  }
}
