import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { badRequest } from './errors.js';

export const privateDir = path.join(config.uploadDir, 'private');
export const publicDir = path.join(config.uploadDir, 'public');
fs.mkdirSync(privateDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });
// Render sets RENDER=true. Only an attached persistent disk (mounted under /var/data in render.yaml) survives deploys.
if (process.env.RENDER && !config.uploadDir.startsWith('/var/data')) {
  console.warn(`WARNING: uploads are stored in ${config.uploadDir}, which Render wipes on every deploy. Attach a persistent disk (see render.yaml).`);
}

const DOC_TYPES = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/(plain|csv)|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|vnd\.oasis\.opendocument\.[a-z.]+|zip|x-zip-compressed))$/;
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/;

function storage(dir) {
  return multer.diskStorage({
    destination: dir,
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase().slice(0, 10)),
  });
}

/** Private documents (served only through the authenticated download endpoint). */
export const documentUpload = multer({
  storage: storage(privateDir),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => (DOC_TYPES.test(file.mimetype) ? cb(null, true) : cb(badRequest(`File type ${file.mimetype} is not allowed`))),
});

/** Images (logo, item pictures) served from /uploads/public with unguessable names. */
export const imageUpload = multer({
  storage: storage(publicDir),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (IMAGE_TYPES.test(file.mimetype) ? cb(null, true) : cb(badRequest('Only PNG, JPG, GIF or WebP images are allowed'))),
});

export function removePublic(storedPath) {
  if (!storedPath) return;
  const file = path.join(publicDir, path.basename(storedPath));
  fs.promises.unlink(file).catch(() => {});
}
