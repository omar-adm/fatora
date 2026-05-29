// ─────────────────────────────────────────────────────
//  app.js  –  Fatora Daily Log
// ─────────────────────────────────────────────────────
import sb from './Supabase.js';
import { getUser, getProfile, isAdmin, signInWithGoogle, signOut, onAuthChange } from './auth.js';

// ── State ─────────────────────────────────────────────
let currentUser    = null;
let currentProfile = null;
let selectedDate   = null;   // date being edited in the entry form

// ── Helpers ───────────────────────────────────────────
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtMonth(mk) {
  const [y, m] = mk.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString('en-GB', { month:'long', year:'numeric' });
}

function getMonthKey(dateIso) { return dateIso.slice(0, 7); }
function isCurrentMonth(mk) { return mk === today().slice(0, 7); }

// Returns the day number (1–31) from an ISO date
function dayOf(iso) { return parseInt(iso.slice(8, 10), 10); }

// Returns first and last day of the current month
function currentMonthBounds() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m, 1).toISOString().slice(0,10);
  const last  = new Date(y, m + 1, 0).toISOString().slice(0,10);
  return { first, last };
}

// Number of days in the month of a date
function daysInMonth(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

// Hours since a timestamp
function hoursSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

function showScreen(id) {
  if (id === 'admin' && !isAdmin(currentProfile)) {
    console.warn('[fatora] access denied: admin'); return;
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id)?.classList.add('active');
  window.scrollTo(0, 0);
}

function toast(msg, type = 'default') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2800);
}

function on(id, ev, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(ev, fn);
  else console.warn(`[fatora] missing #${id}`);
}

// ── USER: Entry form ──────────────────────────────────
async function renderEntryForm() {
  const { first, last } = currentMonthBounds();
  const picker = document.getElementById('entry-date-picker');

  // Limit picker to current month dates only
  picker.min   = first;
  picker.max   = last;
  if (!picker.value) picker.value = today();
  selectedDate = picker.value;

  await loadEntryForDate(selectedDate);
}

async function loadEntryForDate(dateStr) {
  selectedDate = dateStr;
  document.getElementById('entry-date-label').textContent = fmtDate(dateStr);

  const input = document.getElementById('entry-value');
  const btn   = document.getElementById('btn-save-entry');
  const note  = document.getElementById('entry-locked-note');

  const { data } = await sb
    .from('daily_logs')
    .select('value, created_at')
    .eq('user_id', currentUser.id)
    .eq('date', dateStr)
    .maybeSingle();

  const inCurrentMonth = getMonthKey(dateStr) === today().slice(0, 7);

  if (data?.value !== undefined) {
    // Entry exists
    input.value = data.value;
    const hrs = hoursSince(data.created_at);

    if (!inCurrentMonth) {
      // Past month — always locked
      input.disabled   = true;
      btn.disabled     = true;
      btn.textContent  = 'Locked';
      btn.dataset.mode = 'locked';
      if (note) {
        note.classList.remove('hidden', 'warning');
        note.innerHTML = '🔒 Past month — entry cannot be edited.';
      }
    } else if (hrs < 12) {
      // Within 12-hour edit window
      input.disabled   = false;
      btn.disabled     = false;
      btn.textContent  = 'Update Entry';
      btn.dataset.mode = 'update';
      if (note) {
        note.classList.remove('hidden');
        note.classList.add('warning');
        const hoursLeft = Math.max(0, 12 - hrs).toFixed(1);
        note.innerHTML = `⏱ You can edit this entry for ${hoursLeft} more hour(s).`;
      }
    } else {
      // Past 12 hours — locked
      input.disabled   = true;
      btn.disabled     = true;
      btn.textContent  = 'Locked (>12h)';
      btn.dataset.mode = 'locked';
      if (note) {
        note.classList.remove('hidden');
        note.classList.remove('warning');
        note.innerHTML = '🔒 Entry locked — past the 12-hour edit window.';
      }
    }
  } else {
    // No entry yet
    input.value      = '';
    input.disabled   = !inCurrentMonth;
    btn.disabled     = !inCurrentMonth;
    btn.textContent  = dateStr === today() ? "Save Today's Log" : `Save ${fmtDate(dateStr)}`;
    btn.dataset.mode = 'create';
    if (note) {
      if (inCurrentMonth) {
        note.classList.add('hidden');
      } else {
        note.classList.remove('hidden', 'warning');
        note.innerHTML = '🔒 Past month — cannot add new entry.';
      }
    }
  }
}

