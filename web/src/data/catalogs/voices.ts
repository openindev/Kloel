// Catálogo de vozes do diálogo "Selecionar voz" — 148 vozes na ordem exibida (OBSERVADO: docs/reference/fonio-live2/data/voices.json,
// 2026-10-18). Avatar: foto quando a referência tem foto (e o arquivo local existe — ver PHOTOS), senão o círculo colorido com a
// inicial (cores observadas). Vozes de sotaque neutro: 🌍 no lugar da bandeira. Prévia de áudio local (Web Speech API).
export interface Voice {
  id: string
  name: string
  /** sotaque/idioma exibido (sem o gênero) */
  accent: string
  /** linha completa sob o nome, ex. "Português · Feminino" ou "Italiano do norte · Masculino · Meia-idade" */
  detail: string
  gender: 'Feminino' | 'Masculino'
  color: string
  /** classe flag-icons sem o prefixo ("br", "gb-wls"…); vazio = sem bandeira (vozes de sotaque neutro) */
  flag: string
  /** idioma principal da voz (código do select Idioma; "multi" = sotaque neutro) */
  language: string
  /** selo lilás "Popular" ao lado do nome */
  popular?: boolean
  /** arquivo da foto na referência ("joana.jpeg"); ausente = voz sem foto (inicial colorida) */
  photo?: string
}

const V = (id: string, name: string, accent: string, detail: string, gender: Voice['gender'], color: string, flag: string, language: string, popular = false): Voice => ({ id, name, accent, detail, gender, color, flag, language, ...(popular ? { popular } : {}) })

