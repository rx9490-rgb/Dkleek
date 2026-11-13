'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const port = Number(process.env.PORT || 3000);
const sourcePath = path.join(__dirname, 'frontend.txt');
const configPattern = /window\.NASEEB_CONFIG = window\.NASEEB_CONFIG \|\| \{\s*supabaseUrl: '',\s*supabaseAnonKey: ''\s*\};/;
const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
function send(res, status, type, body) { res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY' }); res.end(body); }
function json(res, status, data) { send(res, status, 'application/json; charset=utf-8', JSON.stringify(data)); }
async function bodyJson(req) { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 65536) throw new Error('الطلب أكبر من المسموح.'); } return raw ? JSON.parse(raw) : {}; }
function requireConfig() { if (!base || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('إعداد Supabase غير مكتمل في الخادم.'); }
async function db(pathname, method='GET', body=null) {
  requireConfig();
  const response = await fetch(base + '/rest/v1/' + pathname, { method, headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text(); let payload; try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
  if (!response.ok) { const error = new Error(payload && (payload.message || payload.hint) || 'تعذر الوصول إلى قاعدة البيانات.'); error.status = response.status; throw error; }
  return payload;
}
async function userFromRequest(req) {
  requireConfig();
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const response = await fetch(base + '/auth/v1/user', { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
  if (!response.ok) return null;
  return response.json();
}
async function requireAdmin(req) {
  const user = await userFromRequest(req); if (!user) return null;
  const rows = await db('subscription_admins?user_id=eq.' + encodeURIComponent(user.id) + '&select=user_id&limit=1');
  return rows && rows.length ? user : null;
}
async function requireUser(req) { const user = await userFromRequest(req); if (!user) { const error = new Error('سجّل الدخول أولاً.'); error.status = 401; throw error; } return user; }
function validHttpsUrl(value) { if (!value) return ''; let parsed; try { parsed = new URL(value); } catch { throw new Error('أدخل رابطًا صحيحًا.'); } if (parsed.protocol !== 'https:') throw new Error('يجب أن يبدأ رابط سلة بـ https.'); return parsed.toString(); }
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, supabaseConfigured: Boolean(base && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) });
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    let html; try { html = fs.readFileSync(sourcePath, 'utf8'); } catch { return send(res, 500, 'text/plain; charset=utf-8', 'ملف frontend.txt غير موجود.'); }
    const config = { supabaseUrl: process.env.SUPABASE_URL || '', supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '' };
    html = html.replace(configPattern, 'window.NASEEB_CONFIG = ' + JSON.stringify(config) + ';');
    return send(res, 200, 'text/html; charset=utf-8', html);
  }
  if (req.method === 'GET' && url.pathname === '/api/subscription/plans') { const plans = await db('subscription_plans?select=code,title,duration_days,price_sar,is_active,sort_order,checkout_url&is_active=eq.true&order=sort_order.asc'); return json(res, 200, plans || []); }
  if (req.method === 'GET' && url.pathname === '/api/admin/me') { const admin = await requireAdmin(req); return json(res, 200, { is_admin: Boolean(admin) }); }
  if (req.method === 'GET' && url.pathname === '/api/admin/plans') { if (!await requireAdmin(req)) return json(res, 403, { error: 'غير مصرح.' }); const plans = await db('subscription_plans?select=code,title,duration_days,price_sar,is_active,sort_order,checkout_url&order=sort_order.asc'); return json(res, 200, plans || []); }
  const planMatch = url.pathname.match(/^\/api\/admin\/plans\/([a-z0-9_-]+)$/);
  if (req.method === 'PATCH' && planMatch) {
    if (!await requireAdmin(req)) return json(res, 403, { error: 'غير مصرح.' });
    const input = await bodyJson(req); const patch = {};
    if (typeof input.title === 'string' && input.title.trim()) patch.title = input.title.trim().slice(0, 80);
    if (Number.isInteger(input.duration_days) && input.duration_days > 0 && input.duration_days <= 3650) patch.duration_days = input.duration_days;
    if (Number.isFinite(Number(input.price_sar)) && Number(input.price_sar) >= 0 && Number(input.price_sar) <= 1000000) patch.price_sar = Number(input.price_sar);
    if (typeof input.is_active === 'boolean') patch.is_active = input.is_active;
    if (typeof input.checkout_url === 'string') patch.checkout_url = validHttpsUrl(input.checkout_url.trim());
    if (!Object.keys(patch).length) return json(res, 400, { error: 'لا توجد تغييرات صالحة.' });
    patch.updated_at = new Date().toISOString();
    const rows = await db('subscription_plans?code=eq.' + encodeURIComponent(planMatch[1]) + '&select=code,title,duration_days,price_sar,is_active,sort_order,checkout_url', 'PATCH', patch);
    if (!rows || !rows.length) return json(res, 404, { error: 'الباقة غير موجودة.' });
    return json(res, 200, rows[0]);
  }
  if (req.method === 'POST' && url.pathname === '/api/salla/checkout-link') {
    const user = await requireUser(req); const input = await bodyJson(req);
    const profiles = await db('profiles?id=eq.' + encodeURIComponent(user.id) + '&select=gender&limit=1');
    if (!profiles || !profiles.length) return json(res, 404, { error: 'ملف الحساب غير موجود.' });
    if (profiles[0].gender === 'female') return json(res, 403, { error: 'حسابات النساء مجانية ولا تحتاج اشتراكًا.' });
    const plans = await db('subscription_plans?code=eq.' + encodeURIComponent(String(input.plan_code || '')) + '&is_active=eq.true&select=code,checkout_url&limit=1');
    if (!plans || !plans.length) return json(res, 404, { error: 'الباقة غير متاحة.' });
    if (!plans[0].checkout_url) return json(res, 409, { error: 'لم يضف المدير رابط سلة لهذه الباقة بعد.' });
    return json(res, 200, { checkout_url: validHttpsUrl(plans[0].checkout_url) });
  }
  return json(res, 404, { error: 'غير موجود.' });
}
const server = http.createServer((req, res) => { handle(req, res).catch(error => { const status = error.status || 500; json(res, status, { error: status >= 500 ? 'تعذر إكمال الطلب. تحقق من إعداد الخادم وقاعدة البيانات.' : error.message }); }); });
server.listen(port, '0.0.0.0', () => console.log('Naseeb server listening on ' + port));
