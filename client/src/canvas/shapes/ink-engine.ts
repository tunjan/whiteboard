import type { DrawPoint } from '@whiteboard/shared';

export interface FreehandEngineOptions {
  size: number;
  last: boolean;
  simulatePressure: boolean;
  thinning: number;
  smoothing: number;
  streamline: number;
  startTaper: number | boolean;
  endTaper: number | boolean;
  easing?: (pressure: number) => number;
}

const MIN_PHYSICAL_PRESSURE = 0.025;
const PRESSURE_RELAXATION = 0.275;
const MIN_RADIUS = 0.01;
const textDecoder = new TextDecoder();
const linearEasing = (value: number): number => value;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function toCenti(value: number): number {
  return Math.round(value * 100);
}

function nextCapacity(current: number, required: number): number {
  let capacity = Math.max(16, current);
  while (capacity < required) capacity *= 2;
  return capacity;
}

/**
 * Reusable ASCII writer for fixed-point SVG commands. The backing byte buffer
 * grows only when a larger stroke is encountered; a final JavaScript string is
 * the only unavoidable per-call serialization allocation.
 */
class SvgByteWriter {
  bytes = new Uint8Array(1_024);
  length = 0;
  currentX = 0;
  currentY = 0;

  reset(estimatedBytes: number): void {
    this.ensure(estimatedBytes);
    this.length = 0;
    this.currentX = 0;
    this.currentY = 0;
  }

  ensure(required: number): void {
    if (required <= this.bytes.length) return;
    const replacement = new Uint8Array(
      nextCapacity(this.bytes.length, required),
    );
    replacement.set(this.bytes.subarray(0, this.length));
    this.bytes = replacement;
  }

  writeByte(byte: number): void {
    if (this.length === this.bytes.length) {
      this.ensure(this.bytes.length * 2);
    }
    this.bytes[this.length++] = byte;
  }

  writeLiteral(value: string): void {
    this.ensure(this.length + value.length);
    for (let i = 0; i < value.length; i++) {
      this.bytes[this.length++] = value.charCodeAt(i);
    }
  }

  writeUnsignedInteger(value: number): void {
    if (value === 0) {
      this.writeByte(48);
      return;
    }
    let divisor = 1;
    while (value >= divisor * 10) divisor *= 10;
    while (divisor >= 1) {
      const digit = Math.floor(value / divisor);
      this.writeByte(48 + digit);
      value -= digit * divisor;
      divisor /= 10;
    }
  }

  /** Write an integer count of hundredths as a compact decimal SVG number. */
  writeFixed(value: number): void {
    if (value < 0) {
      this.writeByte(45);
      value = -value;
    }
    const integer = Math.floor(value / 100);
    const fraction = value % 100;
    this.writeUnsignedInteger(integer);
    if (fraction === 0) return;
    this.writeByte(46);
    this.writeByte(48 + Math.floor(fraction / 10));
    if (fraction % 10 !== 0) this.writeByte(48 + (fraction % 10));
  }

  writePair(x: number, y: number): void {
    this.writeFixed(x);
    this.writeByte(32);
    this.writeFixed(y);
  }

  moveTo(x: number, y: number): void {
    if (this.length > 0) this.writeByte(32);
    this.writeLiteral('M ');
    this.writePair(x, y);
    this.currentX = x;
    this.currentY = y;
  }

  quadraticTo(
    controlX: number,
    controlY: number,
    targetX: number,
    targetY: number,
  ): void {
    this.writeLiteral(' q ');
    this.writePair(
      controlX - this.currentX,
      controlY - this.currentY,
    );
    this.writeByte(32);
    this.writePair(targetX - this.currentX, targetY - this.currentY);
    this.currentX = targetX;
    this.currentY = targetY;
  }

  smoothTo(targetX: number, targetY: number): void {
    this.writeLiteral(' t ');
    this.writePair(targetX - this.currentX, targetY - this.currentY);
    this.currentX = targetX;
    this.currentY = targetY;
  }

