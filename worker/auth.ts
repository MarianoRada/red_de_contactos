export interface AuthEnv {
  DB: D1Database;
  ADMIN_BOOTSTRAP_TOKEN?: string;
  ADMIN_PASSWORD_RESET_TOKEN?: string;
}

type AuthUserRow = {
  id: string;
  email: string;
  role: 'admin';
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  password_algorithm: string;
};

type SessionRow = {
  session_hash: string;
  csrf_hash: string;
  expires_at: string;
  user_id: string;
  email: string;
  role: 'admin';
};

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

const SESSION_COOKIE = 'rc_session';
const CSRF_COOKIE = 'rc_csrf';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PASSWORD_HASHING = {
  algorithm: 'PBKDF2-HMAC-SHA256',
  hash: 'SHA-256',
  iterations: 100_000,
  maxIterations: 100_000,
  saltBytes: 16,
  derivedBits: 256,
} as const;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_SALT = new Uint8Array(PASSWORD_HASHING.saltBytes);

type PasswordHashParameters = {
  hash: 'SHA-256';
  iterations: number;
  derivedBits: number;
};

const json = (data: unknown, status = 200, headers?: HeadersInit) => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');

  return Response.json(data, {
    status,
    headers: responseHeaders,
  });
};

function withCookies(response: Response, cookies: string[]) {
  const headers = new Headers(response.headers);
  cookies.forEach((cookie) => headers.append('Set-Cookie', cookie));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isSecureRequest(request: Request) {
  return new URL(request.url).protocol === 'https:';
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge: number;
    httpOnly?: boolean;
    sameSite: 'Lax' | 'Strict';
    secure: boolean;
  }
) {
  return [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${options.maxAge}`,
    `SameSite=${options.sameSite}`,
    options.httpOnly ? 'HttpOnly' : '',
    options.secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function clearCookie(
  name: string,
  httpOnly: boolean,
  secure: boolean
) {
  return serializeCookie(name, '', {
    maxAge: 0,
    httpOnly,
    sameSite: 'Lax',
    secure,
  });
}

function readCookies(request: Request) {
  const cookies = new Map<string, string>();
  const header = request.headers.get('Cookie');

  header?.split(';').forEach((part) => {
    const separator = part.indexOf('=');
    if (separator === -1) {
      return;
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies.set(name, value);
  });

  return cookies;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );

  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function timingSafeStringEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  parameters: PasswordHashParameters
) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: parameters.hash,
      salt,
      iterations: parameters.iterations,
    },
    key,
    parameters.derivedBits
  );

  return bytesToBase64Url(new Uint8Array(derivedBits));
}

async function createPasswordRecord(password: string) {
  const salt = new Uint8Array(PASSWORD_HASHING.saltBytes);
  crypto.getRandomValues(salt);

  return {
    hash: await derivePasswordHash(password, salt, PASSWORD_HASHING),
    salt: bytesToBase64Url(salt),
    iterations: PASSWORD_HASHING.iterations,
    algorithm: PASSWORD_HASHING.algorithm,
  };
}

function passwordHashParameters(user: AuthUserRow | null | undefined) {
  if (!user || user.password_algorithm !== PASSWORD_HASHING.algorithm) {
    return null;
  }

  if (
    !Number.isInteger(user.password_iterations) ||
    user.password_iterations < 1 ||
    user.password_iterations > PASSWORD_HASHING.maxIterations
  ) {
    return null;
  }

  return {
    hash: PASSWORD_HASHING.hash,
    iterations: user.password_iterations,
    derivedBits: PASSWORD_HASHING.derivedBits,
  };
}

async function verifyPassword(
  password: string,
  user: AuthUserRow | null | undefined
) {
  const storedParameters = passwordHashParameters(user);
  const parameters = storedParameters ?? PASSWORD_HASHING;
  let salt = DUMMY_SALT;

  if (user) {
    try {
      salt = base64UrlToBytes(user.password_salt);
    } catch {
      salt = DUMMY_SALT;
    }
  }

  const expected = user?.password_hash ?? '';
  const actual = await derivePasswordHash(password, salt, parameters);

  return Boolean(user) &&
    storedParameters !== null &&
    await timingSafeStringEqual(actual, expected);
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validEmail(email: string) {
  return email.length <= 320 && EMAIL_PATTERN.test(email);
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= MIN_PASSWORD_LENGTH &&
    value.length <= MAX_PASSWORD_LENGTH;
}

function sameOrigin(request: Request) {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get('Origin');

  if (origin) {
    return origin === expectedOrigin;
  }

  const referer = request.headers.get('Referer');
  if (!referer) {
    return false;
  }

  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

async function csrfHeaderMatchesCookie(request: Request) {
  if (!sameOrigin(request)) {
    return false;
  }

  const headerToken = request.headers.get('X-CSRF-Token');
  const cookieToken = readCookies(request).get(CSRF_COOKIE);

  return Boolean(
    headerToken &&
    cookieToken &&
    await timingSafeStringEqual(headerToken, cookieToken)
  );
}

async function getSession(db: D1Database, request: Request) {
  const token = readCookies(request).get(SESSION_COOKIE);
  if (!token) {
    return undefined;
  }

  const sessionHash = await sha256(token);
  const now = new Date().toISOString();

  return db
    .prepare(`
      SELECT
        s.session_hash,
        s.csrf_hash,
        s.expires_at,
        u.id AS user_id,
        u.email,
        u.role
      FROM admin_sessions s
      INNER JOIN admin_users u ON u.id = s.admin_user_id
      WHERE s.session_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > ?
        AND u.is_active = 1
    `)
    .bind(sessionHash, now)
    .first<SessionRow>();
}

async function csrfTokenForSession(
  db: D1Database,
  request: Request,
  session: SessionRow | null | undefined
) {
  const currentToken = readCookies(request).get(CSRF_COOKIE);

  if (session && currentToken) {
    const currentHash = await sha256(currentToken);
    if (await timingSafeStringEqual(currentHash, session.csrf_hash)) {
      return currentToken;
    }
  }

  const nextToken = randomToken();

  if (session) {
    await db
      .prepare(`
        UPDATE admin_sessions
        SET csrf_hash = ?, last_seen_at = CURRENT_TIMESTAMP
        WHERE session_hash = ?
      `)
      .bind(await sha256(nextToken), session.session_hash)
      .run();
  }

  return nextToken;
}

function sessionCookie(request: Request, token: string) {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAge: SESSION_TTL_SECONDS,
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(request),
  });
}

function csrfCookie(request: Request, token: string) {
  return serializeCookie(CSRF_COOKIE, token, {
    maxAge: SESSION_TTL_SECONDS,
    sameSite: 'Strict',
    secure: isSecureRequest(request),
  });
}

function authUser(session: SessionRow) {
  return {
    id: session.user_id,
    email: session.email,
    role: session.role,
  } as const;
}

async function sessionResponse(request: Request, env: AuthEnv) {
  const session = await getSession(env.DB, request);
  const csrfToken = await csrfTokenForSession(env.DB, request, session);
  const cookies = [csrfCookie(request, csrfToken)];

  if (!session && readCookies(request).has(SESSION_COOKIE)) {
    cookies.push(clearCookie(SESSION_COOKIE, true, isSecureRequest(request)));
  }

  const response = session
    ? json({
        authenticated: true,
        user: authUser(session),
        csrfToken,
      })
    : json({
        authenticated: false,
        csrfToken,
      });

  return withCookies(response, cookies);
}

async function loginRateKey(email: string) {
  return sha256(`login:${email}`);
}

async function rateLimitStatus(db: D1Database, rateKey: string) {
  const row = await db
    .prepare(`
      SELECT attempts, window_started_at, blocked_until
      FROM auth_login_attempts
      WHERE rate_key = ?
    `)
    .bind(rateKey)
    .first<{
      attempts: number;
      window_started_at: string;
      blocked_until: string | null;
    }>();

  const now = Date.now();
  const blockedUntil = row?.blocked_until
    ? Date.parse(row.blocked_until)
    : 0;

  if (blockedUntil > now) {
    return {
      blocked: true,
      retryAfter: Math.ceil((blockedUntil - now) / 1000),
    };
  }

  return { blocked: false, retryAfter: 0 };
}

async function recordFailedLogin(db: D1Database, rateKey: string) {
  const now = new Date();
  const nowIso = now.toISOString();
  const row = await db
    .prepare(`
      SELECT attempts, window_started_at
      FROM auth_login_attempts
      WHERE rate_key = ?
    `)
    .bind(rateKey)
    .first<{ attempts: number; window_started_at: string }>();
  const windowIsActive = row &&
    now.getTime() - Date.parse(row.window_started_at) < LOGIN_WINDOW_MS;
  const attempts = windowIsActive ? row.attempts + 1 : 1;
  const blockedUntil = attempts >= MAX_LOGIN_ATTEMPTS
    ? new Date(now.getTime() + LOGIN_BLOCK_MS).toISOString()
    : null;
  const windowStartedAt = windowIsActive
    ? row.window_started_at
    : nowIso;

  await db
    .prepare(`
      INSERT INTO auth_login_attempts (
        rate_key,
        attempts,
        window_started_at,
        blocked_until,
        updated_at
      )
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(rate_key) DO UPDATE SET
        attempts = excluded.attempts,
        window_started_at = excluded.window_started_at,
        blocked_until = excluded.blocked_until,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(rateKey, attempts, windowStartedAt, blockedUntil)
    .run();
}

async function clearFailedLogins(db: D1Database, rateKey: string) {
  await db
    .prepare('DELETE FROM auth_login_attempts WHERE rate_key = ?')
    .bind(rateKey)
    .run();
}

function invalidCredentialsResponse() {
  return json(
    {
      error: 'invalid_credentials',
      message: 'El email o la contraseña no son correctos.',
    },
    401
  );
}

async function handleLogin(request: Request, env: AuthEnv) {
  if (!(await csrfHeaderMatchesCookie(request))) {
    return json(
      {
        error: 'csrf_failed',
        message: 'No se pudo validar la solicitud de inicio de sesión.',
      },
      403
    );
  }

  let body: LoginBody;
  try {
    body = await request.json<LoginBody>();
  } catch {
    return json({ error: 'invalid_json', message: 'JSON inválido.' }, 400);
  }

  const email = normalizeEmail(body.email);
  const password = body.password;

  if (!validEmail(email) || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) {
    return invalidCredentialsResponse();
  }

  const rateKey = await loginRateKey(email);
  const rate = await rateLimitStatus(env.DB, rateKey);
  if (rate.blocked) {
    return json(
      {
        error: 'login_rate_limited',
        message: 'Demasiados intentos. Esperá unos minutos antes de volver a intentar.',
      },
      429,
      { 'Retry-After': String(rate.retryAfter) }
    );
  }

  const user = await env.DB
    .prepare(`
      SELECT
        id,
        email,
        role,
        password_hash,
        password_salt,
        password_iterations,
        password_algorithm
      FROM admin_users
      WHERE email = ?
        AND is_active = 1
    `)
    .bind(email)
    .first<AuthUserRow>();
  const passwordMatches = await verifyPassword(password, user);

  if (!passwordMatches) {
    await recordFailedLogin(env.DB, rateKey);
    return invalidCredentialsResponse();
  }

  await clearFailedLogins(env.DB, rateKey);

  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_SECONDS * 1000
  ).toISOString();

  await env.DB
    .prepare('DELETE FROM admin_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL')
    .bind(new Date().toISOString())
    .run();
  await env.DB
    .prepare(`
      INSERT INTO admin_sessions (
        session_hash,
        admin_user_id,
        csrf_hash,
        expires_at
      )
      VALUES (?, ?, ?, ?)
    `)
    .bind(
      await sha256(sessionToken),
      user!.id,
      await sha256(csrfToken),
      expiresAt
    )
    .run();

  return withCookies(
    json({
      authenticated: true,
      user: {
        id: user!.id,
        email: user!.email,
        role: user!.role,
      },
      csrfToken,
    }),
    [
      sessionCookie(request, sessionToken),
      csrfCookie(request, csrfToken),
    ]
  );
}

