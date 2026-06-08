import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import { OrgSummary, BoardStat, ReconstructedPhrase } from './aac-statistics.service';

export interface StatsPdfMeta {
  orgName:    string;
  filterFrom: string;
  filterTo:   string;
  scopeLabel: string;
}

@Injectable({ providedIn: 'root' })
export class StatisticsPdfExportService {

  async export(
    meta:          StatsPdfMeta,
    summary:       OrgSummary | null,
    chartDataUrls: (string | null)[],   // [temporal, topPicts, actionDist, userActivity, topBoards]
    boards:        BoardStat[],
    phrases:       ReconstructedPhrase[],
  ): Promise<void> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, ML = 14, MR = 14, MT = 14;
    const CW = W - ML - MR;  // 182 mm
    let y = MT;

    // ── Helpers de color ────────────────────────────────────────────────────
    const purple  = () => { doc.setTextColor(124,  77, 255); };
    const gray    = () => { doc.setTextColor(100,  80, 110); };
    const drawL   = () => { doc.setDrawColor(220, 208, 240); };
    const fillPurpleLight = () => { doc.setFillColor(248, 244, 255); };
    const fillPurple      = () => { doc.setFillColor(124,  77, 255); };
    const fillAlt         = () => { doc.setFillColor(250, 247, 255); };

    const checkPage = (needed: number) => {
      if (y + needed > 283) { doc.addPage(); y = MT; }
    };

    // ── CABECERA ─────────────────────────────────────────────────────────────
    const now     = new Date();
    const dateStr = now.toLocaleDateString('es-ES',  { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('es-ES',  { hour: '2-digit', minute: '2-digit' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    purple();
    doc.text('Estadísticas ISAAC', ML, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    gray();
    doc.text(`Descargado: ${dateStr} ${timeStr}`, W - MR, y, { align: 'right' });
    y += 5;

    drawL();
    doc.setLineWidth(0.4);
    doc.line(ML, y, W - MR, y);
    y += 4;

    const periodLabel = meta.filterFrom || meta.filterTo
      ? `${meta.filterFrom ? this.fmtDate(meta.filterFrom) : '—'} → ${meta.filterTo ? this.fmtDate(meta.filterTo) : 'hoy'}`
      : 'Todo el período';

    const headerFields: [string, string][] = [
      ['Organización', meta.orgName],
      ['Período',      periodLabel],
      ['Ámbito',       meta.scopeLabel],
    ];
    for (const [label, value] of headerFields) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      gray();
      doc.text(`${label}:`, ML, y);
      doc.setFont('helvetica', 'normal');
      doc.text(value, ML + 26, y);
      y += 4.5;
    }
    y += 2;

    drawL();
    doc.line(ML, y, W - MR, y);
    y += 6;

    // ── KPI CARDS ────────────────────────────────────────────────────────────
    if (summary) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      purple();
      doc.text('Resumen', ML, y);
      y += 5;

      const kpis: [string, string][] = [
        ['Usuarios finales',   String(summary.totalFinalUsers)],
        ['Profesionales',      String(summary.totalProfessionals)],
        ['Familiares',         String(summary.totalParents)],
        ['Sesiones AAC',       String(summary.totalSessions)],
        ['Interacciones',      String(summary.totalInteractions)],
        ['Frases construidas', String(summary.totalPhrases)],
        ['Interac. / frase',   String(summary.avgInteractionsPerPhrase)],
        ['Duración media',     summary.avgSessionDurationLabel || '—'],
      ];

      const colW = CW / 4;
      const rowH = 13;
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
          const [lbl, val] = kpis[row * 4 + col];
          const x = ML + col * colW;
          fillPurpleLight();
          drawL();
          doc.setLineWidth(0.3);
          doc.roundedRect(x, y, colW - 2, rowH, 2, 2, 'FD');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          purple();
          doc.text(val, x + (colW - 2) / 2, y + 5.5, { align: 'center' });
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.5);
          gray();
          doc.text(lbl, x + (colW - 2) / 2, y + 10.5, { align: 'center' });
        }
        y += rowH + 2;
      }
      y += 4;
    }