const RAW: Voice[] = [
  V('joana', 'Joana', 'Português', 'Português · Feminino', 'Feminino', 'bg-emerald-600', 'br', 'pt-BR'),
  V('joana_mineiro', 'Joana (Mineiro)', 'Português (Mineiro)', 'Português (Mineiro) · Feminino', 'Feminino', 'bg-cyan-600', 'br', 'pt-BR'),
  V('marcelo', 'Marcelo', 'Português', 'Português · Masculino', 'Masculino', 'bg-rose-600', 'br', 'pt-BR'),
  V('marcelo_carioca', 'Marcelo (Carioca)', 'Português (Carioca)', 'Português (Carioca) · Masculino', 'Masculino', 'bg-fuchsia-600', 'br', 'pt-BR'),
  V('eduardo', 'Eduardo', 'Português', 'Português · Masculino', 'Masculino', 'bg-amber-600', 'br', 'pt-BR'),
  V('eduardo_gaucho', 'Eduardo (Gaúcho)', 'Português (Gaúcho)', 'Português (Gaúcho) · Masculino', 'Masculino', 'bg-emerald-600', 'br', 'pt-BR'),
  V('gabriela', 'Gabriela', 'Português', 'Português · Feminino', 'Feminino', 'bg-teal-600', 'br', 'pt-BR'),
  V('bruna', 'Bruna', 'Português', 'Português · Feminino', 'Feminino', 'bg-blue-600', 'br', 'pt-BR'),
  V('carla', 'Carla', 'Português', 'Português · Feminino', 'Feminino', 'bg-rose-600', 'br', 'pt-BR'),
  V('carla_carioca', 'Carla (Carioca)', 'Português (Carioca)', 'Português (Carioca) · Feminino', 'Feminino', 'bg-fuchsia-600', 'br', 'pt-BR'),
  V('roberta', 'Roberta', 'Português', 'Português · Feminino', 'Feminino', 'bg-teal-600', 'br', 'pt-BR'),
  V('roberta_carioca', 'Roberta (Carioca)', 'Português (Carioca)', 'Português (Carioca) · Feminino', 'Feminino', 'bg-violet-600', 'br', 'pt-BR'),
  V('duarte', 'Duarte', 'Português', 'Português · Masculino', 'Masculino', 'bg-cyan-600', 'br', 'pt-BR'),
  V('duarte_catarinense', 'Duarte (Catarinense)', 'Português (Catarinense)', 'Português (Catarinense) · Masculino', 'Masculino', 'bg-rose-600', 'br', 'pt-BR'),
  V('camila', 'Camila', 'Português', 'Português · Feminino', 'Feminino', 'bg-teal-600', 'br', 'pt-BR'),
  V('larissa', 'Larissa', 'Português', 'Português · Feminino', 'Feminino', 'bg-teal-600', 'br', 'pt-BR'),
  V('larissa_nordestino', 'Larissa (Nordestino)', 'Português (Nordestino)', 'Português (Nordestino) · Feminino', 'Feminino', 'bg-cyan-600', 'br', 'pt-BR'),
  V('luis', 'Luis', 'Português', 'Português · Masculino', 'Masculino', 'bg-cyan-600', 'br', 'pt-BR'),
  V('luis_nordestino', 'Luis (Nordestino)', 'Português (Nordestino)', 'Português (Nordestino) · Masculino', 'Masculino', 'bg-rose-600', 'br', 'pt-BR'),
  V('rafaela', 'Rafaela', 'Português', 'Português · Feminino', 'Feminino', 'bg-amber-600', 'br', 'pt-BR'),
  V('rafaela_gaucho', 'Rafaela (Gaúcho)', 'Português (Gaúcho)', 'Português (Gaúcho) · Feminino', 'Feminino', 'bg-emerald-600', 'br', 'pt-BR'),
  V('gustavo', 'Gustavo', 'Português', 'Português · Masculino', 'Masculino', 'bg-emerald-600', 'br', 'pt-BR'),
  V('beatriz', 'Beatriz', 'Português', 'Português · Feminino', 'Feminino', 'bg-emerald-600', 'br', 'pt-BR'),
  V('thiago', 'Thiago', 'Português', 'Português · Masculino', 'Masculino', 'bg-amber-600', 'br', 'pt-BR'),
  V('carina', 'Carina', 'Alemão', 'Alemão · Feminino', 'Feminino', 'bg-fuchsia-600', 'de', 'de', true),
  V('dirk', 'Dirk', 'Alemão', 'Alemão · Masculino', 'Masculino', 'bg-blue-600', 'de', 'de', true),
  V('verena', 'Verena', 'Alemão', 'Alemão · Feminino', 'Feminino', 'bg-emerald-600', 'de', 'de', true),
  V('hannah', 'Hannah', 'Alemão', 'Alemão · Feminino', 'Feminino', 'bg-violet-600', 'de', 'de', true),
  V('heidi', 'Heidi', 'Suíço', 'Suíço · Feminino', 'Feminino', 'bg-cyan-600', 'ch', 'de-CH', true),
  V('ladina', 'Ladina', 'Suíço', 'Suíço · Feminino', 'Feminino', 'bg-emerald-600', 'ch', 'de-CH', true),
  V('seraina', 'Seraina', 'Suíço', 'Suíço · Feminino', 'Feminino', 'bg-rose-600', 'ch', 'de-CH', true),
  V('martin', 'Martin', 'Austríaco', 'Austríaco · Masculino', 'Masculino', 'bg-teal-600', 'at', 'de', true),
  V('cristina', 'Cristina', 'Espanhol', 'Espanhol · Feminino', 'Feminino', 'bg-blue-600', 'es', 'es', true),
  V('marta', 'Marta', 'Espanhol', 'Espanhol · Feminino', 'Feminino', 'bg-blue-600', 'es', 'es', true),
  V('marie', 'Marie', 'Austríaco', 'Austríaco · Feminino', 'Feminino', 'bg-violet-600', 'at', 'de'),
  V('julia', 'Julia', 'Alemão', 'Alemão · Feminino', 'Feminino', 'bg-blue-600', 'de', 'de'),
  V('christian', 'Christian', 'Alemão', 'Alemão · Masculino', 'Masculino', 'bg-violet-600', 'de', 'de'),
  V('miriam', 'Miriam', 'Alemão', 'Alemão · Feminino', 'Feminino', 'bg-teal-600', 'de', 'de'),
  V('katja', 'Katja', 'Alemão', 'Alemão · Feminino', 'Feminino', 'bg-amber-600', 'de', 'de'),
  V('erik', 'Erik', 'Alemão', 'Alemão · Masculino', 'Masculino', 'bg-blue-600', 'de', 'de'),
  V('marine', 'Marine', 'Francês', 'Francês · Feminino', 'Feminino', 'bg-rose-600', 'fr', 'fr'),
  V('augustin', 'Augustin', 'Francês', 'Francês · Masculino', 'Masculino', 'bg-cyan-600', 'fr', 'fr'),
  V('dario', 'Dario', 'Italiano do norte', 'Italiano do norte · Masculino · Meia-idade', 'Masculino', 'bg-rose-600', 'it', 'it'),
  V('domenico', 'Domenico', 'Napolitano', 'Napolitano · Masculino · Meia-idade', 'Masculino', 'bg-cyan-600', 'it', 'it'),
  V('richard', 'Richard', 'Holandês', 'Holandês · Masculino', 'Masculino', 'bg-rose-600', 'nl', 'nl'),
  V('alex', 'Alex', 'Espanhol', 'Espanhol · Masculino', 'Masculino', 'bg-violet-600', 'es', 'es'),
  V('lucia', 'Lucia', 'Latino-americano', 'Latino-americano · Feminino', 'Feminino', 'bg-fuchsia-600', 'es', 'es'),
  V('mark', 'Mark', 'Americano', 'Americano · Masculino', 'Masculino', 'bg-teal-600', 'us', 'en-US'),
  V('matt', 'Matt', 'Britânico', 'Britânico · Masculino', 'Masculino', 'bg-cyan-600', 'gb', 'en-GB'),
  V('szymon', 'Szymon', 'Polonês', 'Polonês · Masculino', 'Masculino', 'bg-rose-600', 'pl', 'pl'),
  V('theres', 'Theres', 'Alemão', 'Alemão · Feminino · Jovem', 'Feminino', 'bg-emerald-600', 'de', 'de'),
  V('leonie', 'Leonie', 'Alemão', 'Alemão · Feminino · Jovem', 'Feminino', 'bg-amber-600', 'de', 'de'),
  V('elsa', 'Elsa', 'Alemão', 'Alemão · Feminino', 'Feminino', 'bg-amber-600', 'de', 'de'),
  V('david', 'David', 'Alemão', 'Alemão · Masculino', 'Masculino', 'bg-violet-600', 'de', 'de'),
  V('jakob', 'Jakob', 'Austríaco', 'Austríaco · Masculino', 'Masculino', 'bg-emerald-600', 'at', 'de'),
  V('alexander', 'Alexander', 'Alemão', 'Alemão · Masculino', 'Masculino', 'bg-violet-600', 'de', 'de'),
  V('maria', 'Maria', 'Americano', 'Americano · Feminino', 'Feminino', 'bg-emerald-600', 'us', 'en-US'),
  V('severin', 'Severin', 'Suíço', 'Suíço · Masculino', 'Masculino', 'bg-rose-600', 'ch', 'de-CH'),
  V('valerie', 'Valerie', 'Austríaco', 'Austríaco · Feminino', 'Feminino', 'bg-blue-600', 'at', 'de'),
  V('fabienne', 'Fabienne', 'Suíço (Berna)', 'Suíço (Berna) · Feminino', 'Feminino', 'bg-blue-600', 'ch', 'de-CH'),
  V('ramona', 'Ramona', 'Suíço (Berna)', 'Suíço (Berna) · Feminino', 'Feminino', 'bg-fuchsia-600', 'ch', 'de-CH'),
  V('corinne', 'Corinne', 'Suíço (Rheintal)', 'Suíço (Rheintal) · Feminino', 'Feminino', 'bg-fuchsia-600', 'ch', 'de-CH'),
  V('reto', 'Reto', 'Suíço (Argóvia)', 'Suíço (Argóvia) · Masculino', 'Masculino', 'bg-violet-600', 'ch', 'de-CH'),
  V('nadja', 'Nadja', 'Suíço (Schwyz)', 'Suíço (Schwyz) · Feminino', 'Feminino', 'bg-fuchsia-600', 'ch', 'de-CH'),
  V('salome', 'Salome', 'Suíço (Argóvia)', 'Suíço (Argóvia) · Feminino', 'Feminino', 'bg-emerald-600', 'ch', 'de-CH'),
  V('silvan', 'Silvan', 'Suíço (Argóvia)', 'Suíço (Argóvia) · Masculino', 'Masculino', 'bg-cyan-600', 'ch', 'de-CH'),
  V('livia', 'Livia', 'Suíço (Basileia)', 'Suíço (Basileia) · Feminino', 'Feminino', 'bg-cyan-600', 'ch', 'de-CH'),
  V('pascal', 'Pascal', 'Suíço (Basileia)', 'Suíço (Basileia) · Masculino', 'Masculino', 'bg-amber-600', 'ch', 'de-CH'),
  V('andrina', 'Andrina', 'Suíço (Zurique)', 'Suíço (Zurique) · Feminino', 'Feminino', 'bg-cyan-600', 'ch', 'de-CH'),
  V('brigitte', 'Brigitte', 'Austríaco', 'Austríaco · Feminino', 'Feminino', 'bg-violet-600', 'at', 'de'),
  V('magdalena', 'Magdalena', 'Austríaco', 'Austríaco · Feminino', 'Feminino', 'bg-violet-600', 'at', 'de'),
  V('nina', 'Nina', 'Alemão', 'Alemão · Feminino', 'Feminino', 'bg-fuchsia-600', 'de', 'de'),
  V('lisa', 'Lisa', 'Italiano do norte', 'Italiano do norte · Feminino · Meia-idade', 'Feminino', 'bg-fuchsia-600', 'it', 'it'),
  V('francesca', 'Francesca', 'Italiano do norte', 'Italiano do norte · Feminino · Meia-idade', 'Feminino', 'bg-fuchsia-600', 'it', 'it'),
  V('claudia', 'Claudia', 'Italiano', 'Italiano · Feminino', 'Feminino', 'bg-fuchsia-600', 'it', 'it'),
  V('melanie', 'Melanie', 'Holandês', 'Holandês · Feminino', 'Feminino', 'bg-teal-600', 'nl', 'nl'),
  V('marianne', 'Marianne', 'Holandês', 'Holandês · Feminino · Sênior', 'Feminino', 'bg-amber-600', 'nl', 'nl'),
  V('femke', 'Femke', 'Holandês', 'Holandês · Feminino', 'Feminino', 'bg-cyan-600', 'nl', 'nl'),
  V('lotte', 'Lotte', 'Holandês', 'Holandês · Feminino', 'Feminino', 'bg-violet-600', 'nl', 'nl'),
  V('bram', 'Bram', 'Holandês', 'Holandês · Masculino', 'Masculino', 'bg-cyan-600', 'nl', 'nl'),
  V('olivia', 'Olivia', 'Britânico', 'Britânico · Feminino', 'Feminino', 'bg-amber-600', 'gb', 'en-GB'),
  V('lauren', 'Lauren', 'Americano', 'Americano · Feminino', 'Feminino', 'bg-amber-600', 'us', 'en-US'),
  V('nicole', 'Nicole', 'Americano', 'Americano · Feminino', 'Feminino', 'bg-emerald-600', 'us', 'en-US'),
  V('jenny', 'Jenny', 'Americano', 'Americano · Feminino', 'Feminino', 'bg-amber-600', 'us', 'en-US'),
  V('tyler', 'Tyler', 'Americano', 'Americano · Masculino', 'Masculino', 'bg-blue-600', 'us', 'en-US'),
  V('brian', 'Brian', 'Americano', 'Americano · Masculino', 'Masculino', 'bg-fuchsia-600', 'us', 'en-US'),
  V('ashley', 'Ashley', 'Americano', 'Americano · Feminino', 'Feminino', 'bg-fuchsia-600', 'us', 'en-US'),
  V('rhys', 'Rhys', 'Galês', 'Galês · Masculino', 'Masculino', 'bg-fuchsia-600', 'gb-wls', 'en-GB'),
  V('megan', 'Megan', 'Galês', 'Galês · Feminino', 'Feminino', 'bg-blue-600', 'gb-wls', 'en-GB'),
  V('callum', 'Callum', 'Escocês', 'Escocês · Masculino', 'Masculino', 'bg-fuchsia-600', 'gb-sct', 'en-GB'),
  V('lewis', 'Lewis', 'Britânico', 'Britânico · Masculino', 'Masculino', 'bg-amber-600', 'gb', 'en-GB'),
  V('james', 'James', 'Britânico', 'Britânico · Masculino', 'Masculino', 'bg-amber-600', 'gb', 'en-GB'),
  V('niamh', 'Niamh', 'Irlandês', 'Irlandês · Feminino', 'Feminino', 'bg-cyan-600', 'ie', 'en-GB'),
  V('charlotte', 'Charlotte', 'Britânico', 'Britânico · Feminino', 'Feminino', 'bg-fuchsia-600', 'gb', 'en-GB'),
  V('koraly', 'Koraly', 'Francês', 'Francês · Feminino', 'Feminino', 'bg-emerald-600', 'fr', 'fr'),
  V('micha', 'Micha', 'Francês Suíço', 'Francês Suíço · Feminino', 'Feminino', 'bg-rose-600', 'ch', 'fr'),
  V('claire', 'Claire', 'Francês', 'Francês · Feminino', 'Feminino', 'bg-teal-600', 'fr', 'fr'),
  V('mimi', 'Mimi', 'Francês', 'Francês · Feminino', 'Feminino', 'bg-rose-600', 'fr', 'fr'),
  V('adrien', 'Adrien', 'Francês', 'Francês · Masculino', 'Masculino', 'bg-blue-600', 'fr', 'fr'),
  V('victoria', 'Victoria', 'Francês', 'Francês · Feminino', 'Feminino', 'bg-amber-600', 'fr', 'fr'),
  V('ingrid', 'Ingrid', 'Francês', 'Francês · Feminino', 'Feminino', 'bg-teal-600', 'fr', 'fr'),
  V('marc', 'Marc', 'Francês', 'Francês · Masculino', 'Masculino', 'bg-fuchsia-600', 'fr', 'fr'),
  V('bastien', 'Bastien', 'Francês', 'Francês · Masculino', 'Masculino', 'bg-cyan-600', 'fr', 'fr'),
  V('margaux', 'Margaux', 'Francês', 'Francês · Feminino', 'Feminino', 'bg-violet-600', 'fr', 'fr'),
  V('marco', 'Marco', 'Italiano', 'Italiano · Masculino · Meia-idade', 'Masculino', 'bg-teal-600', 'it', 'it'),
  V('valentina', 'Valentina', 'Italiano do norte', 'Italiano do norte · Feminino · Meia-idade', 'Feminino', 'bg-violet-600', 'it', 'it'),
  V('chiara', 'Chiara', 'Italiano do norte', 'Italiano do norte · Feminino · Sênior', 'Feminino', 'bg-blue-600', 'it', 'it'),
  V('gianmarco', 'Gianmarco', 'Italiano', 'Italiano · Masculino · Sênior', 'Masculino', 'bg-fuchsia-600', 'it', 'it'),
  V('bianca', 'Bianca', 'Italiano', 'Italiano · Feminino', 'Feminino', 'bg-rose-600', 'it', 'it'),
  V('tommaso', 'Tommaso', 'Italiano', 'Italiano · Masculino', 'Masculino', 'bg-rose-600', 'it', 'it'),
  V('javier', 'Javier', 'Espanhol', 'Espanhol · Masculino', 'Masculino', 'bg-emerald-600', 'es', 'es'),
  V('sergio', 'Sergio', 'Espanhol', 'Espanhol · Masculino', 'Masculino', 'bg-emerald-600', 'es', 'es'),
  V('carmen', 'Carmen', 'Espanhol', 'Espanhol · Feminino', 'Feminino', 'bg-fuchsia-600', 'es', 'es'),
  V('paula', 'Paula', 'Espanhol', 'Espanhol · Feminino', 'Feminino', 'bg-rose-600', 'es', 'es'),
  V('aleksandra', 'Aleksandra', 'Polonês', 'Polonês · Feminino', 'Feminino', 'bg-fuchsia-600', 'pl', 'pl'),
  V('monika', 'Monika', 'Polonês', 'Polonês · Feminino', 'Feminino', 'bg-teal-600', 'pl', 'pl'),
  V('aneta', 'Aneta', 'Polonês', 'Polonês · Feminino', 'Feminino', 'bg-cyan-600', 'pl', 'pl'),
  V('damian', 'Damian', 'Polonês', 'Polonês · Masculino', 'Masculino', 'bg-emerald-600', 'pl', 'pl'),
  V('kamil', 'Kamil', 'Polonês', 'Polonês · Masculino', 'Masculino', 'bg-blue-600', 'pl', 'pl'),
  V('ryszard', 'Ryszard', 'Polonês', 'Polonês · Masculino', 'Masculino', 'bg-cyan-600', 'pl', 'pl'),
  V('piotr', 'Piotr', 'Polonês', 'Polonês · Masculino', 'Masculino', 'bg-cyan-600', 'pl', 'pl'),
  V('anna_pl', 'Anna', 'Polonês', 'Polonês · Feminino', 'Feminino', 'bg-rose-600', 'pl', 'pl'),
  V('oriol', 'Oriol', 'Catalão', 'Catalão · Masculino', 'Masculino', 'bg-cyan-600', 'es-ct', 'ca'),
  V('mireia', 'Mireia', 'Catalão', 'Catalão · Feminino', 'Feminino', 'bg-teal-600', 'es-ct', 'ca'),
  V('bence', 'Bence', 'Húngaro', 'Húngaro · Masculino', 'Masculino', 'bg-cyan-600', 'hu', 'hu'),
  V('eszter', 'Eszter', 'Húngaro', 'Húngaro · Feminino', 'Feminino', 'bg-cyan-600', 'hu', 'hu'),
  V('nathan', 'Nathan', 'Americano', 'Americano · Masculino', 'Masculino', 'bg-violet-600', 'us', 'en-US'),
  V('aaron', 'Aaron', 'Americano', 'Americano · Masculino', 'Masculino', 'bg-teal-600', 'us', 'en-US'),
  V('henry', 'Henry', 'Britânico', 'Britânico · Masculino', 'Masculino', 'bg-teal-600', 'gb', 'en-GB'),
  V('oliver', 'Oliver', 'Britânico', 'Britânico · Masculino', 'Masculino', 'bg-emerald-600', 'gb', 'en-GB'),
  V('julien', 'Julien', 'Francês', 'Francês · Masculino', 'Masculino', 'bg-blue-600', 'fr', 'fr'),
  V('daniela', 'Daniela', 'Latino-americano', 'Latino-americano · Feminino', 'Feminino', 'bg-fuchsia-600', 'es', 'es'),
  V('diego', 'Diego', 'Latino-americano', 'Latino-americano · Masculino', 'Masculino', 'bg-blue-600', 'es', 'es'),
  V('jordi', 'Jordi', 'Catalão', 'Catalão · Masculino', 'Masculino', 'bg-blue-600', 'es-ct', 'ca'),
  V('xiulan', 'Xiulan', 'Mandarim', 'Mandarim · Feminino', 'Feminino', 'bg-emerald-600', 'cn', 'zh'),
  V('lihua', 'Lihua', 'Mandarim', 'Mandarim · Feminino', 'Feminino', 'bg-rose-600', 'cn', 'zh'),
  V('junjie', 'Junjie', 'Mandarim', 'Mandarim · Masculino', 'Masculino', 'bg-cyan-600', 'cn', 'zh'),
  V('jiayi', 'Jiayi', 'Mandarim', 'Mandarim · Feminino', 'Feminino', 'bg-fuchsia-600', 'cn', 'zh'),
  V('meilin', 'Meilin', 'Mandarim', 'Mandarim · Feminino', 'Feminino', 'bg-fuchsia-600', 'cn', 'zh'),
  V('zhihao', 'Zhihao', 'Mandarim', 'Mandarim · Masculino', 'Masculino', 'bg-rose-600', 'cn', 'zh'),
  V('elke', 'Elke', 'Flamengo', 'Flamengo · Feminino · Meia-idade', 'Feminino', 'bg-emerald-600', 'be', 'nl'),
  V('aisha', 'Aisha', 'Árabe', 'Árabe · Feminino', 'Feminino', 'bg-emerald-600', 'ae', 'ar'),
  V('betul', 'Betül', 'Turco', 'Turco · Feminino', 'Feminino', 'bg-rose-600', 'tr', 'tr'),
  V('ahmed', 'Ahmed', 'Árabe', 'Árabe · Masculino', 'Masculino', 'bg-amber-600', 'ae', 'ar'),
  V('harun', 'Harun', 'Turco', 'Turco · Masculino', 'Masculino', 'bg-violet-600', 'tr', 'tr'),
  V('anna', 'Anna', 'Sotaque neutro — pronúncia mais fraca de números e nomes', 'Sotaque neutro — pronúncia mais fraca de números e nomes · Feminino', 'Feminino', 'bg-fuchsia-600', '', 'multi'),
  V('emily', 'Emily', 'Sotaque neutro — pronúncia mais fraca de números e nomes', 'Sotaque neutro — pronúncia mais fraca de números e nomes · Feminino', 'Feminino', 'bg-violet-600', '', 'multi'),
  V('ben', 'Ben', 'Sotaque neutro — pronúncia mais fraca de números e nomes', 'Sotaque neutro — pronúncia mais fraca de números e nomes · Masculino', 'Masculino', 'bg-blue-600', '', 'multi'),
]

