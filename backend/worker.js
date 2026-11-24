import { createRemoteJWKSet, jwtVerify } from 'jose';
import courses from '../frontend/courses.json' with { type: 'json' };
import { TYPES } from '../frontend/js/config.mjs';

const courseIds = new Set(courses.map(course => course.id));
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const emailList = value => (value || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

// HTTP helpers: errors are returned as JSON, not internal stack traces.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
function cors(response, request, env) {
  const headers = new Headers(response.headers);
  if (request.headers.get('Origin') === env.ALLOWED_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  headers.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, headers });
}

// Google proves identity; the Worker decides whether the identity is eligible.
async function authenticate(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Sign in with Google first.');
  if (!env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID.startsWith('REPLACE')) {
    throw new HttpError(503, 'Google sign-in is not configured.');
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(authorization.slice(7), googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: env.GOOGLE_CLIENT_ID,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub', 'email', 'email_verified']
    }));
  } catch {
    throw new HttpError(401, 'Google sign-in expired or is invalid. Sign in again.');
  }
  if (payload.email_verified !== true || typeof payload.email !== 'string' || typeof payload.sub !== 'string' || !payload.sub) {
    throw new HttpError(403, 'A verified Google account is required.');
  }
  const email = payload.email.toLowerCase();
  const hostedDomain = env.GOOGLE_HOSTED_DOMAIN?.toLowerCase();
  const student = email.endsWith('@' + env.STUDENT_EMAIL_DOMAIN.toLowerCase())
    && Boolean(hostedDomain) && payload.hd === hostedDomain;
  // A non-Gmail, non-Workspace address is not authoritative in Google sign-in.
  const admin = emailList(env.ADMIN_EMAILS).includes(email)
    && (email.endsWith('@gmail.com') || Boolean(payload.hd));
  const demoEmails = emailList(env.DEMO_EMAILS);
  const allowed = !demoEmails.length || demoEmails.includes(email);
  return { sub: payload.sub, student: student && allowed, admin: admin && allowed };
}
function canEdit(resource, user) {
  return Boolean(user && (user.admin || (user.student && resource.owner_id === user.sub)));
}

// The same metadata rules apply to both upload and edit.
function text(value, min, max, label) {
  if (typeof value !== 'string') throw new HttpError(400, `Invalid ${label}.`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max || /[\x00-\x1f\x7f-\x9f<>]/u.test(trimmed)) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return trimmed;
}
function metadata(input) {
  const title = text(input.title, 3, 120, 'title');
  const type = input.type;
  if (!TYPES.includes(type)) throw new HttpError(400, 'Invalid resource type.');
  const semester = text(input.semester ?? '', 0, 20, 'semester');
  return { title, type, semester };
}

async function listResources(request, env) {
  const user = request.headers.has('Authorization') ? await authenticate(request, env) : null;
  const { results } = await env.DB.prepare('SELECT * FROM resources ORDER BY id DESC').all();
  const resources = results.map(row => ({
    id: row.id,
    course_id: row.course_id,
    title: row.title,
    type: row.type,
    semester: row.semester,
    contributor: row.contributor,
    asset_url: new URL('/files/' + row.file_key, request.url).href,
    can_edit: canEdit(row, user)
  }));
  return json({ resources, user: user ? { can_upload: user.student, admin: user.admin } : null });
}

