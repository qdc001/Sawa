import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import prisma from '../lib/prisma';
const router = Router();

type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT' | 'MULTISELECT' | 'URL' | 'EMAIL' | 'PHONE';
interface FieldDef { name: string; type: FieldType; options?: string[]; entity?: 'lead' | 'contact' }
interface StageDef { name: string; color: string; type?: 'REGULAR' | 'WON' | 'LOST' }
interface Sector {
  label: string;
  description: string;
  pipeline: { name: string; color: string; stages: StageDef[] };
  fields: FieldDef[];
  tags: { name: string; color: string }[];
}

const SECTORS: Record<string, Sector> = {
  imobiliaria: {
    label: 'Imobiliária',
    description: 'Funil de interessados, da primeira chamada à escritura, com campos de imóvel e visita.',
    pipeline: {
      name: 'Imobiliária', color: '#C8553D',
      stages: [
        { name: 'Novo interessado', color: '#6B7280' },
        { name: 'Qualificação', color: '#3B82F6' },
        { name: 'Visita agendada', color: '#E58F65' },
        { name: 'Proposta', color: '#8B5CF6' },
        { name: 'Negociação', color: '#F59E0B' },
        { name: 'Fechado', color: '#10B981', type: 'WON' },
        { name: 'Perdido', color: '#EF4444', type: 'LOST' },
      ],
    },
    fields: [
      { name: 'Tipo de imóvel', type: 'SELECT', options: ['Apartamento', 'Moradia', 'Terreno', 'Comercial', 'Escritório'] },
      { name: 'Finalidade', type: 'SELECT', options: ['Comprar', 'Arrendar'] },
      { name: 'Tipologia', type: 'SELECT', options: ['T0', 'T1', 'T2', 'T3', 'T4+'] },
      { name: 'Orçamento', type: 'NUMBER' },
      { name: 'Zona', type: 'TEXT' },
      { name: 'Data de visita', type: 'DATE' },
    ],
    tags: [
      { name: 'Comprador', color: '#3B82F6' },
      { name: 'Vendedor', color: '#10B981' },
      { name: 'Investidor', color: '#8B5CF6' },
      { name: 'Urgente', color: '#EF4444' },
    ],
  },
  clinica: {
    label: 'Clínica',
    description: 'Da primeira chamada à consulta concluída, com especialidade, data e tipo de seguro.',
    pipeline: {
      name: 'Clínica', color: '#2D4A3E',
      stages: [
        { name: 'Novo contacto', color: '#6B7280' },
        { name: 'Triagem', color: '#3B82F6' },
        { name: 'Consulta marcada', color: '#E58F65' },
        { name: 'Em tratamento', color: '#F59E0B' },
        { name: 'Concluído', color: '#10B981', type: 'WON' },
        { name: 'Cancelado', color: '#EF4444', type: 'LOST' },
      ],
    },
    fields: [
      { name: 'Especialidade', type: 'SELECT', options: ['Geral', 'Dentária', 'Dermatologia', 'Fisioterapia', 'Pediatria', 'Outra'] },
      { name: 'Data da consulta', type: 'DATE' },
      { name: 'Tipo de seguro', type: 'TEXT' },
      { name: 'Motivo', type: 'TEXT' },
    ],
    tags: [
      { name: 'Primeira consulta', color: '#3B82F6' },
      { name: 'Retorno', color: '#10B981' },
      { name: 'Urgência', color: '#EF4444' },
      { name: 'Seguro', color: '#8B5CF6' },
    ],
  },
  escola: {
    label: 'Escola / Formação',
    description: 'Funil de matrículas, do interesse à inscrição, com curso, encarregado e período.',
    pipeline: {
      name: 'Matrículas', color: '#8B5CF6',
      stages: [
        { name: 'Interessado', color: '#6B7280' },
        { name: 'Visita / Informação', color: '#3B82F6' },
        { name: 'Inscrição', color: '#E58F65' },
        { name: 'Documentação', color: '#F59E0B' },
        { name: 'Matriculado', color: '#10B981', type: 'WON' },
        { name: 'Desistiu', color: '#EF4444', type: 'LOST' },
      ],
    },
    fields: [
      { name: 'Curso ou ano', type: 'TEXT' },
      { name: 'Nome do encarregado', type: 'TEXT' },
      { name: 'Contacto do encarregado', type: 'PHONE' },
      { name: 'Idade do aluno', type: 'NUMBER' },
      { name: 'Período', type: 'SELECT', options: ['Manhã', 'Tarde', 'Noite'] },
    ],
    tags: [
      { name: 'Bolsa', color: '#10B981' },
      { name: 'Transferência', color: '#3B82F6' },
      { name: 'Renovação', color: '#8B5CF6' },
    ],
  },
  consultoria: {
    label: 'Consultoria',
    description: 'Do lead ao contrato, com área de serviço, valor estimado e tipo de relação.',
    pipeline: {
      name: 'Consultoria', color: '#1A2E25',
      stages: [
        { name: 'Lead', color: '#6B7280' },
        { name: 'Diagnóstico', color: '#3B82F6' },
        { name: 'Proposta enviada', color: '#E58F65' },
        { name: 'Negociação', color: '#F59E0B' },
        { name: 'Adjudicado', color: '#10B981', type: 'WON' },
        { name: 'Não avançou', color: '#EF4444', type: 'LOST' },
      ],
    },
    fields: [
      { name: 'Área de serviço', type: 'SELECT', options: ['Fiscal', 'Jurídica', 'Recursos Humanos', 'TI', 'Gestão', 'Marketing'] },
      { name: 'Valor estimado', type: 'NUMBER' },
      { name: 'Tipo de relação', type: 'SELECT', options: ['Avença', 'Projecto'] },
      { name: 'Prazo', type: 'DATE' },
    ],
    tags: [
      { name: 'Recorrente', color: '#10B981' },
      { name: 'Pontual', color: '#3B82F6' },
      { name: 'Referência', color: '#8B5CF6' },
    ],
  },
};

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remover acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

