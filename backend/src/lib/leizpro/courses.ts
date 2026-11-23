// Disciplinas do exame de admissao por curso, tiradas dos editais 2026
// (UEM, UPM, UniSave). Serve para a Sherone so mandar abrir o capitulo 1 de
// uma disciplina que sai no exame do estudante.
//
// Cada curso tem uma ou mais opcoes de exame (ex.: Filosofia na UEM pode ser
// Filosofia+Portugues, Matematica+Portugues ou Portugues+Historia). So entram
// disciplinas que a Zona Nerd tem (provas praticas, aptidao fisica, etc. ficam de fora).

import { norm } from './understand';
import { UPM_COURSES } from './coursesUpm';

type Course = { name: string; exam: string[][]; aliases?: string[] };
type University = { uni: string; match: RegExp; courses: Course[] };

const MQ = [['Matemática', 'Química']];
const MF = [['Matemática', 'Física']];
const BQ = [['Biologia', 'Química']];
const MP = [['Matemática', 'Português']];
const PH = [['Português', 'História']];
const PB = [['Português', 'Biologia']];
const PG = [['Português', 'Geografia']];
const PI = [['Português', 'Inglês']];
const HG = [['História', 'Geografia']];
const GM = [['Geografia', 'Matemática']];

const c = (exam: string[][], ...names: string[]): Course[] => names.map((name) => ({ name, exam }));

// ---- UEM (Edital UEM 2026, Tabela A1) ------------------------------------------
const UEM: University = {
  uni: 'UEM',
  match: /\b(uem|eduardo mondlane)\b/,
  courses: [
    ...c(MQ, 'Agro-economia e Extensão Agrária', 'Engenharia Agronómica', 'Engenharia Florestal', 'Geologia e Pesquisa Mineral',
      'Química Ambiental', 'Química Industrial', 'Geologia Marinha', 'Produção Agrícola', 'Agricultura Comercial'),
    { name: 'Arquitectura e Planeamento Físico', exam: [['Matemática']], aliases: ['arquitectura', 'arquitetura'] },
    ...c(BQ, 'Biologia Aplicada', 'Biologia e Saúde', 'Biologia Marinha, Aquática e Costeira', 'Ecologia e Conservação da Biodiversidade Terrestre',
      'Medicina', 'Medicina Veterinária', 'Ciência e Tecnologia de Alimentos', 'Ciência e Tecnologia Animal', 'Biologia Marinha',
      'Química Marinha', 'Produção Animal', 'Produção Pesqueira'),
    ...c(MF, 'Geociências de Petróleo e Gás', 'Geofísica Aplicada', 'Geologia Urbana e Ambiental', 'Hidrogeologia e Recursos Hídricos',
      'Matemática', 'Física', 'Meteorologia', 'Engenharia do Ambiente', 'Engenharia Civil', 'Engenharia Eléctrica', 'Engenharia Electrónica',
      'Engenharia Informática', 'Engenharia Mecânica', 'Engenharia Química', 'Engenharia de Petróleo e Gás Natural',
      'Engenharia de Telecomunicações', 'Engenharia e Gestão Industrial', 'Oceanografia', 'Agro-processamento', 'Engenharia Rural'),
    ...c([['Matemática', 'Português'], ['Matemática', 'Física']], 'Ciências de Informação Geográfica', 'Estatística', 'Informática'),
    ...c(PH, 'Direito', 'Língua de Sinais de Moçambique', 'Organização e Gestão da Educação', 'Administração Pública', 'Ciência Política',
      'Ensino de Português', 'História', 'Linguística', 'Literatura Moçambicana', 'Sociologia', 'Antropologia', 'Jornalismo',
      'Marketing e Relações Públicas'),
    ...c(MP, 'Economia', 'Gestão', 'Contabilidade e Finanças', 'Comunicação e Extensão Rural', 'Gestão Hoteleira', 'Finanças',
      'Gestão de Empresas', 'Gestão Comercial', 'Agro-Negócios'),
    ...c(PB, 'Desenvolvimento e Educação de Infância', 'Psicologia das Organizações',
      'Psicologia Escolar e das Necessidades Educativas Especiais', 'Ciências do Desporto'),
    { name: 'Educação Ambiental', exam: [['Português', 'Biologia'], ['Português', 'Geografia'], ['Biologia', 'Geografia']] },
    ...c([['Filosofia', 'Português'], ['Matemática', 'Português'], ['Português', 'História']], 'Filosofia', 'Ensino de Filosofia'),
    ...c(HG, 'Arqueologia e Gestão do Património Cultural', 'Geografia'),
    ...c([['Francês', 'Português']], 'Ensino de Francês', 'Tradução Português/Francês'),
    ...c(PI, 'Ensino de Inglês', 'Tradução Português/Inglês', 'Língua, Cultura e Literatura Chinesa'),
    { name: 'Ensino de Línguas Bantu', exam: [['Português']] },
    ...c([['Português', 'História'], ['Matemática', 'Português']], 'Arquivística', 'Biblioteconomia'),
    ...c(PG, 'Animação Turística', 'Informação Turística'),
    { name: 'Ecoturismo e Conservação da Natureza', exam: [['Português', 'Geografia'], ['Português', 'Biologia'], ['Matemática', 'Português']] },
  ],
};