  arcTo(radius: number, targetX: number, targetY: number): void {
    this.writeLiteral(' a ');
    this.writeFixed(radius);
    this.writeByte(32);
    this.writeFixed(radius);
    this.writeLiteral(' 0 0 1 ');
    this.writePair(targetX - this.currentX, targetY - this.currentY);
    this.currentX = targetX;
    this.currentY = targetY;
  }

  close(): void {
    this.writeLiteral(' Z');
  }

  finish(): string {
    return textDecoder.decode(this.bytes.subarray(0, this.length));
  }
}

/**
 * Module-level, non-reentrant struct-of-arrays workspace. Every public render
 * finishes before another can begin on the JavaScript thread, so these buffers
 * can be safely reused by all persisted and in-progress strokes.
 */
class InkBuffers {
  capacity = 0;

  stageX = new Float64Array(0);
  stageY = new Float64Array(0);
  stageZ = new Float64Array(0);

  pointX = new Float64Array(0);
  pointY = new Float64Array(0);
  inputX = new Float64Array(0);
  inputY = new Float64Array(0);
  inputZ = new Float64Array(0);
  pressure = new Float64Array(0);
  distance = new Float64Array(0);
  runLength = new Float64Array(0);
  radius = new Float64Array(0);
  vectorX = new Float64Array(0);
  vectorY = new Float64Array(0);

  trackLeftX = new Float64Array(0);
  trackLeftY = new Float64Array(0);
  trackRightX = new Float64Array(0);
  trackRightY = new Float64Array(0);

  partitionStart = new Int32Array(0);
  partitionEnd = new Int32Array(0);
  boundary = new Uint8Array(0);
  rawBoundary = new Uint8Array(0);

  readonly writer = new SvgByteWriter();

  ensureCapacity(required: number): void {
    if (required <= this.capacity) return;
    this.capacity = nextCapacity(this.capacity, required);

    this.stageX = new Float64Array(this.capacity);
    this.stageY = new Float64Array(this.capacity);
    this.stageZ = new Float64Array(this.capacity);

    this.pointX = new Float64Array(this.capacity);
    this.pointY = new Float64Array(this.capacity);
    this.inputX = new Float64Array(this.capacity);
    this.inputY = new Float64Array(this.capacity);
    this.inputZ = new Float64Array(this.capacity);
    this.pressure = new Float64Array(this.capacity);
    this.distance = new Float64Array(this.capacity);
    this.runLength = new Float64Array(this.capacity);
    this.radius = new Float64Array(this.capacity);
    this.vectorX = new Float64Array(this.capacity);
    this.vectorY = new Float64Array(this.capacity);

    this.trackLeftX = new Float64Array(this.capacity);
    this.trackLeftY = new Float64Array(this.capacity);
    this.trackRightX = new Float64Array(this.capacity);
    this.trackRightY = new Float64Array(this.capacity);

    this.partitionStart = new Int32Array(this.capacity);
    this.partitionEnd = new Int32Array(this.capacity);
    this.boundary = new Uint8Array(this.capacity);
    this.rawBoundary = new Uint8Array(this.capacity);
  }
}

const buffers = new InkBuffers();

function pressureOf(point: DrawPoint): number {
  const pressure = point.pressure ?? 0.5;
  return Number.isFinite(pressure) ? clamp01(pressure) : 0.5;
}

function expandTwoPointStroke(
  count: number,
  simulatePressure: boolean,
): number {
  if (count !== 2 || !simulatePressure) return count;
  const startX = buffers.stageX[0]!;
  const startY = buffers.stageY[0]!;
  const endX = buffers.stageX[1]!;
  const endY = buffers.stageY[1]!;
  const endPressure = buffers.stageZ[1]!;
  for (let k = 1; k <= 4; k++) {
    const t = k / 4;
    buffers.stageX[k] = startX + (endX - startX) * t;
    buffers.stageY[k] = startY + (endY - startY) * t;
    buffers.stageZ[k] = (endPressure * k) / 4;
  }
  return 5;
}

