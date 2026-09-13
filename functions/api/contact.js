/**
 * Contact form handler — Cloudflare Pages Function at POST /api/contact
 *
 * Accepts JSON (from script.js) or a regular form post (no JavaScript).
 * Validates input, filters obvious spam, and sends the message by email
 * through the Resend API (https://resend.com).
 *
 * Environment variables (set in the Cloudflare dashboard → Pages project →
 * Settings → Variables and Secrets):
 *   RESEND_API_KEY   (secret)  Resend API key
 *   CONTACT_TO       (text)    Where messages go, e.g. dwayne@abvtech.net
 *   CONTACT_FROM     (text)    Sender on a domain verified in Resend,
 *                              e.g. "A Blind View Tech <hello@ablindviewtech.com>"
 * Optional binding:
 *   RATE_LIMIT       (KV namespace) enables per-IP rate limiting. A Cloudflare
 *                    WAF rate-limiting rule on POST /api/contact is the
 *                    stronger option and needs no code.
 *
 * Note: with wrangler.toml present, plain variables and bindings must be
 * declared there ([vars], [[kv_namespaces]]); only secrets are set in the
 * dashboard.
 */

const MAX = { name: 100, email: 254, org: 150, message: 4000 };
const MIN_FILL_MS = 3000;          // forms submitted faster than this are bots
const RATE_WINDOW_S = 60 * 60;     // 1 hour
const RATE_MAX = 5;                // submissions per IP per window

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Strip control characters and CR/LF so nothing can inject extra mail headers.
function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0085\u2028\u2029]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

function oneLine(value, max) {
  return clean(value, max).replace(/\n/g, ' ');
}

function isEmail(value) {
  return value.length <= MAX.email && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[A-Za-z0-9-]{2,}$/.test(value);
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // non-CORS form posts from old browsers omit it
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

const MAX_BODY_BYTES = 32 * 1024;

// Read the body while counting bytes so a chunked request can't bypass the limit.
async function readLimited(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > limit) throw new RangeError('too large');
    chunks.push(value);
  }
  return new Blob(chunks).text();
}

async function readBody(request) {
  const type = request.headers.get('Content-Type') || '';
  const text = await readLimited(request, MAX_BODY_BYTES);
  if (type.includes('application/json')) {
    try {
      const data = JSON.parse(text);
      return { data: data && typeof data === 'object' && !Array.isArray(data) ? data : {}, wantsJson: true };
    } catch {
      return { data: {}, wantsJson: true, bad: true };
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    const data = Object.fromEntries(new URLSearchParams(text).entries());
    const wantsJson = (request.headers.get('Accept') || '').includes('application/json');
    return { data, wantsJson };
  }
  return { data: {}, wantsJson: true, unsupported: true };
}

// Bucket IPv6 to the /64 so one household can't mint unlimited identities.
function ipBucket(ip) {
  if (!ip) return '';
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}

async function rateLimited(env, ip) {
  if (!env.RATE_LIMIT || !ip) return false;
  try {
    const key = `contact:${ipBucket(ip)}`;
    const count = Number(await env.RATE_LIMIT.get(key)) || 0;
    if (count >= RATE_MAX) return true;
    await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: RATE_WINDOW_S });
  } catch (err) {
    console.error('contact: rate limit store unavailable', err && err.message);
  }
  return false;
}

function respond(wantsJson, request, status, body) {
  if (wantsJson) return json(status, body);
  // Plain form post: send the visitor to a static page that explains the result.
  const url = new URL(request.url);
  url.pathname = body.ok ? '/thanks.html' : '/sorry.html';
  url.search = '';
  url.hash = '';
  if (!body.ok) url.searchParams.set('r', status === 429 ? 'busy' : status >= 500 ? 'down' : 'input');
  return Response.redirect(url.toString(), 303);
}

export async function onRequestPost({ request, env }) {
  let wantsJson = true;
  try {
    if (!sameOrigin(request)) return json(403, { ok: false, error: 'Request blocked.' });

    let body;
    try {
      body = await readBody(request);
    } catch (err) {
      if (err instanceof RangeError) return json(413, { ok: false, error: 'Message is too long.' });
      throw err;
    }
    wantsJson = body.wantsJson;
    if (body.unsupported) return json(415, { ok: false, error: 'Unsupported request.' });
    if (body.bad) return json(400, { ok: false, error: 'Malformed request.' });
    const d = body.data;

    // Spam checks: honeypot filled, or submitted impossibly fast. Both answer
    // "ok" so bots learn nothing. Clock skew is tolerated: only a plausible,
    // non-negative elapsed time under the minimum counts.
    if (clean(d.contact_extra, 50)) return respond(wantsJson, request, 200, { ok: true });
    const startedAt = Number(d.started);
    if (Number.isFinite(startedAt) && startedAt > 0) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= 0 && elapsed < MIN_FILL_MS) return respond(wantsJson, request, 200, { ok: true });
    }

    const name = oneLine(d.name, MAX.name);
    const email = oneLine(d.email, MAX.email);
    const org = oneLine(d.org, MAX.org);
    const message = clean(d.message, MAX.message);

    if (!name || !email || !message) {
      return respond(wantsJson, request, 400, { ok: false, error: 'Please fill in your name, email address, and message.' });
    }
    if (!isEmail(email)) {
      return respond(wantsJson, request, 400, { ok: false, error: 'That email address doesn’t look right.' });
    }

    const ip = request.headers.get('CF-Connecting-IP') || '';
    if (await rateLimited(env, ip)) {
      return respond(wantsJson, request, 429, { ok: false, error: 'Too many messages from this connection. Please try again in an hour or email me directly.' });
    }

    if (!env.RESEND_API_KEY || !env.CONTACT_TO || !env.CONTACT_FROM) {
      console.error('contact: RESEND_API_KEY, CONTACT_TO or CONTACT_FROM is not configured');
      return respond(wantsJson, request, 503, { ok: false, error: 'The contact form isn’t set up yet.' });
    }

    const text = [
      `Name: ${name}`,
      `Email: ${email}`,
      org ? `Organization: ${org}` : null,
      '',
      message,
      '',
      '—',
      `Sent from the ablindviewtech.com contact form`,
      `Country: ${request.cf?.country || 'unknown'}`,
    ].filter((line) => line !== null).join('\n');

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM,
        to: [env.CONTACT_TO],
        reply_to: email,
        subject: `Website inquiry from ${name}${org ? ` (${org})` : ''}`,
        text,
      }),
    });

    if (!res.ok) {
      console.error('contact: mail provider returned', res.status);
      return respond(wantsJson, request, 502, { ok: false, error: 'The message could not be sent right now.' });
    }

    return respond(wantsJson, request, 200, { ok: true });
  } catch (err) {
    console.error('contact: unexpected error', err && err.message);
    return respond(wantsJson, request, 500, { ok: false, error: 'Something went wrong on my end.' });
  }
}

export async function onRequest({ request }) {
  // Only POST is meaningful here; everything else gets a clear answer.
  return new Response(JSON.stringify({ ok: false, error: 'Use POST.' }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: 'POST' },
  });
}
