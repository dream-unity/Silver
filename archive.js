const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BLOCK = 512;
const PRODUCT = 'Silver Private Journal';
const ARCHIVE_VERSION = 1;

function writeString(target, offset, length, value) {
  const bytes = encoder.encode(String(value));
  target.set(bytes.subarray(0, length), offset);
}

function writeOctal(target, offset, length, value) {
  const octal = Math.max(0, Number(value) || 0).toString(8).padStart(length - 1, '0').slice(-(length - 1));
  writeString(target, offset, length, `${octal}\0`);
}

function createTarHeader(name, size, modifiedAt = Date.now()) {
  if (encoder.encode(name).length > 100) throw new Error(`Archive path is too long: ${name}`);
  const header = new Uint8Array(BLOCK);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o600);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(modifiedAt / 1000));
  header.fill(32, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'silver');
  writeString(header, 297, 32, 'silver');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, '0');
  writeString(header, 148, 8, `${checksumText}\0 `);
  return header;
}

function paddingFor(size) {
  const remainder = size % BLOCK;
  return remainder ? new Uint8Array(BLOCK - remainder) : new Uint8Array(0);
}

function cleanExtension(name, mimeType = '') {
  const fromName = String(name || '').match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName.replace(/[^a-z0-9]/g, '');
  const map = {
    'video/webm': 'webm',
    'video/mp4': 'mp4',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'application/pdf': 'pdf',
    'text/plain': 'txt'
  };
  return map[mimeType] || 'bin';
}

function safeName(value) {
  return String(value || 'file')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 46) || 'file';
}

export async function createSilverArchive(library, fileName = '') {
  const attachments = library.attachments || [];
  const attachmentManifest = attachments.map(attachment => {
    const extension = cleanExtension(attachment.name, attachment.mimeType);
    const path = `media/${safeName(attachment.id)}-${safeName(attachment.name || attachment.kind)}.${extension}`.slice(0, 99);
    const { blob, ...metadata } = attachment;
    return { ...metadata, size: blob?.size ?? attachment.size ?? 0, path };
  });

  const safeSettings = { ...(library.settings || {}) };
  delete safeSettings.lock;

  const manifest = {
    product: PRODUCT,
    archiveVersion: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      collections: library.collections?.length || 0,
      journals: library.journals?.length || 0,
      entries: library.entries?.length || 0,
      attachments: attachments.length,
      templates: library.templates?.length || 0
    },
    collections: library.collections || [],
    journals: library.journals || [],
    entries: library.entries || [],
    templates: library.templates || [],
    settings: safeSettings,
    attachments: attachmentManifest
  };

  const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2));
  const parts = [
    createTarHeader('manifest.json', manifestBytes.byteLength),
    manifestBytes,
    paddingFor(manifestBytes.byteLength)
  ];

  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    const metadata = attachmentManifest[index];
    const blob = attachment.blob instanceof Blob
      ? attachment.blob
      : new Blob([], { type: attachment.mimeType || 'application/octet-stream' });
    parts.push(createTarHeader(metadata.path, blob.size, attachment.createdAt || Date.now()));
    parts.push(blob);
    parts.push(paddingFor(blob.size));
  }

  parts.push(new Uint8Array(BLOCK * 2));
  const archive = new Blob(parts, { type: 'application/x-silver-archive' });
  const suggestedName = fileName || `silver-${new Date().toISOString().slice(0, 10)}.silver`;
  return { blob: archive, fileName: suggestedName, manifest };
}

function readString(bytes, offset, length) {
  const slice = bytes.subarray(offset, offset + length);
  const zero = slice.indexOf(0);
  return decoder.decode(zero >= 0 ? slice.subarray(0, zero) : slice).trim();
}

function readOctal(bytes, offset, length) {
  const value = readString(bytes, offset, length).replace(/\0/g, '').trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function isZeroBlock(bytes) {
  for (const byte of bytes) if (byte !== 0) return false;
  return true;
}

async function readHeader(file, offset) {
  const bytes = new Uint8Array(await file.slice(offset, offset + BLOCK).arrayBuffer());
  if (bytes.byteLength < BLOCK || isZeroBlock(bytes)) return null;
  const name = readString(bytes, 0, 100);
  const size = readOctal(bytes, 124, 12);
  const magic = readString(bytes, 257, 6);
  if (!name || (magic && magic !== 'ustar')) throw new Error('This file is not a valid Silver archive.');
  return { name, size };
}

export async function parseSilverArchive(file) {
  if (!(file instanceof Blob) || file.size < BLOCK) throw new Error('Choose a valid .silver archive.');
  let offset = 0;
  let manifest = null;
  const media = new Map();

  while (offset + BLOCK <= file.size) {
    const header = await readHeader(file, offset);
    if (!header) break;
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + header.size;
    if (dataEnd > file.size) throw new Error('The Silver archive appears truncated or damaged.');
    const content = file.slice(dataStart, dataEnd);

    if (header.name === 'manifest.json') {
      manifest = JSON.parse(await content.text());
    } else if (header.name.startsWith('media/')) {
      media.set(header.name, content);
    }
    offset = dataStart + Math.ceil(header.size / BLOCK) * BLOCK;
  }

  if (!manifest || manifest.product !== PRODUCT) throw new Error('The selected file is not a Silver journal archive.');
  if (Number(manifest.archiveVersion) > ARCHIVE_VERSION) throw new Error('This archive was created by a newer version of Silver.');

  const attachments = (manifest.attachments || []).map(metadata => {
    const blob = media.get(metadata.path);
    if (!blob) throw new Error(`Archive media is missing: ${metadata.name || metadata.id}`);
    const { path, ...record } = metadata;
    return {
      ...record,
      blob: blob.slice(0, blob.size, metadata.mimeType || blob.type || 'application/octet-stream'),
      size: blob.size
    };
  });

  return {
    collections: manifest.collections || [],
    journals: manifest.journals || [],
    entries: manifest.entries || [],
    templates: manifest.templates || [],
    settings: manifest.settings || {},
    attachments,
    archiveMeta: {
      exportedAt: manifest.exportedAt,
      counts: manifest.counts || {}
    }
  };
}

export function createReadableText(library) {
  const journals = new Map((library.journals || []).map(journal => [journal.id, journal]));
  const attachments = library.attachments || [];
  const attachmentCount = new Map();
  attachments.forEach(attachment => attachmentCount.set(attachment.entryId, (attachmentCount.get(attachment.entryId) || 0) + 1));

  const entries = [...(library.entries || [])].sort((a, b) => b.createdAt - a.createdAt);
  const sections = entries.map(entry => {
    const date = new Date(entry.createdAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
    const journal = journals.get(entry.journalId)?.name || 'Journal';
    const tags = entry.tags?.length ? `\nTags: ${entry.tags.join(', ')}` : '';
    const mood = entry.mood ? `\nMood: ${entry.mood}` : '';
    const location = entry.location?.label ? `\nPlace: ${entry.location.label}` : '';
    const media = attachmentCount.get(entry.id) ? `\nMedia attachments: ${attachmentCount.get(entry.id)} (originals are in the .silver archive)` : '';
    return [
      '#'.repeat(72),
      entry.title || 'Untitled entry',
      date,
      `Journal: ${journal}${tags}${mood}${location}${media}`,
      '-'.repeat(72),
      entry.body || '(No written text)'
    ].join('\n');
  });

  return [
    'SILVER JOURNAL — READABLE EXPORT',
    `Exported: ${new Date().toLocaleString()}`,
    `Entries: ${entries.length}`,
    '',
    ...sections
  ].join('\n\n');
}
