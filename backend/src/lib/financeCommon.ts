// Regras partilhadas pelas rotas de Financas, Relatorios e Preparacao para defesa (so M.E.T.A.).
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import prisma from './prisma';
import { FixedSalary } from './financeCalc';

export const ADMIN_ROLES = ['OWNER', 'ADMIN'];
export const DEFAULT_FIXED: FixedSalary[] = [
  { name: 'Director técnico', amount: 10000, startPeriod: '2025-10' },
  { name: 'Directora comercial', amount: 10000, startPeriod: '2026-01' },
  { name: 'Directora operacional', amount: 15000, startPeriod: '2026-11' },
  { name: 'Director de marketing', amount: 10000, startPeriod: '2026-11' },
];
export const DEFAULT_PHASES = ['Fundação Invisível', 'Engenharia da Pesquisa', 'Plano de Ataque', 'Base Científica', 'Análise e Discussão', 'Redacção Final', 'Defesa do TCC'];
export type Phase = { id: number; name: string };

export function phaseList(s: { studentPhases: any }): Phase[] {
  const l = s.studentPhases;
  return Array.isArray(l) && l.length ? (l as Phase[]) : DEFAULT_PHASES.map((name, i) => ({ id: i + 1, name }));
}
// "F2 · Nome" pela posicao actual; uma fase apagada continua a ter texto para as mensagens.
export function phaseLabel(list: Phase[], id: number | null) {
  if (!id) return 'Sem fase';
  const i = list.findIndex((p) => p.id === id);
  return i >= 0 ? `F${i + 1} · ${list[i].name}` : 'uma fase que já não existe';
}
export function phaseId(v: any): number | null {
  const f = v === '' || v === null || v === undefined ? null : Number(v);
  if (f !== null && !(Number.isInteger(f) && f >= 1)) throw new AppError('Fase inválida', 400);
  return f;
}

export async function getSettings(workspaceId: string) {
  return prisma.financeSettings.upsert({
    where: { workspaceId },
    create: { workspaceId, fixedSalaries: DEFAULT_FIXED as any },
    update: {},
  });
}

export async function assertPhase(workspaceId: string, id: number | null) {
  if (id === null) return;
  const list = phaseList(await getSettings(workspaceId));
  if (!list.some((p) => p.id === id)) throw new AppError('Essa fase já não existe. Actualiza a página.', 400);
}

export function isMetaName(name: string | null | undefined) {
  return (name || '').replace(/[^a-z0-9]/gi, '').toLowerCase() === 'meta';
}
// So existe no workspace M.E.T.A.
export async function metaOnly(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const ws = await prisma.workspace.findUnique({ where: { id: req.user!.workspaceId }, select: { name: true } });
    if (!isMetaName(ws?.name)) throw new AppError('Não encontrado', 404);
    next();
  } catch (e) { next(e); }
}

export const isAdmin = (req: AuthRequest) => ADMIN_ROLES.includes(req.user!.role);
export function adminOnly(req: AuthRequest, _res: Response, next: NextFunction) {
  if (!isAdmin(req)) return next(new AppError('Só o dono e administradores têm acesso a esta área.', 403));
  next();
}

export function parseDate(v: any, label = 'Data'): Date {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) throw new AppError(`${label} inválida`, 400);
  const d = new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
  if (isNaN(d.getTime())) throw new AppError(`${label} inválida`, 400);
  return d;
}
export const optDate = (v: any, label?: string) => (v === null || v === '' || v === undefined ? null : parseDate(v, label));
export const text = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function studentDto(s: any) {
  return { ...s, balance: s.totalValue - s.paidAmount };
}

// O associado ligado a esta conta (null se a conta nao for de um associado).
export async function myAssociateId(req: AuthRequest): Promise<string | null> {
  const a = await prisma.financeAssociate.findFirst({ where: { workspaceId: req.user!.workspaceId, userId: req.user!.id }, select: { id: true } });
  return a?.id || null;
}

// Admin ve todos; um associado so ve os seus estudantes.
export async function scopeStudents(req: AuthRequest): Promise<any> {
  const where: any = { workspaceId: req.user!.workspaceId };
  if (isAdmin(req)) return where;
  where.associateId = (await myAssociateId(req)) || '__nenhum__';
  return where;
}

// Estudante visivel para quem pede (404 se nao for).
export async function findScopedStudent(req: AuthRequest, id: string) {
  const st = await prisma.financeStudent.findFirst({ where: { ...(await scopeStudents(req)), id } });
  if (!st) throw new AppError('Estudante não encontrado', 404);
  return st;
}

// Dia de hoje em Maputo (UTC+2, sem hora de verao).
export function maputoNow() {
  const d = new Date(Date.now() + 2 * 3600000);
  return { day: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), date: d };
}
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Segunda-feira da semana do dia indicado.
export function weekStart(day: string) {
  const d = new Date(`${day}T00:00:00.000Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}
