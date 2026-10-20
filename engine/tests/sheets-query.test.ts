import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetsFixture } from './fixtures/sheets-http.js';
import { tokenContext, updateOAuthAuthorization } from '../src/oauth/access.js';
import { seal } from '../src/oauth/crypto.js';
import { seedMember } from './fixtures/membership.js';
import { randomUUID } from 'node:crypto';

type Fixture = Awaited<ReturnType<typeof sheetsFixture>>;
const title = "Client's Data";
const body = (f: Fixture, patch: Record<string, unknown> = {}) => ({ expectedTenantId: f.actor.tenantId, expectedRevision: 1, sheetTitle: title, scanRange: 'A1:C5', headers: true, filters: [], variables: [], ...patch });
const query = (f: Fixture, input: unknown = body(f)) => f.request('POST', `${f.prefix}/${f.binding.id}/query`, input);
const values = (f: Fixture, cells: unknown[][], range = "'Client''s Data'!A1:C5") => { f.hooks.provider = r => r.url.hostname === 'sheets.googleapis.com' ? Response.json({ range, majorDimension: 'ROWS', values: cells }) : undefined; };

test('formatted query filters server-side without changing the binding or storing data', async t => {
  const f = await sheetsFixture(t), before = f.store.db.prepare('SELECT * FROM entities ORDER BY id').all();
  values(f, [['Nome', 'Quantidade', 'Ativo'], ['Marina', '9', 'TRUE'], ['Pedro', '10', 'FALSE']]);
  const result = await query(f, body(f, { filters: [{ column: 'Quantidade', op: 'gt', value: { kind: 'literal', value: '10' } }] }));
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json().rows, [{ rowNumber: 2, cells: ['Marina', '9', 'TRUE'] }]);
  assert.deepEqual(result.json().coverage, { scope: 'requested_range', completeWithinRange: true, wholeSheet: 'unknown', examinedRows: 4, nonEmptyRows: 2, matchedRows: 1, returnedRows: 1 });
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].method, 'GET');
  assert.equal(f.requests[0].url.searchParams.get('valueRenderOption'), 'FORMATTED_VALUE');
  assert.equal(f.requests[0].url.searchParams.has('dateTimeRenderOption'), false);
  assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY id').all(), before);
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('missing query variable rejects before OAuth refresh or Google read', async t => {
  const f = await sheetsFixture(t); f.setTokens(1);
  const result = await query(f, body(f, { filters: [{ column: 'Nome', op: 'eq', value: { kind: 'variable', name: 'missing' } }] }));
  assert.equal(result.statusCode, 400, result.body); assert.equal(result.json().error.code, 'sheet_query_variable_invalid');
  assert.equal(f.requests.length, 0);
});

test('eq ne in and typed references compare literal strings without JSON interpolation', async t => {
  const f = await sheetsFixture(t); values(f, [['Nome', 'N', 'B'], ['{{personNumber}}', '10', 'false'], ['Other', '10', 'FALSE']]);
  const result = await query(f, body(f, { variables: [{ name: 'n', type: 'number', value: 10 }, { name: 'b', type: 'boolean', value: false }], filters: [
    { column: 'Nome', op: 'in', values: [{ kind: 'literal', value: '{{personNumber}}' }, { kind: 'literal', value: 'Other' }] },
    { column: 'Nome', op: 'ne', value: { kind: 'literal', value: 'Other' } },
    { column: 'N', op: 'eq', value: { kind: 'variable', name: 'n' } },
    { column: 'N', op: 'in', values: [{ kind: 'variable', name: 'n' }] },
    { column: 'B', op: 'eq', value: { kind: 'variable', name: 'b' } },
  ] }));
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().rows.length, 1); assert.equal(result.json().rows[0].rowNumber, 2);
  assert.ok(!f.requests[0].url.href.includes('personNumber')); assert.equal(f.requests[0].body, undefined);
});

test('variable names, use and exact runtime types are checked before even token refresh', async t => {
  const f = await sheetsFixture(t); f.setTokens(1);
  const candidates = [
    [{ name: 'unused', type: 'text', value: 'private' }],
    [{ name: 'x', type: 'text', value: '1' }, { name: 'x', type: 'text', value: '2' }],
    [{ name: 'x', type: 'number', value: '2' }], [{ name: 'x', type: 'boolean', value: 1 }],
  ];
  for (const variables of candidates) { const response = await query(f, body(f, { variables })); assert.equal(response.statusCode, 400); assert.equal(response.json().error.code, 'sheet_query_variable_invalid'); assert.ok(!response.body.includes('private')); }
  assert.equal(f.requests.length, 0);
});

