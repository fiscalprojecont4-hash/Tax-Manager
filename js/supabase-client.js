// Cliente Supabase compartilhado por todas as páginas.
// Carregado como módulo ES direto do CDN — sem bundler, sem build step,
// compatível com publicação estática no GitHub Pages.
//
// A anon key é segura para ficar pública neste arquivo: a segurança real do
// isolamento multiusuário vem das políticas de Row-Level Security no banco
// (ver supabase/schema.sql), não do sigilo desta chave.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://debwbmbhmtimozhkeyql.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlYndibWJobXRpbW96aGtleXFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0ODM0NTAsImV4cCI6MjEwNzA1OTQ1MH0.FiZcVEijOvpNYBngOO1amvrSpd44P0N4ixi8P1d_k4U';

/**
 * Cria o client do Supabase com o storage de sessão escolhido pelo usuário:
 * localStorage quando "manter conectado" está marcado (sessão sobrevive ao
 * fechar o navegador), sessionStorage quando não está (sessão some ao
 * fechar a aba).
 */
export function createSupabaseClient(rememberMe = true) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: rememberMe ? window.localStorage : window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

/**
 * Client "default" para páginas que só precisam ler a sessão já existente
 * (ex.: checar se o usuário está logado antes de mostrar o dashboard).
 */
export const supabase = createSupabaseClient(true);
