// Página aberta pelo link do e-mail de recuperação. O supabase-js lê o token da URL
// e dispara PASSWORD_RECOVERY; só então o formulário aparece.
import { createSupabaseClient } from './supabase-client.js';

const supabase = createSupabaseClient(false);
const form = document.getElementById('resetForm');
const msg = document.getElementById('formMessage');
const btn = document.getElementById('submitBtn');
const MIN = 10;

function mostrar(texto, tipo = 'error') {
  msg.textContent = texto;
  msg.className = `form-message ${tipo}`;
}

function liberar() { form.hidden = false; msg.className = 'form-message'; }

supabase.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') liberar(); });

// Link inválido/expirado: o Supabase devolve o erro no hash (#error_description=...).
const hash = new URLSearchParams(window.location.hash.slice(1));
if (hash.get('error')) {
  mostrar('Este link é inválido ou expirou. Volte ao login e peça um novo em "Esqueci minha senha".');
} else {
  setTimeout(async () => {
    if (form.hidden) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) liberar();
      else mostrar('Abra esta página pelo link enviado ao seu e-mail. Se ele expirou, peça um novo em "Esqueci minha senha".');
    }
  }, 2500);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const a = document.getElementById('novaSenha').value;
  const b = document.getElementById('confirmaSenha').value;
  if (a.length < MIN) return mostrar(`A senha precisa ter pelo menos ${MIN} caracteres.`);
  if (/^\d+$/.test(a)) return mostrar('Use letras além de números.');
  if (a !== b) return mostrar('As senhas não coincidem.');
  btn.disabled = true;
  const { error } = await supabase.auth.updateUser({ password: a });
  if (error) {
    btn.disabled = false;
    return mostrar(/same|different/i.test(error.message) ? 'Escolha uma senha diferente da atual.' : 'Não foi possível salvar a senha. Peça um novo link e tente de novo.');
  }
  mostrar('Senha alterada. Redirecionando para o login…', 'success');
  await supabase.auth.signOut();
  setTimeout(() => { window.location.href = 'index.html'; }, 1500);
});
