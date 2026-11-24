/**
 * Interpretador de nomes do fornecedor (inglês) → português + categorias.
 *
 *   interpretar("Sporting CP 26/27 Home Kids Kit Jersey Size 16-28", ["Primeira Liga", "Sporting CP"])
 *   → { titulo: "Equipamento Criança Sporting 2026/27 Principal",
 *       categorias: ["Liga Portugal", "Sporting", "Crianças"],
 *       tamanhos: ["16","18","20","22","24","26","28"] }
 *
 * Como funciona: o título é partido em palavras e comparado, da expressão mais longa para a
 * mais curta, com os dicionários abaixo (clubes, seleções, versões, cores, peças…).
 * O que não for reconhecido é mantido no fim do título, tal como estava.
 * Para ensinar o sistema basta acrescentar entradas aos dicionários.
 */

export interface Interpretacao {
  titulo: string;
  categorias: string[]; // [liga, clube, tipo] — os níveis em falta são omitidos
  tamanhos: string[]; // tamanhos indicados no título (vazio se não houver)
  original: string;
}

type Gen = 'm' | 'f';
/** formas: [masc. sing., fem. sing., masc. pl., fem. pl.] — uma só forma = invariável */
type Formas = [string] | [string, string, string, string];

// ---------------------------------------------------------------------------
// Ligas e categorias de topo
// ---------------------------------------------------------------------------

export const LIGA = {
  PT: 'Liga Portugal',
  ENG: 'Premier League',
  ESP: 'La Liga',
  ITA: 'Serie A',
  ALE: 'Bundesliga',
  FRA: 'Ligue 1',
  BRA: 'Brasileirão',
  HOL: 'Eredivisie',
  ESC: 'Liga Escocesa',
  ARG: 'Liga Argentina',
  MLS: 'MLS',
  MEX: 'Liga MX',
  CHI: 'Liga Chilena',
  SAU: 'Liga Saudita',
  JAP: 'Liga Japonesa',
  SEL: 'Seleções',
  OUT: 'Outros Clubes',
} as const;

/** Nomes de categorias do fornecedor (pastas) → liga ou tipo. */
const CATEGORIAS_FORNECEDOR: [string[], { liga?: string; tipo?: string; desporto?: string }][] = [
  [['primeira liga', 'liga portugal', 'liga portuguesa'], { liga: LIGA.PT }],
  [['premier league', 'english league', 'epl'], { liga: LIGA.ENG }],
  [['la liga', 'laliga', 'spanish league'], { liga: LIGA.ESP }],
  [['serie a', 'italian league'], { liga: LIGA.ITA }],
  [['bundesliga', 'german league'], { liga: LIGA.ALE }],
  [['ligue 1', 'french league'], { liga: LIGA.FRA }],
  [['brasileiro serie a', 'brasileirao', 'brazilian league', 'brazil team column'], { liga: LIGA.BRA }],
  [['eredivisie', 'dutch league'], { liga: LIGA.HOL }],
  [['scottish league', 'scottish premiership'], { liga: LIGA.ESC }],
  [['liga profesional', 'argentine league', 'argentina league'], { liga: LIGA.ARG }],
  [['mls'], { liga: LIGA.MLS }],
  [['liga mx', 'mexican league'], { liga: LIGA.MEX }],
  [['chilean league'], { liga: LIGA.CHI }],
  [['saudi league', 'saudi pro league', 'saf'], { liga: LIGA.SAU }],
  [['japan league', 'j league', 'j1 league'], { liga: LIGA.JAP }],
  [['national teams', 'national team', 'fifa world cup', 'world cup', 'euro cup', 'copa america'], { liga: LIGA.SEL }],
  [['worldwide other league', 'other league', 'other leagues'], { liga: LIGA.OUT }],
  [['f1', 'newf1', 'formula 1', 'formula one'], { desporto: 'Fórmula 1' }],
  [['nba'], { desporto: 'NBA' }],
  [['nfl'], { desporto: 'NFL' }],
  [['nhl'], { desporto: 'NHL' }],
  [['nfl-nhl', 'nfl nhl'], { desporto: 'NFL e NHL' }],
  [['nrl'], { desporto: 'Râguebi (NRL)' }],
  [['afl'], { desporto: 'Futebol Australiano (AFL)' }],
  [['gaa'], { desporto: 'Desportos Gaélicos (GAA)' }],
  [['retro football shirt', 'retro shirt', 'retro'], { tipo: 'Retro' }],
  [['kids kit', 'kids', 'kid'], { tipo: 'Crianças' }],
  [['baby jersey', 'baby'], { tipo: 'Bebé' }],
  [["women's shirt", 'womens shirt', 'woman shirt', 'women'], { tipo: 'Mulher' }],
  [['goalkeeper kit', 'goalkeeper'], { tipo: 'Guarda-redes' }],
  [['player version'], { tipo: 'Versão Jogador' }],
  [['long sleeve shirt', 'long-sleeve shirt', 'long sleeve'], { tipo: 'Manga Comprida' }],
  [['polos', 'polo shirt', 'polo'], { tipo: 'Polos' }],
  [['windbreaker/training top', 'windbreaker', 'training top', 'training suit kit', 'training suit'], { tipo: 'Treino e Lazer' }],
  [['shorts', 'casual shorts'], { tipo: 'Calções' }],
  [['socks', 'sports socks'], { tipo: 'Meias' }],
];

// ---------------------------------------------------------------------------
// Clubes: [nome em português, liga, sinónimos usados pelo fornecedor]
// ---------------------------------------------------------------------------