test('invalid query structure cannot silently broaden the filter', async t => {
  const f = await sheetsFixture(t);
  for (const patch of [{ phase: 'after' }, { headers: false, filters: [{ column: 'X', op: 'eq', value: { kind: 'literal', value: '' } }] }, { filters: [{ column: 'X', op: 'where', code: 'return true' }] }, { filters: [{ column: 'X', op: 'eq', value: { kind: 'literal', value: 'x', script: 'anything' } }] }]) {
    const result = await query(f, body(f, patch)); assert.equal(result.statusCode, 400); assert.equal(result.json().error.code, 'invalid_sheets_query');
  }
  assert.equal(f.requests.length, 0);
});

test('closed ranges reject overflow, reversal, open ranges and header outside row one without I/O', async t => {
  const f = await sheetsFixture(t);
  for (const scanRange of ['A:C', 'A1', 'A1:A1001', 'A1:AY10', 'A1:AX401', 'B2:A1', 'A2:C5', 'A1:C1', '$A$1:C5', 'Sheet!A1:C5']) {
    const result = await query(f, body(f, { scanRange })); assert.equal(result.statusCode, 400, scanRange); assert.equal(result.json().error.code, 'sheet_range_limit', scanRange);
  }
  assert.equal(f.requests.length, 0);
});

test('headers are exact and prototype-named cells remain inert arrays', async t => {
  const f = await sheetsFixture(t); values(f, [['__proto__', 'constructor', 'Nome'], ['text', 'other', 'Marina']]);
  const result = await query(f, body(f, { filters: [{ column: '__proto__', op: 'eq', value: { kind: 'literal', value: 'text' } }] }));
  assert.equal(result.statusCode, 200); assert.deepEqual(result.json().columns.map((v: any) => v.header), ['__proto__', 'constructor', 'Nome']);
  assert.equal(({} as any).text, undefined);
  const wrongCase = await query(f, body(f, { filters: [{ column: 'nome', op: 'eq', value: { kind: 'literal', value: 'Marina' } }] }));
  assert.equal(wrongCase.statusCode, 422); assert.equal(wrongCase.json().error.code, 'sheet_query_column_not_found');
});

test('blank and duplicate headers fail even when no filter references that column', async t => {
  const f = await sheetsFixture(t);
  for (const headers of [[], ['A', '', 'C'], ['A', ' ', 'C'], ['A', 'A', 'C'], ['A', 'x'.repeat(257), 'C']]) {
    values(f, [headers]); const result = await query(f); assert.equal(result.statusCode, 422); assert.equal(result.json().error.code, 'sheet_query_headers_invalid');
  }
  values(f, [['A', 'a', ' A'], ['x', 'y', 'z']]); assert.equal((await query(f)).statusCode, 200);
});

test('raw matrix preserves absolute coordinates and blanks without inventing empty records', async t => {
  const f = await sheetsFixture(t); values(f, [['x'], [], ['', ' ']], "'Client''s Data'!B8:D12");
  const result = await query(f, body(f, { scanRange: 'b8:d12', headers: false })); assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json().columns, [{ index: 2, a1: 'B', header: null }, { index: 3, a1: 'C', header: null }, { index: 4, a1: 'D', header: null }]);
  assert.deepEqual(result.json().rows, [{ rowNumber: 8, cells: ['x', '', ''] }, { rowNumber: 10, cells: ['', ' ', ''] }]);
  assert.equal(result.json().coverage.examinedRows, 5); assert.equal(result.json().coverage.nonEmptyRows, 2); assert.equal(result.json().scanRange, 'B8:D12');
});

test('trailing omitted values are empty and empty literal is distinct from absent variable', async t => {
  const f = await sheetsFixture(t); values(f, [['Nome', 'N', 'B'], ['Marina'], ['Pedro', '1']]);
  const result = await query(f, body(f, { filters: [{ column: 'N', op: 'eq', value: { kind: 'literal', value: '' } }] }));
  assert.equal(result.statusCode, 200); assert.deepEqual(result.json().rows, [{ rowNumber: 2, cells: ['Marina', '', ''] }]);
});

