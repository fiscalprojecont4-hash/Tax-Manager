// Avisos na central de notificações do Windows (e do macOS/Linux), além do sino da plataforma.
// Funcionam enquanto o Tax Manager estiver aberto no navegador (pode ser em segundo plano ou minimizado).
// Os avisos de hoje: relatórios do início e do fim do dia, tarefas que vencem hoje e tarefas atrasadas.
import { lerLocal, gravarLocal, hojeIso } from './dados-teste.js';
import { relatorios, gerarPendentes, HORARIOS } from './relatorio-diario.js';

const CHAVE_ON = 'avisos_sistema';     // 'off' quando a pessoa desativou
const CHAVE_ENVIADOS = 'avisos_enviados';
const ICONE = 'assets/icon-192.png';
const suportado = () => typeof Notification !== 'undefined';
const p2 = (n) => String(n).padStart(2, '0');

export const permissao = () => (suportado() ? Notification.permission : 'unsupported');
export const ativado = () => permissao() === 'granted' && lerLocal(CHAVE_ON) !== 'off';

let registro = null;
async function sw() {
  if (registro) return registro;
  if (!('serviceWorker' in navigator)) return null;
  try { registro = await navigator.serviceWorker.register('sw.js'); await navigator.serviceWorker.ready; } catch (e) { console.warn('Service worker indisponível:', e?.message || e); }
  return registro;
}

/** Mostra um aviso do sistema. tag evita duplicar o mesmo aviso. */
export async function avisar(titulo, corpo, { tag, href = 'dashboard.html' } = {}) {
  if (permissao() !== 'granted') return false;
  const opcoes = { body: corpo, icon: ICONE, badge: 'assets/icon-48.png', tag, data: { href } };
  try {
    const r = await sw();
    if (r) { await r.showNotification(titulo, opcoes); return true; }
    const n = new Notification(titulo, opcoes); n.onclick = () => { window.focus(); location.href = href; n.close(); };
    return true;
  } catch (e) { console.warn('Não foi possível exibir o aviso:', e?.message || e); return false; }
}

/** Pede a permissão ao navegador (precisa vir de um clique) e liga os avisos. */
export async function ativar() {
  if (!suportado()) return 'unsupported';
  const r = permissao() === 'granted' ? 'granted' : await Notification.requestPermission();
  if (r === 'granted') { gravarLocal(CHAVE_ON, 'on'); await sw(); verificar(); }
  return r;
}
export function desativar() { gravarLocal(CHAVE_ON, 'off'); }

// ---- o que avisar ----
function jaEnviado(id) { return (lerLocal(CHAVE_ENVIADOS) || []).includes(id); }
function marcarEnviado(id) {
  const hoje = hojeIso();
  const l = (lerLocal(CHAVE_ENVIADOS) || []).filter(x => x.startsWith(hoje));   // guarda só os de hoje
  l.push(id); gravarLocal(CHAVE_ENVIADOS, l);
}

export async function verificar(agora = new Date()) {
  if (!ativado()) return;
  const hoje = hojeIso();
  const minutos = agora.getHours() * 60 + agora.getMinutes();
  try { gerarPendentes(agora); } catch { /* sem relatório agora */ }

  // relatórios do dia
  for (const [tipo, h] of Object.entries(HORARIOS)) {
    const id = `${hoje}|rel|${tipo}`;
    if (minutos < h.hora * 60 || jaEnviado(id)) continue;
    if (!relatorios().some(r => r.data === hoje && r.tipo === tipo)) continue;
    marcarEnviado(id);   // marca antes de exibir: com duas abas abertas, só a primeira avisa
    await avisar(h.titulo, 'Já está pronto. Abra o sino da plataforma para baixar o PDF.', { tag: id, href: 'dashboard.html' });
  }

  // tarefas (a partir das 8h, uma vez por dia)
  const idT = `${hoje}|tarefas`;
  if (minutos >= 8 * 60 && !jaEnviado(idT)) {
    const abertas = (lerLocal('tarefas') || []).filter(t => !['concluida', 'cancelada'].includes(t.status));
    const venceHoje = abertas.filter(t => t.prazo === hoje).length;
    const atrasadas = abertas.filter(t => t.prazo && t.prazo < hoje).length;
    if (venceHoje || atrasadas) {
      marcarEnviado(idT);
      const partes = [];
      if (venceHoje) partes.push(`${venceHoje} ${venceHoje === 1 ? 'tarefa vence' : 'tarefas vencem'} hoje`);
      if (atrasadas) partes.push(`${atrasadas} ${atrasadas === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}`);
      await avisar('Tarefas do dia', partes.join(' e ') + '.', { tag: idT, href: 'tarefas.html' });
    }
  }
}

let timer = null;
export function iniciarAvisos() {
  if (timer || !suportado()) return;
  if (permissao() === 'granted') sw();
  verificar();
  timer = setInterval(verificar, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verificar(); });
}