async function upload(request, env) {
  const user = await authenticate(request, env);
  if (!user.student) throw new HttpError(403, 'Only eligible students can upload.');
  const maxBytes = Number(env.MAX_FILE_MB) * 1024 * 1024;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new HttpError(503, 'Upload limit is not configured.');
  // Reject oversized declared bodies before parsing multipart data.
  if (Number(request.headers.get('Content-Length')) > maxBytes + 65536) {
    throw new HttpError(413, 'Upload is too large.');
  }
  const form = await request.formData().catch(() => { throw new HttpError(400, 'Expected multipart form data.'); });
  const courseId = form.get('course_id');
  if (!courseIds.has(courseId)) throw new HttpError(400, 'Unknown course.');
  const { title, type, semester } = metadata(Object.fromEntries(form));
  const contributor = text(form.get('contributor') ?? '', 0, 40, 'contributor');
  const file = form.get('file');
  if (!(file instanceof File) || !file.size || file.type !== 'application/pdf' || !/\.pdf$/i.test(file.name)) {
    throw new HttpError(400, 'Choose a PDF file.');
  }
  if (file.size > maxBytes) throw new HttpError(413, `PDF exceeds ${env.MAX_FILE_MB} MiB.`);
  if (await file.slice(0, 5).text() !== '%PDF-') throw new HttpError(400, 'Invalid PDF signature.');
  const key = crypto.randomUUID() + '.pdf';
  await env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'application/pdf' } });
  try {
    const result = await env.DB.prepare(
      'INSERT INTO resources (course_id, title, type, semester, contributor, owner_id, file_key) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(courseId, title, type, semester, contributor, user.sub, key).run();
    return json({ id: result.meta.last_row_id }, 201);
  } catch (error) {
    // Compensate for a failed metadata insert. If cleanup fails, remove the orphan manually.
    try { await env.FILES.delete(key); }
    catch { console.error('Upload cleanup failed for object', key); }
    throw error;
  }
}

async function getFile(key, env) {
  // Only published metadata may expose an object, even if an orphan exists in R2.
  const resource = await env.DB.prepare('SELECT id FROM resources WHERE file_key = ?').bind(key).first();
  if (!resource) throw new HttpError(404, 'Resource not found.');
  const object = await env.FILES.get(key);
  if (!object) throw new HttpError(404, 'PDF not found.');
  return new Response(object.body, { headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="resource.pdf"',
    'Content-Length': String(object.size),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'no-store'
  } });
}

async function modifyResource(request, env, id) {
  const user = await authenticate(request, env);
  const resource = await env.DB.prepare('SELECT * FROM resources WHERE id = ?').bind(id).first();
  if (!resource) throw new HttpError(404, 'Resource not found.');
  if (!canEdit(resource, user)) throw new HttpError(403, 'You cannot modify this resource.');
  if (request.method === 'PATCH') {
    const changes = await request.json().catch(() => { throw new HttpError(400, 'Expected JSON.'); });
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new HttpError(400, 'Invalid metadata.');
    const { title, type, semester } = metadata({ ...resource, ...changes });
    const result = await env.DB.prepare('UPDATE resources SET title = ?, type = ?, semester = ? WHERE id = ?')
      .bind(title, type, semester, id).run();
    if (!result.meta.changes) throw new HttpError(404, 'Resource no longer exists.');
    return json({ message: 'Resource updated.' });
  }
  // Delete R2 first: if D1 fails, its row retains the key and deletion can be retried.
  await env.FILES.delete(resource.file_key);
  try {
    await env.DB.prepare('DELETE FROM resources WHERE id = ?').bind(id).run();
  } catch {
    throw new HttpError(500, 'PDF removed, but metadata deletion failed. Retry deletion.');
  }
  return json({ message: 'Resource deleted.' });
}

async function route(request, env) {
  const { pathname } = new URL(request.url);
  const method = request.method;
  if (method === 'OPTIONS') return new Response(null, { status: 204 });
  if (method === 'GET' && pathname === '/resources') return listResources(request, env);
  if (method === 'POST' && pathname === '/upload') return upload(request, env);
  const file = pathname.match(/^\/files\/([a-f0-9-]{36}\.pdf)$/);
  if (method === 'GET' && file) return getFile(file[1], env);
  const resource = pathname.match(/^\/resources\/([1-9]\d*)$/);
  if (resource && ['PATCH', 'DELETE'].includes(method)) {
    return modifyResource(request, env, resource[1]);
  }
  throw new HttpError(404, 'Endpoint not found.');
}

export default {
  async fetch(request, env) {
    try {
      return cors(await route(request, env), request, env);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Worker operation failed:', error.message);
      return cors(json({ error: error instanceof HttpError ? error.message : 'Storage or server operation failed. Try again.' },
        error instanceof HttpError ? error.status : 500), request, env);
    }
  }
};