const CLUBES: [string, string, string[]][] = [
  // Portugal
  ['Benfica', LIGA.PT, ['benfica', 'sl benfica', 's.l. benfica', 'slb']],
  ['FC Porto', LIGA.PT, ['porto', 'fc porto', 'f.c. porto', 'fcp']],
  ['Sporting', LIGA.PT, ['sporting cp', 'sporting', 'sporting lisbon', 'scp', 'sporting clube de portugal']],
  ['SC Braga', LIGA.PT, ['braga', 'sc braga', 's.c. braga']],
  ['Vitória SC', LIGA.PT, ['vitoria guimaraes', 'vitoria sc', 'guimaraes', 'vitoria de guimaraes']],
  ['Famalicão', LIGA.PT, ['famalicao', 'fc famalicao']],
  ['Alverca', LIGA.PT, ['alverca', 'fc alverca']],
  ['Boavista', LIGA.PT, ['boavista']],
  ['Rio Ave', LIGA.PT, ['rio ave']],
  ['Gil Vicente', LIGA.PT, ['gil vicente']],
  ['Estoril Praia', LIGA.PT, ['estoril', 'estoril praia']],
  ['Casa Pia', LIGA.PT, ['casa pia']],
  ['Moreirense', LIGA.PT, ['moreirense']],
  ['Arouca', LIGA.PT, ['arouca', 'fc arouca']],
  ['Santa Clara', LIGA.PT, ['santa clara']],
  ['Nacional', LIGA.PT, ['nacional', 'cd nacional']],
  ['Marítimo', LIGA.PT, ['maritimo']],
  ['AVS', LIGA.PT, ['avs', 'avs futebol']],
  ['Estrela da Amadora', LIGA.PT, ['estrela amadora', 'estrela da amadora']],
  ['Tondela', LIGA.PT, ['tondela']],
  ['Académica', LIGA.PT, ['academica', 'academica coimbra']],
  ['Vitória de Setúbal', LIGA.PT, ['vitoria setubal', 'vitoria de setubal']],
  ['Belenenses', LIGA.PT, ['belenenses']],
  // Inglaterra
  ['Manchester United', LIGA.ENG, ['manchester united', 'man united', 'man utd', 'man u', 'm-u', 'mu', 'mufc']],
  ['Manchester City', LIGA.ENG, ['manchester city', 'man city', 'mcfc']],
  ['Liverpool', LIGA.ENG, ['liverpool', 'lfc', 'liverpool fc']],
  ['Chelsea', LIGA.ENG, ['chelsea', 'chelsea fc']],
  ['Arsenal', LIGA.ENG, ['arsenal', 'arsenal fc']],
  ['Tottenham', LIGA.ENG, ['tottenham', 'tottenham hotspur', 'spurs']],
  ['Newcastle', LIGA.ENG, ['newcastle', 'newcastle united']],
  ['Aston Villa', LIGA.ENG, ['aston villa']],
  ['West Ham', LIGA.ENG, ['west ham', 'west ham united']],
  ['Everton', LIGA.ENG, ['everton']],
  ['Leeds United', LIGA.ENG, ['leeds', 'leeds united']],
  ['Nottingham Forest', LIGA.ENG, ['nottingham forest', 'nottingham']],
  ['Brighton', LIGA.ENG, ['brighton', 'brighton hove albion']],
  ['Wolverhampton', LIGA.ENG, ['wolves', 'wolverhampton']],
  ['Crystal Palace', LIGA.ENG, ['crystal palace']],
  ['Fulham', LIGA.ENG, ['fulham']],
  ['Brentford', LIGA.ENG, ['brentford']],
  ['Bournemouth', LIGA.ENG, ['bournemouth']],
  ['Sunderland', LIGA.ENG, ['sunderland']],
  ['Burnley', LIGA.ENG, ['burnley']],
  ['Leicester City', LIGA.ENG, ['leicester', 'leicester city']],
  ['Southampton', LIGA.ENG, ['southampton']],
  ['Ipswich Town', LIGA.ENG, ['ipswich', 'ipswich town']],
  ['Blackburn Rovers', LIGA.ENG, ['blackburn', 'blackburn rovers']],
  ['Wrexham', LIGA.ENG, ['wrexham']],
  // Espanha
  ['Real Madrid', LIGA.ESP, ['real madrid', 'madrid', 'rma']],
  ['Barcelona', LIGA.ESP, ['barcelona', 'fc barcelona', 'barca', 'barça']],
  ['Atlético de Madrid', LIGA.ESP, ['atletico madrid', 'atletico de madrid', 'atletico', 'atm']],
  ['Athletic Bilbao', LIGA.ESP, ['athletic bilbao', 'athletic club', 'bilbao']],
  ['Real Sociedad', LIGA.ESP, ['real sociedad']],
  ['Betis', LIGA.ESP, ['real betis', 'betis']],
  ['Sevilha', LIGA.ESP, ['sevilla', 'sevilla fc']],
  ['Valência', LIGA.ESP, ['valencia', 'valencia cf']],
  ['Villarreal', LIGA.ESP, ['villarreal', 'villarreal cf']],
  ['Celta de Vigo', LIGA.ESP, ['celta de vigo', 'celta vigo', 'celta']],
  ['Girona', LIGA.ESP, ['girona']],
  ['Osasuna', LIGA.ESP, ['osasuna']],
  ['Espanyol', LIGA.ESP, ['espanyol']],
  ['Getafe', LIGA.ESP, ['getafe']],
  ['Maiorca', LIGA.ESP, ['mallorca', 'rcd mallorca']],
  ['Rayo Vallecano', LIGA.ESP, ['rayo vallecano', 'rayo']],
  ['Alavés', LIGA.ESP, ['deportivo alaves', 'alaves']],
  ['Las Palmas', LIGA.ESP, ['ud las palmas', 'las palmas']],
  ['Hércules', LIGA.ESP, ['hercules cf', 'hercules']],
  ['Deportivo da Corunha', LIGA.ESP, ['deportivo la coruna', 'deportivo', 'la coruna']],
  ['Saragoça', LIGA.ESP, ['real zaragoza', 'zaragoza']],
  ['Málaga', LIGA.ESP, ['malaga', 'malaga cf']],
  ['Cádis', LIGA.ESP, ['cadiz cf', 'cadiz']],
  ['Granada', LIGA.ESP, ['granada']],
  ['Valladolid', LIGA.ESP, ['real valladolid', 'valladolid']],
  ['Elche', LIGA.ESP, ['elche']],
  ['Levante', LIGA.ESP, ['levante ud', 'levante']],
  ['Real Oviedo', LIGA.ESP, ['real oviedo', 'oviedo']],
  ['Sporting de Gijón', LIGA.ESP, ['sporting de gijon', 'sporting gijon']],
  ['Racing de Santander', LIGA.ESP, ['racing de santander', 'racing santander']],
  ['Almería', LIGA.ESP, ['ud almeria', 'almeria']],
  ['Leganés', LIGA.ESP, ['leganes']],
  ['Tenerife', LIGA.ESP, ['tenerife']],
  ['Córdoba', LIGA.ESP, ['cordoba']],
  ['Albacete', LIGA.ESP, ['albacete']],
  ['Burgos', LIGA.ESP, ['burgos']],
  ['Real Murcia', LIGA.ESP, ['real murcia', 'murcia']],
  ['Cartagena', LIGA.ESP, ['cartagena']],
  ['Compostela', LIGA.ESP, ['compostela']],
  ['Cultural Leonesa', LIGA.ESP, ['cultural leonesa']],
  ['Recreativo de Huelva', LIGA.ESP, ['recreativo de huelva', 'recreativo']],
  ['Ceuta', LIGA.ESP, ['ad ceuta fc', 'ad ceuta', 'ceuta']],
  ['Castellón', LIGA.ESP, ['castellonense', 'castellon']],
  ['País Basco', LIGA.ESP, ['basque country']],
  // Itália
  ['Inter de Milão', LIGA.ITA, ['inter milan', 'inter', 'internazionale', 'inter de milao']],
  ['AC Milan', LIGA.ITA, ['ac milan', 'milan']],
  ['Juventus', LIGA.ITA, ['juventus', 'juve', 'juv']],
  ['Nápoles', LIGA.ITA, ['napoli', 'ssc napoli']],
  ['Roma', LIGA.ITA, ['as roma', 'roma']],
  ['Lazio', LIGA.ITA, ['lazio', 'ss lazio']],
  ['Atalanta', LIGA.ITA, ['atalanta']],
  ['Fiorentina', LIGA.ITA, ['fiorentina']],
  ['Bolonha', LIGA.ITA, ['bologna']],
  ['Torino', LIGA.ITA, ['torino']],
  ['Como', LIGA.ITA, ['como 1907']],
  ['Génova', LIGA.ITA, ['genoa']],
  ['Parma', LIGA.ITA, ['parma']],
  ['Sassuolo', LIGA.ITA, ['sassuolo']],
  ['Udinese', LIGA.ITA, ['udinese']],
  ['Palermo', LIGA.ITA, ['palermo']],
  ['Sampdoria', LIGA.ITA, ['sampdoria']],
  ['Venezia', LIGA.ITA, ['venezia', 'venice']],
  // Alemanha
  ['Bayern de Munique', LIGA.ALE, ['bayern munich', 'bayern munchen', 'bayern']],
  ['Borussia Dortmund', LIGA.ALE, ['borussia dortmund', 'dortmund', 'bvb']],
  ['Bayer Leverkusen', LIGA.ALE, ['bayer leverkusen', 'leverkusen']],
  ['RB Leipzig', LIGA.ALE, ['rb leipzig', 'leipzig']],
  ['Eintracht Frankfurt', LIGA.ALE, ['eintracht frankfurt', 'frankfurt']],
  ['Estugarda', LIGA.ALE, ['vfb stuttgart', 'stuttgart']],
  ['Schalke 04', LIGA.ALE, ['schalke 04', 'schalke']],
  ['Wolfsburgo', LIGA.ALE, ['wolfsburg']],
  ['Borussia Mönchengladbach', LIGA.ALE, ['borussia monchengladbach', 'monchengladbach', 'gladbach']],
  ['Werder Bremen', LIGA.ALE, ['werder bremen', 'bremen']],
  ['Union Berlin', LIGA.ALE, ['union berlin']],
  ['Hamburgo', LIGA.ALE, ['hamburger sv', 'hamburg', 'hsv']],
  ['St. Pauli', LIGA.ALE, ['st pauli', 'st. pauli']],
  ['Colónia', LIGA.ALE, ['fc koln', 'koln', 'cologne']],
  // França
  ['Paris Saint-Germain', LIGA.FRA, ['paris saint-germain', 'paris saint germain', 'psg', 'paris']],
  ['Marselha', LIGA.FRA, ['olympique de marseille', 'marseille', 'om']],
  ['Lyon', LIGA.FRA, ['olympique lyonnais', 'lyon']],
  ['Mónaco', LIGA.FRA, ['as monaco', 'monaco']],
  ['Lille', LIGA.FRA, ['lille', 'losc']],
  ['Nice', LIGA.FRA, ['ogc nice', 'nice']],
  ['Lens', LIGA.FRA, ['rc lens', 'lens']],
  ['Rennes', LIGA.FRA, ['stade rennais', 'rennes']],
  ['Nantes', LIGA.FRA, ['nantes']],
  ['Bordéus', LIGA.FRA, ['bordeaux']],
  ['Saint-Étienne', LIGA.FRA, ['saint-etienne', 'saint etienne']],
  // Brasil
  ['Flamengo', LIGA.BRA, ['flamengo']],
  ['Palmeiras', LIGA.BRA, ['palmeiras']],
  ['São Paulo', LIGA.BRA, ['sao paulo', 'sao paulo fc']],
  ['Corinthians', LIGA.BRA, ['corinthians']],
  ['Santos', LIGA.BRA, ['santos', 'santos fc']],
  ['Fluminense', LIGA.BRA, ['fluminense']],
  ['Botafogo', LIGA.BRA, ['botafogo']],
  ['Vasco da Gama', LIGA.BRA, ['vasco da gama', 'vasco']],
  ['Grêmio', LIGA.BRA, ['gremio']],
  ['Internacional', LIGA.BRA, ['sc internacional', 'internacional']],
  ['Atlético Mineiro', LIGA.BRA, ['atletico mineiro']],
  ['Cruzeiro', LIGA.BRA, ['cruzeiro']],
  ['Bahia', LIGA.BRA, ['bahia', 'ec bahia']],
  ['Fortaleza', LIGA.BRA, ['fortaleza']],
  ['Ceará', LIGA.BRA, ['ceara sc', 'ceara']],
  ['Sport Recife', LIGA.BRA, ['sport recife']],
  ['Athletico Paranaense', LIGA.BRA, ['athletico paranaense', 'athletico pr']],
  ['Vitória', LIGA.BRA, ['ec vitoria']],
  // Outras ligas
  ['Ajax', LIGA.HOL, ['afc ajax', 'ajax']],
  ['PSV', LIGA.HOL, ['psv eindhoven', 'psv']],
  ['Feyenoord', LIGA.HOL, ['feyenoord']],
  ['Heerenveen', LIGA.HOL, ['heerenveen', 'hereja']],
  ['Celtic', LIGA.ESC, ['celtic f.c.', 'celtic fc', 'celtic']],
  ['Rangers', LIGA.ESC, ['rangers f.c.', 'rangers fc', 'rangers']],
  ['Aberdeen', LIGA.ESC, ['aberdeen']],
  ['Dundee United', LIGA.ESC, ['dundee united']],
  ['Boca Juniors', LIGA.ARG, ['boca juniors', 'boca']],
  ['River Plate', LIGA.ARG, ['river plate', 'river']],
  ['Independiente', LIGA.ARG, ['independiente']],
  ['San Lorenzo', LIGA.ARG, ['san lorenzo']],
  ['Racing Club', LIGA.ARG, ['racing club']],
  ['Inter Miami', LIGA.MLS, ['inter miami']],
  ['LA Galaxy', LIGA.MLS, ['la galaxy', 'los angeles galaxy']],
  ['Los Angeles FC', LIGA.MLS, ['los angeles fc', 'lafc']],
  ['D.C. United', LIGA.MLS, ['d.c. united', 'dc united']],
  ['Atlanta United', LIGA.MLS, ['atlanta united fc', 'atlanta united']],
  ['Seattle Sounders', LIGA.MLS, ['seattle sounders', 'seattle']],
  ['New York City FC', LIGA.MLS, ['new york city fc', 'nycfc']],
  ['Club América', LIGA.MEX, ['club america', 'america']],
  ['Chivas', LIGA.MEX, ['chivas de guadalajara', 'chivas', 'guadalajara']],
  ['Cruz Azul', LIGA.MEX, ['cruz azul']],
  ['Monterrey', LIGA.MEX, ['monterrey', 'rayados']],
  ['Tigres', LIGA.MEX, ['tigres uanl', 'tigres']],
  ['Pumas', LIGA.MEX, ['pumas unam', 'pumas']],
  ['Colo-Colo', LIGA.CHI, ['colo colo', 'colo-colo']],
  ['Universidad de Chile', LIGA.CHI, ['universidad de chile']],
  ['Universidad Católica', LIGA.CHI, ['deportivo universidad catolica', 'universidad catolica']],
  ['Palestino', LIGA.CHI, ['deportivo palestino', 'palestino']],
  ['Al Nassr', LIGA.SAU, ['al nassr', 'al-nassr']],
  ['Al Hilal', LIGA.SAU, ['al hilal', 'al-hilal']],
  ['Al Ittihad', LIGA.SAU, ['al ittihad', 'al-ittihad']],
  ['Al Ahli', LIGA.SAU, ['al ahli', 'al-ahli']],
  // Fórmula 1 (equipas)
  ['Ferrari', 'Fórmula 1', ['ferrari', 'scuderia ferrari']],
  ['Mercedes', 'Fórmula 1', ['mercedes', 'mercedes amg', 'mercedes-amg']],
  ['Red Bull Racing', 'Fórmula 1', ['red bull racing', 'red bull', 'redbull']],
  ['McLaren', 'Fórmula 1', ['mclaren']],
  ['Aston Martin', 'Fórmula 1', ['aston martin']],
  ['Alpine', 'Fórmula 1', ['alpine']],
  ['Williams', 'Fórmula 1', ['williams']],
];

