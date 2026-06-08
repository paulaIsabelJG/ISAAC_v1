/**
 * BoardPdfExportService
 *
 * Exporta tableros ISAAC a PDF.
 *  • Tableros normales/secundarios: página visual (html2canvas) + página técnica (jsPDF)
 *  • Multitableros: páginas de estados visuales (BFS sobre setSlot) + página técnica
 *  • Formato A4 landscape — barra de controles AAC encima del tablero
 *  • Colores del documento alineados con el design system de la app (violeta #7c4dff)
 *  • Sección "Celdas y acciones" como tabla con columnas: pos, label, sonido, acción,
 *    tablero origen y tablero destino
 */

import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Board, BoardCell, CellPictogram, BoardService } from './board.service';
import { FITZGERALD } from '../shared/constants/fitzgerald';

// ─── Página A4 landscape (mm) ─────────────────────────────────────────────────

const PG_W   = 297;
const PG_H   = 210;
const MARGIN = 12;
const USE_W  = PG_W - MARGIN * 2;  // 273 mm
const USE_H  = PG_H - MARGIN * 2;  // 186 mm

// Canvas HTML (px ≈ 144 dpi sobre A4 landscape: 297 mm × 5.66 px/mm)
const HTML_W  = 1680;
const MULTI_W = 1680;

// ─── Colores de la app (RGB) ──────────────────────────────────────────────────
// $violet: #7c4dff · $bg: #fdf5f9 · $border: #ffb6c1

const V_R = 124, V_G = 77, V_B = 255;   // #7c4dff  violet
const S_R = 230, S_G = 215, S_B = 255;   // #e6d7ff  lavender claro (secciones)

// ─── Alias de tipo ────────────────────────────────────────────────────────────

