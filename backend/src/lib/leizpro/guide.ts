// Textos da Leiz Pro (a assistente apresenta-se como Sherone), tirados do
// "Guia de Atendimento da Zona Nerd" (v21).
//
// v21: a Zona Nerd e gratis com conta (2 disciplinas). O objectivo da conversa
// no WhatsApp e marcar uma chamada curta, onde a equipa cria a conta com o
// estudante. O plano pago chama-se sempre "modo Super Nerd" (nunca "pacote").
//
// Cada mensagem e um array de partes; cada parte sai como uma mensagem de
// WhatsApp separada. O texto segue o guia, incluindo o "voce"/"tu" de cada
// passo (decisao do dono: manter como esta no guia). Sem travessoes.
//
// Marcadores:
//   [NOME]  -> primeiro nome do estudante (removido com elegancia se nao houver)
//   {chave} -> preenchido pelo motor; se sobrar algum, a mensagem e bloqueada
//              e a conversa passa para um humano.

export const ASSISTANT_NAME = 'Sherone';

// Disciplinas que aparecem hoje na app (v21). Ingles e Frances estao por
// confirmar no guia, por isso a Sherone nao diz que estao completas.
export const AVAILABLE_SUBJECTS = [
  'Matemática', 'Física', 'Química', 'Biologia', 'Português', 'História', 'Geografia', 'Filosofia', 'Inglês', 'Francês',
] as const;

export const SITE = 'znerd.heysawa.com';

// Modo Super Nerd: valores confirmados no guia (1 ou 2 disciplinas).
// 3 ou mais disciplinas ainda estao por confirmar: passa para a equipa.
export const SUPER_NERD_PRICES: Record<1 | 2, Record<1 | 2, number>> = {
  1: { 1: 270, 2: 430 },
  2: { 1: 390, 2: 570 },
};

// Horario em que a equipa liga aos estudantes (hora de Maputo).
export const CALL_HOURS = { from: 8, to: 20 };

