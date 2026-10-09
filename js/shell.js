// Barra superior das páginas novas (Conhecimento, Administração): sessão,
// menu "Módulos" e sino de notificações. As páginas mais antigas trazem o
// mesmo código inline; aqui ele fica num só lugar.

import { createSupabaseClient } from './supabase-client.js';
import { instalarRelatoriosNoSino } from './relatorio-diario.js';

const NOTIF_DATA = [
  { id: 'n1', tipo: 'fiscal', texto: 'DCTF do mês vence hoje.', href: 'calendar.html', quando: 'Hoje', read: false },
  { id: 'n2', tipo: 'tarefa', texto: 'Tarefa atrasada: "Validar notas fiscais — Empresa Alfa" venceu há 2 dias.', href: 'tarefas.html', quando: 'Há 2 dias', read: false },
  { id: 'n3', tipo: 'achado', texto: 'Novo achado em Empresa Alfa: SPED Fiscal do período anterior não localizado.', href: 'validacoes.html', quando: 'Há 3 dias', read: false },
  { id: 'n4', tipo: 'projeto', texto: 'Etapa atrasada no projeto "Rembraz — Regularização cadastral".', href: 'projetos.html', quando: 'Há 1 dia', read: true },
  { id: 'n5', tipo: 'tarefa', texto: 'Reunião de alinhamento com Wendel às 14:30 hoje.', href: 'calendar.html', quando: 'Hoje', read: true },
  { id: 'n6', tipo: 'achado', texto: 'Guia de ICMS de setembro (Lusitano) recolhida com atraso — verificar multa.', href: 'validacoes.html', quando: 'Há 1 dia', read: true },
];

export async function iniciarShell() {
  const supabase = createSupabaseClient(true);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return null; }
  document.getElementById('userEmail').textContent = session.user.email;
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });

  // --- menu "Módulos" ---
  const dropdown = document.getElementById('modulosDropdown');
  const trigger = document.getElementById('modulosTrigger');
  const panel = dropdown.querySelector('.nav-dropdown-panel');
  const fechar = () => dropdown.classList.remove('open');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains('open')) { fechar(); return; }
    const r = trigger.getBoundingClientRect();
    panel.style.top = `${r.bottom + 12}px`;
    panel.style.left = `${r.left + r.width / 2}px`;
    dropdown.classList.add('open');
  });
  document.addEventListener('click', (e) => { if (!dropdown.contains(e.target)) fechar(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });

  // --- sino ---
  const lidas = () => { try { return JSON.parse(sessionStorage.getItem('tm_notif_read') || '[]'); } catch { return []; } };
  const salvarLidas = (ids) => { try { sessionStorage.setItem('tm_notif_read', JSON.stringify(ids)); } catch { /* sem storage */ } };
  const lida = (n) => n.read || lidas().includes(n.id);
  const wrap = document.getElementById('notifWrap');
  const bell = document.getElementById('notifBell');
  const painel = document.getElementById('notifPanel');
  const badge = document.getElementById('notifBadge');
  const lista = document.getElementById('notifList');

  function desenhar() {
    const naoLidas = NOTIF_DATA.filter(n => !lida(n));
    badge.style.display = naoLidas.length ? '' : 'none';
    badge.textContent = naoLidas.length > 9 ? '9+' : String(naoLidas.length);
    lista.innerHTML = '';
    NOTIF_DATA.forEach(n => {
      const a = document.createElement('a');
      a.href = n.href;
      a.className = 'notif-item' + (lida(n) ? ' is-read' : '');
      a.innerHTML = `<span class="notif-dot ${n.tipo}"></span><div class="notif-item-main"><p class="notif-item-text"></p><p class="notif-item-when"></p></div>`;
      a.querySelector('.notif-item-text').textContent = n.texto;
      a.querySelector('.notif-item-when').textContent = n.quando;
      a.addEventListener('click', () => { const l = lidas(); if (!l.includes(n.id)) { l.push(n.id); salvarLidas(l); } });
      lista.appendChild(a);
    });
  }
  const fecharSino = () => wrap.classList.remove('open');
  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    if (wrap.classList.contains('open')) { fecharSino(); return; }
    desenhar();
    wrap.classList.add('open');
    const r = bell.getBoundingClientRect();
    painel.style.top = `${r.bottom + 10}px`;
    painel.style.left = `${Math.max(8, r.right - (painel.offsetWidth || 360))}px`;
  });
  document.getElementById('notifMarkAll').addEventListener('click', (e) => { e.stopPropagation(); salvarLidas(NOTIF_DATA.map(n => n.id)); desenhar(); });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) fecharSino(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharSino(); });
  desenhar();
  instalarRelatoriosNoSino();

  return session;
}
