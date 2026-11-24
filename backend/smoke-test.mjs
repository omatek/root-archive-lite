import assert from 'node:assert/strict';

const front = 'https://archive-lite.rootamman.com';
const api = 'https://api-lite.rootamman.com';
const assets = 'https://assets-lite.rootamman.com';
const origin = { Origin: front };
async function request(url, options = {}, expected = 200) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expected, `${options.method || 'GET'} ${url}: HTTP ${response.status}`);
  console.log(`PASS ${options.method || 'GET'} ${url} → ${response.status}`);
  return response;
}
const html = await (await request(front + '/')).text();
assert.match(html, /<html/i);
const courses = await (await request(front + '/courses.json')).json();
assert.equal(courses.length, 127);
console.log('PASS course catalog is valid JSON');
const res = await request(api + '/resources', { headers: origin });
assert.equal(res.headers.get('access-control-allow-origin'), front);
const listing = await res.json();
assert.ok(Array.isArray(listing.resources));
console.log('PASS public listing and allowed-origin CORS');
const preflight = await request(api + '/upload', { method: 'OPTIONS', headers: { ...origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } }, 204);
assert.equal(preflight.headers.get('access-control-allow-origin'), front);
console.log('PASS CORS preflight');
const hostile = await request(api + '/resources', { headers: { Origin: 'https://example.invalid' } });
assert.notEqual(hostile.headers.get('access-control-allow-origin'), 'https://example.invalid');
for (const [method, path] of [['POST','/upload'],['PATCH','/resources/2147483647'],['DELETE','/resources/2147483647']]) {
  await request(api + path, { method, headers: origin }, 401);
}
await request(api + '/upload', { method:'POST', headers:{...origin, Authorization:'Bearer invalid-token'} }, 401);
for (const [method,path] of [['GET','/resources'],['POST','/upload'],['PATCH','/resources/2147483647'],['DELETE','/resources/2147483647']]) {
  await request(assets + path, {method,headers:origin},404);
}
console.log('PASS live read-only and rejected-mutation smoke checks');
