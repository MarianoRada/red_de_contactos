import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const wranglerScript = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const node = process.execPath;
const port = 8790 + Math.floor(Math.random() * 100);
const persistDirectory = await mkdtemp(join(tmpdir(), 'red-contactos-auth-'));
const token = randomBytes(32).toString('base64url');
const email = `admin-${randomBytes(8).toString('hex')}@example.test`;
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
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`wrangler ${args.join(' ')} exited with ${code}\n${output}`));
      }
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
    '--var', `ADMIN_BOOTSTRAP_TOKEN:${token}`,
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
      await fetch(`http://127.0.0.1:${port}/api/auth/session`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error('The local Worker did not start in time.');
}

function cookieValue(setCookie, name) {
  const match = setCookie.match(new RegExp(`(?:^|, )${name}=([^;]+)`));
  if (!match) {
    throw new Error(`Cookie ${name} was not returned.`);
  }

  return match[1];
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function stopWorker(child) {
  if (child.exitCode !== null) {
    return;
  }

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
      if (attempt === 9) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

await run([
  'd1', 'migrations', 'apply', 'DB',
  '--local',
  '--persist-to', persistDirectory,
]);

const worker = startWorker();

try {
  await waitForWorker();

  const bootstrapResponse = await fetch(`http://127.0.0.1:${port}/api/auth/bootstrap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Bootstrap-Token': token,
    },
    body: JSON.stringify({ email, password }),
  });
  assert(bootstrapResponse.status === 201, `Bootstrap failed with ${bootstrapResponse.status}.`);

  const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`);
  assert(sessionResponse.status === 200, 'Initial session request failed.');
  const sessionBody = await sessionResponse.json();
  const csrfToken = sessionBody.csrfToken;
  const csrfCookie = cookieValue(sessionResponse.headers.get('set-cookie') ?? '', 'rc_csrf');

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: `http://127.0.0.1:${port}`,
      Cookie: `rc_csrf=${csrfCookie}`,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await loginResponse.json();
  assert(loginResponse.status === 200, `Login failed with ${loginResponse.status}.`);
  assert(loginBody.authenticated === true, 'Login did not authenticate the administrator.');

  console.log('Auth integration passed: bootstrap and login completed in wrangler dev.');
} catch (error) {
  const details = error instanceof Error ? error.message : String(error);
  throw new Error(`${details}\nWorker output:\n${worker.getOutput()}`);
} finally {
  await stopWorker(worker.child);
  await removePersistDirectory();
}