async function handleLogout(request: Request, env: AuthEnv) {
  const session = await getSession(env.DB, request);
  if (!session) {
    return json(
      { error: 'authentication_required', message: 'La sesión no es válida.' },
      401
    );
  }

  if (session.role !== 'admin') {
    return json(
      {
        error: 'forbidden',
        message: 'La cuenta no tiene permisos de administrador.',
      },
      403
    );
  }

  if (!(await csrfHeaderMatchesCookie(request))) {
    return json(
      { error: 'csrf_failed', message: 'No se pudo validar la solicitud.' },
      403
    );
  }

  const csrfHash = await sha256(
    request.headers.get('X-CSRF-Token') ?? ''
  );
  if (!(await timingSafeStringEqual(csrfHash, session.csrf_hash))) {
    return json(
      { error: 'csrf_failed', message: 'No se pudo validar la solicitud.' },
      403
    );
  }

  await env.DB
    .prepare('UPDATE admin_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE session_hash = ?')
    .bind(session.session_hash)
    .run();

  return withCookies(
    json({ success: true }),
    [
      clearCookie(SESSION_COOKIE, true, isSecureRequest(request)),
      clearCookie(CSRF_COOKIE, false, isSecureRequest(request)),
    ]
  );
}

async function bootstrapAdmin(request: Request, env: AuthEnv) {
  if (!env.ADMIN_BOOTSTRAP_TOKEN) {
    return json({ error: 'not_found', message: 'Not found' }, 404);
  }

  const suppliedToken = request.headers.get('X-Admin-Bootstrap-Token') ?? '';
  const expectedHash = await sha256(env.ADMIN_BOOTSTRAP_TOKEN);
  const suppliedHash = await sha256(suppliedToken);

  if (!(await timingSafeStringEqual(suppliedHash, expectedHash))) {
    return json(
      { error: 'bootstrap_forbidden', message: 'Operación no autorizada.' },
      403
    );
  }

  let body: LoginBody;
  try {
    body = await request.json<LoginBody>();
  } catch {
    return json({ error: 'invalid_json', message: 'JSON inválido.' }, 400);
  }

  const email = normalizeEmail(body.email);
  if (!validEmail(email) || !validPassword(body.password)) {
    return json(
      {
        error: 'invalid_admin_data',
        message: `El email debe ser válido y la contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      },
      422
    );
  }

  const passwordRecord = await createPasswordRecord(body.password);
  const lockValue = `${new Date().toISOString()}-${randomToken()}`;
  const results = await env.DB.batch([
    env.DB
      .prepare(`
        UPDATE auth_bootstrap
        SET used_at = ?
        WHERE id = 1 AND used_at IS NULL
      `)
      .bind(lockValue),
    env.DB
      .prepare(`
        INSERT INTO admin_users (
          id,
          email,
          password_hash,
          password_salt,
          password_iterations,
          password_algorithm,
          role
        )
        SELECT ?, ?, ?, ?, ?, ?, 'admin'
        WHERE (SELECT used_at FROM auth_bootstrap WHERE id = 1) = ?
          AND NOT EXISTS (
            SELECT 1 FROM admin_users WHERE is_active = 1
          )
      `)
      .bind(
        crypto.randomUUID(),
        email,
        passwordRecord.hash,
        passwordRecord.salt,
        passwordRecord.iterations,
        passwordRecord.algorithm,
        lockValue
      ),
  ]);

  const inserted = Number(results[1]?.meta?.changes ?? 0);
  if (inserted !== 1) {
    return json(
      {
        error: 'bootstrap_unavailable',
        message: 'El administrador inicial ya fue creado.',
      },
      409
    );
  }

  return json(
    {
      success: true,
      message: 'Administrador inicial creado. Ya podés iniciar sesión.',
    },
    201
  );
}

async function resetAdminPassword(request: Request, env: AuthEnv) {
  if (!env.ADMIN_PASSWORD_RESET_TOKEN) {
    return json({ error: 'not_found', message: 'Not found' }, 404);
  }

  const suppliedToken = request.headers.get('X-Admin-Password-Reset-Token') ?? '';
  const expectedHash = await sha256(env.ADMIN_PASSWORD_RESET_TOKEN);
  const suppliedHash = await sha256(suppliedToken);

  if (!(await timingSafeStringEqual(suppliedHash, expectedHash))) {
    return json(
      { error: 'reset_forbidden', message: 'Operación no autorizada.' },
      403
    );
  }

  let body: LoginBody;
  try {
    body = await request.json<LoginBody>();
  } catch {
    return json({ error: 'invalid_json', message: 'JSON inválido.' }, 400);
  }

  const email = normalizeEmail(body.email);
  if (!validEmail(email) || !validPassword(body.password)) {
    return json(
      {
        error: 'invalid_admin_data',
        message: `El email debe ser válido y la contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      },
      422
    );
  }

  const user = await env.DB
    .prepare('SELECT id FROM admin_users WHERE email = ? AND is_active = 1')
    .bind(email)
    .first<{ id: string }>();

  if (!user) {
    return json(
      { error: 'admin_not_found', message: 'No existe un administrador activo con ese email.' },
      404
    );
  }

  const passwordRecord = await createPasswordRecord(body.password);
  await env.DB.batch([
    env.DB
      .prepare(`
        UPDATE admin_users
        SET
          password_hash = ?,
          password_salt = ?,
          password_iterations = ?,
          password_algorithm = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .bind(
        passwordRecord.hash,
        passwordRecord.salt,
        passwordRecord.iterations,
        passwordRecord.algorithm,
        user.id
      ),
    env.DB
      .prepare(`
        UPDATE admin_sessions
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE admin_user_id = ? AND revoked_at IS NULL
      `)
      .bind(user.id),
  ]);

  return json({
    success: true,
    message: 'Contraseña actualizada. Las sesiones anteriores fueron revocadas.',
  });
}

export async function handleAuthRequest(
  request: Request,
  env: AuthEnv
): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname;

  if (request.method === 'GET' && pathname === '/api/auth/session') {
    return sessionResponse(request, env);
  }

  if (request.method === 'POST' && pathname === '/api/auth/login') {
    return handleLogin(request, env);
  }

  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    return handleLogout(request, env);
  }

  if (request.method === 'POST' && pathname === '/api/auth/bootstrap') {
    return bootstrapAdmin(request, env);
  }

  if (request.method === 'POST' && pathname === '/api/auth/reset-password') {
    return resetAdminPassword(request, env);
  }

  return undefined;
}

export async function requireAdminRequest(
  request: Request,
  env: AuthEnv
): Promise<Response | undefined> {
  const session = await getSession(env.DB, request);
  if (!session) {
    return json(
      {
        error: 'authentication_required',
        message: 'Necesitás iniciar sesión como administrador.',
      },
      401
    );
  }

  if (session.role !== 'admin') {
    return json(
      {
        error: 'forbidden',
        message: 'La cuenta no tiene permisos de administrador.',
      },
      403
    );
  }

  if (!(await csrfHeaderMatchesCookie(request))) {
    return json(
      {
        error: 'csrf_failed',
        message: 'No se pudo validar la solicitud.',
      },
      403
    );
  }

  const csrfHash = await sha256(
    request.headers.get('X-CSRF-Token') ?? ''
  );
  if (!(await timingSafeStringEqual(csrfHash, session.csrf_hash))) {
    return json(
      {
        error: 'csrf_failed',
        message: 'No se pudo validar la solicitud.',
      },
      403
    );
  }

  return undefined;
}
