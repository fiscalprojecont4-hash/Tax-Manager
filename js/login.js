import { createSupabaseClient, SUPABASE_ANON_KEY } from './supabase-client.js';

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const rememberMeInput = document.getElementById('rememberMe');
const submitBtn = document.getElementById('submitBtn');
const messageEl = document.getElementById('formMessage');
const togglePasswordBtn = document.getElementById('togglePassword');
const eyeIcon = document.getElementById('eyeIcon');
const resetPasswordLink = document.getElementById('resetPasswordLink');
const googleSignInBtn = document.getElementById('googleSignIn');

const EYE_OPEN = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>';
const EYE_CLOSED = '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.3 21.3 0 0 1 5.17-6.17M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.3 21.3 0 0 1-2.46 3.61M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

togglePasswordBtn.addEventListener('click', () => {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  eyeIcon.innerHTML = isPassword ? EYE_CLOSED : EYE_OPEN;
});

function showMessage(text, type = 'error') {
  messageEl.textContent = text;
  messageEl.className = `form-message ${type}`;
}

function clearMessage() {
  messageEl.textContent = '';
  messageEl.className = 'form-message';
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.textContent = loading ? 'Entrando…' : 'Entrar';
}

function checkConfigured() {
  if (SUPABASE_ANON_KEY === 'COLE_AQUI_A_ANON_KEY') {
    showMessage(
      'Configuração pendente: a anon key do Supabase ainda não foi definida em js/supabase-client.js.',
      'error'
    );
    return false;
  }
  return true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();

  if (!checkConfigured()) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showMessage('Preencha e-mail e senha.');
    return;
  }

  setLoading(true);
  try {
    const supabase = createSupabaseClient(rememberMeInput.checked);
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      showMessage(traduzErro(error.message));
      return;
    }

    window.location.href = 'dashboard.html';
  } catch (err) {
    showMessage('Não foi possível conectar ao servidor. Tente novamente.');
    console.error(err);
  } finally {
    setLoading(false);
  }
});

resetPasswordLink.addEventListener('click', async (event) => {
  event.preventDefault();
  clearMessage();

  if (!checkConfigured()) return;

  const email = emailInput.value.trim();
  if (!email) {
    showMessage('Digite seu e-mail no campo acima antes de pedir a redefinição de senha.');
    return;
  }

  try {
    const supabase = createSupabaseClient(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${window.location.pathname.replace('index.html', '')}redefinir-senha.html`,
    });

    if (error) {
      showMessage(traduzErro(error.message));
      return;
    }

    showMessage('Se esse e-mail estiver cadastrado, enviamos um link de redefinição de senha.', 'success');
  } catch (err) {
    showMessage('Não foi possível conectar ao servidor. Tente novamente.');
    console.error(err);
  }
});

googleSignInBtn.addEventListener('click', async () => {
  clearMessage();
  if (!checkConfigured()) return;

  try {
    const supabase = createSupabaseClient(rememberMeInput.checked);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${window.location.pathname.replace('index.html', '')}dashboard.html` },
    });

    if (error) {
      showMessage(traduzErro(error.message));
    }
  } catch (err) {
    showMessage('Não foi possível conectar ao servidor. Tente novamente.');
    console.error(err);
  }
});

function traduzErro(msg) {
  const mapa = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'Este e-mail ainda não foi confirmado.',
  };
  return mapa[msg] || msg;
}