/**
 * Foto de cada voz na referência (arquivo de /agent-images/voices/ em data/voices.json; 87 das 148 vozes). As vozes sem foto usam o
 * círculo colorido com a inicial (cores observadas). A foto só aparece quando o arquivo existe em src/assets/voices/<arquivo>
 * (decisão de licença do orquestrador); sem o arquivo a voz mantém a inicial — nenhuma requisição quebrada.
 */
const PHOTOS: Record<string, string> = {
  joana: 'joana.jpeg', joana_mineiro: 'joana_mineiro.jpeg', marcelo: 'marcelo.jpeg', marcelo_carioca: 'marcelo_carioca.jpeg',
  eduardo: 'eduardo.jpeg', eduardo_gaucho: 'eduardo_gaucho.jpeg', gabriela: 'gabriela.jpeg', carla: 'carla.jpeg',
  carla_carioca: 'carla_carioca.jpeg', roberta: 'roberta.jpeg', roberta_carioca: 'roberta_carioca.jpeg', duarte: 'marcos.jpeg',
  luis: 'luis.jpeg', luis_nordestino: 'luis_nordestino.jpeg', dirk: 'dirk.jpeg', hannah: 'hannah.jpeg', heidi: 'heidi.jpeg',
  martin: 'martin.jpeg', cristina: 'cristina.jpeg', marta: 'marta.jpeg', marie: 'marie.jpeg', julia: 'julia.jpeg',
  christian: 'christian.jpeg', katja: 'katja.jpeg', erik: 'erik.jpeg', marine: 'marine.jpeg', augustin: 'augustin.jpeg',
  dario: 'dario.jpeg', domenico: 'domenico.jpeg', richard: 'richard.jpeg', alex: 'alex.jpeg', mark: 'mark.jpeg', matt: 'matt.jpeg',
  szymon: 'szymon.jpeg', theres: 'theres.jpeg', elsa: 'elsa.jpeg', david: 'david.jpeg', jakob: 'jakob.jpeg', alexander: 'alexander.jpeg',
  maria: 'maria.jpeg', severin: 'severin_vc_v1.jpeg', lisa: 'lisa.jpeg', claudia: 'claudia.jpeg', melanie: 'melanie.jpeg',
  marianne: 'marianne.jpeg', femke: 'femke.jpeg', lotte: 'lotte.jpeg', bram: 'bram.jpeg', olivia: 'olivia.jpeg', lauren: 'lauren.jpeg',
  nicole: 'nicole.jpeg', jenny: 'jenny.jpeg', brian: 'brian.jpeg', james: 'james.jpeg', koraly: 'koraly.jpeg', micha: 'micha.jpeg',
  claire: 'claire.jpeg', mimi: 'mimi.jpeg', adrien: 'adrien.jpeg', victoria: 'victoria.jpeg', ingrid: 'ingrid.jpeg', marc: 'marc.jpeg',
  bastien: 'bastien.jpeg', margaux: 'margaux.jpeg', marco: 'marco_it.jpeg', gianmarco: 'gianmarco.jpeg', bianca: 'bianca.jpeg',
  tommaso: 'tommaso.jpeg', aleksandra: 'aleksandra.jpeg', monika: 'monika.jpeg', aneta: 'aneta.jpeg', damian: 'damian.jpeg',
  kamil: 'kamil.jpeg', ryszard: 'ryszard.jpeg', piotr: 'piotr.jpeg', anna_pl: 'anna_pl.jpeg', aaron: 'evan_stock.jpeg',
  henry: 'clive_stock.jpeg', oliver: 'duncan_stock.jpeg', julien: 'alain_stock.jpeg', aisha: 'aisha.jpeg', betul: 'betuel.jpeg',
  ahmed: 'ahmed.jpeg', harun: 'harun.jpeg', anna: 'anna.jpeg', emily: 'riley_stock.jpeg', ben: 'ben.jpeg',
}