type SlotMap = Map<number, string>;

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class BoardPdfExportService {

  constructor(private boardSvc: BoardService) {}

  // ── API pública ───────────────────────────────────────────────────────────

  async exportToPdf(board: Board): Promise<void> {
    const { jsPDF } = await import('jspdf');
    // A4 landscape para todas las páginas
    const doc: any = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });

    const allBoards = await this.collectBoardGraph(board);
    const isMulti   = board.boardRole === 'multi' || board.shape === 'multi';

    if (isMulti) {
      const states = this.collectMultiStates(board, allBoards);
      let first = true;
      for (let i = 0; i < states.length; i++) {
        if (!first) doc.addPage();
        first = false;
        await this.addMultiStatePage(doc, board, states[i], allBoards, i + 1, states.length);
      }
      doc.addPage();
      this.addMultiTechPage(doc, board, allBoards);
    } else {
      let first = true;
      for (const [, b] of allBoards) {
        if (!first) doc.addPage();
        first = false;
        await this.addVisualPage(doc, b);
        doc.addPage();
        this.addTechPage(doc, b, allBoards);
      }
    }

    doc.save(`${this.safeName(board.name)}.pdf`);
  }

  // ── BFS: grafo de tableros ─────────────────────────────────────────────────

  private async collectBoardGraph(root: Board): Promise<Map<string, Board>> {
    const allBoards = new Map<string, Board>();
    const visited   = new Set<string>();
    const queue     = [root];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const cid = String(cur._id);
      if (visited.has(cid)) continue;
      visited.add(cid); allBoards.set(cid, cur);

      for (const slot of cur.multiBoardSlots ?? []) {
        if (!slot.boardId) continue;
        const tid = String(slot.boardId);
        if (visited.has(tid)) continue;
        try { queue.push((await firstValueFrom(this.boardSvc.getBoardById(tid))).board); }
        catch { visited.add(tid); }
      }
      for (const cell of cur.cells ?? []) {
        const raw = cell.action?.targetBoardId;
        if (!raw) continue;
        const tid = String(raw);
        if (visited.has(tid)) continue;
        try { queue.push((await firstValueFrom(this.boardSvc.getBoardById(tid))).board); }
        catch { visited.add(tid); }
      }
    }
    return allBoards;
  }

  // ── BFS: estados visuales del multitablero ─────────────────────────────────

  private collectMultiStates(master: Board, allBoards: Map<string, Board>): SlotMap[] {
    const key = (m: SlotMap) =>
      [...m.entries()].sort((a, b) => a[0] - b[0]).map(([s, b]) => `${s}:${b}`).join(',');

    const init: SlotMap = new Map();
    for (const slot of master.multiBoardSlots ?? [])
      if (slot.boardId) init.set(slot.slotId, String(slot.boardId));

    const visited = new Set([key(init)]);
    const queue: SlotMap[] = [init];
    const states: SlotMap[] = [init];

    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const [, bid] of cur) {
        const b = allBoards.get(bid);
        if (!b) continue;
        for (const cell of b.cells ?? []) {
          const a = cell.action;
          if (!a || (a.type !== 'setSlot' && a.type !== 'voice+setSlot')) continue;
          if (!a.targetBoardId || a.targetSlotId == null) continue;
          const next: SlotMap = new Map(cur);
          next.set(a.targetSlotId, String(a.targetBoardId));
          const k = key(next);
          if (!visited.has(k)) { visited.add(k); queue.push(next); states.push(next); }
        }
      }
    }
    return states;
  }

  // ── Páginas visuales ───────────────────────────────────────────────────────

  private async addVisualPage(doc: any, board: Board): Promise<void> {
    const html    = board.shape === 'circular' ? this.circularHtml(board) : this.gridHtml(board);
    const canvas  = await this.toCanvas(html, HTML_W);
    const dataUrl = canvas.toDataURL('image/png');
    const imgH    = (canvas.height / canvas.width) * USE_W;
    const fitH    = Math.min(imgH, USE_H);
    const fitW    = imgH <= USE_H ? USE_W : USE_W * USE_H / imgH;
    doc.addImage(dataUrl, 'PNG', MARGIN, MARGIN, fitW, fitH);
  }

  private async addMultiStatePage(
    doc: any, master: Board, slotMap: SlotMap,
    allBoards: Map<string, Board>, num: number, total: number,
  ): Promise<void> {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.setTextColor(V_R, V_G, V_B);
    doc.text(`${master.name.toUpperCase()} — Estado ${num} de ${total}`, MARGIN, MARGIN + 4);
    doc.setTextColor(0, 0, 0);

    const html    = this.multiStateHtml(master, slotMap, allBoards);
    const canvas  = await this.toCanvas(html, MULTI_W);
    const dataUrl = canvas.toDataURL('image/png');
    const top = MARGIN + 7;
    const avH = USE_H - 7;
    const imgH = (canvas.height / canvas.width) * USE_W;
    const fitH = Math.min(imgH, avH);
    const fitW = imgH <= avH ? USE_W : USE_W * avH / imgH;
    doc.addImage(dataUrl, 'PNG', MARGIN, top, fitW, fitH);
  }

  // ── Páginas técnicas ───────────────────────────────────────────────────────

  private addTechPage(doc: any, board: Board, allBoards: Map<string, Board>): void {
    const ctx = new TechPageCtx(doc, MARGIN, USE_W, PG_H);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.setTextColor(V_R, V_G, V_B);
    doc.text(board.name.toUpperCase() + ' — CONFIGURACIÓN', MARGIN, ctx.y);
    doc.setTextColor(0, 0, 0);
    ctx.y += 10;

    ctx.section('Información general');
    ctx.row('Nombre',   board.name);
    ctx.row('Tipo',     board.boardRole === 'secondary' ? 'Secundario' : 'Principal');
    ctx.row('Shape',    board.shape === 'circular' ? 'Circular' : 'Cuadrícula');
    if (board.shape !== 'circular') {
      ctx.row('Filas',    String(board.rows ?? '—'));
      ctx.row('Columnas', String(board.columns ?? '—'));
    } else {
      ctx.row('Ranuras',  String(board.circleSlots ?? '—'));
    }
    ctx.row('Publicado', board.visibleInProfile ? 'Sí' : 'No');
    if (board.createdAt) ctx.row('Creado', new Date(board.createdAt).toLocaleDateString('es-ES'));

    if (board.controlsConfig) {
      ctx.section('Barra de controles AAC');
      ctx.row('Botones', (board.controlsConfig.visibleButtons ?? []).join(', ') || '—');
      ctx.row('Orden',   (board.controlsConfig.order ?? []).join(', ') || '—');
    }

    if (board.predictorEnabled) {
      ctx.section('Predictor IA');
      ctx.row('Filas',         String(board.iaRows ?? 5));
      ctx.row('Columnas',      String(board.iaCols ?? 1));
      ctx.row('Reescritura IA', board.aiRewriteEnabled ? 'Sí' : 'No');
    }

    if (board.locationColumnEnabled) {
      ctx.section('Columna de localización');
      ctx.row('Ranuras', String(board.locationColumnSlots ?? 6));
    }

    const withPict = (board.cells ?? []).filter(c => c.pictogram);
    if (withPict.length > 0) {
      ctx.section('Celdas y acciones');
      this.drawCellsTable(doc, withPict, allBoards, ctx, null);
    }

    const custom = (board.cells ?? []).filter(c => c.pictogram?.source !== 'arasaac' && c.pictogram);
    if (custom.length > 0) {
      ctx.section('Pictogramas personalizados');
      for (const cell of custom) {
        ctx.chk(2);
        const p = cell.pictogram!;
        doc.setFont('helvetica', 'bold');   doc.setFontSize(8);
        doc.text(`${p.label.toUpperCase()} — [${cell.row},${cell.col}]`, MARGIN, ctx.y);
        ctx.y += 4.5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
        doc.text(`  Origen: ${p.source}  ·  ID: ${p.id || '—'}`, MARGIN, ctx.y, { maxWidth: USE_W });
        ctx.y += 5;
      }
    }
  }

  private addMultiTechPage(doc: any, master: Board, allBoards: Map<string, Board>): void {
    const ctx = new TechPageCtx(doc, MARGIN, USE_W, PG_H);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.setTextColor(V_R, V_G, V_B);
    doc.text(master.name.toUpperCase() + ' — CONFIGURACIÓN MULTITABLERO', MARGIN, ctx.y);
    doc.setTextColor(0, 0, 0);
    ctx.y += 10;

    ctx.section('Multitablero');
    ctx.row('Huecos', String(master.slotCount ?? 2));
    if ((master.multiBoardLayout?.widths ?? []).length > 0)
      ctx.row('Anchos (%)',  master.multiBoardLayout!.widths.join(' | '));
    if ((master.multiBoardLayout?.heights ?? []).length > 0)
      ctx.row('Altos (%)', master.multiBoardLayout!.heights.join(' | '));

    ctx.section('Asignación de huecos');
    for (const slot of master.multiBoardSlots ?? []) {
      const b = slot.boardId ? allBoards.get(String(slot.boardId)) : null;
      ctx.row(`Hueco ${slot.slotId}`, b?.name ?? `(ID: ${slot.boardId ?? '—'})`);
    }

    if (master.controlsConfig) {
      ctx.section('Barra de controles AAC');
      ctx.row('Botones', (master.controlsConfig.visibleButtons ?? []).join(', ') || '—');
      ctx.row('Orden',   (master.controlsConfig.order ?? []).join(', ') || '—');
    }

    if (master.predictorEnabled) {
      ctx.section('Predictor IA');
      ctx.row('Filas',    String(master.iaRows ?? 5));
      ctx.row('Columnas', String(master.iaCols ?? 1));
    }

    // Celdas de todos los tableros del grafo (con columna de tablero origen)
    const allCellRows: Array<{ cell: BoardCell; origin: Board }> = [];
    for (const [, b] of allBoards) {
      if (b._id === master._id) continue;  // master no tiene celdas propias
      for (const cell of b.cells ?? []) {
        if (cell.pictogram) allCellRows.push({ cell, origin: b });
      }
    }
    if (allCellRows.length > 0) {
      ctx.section('Celdas y acciones (todos los tableros del multitablero)');
      this.drawCellsTable(doc, allCellRows.map(r => r.cell), allBoards, ctx,
        allCellRows.map(r => r.origin));
    }

    // Pictogramas personalizados de todos los tableros
    const allCustom: Array<{ board: Board; cell: BoardCell; p: CellPictogram }> = [];
    for (const [, b] of allBoards) {
      for (const cell of b.cells ?? []) {
        if (cell.pictogram && cell.pictogram.source !== 'arasaac')
          allCustom.push({ board: b, cell, p: cell.pictogram });
      }
    }
    if (allCustom.length > 0) {
      ctx.section('Pictogramas personalizados');
      for (const { board, cell, p } of allCustom) {
        ctx.chk(2);
        doc.setFont('helvetica', 'bold');   doc.setFontSize(8);
        doc.text(`${p.label.toUpperCase()} — ${board.name} [${cell.row},${cell.col}]`, MARGIN, ctx.y);
        ctx.y += 4.5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
        doc.text(`  Origen: ${p.source}  ·  ID: ${p.id || '—'}`, MARGIN, ctx.y, { maxWidth: USE_W });
        ctx.y += 5;
      }
    }
  }

  // ── Tabla de celdas ────────────────────────────────────────────────────────

  /**
   * Dibuja una tabla de celdas con jsPDF.
   * @param origins  Si se pasa un array, añade columna "T. Origen". null = sin columna origen.
   */
  private drawCellsTable(
    doc: any,
    cells: BoardCell[],
    allBoards: Map<string, Board>,
    ctx: TechPageCtx,
    origins: Board[] | null,
  ): void {
    const hasOrigin = origins !== null && origins.length === cells.length;

    // ── Definición de columnas (suman exactamente USE_W = 273 mm) ─────────────
    type Col = { label: string; w: number };
    const cols: Col[] = hasOrigin
      ? [
          { label: 'POS',        w: 13 },
          { label: 'PICTOGRAMA', w: 46 },
          { label: 'SONIDO',     w: 38 },
          { label: 'ACCIÓN',     w: 38 },
          { label: 'T. ORIGEN',  w: 64 },
          { label: 'T. DESTINO', w: 74 },
        ]
      : [
          { label: 'POS',        w: 15 },
          { label: 'PICTOGRAMA', w: 58 },
          { label: 'SONIDO',     w: 50 },
          { label: 'ACCIÓN',     w: 42 },
          { label: 'T. DESTINO', w: 108 },
        ];

    const H_HDR = 6;
    const H_ROW = 5.5;
    const totalW = USE_W;

    const drawHeader = () => {
      let x = MARGIN;
      // Fondo lavanda de la cabecera
      doc.setFillColor(S_R, S_G, S_B);
      doc.rect(MARGIN, ctx.y - 4, totalW, H_HDR, 'F');
      // Separadores verticales
      doc.setDrawColor(200, 175, 240);
      for (const col of cols.slice(0, -1)) {
        x += col.w;
        doc.line(x, ctx.y - 4, x, ctx.y - 4 + H_HDR);
      }
      // Texto de cabecera
      x = MARGIN;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
      doc.setTextColor(V_R, V_G, V_B);
      for (const col of cols) {
        doc.text(col.label, x + 1.5, ctx.y);
        x += col.w;
      }
      doc.setTextColor(0, 0, 0);
      ctx.y += H_HDR;
    };

    ctx.chk(3);
    drawHeader();

    for (let i = 0; i < cells.length; i++) {
      const cell   = cells[i];
      const origin = hasOrigin ? origins![i] : null;
      const p      = cell.pictogram!;
      const a      = cell.action;

      // Salto de página automático
      if (ctx.y + H_ROW > PG_H - MARGIN) {
        doc.addPage();
        ctx.y = MARGIN;
        drawHeader();
      }

      // Fondo alternado
      if (i % 2 === 1) {
        doc.setFillColor(248, 244, 255);
        doc.rect(MARGIN, ctx.y - 3.5, totalW, H_ROW, 'F');
      }

      // Separadores verticales de datos
      let x = MARGIN;
      doc.setDrawColor(225, 210, 250);
      for (const col of cols.slice(0, -1)) {
        x += col.w;
        doc.line(x, ctx.y - 3.5, x, ctx.y - 3.5 + H_ROW);
      }

      // Línea inferior
      doc.setDrawColor(235, 222, 252);
      doc.line(MARGIN, ctx.y + H_ROW - 3.5, MARGIN + totalW, ctx.y + H_ROW - 3.5);

      // Datos de cada columna
      const values: string[] = hasOrigin
        ? [
            `[${cell.row},${cell.col}]`,
            p.label.toUpperCase(),
            p.sound || p.label,
            this.actionTypeShort(a?.type),
            origin?.name ?? '—',
            this.targetName(cell, allBoards),
          ]
        : [
            `[${cell.row},${cell.col}]`,
            p.label.toUpperCase(),
            p.sound || p.label,
            this.actionTypeShort(a?.type),
            this.targetName(cell, allBoards),
          ];

      x = MARGIN;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.setTextColor(0, 0, 0);
      for (let ci = 0; ci < cols.length; ci++) {
        doc.text(values[ci] ?? '—', x + 1.5, ctx.y, { maxWidth: cols[ci].w - 3 });
        x += cols[ci].w;
      }

      ctx.y += H_ROW;
    }
    ctx.y += 3;
  }

  // ── Constructores HTML ─────────────────────────────────────────────────────

  /** Barra de controles AAC (se coloca encima del tablero en las páginas visuales) */
  private aacBarHtml(board: Board): string {
    const cfg     = board.controlsConfig;
    const order   = cfg?.order   ?? ['home', 'back', 'speak', 'phraseBar', 'deleteLast', 'clearAll'];
    const visible = new Set(cfg?.visibleButtons ?? ['home', 'back', 'speak', 'deleteLast', 'clearAll']);

    const LABELS: Record<string, string> = {
      home:       'Inicio',
      back:       'Atrás',
      speak:      'Hablar',
      deleteLast: 'Borrar',
      clearAll:   'Limpiar',
    };

    let items = '';
    for (const item of order) {
      if (item === 'phraseBar') {
        items += `<div style="flex:1;background:rgba(255,255,255,0.1);border-radius:8px;height:56px;display:flex;align-items:center;padding:0 16px;min-width:0;border:1.5px solid rgba(255,255,255,0.15);">
          <span style="color:rgba(255,255,255,0.35);font-size:14px;font-style:italic;white-space:nowrap;overflow:hidden;">Barra de frases AAC</span>
        </div>`;
      } else if (visible.has(item as any)) {
        const lbl = e((LABELS[item] ?? item).toUpperCase());
        items += `<div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:6px 14px;color:#fff;font-size:11px;font-weight:700;height:56px;display:flex;align-items:center;justify-content:center;white-space:nowrap;border:1.5px solid rgba(255,255,255,0.12);">
          ${lbl}
        </div>`;
      }
    }

    return `<div style="background:#2d0f7a;padding:10px 14px;display:flex;align-items:center;gap:8px;border-radius:10px 10px 0 0;">
      ${items}
    </div>`;
  }

  /** Tablero grid estándar con barra AAC encima */
  private gridHtml(board: Board): string {
    const rows   = board.rows ?? 3;
    const cols   = board.columns ?? 4;
    const pad    = 18;
    const gap    = 5;
    const cellW  = Math.floor((HTML_W - pad * 2 - gap * (cols - 1)) / cols);
    const cellH  = Math.max(72, Math.round(cellW * 1.1));
    const imgSz  = Math.round(cellH * 0.54);
    const fSize  = Math.max(9, Math.min(14, Math.round(cellW / 13)));

    const cellMap = new Map<string, BoardCell>();
    for (const c of board.cells ?? []) cellMap.set(`${c.row}-${c.col}`, c);

    let cells = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell   = cellMap.get(`${r}-${c}`);
        const p      = cell?.pictogram;
        const bg     = p ? this.cellBg(p)     : '#ede8fd';
        const border = p ? this.cellBorder(p) : '#d8c8f0';
        const tc     = this.contrast(bg);
        const img    = p?.imageUrl
          ? `<img src="${e(p.imageUrl)}" crossorigin="anonymous" style="max-width:${imgSz}px;max-height:${imgSz}px;object-fit:contain;display:block;">`
          : '';
        const lbl    = p
          ? `<span style="text-transform:uppercase;font-weight:900;font-size:${fSize}px;color:${tc};text-align:center;word-break:break-word;line-height:1.2;margin-top:3px;">${e(p.label)}</span>`
          : '';
        cells += `<div style="background:${bg};border:2px solid ${border};border-radius:7px;min-height:${cellH}px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5px;box-sizing:border-box;opacity:${p ? 1 : 0.18};">${img}${lbl}</div>`;
      }
    }

    const meta = `${rows}×${cols}${board.predictorEnabled ? ' · Predictor IA' : ''}`;

    return `<div style="width:${HTML_W}px;background:#fdf5f9;padding:${pad}px;font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px;">
        <h1 style="margin:0;font-size:22px;font-weight:900;text-transform:uppercase;color:#7c4dff;letter-spacing:.4px;">${e(board.name)}</h1>
        <span style="font-size:11px;color:#9c78cc;">${meta}</span>
      </div>
      ${this.aacBarHtml(board)}
      <div style="background:#fff;border:2px solid #ddd0f8;border-top:none;border-radius:0 0 10px 10px;padding:12px;">
        <div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:${gap}px;">${cells}</div>
      </div>
    </div>`;
  }

  /** Tablero circular con barra AAC encima */
  private circularHtml(board: Board): string {
    const n      = board.circleSlots ?? 8;
    // R=44 coincide con board-layout.service (ref. app real)
    const R      = 44;
    // Canvas cuadrado con margen suficiente para que los slots no se corten
    const ctnSz  = Math.min(HTML_W - 80, 660);
    // Cuerda entre centros de slots adyacentes a radio R% del contenedor
    const chord  = 2 * (R / 100) * ctnSz * Math.sin(Math.PI / n);
    // Tamaño de slot: 78% de la cuerda, limitado a un máximo relativo al contenedor
    const maxSz  = Math.round(ctnSz * 0.19);
    const slotSz = Math.max(56, Math.min(Math.round(chord * 0.78), maxSz));
    const imgSz  = Math.round(slotSz * 0.52);
    const fSize  = Math.max(7, Math.min(12, Math.round(slotSz / 7)));

    const centerCell = (board.cells ?? []).find(c => c.row === 0 && c.col === -1);
    const outer      = new Map<number, BoardCell>();
    for (const c of board.cells ?? []) if (c.row > 0) outer.set(c.col, c);

    let slots = '';
    for (let i = 0; i < n; i++) {
      const ang    = ((i / n) * 360 - 90) * Math.PI / 180;
      const left   = 50 + R * Math.cos(ang);
      const top    = 50 + R * Math.sin(ang);
      const cell   = outer.get(i);
      const p      = cell?.pictogram;
      const bg     = p ? this.cellBg(p)     : '#ede8fd';
      const border = p ? this.cellBorder(p) : '#d8c8f0';
      const tc     = this.contrast(bg);
      const img    = p?.imageUrl
        ? `<img src="${e(p.imageUrl)}" crossorigin="anonymous" style="max-width:${imgSz}px;max-height:${imgSz}px;object-fit:contain;">`
        : '';
      const lbl    = p
        ? `<span style="text-transform:uppercase;font-weight:900;font-size:${fSize}px;color:${tc};text-align:center;word-break:break-word;">${e(p.label)}</span>`
        : '';
      slots += `<div style="position:absolute;left:calc(${left}% - ${slotSz/2}px);top:calc(${top}% - ${slotSz/2}px);width:${slotSz}px;height:${slotSz}px;background:${bg};border:2px solid ${border};border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;padding:3px;box-sizing:border-box;">${img}${lbl}</div>`;
    }

    const cp      = centerCell?.pictogram;
    const cSz     = Math.round(ctnSz * 0.19);
    const cBg     = cp ? this.cellBg(cp)     : '#fff';
    const cBorder = cp ? this.cellBorder(cp) : '#b59ef5';
    const cTc     = this.contrast(cBg);

    return `<div style="width:${HTML_W}px;background:#fdf5f9;padding:18px;font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px;">
        <h1 style="margin:0;font-size:22px;font-weight:900;text-transform:uppercase;color:#7c4dff;">${e(board.name)}</h1>
        <span style="font-size:11px;color:#9c78cc;">Circular · ${n} ranuras</span>
      </div>
      ${this.aacBarHtml(board)}
      <div style="background:#fff;border:2px solid #ddd0f8;border-top:none;border-radius:0 0 10px 10px;padding:20px;display:flex;justify-content:center;overflow:visible;">
        <div style="position:relative;width:${ctnSz}px;height:${ctnSz}px;background:#f3eeff;border-radius:50%;overflow:visible;">
          ${slots}
          <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${cSz}px;height:${cSz}px;background:${cBg};border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px solid ${cBorder};overflow:hidden;">
            ${cp?.imageUrl ? `<img src="${e(cp.imageUrl)}" crossorigin="anonymous" style="max-width:${Math.round(cSz*.5)}px;max-height:${Math.round(cSz*.5)}px;object-fit:contain;">` : ''}
            ${cp ? `<span style="font-weight:900;font-size:${Math.max(7,Math.round(cSz/9))}px;text-transform:uppercase;color:${cTc};text-align:center;">${e(cp.label)}</span>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }

  /** Estado visual del multitablero */
  private multiStateHtml(master: Board, slotMap: SlotMap, allBoards: Map<string, Board>): string {
    const slotCount  = master.slotCount ?? 2;
    const byRow      = slotCount === 4 ? [[1, 2], [3, 4]] : [Array.from({ length: slotCount }, (_, i) => i + 1)];
    const defaultPct = Math.round(100 / slotCount);
    const rawW       = master.multiBoardLayout?.widths ?? [];
    const widths     = rawW.length === slotCount ? rawW : Array(slotCount).fill(defaultPct);
    const rawH       = master.multiBoardLayout?.heights ?? [];
    const contentH   = 820;

    let rowsHtml = '';
    for (let ri = 0; ri < byRow.length; ri++) {
      const rowSlots = byRow[ri];
      const rowPct   = rawH.length > ri ? rawH[ri] : Math.round(100 / byRow.length);
      const rowH     = Math.round(contentH * rowPct / 100);

      let slotsHtml = '';
      for (let si = 0; si < rowSlots.length; si++) {
        const slotId = rowSlots[si];
        const slotW  = Math.round(MULTI_W * (widths[slotId - 1] ?? defaultPct) / 100);
        const bid    = slotMap.get(slotId);
        const b      = bid ? allBoards.get(bid) : null;
        slotsHtml += `<div style="width:${slotW}px;height:${rowH}px;flex-shrink:0;overflow:hidden;">
          ${b ? this.miniSlotHtml(b, slotW, rowH, slotId) : this.emptySlotHtml(slotId, slotW, rowH)}
        </div>`;
        if (si < rowSlots.length - 1)
          slotsHtml += `<div style="width:3px;height:${rowH}px;background:#b59ef5;flex-shrink:0;"></div>`;
      }
      rowsHtml += `<div style="display:flex;width:${MULTI_W}px;height:${rowH}px;flex-shrink:0;">${slotsHtml}</div>`;
      if (ri < byRow.length - 1)
        rowsHtml += `<div style="width:${MULTI_W}px;height:3px;background:#b59ef5;flex-shrink:0;"></div>`;
    }

    // Barra AAC encima del multitablero
    const aacBar = this.aacBarHtml(master);
    return `<div style="width:${MULTI_W}px;background:#fdf5f9;font-family:Arial,Helvetica,sans-serif;overflow:hidden;">
      <div style="padding:10px 16px;background:#fdf5f9;display:flex;align-items:baseline;gap:10px;">
        <span style="font-size:18px;font-weight:900;text-transform:uppercase;color:#7c4dff;">${e(master.name)}</span>
      </div>
      ${aacBar}
      <div style="display:flex;flex-direction:column;border:2px solid #ddd0f8;border-top:none;">${rowsHtml}</div>
    </div>`;
  }

  /** Mini-tablero dentro de un slot */
  private miniSlotHtml(board: Board, slotW: number, slotH: number, slotId: number): string {
    const HDR   = 28;
    const rows  = board.rows ?? 3;
    const cols  = board.columns ?? 4;
    const gap   = 3;
    const avW   = slotW - 10;
    const avH   = slotH - HDR - 10;
    const cellW = Math.floor((avW - gap * (cols - 1)) / cols);
    const cellH = Math.floor((avH - gap * (rows - 1)) / rows);
    const cSz   = Math.max(24, Math.min(cellW, cellH));
    const imgSz = Math.round(cSz * 0.52);
    const fSize = Math.max(6, Math.round(cSz / 11));

    const cellMap = new Map<string, BoardCell>();
    for (const c of board.cells ?? []) cellMap.set(`${c.row}-${c.col}`, c);

    let cells = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell   = cellMap.get(`${r}-${c}`);
        const p      = cell?.pictogram;
        const bg     = p ? this.cellBg(p)     : '#ede8fd';
        const border = p ? this.cellBorder(p) : '#d8c8f0';
        const tc     = this.contrast(bg);
        const img    = p?.imageUrl ? `<img src="${e(p.imageUrl)}" crossorigin="anonymous" style="max-width:${imgSz}px;max-height:${imgSz}px;object-fit:contain;display:block;">` : '';
        const lbl    = p ? `<span style="text-transform:uppercase;font-weight:900;font-size:${fSize}px;color:${tc};text-align:center;word-break:break-word;line-height:1.1;">${e(p.label)}</span>` : '';
        cells += `<div style="width:${cSz}px;height:${cSz}px;background:${bg};border:1.5px solid ${border};border-radius:4px;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;padding:2px;box-sizing:border-box;opacity:${p ? 1 : 0.18};">${img}${lbl}</div>`;
      }
    }

    return `<div style="width:${slotW}px;height:${slotH}px;background:#faf7ff;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;">
      <div style="height:${HDR}px;padding:0 8px;background:#4a1f8c;color:#fff;display:flex;align-items:center;flex-shrink:0;overflow:hidden;">
        <span style="font-size:10px;font-weight:900;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Hueco ${slotId} · ${e(board.name)}</span>
      </div>
      <div style="flex:1;padding:5px;display:grid;grid-template-columns:repeat(${cols},${cSz}px);grid-template-rows:repeat(${rows},${cSz}px);gap:${gap}px;overflow:hidden;">${cells}</div>
    </div>`;
  }

  private emptySlotHtml(slotId: number, w: number, h: number): string {
    return `<div style="width:${w}px;height:${h}px;background:#f3eeff;display:flex;align-items:center;justify-content:center;color:#b59ef5;font-size:13px;">Hueco ${slotId} — sin tablero</div>`;
  }

  // ── html2canvas ────────────────────────────────────────────────────────────

  private async toCanvas(html: string, width: number): Promise<HTMLCanvasElement> {
    const html2canvas = (await import('html2canvas')).default;
    const wrapper     = document.createElement('div');
    wrapper.style.cssText = `position:fixed;top:-99999px;left:0;width:${width}px;z-index:-9999;pointer-events:none;`;
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);

    const imgs = Array.from(wrapper.querySelectorAll('img')) as HTMLImageElement[];
    await Promise.allSettled(imgs.map(img =>
      img.complete ? Promise.resolve()
        : new Promise(res => { img.onload = res; img.onerror = res; }),
    ));
    await new Promise(r => setTimeout(r, 200));

    const canvas = await html2canvas(wrapper.firstElementChild as HTMLElement, {
      useCORS: true, allowTaint: false, scale: 2, logging: false,
      width, backgroundColor: '#fdf5f9',
    });

    document.body.removeChild(wrapper);
    return canvas;
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────

  /** Mezcla un color hex con blanco. amount=1 → color puro, amount=0 → blanco. */
  private blendWhite(hex: string, amount: number): string {
    const m = hex.replace('#', '').match(/.{2}/g);
    if (!m || m.length < 3) return '#f5f5f5';
    const [r, g, b] = m.map(x => parseInt(x, 16));
    const mix = (c: number) => Math.round(c * amount + 255 * (1 - amount));
    return `#${[mix(r), mix(g), mix(b)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  /** Color base (Fitzgerald o manual) de un pictograma. */
  private baseColor(p: CellPictogram): string {
    return p.fitzgeraldEnabled
      ? ((FITZGERALD as Record<string, string>)[p.wordType] ?? '#f5f5f5')
      : (p.color || '#f5f5f5');
  }

  /** Fondo: tinte muy claro (20% color + 80% blanco) — igual que la app. */
  private cellBg(p: CellPictogram): string {
    return this.blendWhite(this.baseColor(p), 0.20);
  }

  /** Borde: tinte semisaturado (55% color + 45% blanco) — igual que la app. */
  private cellBorder(p: CellPictogram): string {
    const base = this.baseColor(p);
    if (base === '#ffffff' || base === '#f5f5f5') return '#cccccc';
    return this.blendWhite(base, 0.55);
  }

  private contrast(hex: string): string {
    const m = hex.replace('#', '').match(/.{2}/g);
    if (!m) return '#000';
    const [r, g, b] = m.map(x => parseInt(x, 16));
    return 0.299 * r + 0.587 * g + 0.114 * b > 155 ? '#111' : '#fff';
  }

  private actionTypeShort(type?: string): string {
    const m: Record<string, string> = {
      voice:           'Solo voz',
      navigate:        'Navegar →',
      'voice+navigate':'Voz + Navegar',
      setSlot:         'Cambiar hueco',
      'voice+setSlot': 'Voz + Cambiar hueco',
      speakAndBack:    'Voz + Volver',
      disabled:        'Desactivado',
    };
    return m[type ?? 'voice'] ?? (type ?? '—');
  }

  private targetName(cell: BoardCell, allBoards: Map<string, Board>): string {
    const a = cell.action;
    if (!a?.targetBoardId) return '—';
    const b = allBoards.get(String(a.targetBoardId));
    return b ? b.name : `ID: ${String(a.targetBoardId).slice(0, 8)}…`;
  }

  private safeName(name: string): string {
    return name.replace(/[^\w\s\-áéíóúñüÁÉÍÓÚÑÜ]/g, '').trim().replace(/\s+/g, '_') || 'tablero';
  }
}

// ─── TechPageCtx ─────────────────────────────────────────────────────────────

class TechPageCtx {
  y: number;
  private readonly LINE      = 5.5;
  private readonly LABEL_COL = 58;

  constructor(private doc: any, margin: number, private useW: number, private pgH: number) {
    this.y = margin;
  }

  chk(lines = 1): void {
    if (this.y + lines * this.LINE > this.pgH - 12) {
      this.doc.addPage();
      this.y = 12;
    }
  }

  section(title: string): void {
    this.chk(2);
    this.y += 2;
    // Fondo lavanda claro en lugar del gris oscuro anterior
    this.doc.setFillColor(S_R, S_G, S_B);
    this.doc.rect(12, this.y - 4, this.useW, 6, 'F');
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(8.5);
    this.doc.setTextColor(V_R, V_G, V_B);
    this.doc.text(title.toUpperCase(), 14, this.y);
    this.doc.setTextColor(0, 0, 0);
    this.y += 5;
  }

  row(label: string, value: string): void {
    this.chk();
    this.doc.setFont('helvetica', 'bold');   this.doc.setFontSize(8);
    this.doc.setTextColor(V_R, V_G, V_B);
    this.doc.text(label, 12, this.y);
    this.doc.setFont('helvetica', 'normal'); this.doc.setFontSize(8);
    this.doc.setTextColor(30, 30, 30);
    this.doc.text(value, this.LABEL_COL, this.y, { maxWidth: this.useW - this.LABEL_COL + 12 });
    this.doc.setTextColor(0, 0, 0);
    this.y += this.LINE;
  }
}

// ─── HTML escape ──────────────────────────────────────────────────────────────
function e(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