test('missing values is valid only for headerless reads and never marks a binding verified', async t => {
  const f = await sheetsFixture(t); f.hooks.provider = () => Response.json({ range: "'Client''s Data'!A1:C5" });
  assert.equal((await query(f)).json().error.code, 'sheet_query_headers_invalid');
  const result = await query(f, body(f, { headers: false })); assert.equal(result.statusCode, 200); assert.deepEqual(result.json().rows, []);
  assert.equal(f.store.get(f.actor.tenantId, 'oauth-sheets-bindings', f.binding.id)!.lastVerifiedAt, undefined);
});

test('FORMATTED response must match the requested title geometry and string types', async t => {
  const f = await sheetsFixture(t);
  for (const response of [
    { range: "'Other'!A1:C5", values: [['private']] }, { range: "'Client''s Data'!A1:C6", values: [] },
    { range: "'Client''s Data'!A1:C5", values: [['N', 'N2', 'N3'], [9, true, {}]] },
    { range: "'Client''s Data'!A1:C5", majorDimension: 'COLUMNS', values: [] },
    { range: "'Client''s Data'!A1:C5", values: [['a', 'b', 'c', 'd']] },
  ]) { f.hooks.provider = () => Response.json(response); const result = await query(f); assert.equal(result.statusCode, 502); assert.equal(result.json().error.code, 'provider_response_invalid'); assert.ok(!result.body.includes('private')); }
});

test('maxRows limits output not examined/matched counts and reports actual serialized byte budget', async t => {
  const f = await sheetsFixture(t); values(f, [['A', 'B', 'C'], ['um'], ['dois'], ['três']]);
  const result = await query(f, body(f, { maxRows: 1 })); assert.equal(result.statusCode, 200);
  const data = result.json(); assert.equal(data.coverage.matchedRows, 3); assert.equal(data.coverage.returnedRows, 1); assert.deepEqual(data.truncationReasons, ['max_rows']);
  assert.equal(data.resultBytes, Buffer.byteLength(JSON.stringify({ columns: data.columns, rows: data.rows }))); assert.equal(data.coverage.wholeSheet, 'unknown');
});

test('UTF8 result budget keeps a prefix without slicing a row or skipping a large match', async t => {
  const f = await sheetsFixture(t); values(f, [['A', 'B', 'C'], ['é'.repeat(24000)], ['é'.repeat(24000)], ['small']]);
  const result = await query(f); assert.equal(result.statusCode, 200); const data = result.json();
  assert.equal(data.rows.length, 1); assert.equal(data.rows[0].cells[0].length, 24000); assert.equal(data.coverage.matchedRows, 3);
  assert.deepEqual(data.truncationReasons, ['result_bytes']); assert.equal(data.resultBytes, Buffer.byteLength(JSON.stringify({ columns: data.columns, rows: data.rows })));
  values(f, [['A', 'B', 'C'], ['é'.repeat(48000)]]); assert.equal((await query(f)).json().error.code, 'sheet_query_limit');
});

test('regex supports substring anchors and i with compiled RE2JS only', async t => {
  const f = await sheetsFixture(t); values(f, [['A', 'B', 'C'], ['xx MARINA yy'], ['marina'], ['other']]);
  let result = await query(f, body(f, { filters: [{ column: 'A', op: 'regex', pattern: 'marina', flags: 'i' }] }));
  assert.equal(result.statusCode, 200); assert.equal(result.json().coverage.matchedRows, 2);
  result = await query(f, body(f, { filters: [{ column: 'A', op: 'regex', pattern: '^marina$', flags: '' }] })); assert.equal(result.json().coverage.matchedRows, 1);
});

test('regex rejects unsupported syntax and excessive programs before provider work', async t => {
  const f = await sheetsFixture(t); f.setTokens(1);
  for (const pattern of ['[', '(a)\\1', '(?=x)', '(?<=x)y', 'x'.repeat(257)]) {
    const result = await query(f, body(f, { filters: [{ column: 'A', op: 'regex', pattern, flags: '' }] })); assert.equal(result.statusCode, 400, pattern); assert.equal(result.json().error.code, 'sheet_query_regex_invalid');
  }
  const program = await query(f, body(f, { filters: [{ column: 'A', op: 'regex', pattern: 'a{999}', flags: '' }] })); assert.equal(program.statusCode, 413, program.body);
  const count = await query(f, body(f, { filters: Array.from({ length: 5 }, () => ({ column: 'A', op: 'regex', pattern: 'a', flags: '' })) })); assert.equal(count.statusCode, 413);
  assert.equal(f.requests.length, 0);
});

