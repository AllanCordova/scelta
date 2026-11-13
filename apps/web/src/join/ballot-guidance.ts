export type BallotGuidance = {
  title: string;
  officeLabel: string;
  description: string;
};

export const BALLOT_WISDOM_VERSE = {
  reference: "Tiago 1:5",
  text: "Se, porém, algum de vocês necessita de sabedoria, peça-a a Deus, que a todos dá liberalmente e nada lhes impropera; e ser-lhe-á concedida.",
} as const;

const DEFAULT_BOARD_OFFICE_DESC =
  "Exerce as atribuições regimentais correspondentes a este cargo na diretoria.";

const BOARD_OFFICE_DESCRIPTIONS: Record<string, string> = {
  Presidente:
    "Convoca e preside as reuniões, representa a diretoria perante a igreja e o Conselho e coordena o planejamento das atividades.",
  "Vice-Presidente":
    "Auxilia diretamente o Presidente, substitui-o em ausências ou impedimentos e coordena comissões ou projetos delegados.",
  Secretário:
    "Redige e guarda as atas do Conselho, organiza documentos e mantém os registros oficiais atualizados.",
  "1º Secretário":
    "Redige e guarda as atas das reuniões da sociedade, cuida dos registros oficiais e da correspondência.",
  "2º Secretário":
    "Auxilia o 1º Secretário, substitui-o quando necessário e colabora no controle de presença e arquivos.",
  Tesoureiro:
    "Administra os recursos financeiros, registra entradas e despesas autorizadas e apresenta prestação de contas.",
};

const SESSION_VICE_PRESIDENT_DESC =
  "Substitui o Pastor Presidente em ausências ou impedimentos regimentais e auxilia na condução da pauta do Conselho.";

const DEFAULT_SINGLE_GUIDANCE = {
  label: "Deliberação da sala",
  description:
    "Avalie com oração o propósito desta votação e escolha a opção que melhor promove a edificação e a boa ordem da igreja.",
};

const SINGLE_OFFICE_GUIDANCE: Record<string, { label: string; description: string }> = {
  pastor: {
    label: "Pastor",
    description:
      "Ministro da Palavra e dos Sacramentos, responsável pela pregação, ensino bíblico, pastoreio do rebanho e presidência do Conselho.",
  },
  elder: {
    label: "Presbítero",
    description:
      "Oficial ordenado para o governo espiritual da igreja, zelo pela sã doutrina, disciplina e cuidado pastoral ao lado do pastor (1 Tm 3:1-7; Tt 1:5-9).",
  },
  deacon: {
    label: "Diácono",
    description:
      "Oficial ordenado para o ministério de misericórdia, cuidado dos necessitados, visitação e zelo pela ordem e patrimônio da igreja (At 6:1-6; 1 Tm 3:8-13).",
  },
  custom: DEFAULT_SINGLE_GUIDANCE,
};

/**
 * Returns the description of the office currently being voted on so voters
 * understand its responsibilities before casting their ballot.
 */
export function officeGuidanceForBallot(
  roomType?: string,
  officeLabel?: string | null,
): BallotGuidance {
  if (officeLabel) {
    const description =
      roomType === "session_board" && officeLabel === "Vice-Presidente"
        ? SESSION_VICE_PRESIDENT_DESC
        : (BOARD_OFFICE_DESCRIPTIONS[officeLabel] ?? DEFAULT_BOARD_OFFICE_DESC);
    return {
      title: `Sobre o cargo: ${officeLabel}`,
      officeLabel,
      description,
    };
  }

  const single = SINGLE_OFFICE_GUIDANCE[roomType ?? "custom"] ?? DEFAULT_SINGLE_GUIDANCE;
  return {
    title: `Sobre o cargo: ${single.label}`,
    officeLabel: single.label,
    description: single.description,
  };
}