    // ── GRÁFICAS ─────────────────────────────────────────────────────────────
    // Tamaños offscreen (deben coincidir con renderChartsOffscreen en el page.ts)
    const CHART_SIZES = [
      { w: 820, h: 280 },
      { w: 540, h: 340 },
      { w: 540, h: 420 },
      { w: 540, h: 340 },
      { w: 540, h: 340 },
    ];
    const chartTitles = [
      'Actividad temporal',
      'Pictogramas más usados',
      'Distribución de acciones',
      'Usuarios más activos',
      'Tableros más usados',
    ];

    if (chartDataUrls.some(u => !!u)) {
      checkPage(20);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      purple();
      doc.text('Gráficas', ML, y);
      y += 5;

      // Gráfica 0 – actividad temporal (ancho completo, ratio correcto)
      if (chartDataUrls[0]) {
        const s0 = CHART_SIZES[0];
        const h0 = Math.round(CW * (s0.h / s0.w) * 10) / 10;
        checkPage(h0 + 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        gray();
        doc.text(chartTitles[0], ML, y);
        y += 2.5;
        doc.addImage(chartDataUrls[0], 'PNG', ML, y, CW, h0);
        y += h0 + 3;
      }

      // Gráficas 1-4 – dos por fila, alturas proporcionales al canvas offscreen
      const halfW = (CW - 4) / 2;
      for (let i = 1; i <= 4; i += 2) {
        const hasLeft  = !!chartDataUrls[i];
        const hasRight = i + 1 <= 4 && !!chartDataUrls[i + 1];
        if (!hasLeft && !hasRight) continue;
        const sL = CHART_SIZES[i];
        const sR = i + 1 <= 4 ? CHART_SIZES[i + 1] : CHART_SIZES[i];
        const hL = Math.round(halfW * (sL.h / sL.w) * 10) / 10;
        const hR = Math.round(halfW * (sR.h / sR.w) * 10) / 10;
        const rowH = Math.max(hL, hR);
        checkPage(rowH + 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        gray();
        if (hasLeft) {
          doc.text(chartTitles[i], ML, y);
          doc.addImage(chartDataUrls[i]!, 'PNG', ML, y + 3, halfW, hL);
        }
        if (hasRight) {
          doc.text(chartTitles[i + 1], ML + halfW + 4, y);
          doc.addImage(chartDataUrls[i + 1]!, 'PNG', ML + halfW + 4, y + 3, halfW, hR);
        }
        y += rowH + 7;
      }
      y += 2;
    }

    // ── TABLEROS ─────────────────────────────────────────────────────────────
    if (boards.length > 0) {
      doc.addPage();
      y = MT;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      purple();
      doc.text('Tableros implicados', ML, y);
      y += 6;

      const COLS = [
        { label: 'Tablero',    x: ML },
        { label: 'Tipo',       x: ML + 72 },
        { label: 'Interac.',   x: ML + 100 },
        { label: 'Frases',     x: ML + 124 },
        { label: 'Con voz',    x: ML + 146 },
        { label: 'Navegación', x: ML + 166 },
      ];

      fillPurple();
      doc.setDrawColor(124, 77, 255);
      doc.rect(ML, y, CW, 6.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(255, 255, 255);
      for (const col of COLS) {
        doc.text(col.label, col.x + 2, y + 4.5);
      }
      y += 6.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      for (let i = 0; i < boards.length; i++) {
        checkPage(7);
        const b = boards[i];
        if (i % 2 === 0) {
          fillAlt();
          doc.rect(ML, y, CW, 6.5, 'F');
        }
        const typeLabel = b.boardRole === 'main' ? 'Principal'
          : b.shape === 'multi'    ? 'Multitablero'
          : b.shape === 'circular' ? 'Circular'
          : 'Cuadrícula';
        gray();
        doc.text((b.name || b.boardId).substring(0, 40), ML + 2,   y + 4.5);
        doc.text(typeLabel,                               ML + 74,  y + 4.5);
        doc.text(String(b.interactions),                  ML + 102, y + 4.5);
        doc.text(String(b.phrases),                       ML + 126, y + 4.5);
        doc.text(String(b.voiceActions),                  ML + 148, y + 4.5);
        doc.text(String(b.navActions),                    ML + 168, y + 4.5);
        y += 6.5;
      }
    }

    // ── FRASES ───────────────────────────────────────────────────────────────
    if (phrases.length > 0) {
      // Pre-carga todas las imágenes únicas en paralelo
      const allUrls = new Set<string>();
      for (const p of phrases) {
        for (const inter of p.interactions ?? []) {
          if (inter.imageUrl) allUrls.add(inter.imageUrl);
        }
      }
      const imgCache = new Map<string, string | null>();
      await Promise.all([...allUrls].map(async url => {
        imgCache.set(url, await this.loadImgDataUrl(url));
      }));

      doc.addPage();
      y = MT;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      purple();
      doc.text(`Frases (${phrases.length})`, ML, y);
      y += 7;

      const ACTION_LABELS: Record<string, string> = {
        ':speak':     'Hablar',
        ':backspace': 'Borrar',
        ':clear':     'Limpiar',
        ':back':      'Atrás',
        ':home':      'Inicio',
      };

      // Dimensiones de cada celda de pictograma (mm)
      const CS  = 13;    // tamaño cuadrado de la celda
      const CLH = 3.5;   // altura del label debajo
      const CG  = 1.5;   // gap horizontal entre celdas
      const ROW_H = CS + CLH + 1;
      const COLS_PER_ROW = Math.floor(CW / (CS + CG));

      for (let i = 0; i < phrases.length; i++) {
        const p  = phrases[i];
        const d  = new Date(p.startedAt);
        const dl = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const tl = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const interactions = p.interactions ?? [];

        // Calcula cuántas filas de pictogramas ocupa esta frase
        const numRows = interactions.length > 0 ? Math.ceil(interactions.length / COLS_PER_ROW) : 0;
        const pictoH  = numRows * ROW_H;
        const aiLines = p.aiReformulatedText
          ? (doc.splitTextToSize(`IA: "${p.aiReformulatedText}"`, CW - 4) as string[]).length
          : 0;
        const totalH = 8.5 + aiLines * 4.5 + (pictoH > 0 ? pictoH + 2 : 0) + 4;
        checkPage(totalH);

        // ── Cabecera de la frase ─────────────────────────────────────────────
        fillPurpleLight();
        drawL();
        doc.setLineWidth(0.3);
        doc.roundedRect(ML, y, CW, 7.5, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        purple();
        const num  = `[${i + 1}]`;
        const numW = doc.getTextWidth(num);
        doc.text(num, ML + 2, y + 5);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(40, 20, 60);
        const maxTextW = CW - numW - 6 - 60;
        const phraseText = doc.splitTextToSize(`"${p.finalText}"`, maxTextW)[0] as string;
        doc.text(phraseText, ML + 4 + numW, y + 5);

        doc.setFontSize(7.5);
        gray();
        doc.text(
          `${p.userName} · ${dl} ${tl} · ${this.fmtDuration(p.durationMs)}`,
          W - MR, y + 5, { align: 'right' },
        );
        y += 8.5;

        // ── Reformulación IA ────────────────────────────────────────────────
        if (p.aiReformulatedText) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(7.5);
          doc.setTextColor(80, 60, 130);
          for (const line of doc.splitTextToSize(`IA: "${p.aiReformulatedText}"`, CW - 4) as string[]) {
            checkPage(5);
            doc.text(line, ML + 3, y + 3.5);
            y += 4.5;
          }
        }

        // ── Secuencia de pictogramas ─────────────────────────────────────────
        if (interactions.length > 0) {
          y += 1;
          for (let idx = 0; idx < interactions.length; idx++) {
            const inter = interactions[idx];
            const col = idx % COLS_PER_ROW;
            const row = Math.floor(idx / COLS_PER_ROW);
            const cx = ML + col * (CS + CG);
            const cy = y + row * ROW_H;

            if (inter.isSystemAction) {
              // Chip de acción del sistema
              doc.setFillColor(230, 220, 255);
              doc.setDrawColor(180, 150, 255);
              doc.setLineWidth(0.2);
              doc.roundedRect(cx, cy, CS, CS, 1.5, 1.5, 'FD');
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(6);
              doc.setTextColor(100, 60, 200);
              const al = (ACTION_LABELS[inter.actionType || ''] || inter.label || '?').substring(0, 7);
              doc.text(al, cx + CS / 2, cy + CS / 2 + 2, { align: 'center' });
            } else {
              // Fondo con color Fitzgerald si existe
              if (inter.color) {
                const hex = inter.color.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16) || 200;
                const g = parseInt(hex.substring(2, 4), 16) || 200;
                const b = parseInt(hex.substring(4, 6), 16) || 255;
                const blend = (c: number) => Math.round(c + (255 - c) * 0.75);
                doc.setFillColor(blend(r), blend(g), blend(b));
                const dr = Math.round(r * 0.7), dg = Math.round(g * 0.7), db = Math.round(b * 0.7);
                doc.setDrawColor(dr, dg, db);
              } else {
                fillPurpleLight();
                drawL();
              }
              // Pictogramas eliminados → borde gris
              if (!inter.activeInFinalPhrase) {
                doc.setDrawColor(180, 180, 180);
              }
              doc.setLineWidth(0.25);
              doc.roundedRect(cx, cy, CS, CS, 1.5, 1.5, 'FD');

              const imgUrl   = inter.imageUrl || null;
              const dataUrl  = imgUrl ? (imgCache.get(imgUrl) ?? null) : null;
              if (dataUrl) {
                doc.addImage(dataUrl, 'PNG', cx + 1, cy + 1, CS - 2, CS - 2);
              } else {
                // Fallback: texto
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(5.5);
                gray();
                const fb = (inter.label || '?').substring(0, 8);
                doc.text(fb, cx + CS / 2, cy + CS / 2 + 2, { align: 'center' });
              }

              // Indicador de eliminado
              if (!inter.activeInFinalPhrase) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7);
                doc.setTextColor(180, 80, 80);
                doc.text('×', cx + CS - 2.5, cy + 3.5);
              }
            }

            // Label debajo de la celda
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(5.5);
            if (!inter.activeInFinalPhrase && !inter.isSystemAction) {
              doc.setTextColor(160, 130, 130);
            } else {
              gray();
            }
            const lbl = (inter.label || '').substring(0, 10);
            doc.text(lbl, cx + CS / 2, cy + CS + CLH, { align: 'center' });
          }
          y += numRows * ROW_H + 2;
        }

        y += 4;
      }
    }

    // ── Guardar ──────────────────────────────────────────────────────────────
    doc.save(`estadisticas-isaac-${now.toISOString().split('T')[0]}.pdf`);
  }

  private loadImgDataUrl(url: string): Promise<string | null> {
    return new Promise(resolve => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = img.naturalWidth  || 64;
          canvas.height = img.naturalHeight || 64;
          canvas.getContext('2d')!.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  private fmtDate(iso: string): string {
    const [yr, mo, dy] = iso.split('-');
    return `${dy}/${mo}/${yr}`;
  }

  private fmtDuration(ms: number): string {
    if (!ms || ms < 0) return '< 1 s';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    return `${Math.floor(s / 60)} min ${s % 60} s`;
  }
}
