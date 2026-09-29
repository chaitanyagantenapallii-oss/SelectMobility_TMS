'use strict';

/* ==========================================================================
   Sign-in screen
   ========================================================================== */

const form = document.getElementById('login-form');
const btn = document.getElementById('login-btn');
const errBox = document.getElementById('login-error');
const errText = document.getElementById('login-error-text');
const emailInput = document.getElementById('email');
const pwInput = document.getElementById('password');
const fEmail = document.getElementById('f-email');
const fPw = document.getElementById('f-password');
const errEmail = document.getElementById('err-email');
const errPw = document.getElementById('err-password');
const capsWarn = document.getElementById('caps-warn');

// `?fresh=1` is an intentional account switch for this browser tab. It keeps
// other tabs signed in while making this tab show the login form.
const freshLogin = new URLSearchParams(location.search).get('fresh') === '1';
if (freshLogin) Api.clearToken();

document.getElementById('year').textContent = new Date().getFullYear();

/* --------------------------------------------------------------------------
   Session pre-check
   A returning user with a valid token should never see this form. This is the
   single biggest efficiency win on the page: it skips the whole sign-in step.
   -------------------------------------------------------------------------- */
if (Api.token && !freshLogin) {
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('.lbl').textContent = 'Restoring your session...';
  Api.get('/auth/me')
    .then(({ user }) => window.location.replace(homeForRole(user?.role, user)))
    .catch(() => {
      // Stale or revoked token - fall back to a normal sign-in.
      Api.clearToken();
      hideBanner();
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.querySelector('.lbl').textContent = 'Sign in to transport desk';
    });
}

function homeForRole(role, user = null) {
  const tenantBase = location.pathname.match(/^\/([^/]+)\/login(?:\.html)?$/i)?.[1];
  const scoped = (page) => tenantBase ? `/${tenantBase}/${page}.html` : `/${page}.html`;
  if (role === 'admin') {
    // `/smipl/login` is the SMIPL operations desk. The platform console has
    // its own unscoped login and must not hijack tenant administrator sessions.
    if (tenantBase && tenantBase.toLowerCase() === 'smipl') return scoped('dashboard');
    return user?.accountType === 'tenant-admin' ? scoped('dashboard') : '/platform.html';
  }
  if (role === 'client') return scoped('client');
  if (role === 'driver') return scoped('driver');
  if (role === 'employee') return scoped('staff');
  return scoped('dashboard');
}

/* --------------------------------------------------------------------------
   Inline validation
   Validate on blur rather than on every keystroke: typing "a" into the email
   field should not immediately shout that it is not a valid address. Once a
   field has been flagged, re-validate on input so the error clears as soon as
   the user fixes it.
   -------------------------------------------------------------------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const touched = { email: false, password: false };

function setError(field, msgEl, msg) {
  const wrap = field.closest('.lf');
  wrap.classList.toggle('invalid', Boolean(msg));
  msgEl.textContent = msg || '';
  field.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function validateEmail() {
  const v = emailInput.value.trim();
  if (!v) return 'Enter your email address.';
  if (!EMAIL_RE.test(v)) return 'That does not look like a valid email address.';
  return '';
}

function validatePassword() {
  if (!pwInput.value) return 'Enter your password.';
  return '';
}

function runValidation(name, show) {
  if (name === 'email') {
    const msg = validateEmail();
    if (show) setError(emailInput, errEmail, msg);
    return msg;
  }
  const msg = validatePassword();
  if (show) setError(pwInput, errPw, msg);
  return msg;
}

emailInput.addEventListener('blur', () => { touched.email = true; runValidation('email', true); });
pwInput.addEventListener('blur', () => { touched.password = true; runValidation('password', true); });

emailInput.addEventListener('input', () => { if (touched.email) runValidation('email', true); });
pwInput.addEventListener('input', () => {
  if (touched.password) runValidation('password', true);
  updateCaps();
});

/* --------------------------------------------------------------------------
   Caps Lock hint - a very common cause of a failed sign-in.
   -------------------------------------------------------------------------- */
function updateCaps(e) {
  const on = typeof e.getModifierState === 'function'
    ? e.getModifierState('CapsLock')
    : null;
  if (on !== null) capsWarn.hidden = !on;
}
pwInput.addEventListener('keyup', updateCaps);
pwInput.addEventListener('keydown', updateCaps);

/* --------------------------------------------------------------------------
   Show / hide password
   -------------------------------------------------------------------------- */
const pwToggle = document.getElementById('pw-toggle');
pwToggle.addEventListener('click', () => {
  const showing = pwInput.type === 'text';
  pwInput.type = showing ? 'password' : 'text';
  pwToggle.textContent = showing ? 'Show' : 'Hide';
  pwToggle.setAttribute('aria-pressed', String(!showing));
  // Keep focus in the field so the user can carry on typing.
  pwInput.focus({ preventScroll: true });
});

/* --------------------------------------------------------------------------
   Remembered email
   Storing the address (never the password) saves returning users a step.
   -------------------------------------------------------------------------- */
const REMEMBER_KEY = 'smi_tms_email';
const rememberBox = document.getElementById('remember');

try {
  const saved = localStorage.getItem(REMEMBER_KEY);
  if (saved) {
    emailInput.value = saved;
    rememberBox.checked = true;
    pwInput.focus({ preventScroll: true });
  }
} catch { /* storage may be unavailable in private mode */ }

function hideBanner() {
  errBox.hidden = true;
  errText.textContent = '';
}

function showBanner(msg) {
  errText.textContent = msg;
  errBox.hidden = false;
}

/* --------------------------------------------------------------------------
   Submit
   -------------------------------------------------------------------------- */
function setLoading(on) {
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  btn.querySelector('.lbl').textContent = on ? 'Signing in...' : 'Sign in to transport desk';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideBanner();

  // Validate both fields up front so the user sees every problem at once.
  touched.email = touched.password = true;
  const emailErr = runValidation('email', true);
  const pwErr = runValidation('password', true);
  if (emailErr || pwErr) {
    (emailErr ? emailInput : pwInput).focus({ preventScroll: true });
    return;
  }

  setLoading(true);

  try {
    const res = await Api.post('/auth/login', {
      email: emailInput.value.trim(),
      password: pwInput.value,
    }, { skipAuthRedirect: true });
    Api.setSession(res.token, res.user);

    try {
      if (rememberBox.checked) localStorage.setItem(REMEMBER_KEY, emailInput.value.trim());
      else localStorage.removeItem(REMEMBER_KEY);
    } catch { /* non-fatal */ }

    window.location.href = homeForRole(res.user?.role, res.user);
  } catch (err) {
    showBanner(err.message || 'Unable to sign in. Please try again.');
    setLoading(false);
    pwInput.select();
    pwInput.focus({ preventScroll: true });
  }
});