/** Ingest and compact raw samples in the staged typed arrays. */
function ingest(
  points: DrawPoint[],
  size: number,
  simulatePressure: boolean,
): number {
  buffers.ensureCapacity(Math.max(points.length, 5));
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const point = points[i]!;
    buffers.stageX[i] = Number.isFinite(point.x) ? point.x : 0;
    buffers.stageY[i] = Number.isFinite(point.y) ? point.y : 0;
    const pressure = pressureOf(point);
    buffers.stageZ[i] = simulatePressure
      ? pressure
      : Math.max(MIN_PHYSICAL_PRESSURE, pressure);
  }
  if (count <= 1) return count;

  const thresholdSquared = (size / 3) ** 2;
  const startX = buffers.stageX[0]!;
  const startY = buffers.stageY[0]!;
  let startPressure = buffers.stageZ[0]!;
  let firstKept = 1;
  while (firstKept < count) {
    const dx = buffers.stageX[firstKept]! - startX;
    const dy = buffers.stageY[firstKept]! - startY;
    if (dx * dx + dy * dy > thresholdSquared) break;
    startPressure = Math.max(startPressure, buffers.stageZ[firstKept]!);
    firstKept++;
  }
  buffers.stageZ[0] = startPressure;
  if (firstKept === count) return 1;

  let stagedCount = 1;
  for (let read = firstKept; read < count; read++) {
    buffers.stageX[stagedCount] = buffers.stageX[read]!;
    buffers.stageY[stagedCount] = buffers.stageY[read]!;
    buffers.stageZ[stagedCount] = buffers.stageZ[read]!;
    stagedCount++;
  }
  if (stagedCount <= 2) {
    return expandTwoPointStroke(stagedCount, simulatePressure);
  }

  const end = stagedCount - 1;
  const endX = buffers.stageX[end]!;
  const endY = buffers.stageY[end]!;
  let lastPrefix = end - 1;
  while (lastPrefix > 0) {
    const dx = buffers.stageX[lastPrefix]! - endX;
    const dy = buffers.stageY[lastPrefix]! - endY;
    if (dx * dx + dy * dy > thresholdSquared) break;
    lastPrefix--;
  }
  if (lastPrefix < end - 1) {
    buffers.stageX[lastPrefix + 1] = endX;
    buffers.stageY[lastPrefix + 1] = endY;
    buffers.stageZ[lastPrefix + 1] = buffers.stageZ[end]!;
    stagedCount = lastPrefix + 2;
  }
  return expandTwoPointStroke(stagedCount, simulatePressure);
}

/** Streamline staged coordinates and retain raw coordinates for elbow bounds. */
function streamline(
  stagedCount: number,
  size: number,
  streamlineAmount: number,
): number {
  if (stagedCount === 0) return 0;
  const rawWeight =
    0.15 + (1 - clamp01(streamlineAmount)) * 0.85;

  buffers.pointX[0] = buffers.stageX[0]!;
  buffers.pointY[0] = buffers.stageY[0]!;
  buffers.inputX[0] = buffers.stageX[0]!;
  buffers.inputY[0] = buffers.stageY[0]!;
  buffers.inputZ[0] = buffers.stageZ[0]!;
  buffers.distance[0] = 0;
  buffers.runLength[0] = 0;

  let previousX = buffers.pointX[0]!;
  let previousY = buffers.pointY[0]!;
  let totalLength = 0;
  let pointCount = 1;

  for (let i = 1; i < stagedCount; i++) {
    const x =
      rawWeight * buffers.stageX[i]! + (1 - rawWeight) * previousX;
    const y =
      rawWeight * buffers.stageY[i]! + (1 - rawWeight) * previousY;
    const step = Math.hypot(x - previousX, y - previousY);
    totalLength += step;
    previousX = x;
    previousY = y;
    if (step === 0) continue;
    if (i < 4 && i < stagedCount - 1 && totalLength < size) continue;

    buffers.pointX[pointCount] = x;
    buffers.pointY[pointCount] = y;
    buffers.inputX[pointCount] = buffers.stageX[i]!;
    buffers.inputY[pointCount] = buffers.stageY[i]!;
    buffers.inputZ[pointCount] = buffers.stageZ[i]!;
    buffers.distance[pointCount] = step;
    buffers.runLength[pointCount] = totalLength;
    pointCount++;
  }
  return pointCount;
}

