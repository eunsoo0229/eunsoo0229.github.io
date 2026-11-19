// Access tokens for the self-AI server. One token per person (or device); only its
// SHA-256 is stored (SELF_AI_SERVER_TOKENS_FILE, default ~/.martialdex-ai/server-tokens.json,
// outside the repository). The token itself is shown once when issued.
//   node server/self-ai/auth.cjs add <userId> [label]   issue a token
//   node server/self-ai/auth.cjs list                    users (no tokens)
//   node server/self-ai/auth.cjs revoke <userId>

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USER_ID = /^[\w.-]{1,64}$/;

function tokensFile(env = process.env) {
  return env.SELF_AI_SERVER_TOKENS_FILE || path.join(os.homedir(), '.martialdex-ai', 'server-tokens.json');
}

function load(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j.users) ? j : { users: [] };
  } catch {
    return { users: [] };
  }
}

function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 1), { mode: 0o600 });
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function issue(file, userId, label = '') {
  if (!USER_ID.test(userId)) throw new Error('userId: letters, digits, . _ - (1–64)');
  const data = load(file);
  const token = `mdx_${crypto.randomBytes(24).toString('base64url')}`;
  data.users = data.users.filter((u) => u.id !== userId);
  data.users.push({ id: userId, label, tokenSha256: sha(token), createdAt: new Date().toISOString() });
  save(file, data);
  return token;
}

/** Bearer token → user id, or null. Constant-time comparison of the hashes. */
function verifier(file) {
  let cache = null;
  let mtime = 0;
  return (authorization) => {
    const m = /^Bearer\s+(\S{10,200})$/.exec(String(authorization || ''));
    if (!m) return null;
    try {
      const t = fs.statSync(file).mtimeMs;
      if (!cache || t !== mtime) {
        cache = load(file);
        mtime = t;
      }
    } catch {
      return null;
    }
    const got = Buffer.from(sha(m[1]), 'hex');
    for (const u of cache.users) {
      const want = Buffer.from(u.tokenSha256, 'hex');
      if (want.length === got.length && crypto.timingSafeEqual(want, got)) return u.id;
    }
    return null;
  };
}

module.exports = { tokensFile, issue, verifier, load };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  const file = tokensFile();
  if (cmd === 'add') {
    const token = issue(file, a, b || '');
    console.log(`user ${a}: ${token}\n(shown once — only its hash is stored in ${file})`);
  } else if (cmd === 'list') {
    for (const u of load(file).users) console.log(`${u.id}\t${u.label}\t${u.createdAt}`);
  } else if (cmd === 'revoke') {
    const data = load(file);
    data.users = data.users.filter((u) => u.id !== a);
    save(file, data);
    console.log(`revoked ${a}`);
  } else {
    console.log('usage: add <userId> [label] | list | revoke <userId>');
  }
}
