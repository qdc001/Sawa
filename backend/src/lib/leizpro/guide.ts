// Textos da Leiz Pro (a assistente apresenta-se como Sherone), tirados do
// "Guia de Atendimento da Zona Nerd" (v26).
//
// v26: o capitulo 1 de todas as disciplinas e gratis; do capitulo 2 em diante
// e o modo Super Nerd, vendido em 4 pacotes (PDF "Pacotes de Acesso Completo").
// A conversa no WhatsApp leva o estudante a receber o PDF, criar a conta, abrir
// o capitulo 1 e, quando quiser continuar, escolher um pacote e pagar.
// Trata-se sempre o estudante por "tu". Sem travessoes.
//
// Cada mensagem e um array de partes; cada parte sai como uma mensagem de
// WhatsApp separada. A parte "<<PDF>>" e substituida pelo PDF dos pacotes.
//
// Marcadores:
//   [NOME]  -> primeiro nome do estudante (removido com elegancia se nao houver)
//   {chave} -> preenchido pelo motor; se sobrar algum, a mensagem e bloqueada
//              e a conversa passa para um humano.

export const ASSISTANT_NAME = 'Sherone';

export const AVAILABLE_SUBJECTS = [
  'Matemática', 'Física', 'Química', 'Biologia', 'Português', 'História', 'Geografia', 'Filosofia', 'Inglês', 'Francês',
] as const;

export const SITE = 'znerd.heysawa.com';

// Marcador do PDF dos pacotes dentro de uma mensagem.
export const PDF_MARK = '<<PDF>>';

// Modo Super Nerd (v26): 1 ou 2 disciplinas, 1 ou 2 meses; cada disciplina a
// mais +150 (1 mes) ou +320 (2 meses).
export const SUPER_NERD_PRICES: Record<1 | 2, Record<1 | 2, number>> = {
  1: { 1: 270, 2: 430 },
  2: { 1: 390, 2: 570 },
};
export const EXTRA_SUBJECT_PRICE: Record<1 | 2, number> = { 1: 150, 2: 320 };
// Pacote -> [disciplinas, meses]
export const PACKAGES: Record<'A' | 'B' | 'C' | 'D', [1 | 2, 1 | 2]> = {
  A: [1, 1], B: [2, 1], C: [1, 2], D: [2, 2],
};

// Horario em que a equipa fala com os estudantes (para "Falamos amanha as 18h?").
export const CALL_HOURS = { from: 8, to: 20 };