function resolveTaper(
  taper: number | boolean,
  size: number,
  totalLength: number,
): number {
  if (taper === true) return Math.max(size, totalLength);
  return typeof taper === 'number' && Number.isFinite(taper)
    ? Math.max(0, taper)
    : 0;
}

function baseRadius(
  pressure: number,
  size: number,
  thinning: number,
  easing: (pressure: number) => number,
): number {
  return Math.max(
    MIN_RADIUS,
    size * easing(0.5 - thinning * (0.5 - pressure)),
  );
}

/** Compute pressure, short-stroke fixup, radius, and compatibility tapers. */
function calculateDynamics(
  pointCount: number,
  options: FreehandEngineOptions,
): void {
  const totalLength = buffers.runLength[pointCount - 1] ?? 0;
  const thinning = clamp(options.thinning, -1, 1);
  const easing = options.easing ?? linearEasing;
  let pressure = clamp01(buffers.inputZ[0] ?? 0.5);
  let maximumPressure = pressure;

  for (let i = 0; i < pointCount; i++) {
    if (i > 0) {
      const stepRatio = clamp01(buffers.distance[i]! / options.size);
      const target = options.simulatePressure
        ? Math.min(1, 1 - stepRatio)
        : Math.max(MIN_PHYSICAL_PRESSURE, buffers.inputZ[i]!);
      pressure = clamp01(
        pressure +
          (target - pressure) * stepRatio * PRESSURE_RELAXATION,
      );
    }
    buffers.pressure[i] = pressure;
    maximumPressure = Math.max(maximumPressure, pressure);
  }

  if (totalLength < 1) {
    pressure = maximumPressure;
    for (let i = 0; i < pointCount; i++) {
      buffers.pressure[i] = pressure;
    }
  }

  const startTaper =
    totalLength < 1
      ? 0
      : resolveTaper(options.startTaper, options.size, totalLength);
  const endTaper =
    totalLength < 1
      ? 0
      : resolveTaper(options.endTaper, options.size, totalLength);
  for (let i = 0; i < pointCount; i++) {
    let radius = baseRadius(
      buffers.pressure[i]!,
      options.size,
      thinning,
      easing,
    );
    const length = buffers.runLength[i]!;
    const startRatio =
      startTaper > 0 ? clamp01(length / startTaper) : 1;
    const endRatio =
      endTaper > 0
        ? clamp01((totalLength - length) / endTaper)
        : 1;
    const startFactor = startRatio * (2 - startRatio);
    const endFactor = 1 - (1 - endRatio) ** 3;
    radius *= Math.min(startFactor, endFactor);
    buffers.radius[i] = Math.max(MIN_RADIUS, radius);
  }
}

function calculateGlobalVectors(pointCount: number): void {
  if (pointCount === 1) {
    buffers.vectorX[0] = 1;
    buffers.vectorY[0] = 1;
    return;
  }
  for (let i = 1; i < pointCount; i++) {
    const dx = buffers.pointX[i - 1]! - buffers.pointX[i]!;
    const dy = buffers.pointY[i - 1]! - buffers.pointY[i]!;
    const length = Math.hypot(dx, dy);
    buffers.vectorX[i] = length > 0 ? dx / length : 1;
    buffers.vectorY[i] = length > 0 ? dy / length : 1;
  }
  buffers.vectorX[0] = buffers.vectorX[1]!;
  buffers.vectorY[0] = buffers.vectorY[1]!;
}

