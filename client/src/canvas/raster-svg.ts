/** SVG images cannot load the page's fonts or external images. A bounded,
 * per-cache resource pool embeds those dependencies before rasterization. */
export class RasterResources {
  private entries = new Map<string, Promise<string>>();
  private bytes = 0;
  private abort = new AbortController();

  dispose() {
    this.abort.abort();
    this.entries.clear();
  }

  private dataUrl(url: string): Promise<string> {
    if (url.startsWith('data:')) return Promise.resolve(url);
    const absolute = new URL(url, document.baseURI);
    // Linked/embedded content is left live. Only board-owned resources are
    // fetched; a failed or oversized dependency leaves the vectors visible.
    if (absolute.origin !== location.origin)
      return Promise.reject(new Error('External raster asset'));
    let pending = this.entries.get(absolute.href);
    if (!pending) {
      if (this.entries.size >= 64)
        return Promise.reject(new Error('Raster resource limit'));
      pending = fetch(absolute.href, {
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(5000)]),
      }).then(async (response) => {
        if (!response.ok) throw new Error('Raster asset unavailable');
        const blob = await response.blob();
        this.bytes += blob.size;
        if (this.bytes > 16 * 1024 * 1024)
          throw new Error('Raster resource limit');
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      });
      this.entries.set(absolute.href, pending);
    }
    return pending;
  }

  async inline(svg: SVGSVGElement): Promise<string> {
    if (
      svg.querySelector(
        'foreignObject, script, animate, animateTransform, animateMotion, set',
      )
    ) {
      throw new Error('Live content cannot be cached');
    }
    const work: Promise<unknown>[] = [];
    for (const image of svg.querySelectorAll('image')) {
      const href =
        image.getAttribute('href') ??
        image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (href)
        work.push(
          this.dataUrl(href).then((data) => {
            image.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
            image.setAttribute('href', data);
          }),
        );
    }
    const fonts = new Set<string>();
    for (const text of svg.querySelectorAll<SVGTextElement>('text, tspan')) {
      const family = text.getAttribute('font-family') ?? text.style.fontFamily;
      if (family) fonts.add(family);
    }
    const faces: Promise<string>[] = [];
    if (fonts.size) {
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of rules) {
          if (!(rule instanceof CSSFontFaceRule)) continue;
          const family = rule.style
            .getPropertyValue('font-family')
            .replace(/['"]/g, '')
            .trim();
          if (![...fonts].some((font) => font.includes(family))) continue;
          const source = rule.style.getPropertyValue('src');
          const url = source.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
          if (!url) continue;
          const absolute = new URL(url, sheet.href ?? document.baseURI).href;
          faces.push(
            this.dataUrl(absolute).then((data) =>
              rule.cssText.replace(source, `url("${data}")`),
            ),
          );
        }
      }
    }
    const [css] = await Promise.all([Promise.all(faces), Promise.all(work)]);
    if (css.length) {
      const style = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'style',
      );
      style.textContent = css.join('\n');
      svg.prepend(style);
    }
    return new XMLSerializer().serializeToString(svg);
  }
}

/** No bitmap promotion hint: it regressed Firefox in the prior experiment. */
export async function rasterizeSvg(
  svg: string,
  pixels: number,
): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
  );
  const image = new Image();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Raster decode timed out')),
        5000,
      );
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Raster decode failed'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = pixels;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(image, 0, 0, pixels, pixels);
    return canvas;
  } finally {
    clearTimeout(timeout);
    image.onload = image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