// GET /api/sector-templates — catálogo. Em modo clinical mostra so clinica;
// em modo legacy mostra todos os sectores (imobiliaria, escola, etc).
const ALLOWED_SECTORS = new Set(['clinica']);

router.get('/', async (req: AuthRequest, res: Response) => {
  const { isLegacyWorkspace } = await import('../lib/legacyWorkspaces');
  const isLegacy = await isLegacyWorkspace(req.user!.workspaceId);
  const list = Object.entries(SECTORS)
    .filter(([key]) => isLegacy || ALLOWED_SECTORS.has(key))
    .map(([key, s]) => ({
      key,
      label: s.label,
      description: s.description,
      pipeline: s.pipeline.name,
      stages: s.pipeline.stages.map((st) => st.name),
      fields: s.fields.map((f) => f.name),
      tags: s.tags.map((t) => t.name),
    }));
  res.json(list);
});

// POST /api/sector-templates/:key/apply — provisiona o modelo no workspace
router.post('/:key/apply', async (req: AuthRequest, res: Response, next) => {
  try {
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(req.user!.role)) {
      throw new AppError('Sem permissão para aplicar modelos', 403);
    }
    const { isLegacyWorkspace } = await import('../lib/legacyWorkspaces');
    const isLegacy = await isLegacyWorkspace(req.user!.workspaceId);
    if (!isLegacy && !ALLOWED_SECTORS.has(req.params.key)) throw new AppError('Modelo de sector nao disponivel', 404);
    const sector = SECTORS[req.params.key];
    if (!sector) throw new AppError('Modelo de sector desconhecido', 404);
    const wsId = req.user!.workspaceId;
    const result = { pipeline: '', stages: 0, fields: 0, tags: 0, skipped: [] as string[] };

    // Pipeline (não duplicar se já existir com o mesmo nome)
    const existingPipe = await prisma.pipeline.findFirst({ where: { workspaceId: wsId, name: sector.pipeline.name } });
    if (existingPipe) {
      result.skipped.push(`pipeline "${sector.pipeline.name}" já existia`);
    } else {
      const pcount = await prisma.pipeline.count({ where: { workspaceId: wsId } });
      const pipe = await prisma.pipeline.create({
        data: {
          name: sector.pipeline.name,
          color: sector.pipeline.color,
          position: pcount,
          isDefault: false,
          workspaceId: wsId,
          createdById: req.user!.id,
          stages: {
            create: sector.pipeline.stages.map((st, i) => ({
              name: st.name, color: st.color, position: i, type: (st.type || 'REGULAR') as any,
            })),
          },
        },
      });
      result.pipeline = pipe.name;
      result.stages = sector.pipeline.stages.length;
    }

    // Campos personalizados (saltar os que já existem)
    let fpos = await prisma.customField.count({ where: { workspaceId: wsId, entity: 'lead' } });
    for (const f of sector.fields) {
      const entity = f.entity || 'lead';
      const key = slugify(f.name) || `campo_${Date.now()}`;
      try {
        await prisma.customField.create({
          data: { name: f.name, key, type: f.type as any, entity, options: f.options || [], position: fpos++, workspaceId: wsId },
        });
        result.fields++;
      } catch (e: any) {
        if (e.code === 'P2002') result.skipped.push(`campo "${f.name}" já existia`);
        else throw e;
      }
    }

    // Etiquetas (saltar as que já existem)
    for (const t of sector.tags) {
      try {
        await prisma.tag.create({ data: { name: t.name, color: t.color, workspaceId: wsId } });
        result.tags++;
      } catch (e: any) {
        if (e.code === 'P2002') result.skipped.push(`etiqueta "${t.name}" já existia`);
        else throw e;
      }
    }

    // Grava o sector escolhido no Workspace para a IA Vendedora poder
    // adaptar vocabulario, objeccoes e tacticas de fecho.
    try {
      await prisma.workspace.update({
        where: { id: wsId },
        data: { sector: req.params.key },
      });
    } catch { /* nao bloquear a aplicacao do template */ }

    res.json({ message: `Modelo "${sector.label}" aplicado.`, ...result });
  } catch (e) { next(e); }
});

export default router;