/** Partition overlapping index ranges at acute and close hard elbows. */
function partition(pointCount: number): number {
  buffers.boundary.fill(0, 0, pointCount);
  buffers.rawBoundary.fill(0, 0, pointCount);
  if (pointCount <= 1) {
    buffers.partitionStart[0] = 0;
    buffers.partitionEnd[0] = 0;
    return 1;
  }

  calculateGlobalVectors(pointCount);
  let partitionCount = 0;
  let start = 0;
  for (let i = 1; i < pointCount - 1; i++) {
    const directionChange = clamp(
      buffers.vectorX[i]! * buffers.vectorX[i + 1]! +
        buffers.vectorY[i]! * buffers.vectorY[i + 1]!,
      -1,
      1,
    );
    const acute = directionChange < -0.8;
    let hard = false;
    if (!acute && directionChange <= 0.7) {
      const meanRadius =
        (buffers.radius[i - 1]! +
          buffers.radius[i]! +
          buffers.radius[i + 1]!) /
        3;
      const previousDx = buffers.pointX[i]! - buffers.pointX[i - 1]!;
      const previousDy = buffers.pointY[i]! - buffers.pointY[i - 1]!;
      const nextDx = buffers.pointX[i + 1]! - buffers.pointX[i]!;
      const nextDy = buffers.pointY[i + 1]! - buffers.pointY[i]!;
      const neighborhoodDistance =
        (previousDx * previousDx +
          previousDy * previousDy +
          nextDx * nextDx +
          nextDy * nextDy) /
        Math.max(MIN_RADIUS ** 2, meanRadius * meanRadius);
      hard = neighborhoodDistance < 1.5;
    }
    if (!acute && !hard) continue;

    buffers.boundary[i] = 1;
    if (acute) buffers.rawBoundary[i] = 1;
    buffers.partitionStart[partitionCount] = start;
    buffers.partitionEnd[partitionCount] = i;
    partitionCount++;
    start = i;
  }
  buffers.partitionStart[partitionCount] = start;
  buffers.partitionEnd[partitionCount] = pointCount - 1;
  return partitionCount + 1;
}

function sequenceIndex(
  localIndex: number,
  start: number,
  innerStart: number,
): number {
  return localIndex === 0 ? start : innerStart + localIndex - 1;
}

function sequenceX(
  localIndex: number,
  localCount: number,
  start: number,
  end: number,
  innerStart: number,
): number {
  const index = sequenceIndex(localIndex, start, innerStart);
  const useRaw =
    (localIndex === 0 && buffers.rawBoundary[start] === 1) ||
    (localIndex === localCount - 1 &&
      index === end &&
      buffers.rawBoundary[end] === 1);
  return useRaw ? buffers.inputX[index]! : buffers.pointX[index]!;
}

function sequenceY(
  localIndex: number,
  localCount: number,
  start: number,
  end: number,
  innerStart: number,
): number {
  const index = sequenceIndex(localIndex, start, innerStart);
  const useRaw =
    (localIndex === 0 && buffers.rawBoundary[start] === 1) ||
    (localIndex === localCount - 1 &&
      index === end &&
      buffers.rawBoundary[end] === 1);
  return useRaw ? buffers.inputY[index]! : buffers.pointY[index]!;
}

/**
 * Remove tiny inner segments after a partition boundary. The returned index is
 * the first centerline sample after the (possibly raw) duplicated boundary.
 */
function cleanupPartitionStart(start: number, end: number): number {
  if (buffers.boundary[start] === 0 || end - start < 2) return start + 1;
  const boundaryX =
    buffers.rawBoundary[start] === 1
      ? buffers.inputX[start]!
      : buffers.pointX[start]!;
  const boundaryY =
    buffers.rawBoundary[start] === 1
      ? buffers.inputY[start]!
      : buffers.pointY[start]!;
  let innerStart = start + 1;
  while (innerStart < end) {
    const dx = boundaryX - buffers.pointX[innerStart]!;
    const dy = boundaryY - buffers.pointY[innerStart]!;
    const threshold =
      ((buffers.radius[start]! + buffers.radius[innerStart]!) / 2) *
      0.5;
    if (dx * dx + dy * dy >= threshold * threshold) break;
    innerStart++;
  }
  return innerStart;
}

