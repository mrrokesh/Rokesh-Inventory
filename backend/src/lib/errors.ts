export class HttpError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function errorHandler(err: any, _req: any, res: any, _next: any) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Translate common PostgreSQL constraint errors into friendly messages.
  if (err.code === '23505') return res.status(409).json({ error: duplicateMessage(err) });
  if (err.code === '23503') {
    return res.status(409).json({ error: 'This record is referenced by other records and cannot be changed or deleted.' });
  }
  if (err.code === '23514') return res.status(400).json({ error: 'A value is out of the allowed range.' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid value supplied.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large (max 10 MB).' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
}

function duplicateMessage(err) {
  const c = err.constraint || '';
  if (c.includes('sku')) return 'An item with this SKU already exists.';
  if (c.includes('email')) return 'This email address is already in use.';
  if (c.includes('number')) return 'This document number is already in use.';
  if (c.includes('name')) return 'A record with this name already exists.';
  return 'A record with these details already exists.';
}