test('nested-quantifier adversarial input is handled without native backtracking', { timeout: 5000 }, async t => {
  const f = await sheetsFixture(t); values(f, [['A', 'B', 'C'], ['a'.repeat(30000) + '!']]);
  const result = await query(f, body(f, { filters: [{ column: 'A', op: 'regex', pattern: '(a+)+$', flags: '' }] }));
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().coverage.matchedRows, 0);
});

test('regex combined scan cost rejects without partial results', async t => {
  const f = await sheetsFixture(t); values(f, [['A'], ...Array.from({ length: 999 }, () => ['x'.repeat(501)])], "'Client''s Data'!A1:A1000");
  const result = await query(f, body(f, { scanRange: 'A1:A1000', filters: Array.from({ length: 4 }, () => ({ column: 'A', op: 'regex', pattern: 'x', flags: '' })) }));
  assert.equal(result.statusCode, 413, result.body); assert.equal(result.json().error.code, 'sheet_query_limit'); assert.ok(!result.body.includes('rows'));
});

test('raw HTTP body byte limit counts whitespace before JSON parsing', async t => {
  const f = await sheetsFixture(t);
  const result = await f.app.inject({ method: 'POST', url: `${f.prefix}/${f.binding.id}/query`, cookies: f.cookies, headers: { ...f.originalHeaders, 'content-type': 'application/json' }, payload: ' '.repeat(64000) + JSON.stringify(body(f)) });
  assert.equal(result.statusCode, 413, result.body); assert.equal(result.json().error.code, 'sheet_query_limit'); assert.equal(f.requests.length, 0);
});

test('unavailable oversized and non-JSON provider responses never become successful empty results', async t => {
  const f = await sheetsFixture(t);
  for (const response of [() => { throw Error('upstream-secret'); }, () => new Response('x'.repeat(2000001)), () => new Response('not json'), () => new Response('private upstream', { status: 429 })]) {
    f.hooks.provider = response; const result = await query(f); assert.ok([429, 502].includes(result.statusCode)); assert.ok(!result.body.includes('upstream')); assert.ok(!result.body.includes('rows'));
  }
  assert.equal(f.requests.length, 4);
});

test('tenant and stale revision reject without OAuth I/O', async t => {
  const f = await sheetsFixture(t); f.setTokens(1);
  assert.equal((await query(f, body(f, { expectedTenantId: randomUUID() }))).json().error.code, 'tenant_mismatch');
  assert.equal((await query(f, body(f, { expectedRevision: 2 }))).json().error.code, 'spreadsheet_configuration_changed'); assert.equal(f.requests.length, 0);
});

test('append-only authorization and effective cached token scopes do not imply query permission', async t => {
  const f = await sheetsFixture(t);
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { capabilities: ['sheets_append'] });
  assert.equal((await query(f)).json().error.code, 'capability_not_authorized');
  f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { capabilities: ['sheets_read'], encryptedTokens: seal({ accessToken: 'synthetic-sheet-token', expiresAt: Date.now() + 86400000, scope: 'openid' }, tokenContext(f.connection)) });
  assert.equal((await query(f)).json().error.code, 'oauth_scope_missing'); assert.equal(f.requests.length, 0);
});

for (const mutation of ['membership_aba', 'reentry', 'binding_noop', 'oauth_reconnect'] as const) for (const phase of ['refresh', 'read'] as const) test(`${mutation} during ${phase} fences original authorization and suppresses cells`, async t => {
  const f = await sheetsFixture(t); if (phase === 'refresh') f.setTokens(1);
  let once = true;
  f.hooks.provider = r => {
    if (once && (phase === 'refresh' ? r.url.hostname === 'oauth2.googleapis.com' : r.url.hostname === 'sheets.googleapis.com')) {
      once = false;
      if (mutation === 'membership_aba') f.aba();
      if (mutation === 'reentry') { f.store.db.prepare('DELETE FROM memberships WHERE user_id=?').run(f.actor.userId); seedMember(f.store, f.actor); }
      if (mutation === 'binding_noop') f.store.update(f.actor.tenantId, 'oauth-sheets-bindings', f.binding.id, { revision: 2, name: f.binding.name });
      if (mutation === 'oauth_reconnect') { let c = f.store.get(f.actor.tenantId, 'oauth-connections', f.connection.id)!; c = updateOAuthAuthorization(f.store, c, { status: 'disconnected' }); updateOAuthAuthorization(f.store, c, { status: 'connected' }); }
    }
    if (r.url.hostname === 'sheets.googleapis.com') return Response.json({ range: "'Client''s Data'!A1:C5", values: [['A', 'B', 'C'], ['private-cell']] });
  };
  const result = await query(f); assert.equal(once, false); assert.ok([401, 409].includes(result.statusCode), result.body); assert.ok(!result.body.includes('private-cell'));
  assert.equal(f.requests.filter(r => r.url.hostname === 'sheets.googleapis.com').length, phase === 'read' ? 1 : 0);
  assert.equal(f.store.list(f.actor.tenantId, 'oauth-sheets-http-operations').length, 0);
});