function calculatePartitionTracks(
  start: number,
  end: number,
  innerStart: number,
  size: number,
  smoothing: number,
): number {
  const localCount = 1 + Math.max(0, end - innerStart + 1);
  if (localCount <= 1) return 1;

  for (let local = 1; local < localCount; local++) {
    const previousX = sequenceX(
      local - 1,
      localCount,
      start,
      end,
      innerStart,
    );
    const previousY = sequenceY(
      local - 1,
      localCount,
      start,
      end,
      innerStart,
    );
    const currentX = sequenceX(
      local,
      localCount,
      start,
      end,
      innerStart,
    );
    const currentY = sequenceY(
      local,
      localCount,
      start,
      end,
      innerStart,
    );
    const dx = previousX - currentX;
    const dy = previousY - currentY;
    const length = Math.hypot(dx, dy);
    buffers.vectorX[local] = length > 0 ? dx / length : 1;
    buffers.vectorY[local] = length > 0 ? dy / length : 1;
  }

  buffers.vectorX[0] = buffers.vectorX[1]!;
  buffers.vectorY[0] = buffers.vectorY[1]!;
  if (buffers.rawBoundary[start] === 1) {
    const anchorIndex =
      innerStart > start + 1 ? innerStart : start;
    const boundaryX = buffers.inputX[start]!;
    const boundaryY = buffers.inputY[start]!;
    const anchorX = buffers.pointX[anchorIndex]!;
    const anchorY = buffers.pointY[anchorIndex]!;
    const dx = boundaryX - anchorX;
    const dy = boundaryY - anchorY;
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      buffers.vectorX[0] = dx / length;
      buffers.vectorY[0] = dy / length;
    }
  }

  const minimumTrackDistance =
    clamp01(smoothing) * size;
  const minimumTrackDistanceSquared =
    minimumTrackDistance * minimumTrackDistance;
  let trackCount = 0;
  let previousLeftX = 0;
  let previousLeftY = 0;
  let previousRightX = 0;
  let previousRightY = 0;

  for (let local = 0; local < localCount; local++) {
    const index = sequenceIndex(local, start, innerStart);
    const centerX = sequenceX(
      local,
      localCount,
      start,
      end,
      innerStart,
    );
    const centerY = sequenceY(
      local,
      localCount,
      start,
      end,
      innerStart,
    );
    const next = Math.min(local + 1, localCount - 1);
    const directionChange = clamp(
      buffers.vectorX[next]! * buffers.vectorX[local]! +
        buffers.vectorY[next]! * buffers.vectorY[local]!,
      -1,
      1,
    );
    const lerpX =
      buffers.vectorX[next]! +
      (buffers.vectorX[local]! - buffers.vectorX[next]!) *
        directionChange;
    const lerpY =
      buffers.vectorY[next]! +
      (buffers.vectorY[local]! - buffers.vectorY[next]!) *
        directionChange;
    const offsetX = lerpY * buffers.radius[index]!;
    const offsetY = -lerpX * buffers.radius[index]!;
    const leftX = centerX - offsetX;
    const leftY = centerY - offsetY;
    const rightX = centerX + offsetX;
    const rightY = centerY + offsetY;
    const leftDx = leftX - previousLeftX;
    const leftDy = leftY - previousLeftY;
    const rightDx = rightX - previousRightX;
    const rightDy = rightY - previousRightY;
    const keep =
      local === 0 ||
      local === localCount - 1 ||
      leftDx * leftDx + leftDy * leftDy >=
        minimumTrackDistanceSquared ||
      rightDx * rightDx + rightDy * rightDy >=
        minimumTrackDistanceSquared;
    if (!keep) continue;

    buffers.trackLeftX[trackCount] = leftX;
    buffers.trackLeftY[trackCount] = leftY;
    buffers.trackRightX[trackCount] = rightX;
    buffers.trackRightY[trackCount] = rightY;
    previousLeftX = leftX;
    previousLeftY = leftY;
    previousRightX = rightX;
    previousRightY = rightY;
    trackCount++;
  }
  return trackCount;
}

function midpointCenti(a: number, b: number): number {
  return Math.round((a + b) * 50);
}

function writeForwardTrack(count: number): void {
  const writer = buffers.writer;
  if (count <= 1) return;
  if (count === 2) {
    const targetX = toCenti(buffers.trackLeftX[1]!);
    const targetY = toCenti(buffers.trackLeftY[1]!);
    writer.quadraticTo(targetX, targetY, targetX, targetY);
    return;
  }

  writer.quadraticTo(
    toCenti(buffers.trackLeftX[1]!),
    toCenti(buffers.trackLeftY[1]!),
    midpointCenti(buffers.trackLeftX[1]!, buffers.trackLeftX[2]!),
    midpointCenti(buffers.trackLeftY[1]!, buffers.trackLeftY[2]!),
  );
  for (let i = 2; i < count - 1; i++) {
    writer.smoothTo(
      midpointCenti(buffers.trackLeftX[i]!, buffers.trackLeftX[i + 1]!),
      midpointCenti(buffers.trackLeftY[i]!, buffers.trackLeftY[i + 1]!),
    );
  }
  writer.smoothTo(
    toCenti(buffers.trackLeftX[count - 1]!),
    toCenti(buffers.trackLeftY[count - 1]!),
  );
}