/** Seleções nacionais: [nome em português, sinónimos] */
const SELECOES: [string, string[]][] = [
  ['Portugal', ['portugal']], ['Brasil', ['brazil', 'brasil']], ['Espanha', ['spain']], ['França', ['france']],
  ['Alemanha', ['germany']], ['Inglaterra', ['england']], ['Argentina', ['argentina']], ['Itália', ['italy']],
  ['Países Baixos', ['netherlands', 'holland']], ['Bélgica', ['belgium']], ['Japão', ['japan']], ['México', ['mexico']],
  ['Estados Unidos', ['usa', 'united states', 'usmnt']], ['Croácia', ['croatia']], ['Marrocos', ['morocco']],
  ['Colômbia', ['colombia']], ['Uruguai', ['uruguay']], ['Chile', ['chile']], ['Peru', ['peru']], ['Equador', ['ecuador']],
  ['Escócia', ['scotland']], ['País de Gales', ['wales']], ['Irlanda', ['ireland']], ['Irlanda do Norte', ['northern ireland']],
  ['Coreia do Sul', ['south korea', 'korea']], ['Senegal', ['senegal']], ['Nigéria', ['nigeria']], ['Gana', ['ghana']],
  ['Camarões', ['cameroon']], ['Costa do Marfim', ['ivory coast']], ['Dinamarca', ['denmark']], ['Suécia', ['sweden']],
  ['Noruega', ['norway']], ['Suíça', ['switzerland']], ['Áustria', ['austria']], ['Polónia', ['poland']],
  ['Sérvia', ['serbia']], ['Turquia', ['turkey', 'turkiye']], ['Canadá', ['canada']], ['Jamaica', ['jamaica']],
  ['Arábia Saudita', ['saudi arabia']], ['Catar', ['qatar']], ['Austrália', ['australia']], ['Egito', ['egypt']],
  ['Argélia', ['algeria']], ['Tunísia', ['tunisia']], ['Paraguai', ['paraguay']], ['Venezuela', ['venezuela']],
  ['Grécia', ['greece']], ['Ucrânia', ['ukraine']], ['Hungria', ['hungary']], ['República Checa', ['czech republic', 'czechia']],
  ['Cabo Verde', ['cape verde', 'cabo verde']], ['Angola', ['angola']], ['Moçambique', ['mozambique']],
];

