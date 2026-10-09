// Geração de PDF no navegador (jsPDF + autotable, copiados em js/vendor/ para
// funcionar sem CDN). Um só gerador atende Tarefas, Validações, o relatório de
// uma validação e o Calendário: papel timbrado Projecont, resumo, filtros
// aplicados, tabela e/ou blocos de texto.

// Paleta do projeto (mesmos valores de css/login.css)
const AZUL = [29, 78, 216];    // --accent  #1d4ed8
const CIANO = [195, 215, 250]; // --accent-line  #c3d7fa
const TEXTO = [22, 35, 58];    // --text  #16233a
const MUDO = [103, 119, 140];  // --muted  #67778c
const FAIXA = [241, 246, 252]; // --surface  #f1f6fc

let carregando = null;

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Não foi possível carregar ${src}`));
    document.head.appendChild(s);
  });
}

function carregarBibliotecas() {
  if (!carregando) {
    carregando = (async () => {
      if (!window.jspdf) await carregarScript('js/vendor/jspdf.umd.min.js');
      if (!window.jspdf.jsPDF.API.autoTable) await carregarScript('js/vendor/jspdf.plugin.autotable.min.js');
    })().catch(err => { carregando = null; throw err; });
  }
  return carregando;
}

function dataHoraBR(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * @param {object} o
 * @param {string} o.titulo
 * @param {string} [o.subtitulo]
 * @param {string} o.arquivo            nome do arquivo (sem .pdf)
 * @param {'landscape'|'portrait'} [o.orientacao]
 * @param {string} [o.geradoPor]
 * @param {Array<{label:string,valor:(string|number)}>} [o.resumo]
 * @param {string[]} [o.filtros]        descrições dos filtros aplicados
 * @param {string[]} [o.colunas]
 * @param {Array<Array<string>>} [o.linhas]
 * @param {Array<{titulo?:string,colunas:string[],linhas:string[][],estilosColunas?:object,vazio?:string}>} [o.tabelas]  tabelas extras, em sequência
 * @param {Array<{titulo:string, campos:Array<{rotulo:string,texto:string}>}>} [o.blocos]
 * @param {Array<{rotulo:string,valor:string}>} [o.identificacao]  ficha no topo (relatório de uma validação)
 */
export async function gerarPdf(o) {
  await carregarBibliotecas();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: o.orientacao || 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;               // margem lateral
  const TOPO = 30;            // início do conteúdo (abaixo do cabeçalho)
  const BASE = H - 16;        // limite inferior do conteúdo
  let y = TOPO;

  const novaPagina = () => { doc.addPage(); y = TOPO; };
  const garantir = (altura) => { if (y + altura > BASE) novaPagina(); };

  // Título
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...TEXTO);
  doc.text(o.titulo, M, y + 4);
  y += 10;
  if (o.subtitulo) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...MUDO);
    const linhas = doc.splitTextToSize(o.subtitulo, W - 2 * M);
    doc.text(linhas, M, y);
    y += linhas.length * 4.6 + 1;
  }
  doc.setFontSize(8.5);
  doc.setTextColor(...MUDO);
  doc.text(`Gerado em ${dataHoraBR()}${o.geradoPor ? ` por ${o.geradoPor}` : ''}`, M, y);
  y += 6;

  // Ficha de identificação (relatório de uma validação)
  if (o.identificacao && o.identificacao.length) {
    const colunas = 2;
    const larg = (W - 2 * M) / colunas;
    const linhasFicha = Math.ceil(o.identificacao.length / colunas);
    const altura = linhasFicha * 11 + 4;
    garantir(altura);
    doc.setFillColor(...FAIXA);
    doc.roundedRect(M, y, W - 2 * M, altura, 2, 2, 'F');
    o.identificacao.forEach((item, i) => {
      const cx = M + 4 + (i % colunas) * larg;
      const cy = y + 6 + Math.floor(i / colunas) * 11;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...MUDO);
      doc.text(item.rotulo.toUpperCase(), cx, cy);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...TEXTO);
      doc.text(doc.splitTextToSize(String(item.valor || '—'), larg - 8)[0], cx, cy + 4.6);
    });
    y += altura + 6;
  }

  // Resumo (totais)
  if (o.resumo && o.resumo.length) {
    doc.setFontSize(9);
    let x = M;
    garantir(10);
    o.resumo.forEach(r => {
      const txt = `${r.label}: ${r.valor}`;
      doc.setFont('helvetica', 'bold');
      const w = doc.getTextWidth(txt) + 7;
      if (x + w > W - M) { x = M; y += 8; garantir(8); }
      doc.setFillColor(...FAIXA);
      doc.roundedRect(x, y - 4.2, w, 6.6, 1.6, 1.6, 'F');
      doc.setTextColor(...TEXTO);
      doc.text(txt, x + 3.5, y);
      x += w + 2.5;
    });
    y += 8;
  }

  // Filtros aplicados
  if (o.filtros && o.filtros.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUDO);
    const txt = doc.splitTextToSize(`Filtros aplicados: ${o.filtros.join('  |  ')}`, W - 2 * M);
    garantir(txt.length * 4 + 2);
    doc.text(txt, M, y);
    y += txt.length * 4 + 2;
  }

  // Tabelas: a principal (colunas/linhas) e, se houver, outras com título próprio (tabelas).
  const tabelas = [];
  if (o.colunas && o.linhas) tabelas.push({ colunas: o.colunas, linhas: o.linhas, estilosColunas: o.estilosColunas });
  (o.tabelas || []).forEach(t => tabelas.push(t));
  tabelas.forEach(t => {
    if (t.titulo) {
      garantir(18);
      doc.setFillColor(...AZUL);
      doc.rect(M, y - 4, 1.2, 6.2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(...TEXTO);
      doc.text(t.titulo, M + 3.5, y);
      y += 4;
    }
    if (t.linhas.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(...MUDO);
      doc.text(t.vazio || 'Nenhum registro com os filtros atuais.', M, y + 4);
      y += 10;
      return;
    }
    doc.autoTable({
      head: [t.colunas],
      body: t.linhas,
      startY: y + 1,
      margin: { top: TOPO, left: M, right: M, bottom: 18 },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.8, textColor: TEXTO, lineColor: [220, 231, 244], lineWidth: 0.15, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold', halign: 'left' },
      alternateRowStyles: { fillColor: [248, 251, 254] },
      columnStyles: t.estilosColunas || {},
      rowPageBreak: 'avoid',
    });
    y = doc.lastAutoTable.finalY + 6;
  });

  // Blocos de texto (pontos identificados etc.)
  (o.blocos || []).forEach(bloco => {
    doc.setFontSize(10);
    garantir(16);
    doc.setFillColor(...AZUL);
    doc.rect(M, y - 4, 1.2, 6.2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXTO);
    const tit = doc.splitTextToSize(bloco.titulo, W - 2 * M - 4);
    doc.text(tit, M + 3.5, y);
    y += tit.length * 5 + 1.5;
    bloco.campos.forEach(c => {
      if (!c.texto) return;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      const linhas = doc.splitTextToSize(String(c.texto), W - 2 * M - 4);
      garantir(6 + Math.min(linhas.length, 2) * 4.6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...MUDO);
      doc.text(c.rotulo, M + 3.5, y);
      y += 4.2;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...TEXTO);
      linhas.forEach(l => { garantir(4.8); doc.text(l, M + 3.5, y); y += 4.6; });
      y += 1.6;
    });
    y += 4;
  });

  // Cabeçalho e rodapé em todas as páginas
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFillColor(...AZUL);
    doc.rect(0, 0, W, 16, 'F');
    doc.setFillColor(...CIANO);
    doc.rect(0, 16, W, 1.2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text('PROJECONT FISCAL', M, 10.4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Tax Manager', W - M, 10.4, { align: 'right' });
    doc.setFontSize(8);
    doc.setTextColor(...MUDO);
    doc.text('Documento gerado pelo Tax Manager - uso interno', M, H - 8);
    doc.text(`Página ${i} de ${total}`, W - M, H - 8, { align: 'right' });
  }

  doc.save(`${o.arquivo}.pdf`);
}

export { dataHoraBR };