function writeReverseTrack(count: number): void {
  const writer = buffers.writer;
  if (count <= 1) return;
  if (count === 2) {
    const targetX = toCenti(buffers.trackRightX[0]!);
    const targetY = toCenti(buffers.trackRightY[0]!);
    writer.quadraticTo(targetX, targetY, targetX, targetY);
    return;
  }

  writer.quadraticTo(
    toCenti(buffers.trackRightX[count - 2]!),
    toCenti(buffers.trackRightY[count - 2]!),
    midpointCenti(
      buffers.trackRightX[count - 2]!,
      buffers.trackRightX[count - 3]!,
    ),
    midpointCenti(
      buffers.trackRightY[count - 2]!,
      buffers.trackRightY[count - 3]!,
    ),
  );
  for (let i = count - 3; i > 0; i--) {
    writer.smoothTo(
      midpointCenti(buffers.trackRightX[i]!, buffers.trackRightX[i - 1]!),
      midpointCenti(buffers.trackRightY[i]!, buffers.trackRightY[i - 1]!),
    );
  }
  writer.smoothTo(
    toCenti(buffers.trackRightX[0]!),
    toCenti(buffers.trackRightY[0]!),
  );
}

function writeDot(index: number): void {
  const writer = buffers.writer;
  const centerX = toCenti(buffers.pointX[index]!);
  const centerY = toCenti(buffers.pointY[index]!);
  const radius = toCenti(buffers.radius[index]!);
  writer.moveTo(centerX + radius, centerY);
  writer.arcTo(radius, centerX - radius, centerY);
  writer.arcTo(radius, centerX + radius, centerY);
  writer.close();
}

function writePartition(
  start: number,
  end: number,
  size: number,
  smoothing: number,
): void {
  if (start === end) {
    writeDot(start);
    return;
  }
  const innerStart = cleanupPartitionStart(start, end);
  const count = calculatePartitionTracks(
    start,
    end,
    innerStart,
    size,
    smoothing,
  );
  if (count <= 1) {
    writeDot(start);
    return;
  }

  const writer = buffers.writer;
  writer.moveTo(
    toCenti(buffers.trackLeftX[0]!),
    toCenti(buffers.trackLeftY[0]!),
  );
  writeForwardTrack(count);

  writer.arcTo(
    toCenti(buffers.radius[end]!),
    toCenti(buffers.trackRightX[count - 1]!),
    toCenti(buffers.trackRightY[count - 1]!),
  );
  writeReverseTrack(count);
  writer.arcTo(
    toCenti(buffers.radius[start]!),
    toCenti(buffers.trackLeftX[0]!),
    toCenti(buffers.trackLeftY[0]!),
  );
  writer.close();
}

/** Run the complete non-reentrant ink pipeline and emit SVG path data. */
export function getFreehandPathData(
  points: DrawPoint[],
  options: FreehandEngineOptions,
): string {
  if (
    points.length === 0 ||
    !Number.isFinite(options.size) ||
    options.size <= 0
  ) {
    return '';
  }

  const stagedCount = ingest(
    points,
    options.size,
    options.simulatePressure,
  );
  const pointCount = streamline(
    stagedCount,
    options.size,
    options.streamline,
  );
  if (pointCount === 0) return '';

  calculateDynamics(pointCount, options);
  const partitionCount = partition(pointCount);
  buffers.writer.reset(pointCount * 96 + partitionCount * 160 + 128);
  for (let i = 0; i < partitionCount; i++) {
    writePartition(
      buffers.partitionStart[i]!,
      buffers.partitionEnd[i]!,
      options.size,
      options.smoothing,
    );
  }
  return buffers.writer.finish();
}