export const T = {
  // ---- Fluxo 1 ---------------------------------------------------------------
  // Passo 1.1
  greeting: [
    'Olá! 😊',
    `O meu nome é ${ASSISTANT_NAME}, faço parte da equipa da Zona Nerd.`,
    'Posso saber o teu nome e para que universidade estás a preparar o exame de admissão?',
  ],
  // Passo 1.2
  priceFirst: [
    'Compreendo! 😊',
    'O capítulo 1 de todas as disciplinas é grátis. Para continuar nos capítulos seguintes, há o modo Super Nerd, por 1 ou 2 meses.',
    'Diz-me o teu nome e quantas disciplinas tem o teu exame. Assim digo-te o valor certo para o teu caso.',
  ],
  askNameAgain: [
    'Para te orientar melhor, diz-me só o teu nome e a universidade a que te vais candidatar. 😊',
  ],
  askNameOnly: [
    'Obrigado! 😊',
    'E qual é o teu nome?',
  ],
  askUniOnly: [
    'Prazer, [NOME]! 😊',
    'E para que universidade estás a preparar o exame de admissão?',
  ],
  askUniCourse: [
    'Prazer, [NOME]! 😊',
    'E para que universidade e curso te vais candidatar?',
  ],
  // Passo 1.3
  askCourse: [
    'Prazer, [NOME]! 😊',
    'E para que curso te vais candidatar na {universidade}?',
  ],
  // "Como assim que curso?" (muitos vao para institutos, nao universidades)
  courseClarify: [
    'Sem problema, [NOME]. 😊 Quero só saber a área ou o curso que vais fazer lá, por exemplo Formação de Professores, Contabilidade ou Direito. Qual é o teu?',
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
    'Na Zona Nerd exigimos compromisso. Quem entra tem de estar disposto a estudar com seriedade e a dedicar algumas horas por dia à tua admissão. Quem não estiver disposto a dar o máximo, infelizmente, não reúne condições para fazer parte da Zona Nerd.\n\nPor isso, a minha pergunta é: estás mesmo comprometido(a) a dar o teu melhor? 💪',
  ],
  // Passo 1.5.3 (envio dos pacotes). <<PDF>> e o PDF dos pacotes. O fecho marca
  // o dia combinado: a regua de follow-up (Fluxo 6) conta a partir dai.
  packagesPdf: [
    'Óptimo! 😊',
    'Vou enviar-te os pacotes detalhados agora mesmo.',
    'Assim que confirmes com qual dos pacotes vais ficar, iniciamos os teus estudos.',
    PDF_MARK,
    'Caso tenhas alguma dúvida, podes deixar ficar.',
    'Vê com calma e abre {capitulo1}. Posso falar contigo {opcao1} para me dizeres com qual pacote vais ficar?',
  ],
  // Se o PDF ainda nao estiver carregado no Klaru: os pacotes em texto.
  packagesText: [
    'Óptimo! 😊 Estes são os pacotes do modo Super Nerd, com todos os capítulos das disciplinas que escolheres:',
    '🏆 *Pacote D*: 2 disciplinas, 2 meses: *570 MZN*\n🎯 *Pacote C*: 1 disciplina, 2 meses: *430 MZN*\n📚 *Pacote B*: 2 disciplinas, 1 mês: *390 MZN*\n📘 *Pacote A*: 1 disciplina, 1 mês: *270 MZN*\n\nDisciplina a mais: +150 MZN (1 mês) ou +320 MZN (2 meses). Pagas uma vez e não renova sozinho.',
    'Assim que confirmes com qual dos pacotes vais ficar, iniciamos os teus estudos. Caso tenhas alguma dúvida, podes deixar ficar.',
    'Vê com calma e abre {capitulo1}. Posso falar contigo {opcao1} para me dizeres com qual pacote vais ficar?',
  ],
  // 1.5.2 hesitante: capitulo 1 sem conta e marcar contacto
  hesitant: [
    'Sem problema, [NOME]. 😊 Não precisas de decidir já.',
    `Podes ver o capítulo 1 sem conta: abre ${SITE} e toca em "Experimentar sem conta". Não precisas de e-mail nem de palavra-passe.`,
    'Falamos {opcao1} para me contares o que achaste?',
  ],
  // Quando diz que agora nao (depois dos pacotes)
  notNow: [
    'Sem problema, [NOME]. 😊',
    `Enquanto decides, podes estudar o capítulo 1 de todas as disciplinas, que é grátis: ${SITE}`,
    'Falamos {opcao1} para ver como estás?',
  ],
  // Passo 1.5.4 (ajudar a criar a conta)
  accountHelp: [
    'Boa, [NOME]! Vamos fazer juntos, passo a passo. 😊',
    `1. Abre ${SITE} (ou a app, se tiveres Android)\n2. Toca em criar conta: e-mail, palavra-passe e o código que chega ao teu e-mail\n3. Escolhe as disciplinas do teu exame`,
    'Manda-me um print quando chegares às disciplinas.',
  ],
  // Passo 1.5.5 (conta criada). {comeca_por}: a frase com a disciplina dificil.
  accountCreated: [
    'Já está, [NOME]! 🎉 A tua conta está criada.',
    '{comeca_por} Vê o vídeo e depois faz as perguntas.',
    'Uma coisa: no ecrã "Convidar" tens o teu link. Se 5 amigos entrarem por ele e fizerem o diagnóstico, ganhas 7 dias do modo Super Nerd. 🎁\n\nQuem são 2 ou 3 colegas que também vão fazer exame? Toca em partilhar e manda-lhes já.',
    'Falamos {opcao1} para me contares como correu o capítulo 1? 😊',
  ],
  // Passo 2.1.1 (experimentou e gostou)
  liked: [
    'Óptimo, [NOME]! 😊',
    'Isso é apenas uma amostra. Nos pacotes tens todos os capítulos, do primeiro ao último, com vídeos, resumos e perguntas tipo exame.',
    'Com qual dos pacotes vais ficar?',
  ],

  // Resposta durante a regua (ou "ja decidi"): volta a pergunta do pacote.
  askPackage: [
    'Boa, [NOME]! 😊 Com qual dos pacotes vais ficar?',
  ],

  // ---- Fluxo 6: regua de follow-up (sem resposta depois dos pacotes) ----------
  // Contacto 1, no dia combinado (modelo da conversa da Deise). {recomendacao}:
  // o paragrafo reguaRecommendation preenchido com o curso dele (editais 2026),
  // ou vazio se o curso nao estiver nos editais.
  reguaContact1: [
    'Olá, [NOME]! 😊\n\n{recomendacao}Lembrei-me de ti. Já decidiste com qual pacote vais ficar?',
  ],
  // Recomendacao do contacto 1: pacote de 2 meses com as disciplinas do exame.
  reguaRecommendation: [
    'Para quem vai fazer {curso}, uma das opções de preparação é o {pacote}, que inclui {disciplinas}, com duração de {duracao}. É uma forma de organizar o estudo e avançar gradualmente pelos conteúdos. Em {disciplina}, por exemplo, já podes chegar ao capítulo 3.',
  ],
  // Recomendacao quando o curso nao esta nos editais: so o numero de disciplinas.
  reguaRecommendationGeneric: [
    'Para quem vai fazer {curso}, uma das opções de preparação é o {pacote}, que inclui {disciplinas}, com duração de {duracao}. É uma forma de organizar o estudo e avançar gradualmente pelos conteúdos.',
  ],
  // Contacto 2 (3 dias depois): dar espaco para um "nao"
  reguaContact2: [
    'Olá, [NOME]. 😊\n\nSei que às vezes não é o momento certo. Se agora não quiseres avançar, diz-me só "agora não", sem problema nenhum. Assim não te incomodo.\n\nSe quiseres, continuo aqui para te ajudar a escolher.',
  ],
  // "Agora nao" durante a regua: agradecer e perguntar quando voltar a falar.
  reguaNotNow: [
    'Combinado, [NOME]! 😊 Sem problema nenhum, e obrigado por me dizeres.',
    `Até lá, continuas a estudar o capítulo 1 de todas as disciplinas, grátis, em ${SITE}.`,
    'Quando achas que podemos voltar a falar?',
  ],
  // Contacto 3 (fim dos 10 dias): despedida
  reguaFarewell: [
    `Olá, [NOME]. Como não consegui falar contigo, vou parar de te mandar mensagens, para não te incomodar. 😊\n\nO capítulo 1 de todas as disciplinas continua grátis em ${SITE}.\n\nQuando quiseres continuar, é só escreveres aqui. Boa preparação! 💪`,
  ],

  // ---- Fluxo 3: modo Super Nerd e pagamento ------------------------------------
  // Passo 3.1
  superNerdAsk: [
    'Claro, [NOME]! 😊 O modo Super Nerd dá-te:\n✅ Todos os capítulos das disciplinas que escolheres\n✅ Vidas sem limite (treinos sem parar)\n✅ Vídeos sem esperar pelas vidas\n✅ Baixar o conteúdo para estudar sem internet',
    'É por 1 mês ou 2 meses: pagas uma vez e não renova sozinho.',
    'Quantas disciplinas queres e por quanto tempo? Assim digo-te o valor certo.',
  ],
  snAskCount: [
    'E quantas disciplinas queres, [NOME]?',
  ],
  snAskMonths: [
    'E por quanto tempo: 1 mês ou 2 meses?',
  ],
  // Passo 3.1.1 (valor ja calculado pelo Klaru)
  superNerdPrice: [
    'Para {disciplinas} durante {duracao}, é o {pacote}: {valor} MZN, pagos uma vez.',
    'Não renova sozinho: quando acabar, voltas ao capítulo 1 grátis e o teu progresso fica guardado.',
  ],
  superNerdActivateQ: [
    'Queres que te explique como activar?',
  ],
  // Passo 3.2 (canais de pagamento, depois de confirmar o pacote)
  paymentChannels: [
    'Estes são os canais de pagamento 😊\n- 871443442 - Absalão Mate\n- 858395481 - Absalão Mate',
    'Após o pagamento, peço que mandes o comprovativo por aqui, no WhatsApp.',
    'Assim que validarmos o pagamento, o teu acesso fica activo.',
  ],

  // ---- Fluxo 5: situacoes comuns ------------------------------------------------
  expensive: [
    'Compreendo, [NOME].',
    'Começa pelo capítulo 1 de todas as disciplinas, que é grátis, e vê se o método resulta contigo.',
    'Se quiseres continuar: 2 meses sai mais barato por mês, e não renova sozinho. E se 5 amigos entrarem pelo teu link de convite, ganhas 7 dias do modo Super Nerd.',
  ],
  paymentSafe: [
    'É sim, [NOME].',
    'Pagas por M-Pesa ou e-Mola, directamente da operadora, e envias a foto do comprovativo. Normalmente a confirmação chega em poucos minutos.',
    'E não renova sozinho: só pagas quando quiseres.',
  ],
  friendReferral: [
    'Óptima notícia, [NOME]! 😊',
    'No ecrã "Convidar", toca em partilhar: o teu colega recebe o teu link e cria a conta por ele.',
    'Quando 5 amigos entrarem pelo teu link e fizerem o diagnóstico, ganhas 7 dias do modo Super Nerd.\n\nConsegues enviar-lhe já?',
  ],
  coversExam: [
    'Boa pergunta, [NOME]. 🎯',
    'O nosso foco é ensinar bem a matéria de cada disciplina, do mais simples ao mais complexo, passo a passo. Para treinar, tens perguntas tipo exame, de exames anteriores.',
  ],
  willIPass: [
    'Vou ser honesto contigo, [NOME].',
    'A Zona Nerd dá o conteúdo, o método e a prática. Mas quem estuda és tu.\n\nSe dedicares algumas horas por dia, as tuas probabilidades aumentam muito.',
    'Não prometemos admissões garantidas. Prometemos uma preparação sólida e organizada.',
  ],
  noUniversity: [
    'Repara, [NOME]: a matéria das disciplinas de base (Biologia, Química, Física, Matemática) é praticamente a mesma em todas as universidades.',
    'Por isso a Zona Nerd serve como preparação de base, seja qual for a universidade. Depois podes complementar com os exames específicos da tua.',
  ],
  weakPhone: [
    'Entendo, [NOME].',
    'Os vídeos são curtos e os resumos em PDF são leves. Uma boa dica é estudar quando apanhares Wi-Fi.',
    'Se quiseres baixar o conteúdo para estudar sem internet, isso faz parte do modo Super Nerd.',
  ],
  shareAccount: [
    'A conta é individual, [NOME]. Se partilharem, o sistema pode bloquear.',
    'Mas não precisas: no ecrã "Convidar", toca em partilhar e envia o teu link ao teu amigo. Ele cria a conta dele por esse link.',
    'Quando 5 amigos entrarem pelo teu link e fizerem o diagnóstico, ganhas 7 dias do modo Super Nerd.\n\nFica melhor para ti e para ele. Consegues enviar-lhe já?',
  ],
  payOtherPerson: [
    'Sim, podes. 😊',
    'Quando enviares o comprovativo, escreve no formulário o número que fez o pagamento (o da outra pessoa) e o valor exacto.',
    'Assim o pagamento fica associado à tua conta. Se tiveres dúvida nesse passo, fala comigo que eu oriento.',
  ],
  lives: [
    'Boa pergunta, [NOME]! 😊 Tens 5 vidas. Perdes uma em cada resposta errada nas perguntas, e volta 1 vida a cada 30 minutos, até às 5.',
    'No capítulo 1, os vídeos não precisam das vidas cheias. Nos outros capítulos, para ver um vídeo precisas das 5 vidas cheias. Partilhar o teu link no ecrã "Convidar" também pode recarregar as vidas.',
    'Com o modo Super Nerd, as vidas não acabam: treinos sem parar.',
  ],
  accessProblem: [
    'Obrigado por avisares, [NOME]! 😊 Vamos resolver.',
    'Diz-me onde estás a tentar: na app ou no site? E o que aparece no ecrã? Se der, manda-me um print.',
    'Enquanto isso, podes estudar o capítulo 1 sem conta: no ecrã inicial, toca em "Experimentar sem conta". 🤝',
  ],
  emailCode: [
    'Percebo, [NOME]. 😊 O código que é enviado para o e-mail não é a palavra-passe do e-mail. É só um número para confirmar que o e-mail é teu.',
    'Podes ler o código na notificação sem sair da app ou do site. Se voltar ao início, pede um código novo e usa o mais recente. Vê também no Spam.',
    'Se o e-mail estiver com problema, podes criar um Gmail novo agora, com a minha ajuda. Demora uns 3 minutos.',
  ],
  forgotPassword: [
    'Sem problema, [NOME]. 😊',
    'No ecrã de entrada, toca em "Esqueci a palavra-passe" e segue os passos que aparecem. Se não receberes nada, vê também no Spam do e-mail.',
    'Conseguiste? Se não, diz-me o que aparece.',
  ],
  changeSubjects: [
    'Percebo, [NOME]. 😊 O capítulo 1 está aberto em todas as disciplinas, por isso podes estudá-lo já em qualquer uma.',
    'E no modo Super Nerd escolhes as disciplinas no próprio pagamento. Qual é a disciplina que queres estudar?',
  ],
  accessEnded: [
    'Boa, [NOME]! 💪 O teu progresso está guardado: quando voltares a activar, continuas onde paraste.',
    'Queres o mesmo pacote ou preferes mudar? Diz-me e envio-te o valor.',
  ],
  linkProblem: [
    `Vamos tentar de outra forma, [NOME]. 😊\n\n1. Copia o link: ${SITE}\n2. Abre o Chrome (no iPhone, o Safari) e cola no endereço\n3. Toca em criar conta (ou em "Experimentar sem conta")`,
    'Confirma também se tens dados móveis ou Wi-Fi ligados. Se não abrir, diz-me o que aparece.',
  ],
  // "Queria presencial": pergunta o motivo; a seguir vem "como e estudar online".
  presencial: [
    'Não, [NOME], a Zona Nerd é 100% online. 😊',
    'A vantagem é que estudas quando quiseres, repetes o vídeo quantas vezes precisares e treinas logo com perguntas tipo exame, sem sair de casa.',
    'Posso saber porque preferes o presencial?',
  ],
  // "Como e estudar online?" / "Como funciona?"
  howOnline: [
    'Percebo, [NOME]. 😊\n\nEstudar online funciona assim:\n1. Escolhes a disciplina e abres o capítulo\n2. Vês o vídeo curto e lês o resumo em PDF\n3. Treinas logo com perguntas tipo exame e vês onde precisas de melhorar',
    'Não há horários fixos: estudas quando quiseres, pelo telemóvel, e repetes quantas vezes precisares.',
    `Para veres como é na prática, abre o capítulo 1, que é grátis: ${SITE}. Se quiseres, ajudo-te aqui, passo a passo.`,
  ],
  schedule: [
    'Não temos horário fixo, [NOME]. 😊 Estudas quando quiseres, ao teu ritmo, pelo telemóvel.',
    'Não é por videochamada. Se tiveres dúvidas, escreve-me aqui e eu oriento-te.',
    'E podes começar já pelo capítulo 1, que é grátis.',
  ],
  tooBasic: [
    'Boa, [NOME]! 😊 Isso mostra que tens boa base.',
    'O percurso começa pela base de propósito e vai subindo até às questões mais difíceis, que ficam nos capítulos seguintes, no modo Super Nerd.',
    'Faz as perguntas tipo exame do capítulo 1: elas mostram o teu nível real. 🎯 Diz-me depois quantas acertas.',
  ],
  noMoney: [
    'Entendo, [NOME], e agradeço por me contares. 😊',
    'Começa pelo capítulo 1 de todas as disciplinas, que é grátis, e vê se o método resulta contigo.',
    'Quando puderes: 2 meses sai mais barato por mês, não renova sozinho e, se 5 amigos entrarem pelo teu link, ganhas 7 dias do modo Super Nerd.',
  ],
  socials: [
    'Para mais dicas, segue também as nossas redes:\nFacebook: https://www.facebook.com/share/19ruvHyDHy/\nInstagram: https://www.instagram.com/absalaolavimon?mdxt=MWo0MTB5dG1xbGpzNQ==\nTikTok: Absalao Mate | Zona Nerd',
  ],
  // "E gratis?", "tem taxas?", "afinal nao e mahala?"
  isFree: [
    'Sim, [NOME]! 😊 O capítulo 1 de todas as disciplinas é grátis, com vídeos, resumos e perguntas tipo exame.',
    'Para continuar do capítulo 2 em diante há o modo Super Nerd, por 1 ou 2 meses. Pagas uma vez e não renova sozinho.',
  ],

  // ---- Auxiliares --------------------------------------------------------------
  nonText: [
    'Obrigado, [NOME]! 😊',
    'Para eu te orientar melhor, consegues escrever-me a resposta aqui por mensagem?',
  ],
  whyAsk: [
    'Sim, [NOME]. 😊 Assim consigo orientar-te melhor para o teu caso.',
  ],
  clarifyPrefix: [
    'Sem problema, [NOME]. 😊 Vou explicar melhor:',
  ],
  repeatPrefix: [
    'Só para eu te orientar bem, [NOME]:',
  ],
  // "Em caso de duvida" do guia: so serve de rascunho para a equipa.
  handoffDraft: [
    'Boa pergunta, [NOME].\n\nDeixa-me confirmar com a equipa e volto já a falar contigo.',
  ],
} satisfies Record<string, string[]>;

export type TemplateKey = keyof typeof T;
