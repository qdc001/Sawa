// Conhecimento de venda especifico por sector de actividade. Chaves alinhadas
// com sectorTemplates.ts. Tudo PT-MZ, focado em contexto mocambicano.
// A IA Vendedora consulta este ficheiro alem dos principios universais para
// adaptar vocabulario, antecipar objeccoes e fechar com tacticas adequadas.

export type SectorKey = 'imobiliaria' | 'clinica' | 'escola' | 'consultoria' | 'outro';

export type SectorKnowledge = {
  label: string;
  // Objeccoes mais comuns que surgem neste sector, com sugestao de resposta.
  objections: { objection: string; response: string }[];
  // Perguntas SPIN adaptadas ao sector. Comecam por descobrir contexto e
  // amadurecem ate ao valor de resolver.
  discoveryQuestions: string[];
  // Taticas de fecho tipicas, escolhidas pela maturidade do sector.
  closingTactics: string[];
  // Vocabulario a usar e a evitar (jargao, termos com peso, palavras a banir).
  vocabulary: { use: string[]; avoid: string[] };
  // Pistas de prova social que costumam funcionar (tipos de cliente a
  // referenciar, formatos de exemplo).
  socialProofHints: string[];
};

export const SECTOR_KNOWLEDGE: Record<SectorKey, SectorKnowledge> = {
  imobiliaria: {
    label: 'Imobiliaria',
    objections: [
      {
        objection: 'O preco esta acima do que eu pensava',
        response: 'Compreendo. Que valor tinha em mente, e o que estaria disposto a abdicar para chegar la? Quase sempre conseguimos arranjar uma alternativa proxima do orcamento se afinarmos juntos.',
      },
      {
        objection: 'Preciso de pensar com a familia',
        response: 'Faz todo o sentido, decisao desta dimensao nao se toma sozinho. Quando acha que conseguem alinhar? Posso reservar o imovel ate la?',
      },
      {
        objection: 'Ainda nao tenho a entrada toda',
        response: 'E uma preocupacao real, ja ajudamos muita gente nessa fase. Quer que veja consigo opcoes de financiamento ou alternativas com entrada mais baixa?',
      },
      {
        objection: 'Quero visitar mais alguns antes de decidir',
        response: 'E o mais prudente. Posso ajudar com uma lista curta de tres ou quatro com o seu perfil, para nao perder tempo? Costuma reduzir muito a indecisao.',
      },
      {
        objection: 'O bairro nao me convence totalmente',
        response: 'O que especificamente nao convence? Acessos, ruido, seguranca, escolas? Conhecemos bem as zonas e posso ajudar a perceber se essa preocupacao se justifica ou se ha alternativas a poucas ruas.',
      },
    ],
    discoveryQuestions: [
      'Esta a procura para si, para investir, ou para arrendar?',
      'Que zona e a sua preferida e porque?',
      'Quantos quartos precisa mesmo, e ha algum sem o qual nao avanca?',
      'Ja tem aprovacao bancaria ou estamos ainda na fase de explorar?',
      'Para quando precisa de estar instalado?',
      'O que e essencial e o que e luxo bom de ter?',
    ],
    closingTactics: [
      'Reservar com sinal pequeno para travar a hesitacao sem comprometer.',
      'Marcar visita rapida em horario que mostre a luz natural do imovel.',
      'Comparar dois imoveis lado a lado para clarear a preferencia.',
      'Mencionar prazo real de outra proposta em curso, quando existe.',
    ],
    vocabulary: {
      use: ['casa', 'lar', 'familia', 'investimento', 'patrimonio', 'localizacao', 'tranquilidade'],
      avoid: ['unidade habitacional', 'activo subjacente', 'codigo de imovel'],
    },
    socialProofHints: [
      'Outras familias com filhos pequenos que escolheram a mesma zona.',
      'Investidores que compraram ha dois anos e ja valorizaram X%.',
      'Casais jovens que entraram com financiamento parecido ao que esta a considerar.',
    ],
  },

  clinica: {
    label: 'Clinica',
    objections: [
      {
        objection: 'Esta caro para o que oferece',
        response: 'Compreendo. Posso explicar o que esta incluido e porque escolhemos esta abordagem? Muitas vezes o que parece caro a primeira vista poupa varias consultas a seguir.',
      },
      {
        objection: 'Vou ver com o meu seguro de saude',
        response: 'Boa ideia. Com que seguradora trabalha? Podemos confirmar imediatamente os codigos cobertos e poupar-lhe o telefonema.',
      },
      {
        objection: 'Tenho receio do tratamento',
        response: 'E natural. Conte-me o que mais o preocupa, talvez possamos esclarecer ja agora. A maior parte dos receios prende-se com coisas que nao acontecem assim.',
      },
      {
        objection: 'Preciso de pensar e depois decido',
        response: 'Com certeza. Posso reservar a vaga ate amanha sem compromisso, para nao perder a janela que combinamos? Caso decida nao avancar, basta avisar.',
      },
      {
        objection: 'Nao sei se e mesmo necessario',
        response: 'Pergunta justa. O que sente que ja melhorou sozinho, e o que tem persistido? E isso que vai dizer se vale a pena ou nao.',
      },
    ],
    discoveryQuestions: [
      'Ha quanto tempo tem este desconforto?',
      'Ja tentou algum tratamento antes? O que resultou e o que nao resultou?',
      'O que e que isto o impede de fazer no dia a dia?',
      'Como esta a afectar o sono ou o trabalho?',
      'Tem seguro de saude ou prefere particular?',
      'Esta com pressa por algum motivo especifico?',
    ],
    closingTactics: [
      'Oferecer primeira consulta de avaliacao sem grande compromisso.',
      'Reservar imediatamente uma vaga concreta no calendario.',
      'Lembrar do impacto de adiar (sintoma cronico, complicacao, custo futuro).',
      'Confirmar cobertura de seguro na conversa para reduzir atrito.',
    ],
    vocabulary: {
      use: ['bem estar', 'cuidado', 'tranquilidade', 'qualidade de vida', 'experiencia clinica', 'acolhimento'],
      avoid: ['codigo de paciente', 'caso clinico', 'procedimento'],
    },
    socialProofHints: [
      'Outros pacientes com o mesmo perfil que recuperaram em poucas semanas.',
      'Casos com o mesmo seguro de saude que ja tratamos sem dificuldade administrativa.',
      'Pais que ja confiaram nos seus filhos ao mesmo medico ou equipa.',
    ],
  },

  escola: {
    label: 'Escola e Formacao',
    objections: [
      {
        objection: 'O valor da propina e elevado',
        response: 'Compreendo. Posso mostrar-lhe em que e que essa propina se transforma ao longo do ano: numero de horas, materiais, acompanhamento individual? E ha sempre forma de combinarmos pagamento faseado.',
      },
      {
        objection: 'Ainda nao sei se este e o caminho certo para o meu filho',
        response: 'E uma decisao muito importante. Pode partilhar comigo o que ele gosta de fazer, e o que o preocupa? Costumamos ajudar a clarificar isso na conversa de orientacao.',
      },
      {
        objection: 'Tenho outras escolas em mente para comparar',
        response: 'Optimo, comparar e importante. Que criterios sao os tres mais importantes para si? Posso responder a esses com factos concretos.',
      },
      {
        objection: 'Estou a espera dos resultados do exame para decidir',
        response: 'Faz sentido. Mesmo assim, podemos reservar lugar condicionalmente. Costuma haver muita procura na ultima semana e ficar sem vaga e o pior que pode acontecer agora.',
      },
      {
        objection: 'O curso e muito teorico',
        response: 'Boa observacao. Posso mostrar-lhe os estagios, projectos praticos e parcerias que temos com empresas? E ai que o nosso modelo se distingue.',
      },
    ],
    discoveryQuestions: [
      'O que e que o seu filho gosta mesmo de fazer?',
      'Que ambiente acha que vai ajuda-lo a crescer melhor?',
      'O que e que o trouxe ate nos especificamente?',
      'O que e nao negociavel para si na escolha da escola?',
      'Estao com prazo apertado para a inscricao?',
      'Falaram ja com outros pais da escola?',
    ],
    closingTactics: [
      'Reservar vaga com sinal simbolico ate uma data acordada.',
      'Convidar para uma aula aberta ou visita guiada antes de fechar.',
      'Lembrar prazos de candidatura para evitar perder vaga.',
      'Oferecer reuniao com o director ou coordenador pedagogico.',
    ],
    vocabulary: {
      use: ['futuro', 'crescimento', 'oportunidade', 'acompanhamento', 'comunidade', 'preparacao'],
      avoid: ['cliente (preferir familia)', 'mercado educativo', 'produto educativo'],
    },
    socialProofHints: [
      'Alunos com perfil parecido que entraram em universidades de referencia.',
      'Familias da mesma comunidade ou bairro que ja confiaram na escola.',
      'Resultados nas provas nacionais ou exames internacionais.',
    ],
  },

  consultoria: {
    label: 'Consultoria',
    objections: [
      {
        objection: 'Ja tive consultores antes e nao funcionou',
        response: 'Faz todo o sentido essa reserva. Conte-me o que correu mal, para nao repetirmos. Costumo abordar isso logo no contrato.',
      },
      {
        objection: 'Preciso de justificar a despesa internamente',
        response: 'Compreendo. Posso preparar um resumo de uma pagina com numeros que ajude na conversa interna? Costuma desbloquear este tipo de aprovacao.',
      },
      {
        objection: 'Os vossos prazos sao optimistas demais',
        response: 'E uma observacao justa. Prefere que eu reveja com folga, ou que mostremos o que pode ser entregue na primeira fase para validar o ritmo?',
      },
      {
        objection: 'Nao vejo bem o que entregam concretamente',
        response: 'Boa critica, e a mais comum no nosso sector. Posso enviar exemplos reais de entregaveis de projectos anteriores para clarificar?',
      },
      {
        objection: 'Conseguimos fazer internamente',
        response: 'Provavelmente sim, a pergunta e a que custo de tempo da equipa. O que voces estao dispostos a deixar de fazer para fazerem isto?',
      },
    ],
    discoveryQuestions: [
      'O que ja tentaram resolver por dentro antes de procurar fora?',
      'Quem na vossa equipa esta directamente afectado por isto?',
      'Qual e o impacto se isto nao for resolvido este ano?',
      'Quem decide e quem influencia esta decisao?',
      'Que orcamento tem disponivel para esta fase?',
      'Como vai medir se foi um bom investimento daqui a seis meses?',
    ],
    closingTactics: [
      'Propor diagnostico curto pago como porta de entrada (baixo risco).',
      'Estruturar o trabalho em fases com saidas de emergencia entre fases.',
      'Trazer entregavel ja meio feito para a reuniao de fecho.',
      'Oferecer call com cliente referencial do mesmo sector.',
    ],
    vocabulary: {
      use: ['parceria', 'co construcao', 'retorno', 'estrategia', 'execucao', 'metricas'],
      avoid: ['recurso humano', 'fee', 'time and materials'],
    },
    socialProofHints: [
      'Outras empresas do mesmo sector ou tamanho que ja passaram pela mesma fase.',
      'Resultados concretos de outros projectos (com numeros e datas).',
      'Testemunhos de directores ou CEOs em areas comparaveis.',
    ],
  },

  outro: {
    label: 'Generico',
    objections: [
      {
        objection: 'Esta caro',
        response: 'Compreendo. Comparado com o que? Ajude-me a perceber a referencia e talvez consigamos chegar a algo que faca sentido para ambos.',
      },
      {
        objection: 'Vou pensar e depois digo',
        response: 'Claro. Em que e que precisa de pensar especificamente? Talvez possa esclarecer ja aqui e poupar-lhe esse trabalho.',
      },
      {
        objection: 'Nao estou convencido',
        response: 'Justo. O que falta para sentir confianca? Sobre isso e que devemos falar agora.',
      },
      {
        objection: 'Falo consigo mais tarde',
        response: 'Sem problema. Quer que volte a procura-lo na segunda, ou prefere fechar agora um momento concreto?',
      },
    ],
    discoveryQuestions: [
      'O que o trouxe a falar comigo hoje?',
      'O que tem tentado resolver e nao consegue?',
      'O que mudaria se isto ficasse resolvido?',
      'Ja tentou outras solucoes?',
      'Que prazo tem em mente?',
      'Quem mais esta envolvido nesta decisao?',
    ],
    closingTactics: [
      'Pequeno compromisso primeiro (chamada, demo, amostra) antes do grande.',
      'Resumo claro do problema com os tres pontos chave dele.',
      'Proposta com tres niveis para o lead escolher.',
      'Prazo concreto e proximo passo agendado em calendario.',
    ],
    vocabulary: {
      use: ['solucao', 'parceria', 'resultado', 'simples', 'rapido', 'concreto'],
      avoid: ['barato', 'oferta unica', 'milagre'],
    },
    socialProofHints: [
      'Outros clientes parecidos que ja passaram pela mesma duvida.',
      'Resultados concretos em prazos comparaveis.',
      'Testemunhos curtos com nome e profissao.',
    ],
  },
};

export function getSectorKnowledge(sector: string): SectorKnowledge {
  const k = sector as SectorKey;
  return SECTOR_KNOWLEDGE[k] || SECTOR_KNOWLEDGE.outro;
}

export function listSectorKeys(): SectorKey[] {
  return Object.keys(SECTOR_KNOWLEDGE) as SectorKey[];
}