export const VOICES: Voice[] = RAW.map((v) => (PHOTOS[v.id] ? { ...v, photo: PHOTOS[v.id] } : v))

/** URLs das fotos disponíveis localmente (src/assets/voices/*). Vazio enquanto as fotos não forem incluídas no projeto. */
const LOCAL_PHOTOS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>('/src/assets/voices/*.{jpeg,jpg,png,webp}', { eager: true, query: '?url', import: 'default' })).map(([path, url]) => [
    path.slice(path.lastIndexOf('/') + 1),
    url,
  ]),
)

/** URL da foto da voz, se a referência tem foto e o arquivo existe localmente. */
export const voicePhotoUrl = (v: Voice): string | undefined => (v.photo ? LOCAL_PHOTOS[v.photo] : undefined)

/** Filtro de idioma do diálogo ("Todos" + os 41 idiomas, mesma ordem do select Idioma). */
export const VOICE_FILTERS: string[] = ['all', 'pt-BR', 'pt', 'multi', 'de', 'de-CH', 'ar', 'bn', 'bg', 'yue', 'ca', 'zh', 'ko', 'hr', 'da', 'sk', 'sl', 'es', 'et', 'fi', 'fr', 'el', 'hi', 'nl', 'hu', 'en', 'en-US', 'en-GB', 'it', 'ja', 'lt', 'no', 'fa', 'pl', 'ro', 'ru', 'sr', 'sv', 'cs', 'tr', 'uk', 'ur']