test('membership role without execute and unauthenticated clients cannot invoke the query', async t => {
  const f = await sheetsFixture(t);
  const anonymous = await f.app.inject({ method: 'POST', url: `${f.prefix}/${f.binding.id}/query`, payload: body(f) }); assert.equal(anonymous.statusCode, 401);
  f.store.db.prepare('UPDATE memberships SET role=? WHERE user_id=?').run('viewer', f.actor.userId);
  const denied = await f.request('POST', `${f.prefix}/${f.binding.id}/query`, body(f), undefined, f.headers()); assert.equal(denied.statusCode, 403); assert.equal(f.requests.length, 0);
});

test('the exact token checked for read scope is the one used for the resource GET', async t => {
  const f = await sheetsFixture(t), get = f.store.get.bind(f.store); let armed = true;
  f.store.get = (tenant, collection, id) => {
    const row = get(tenant, collection, id);
    if (collection !== 'oauth-connections' || !row) return row;
    return { ...row, get encryptedTokens() {
      if (armed) { armed = false; queueMicrotask(() => f.store.update(f.actor.tenantId, 'oauth-connections', f.connection.id, { encryptedTokens: seal({ accessToken: 'unvalidated-replacement', expiresAt: Date.now() + 86400000, scope: 'openid' }, tokenContext(f.connection)) })); }
      return row.encryptedTokens;
    } };
  };
  f.hooks.provider = r => { assert.equal(r.headers.get('authorization'), 'Bearer synthetic-sheet-token'); return Response.json({ range: "'Client''s Data'!A1:C5", values: [['A', 'B', 'C'], ['result']] }); };
  const response = await query(f); f.store.get = get;
  assert.equal(armed, false); assert.equal(response.statusCode, 200, response.body); assert.equal(f.requests.length, 1);
});

test('refresh that reduces effective scopes never sends the Sheets GET', async t => {
  const f = await sheetsFixture(t); f.setTokens(1);
  f.hooks.provider = () => Response.json({ access_token: 'reduced-scope', token_type: 'Bearer', expires_in: 3600, scope: 'openid' });
  const response = await query(f); assert.equal(response.statusCode, 503); assert.equal(response.json().error.code, 'reauthorization_required');
  assert.deepEqual(f.requests.map(r => r.url.hostname), ['oauth2.googleapis.com']);
});

test('maximum rectangle succeeds with complete bounded coverage and no imaginary rows', async t => {
  const f = await sheetsFixture(t); values(f, [], "'Client''s Data'!A1:T1000");
  const result = await query(f, body(f, { headers: false, scanRange: 'A1:T1000', maxRows: 1000 }));
  assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().columns.length, 20); assert.equal(result.json().coverage.examinedRows, 1000); assert.equal(result.json().coverage.matchedRows, 0);
});

test('provider body parsing is followed by a fresh guard and redirects never follow', async t => {
  const f = await sheetsFixture(t), wrapped = globalThis.fetch;
  globalThis.fetch = async (url, init) => { assert.equal(init?.redirect, 'error'); return wrapped(url, init); };
  f.hooks.provider = () => new Response(new ReadableStream({ pull(controller) { f.aba(); controller.enqueue(new TextEncoder().encode(JSON.stringify({ range: "'Client''s Data'!A1:C5", values: [['A', 'B', 'C'], ['late-private']] }))); controller.close(); } }));
  let result = await query(f); assert.equal(result.json().error.code, 'context_changed_in_flight'); assert.ok(!result.body.includes('late-private'));
  f.hooks.provider = () => new Response('redirect-secret', { status: 302, headers: { location: 'https://untrusted.invalid/' } });
  result = await f.request('POST', `${f.prefix}/${f.binding.id}/query`, body(f), undefined, f.headers());
  assert.equal(result.statusCode, 502); assert.ok(!result.body.includes('redirect-secret')); assert.equal(f.requests.length, 2);
});