// ---------------------------------------------------------------------------
// Palavras do título
// ---------------------------------------------------------------------------

/** Peças de roupa (o género conta para concordar cores e versões). */
interface Peca { pt: string; g: Gen; pl: boolean; peso: number }
const PECAS: [string[], Peca][] = [
  [['training suit', 'tracksuit', 'track suit'], { pt: 'Fato de Treino', g: 'm', pl: false, peso: 5 }],
  [['windbreaker'], { pt: 'Corta-vento', g: 'm', pl: false, peso: 5 }],
  [['puffer jacket', 'puffer', 'down jacket'], { pt: 'Casaco Acolchoado', g: 'm', pl: false, peso: 6 }],
  [['jacket', 'coat'], { pt: 'Casaco', g: 'm', pl: false, peso: 5 }],
  [['hoodie', 'hooded sweatshirt'], { pt: 'Sweatshirt com Capuz', g: 'f', pl: false, peso: 5 }],
  [['sweatshirt', 'sweater'], { pt: 'Sweatshirt', g: 'f', pl: false, peso: 4 }],
  [['training top'], { pt: 'Camisola de Treino', g: 'f', pl: false, peso: 4 }],
  [['polo', 'polo shirt'], { pt: 'Polo', g: 'm', pl: false, peso: 4 }],
  [['vest', 'tank top'], { pt: 'Camisola de Alças', g: 'f', pl: false, peso: 4 }],
  [['shorts'], { pt: 'Calções', g: 'm', pl: true, peso: 4 }],
  [['socks'], { pt: 'Meias', g: 'f', pl: true, peso: 4 }],
  [['football boots', 'boots'], { pt: 'Chuteiras', g: 'f', pl: true, peso: 4 }],
  [['sports shoes', 'shoes', 'sneakers'], { pt: 'Sapatilhas', g: 'f', pl: true, peso: 4 }],
  [['cap', 'hat'], { pt: 'Boné', g: 'm', pl: false, peso: 4 }],
  [['t-shirt', 'tee'], { pt: 'T-shirt', g: 'f', pl: false, peso: 3 }],
  [['kit', 'uniform'], { pt: 'Equipamento', g: 'm', pl: false, peso: 2 }],
  [['jersey', 'shirt', 'football shirt', 'soccer jersey', 'top'], { pt: 'Camisola', g: 'f', pl: false, peso: 1 }],
];
const SET = ['set', 'suit'];