/** Ordem exibida por filtro de idioma (gênero = Todos). Ausente = todas as vozes ("Todos" e "Multi"). */
const BY_LANGUAGE: Record<string, string[]> = {
  'pt-BR': ['joana', 'joana_mineiro', 'marcelo', 'marcelo_carioca', 'eduardo', 'eduardo_gaucho', 'gabriela', 'bruna', 'carla', 'carla_carioca', 'roberta', 'roberta_carioca', 'duarte', 'duarte_catarinense', 'camila', 'larissa', 'larissa_nordestino', 'luis', 'luis_nordestino', 'rafaela', 'rafaela_gaucho', 'gustavo', 'beatriz', 'thiago', 'anna', 'emily', 'ben'],
  'pt': ['joana', 'joana_mineiro', 'marcelo', 'marcelo_carioca', 'eduardo', 'eduardo_gaucho', 'gabriela', 'bruna', 'carla', 'carla_carioca', 'roberta', 'roberta_carioca', 'duarte', 'duarte_catarinense', 'camila', 'larissa', 'larissa_nordestino', 'luis', 'luis_nordestino', 'rafaela', 'rafaela_gaucho', 'gustavo', 'beatriz', 'thiago', 'anna', 'emily', 'ben'],
  'de': ['carina', 'dirk', 'verena', 'hannah', 'julia', 'christian', 'miriam', 'katja', 'erik', 'theres', 'leonie', 'elsa', 'david', 'alexander', 'nina', 'heidi', 'ladina', 'seraina', 'severin', 'fabienne', 'ramona', 'corinne', 'reto', 'nadja', 'salome', 'silvan', 'livia', 'pascal', 'andrina', 'martin', 'marie', 'jakob', 'valerie', 'brigitte', 'magdalena', 'anna', 'emily', 'ben'],
  'de-CH': ['heidi', 'ladina', 'seraina', 'severin', 'fabienne', 'ramona', 'corinne', 'reto', 'nadja', 'salome', 'silvan', 'livia', 'pascal', 'andrina', 'martin', 'marie', 'jakob', 'valerie', 'brigitte', 'magdalena', 'carina', 'dirk', 'verena', 'hannah', 'julia', 'christian', 'miriam', 'katja', 'erik', 'theres', 'leonie', 'elsa', 'david', 'alexander', 'nina', 'anna', 'emily', 'ben'],
  'ar': ['aisha', 'ahmed', 'anna', 'emily', 'ben'],
  'bn': ['anna', 'emily', 'ben'],
  'bg': ['anna', 'emily', 'ben'],
  'yue': ['xiulan', 'lihua', 'junjie', 'jiayi', 'meilin', 'zhihao', 'anna', 'emily', 'ben'],
  'ca': ['oriol', 'mireia', 'jordi', 'anna', 'emily', 'ben'],
  'zh': ['xiulan', 'lihua', 'junjie', 'jiayi', 'meilin', 'zhihao', 'anna', 'emily', 'ben'],
  'ko': ['anna', 'emily', 'ben'],
  'hr': ['anna', 'emily', 'ben'],
  'da': ['anna', 'emily', 'ben'],
  'sk': ['anna', 'emily', 'ben'],
  'sl': ['anna', 'emily', 'ben'],
  'es': ['cristina', 'marta', 'alex', 'lucia', 'javier', 'sergio', 'carmen', 'paula', 'daniela', 'diego', 'anna', 'emily', 'ben'],
  'et': ['anna', 'emily', 'ben'],
  'fi': ['anna', 'emily', 'ben'],
  'fr': ['marine', 'augustin', 'koraly', 'micha', 'claire', 'mimi', 'adrien', 'victoria', 'ingrid', 'marc', 'bastien', 'margaux', 'julien', 'anna', 'emily', 'ben'],
  'el': ['anna', 'emily', 'ben'],
  'hi': ['anna', 'emily', 'ben'],
  'nl': ['richard', 'melanie', 'marianne', 'femke', 'lotte', 'bram', 'elke', 'anna', 'emily', 'ben'],
  'hu': ['bence', 'eszter', 'anna', 'emily', 'ben'],
  'en': ['mark', 'matt', 'maria', 'olivia', 'lauren', 'nicole', 'jenny', 'tyler', 'brian', 'ashley', 'rhys', 'megan', 'callum', 'lewis', 'james', 'niamh', 'charlotte', 'nathan', 'aaron', 'henry', 'oliver', 'anna', 'emily', 'ben'],
  'en-US': ['mark', 'maria', 'lauren', 'nicole', 'jenny', 'tyler', 'brian', 'ashley', 'nathan', 'aaron', 'anna', 'emily', 'ben'],
  'en-GB': ['matt', 'olivia', 'rhys', 'megan', 'callum', 'lewis', 'james', 'niamh', 'charlotte', 'henry', 'oliver', 'anna', 'emily', 'ben'],
  'it': ['dario', 'domenico', 'lisa', 'francesca', 'claudia', 'marco', 'valentina', 'chiara', 'gianmarco', 'bianca', 'tommaso', 'anna', 'emily', 'ben'],
  'ja': ['anna', 'emily', 'ben'],
  'lt': ['anna', 'emily', 'ben'],
  'no': ['anna', 'emily', 'ben'],
  'fa': ['anna', 'emily', 'ben'],
  'pl': ['szymon', 'aleksandra', 'monika', 'aneta', 'damian', 'kamil', 'ryszard', 'piotr', 'anna_pl', 'anna', 'emily', 'ben'],
  'ro': ['anna', 'emily', 'ben'],
  'ru': ['jordi', 'anna', 'emily', 'ben'],
  'sr': ['anna', 'emily', 'ben'],
  'sv': ['anna', 'emily', 'ben'],
  'cs': ['anna', 'emily', 'ben'],
  'tr': ['betul', 'harun', 'anna', 'emily', 'ben'],
  'uk': ['anna', 'emily', 'ben'],
  'ur': ['anna', 'emily', 'ben'],
}

/** Vozes de um filtro de idioma, na ordem exibida pela referência. */
export function voicesForLanguage(code: string): Voice[] {
  const ids = BY_LANGUAGE[code]
  if (!ids) return VOICES
  return ids.map((id) => VOICES.find((v) => v.id === id)!).filter(Boolean)
}

export const voiceById = (id: string) => VOICES.find((v) => v.id === id) ?? VOICES[0]!