// ---- UniSave (Edital UniSave 2026, Tabela 1; so cursos com exame) --------------
const UNISAVE: University = {
  uni: 'UniSave',
  match: /\b(unisave|uni save|universidade save|save)\b/,
  courses: [
    ...c(MP, 'Ciências de Educação', 'Educação e Gestão de Instituições de Infância', 'Gestão Aduaneira', 'Economia', 'Gestão de Empresas'),
    ...c(PI, 'Inglês Aplicado ao Turismo'),
    ...c(BQ, 'Zootecnia', 'Produção Agrícola', 'Ciência e Tecnologia de Alimentos'),
    ...c(MQ, 'Química'),
    ...c(MF, 'Oceanografia Física', 'Ciências da Computação'),
    ...c(GM, 'Ciência e Tecnologia do Ambiente'),
    { name: 'Educação Física e Desporto', exam: [['Biologia']] },
    ...c(PG, 'Gestão de Riscos e Desastres Ambientais'),
  ],
};

// UPM: gerado a partir do edital UPM 2026 (coursesUpm.ts).
const UPM: University = { uni: 'UPM', match: /\b(upm|up|pedagogica)\b/, courses: UPM_COURSES };

const UNIS = [UEM, UPM, UNISAVE];

function courseMatches(course: Course, text: string): number {
  const names = [course.name, ...(course.aliases || [])].map(norm);
  let best = 0;
  for (const n of names) {
    const bare = n.replace(/^(licenciatura em|curso de) /, '');
    if (text === bare) best = Math.max(best, 1000);
    else if (bare.length >= 5 && text.includes(bare)) best = Math.max(best, bare.length);
    else if (text.length >= 5 && bare.startsWith(text)) best = Math.max(best, text.length - 1);
  }
  return best;
}

// Disciplinas do exame (opcoes) para a universidade e curso do estudante, ou
// null se nao sabemos (universidade fora dos editais, curso ambiguo, etc.).
export function examOptions(university: string | null, course: string | null): string[][] | null {
  if (!course) return null;
  const text = norm(course).replace(/^(licenciatura em|curso de) /, '').trim();
  const u = university ? norm(university) : '';
  const unis = UNIS.filter((x) => x.match.test(u));
  // Universidade conhecida mas fora dos editais (UniRovuma, ISCAM...): nao usar
  // os editais das outras; contam as disciplinas que o estudante disse.
  const pool = unis.length ? unis : u ? [] : UNIS;
  let best = 0;
  let hits: Course[] = [];
  for (const un of pool) {
    for (const co of un.courses) {
      const s = courseMatches(co, text);
      if (s > best) { best = s; hits = [co]; } else if (s && s === best) hits.push(co);
    }
  }
  if (!hits.length) return null;
  // Varios cursos com o mesmo nome: so serve se o exame for igual.
  const key = (e: string[][]) => JSON.stringify(e.map((o) => [...o].sort()).sort());
  if (new Set(hits.map((h) => key(h.exam))).size > 1) return null;
  return hits[0].exam;
}

// Todas as disciplinas que podem sair no exame dele (uniao das opcoes).
export function examSubjects(university: string | null, course: string | null): string[] | null {
  const opts = examOptions(university, course);
  if (!opts) return null;
  return [...new Set(opts.flat())];
}

// Curso dos editais mencionado numa mensagem (o primeiro, se forem varios).
export function findCourseIn(university: string | null, text: string): string | null {
  const t = ` ${norm(text).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `;
  const u = university ? norm(university) : '';
  const unis = UNIS.filter((x) => x.match.test(u));
  let best: { name: string; at: number; len: number } | null = null;
  for (const un of unis.length ? unis : UNIS) {
    for (const co of un.courses) {
      for (const n of [co.name, ...(co.aliases || [])]) {
        const k = ` ${norm(n).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
        if (k.trim().length < 5) continue;
        const at = t.indexOf(k);
        if (at < 0) continue;
        if (!best || at < best.at || (at === best.at && k.length > best.len)) best = { name: co.name, at, len: k.length };
      }
    }
  }
  return best?.name || null;
}
