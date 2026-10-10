import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const wranglerScript = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const node = process.execPath;
const port = 8890 + Math.floor(Math.random() * 100);
const baseUrl = `http://127.0.0.1:${port}`;
const persistDirectory = await mkdtemp(join(tmpdir(), 'red-contactos-import-'));
const bootstrapToken = randomBytes(32).toString('base64url');
const email = `import-${randomBytes(8).toString('hex')}@example.test`;
const password = randomBytes(24).toString('base64url');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(node, [wranglerScript, ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`wrangler ${args.join(' ')} exited with ${code}\n${output}`));
    });
  });
}

function startWorker() {
  const child = spawn(node, [
    wranglerScript,
    'dev',
    '--local',
    '--persist-to', persistDirectory,
    '--port', String(port),
    '--var', `ADMIN_BOOTSTRAP_TOKEN:${bootstrapToken}`,
    '--var', 'IMPORT_ENABLED:true',
    '--show-interactive-dev-session=false',
    '--log-level', 'error',
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  return { child, getOutput: () => output };
}

async function waitForWorker() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`${baseUrl}/api/auth/session`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('The local Worker did not start in time.');
}

function cookieValue(setCookie, name) {
  const match = setCookie.match(new RegExp(`(?:^|, )${name}=([^;]+)`));
  if (!match) throw new Error(`Cookie ${name} was not returned.`);
  return match[1];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function jsonResponse(response) {
  const body = await response.json();
  return { status: response.status, body };
}

async function login() {
  const session = await fetch(`${baseUrl}/api/auth/session`);
  const csrfToken = (await session.json()).csrfToken;
  const csrfCookie = cookieValue(session.headers.get('set-cookie') ?? '', 'rc_csrf');
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: `rc_csrf=${csrfCookie}`,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ email, password }),
  });
  assert(response.status === 200, `Login failed with ${response.status}.`);
  const setCookie = response.headers.get('set-cookie') ?? '';
  const sessionCookie = cookieValue(setCookie, 'rc_session');
  const returnedCsrfCookie = cookieValue(setCookie, 'rc_csrf');
  const body = await response.json();
  return {
    cookie: `rc_session=${sessionCookie}; rc_csrf=${returnedCsrfCookie}`,
    csrfToken: body.csrfToken,
  };
}

async function importPayload(auth, payload) {
  const response = await fetch(`${baseUrl}/api/admin/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: auth.cookie,
      'X-CSRF-Token': auth.csrfToken,
    },
    body: JSON.stringify(payload),
  });
  return jsonResponse(response);
}

async function createRecord(auth, record) {
  const response = await fetch(`${baseUrl}/api/records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: auth.cookie,
      'X-CSRF-Token': auth.csrfToken,
    },
    body: JSON.stringify(record),
  });
  return jsonResponse(response);
}

