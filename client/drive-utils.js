// drive-utils.js
// Converts various Google Drive share URLs to direct streamable URLs

export function driveUrlToStreamable(url) {
  if (!url || !url.trim()) return null;

  // Already a direct/embed link
  if (url.includes('drive.google.com/uc?') || url.includes('export=download')) {
    return ensureDirectLink(url);
  }

  // Standard share link: /file/d/{ID}/view or /file/d/{ID}/edit
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    const id = fileMatch[1];
    return `https://drive.google.com/file/d/${id}/preview`;
  }

  // Open link: id={ID}
  const openMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) {
    const id = openMatch[1];
    return `https://drive.google.com/file/d/${id}/preview`;
  }

  // If it's already an MP4 or direct video URL, use as-is
  if (url.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i)) {
    return url;
  }

  // Return original if we can't parse it — user might know what they're doing
  return url;
}

export function driveUrlToEmbed(url) {
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    const id = fileMatch[1];
    return `https://drive.google.com/file/d/${id}/preview`;
  }
  return url;
}

function ensureDirectLink(url) {
  if (!url.includes('export=download')) {
    return url + (url.includes('?') ? '&' : '?') + 'export=download';
  }
  return url;
}

export function isDirectVideoUrl(url) {
  return url.match(/\.(mp4|webm|ogg|mov|mkv)(\?.*)?$/i) !== null;
}

export function isDriveUrl(url) {
  return url.includes('drive.google.com');
}