/** Tipos / público — viram subcategoria (3.º nível) e entram no título. */
interface Tipo { titulo: string; categoria: string; ordem: number }
const TIPOS: [string[], Tipo][] = [
  [['kids', 'kid', 'children', 'child', 'youth', 'junior'], { titulo: 'Criança', categoria: 'Crianças', ordem: 1 }],
  [['baby', 'infant', 'babies'], { titulo: 'Bebé', categoria: 'Bebé', ordem: 1 }],
  [["women's", 'womens', 'women', 'woman', 'ladies', 'female'], { titulo: 'Mulher', categoria: 'Mulher', ordem: 2 }],
  [['retro', 'vintage', 'classic retro'], { titulo: 'Retro', categoria: 'Retro', ordem: 3 }],
  [['goalkeeper', 'gk', 'goalie'], { titulo: 'Guarda-redes', categoria: 'Guarda-redes', ordem: 4 }],
  [['player version', 'player issue', 'authentic', 'player'], { titulo: 'Versão Jogador', categoria: 'Versão Jogador', ordem: 5 }],
  [['long-sleeve', 'long sleeve', 'long sleeves', 'long sleeved', 'long-sleeved'], { titulo: 'Manga Comprida', categoria: 'Manga Comprida', ordem: 6 }],
  [['training'], { titulo: '', categoria: 'Treino e Lazer', ordem: 7 }],
];
/** Prioridade de cada tipo quando há vários (o primeiro ganha a subcategoria). */
const PRIORIDADE_CATEGORIA = ['Crianças', 'Bebé', 'Mulher', 'Guarda-redes', 'Retro', 'Versão Jogador', 'Manga Comprida', 'Treino e Lazer'];

/** Versões do equipamento. */
const VERSOES: [string[], Formas, boolean?][] = [
  [['home'], ['Principal', 'Principal', 'Principais', 'Principais']],
  [['third away', 'third', '3rd'], ['Terceiro', 'Terceira', 'Terceiros', 'Terceiras']],
  [['fourth away', 'fourth', '4th'], ['Quarto', 'Quarta', 'Quartos', 'Quartas']],
  [['away'], ['Alternativo', 'Alternativa', 'Alternativos', 'Alternativas']],
  [['special edition', 'special', 'special version'], ['Edição Especial'], true],
  [['limited edition', 'limited'], ['Edição Limitada'], true],
  [['commemorative edition', 'commemorative'], ['Edição Comemorativa'], true],
  [['anniversary edition'], ['Edição Aniversário'], true],
  [['champion edition', 'champions edition', 'champion'], ['Edição Campeão'], true],
  [['concept'], ['Conceito']],
  [['pre-match', 'prematch', 'pre match'], ['Pré-jogo']],
  [['warm-up', 'warm up', 'warmup'], ['Aquecimento']],
  [['fan version', 'fans version', 'fan'], ['']],
];

/** Modificadores que entram no fim do título. */
const MODIFICADORES: [string[], string][] = [
  [['hooded', 'with hood'], 'com Capuz'],
  [['full zipper', 'full zip', 'full-zip'], 'com Fecho'],
  [['half zipper', 'half zip', 'half-zip', '1/4 zip', 'quarter zip'], 'com Meio Fecho'],
  [['concealed zipper', 'hidden zipper'], 'com Fecho Oculto'],
  [['october pink', 'pink october'], 'Outubro Rosa'],
  [['two-stars', 'two stars', 'two-star', '2-star', '2-stars', '2 stars', '2 star'], '2 Estrelas'],
  [['three-stars', 'three stars', '3-star', '3-stars', '3 stars'], '3 Estrelas'],
  [['pure cotton', 'cotton'], 'em Algodão'],
  [['world cup'], 'Mundial'],
  [['champions league', 'ucl'], 'Liga dos Campeões'],
  [['christmas', 'xmas'], 'Natal'],
  [['halloween'], 'Halloween'],
  [['anniversary'], 'Aniversário'],
  [['short sleeve', 'short-sleeve'], ''],
];

/** Cores: [masc. sing., fem. sing., masc. pl., fem. pl.] ou invariável. */
const CORES: [string[], Formas][] = [
  [['dark blue', 'deep blue'], ['Azul-escuro', 'Azul-escura', 'Azul-escuros', 'Azul-escuras']],
  [['light blue', 'sky blue', 'baby blue'], ['Azul-celeste']],
  [['navy blue', 'navy'], ['Azul-marinho']],
  [['royal blue'], ['Azul Royal']],
  [['blue'], ['Azul', 'Azul', 'Azuis', 'Azuis']],
  [['lime green', 'lime', 'neon green'], ['Verde-lima']],
  [['dark cyan'], ['Ciano-escuro']],
  [['cyan'], ['Ciano']],
  [['dark green'], ['Verde-escuro', 'Verde-escura', 'Verde-escuros', 'Verde-escuras']],
  [['light green', 'mint green', 'mint'], ['Verde-claro', 'Verde-clara', 'Verde-claros', 'Verde-claras']],
  [['green'], ['Verde', 'Verde', 'Verdes', 'Verdes']],
  [['white'], ['Branco', 'Branca', 'Brancos', 'Brancas']],
  [['all-black', 'all black', 'triple black'], ['Preto', 'Preta', 'Pretos', 'Pretas']],
  [['all-white', 'all white'], ['Branco', 'Branca', 'Brancos', 'Brancas']],
  [['black'], ['Preto', 'Preta', 'Pretos', 'Pretas']],
  [['wine red', 'wine'], ['Vinho']],
  [['red'], ['Vermelho', 'Vermelha', 'Vermelhos', 'Vermelhas']],
  [['yellow'], ['Amarelo', 'Amarela', 'Amarelos', 'Amarelas']],
  [['pink', 'rose'], ['Rosa']],
  [['grey', 'gray', 'silver grey'], ['Cinzento', 'Cinzenta', 'Cinzentos', 'Cinzentas']],
  [['orange'], ['Laranja']],
  [['purple', 'violet'], ['Roxo', 'Roxa', 'Roxos', 'Roxas']],
  [['gold', 'golden'], ['Dourado', 'Dourada', 'Dourados', 'Douradas']],
  [['silver'], ['Prateado', 'Prateada', 'Prateados', 'Prateadas']],
  [['apricot', 'peach'], ['Pêssego']],
  [['beige', 'khaki'], ['Bege']],
  [['brown'], ['Castanho', 'Castanha', 'Castanhos', 'Castanhas']],
  [['burgundy', 'maroon', 'claret'], ['Bordô']],
  [['cream', 'off-white', 'ivory'], ['Creme']],
  [['teal', 'turquoise'], ['Turquesa']],
  [['camouflage', 'camo'], ['Camuflado', 'Camuflada', 'Camuflados', 'Camufladas']],
  [['multicolor', 'multicolour', 'rainbow'], ['Multicolor']],
];

