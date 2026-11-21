// Textos da Leiz Pro (a assistente apresenta-se como Sherone), tirados do "Guia de Atendimento da Zona Nerd" (v20).
//
// Cada mensagem e um array de partes; cada parte sai como uma mensagem de
// WhatsApp separada (o dispatch ja simula digitacao entre partes). O texto
// segue o guia a letra, incluindo o "voce"/"tu" de cada passo (decisao do
// dono: manter como esta no guia).
//
// Marcadores:
//   [NOME]  -> primeiro nome do estudante (removido com elegancia se nao houver)
//   {chave} -> preenchido pelo motor (fill); se sobrar algum, a mensagem e
//              bloqueada e a conversa passa para um humano.

export const ASSISTANT_NAME = 'Sherone';

export const AVAILABLE_SUBJECTS = [
  'Matemática', 'Física', 'Biologia', 'Química', 'Português', 'História', 'Filosofia', 'Geografia',
] as const;

export const FREE_LINK = 'znerd.heysawa.com';

export const T = {
  // Passo 1.1
  greeting: [
    'Olá! 😊',
    `Meu nome é ${ASSISTANT_NAME}, faço parte da equipa da Zona Nerd.`,
    'Posso saber o seu nome e para que universidade está a preparar o exame de admissão?',
  ],
  // Passo 1.2
  priceFirst: [
    'Compreendo! 😊',
    'O valor depende do número de disciplinas de que precisas e do tempo que falta até ao exame. Por isso, quero perceber primeiro a tua situação para te recomendar a opção que faz mais sentido.',
    'Diz-me só o teu nome, a universidade e o curso a que te vais candidatar. Assim consigo orientar-te melhor.',
  ],
  // Quando a resposta ao 1.1 nao trouxe o nome/universidade (variante curta do 1.2)
  askNameAgain: [
    'Para te orientar melhor, diz-me só o teu nome e a universidade a que te vais candidatar. 😊',
  ],
  // Deu a universidade (e talvez o curso) mas nao o nome
  askNameOnly: [
    'Obrigado! 😊',
    'E qual é o seu nome?',
  ],
  // Deu o nome mas nao a universidade (e ja disse o curso)
  askUniOnly: [
    'Prazer, [NOME]! 😊',
    'E para que universidade está a preparar o exame de admissão?',
  ],
  // Disse que ainda nao sabe as disciplinas (1.4: "eu ajudo a confirmar")
  subjectsUnknown: [
    'Sem problema, [NOME]. 😊',
    'Vou confirmar com a equipa as disciplinas de {curso} na {universidade} e já te digo.',
  ],
  // Mandou audio, imagem ou sticker quando esperavamos uma resposta escrita
  nonText: [
    'Obrigado, [NOME]! 😊',
    'Para eu te orientar melhor, consegues escrever-me a resposta aqui por mensagem?',
  ],
  // Quando diz "nao percebi": explicar e repetir a pergunta
  clarifyPrefix: [
    'Sem problema, [NOME]. 😊 Vou explicar melhor:',
  ],
  // Prefixo para repetir a pergunta quando a resposta nao respondeu
  // (a pergunta repetida e a ultima parte da mensagem anterior).
  repeatPrefix: [
    'Só para eu te orientar bem, [NOME]:',
  ],
  // Passo 1.3
  askCourse: [
    'Prazer, [NOME]! 😊',
    'E para que curso pretende candidatar-se na {universidade}?',
  ],
  // Variante do 1.3 quando ele deu o nome mas nao a universidade
  askUniCourse: [
    'Prazer, [NOME]! 😊',
    'E para que universidade e curso pretende candidatar-se?',
  ],
  // Passo 1.4
  askSubjects: [
    'Obrigado, [NOME]! 😊',
    'Quais são as disciplinas do exame de admissão para o curso de {curso} na {universidade}?',
    'Se ainda não tiver a certeza, diga-me e eu ajudo a confirmar.',
  ],
  // Passo 1.4.1
  connection: [
    'Boa, [NOME]! 😊',
    'Já tentaste estudar para o exame antes? O que foi mais difícil?',
  ],
  // Passo 1.6 (alguma disciplina em falta)
  missingSubject: [
    'Obrigado, [NOME]! 😊',
    'Neste momento a Zona Nerd tem conteúdos para {disponiveis}.\n\nA de {em_falta} ainda não está disponível. Estamos a preparar o conteúdo.',
    'Sugiro começarmos já por {disponiveis}.',
  ],
  // Passo 1.5.1 (vacina do online), precedido de uma reaccao curta ao 1.4.1
  // A primeira parte e a reaccao a resposta do 1.4.1 (o motor troca-a por
  // "Óptimo" quando ele diz que nada foi dificil).
  vaccineOnline: [
    'Percebo, [NOME]. Muita gente passa por isso.',
    'Na Zona Nerd, temos conteúdos para as disciplinas de {disponiveis}.',
    'Os estudos começam pelos tópicos mais simples e básicos e vão subindo, passo a passo, até às questões mais complexas. Assim chegas ao exame com boa base.',
    'E podes treinar na hora o que acabaste de estudar, com perguntas tipo exame, e ver logo onde precisas de melhorar.',
    'Tudo isto é online, ao teu ritmo. Estás à vontade para estudar online, pelo telemóvel?',
  ],
  // Passo 1.5.2
  vaccineCommitment: [
    'Certo, [NOME]. 😊\n\nAntes de avançarmos, deixa-me ser sincero contigo.',
    'Na Zona Nerd exigimos compromisso. Quem entra tem de estar disposto a estudar com seriedade e a dedicar algumas horas por dia à sua admissão. Quem não estiver disposto a dar o máximo, infelizmente, não reúne condições para fazer parte da Zona Nerd.\n\nPor isso, a minha pergunta é: estás mesmo comprometido(a) a dar o teu melhor? 💪',
  ],
  // (A pergunta vai na mesma mensagem do texto longo: numa conversa real o
  // estudante respondeu a meio do envio e a pergunta ainda nao tinha chegado.)
  // Passo 1.5.3
  vaccineBudget: [
    'Gosto dessa atitude, [NOME]! 😊',
    'Se os valores couberem no teu orçamento, consegues começar já? Ou há alguma coisa que te faça esperar?',
  ],
  // Passo 1.5.5 (saida: capitulo 1 gratis), sem a linha de hora marcada
  freeTrial: [
    'Experimenta primeiro: o capítulo 1 de cada disciplina é totalmente grátis, sem pagar nada e sem compromisso. 😊',
    `Aqui está o link 👉 ${FREE_LINK}\n\nToca em "Ver o capítulo 1 grátis". Não precisas de e-mail nem de palavra-passe para testar.`,
    'Escolhe uma disciplina e abre o capítulo 1: tem vídeo curto, resumo em PDF e perguntas tipo exame. É um capítulo de teste, por isso é mais básico, e o conteúdo vai evoluindo gradualmente.',
    'Depois de veres, diz-me com sinceridade o que achaste. Se não gostares, sem problema. Se gostares e estiver ao teu alcance, explico-te como ter o acesso completo. 🤝',
  ],
  // Passo 3.1.1 (pedir a data para calcular)
  askExamDate: [
    'Para eu calcular o teu valor certo: quando é o teu exame?',
  ],
  // Passo 3.1 (mensagem unica de pacote, enquanto o PDF nao esta configurado),
  // com a recomendacao de UM pacote ja calculada.
  packages: [
    '{recomendacao}',
    'Todos são de pagamento único: pagas o total de uma só vez, não é mensalidade.',
    'Assim que escolheres, diz-me aqui e eu explico como fazer o pagamento. O teu acesso fica activo logo que validarmos o comprovativo. 😊',
  ],
  // Fluxo 5: "NÃO CONSIGO ENTRAR" / "O SITE PEDE CONTA, E-MAIL OU CÓDIGO"
  accessProblem: [
    'Obrigado por avisares, [NOME]! 😊 Isso já está resolvido.',
    `Agora podes ver o capítulo 1 sem conta, sem e-mail e sem palavra-passe. Abre o link e toca em "Ver o capítulo 1 grátis": ${FREE_LINK}`,
    'Se ainda aparecer o pedido de conta, fecha o site e abre de novo (ou usa o Chrome). Se continuar, manda-me um print do ecrã. 🤝',
  ],
  // Fluxo 5: "O LINK NÃO ABRE"
  linkProblem: [
    `Vamos tentar de outra forma, [NOME]. 😊\n\n1. Copia o link: ${FREE_LINK}\n2. Abre o Chrome (no iPhone, o Safari) e cola no endereço\n3. Toca em "Ver o capítulo 1 grátis"`,
    'Confirma também se tens dados móveis ou Wi-Fi ligados. Se não abrir, diz-me o que aparece.',
  ],
  // Fluxo 5: "QUERIA PRESENCIAL"
  presencial: [
    'Percebo, [NOME]. 😊\n\nEstudar online funciona assim:\n1. Escolhes a disciplina e abres o capítulo\n2. Vês o vídeo curto e lês o resumo em PDF\n3. Treinas logo com perguntas tipo exame e vês onde precisas de melhorar',
    'Não há horários fixos: estudas quando quiseres, pelo telemóvel, e repetes quantas vezes precisares. Se tiveres dúvidas, podes pedir para falar com um profissional da disciplina, aqui no WhatsApp.',
    `Para veres como é na prática, o capítulo 1 é grátis e sem conta: ${FREE_LINK}\n\nConsegues abrir hoje e depois dizes-me o que achaste? 😊`,
  ],
  // Fluxo 5: "ESTÁ MUITO CARO"
  expensive: [
    'Compreendo, [NOME].\n\nPensemos juntos no que faz mais sentido para o seu caso.',
    'Se o exame estiver próximo, o pacote de 2 meses sai por 390 MZN para 1 disciplina.\n\nSe calhar vale a pena começar só com a disciplina em que tem mais dificuldade, em vez do pacote completo. Depois vemos se precisa de ampliar.',
    'Comece pelo capítulo 1 grátis e depois decidimos a melhor opção para o seu bolso.',
  ],
  // Fluxo 5: "O PAGAMENTO É SEGURO?"
  paymentSafe: [
    'É sim, [NOME].',
    'O pagamento é feito para o número M-Pesa ou e-Mola da Znerd, directamente da operadora.\n\nDepois faz upload do comprovativo na plataforma, e o acesso é activado pela nossa equipa.',
    'Já ajudámos vários estudantes assim.',
  ],
  // Fluxo 5: "VAI DAR PARA EU PASSAR?"
  willIPass: [
    'Vou ser honesto consigo, [NOME].',
    'A Zona Nerd dá o conteúdo, o método e a prática. Mas quem estuda és tu.\n\nSe dedicar algumas horas por semana, as suas probabilidades aumentam muito.',
    'Não prometemos admissões garantidas. Prometemos uma preparação sólida e organizada.',
    'Quer começar pelo capítulo 1 grátis e sentir como funciona?',
  ],
  // Fluxo 5: "O CAPÍTULO 1 É MUITO BÁSICO"
  tooBasic: [
    'Boa, [NOME]! 😊 Isso mostra que tens boa base.',
    'O capítulo 1 é só um capítulo de teste, para conheceres a plataforma. Por isso é mais básico. O conteúdo vai evoluindo gradualmente, capítulo a capítulo, até às questões mais complexas.',
    'Como o capítulo vai por ordem (vídeo, resumo e depois as perguntas tipo exame), passa pelo vídeo e pelo resumo com calma e rapidez, porque o que interessa são as perguntas no fim. Elas mostram o teu nível real. 🎯',
    'Experimenta e diz-me quantas acertas. Se acertares quase tudo, explico-te como avançar para os capítulos seguintes, onde os temas já são mais difíceis.',
  ],
  // Fluxo 5: "QUAL É O HORÁRIO DAS AULAS?" / "TEM ASSISTÊNCIA?"
  schedule: [
    'Não temos horário fixo, [NOME]. 😊 Estudas quando quiseres, ao teu ritmo, pelo telemóvel.',
    'Não ficas sozinho(a), tens acompanhamento personalizado. Se tiveres alguma dúvida, podes pedir para falar com um profissional da disciplina, aqui no WhatsApp. Não é por videochamada.',
    'Também não há custos extra pelas explicações. Só pagas o pacote de acesso, num só pagamento.',
  ],
  // Fluxo 5: "TENHO SMARTPHONE FRACO / INTERNET CARA"
  weakPhone: [
    'Entendo, [NOME]. A plataforma foi pensada para isso.',
    'Os vídeos são curtos e pode ver em qualidade baixa.\n\nOs PDFs são leves e ficam disponíveis offline depois de abertos.\n\nPode estudar quando apanhar Wi-Fi e rever a matéria sem gastar dados.',
    'Quer começar já pelo capítulo 1 grátis para testar?',
  ],
  // Fluxo 5: "POSSO PARTILHAR A CONTA?" (sem a linha dos [X] dias extra)
  shareAccount: [
    'A conta é individual, [NOME]. Se partilharem, o sistema pode bloquear.',
    'Mas há uma solução melhor: peça ao seu amigo para entrar aqui e dizer que vem por sua indicação.',
  ],
  // Se ele quiser so 1 mes
  oneMonth: [
    'Percebo, [NOME]. 😊 Não temos pacote de 1 mês. O mais curto é o Pacote A: 2 meses por 390 MZN.\n\nQueres começar por esse?',
  ],
  // "Em caso de dúvida" do guia: so serve de rascunho para a equipa (handoff
  // nao envia nada ao estudante; a equipa decide).
  handoffDraft: [
    'Boa pergunta, [NOME].\n\nDeixe-me confirmar com a equipa e volto já consigo.',
  ],
} satisfies Record<string, string[]>;

export type TemplateKey = keyof typeof T;