async function saveEntry() {
  const input = document.getElementById('entry-value');
  const val   = input.value.trim();
  const btn   = document.getElementById('btn-save-entry');
  const mode  = btn.dataset.mode;

  if (val === '' || isNaN(parseFloat(val))) {
    toast('Please enter a number.', 'error'); return;
  }
  if (mode === 'locked') {
    toast('This entry is locked.', 'error'); return;
  }

  // Block edits outside the current month
  const inCurrentMonth = getMonthKey(selectedDate) === today().slice(0, 7);
  if (!inCurrentMonth) {
    toast('You can only edit entries in the current month.', 'error');
    await loadEntryForDate(selectedDate); return;
  }

  btn.disabled = true; btn.textContent = 'Saving…';
  const value = parseFloat(val);

  let error;
  if (mode === 'update') {
    // Re-check the 12h window before updating
    const { data: existing } = await sb
      .from('daily_logs')
      .select('id, created_at')
      .eq('user_id', currentUser.id)
      .eq('date', selectedDate)
      .maybeSingle();
    if (!existing) {
      toast('Entry not found.', 'error');
      await loadEntryForDate(selectedDate); return;
    }
    if (hoursSince(existing.created_at) >= 12) {
      toast('Edit window expired.', 'error');
      await loadEntryForDate(selectedDate); return;
    }
    ({ error } = await sb.from('daily_logs').update({ value }).eq('id', existing.id));
  } else {
    ({ error } = await sb.from('daily_logs').insert({
      user_id: currentUser.id,
      date:    selectedDate,
      value,
    }));
  }

  if (error) {
    btn.disabled = false;
    toast(error.message, 'error');
    await loadEntryForDate(selectedDate); return;
  }

  toast(mode === 'update' ? '✓ Entry updated!' : '✓ Log saved!');
  await loadEntryForDate(selectedDate);
  await renderHistory();
}