export const T = {
  // ---- Fluxo 1: primeiro contacto ------------------------------------------
  // Passo 1.1
  greeting: [
    'Olá! 😊',
    `Meu nome é ${ASSISTANT_NAME}, faço parte da equipa da Zona Nerd.`,
    'Posso saber o seu nome e para que universidade está a preparar o exame de admissão?',
  ],
  // Passo 1.2
  priceFirst: [
    'Compreendo! 😊',
    'A boa notícia é que podes estudar grátis: crias conta e tens 2 disciplinas com o percurso completo. Há também o modo Super Nerd, opcional, para quem quer mais.',
    'Diz-me só o teu nome, a universidade e o curso a que te vais candidatar. Assim consigo orientar-te melhor.',
  ],
  askNameAgain: [
    'Para te orientar melhor, diz-me só o teu nome e a universidade a que te vais candidatar. 😊',
  ],
  askNameOnly: [
    'Obrigado! 😊',
    'E qual é o seu nome?',
  ],
  askUniOnly: [
    'Prazer, [NOME]! 😊',
    'E para que universidade está a preparar o exame de admissão?',
  ],
  askUniCourse: [
    'Prazer, [NOME]! 😊',
    'E para que universidade e curso pretende candidatar-se?',
  ],
  // Passo 1.3
  askCourse: [
    'Prazer, [NOME]! 😊',
    'E para que curso pretende candidatar-se na {universidade}?',
  ],
  // Passo 1.4 (conexao)
  connection: [
    'Boa, [NOME]! 😊',
    'Já tentaste estudar para o exame antes? O que foi mais difícil?',
  ],
  // Passo 1.5.1 (vacina do online). A 1.a parte e a reaccao ao 1.4 (o motor
  // troca-a por "Óptimo" quando ele diz que nada foi dificil).
  vaccineOnline: [
    'Percebo, [NOME]. Muita gente passa por isso.',
    'Na Zona Nerd, temos conteúdos para as disciplinas do curso no qual pretendes admitir.',
    'Os estudos começam pelos tópicos mais simples e básicos e vão subindo, passo a passo, até às questões mais complexas. Assim, chegas ao exame com uma boa base.',
    'E podes treinar na hora o que acabaste de estudar, com perguntas tipo exame, e ver logo onde precisas de melhorar.',
    'Tudo isto é online, ao teu ritmo. Estás à vontade para estudar online, pelo telemóvel?',
  ],
  // Passo 1.5.2 (a pergunta vai na mesma mensagem do texto longo: numa conversa
  // real o estudante respondeu a meio do envio e a pergunta ainda nao tinha chegado)
  vaccineCommitment: [
    'Certo, [NOME]. 😊\n\nAntes de avançarmos, deixa-me ser sincero contigo.',
    'Na Zona Nerd exigimos compromisso. Quem entra tem de estar disposto a estudar com seriedade e a dedicar algumas horas por dia à sua admissão. Quem não estiver disposto a dar o máximo, infelizmente, não reúne condições para fazer parte da Zona Nerd.\n\nPor isso, a minha pergunta é: estás mesmo comprometido(a) a dar o teu melhor? 💪',
  ],
  // Passo 1.5.3 (convite para a chamada, com duas horas concretas)
  callInvite: [
    'Gosto dessa atitude, [NOME]! 💪',
    'Para te ajudar a começar bem, quero ligar-te uns 10 minutos. Assim percebo melhor a tua situação e deixo-te já com a conta criada e as tuas 2 disciplinas prontas, sem pagar nada.',
    'Pode ser {opcao1} ou preferes {opcao2}?',
  ],
  // Passo 1.5.3 (confirmar a hora escolhida; cria a chamada na Agenda do Klaru)
  callConfirm: [
    'Combinado, [NOME]! 😊 Ligo-te {quando}, deste número.',
    'Tem o telemóvel com bateria e, se der, com internet ligada, para criarmos a conta juntos.',
  ],
  // Passo 1.5.6 (pede para ser noutra altura)
  callOtherTime: [
    'Claro, [NOME]! 😊 Qual é o melhor dia e hora para ti?',
  ],
  // Hora fora do horario das chamadas, ou sem hora concreta
  callAskHour: [
    'Consigo ligar-te entre as 8h e as 20h, [NOME]. 😊 A que horas te dá mais jeito?',
  ],
  // Passo 1.5.6 (nao pode falar por chamada); a seguir passa para a equipa
  noCall: [
    'Sem problema, [NOME]! Fazemos por aqui, passo a passo. 😊',
    `1. Abre ${SITE} (ou a app, se tiveres Android)\n2. Toca em criar conta\n3. Escolhe as 2 disciplinas do teu exame`,
    'Manda-me um print quando chegares às disciplinas, que eu ajudo-te a escolher.',
  ],
  // Passo 1.5.2 (resposta hesitante ao compromisso): amostra + marcar contacto
  hesitant: [
    'Sem problema, [NOME]. 😊 Não precisas de decidir já.',
    `Podes ver uma amostra: abre ${SITE} e toca em "Experimentar sem conta". Não precisas de e-mail nem de palavra-passe.`,
    'Depois de veres, falamos uns minutos? Pode ser {opcao1} ou preferes {opcao2}?',
  ],

  // ---- Fluxo 3: modo Super Nerd ----------------------------------------------
  // Passo 3.1 (quando pergunta pelo modo Super Nerd ou insiste no preco)
  superNerdAsk: [
    'Claro, [NOME]! 😊 O modo Super Nerd é opcional. Dá-te:\n✅ Vidas sem limite\n✅ Vídeos sem esperar pelas vidas\n✅ Baixar o conteúdo para estudar sem internet\n✅ Mais disciplinas, além das tuas 2 grátis',
    'É por 1 mês ou 2 meses: pagas uma vez e não renova sozinho.',
    'Quantas disciplinas queres e por quanto tempo? Assim digo-te o valor certo.',
  ],
  // Quando so respondeu a metade da pergunta do 3.1
  snAskCount: [
    'E quantas disciplinas queres, [NOME]?',
  ],
  snAskMonths: [
    'E por quanto tempo: 1 mês ou 2 meses?',
  ],
  // Passo 3.1.1 (valor ja calculado pelo Klaru)
  superNerdPrice: [
    'Para {disciplinas} durante {duracao}, fica {valor} MZN, pagos uma vez.',
    'Não renova sozinho: quando acabar, voltas ao grátis nas tuas 2 disciplinas, sem perder nada.',
  ],
  // Depois do valor, quando ainda nao ha chamada marcada (o guia manda voltar
  // a conta gratis e ao convite para a chamada)
  priceBackToFree: [
    'Mas começa pelo grátis, que nas tuas 2 disciplinas já tens o percurso todo.',
  ],
  // Depois do valor, quando ja ha chamada marcada
  superNerdActivateQ: [
    'Queres que te explique como activar?',
  ],
  // Passo 3.2 (pagamento dentro da app)
  paymentInApp: [
    'Perfeito, [NOME]! 😊 É tudo dentro da app:',
    '1. Abre o modo Super Nerd\n2. Escolhe as disciplinas e a duração\n3. Paga por M-Pesa ou e-Mola para o número que aparece\n4. Envia a foto do comprovativo na própria app',
    'Normalmente fica activo em poucos minutos e recebes um aviso. Consegues fazer hoje ainda?',
  ],
  // Passo 4.1 (diz que ja pagou)
  paidInfo: [
    'Perfeito, [NOME].',
    'Normalmente a confirmação é automática e chega em poucos minutos. Assim que receber o aviso na app, o modo Super Nerd fica aberto.',
    'Se não receber o aviso, avise-me.',
  ],

  // ---- Fluxo 5: situacoes comuns ---------------------------------------------
  expensive: [
    'Compreendo, [NOME].',
    'A boa notícia é que pode estudar grátis: com a conta, tem as suas 2 disciplinas com o percurso todo, do básico ao mais complexo.',
    'O modo Super Nerd é só para quem quer mais (vidas sem limite, estudar sem internet, mais disciplinas). Pode começar pelo grátis e decidir depois.',
  ],
  paymentSafe: [
    'É sim, [NOME].',
    'O pagamento é feito dentro da app, para o número M-Pesa ou e-Mola que aparece no modo Super Nerd, directamente da operadora.',
    'Depois envia a foto do comprovativo na própria app e, normalmente, a confirmação chega em poucos minutos.\n\nE o plano não renova sozinho: só paga quando quiser.',
  ],
  friendReferral: [
    'Óptima notícia, [NOME]! 😊',
    'Na app, abra o ecrã "Convidar" e toque em partilhar: o seu colega recebe o seu link e cria a conta grátis por ele.',
    'Quando 5 amigos entrarem pelo seu link e fizerem o diagnóstico, ganha 1 mês de vidas ilimitadas.\n\nConsegue enviar-lhe já?',
  ],
  coversExam: [
    'Boa pergunta, [NOME]. 🎯',
    'O nosso foco é ensinar bem a matéria de cada disciplina, do mais simples ao mais complexo, passo a passo. Para treinar, tem perguntas tipo exame, de exames anteriores.',
  ],
  willIPass: [
    'Vou ser honesto consigo, [NOME].',
    'A Zona Nerd dá o conteúdo, o método e a prática. Mas quem estuda é você.\n\nSe dedicar algumas horas por semana, as suas probabilidades aumentam muito.',
    'Não prometemos admissões garantidas. Prometemos uma preparação sólida e organizada.',
  ],
  noUniversity: [
    'Repare, [NOME]: a matéria das disciplinas de base (Biologia, Química, Física, Matemática) é praticamente a mesma em todas as universidades.',
    'Por isso a Zona Nerd serve como preparação de base, seja qual for a universidade. Depois pode complementar com os exames específicos da sua.',
  ],
  weakPhone: [
    'Entendo, [NOME].',
    'Os vídeos são curtos e os resumos em PDF são leves. No grátis, estuda com internet: uma boa dica é estudar quando apanhar Wi-Fi.',
    'Se quiser baixar o conteúdo para estudar sem internet, isso faz parte do modo Super Nerd.',
  ],
  shareAccount: [
    'A conta é individual, [NOME]. Se partilharem, o sistema pode bloquear.',
    'Mas não precisa: no ecrã "Convidar" da app, toque em partilhar e envie o seu link ao seu amigo. Ele cria a conta dele, grátis, por esse link.',
    'Quando 5 amigos entrarem pelo seu link e fizerem o diagnóstico, ganha 1 mês de vidas ilimitadas.\n\nFica melhor para si e para ele.',
  ],
  payOtherPerson: [
    'Sim, pode. 😊',
    'Só precisa de enviar a foto do comprovativo dentro da sua conta, na app, para o pagamento ficar associado a si.',
    'Se tiver dúvida nesse passo, fala comigo que eu oriento.',
  ],
  accessProblem: [
    'Obrigado por avisares, [NOME]! 😊 Vamos resolver.',
    'Diz-me onde estás a tentar: na app ou no site? E o que aparece no ecrã? Se der, manda-me um print.',
    'Enquanto isso, podes ver uma amostra sem conta: no ecrã inicial, toca em "Experimentar sem conta". 🤝',
  ],
  linkProblem: [
    `Vamos tentar de outra forma, [NOME]. 😊\n\n1. Copia o link: ${SITE}\n2. Abre o Chrome (no iPhone, o Safari) e cola no endereço\n3. Toca em criar conta (ou em "Experimentar sem conta")`,
    'Confirma também se tens dados móveis ou Wi-Fi ligados. Se não abrir, diz-me o que aparece.',
  ],
  // "Queria presencial": as duas primeiras partes; o motor junta a seguir a
  // pergunta do passo em que esta (ou o convite para a chamada).
  presencial: [
    'Percebo, [NOME]. 😊\n\nEstudar online funciona assim:\n1. Escolhes a disciplina e abres o capítulo\n2. Vês o vídeo curto e lês o resumo em PDF\n3. Treinas logo com perguntas tipo exame e vês onde precisas de melhorar',
    'Não há horários fixos: estudas quando quiseres, pelo telemóvel, e repetes quantas vezes precisares.',
  ],
  schedule: [
    'Não temos horário fixo, [NOME]. 😊 Estudas quando quiseres, ao teu ritmo, pelo telemóvel.',
    'Não é por videochamada. Se tiveres dúvidas, escreve-me aqui e eu oriento-te.',
    'E podes começar grátis, nas tuas 2 disciplinas.',
  ],
  tooBasic: [
    'Boa, [NOME]! 😊 Isso mostra que tens boa base.',
    'A amostra sem conta é só o início. Com a conta grátis avanças no percurso todo das tuas 2 disciplinas, e os temas vão ficando mais difíceis, capítulo a capítulo.',
    'Cria a conta e vai às perguntas tipo exame: elas mostram o teu nível real. 🎯 Diz-me depois quantas acertas.',
  ],
  // "Nao tenho condicoes agora": resposta principal e o gratis; o motor junta
  // o convite para a chamada (se ainda nao houver) e as redes.
  noMoney: [
    'Entendo, [NOME], e agradeço por me contares. 😊',
    'Não precisas de pagar nada para estudar. Com a conta grátis tens as tuas 2 disciplinas com o percurso todo, do básico ao mais complexo.',
  ],
  socials: [
    'Para mais dicas, segue também as nossas redes:\nFacebook: https://www.facebook.com/share/19ruvHyDHy/\nInstagram: https://www.instagram.com/absalaolavimon?mdxt=MWo0MTB5dG1xbGpzNQ==\nTikTok: Absalao Mate | Zona Nerd',
  ],

  // ---- Auxiliares --------------------------------------------------------------
  nonText: [
    'Obrigado, [NOME]! 😊',
    'Para eu te orientar melhor, consegues escrever-me a resposta aqui por mensagem?',
  ],
  clarifyPrefix: [
    'Sem problema, [NOME]. 😊 Vou explicar melhor:',
  ],
  repeatPrefix: [
    'Só para eu te orientar bem, [NOME]:',
  ],
  // "Em caso de dúvida" do guia: so serve de rascunho para a equipa.
  handoffDraft: [
    'Boa pergunta, [NOME].\n\nDeixe-me confirmar com a equipa e volto já consigo.',
  ],
} satisfies Record<string, string[]>;

export type TemplateKey = keyof typeof T;