async function updateRecord(auth, id, record) {
  const response = await fetch(`${baseUrl}/api/records/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      Cookie: auth.cookie,
      'X-CSRF-Token': auth.csrfToken,
    },
    body: JSON.stringify(record),
  });
  return jsonResponse(response);
}

async function loadRecords() {
  const response = await fetch(`${baseUrl}/api/records`);
  assert(response.status === 200, `Loading records failed with ${response.status}.`);
  return response.json();
}

async function stopWorker(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once('close', resolve);
    child.kill();
  });
}

async function removePersistDirectory() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(persistDirectory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

await run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persistDirectory]);
const worker = startWorker();

try {
  await waitForWorker();

  const unauthorized = await fetch(`${baseUrl}/api/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ importId: 'unauthorized', records: [], relationships: [] }),
  });
  assert(unauthorized.status === 401, `Expected unauthorized import to return 401, got ${unauthorized.status}.`);

  const bootstrap = await fetch(`${baseUrl}/api/auth/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Bootstrap-Token': bootstrapToken },
    body: JSON.stringify({ email, password }),
  });
  assert(bootstrap.status === 201, `Bootstrap failed with ${bootstrap.status}.`);
  const auth = await login();

  const firstImport = await importPayload(auth, {
    importId: 'friendly-contacts',
    records: [
      { name: 'Ana Pérez', type: 'person', description: '', email: '', location: '' },
      { name: 'Empresa ABC', type: 'company', description: 'Empresa tecnológica', email: '', location: 'Buenos Aires' },
    ],
    relationships: [
      { source: 'Ana Pérez', target: 'Empresa ABC', type: 'trabaja en' },
    ],
  });
  assert(firstImport.status === 201, `Friendly import failed with ${firstImport.status}.`);
  assert(firstImport.body.inserted.records === 2 && firstImport.body.inserted.relationships === 1, 'Friendly import counts are incorrect.');

  let records = await loadRecords();
  const ana = records.find((record) => record.name === 'Ana Pérez');
  const company = records.find((record) => record.name === 'Empresa ABC');
  assert(ana && company, 'Friendly contacts were not stored.');
  assert(/^[0-9a-f-]{36}$/i.test(ana.id) && /^[0-9a-f-]{36}$/i.test(company.id), 'Contact UUIDs were not generated automatically.');

  const newExistingImport = await importPayload(auth, {
    importId: 'new-to-existing',
    records: [{ name: 'Carlos', type: 'person', description: '', email: '', location: '' }],
    relationships: [{ source: 'Carlos', target: 'Ana Pérez', type: 'colabora con' }],
  });
  assert(newExistingImport.status === 201, `New-to-existing import failed with ${newExistingImport.status}.`);

  const existingOnlyImport = await importPayload(auth, {
    importId: 'existing-to-existing',
    records: [],
    relationships: [{ source: 'Ana Pérez', target: 'Empresa ABC', type: 'participa en' }],
  });
  assert(existingOnlyImport.status === 201, `Existing-only relation import failed with ${existingOnlyImport.status}.`);

  const existingNameConflict = await importPayload(auth, {
    importId: 'existing-name-conflict',
    records: [{ name: ' empresa abc ', type: 'institution' }],
    relationships: [],
  });
  assert(existingNameConflict.status === 409, `Expected existing name conflict to return 409, got ${existingNameConflict.status}.`);
  assert(existingNameConflict.body.issues.some((issue) => issue.code === 'record_name_conflict'), 'Existing name conflict issue was not returned.');
  records = await loadRecords();
  assert(records.filter((record) => record.name === 'Empresa ABC').length === 1, 'Existing name conflict wrote a duplicate contact.');

  const manualRecordId = `manual-${randomBytes(8).toString('hex')}`;
  const manualCreate = await createRecord(auth, {
    id: manualRecordId,
    name: 'Manual Unico',
    description: '',
    email: '',
    location: '',
    type: 'person',
  });
  assert(manualCreate.status === 201, `Manual record creation failed with ${manualCreate.status}.`);

  const manualDuplicate = await createRecord(auth, {
    id: `manual-duplicate-${randomBytes(8).toString('hex')}`,
    name: ' manual unico ',
    description: '',
    email: '',
    location: '',
    type: 'company',
  });
  assert(manualDuplicate.status === 409, `Expected manual duplicate creation to return 409, got ${manualDuplicate.status}.`);

  const manualEdit = await createRecord(auth, {
    id: `manual-edit-${randomBytes(8).toString('hex')}`,
    name: 'Manual Edit',
    description: '',
    email: '',
    location: '',
    type: 'person',
  });
  assert(manualEdit.status === 201, `Manual edit fixture creation failed with ${manualEdit.status}.`);
  const manualEditConflict = await updateRecord(auth, manualEdit.body.id, {
    ...manualEdit.body,
    name: ' empresa abc ',
  });
  assert(manualEditConflict.status === 409, `Expected manual duplicate edit to return 409, got ${manualEditConflict.status}.`);

  const newDuplicateImport = await importPayload(auth, {
    importId: 'new-duplicate-names',
    records: [
      { name: 'Nuevo Duplicado', type: 'person' },
      { name: 'Nuevo Duplicado', type: 'person' },
    ],
    relationships: [{ source: 'Nuevo Duplicado', target: 'Ana Pérez', type: 'coordina' }],
  });
  assert(newDuplicateImport.status === 422, `Expected duplicate new name to return 422, got ${newDuplicateImport.status}.`);
  assert(newDuplicateImport.body.issues.some((issue) => issue.code === 'duplicate_record_name'), 'Duplicate new name issue was not returned.');
  records = await loadRecords();
  assert(!records.some((record) => record.name === 'Nuevo Duplicado'), 'Duplicate-name import wrote partial contacts.');

  const missingReference = await importPayload(auth, {
    importId: 'missing-reference',
    records: [],
    relationships: [{ source: 'No Existe', target: 'Ana Pérez', type: 'financia' }],
  });
  assert(missingReference.status === 422, `Expected missing reference to return 422, got ${missingReference.status}.`);

  const selfRelation = await importPayload(auth, {
    importId: 'self-relation',
    records: [],
    relationships: [{ source: 'Ana Pérez', target: 'Ana Pérez', type: 'coordina' }],
  });
  assert(selfRelation.status === 422, `Expected self relation to return 422, got ${selfRelation.status}.`);

  const duplicateRelation = await importPayload(auth, {
    importId: 'duplicate-relations',
    records: [],
    relationships: [
      { source: 'Ana Pérez', target: 'Empresa ABC', type: 'financia' },
      { source: 'Ana Pérez', target: 'Empresa ABC', type: 'financia' },
    ],
  });
  assert(duplicateRelation.status === 422, `Expected duplicate relation to return 422, got ${duplicateRelation.status}.`);

  const existingRelation = await importPayload(auth, {
    importId: 'existing-relation-conflict',
    records: [],
    relationships: [{ source: 'Ana Pérez', target: 'Empresa ABC', type: 'trabaja en' }],
  });
  assert(existingRelation.status === 409, `Expected existing relation conflict to return 409, got ${existingRelation.status}.`);

  const atomicImport = await importPayload(auth, {
    importId: 'atomic-invalid',
    records: [{ name: 'No Debe Persistir', type: 'person' }],
    relationships: [{ source: 'No Debe Persistir', target: 'No Existe', type: 'trabaja en' }],
  });
  assert(atomicImport.status === 422, `Expected atomic invalid import to return 422, got ${atomicImport.status}.`);
  records = await loadRecords();
  assert(!records.some((record) => record.name === 'No Debe Persistir'), 'Invalid import wrote a partial contact.');

  const idempotentPayload = {
    importId: 'idempotent-import',
    records: [{ name: 'Idempotente', type: 'institution' }],
    relationships: [],
  };
  const idempotentFirst = await importPayload(auth, idempotentPayload);
  const idempotentSecond = await importPayload(auth, idempotentPayload);
  assert(idempotentFirst.status === 201, `First idempotent import failed with ${idempotentFirst.status}.`);
  assert(idempotentSecond.status === 200 && idempotentSecond.body.idempotent === true, 'Repeated import was not idempotent.');
  records = await loadRecords();
  assert(records.filter((record) => record.name === 'Idempotente').length === 1, 'Idempotent import duplicated data.');

  const invalidFields = await importPayload(auth, {
    importId: 'invalid-fields',
    records: [{ name: '', type: '' }],
    relationships: [],
  });
  assert(invalidFields.status === 422, `Expected invalid fields to return 422, got ${invalidFields.status}.`);

  records = await loadRecords();
  const remainingCapacity = 1000 - records.length;
  const capacityRecords = Array.from({ length: remainingCapacity }, (_, index) => ({
    name: `Capacidad ${index}`,
    type: 'person',
  }));
  const capacityImport = await importPayload(auth, {
    importId: 'fill-capacity',
    records: capacityRecords,
    relationships: [],
  });
  assert(capacityImport.status === 201, `Filling the 1000-node capacity failed with ${capacityImport.status}.`);

  const overCapacity = await importPayload(auth, {
    importId: 'over-capacity',
    records: [{ name: 'Fuera de Capacidad', type: 'person' }],
    relationships: [],
  });
  assert(overCapacity.status === 409, `Expected over-capacity import to return 409, got ${overCapacity.status}.`);
  assert(overCapacity.body.error === 'node_limit_exceeded', 'Over-capacity error code is incorrect.');

  console.log('Import integration passed: friendly CSV, resolutions, duplicates, atomicity, idempotency, authorization, and 1000-node limit.');
} catch (error) {
  const details = error instanceof Error ? error.message : String(error);
  throw new Error(`${details}\nWorker output:\n${worker.getOutput()}`);
} finally {
  await stopWorker(worker.child);
  await removePersistDirectory();
}
