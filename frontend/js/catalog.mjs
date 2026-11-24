import { TRACKS, TYPES, CONFIG } from './config.mjs';

export function parseCatalog(courses, resources) {
  const byId = new Map(courses.map(course => [course.id, { ...course, resources: [] }]));
  for (const resource of resources) {
    if (byId.has(resource.course_id)) byId.get(resource.course_id).resources.push(resource);
  }
  return { courses: [...byId.values()], byId, resourceCount: resources.length };
}

export async function loadCatalog(token = '') {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const [courseResponse, resourceResponse] = await Promise.all([
    fetch(new URL('../courses.json', import.meta.url)),
    fetch(`${CONFIG.apiUrl}/resources`, { headers, cache: 'no-store' })
  ]);
  if (!courseResponse.ok || !resourceResponse.ok) {
    const error = new Error('Could not load the archive.');
    error.status = resourceResponse.status;
    throw error;
  }
  const { resources, user } = await resourceResponse.json();
  return { ...parseCatalog(await courseResponse.json(), resources), user };
}

export function filterCourses(courses, query, track, hasMaterials = false) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return courses.filter(course => (!hasMaterials || course.resources.length > 0)
    && (track === 'All' || course.tracks.includes(track))
    && terms.every(term => `${course.id} ${course.name} ${course.resources.map(r => r.title).join(' ')}`.toLocaleLowerCase().includes(term)));
}

export const COURSES_PER_PAGE = 20;
const validPage = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : 1;
export function paginateCourses(courses, requestedPage = 1) {
  const total = courses.length;
  const pages = Math.max(1, Math.ceil(total / COURSES_PER_PAGE));
  const page = Math.min(validPage(requestedPage), pages);
  const offset = (page - 1) * COURSES_PER_PAGE;
  return { courses: courses.slice(offset, offset + COURSES_PER_PAGE), page, pages, total,
    start: total ? offset + 1 : 0, end: Math.min(offset + COURSES_PER_PAGE, total) };
}

export function readRoute(href) {
  const params = new URL(href).searchParams;
  return {
    course: params.get('course') || '',
    about: params.get('view') === 'about',
    query: params.get('q') || '',
    track: TRACKS.includes(params.get('track')) ? params.get('track') : 'All',
    // Like the existing route fields, the first occurrence wins. Only "1" enables it.
    hasMaterials: params.get('hasMaterials') === '1',
    page: validPage(params.get('page'))
  };
}
export function routeUrl({ course = '', about = false, query = '', track = 'All', hasMaterials = false, page = 1 }, pathname = '/') {
  const params = new URLSearchParams();
  if (course) params.set('course', course);
  else if (about) params.set('view', 'about');
  if (query) params.set('q', query);
  if (TRACKS.includes(track)) params.set('track', track);
  if (hasMaterials === true) params.set('hasMaterials', '1');
  if (validPage(page) > 1) params.set('page', String(validPage(page)));
  return pathname + (params.size ? `?${params}` : '');
}

