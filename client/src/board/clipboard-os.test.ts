import { afterEach, describe, expect, it, vi } from 'vitest';
import { writePngToClipboard } from './clipboard-os';

/** Records what reached `navigator.clipboard.write`, and in what state. */
function stubClipboard(write: (items: unknown[]) => Promise<void>) {
  vi.stubGlobal('navigator', { clipboard: { write } });
}

/** Minimal ClipboardItem: keeps the value it was handed without resolving it. */
class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('writePngToClipboard', () => {
  it('writes before the blob resolves, preserving the user gesture', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    let handed: Record<string, Blob | Promise<Blob>> | null = null;
    stubClipboard(async (items) => {
      handed = (items[0] as FakeClipboardItem).items;
    });

    let resolveBlob!: (blob: Blob) => void;
    const png = new Promise<Blob>((resolve) => {
      resolveBlob = resolve;
    });
    const done = writePngToClipboard(png);

    // Asserted without awaiting: the write must already have been issued in
    // this same task, against the still-unresolved promise. Anything that
    // awaits the blob first loses the gesture and Safari rejects the write.
    expect(handed).not.toBeNull();
    expect(handed!['image/png']).toBe(png);

    resolveBlob(new Blob(['x'], { type: 'image/png' }));
    await expect(done).resolves.toBeUndefined();
  });

  it('retries with a resolved blob when promise items are rejected', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const blob = new Blob(['x'], { type: 'image/png' });
    const attempts: Array<Blob | Promise<Blob>> = [];
    stubClipboard(async (items) => {
      const value = (items[0] as FakeClipboardItem).items['image/png']!;
      attempts.push(value);
      // Stand in for Firefox, which only accepts an already-resolved blob.
      if (attempts.length === 1) throw new Error('promise items unsupported');
    });

    await expect(
      writePngToClipboard(Promise.resolve(blob)),
    ).resolves.toBeUndefined();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toBe(blob);
  });

  it('surfaces the render failure rather than the clipboard rejection', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    stubClipboard(async () => {
      throw new Error('clipboard rejected the pending item');
    });

    await expect(
      writePngToClipboard(Promise.reject(new Error('Nothing to copy'))),
    ).rejects.toThrow('Nothing to copy');
  });

  it('rejects without leaving the render unhandled when the API is missing', async () => {
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    vi.stubGlobal('navigator', {});
    const png = Promise.reject(new Error('render failed'));
    // Nothing else will consume the render, so it has to be settled here or it
    // surfaces as an unhandled rejection.
    const settled = vi.spyOn(png, 'catch');

    await expect(writePngToClipboard(png)).rejects.toThrow(
      'Clipboard API unavailable',
    );
    expect(settled).toHaveBeenCalled();
  });
});