// ── USER: History — Date | Count two-column ───────────
async function renderHistory() {
  const { data: logs, error } = await sb
    .from('daily_logs')
    .select('date, value')
    .eq('user_id', currentUser.id)
    .order('date', { ascending: false });

  if (error) { toast(error.message, 'error'); return; }

  const wrap = document.getElementById('history-wrap');
  if (!logs || logs.length === 0) {
    wrap.innerHTML = '<p class="empty-history">No history yet. Save your first log above.</p>';
    return;
  }

  // Group by month
  const monthsMap = {};
  logs.forEach(l => {
    const mk = getMonthKey(l.date);
    if (!monthsMap[mk]) monthsMap[mk] = [];
    monthsMap[mk].push(l);
  });
  const sortedMonths = Object.keys(monthsMap).sort((a, b) => b.localeCompare(a));

  wrap.innerHTML = sortedMonths.map(mk => {
    const entries   = monthsMap[mk].sort((a, b) => b.date.localeCompare(a.date));
    const monthSum  = entries.reduce((s, l) => s + Number(l.value), 0);
    const isCurrent = isCurrentMonth(mk);

    const rows = entries.map(l => `
      <tr>
        <td class="td-date-cell">${fmtDate(l.date)}</td>
        <td class="td-value has-value">${l.value}</td>
      </tr>
    `).join('');

    const sumRow = `
      <tr class="sum-row">
        <td class="td-sum-label">Monthly Total</td>
        <td class="td-grand-total">${monthSum}</td>
      </tr>`;

    return `
      <div class="month-block">
        <div class="month-header ${isCurrent ? 'current' : ''}">
          <span class="month-label">${fmtMonth(mk)}</span>
          ${isCurrent
            ? '<span class="month-badge">Current Month</span>'
            : '<span class="month-badge locked-badge">🔒 Locked</span>'}
        </div>
        <div class="table-scroll">
          <table class="history-table simple">
            <thead>
              <tr>
                <th class="th-person">Date</th>
                <th class="th-date">Count</th>
              </tr>
            </thead>
            <tbody>${rows}${sumRow}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
}

// ── ADMIN: All users logs + leaderboard ───────────────
async function renderAdminLogs() {
  const wrap = document.getElementById('admin-logs-wrap');
  wrap.innerHTML = '<p class="loading-cell">Loading…</p>';

  const { data: profiles, error: pErr } = await sb
    .from('profiles')
    .select('id, email, role')
    .order('email');

  if (pErr) { wrap.innerHTML = `<p class="loading-cell">${pErr.message}</p>`; return; }

  const { data: logs, error: lErr } = await sb
    .from('daily_logs')
    .select('user_id, date, value')
    .order('date', { ascending: false });

  if (lErr) { wrap.innerHTML = `<p class="loading-cell">${lErr.message}</p>`; return; }

  if (!logs || logs.length === 0) {
    wrap.innerHTML = '<p class="empty-history">No logs submitted yet.</p>'; return;
  }

  // Build: user_id → date → value
  const logMap = {};
  logs.forEach(l => {
    if (!logMap[l.user_id]) logMap[l.user_id] = {};
    logMap[l.user_id][l.date] = l.value;
  });

  // Leaderboard for CURRENT month
  const curMonth = today().slice(0, 7);
  const leaderboard = (profiles ?? []).map(p => {
    const days  = logMap[p.id] ?? {};
    const total = Object.entries(days)
      .filter(([d]) => d.startsWith(curMonth))
      .reduce((s, [, v]) => s + Number(v), 0);
    const count = Object.keys(days).filter(d => d.startsWith(curMonth)).length;
    return { ...p, total, count };
  })
  .sort((a, b) => b.total - a.total);

  const leaderboardHTML = `
    <div class="leaderboard-card">
      <div class="leaderboard-header">
        <div>
          <h3 class="leaderboard-title">🏆 ${fmtMonth(curMonth)} Leaderboard</h3>
          <p class="leaderboard-sub">Ranked by total value this month</p>
        </div>
      </div>
      <div class="leaderboard-list">
        ${leaderboard.map((u, i) => {
          const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
          return `
            <div class="leaderboard-row ${rankClass}">
              <div class="lb-rank">${medal}</div>
              <div class="lb-user">
                <div class="lb-name">${esc(u.email.split('@')[0])}</div>
                <div class="lb-email">${esc(u.email)}</div>
              </div>
              <div class="lb-stats">
                <div class="lb-total">${u.total}</div>
                <div class="lb-days">${u.count} day${u.count === 1 ? '' : 's'}</div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;

  // All dates grouped by month for the breakdown tables
  const allDates  = [...new Set(logs.map(l => l.date))].sort((a, b) => b.localeCompare(a));
  const monthsMap = {};
  allDates.forEach(d => {
    const mk = getMonthKey(d);
    if (!monthsMap[mk]) monthsMap[mk] = [];
    monthsMap[mk].push(d);
  });
  const sortedMonths = Object.keys(monthsMap).sort((a, b) => b.localeCompare(a));

  const tablesHTML = sortedMonths.map(mk => {
    const dates     = monthsMap[mk].sort((a, b) => b.localeCompare(a));
    const isCurrent = isCurrentMonth(mk);

    const thead = `
      <tr>
        <th class="th-person">Name</th>
        ${dates.map(d => `<th class="th-date">${fmtDate(d)}</th>`).join('')}
        <th class="th-total">Monthly Total</th>
      </tr>`;

    const userRows = (profiles ?? []).map(p => {
      const vals     = logMap[p.id] ?? {};
      const monthSum = dates.reduce((s, d) => s + (vals[d] !== undefined ? Number(vals[d]) : 0), 0);
      const hasAny   = dates.some(d => vals[d] !== undefined);
      return `<tr>
        <td class="td-person">
          <span class="person-name">${esc(p.email.split('@')[0])}</span>
          <span class="person-email">${esc(p.email)}</span>
        </td>
        ${dates.map(d => {
          const val = vals[d];
          return `<td class="td-value ${val !== undefined ? 'has-value' : 'empty-value'}">
            ${val !== undefined ? val : '<span class="dash">—</span>'}
          </td>`;
        }).join('')}
        <td class="td-month-total ${hasAny ? 'has-value' : 'empty-value'}">
          ${hasAny ? monthSum : '<span class="dash">—</span>'}
        </td>
      </tr>`;
    }).join('');

    const dailyTotals = dates.map(d =>
      (profiles ?? []).reduce((s, p) => {
        const v = logMap[p.id]?.[d];
        return s + (v !== undefined ? Number(v) : 0);
      }, 0)
    );
    const grandTotal = dailyTotals.reduce((a, b) => a + b, 0);

    const sumRow = `
      <tr class="sum-row">
        <td class="td-sum-label">Daily Total</td>
        ${dailyTotals.map(t => `<td class="td-sum">${t || '<span class="dash">—</span>'}</td>`).join('')}
        <td class="td-grand-total">${grandTotal || '<span class="dash">—</span>'}</td>
      </tr>`;

    return `
      <div class="month-block">
        <div class="month-header ${isCurrent ? 'current' : ''}">
          <span class="month-label">${fmtMonth(mk)}</span>
          ${isCurrent ? '<span class="month-badge">Current Month</span>' : ''}
        </div>
        <div class="table-scroll">
          <table class="history-table">
            <thead>${thead}</thead>
            <tbody>${userRows}${sumRow}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');

  wrap.innerHTML = leaderboardHTML + tablesHTML;
}

// ── User menu ─────────────────────────────────────────
function bindUserMenu() {
  const avatar = document.getElementById('user-avatar');
  const menu   = document.getElementById('user-menu');
  avatar.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
  document.addEventListener('click', () => {
    menu.classList.remove('open');
    document.getElementById('admin-menu')?.classList.remove('open');
  });
  on('menu-logout', 'click', () => signOut());
}

function bindAdminMenu() {
  const avatar = document.getElementById('admin-avatar');
  const menu   = document.getElementById('admin-menu');
  if (!avatar || !menu) return;
  avatar.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
  on('btn-admin-refresh', 'click', () => { menu.classList.remove('open'); renderAdminLogs(); });
  on('btn-admin-logout',  'click', () => signOut());
}

// ── Auth screen ───────────────────────────────────────
function bindAuthScreen() {
  on('btn-google-signin', 'click', async () => {
    const btn = document.getElementById('btn-google-signin');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Redirecting…`;
    try { await signInWithGoogle(); }
    catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.innerHTML = `<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" class="google-icon" alt="G" /> Continue with Google`;
    }
  });
}

// ── Boot ──────────────────────────────────────────────
async function boot(user) {
  try {
    currentUser = user;
    if (!user) { showScreen('auth'); return; }

    const photo      = user.user_metadata?.avatar_url;
    const initial    = (user.email ?? 'A')[0].toUpperCase();
    const avatarHTML = photo ? `<img src="${photo}" class="avatar-img" alt="avatar" />` : initial;
    const fullName   = user.user_metadata?.full_name ?? user.email ?? '';
    const email      = user.email ?? '';
    const shortName  = user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'You';

    const $ = id => document.getElementById(id);
    const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
    const setHTML = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };
    const addCls = (id, c) => $(id)?.classList.add(c);
    const swapCls = (id, f, t) => $(id)?.classList.replace(f, t);

    setHTML('user-avatar',  avatarHTML);
    setHTML('admin-avatar', avatarHTML);
    setText('user-name',    fullName);
    setText('user-email',   email);
    setText('admin-name',   fullName);
    setText('admin-email',  email);
    setText('entry-user-name', shortName);

    setText('role-badge', 'User');
    swapCls('role-badge', 'admin', 'user');
    addCls('menu-admin', 'hidden');

    // Show app screen immediately
    showScreen('app');

    // Profile is needed for routing — but if it fails, default to user view
    try {
      currentProfile = await getProfile(user.id);
    } catch (e) {
      console.error('[fatora] getProfile failed:', e);
      currentProfile = null;
    }

    if (isAdmin(currentProfile)) {
      setText('role-badge', 'Admin');
      swapCls('role-badge', 'user', 'admin');
      showScreen('admin');
      renderAdminLogs().catch(e => console.error('[fatora] renderAdminLogs:', e));
    } else {
      renderEntryForm().catch(e => console.error('[fatora] renderEntryForm:', e));
      renderHistory().catch(e => console.error('[fatora] renderHistory:', e));
    }
  } catch (e) {
    console.error('[fatora] boot failed:', e);
    toast('Something went wrong loading the app.', 'error');
    showScreen('app');
  }
}

// ── Init ──────────────────────────────────────────────
async function init() {
  bindAuthScreen();
  bindUserMenu();
  bindAdminMenu();

  on('btn-save-entry', 'click', saveEntry);
  on('entry-date-picker', 'change', e => loadEntryForDate(e.target.value));

  const user = await getUser();
  await boot(user);

  onAuthChange(async (user) => {
    if (user?.id && user.id === currentUser?.id) return;
    await boot(user);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}