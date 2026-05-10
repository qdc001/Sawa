/**
 * Templates pré-feitos de chatbots. O utilizador escolhe um e cria um flow já configurado.
 */

interface ChatbotTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  trigger: string;
  triggerValue?: string;
  nodes: any[];
  edges: any[];
}

export const CHATBOT_TEMPLATES: ChatbotTemplate[] = [
  // ─── 1. Qualificação básica de leads ───
  {
    id: 'lead_qualification',
    name: 'Qualificação de leads',
    description: 'Pergunta nome e empresa, cria lead automaticamente.',
    icon: '🎯',
    trigger: 'first_message',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 250, y: 30 }, data: { label: 'Primeira mensagem' } },
      { id: 'm1', type: 'message', position: { x: 250, y: 150 }, data: { text: 'Olá! 👋 Bem-vindo. Para te ajudar melhor, qual é o teu nome?', waitForReply: true, saveAs: 'nome' } },
      { id: 'm2', type: 'message', position: { x: 250, y: 280 }, data: { text: 'Prazer em conhecer-te, {{vars.nome}}! Em que empresa trabalhas?', waitForReply: true, saveAs: 'empresa' } },
      { id: 'm3', type: 'message', position: { x: 250, y: 410 }, data: { text: 'Excelente! Como podemos ajudar a {{vars.empresa}}? Descreve em poucas palavras.', waitForReply: true, saveAs: 'pedido' } },
      { id: 'a1', type: 'action', position: { x: 250, y: 540 }, data: { actionType: 'create_lead', actionParams: { title: 'Lead via chatbot - {{vars.empresa}}', source: 'WhatsApp Chatbot' } } },
      { id: 'a2', type: 'action', position: { x: 250, y: 660 }, data: { actionType: 'create_task', actionParams: { title: 'Contactar {{vars.nome}} ({{vars.empresa}})', description: 'Pedido: {{vars.pedido}}', dueInHours: 24 } } },
      { id: 'm4', type: 'message', position: { x: 250, y: 790 }, data: { text: 'Obrigado, {{vars.nome}}! Um colega vai entrar em contacto contigo nas próximas 24h.' } },
      { id: 'e1', type: 'end', position: { x: 250, y: 920 }, data: {} },
    ],
    edges: [
      { id: 'e-t1-m1', source: 't1', target: 'm1', animated: true },
      { id: 'e-m1-m2', source: 'm1', target: 'm2' },
      { id: 'e-m2-m3', source: 'm2', target: 'm3' },
      { id: 'e-m3-a1', source: 'm3', target: 'a1' },
      { id: 'e-a1-a2', source: 'a1', target: 'a2' },
      { id: 'e-a2-m4', source: 'a2', target: 'm4' },
      { id: 'e-m4-e1', source: 'm4', target: 'e1' },
    ],
  },

  // ─── 2. FAQ com botões ───
  {
    id: 'faq_buttons',
    name: 'FAQ com menu',
    description: 'Mostra menu de perguntas frequentes com botões.',
    icon: '❓',
    trigger: 'keyword',
    triggerValue: 'ajuda',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 250, y: 30 }, data: { label: 'Palavra "ajuda"' } },
      { id: 'b1', type: 'buttons', position: { x: 250, y: 150 }, data: {
        text: 'Como posso ajudar? Escolhe uma opção:',
        buttons: [
          { id: 'precos', label: 'Preços' },
          { id: 'horario', label: 'Horário' },
          { id: 'humano', label: 'Falar com humano' },
        ],
        saveAs: 'opcao',
      } },
      { id: 's1', type: 'switch', position: { x: 250, y: 320 }, data: {
        target: 'opcao',
        cases: [
          { value: 'precos', handle: 'precos' },
          { value: 'horario', handle: 'horario' },
          { value: 'humano', handle: 'humano' },
        ],
        default: 'precos',
      } },
      { id: 'mp', type: 'message', position: { x: 50, y: 460 }, data: { text: '💰 Os nossos preços começam em 1500 MZN/mês. Para mais detalhes: https://exemplo.com/precos' } },
      { id: 'mh', type: 'message', position: { x: 250, y: 460 }, data: { text: '🕐 Atendimento: Segunda a Sexta 8h-17h, Sábado 8h-12h.' } },
      { id: 'h1', type: 'handoff', position: { x: 450, y: 460 }, data: { message: 'Vou transferir-te para um colega humano. Aguarda um momento.' } },
      { id: 'e1', type: 'end', position: { x: 150, y: 600 }, data: {} },
      { id: 'e2', type: 'end', position: { x: 350, y: 600 }, data: {} },
    ],
    edges: [
      { id: 'e-t1-b1', source: 't1', target: 'b1', animated: true },
      { id: 'e-b1-s1', source: 'b1', target: 's1' },
      { id: 'e-s1-mp', source: 's1', target: 'mp', sourceHandle: 'precos', label: 'preços' },
      { id: 'e-s1-mh', source: 's1', target: 'mh', sourceHandle: 'horario', label: 'horário' },
      { id: 'e-s1-h1', source: 's1', target: 'h1', sourceHandle: 'humano', label: 'humano' },
      { id: 'e-mp-e1', source: 'mp', target: 'e1' },
      { id: 'e-mh-e2', source: 'mh', target: 'e2' },
    ],
  },

  // ─── 3. Agendamento ───
  {
    id: 'appointment',
    name: 'Agendamento',
    description: 'Recolhe data preferida e cria tarefa para a equipa confirmar.',
    icon: '📅',
    trigger: 'keyword',
    triggerValue: 'agendar',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 250, y: 30 }, data: { label: 'Palavra "agendar"' } },
      { id: 'm1', type: 'message', position: { x: 250, y: 150 }, data: { text: 'Vamos agendar uma reunião! Qual o teu nome completo?', waitForReply: true, saveAs: 'nome' } },
      { id: 'm2', type: 'message', position: { x: 250, y: 280 }, data: {
        text: 'Obrigado, {{vars.nome}}. Qual o teu email?', waitForReply: true, saveAs: 'email',
        validate: 'email', validateError: 'Email inválido. Por favor introduz um email válido (ex: nome@dominio.com).',
      } },
      { id: 'm3', type: 'message', position: { x: 250, y: 410 }, data: {
        text: 'Quando preferes? (data e hora, ex: 25/05 às 14h)', waitForReply: true, saveAs: 'data',
      } },
      { id: 'a1', type: 'action', position: { x: 250, y: 540 }, data: { actionType: 'create_task', actionParams: {
        title: 'Reunião: {{vars.nome}}', description: 'Email: {{vars.email}}\nPreferência: {{vars.data}}',
        type: 'MEETING', dueInHours: 1, priority: 'HIGH',
      } } },
      { id: 'm4', type: 'message', position: { x: 250, y: 670 }, data: { text: '✅ Pedido recebido! Vamos confirmar a disponibilidade e responder em breve.' } },
      { id: 'e1', type: 'end', position: { x: 250, y: 800 }, data: {} },
    ],
    edges: [
      { id: 'e-t1-m1', source: 't1', target: 'm1', animated: true },
      { id: 'e-m1-m2', source: 'm1', target: 'm2' },
      { id: 'e-m2-m3', source: 'm2', target: 'm3' },
      { id: 'e-m3-a1', source: 'm3', target: 'a1' },
      { id: 'e-a1-m4', source: 'a1', target: 'm4' },
      { id: 'e-m4-e1', source: 'm4', target: 'e1' },
    ],
  },

  // ─── 4. CSAT pós-venda ───
  {
    id: 'csat',
    name: 'Pesquisa de satisfação',
    description: 'Pergunta avaliação 1-5 e captura comentário.',
    icon: '⭐',
    trigger: 'keyword',
    triggerValue: 'feedback',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 250, y: 30 }, data: { label: 'Palavra "feedback"' } },
      { id: 'm1', type: 'message', position: { x: 250, y: 150 }, data: { text: 'Obrigado por nos contactares! Como avalias o atendimento? Responde com um número de 1 (mau) a 5 (excelente).', waitForReply: true, saveAs: 'score', validate: 'number', validateError: 'Por favor envia um número de 1 a 5.' } },
      { id: 'm2', type: 'message', position: { x: 250, y: 290 }, data: { text: 'Obrigado! Queres deixar um comentário? (escreve "não" se preferires não responder)', waitForReply: true, saveAs: 'comentario' } },
      { id: 'a1', type: 'action', position: { x: 250, y: 420 }, data: { actionType: 'add_tag', actionParams: { entity: 'contact' } } },
      { id: 'm3', type: 'message', position: { x: 250, y: 540 }, data: { text: '🙏 Obrigado pelo teu feedback!' } },
      { id: 'e1', type: 'end', position: { x: 250, y: 670 }, data: {} },
    ],
    edges: [
      { id: 'e-t1-m1', source: 't1', target: 'm1', animated: true },
      { id: 'e-m1-m2', source: 'm1', target: 'm2' },
      { id: 'e-m2-a1', source: 'm2', target: 'a1' },
      { id: 'e-a1-m3', source: 'a1', target: 'm3' },
      { id: 'e-m3-e1', source: 'm3', target: 'e1' },
    ],
  },

  // ─── 5. Boas-vindas com IA ───
  {
    id: 'welcome_ai',
    name: 'Boas-vindas com IA',
    description: 'Saúda o cliente e responde com IA durante a conversa.',
    icon: '🤖',
    trigger: 'first_message',
    nodes: [
      { id: 't1', type: 'trigger', position: { x: 250, y: 30 }, data: { label: 'Primeira mensagem' } },
      { id: 'm1', type: 'message', position: { x: 250, y: 150 }, data: { text: 'Olá! 👋 Sou o assistente virtual. Em que posso ajudar?' } },
      { id: 'ai1', type: 'ai', position: { x: 250, y: 280 }, data: {
        aiPrompt: 'És o assistente virtual da empresa. Responde de forma amigável e profissional em Português de Moçambique. Se a pergunta for sobre algo que não sabes responder, sugere falar com um colega humano.',
        waitForReply: true,
      } },
      { id: 'h1', type: 'handoff', position: { x: 250, y: 410 }, data: { message: 'Vou transferir-te para um colega humano que pode ajudar melhor.' } },
    ],
    edges: [
      { id: 'e-t1-m1', source: 't1', target: 'm1', animated: true },
      { id: 'e-m1-ai1', source: 'm1', target: 'ai1' },
      { id: 'e-ai1-h1', source: 'ai1', target: 'h1' },
    ],
  },
];
