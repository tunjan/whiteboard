/**
 * Preview metadata for a pasted link, unfurled server-side
 * (`GET /api/links/unfurl?url=`). Every field but `url` is optional: sites vary
 * in what they publish, and the card renders from whatever came back.
 */
export interface LinkUnfurl {
  /** The URL that was unfurled (the request's, not the redirect target). */
  url: string;
  title?: string;
  description?: string;
  /** Blob ids of the preview image and site icon, stored via `/api/blobs`. */
  imageBlobId?: string;
  faviconBlobId?: string;
}
