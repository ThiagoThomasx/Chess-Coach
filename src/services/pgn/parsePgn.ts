import { Chess } from 'chess.js';
import type { Color, Game, GameHeaders } from '../../types/domain';
import { START_FEN } from '../chess/position';
import { hashString, newId } from '../../utils/hash';

export interface ParsedGame {
  game: Omit<Game, 'importId' | 'importedAt'>;
}

export interface ParseFailure {
  index: number;
  reason: string;
  snippet: string;
}

export interface ParseResult {
  games: ParsedGame['game'][];
  failures: ParseFailure[];
  totalFound: number;
}

export const MAX_PGN_BYTES = 20 * 1024 * 1024;

/** Splits a PGN file containing one or more games into per-game chunks. */
export function splitPgn(text: string): string[] {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let seenMoves = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const isHeader = /^\[\s*\w+\s+".*"\s*\]$/.test(trimmed);
    if (isHeader && seenMoves) {
      chunks.push(current.join('\n'));
      current = [];
      seenMoves = false;
    }
    if (!isHeader && trimmed !== '' && !trimmed.startsWith('%')) seenMoves = true;
    current.push(line);
  }
  if (current.some((l) => l.trim() !== '')) chunks.push(current.join('\n'));
  return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
}

function toInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function clean(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === '' || t === '?' || t === '????.??.??' ? undefined : t;
}

export function buildHeaders(raw: Record<string, string>): GameHeaders {
  const h: GameHeaders = {
    white: clean(raw.White) ?? 'Desconhecido',
    black: clean(raw.Black) ?? 'Desconhecido',
    result: clean(raw.Result) ?? '*',
  };
  const opt: [keyof GameHeaders, string | undefined][] = [
    ['date', clean(raw.Date ?? raw.UTCDate)],
    ['event', clean(raw.Event)],
    ['site', clean(raw.Site)],
    ['timeControl', clean(raw.TimeControl)],
    ['eco', clean(raw.ECO)],
    ['opening', clean(raw.Opening)],
  ];
  for (const [k, v] of opt) if (v) (h as unknown as Record<string, string>)[k] = v;
  const we = toInt(raw.WhiteElo);
  const be = toInt(raw.BlackElo);
  if (we) h.whiteElo = we;
  if (be) h.blackElo = be;
  return h;
}

export function detectUserColor(h: GameHeaders, playerNames: readonly string[]): Color | undefined {
  const names = playerNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (names.length === 0) return undefined;
  const w = names.includes(h.white.toLowerCase());
  const b = names.includes(h.black.toLowerCase());
  if (w && !b) return 'w';
  if (b && !w) return 'b';
  return undefined;
}

export function gameHash(h: GameHeaders, startFen: string, moves: readonly string[]): string {
  return hashString([h.white, h.black, h.date ?? '', h.result, startFen, moves.join(' ')].join('|'));
}

/** Parses a single PGN chunk. Throws with a user-facing message on failure. */
export function parseSingleGame(chunk: string, playerNames: readonly string[] = []): ParsedGame['game'] {
  const chess = new Chess();
  try {
    chess.loadPgn(chunk, { strict: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`PGN ilegível: ${msg.slice(0, 160)}`);
  }
  const moves = chess.history();
  const rawHeaders = Object.fromEntries(Object.entries(chess.getHeaders()).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  const startFen = rawHeaders.FEN && rawHeaders.SetUp !== '0' ? rawHeaders.FEN : START_FEN;
  const headers = buildHeaders(rawHeaders);
  const warnings: string[] = [];
  if (moves.length === 0) throw new Error('Nenhum lance encontrado');
  if (headers.white === 'Desconhecido' || headers.black === 'Desconhecido') warnings.push('Nomes dos jogadores ausentes');
  if (!headers.date) warnings.push('Data ausente');
  if (headers.result === '*') warnings.push('Resultado não informado');
  const userColor = detectUserColor(headers, playerNames);
  return {
    id: newId(),
    hash: gameHash(headers, startFen, moves),
    headers,
    rawHeaders,
    startFen,
    moves,
    pgn: chunk,
    ...(userColor ? { userColor } : {}),
    warnings,
  };
}

export function parsePgnText(text: string, playerNames: readonly string[] = []): ParseResult {
  if (text.trim() === '') return { games: [], failures: [{ index: 0, reason: 'Arquivo vazio', snippet: '' }], totalFound: 0 };
  const chunks = splitPgn(text);
  const games: ParsedGame['game'][] = [];
  const failures: ParseFailure[] = [];
  chunks.forEach((chunk, index) => {
    try {
      games.push(parseSingleGame(chunk, playerNames));
    } catch (e) {
      failures.push({ index, reason: e instanceof Error ? e.message : String(e), snippet: chunk.slice(0, 120) });
    }
  });
  return { games, failures, totalFound: chunks.length };
}