/** Siglas de outros desportos que aparecem no título. */
const DESPORTOS: [string[], string][] = [
  [['nfl'], 'NFL'], [['nba'], 'NBA'], [['nhl'], 'NHL'], [['mlb'], 'MLB'],
  [['f1', 'formula 1', 'formula one'], 'Fórmula 1'], [['nrl'], 'Râguebi (NRL)'],
];

/** Palavras a ignorar. */
const RUIDO = new Set(['size', 'sizes', 'and', '&', 'with', 'the', 'new', 'all', 'team', 'version', 'edition', 'x', '-', '+', 'of', 'for', 'team', 'club', 'football', 'soccer', 'jersey', 'shirt', 'fc']);

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const normalizar = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'");

/** Normaliza cada palavra: minúsculas, sem acentos, sem pontuação nas pontas. */
const tokenNorm = (t: string): string => normalizar(t).replace(/^[([{"'.,;:!]+|[)\]}"',;:!]+$/g, '');

function partir(texto: string): string[] {
  return texto
    .replace(/[：:]/g, ' ')
    .replace(/([A-Za-z])[/#]/g, '$1 ')
    .replace(/#/g, ' ')
    .replace(/[|,;]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function formaDe(f: Formas, g: Gen, pl: boolean): string {
  if (f.length === 1) return f[0];
  return f[(pl ? 2 : 0) + (g === 'f' ? 1 : 0)]!;
}

function juntarCores(cores: string[]): string {
  if (cores.length <= 1) return cores[0] ?? '';
  return `${cores.slice(0, -1).join(', ')} e ${cores[cores.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Tamanhos e época
// ---------------------------------------------------------------------------

const ADULTO = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
const normTam = (t: string): string => {
  const u = t.toUpperCase();
  if (u === '2XL') return 'XXL';
  if (u === 'XXXL') return '3XL';
  if (u === 'XXXXL') return '4XL';
  return u;
};

function intervaloTamanhos(token: string): string[] | null {
  const a = token.match(/^(XS|S|M|L|XL|XXL|XXXL|XXXXL|[2-5]XL)[-~–](XS|S|M|L|XL|XXL|XXXL|XXXXL|[2-5]XL)$/i);
  if (a) {
    const i = ADULTO.indexOf(normTam(a[1]!));
    const j = ADULTO.indexOf(normTam(a[2]!));
    if (i >= 0 && j >= i) return ADULTO.slice(i, j + 1);
  }
  const n = token.match(/^(\d{1,2})[-~–](\d{1,2})$/);
  if (n) {
    const x = Number(n[1]);
    const y = Number(n[2]);
    if (y > x + 1 && y - x <= 30) {
      const passo = x % 2 === 0 && y % 2 === 0 ? 2 : 1;
      const r: string[] = [];
      for (let k = x; k <= y; k += passo) r.push(String(k));
      return r;
    }
  }
  return null;
}

/** "26/27" → "2026/27"; "98/99" → "1998/99"; "97/99" → "1997/99"; "2026" → "2026". */
function epoca(token: string): string | null {
  const t = token.replace(/[()]/g, '');
  const anoAtual = new Date().getFullYear() % 100;
  const seculo = (yy: number): number => (yy <= anoAtual + 2 ? 2000 : 1900) + yy;
  let m = t.match(/^(\d{2})[/-](\d{2})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const diff = (b - a + 100) % 100;
    if (diff >= 1 && diff <= 4) return `${seculo(a)}/${m[2]}`;
    return null;
  }
  m = t.match(/^((?:19|20)\d{2})[/-](\d{2}|\d{4})$/);
  if (m) return `${m[1]}/${m[2]!.slice(-2)}`;
  m = t.match(/^((?:19|20)\d{2})$/);
  if (m) return m[1]!;
  m = t.match(/^(\d{2})(\d{2})$/); // "2627" → 2026/27
  if (m && (Number(m[2]) - Number(m[1]) + 100) % 100 === 1) return `${seculo(Number(m[1]))}/${m[2]}`;
  return null;
}

// ---------------------------------------------------------------------------
// Motor de correspondência
// ---------------------------------------------------------------------------

type Achado =
  | { k: 'clube'; nome: string; liga: string }
  | { k: 'selecao'; nome: string }
  | { k: 'peca'; v: Peca }
  | { k: 'set' }
  | { k: 'tipo'; v: Tipo }
  | { k: 'versao'; v: Formas; edicao: boolean; ord: number }
  | { k: 'mod'; v: string }
  | { k: 'cor'; v: Formas }
  | { k: 'desporto'; v: string }
  | { k: 'ruido' };

interface Entrada { tokens: string[]; achado: Achado }

function construirDicionario(): Entrada[] {
  const e: Entrada[] = [];
  const add = (frases: string[], achado: Achado): void => {
    for (const f of frases) e.push({ tokens: partir(f).map(tokenNorm), achado });
  };
  for (const [nome, liga, sin] of CLUBES) add([normalizar(nome), ...sin], { k: 'clube', nome, liga });
  for (const [nome, sin] of SELECOES) add([normalizar(nome), ...sin], { k: 'selecao', nome });
  for (const [f, v] of PECAS) add(f, { k: 'peca', v });
  add(SET, { k: 'set' });
  for (const [f, v] of TIPOS) add(f, { k: 'tipo', v });
  VERSOES.forEach(([f, v, edicao], ord) => add(f, { k: 'versao', v, edicao: !!edicao, ord }));
  for (const [f, v] of MODIFICADORES) add(f, { k: 'mod', v });
  for (const [f, v] of CORES) add(f, { k: 'cor', v });
  for (const [f, v] of DESPORTOS) add(f, { k: 'desporto', v });
  // expressões mais longas primeiro ("third away" antes de "away", "inter miami" antes de "inter")
  return e.sort((a, b) => b.tokens.length - a.tokens.length);
}
const DIC = construirDicionario();

interface Analise {
  clube?: { nome: string; liga: string };
  selecao?: string;
  pecas: Peca[];
  set: boolean;
  tipos: Tipo[];
  versoes: { v: Formas; edicao: boolean; ord: number }[];
  mods: string[];
  cores: Formas[];
  desporto?: string;
  epoca?: string;
  tamanhos: string[];
  resto: string[];
  /** palavras desconhecidas no início do título (provável nome de um clube que não está no dicionário) */
  inicio: string;
}

function analisar(texto: string): Analise {
  const orig = partir(texto);
  const norm = orig.map(tokenNorm);
  const r: Analise = { pecas: [], set: false, tipos: [], versoes: [], mods: [], cores: [], tamanhos: [], resto: [], inicio: '' };
  let primeiro = -1; // posição da primeira palavra reconhecida
  const restoPos: number[] = [];
  let i = 0;
  while (i < orig.length) {
    const tn = norm[i]!;
    if (!tn) { i++; continue; }

    // tamanhos ("S-4XL", "16-28") — "Size: 16-28" já perdeu os dois pontos em partir()
    const tam = intervaloTamanhos(orig[i]!.replace(/[()]/g, ''));
    if (tam && !epoca(orig[i]!)) {
      if (primeiro < 0) primeiro = i;
      if (!r.tamanhos.length) r.tamanhos = tam;
      i++;
      continue;
    }
    // época
    const ep = epoca(orig[i]!);
    if (ep) {
      if (primeiro < 0) primeiro = i;
      if (!r.epoca) r.epoca = ep;
      i++;
      continue;
    }
    // "120th" + "anniversary" → "120 Anos"
    const ord = tn.match(/^(\d+)(st|nd|rd|th)$/);
    if (ord && norm[i + 1] === 'anniversary') {
      if (primeiro < 0) primeiro = i;
      r.mods.push(`${ord[1]} Anos`);
      i += 2;
      continue;
    }
    // "90s" → "Anos 90"
    const dec = tn.match(/^(\d0)'?s$/);
    if (dec) {
      if (primeiro < 0) primeiro = i;
      r.mods.push(`Anos ${dec[1]}`);
      i++;
      continue;
    }

    // dicionário (expressão mais longa primeiro)
    let achou: Entrada | undefined;
    for (const e of DIC) {
      if (e.tokens.length > orig.length - i) continue;
      let ok = true;
      for (let k = 0; k < e.tokens.length; k++) {
        if (norm[i + k] !== e.tokens[k]) { ok = false; break; }
      }
      if (ok) { achou = e; break; }
    }
    if (achou) {
      if (primeiro < 0) primeiro = i;
      const a = achou.achado;
      switch (a.k) {
        case 'clube': if (!r.clube && !r.selecao) r.clube = { nome: a.nome, liga: a.liga }; break;
        case 'selecao': if (!r.clube && !r.selecao) r.selecao = a.nome; break;
        case 'peca': r.pecas.push(a.v); break;
        case 'set': r.set = true; break;
        case 'tipo': if (!r.tipos.includes(a.v)) r.tipos.push(a.v); break;
        case 'versao': if (a.v[0] && !r.versoes.some((x) => x.v === a.v)) r.versoes.push({ v: a.v, edicao: a.edicao, ord: a.ord }); break;
        case 'mod': if (a.v && !r.mods.includes(a.v)) r.mods.push(a.v); break;
        case 'cor': r.cores.push(a.v); break;
        case 'desporto': if (!r.desporto) r.desporto = a.v; break;
      }
      i += achou.tokens.length;
      continue;
    }
    if (!RUIDO.has(tn)) {
      r.resto.push(orig[i]!);
      restoPos.push(i);
    }
    i++;
  }
  // "Peñarol 2002 Home Retro Jersey" → "Peñarol" é o clube
  if (primeiro > 0 && !r.clube && !r.selecao) {
    const ate = orig.slice(0, primeiro).findIndex((t) => /\d/.test(t)); // "Lakers 23 James" → "Lakers"
    const fim = ate >= 0 ? ate : primeiro;
    const nomes = orig.slice(0, fim).filter((t) => !['x', '-', '+', '&', 'the', 'new'].includes(tokenNorm(t)));
    if (nomes.length && nomes.length <= 4) {
      r.inicio = nomes.join(' ');
      r.resto = r.resto.filter((_, k) => restoPos[k]! >= fim);
    }
  }
  return r;
}

/** Interpreta o nome de uma pasta de categoria do fornecedor. */
function interpretarPasta(nome: string): { liga?: string; tipo?: string; desporto?: string; clube?: { nome: string; liga: string }; selecao?: string } {
  const n = normalizar(nome).replace(/[^a-z0-9' /-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return {};
  for (const [frases, info] of CATEGORIAS_FORNECEDOR) {
    if (frases.some((f) => n === f)) return info;
  }
  const a = analisar(nome);
  if (a.clube && !a.resto.length) return { clube: a.clube };
  if (a.selecao && !a.resto.length) return { selecao: a.selecao };
  for (const [frases, info] of CATEGORIAS_FORNECEDOR) {
    if (frases.some((f) => n.includes(f))) return info;
  }
  if (a.clube) return { clube: a.clube };
  if (a.selecao) return { selecao: a.selecao };
  return {};
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * @param tituloOriginal título do álbum no fornecedor
 * @param pastas pastas onde o álbum estava (ex.: ["Primeira Liga", "Sporting CP"]) — ajudam quando o título é vago
 */
export function interpretar(tituloOriginal: string, pastas: string[] = []): Interpretacao {
  const a = analisar(tituloOriginal);
  const infoPastas = pastas.map(interpretarPasta);

  // --- clube / seleção (título primeiro, depois as pastas)
  let clube = a.clube;
  let selecao = a.selecao;
  if (!clube && !selecao) {
    for (const p of [...infoPastas].reverse()) {
      if (p.clube) { clube = p.clube; break; }
      if (p.selecao) { selecao = p.selecao; break; }
    }
  }
  // pasta de clube desconhecido (ex.: "Hereja") por baixo de uma liga conhecida
  let clubeLivre = '';
  if (!clube && !selecao && pastas.length >= 2) {
    const ultima = infoPastas[infoPastas.length - 1]!;
    if (!ultima.liga && !ultima.tipo && !ultima.desporto) clubeLivre = cap(pastas[pastas.length - 1]!.trim());
  }
  if (!clube && !selecao && !clubeLivre && a.inicio) clubeLivre = a.inicio;
  // "2021 Ravens NFL Jersey" → equipa "Ravens" (outros desportos: o nome é o que sobra)
  if (!clube && !selecao && !clubeLivre && a.desporto && a.resto.length && a.resto.length <= 3) {
    clubeLivre = a.resto.join(' ');
    a.resto = [];
  }

  // --- liga / desporto
  const ligaPasta = infoPastas.find((p) => p.liga)?.liga;
  const desporto = infoPastas.find((p) => p.desporto)?.desporto ?? a.desporto;
  let liga = clube?.liga ?? (selecao ? LIGA.SEL : undefined) ?? ligaPasta ?? desporto;
  if (!liga && (clubeLivre || a.resto.length)) liga = LIGA.OUT;

  // --- tipo (subcategoria): do título; se não houver, das pastas
  const tiposTitulo = [...a.tipos];
  // tamanhos numéricos sem "kids"/"baby" no título: 16-28 → criança; até 14 → bebé
  if (a.tamanhos.length && /^\d+$/.test(a.tamanhos[0]!) && !tiposTitulo.some((t) => ['Crianças', 'Bebé'].includes(t.categoria))) {
    const max = Math.max(...a.tamanhos.map(Number));
    const t = TIPOS.find(([, v]) => v.categoria === (max <= 14 ? 'Bebé' : 'Crianças'))?.[1];
    if (t) tiposTitulo.push(t);
  }
  const tipoPasta = infoPastas.find((p) => p.tipo)?.tipo;
  let pecaPrincipal = [...a.pecas].sort((x, y) => y.peso - x.peso)[0];
  let catTipo = PRIORIDADE_CATEGORIA.find((c) => tiposTitulo.some((t) => t.categoria === c));
  if (!catTipo && pecaPrincipal) {
    if (pecaPrincipal.pt === 'Polo') catTipo = 'Polos';
    else if (pecaPrincipal.pt === 'Calções') catTipo = 'Calções';
    else if (pecaPrincipal.pt === 'Meias') catTipo = 'Meias';
    else if (['Fato de Treino', 'Corta-vento', 'Casaco', 'Camisola de Treino', 'Sweatshirt', 'Sweatshirt com Capuz'].includes(pecaPrincipal.pt)) catTipo = 'Treino e Lazer';
  }
  if (!catTipo && tipoPasta) catTipo = tipoPasta;

  // --- título
  if (!pecaPrincipal) pecaPrincipal = { pt: 'Camisola', g: 'f', pl: false, peso: 0 };
  let peca = pecaPrincipal.pt;
  // "Kids Kit Jersey" → Equipamento; "Windbreaker Set" → Conjunto Corta-vento
  if (a.set && !['Fato de Treino'].includes(peca)) {
    peca = `Conjunto ${peca === 'Camisola' ? '' : peca}`.trim();
    pecaPrincipal = { ...pecaPrincipal, g: 'm', pl: false };
  }
  const g = pecaPrincipal.g;
  const pl = pecaPrincipal.pl;
  // tipos que entram junto da peça ("Camisola Criança Retro")
  const tiposTxt = tiposTitulo
    .slice()
    .sort((x, y) => x.ordem - y.ordem)
    .map((t) => t.titulo)
    .filter(Boolean);
  if (!tiposTitulo.length && tipoPasta && !['Polos', 'Calções', 'Meias', 'Treino e Lazer'].includes(tipoPasta)) {
    const t = TIPOS.find(([, v]) => v.categoria === tipoPasta)?.[1];
    if (t?.titulo) tiposTxt.push(t.titulo);
  }

  const equipa = clube?.nome ?? selecao ?? clubeLivre;
  const temEdicao = a.versoes.some((v) => v.edicao);
  // ordem natural: Principal/Alternativa/Terceira primeiro, depois Edição Especial, Conceito…
  const versoesTxt = [...a.versoes].sort((x, y) => x.ord - y.ord).map((v) => formaDe(v.v, g, pl));
  const coresTxt = a.cores.map((c) => (temEdicao ? formaDe(c, 'f', false) : formaDe(c, g, pl)));
  const comMods = a.mods.filter((m) => m.startsWith('com ')).map((m) => m.slice(4)).sort((x) => (x === 'Capuz' ? -1 : 1));
  const outrosMods = a.mods.filter((m) => !m.startsWith('com '));
  const modsTxt = [...(comMods.length ? [`com ${juntarCores(comMods)}`] : []), ...outrosMods];
  const partes = [
    peca,
    ...tiposTxt,
    equipa,
    a.epoca ?? '',
    ...versoesTxt,
    juntarCores(coresTxt),
    ...modsTxt,
    ...a.resto,
  ].filter(Boolean);
  // evita repetir palavras ("Equipamento Criança … Criança")
  const vistos = new Set<string>();
  const titulo = partes
    .filter((p) => {
      const k = normalizar(p);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const categorias = [liga, equipa, catTipo].filter((x): x is string => !!x);
  // sem liga nem equipa (ex.: "Meias desportivas") → categoria pelo tipo
  if (!liga && !equipa && catTipo) categorias.splice(0, categorias.length, catTipo);

  return { titulo: titulo || tituloOriginal, categorias, tamanhos: a.tamanhos, original: tituloOriginal };
}

/** "Liga Portugal › Sporting › Crianças" ⇄ ["Liga Portugal", "Sporting", "Crianças"] */
export const SEP = ' › ';
export const caminhoTexto = (p: string[]): string => p.filter(Boolean).join(SEP);
export const caminhoDe = (s: string): string[] =>
  s
    .split(/\s*(?:›|>|\\|\/(?!\d))\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 4);

/** Época indicada num título já interpretado: "2026/27", "1990/93", "2026" — ou "" se não tiver. */
export function epocaDe(titulo: string): string {
  const m = titulo.match(/\b((?:19|20)\d{2})\/(\d{2})\b/);
  if (m) return `${m[1]}/${m[2]}`;
  const a = titulo.match(/\b((?:19|20)\d{2})\b/);
  return a ? a[1]! : '';
}

/** Ordena épocas da mais recente para a mais antiga. */
export const ordemEpocas = (a: string, b: string): number => b.localeCompare(a, 'pt', { numeric: true });
