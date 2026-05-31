// subtitle-parser.js
// Supports .srt, .vtt, .ass formats
// Returns: Array of { start, end, text } in seconds

export function parseSubtitles(content, filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'srt') return parseSRT(content);
  if (ext === 'vtt') return parseVTT(content);
  if (ext === 'ass' || ext === 'ssa') return parseASS(content);
  return [];
}

function timeToSeconds(str) {
  // Handles HH:MM:SS,mmm or HH:MM:SS.mmm
  const clean = str.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(parts[0]);
}

function parseSRT(content) {
  const cues = [];
  const blocks = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    // Find the timecode line
    let timeLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) { timeLine = i; break; }
    }
    if (timeLine === -1) continue;
    const [startStr, endStr] = lines[timeLine].split('-->');
    const text = lines.slice(timeLine + 1).join('\n')
      .replace(/<[^>]+>/g, '') // strip HTML tags like <i>, <b>
      .trim();
    cues.push({
      start: timeToSeconds(startStr),
      end: timeToSeconds(endStr),
      text,
    });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function parseVTT(content) {
  const cues = [];
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let i = 0;
  // Skip header
  while (i < lines.length && !lines[i].includes('-->')) i++;

  while (i < lines.length) {
    if (lines[i].includes('-->')) {
      const [startStr, endStr] = lines[i].split('-->');
      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
        textLines.push(lines[i]);
        i++;
      }
      const text = textLines.join('\n')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (text) {
        cues.push({
          start: timeToSeconds(startStr),
          end: timeToSeconds(endStr),
          text,
        });
      }
    } else {
      i++;
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

function parseASS(content) {
  const cues = [];
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let inEvents = false;
  let formatIndices = {};

  for (const line of lines) {
    if (line.trim() === '[Events]') { inEvents = true; continue; }
    if (inEvents && line.startsWith('[')) { inEvents = false; continue; }
    if (!inEvents) continue;

    if (line.startsWith('Format:')) {
      const fields = line.substring(7).split(',').map(f => f.trim());
      fields.forEach((f, idx) => { formatIndices[f] = idx; });
      continue;
    }

    if (line.startsWith('Dialogue:')) {
      const parts = line.substring(9).split(',');
      const startStr = parts[formatIndices['Start']];
      const endStr = parts[formatIndices['End']];
      // Text is after the last expected field
      const textIdx = formatIndices['Text'];
      const rawText = parts.slice(textIdx).join(',')
        .replace(/\{[^}]+\}/g, '') // remove ASS tags
        .replace(/\\N/g, '\n')
        .replace(/\\n/g, '\n')
        .trim();
      if (startStr && endStr && rawText) {
        cues.push({
          start: timeToSeconds(startStr),
          end: timeToSeconds(endStr),
          text: rawText,
        });
      }
    }
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function getActiveCue(cues, currentTime) {
  // Binary search for performance with large subtitle files
  if (!cues || cues.length === 0) return null;
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (currentTime < c.start) hi = mid - 1;
    else if (currentTime > c.end) lo = mid + 1;
    else return c;
  }
  return null;
}
