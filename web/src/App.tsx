import { type FormEvent, useEffect, useRef, useState } from "react";

import { AccountAccess } from "./AccountAccess";
import { ActivityCenter } from "./ActivityCenter";
import { AccountDataControls } from "./AccountDataControls";
import { BillingPanel } from "./BillingPanel";
import type { AuthClient, AuthenticatedWebSession } from "./auth-client";
import {
  openDocumentSession,
  type DocumentSessionControl,
} from "./document-session-client";
import { downloadPublicationCopy as requestPublicationCopy } from "./publication-copy-client";
import {
  archiveMonitoringProfile,
  createMonitoringProfile,
  listMonitoringProfiles,
  type MonitoringProfile,
  type MonitoringProfileType,
  SafeMonitoringProfileError,
} from "./monitoring-profile-client";
import {
  clearLegacyTargets,
} from "./target-storage";

interface SearchPublication {
  id: string;
  availableAt?: string;
  communicationType?: string;
  medium?: string;
  documentType?: string;
  communicationNumber?: number;
  documentAvailable?: true;
  summary: string;
}

interface SearchProcess {
  cnjNumber: string;
  tribunal?: string;
  organ?: string;
  className?: string;
  publicationCount: number;
  lastPublicationAt?: string;
  publications: SearchPublication[];
}

interface SearchResponse {
  target: {
    id: string;
    type: MonitoringProfileType;
    displayValue: string;
  };
  source: {
    id: "DJEN";
    official: boolean;
    strategy: "nomeParte" | "texto";
    confidence: "medium" | "experimental";
  };
  summary: {
    publications: number;
    processes: number;
    ungroupedPublications: number;
    truncated: boolean;
  };
  processes: SearchProcess[];
  warnings: string[];
}

interface ApiError {
  code?: string;
  message?: string;
}

interface PublicationChallenge {
  operationId: string;
  imageDataUrl: string;
  expiresAt: string;
  answer: string;
}

interface DocumentSessionStatus {
  operationId: string;
  message: string;
}

type ViewMode = "simple" | "advanced";

const labels: Record<MonitoringProfileType, { input: string; placeholder: string }> = {
  name: { input: "Nome completo", placeholder: "Ex.: Maria da Silva" },
  cpf: { input: "Número do CPF", placeholder: "000.000.000-00" },
  cnpj: { input: "Número do CNPJ", placeholder: "00.000.000/0000-00" },
};

const isSearchResponse = (value: unknown): value is SearchResponse => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.target === "object" &&
    typeof record.summary === "object" &&
    Array.isArray(record.processes) &&
    Array.isArray(record.warnings)
  );
};

const formatDate = (value: string | undefined) => {
  if (!value) return "Data não informada";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
};

const loadDefaultAuthClient = async (): Promise<AuthClient> => {
  const { createFirebaseAuthClient } = await import("./firebase-auth-client");
  return createFirebaseAuthClient();
};

const defaultSaveFile = (blob: Blob, fileName: string) => {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
};

const cnjDigits = (value: string) => value.replace(/\D/g, "");

const documentSessionError = (code: string): string =>
  ({
    UNAUTHENTICATED: "Sua sessão expirou. Entre novamente para abrir a publicação.",
    RATE_LIMITED: "Muitas tentativas em pouco tempo. Aguarde e tente novamente.",
    PUBLICATION_NOT_FOUND: "A publicação não foi reencontrada na fonte oficial.",
    SESSION_BUSY: "A conexão brasileira está ocupada. Tente novamente em instantes.",
    SESSION_EXPIRED: "A confirmação expirou. Abra a publicação novamente.",
    SOURCE_POLICY_REJECTED: "A origem não passou pela política de segurança.",
    SOURCE_UNAVAILABLE: "O tribunal não respondeu pela conexão brasileira.",
    DOCUMENT_INTEGRITY_REJECTED: "O PDF recebido não passou pela validação de integridade.",
  })[code] ?? "Não foi possível abrir a publicação.";

export function App({
  fetcher = fetch,
  storage = localStorage,
  loadAuthClient = loadDefaultAuthClient,
  saveFile = defaultSaveFile,
  openSession = openDocumentSession,
}: {
  fetcher?: typeof fetch;
  storage?: Storage;
  loadAuthClient?: () => Promise<AuthClient>;
  saveFile?: (blob: Blob, fileName: string) => void;
  openSession?: typeof openDocumentSession;
}) {
  const [type, setType] = useState<MonitoringProfileType>("name");
  const [value, setValue] = useState("");
  const [profiles, setProfiles] = useState<readonly MonitoringProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profileUpdatingId, setProfileUpdatingId] = useState("");
  const [result, setResult] = useState<SearchResponse>();
  const [searchHistory, setSearchHistory] = useState<readonly SearchResponse[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("simple");
  const [authSession, setAuthSession] = useState<AuthenticatedWebSession>();
  const [selectedProcess, setSelectedProcess] = useState<SearchProcess>();
  const [downloadingPublication, setDownloadingPublication] = useState("");
  const [downloadingPublicationCopy, setDownloadingPublicationCopy] = useState("");
  const [publicationChallenge, setPublicationChallenge] =
    useState<PublicationChallenge>();
  const [documentStatus, setDocumentStatus] =
    useState<DocumentSessionStatus>();
  const documentSession = useRef<DocumentSessionControl | undefined>(undefined);
  const profileLoadGeneration = useRef(0);

  useEffect(() => {
    clearLegacyTargets(storage);
    return () => {
      documentSession.current?.close();
    };
  }, [storage]);

  const loadProfiles = async (
    session: AuthenticatedWebSession,
    generation: number,
  ) => {
    setProfilesLoading(true);
    try {
      const token = await session.getIdToken();
      const loaded = await listMonitoringProfiles(fetcher, token);
      if (profileLoadGeneration.current === generation) setProfiles(loaded);
    } catch (caught) {
      if (profileLoadGeneration.current === generation) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível carregar seus perfis monitorados.",
        );
      }
    } finally {
      if (profileLoadGeneration.current === generation) setProfilesLoading(false);
    }
  };

  const runSearch = async (
    targetType: MonitoringProfileType,
    targetValue: string,
  ) => {
    if (!authSession) {
      setError("Entre na sua conta para consultar a fonte oficial.");
      return;
    }
    setLoading(true);
    setError("");
    let createdProfile: MonitoringProfile | undefined;
    try {
      const token = await authSession.getIdToken();
      try {
        const profile = await createMonitoringProfile(fetcher, token, {
          type: targetType,
          value: targetValue,
        });
        createdProfile = profile;
        setProfiles((current) => [
          profile,
          ...current.filter((item) => item.subjectId !== profile.subjectId),
        ]);
      } catch (caught) {
        if (
          caught instanceof SafeMonitoringProfileError &&
          caught.code === "MONITORING_PROFILE_CONFLICT"
        ) {
          const loaded = await listMonitoringProfiles(fetcher, token);
          setProfiles(loaded);
        } else if (
          caught instanceof SafeMonitoringProfileError &&
          caught.code === "MONITORING_PROFILES_UNAVAILABLE"
        ) {
          // Validation can keep the official one-off consultation available
          // before the persistent PostgreSQL monitoring runtime is activated.
          // Only this explicit server capability signal is allowed to degrade;
          // validation, authorization and tenant errors still fail closed.
          createdProfile = undefined;
        } else {
          throw caught;
        }
      }
      const response = await fetcher("/api/v1/searches", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ type: targetType, value: targetValue }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const apiError = body as ApiError;
        throw new Error(apiError.message ?? "Não foi possível concluir a busca.");
      }
      if (!isSearchResponse(body)) throw new Error("Resposta inesperada da fonte.");

      setResult(body);
      setSearchHistory((current) => [
        body,
        ...current.filter((item) => item.target.id !== body.target.id),
      ].slice(0, 20));
      if (createdProfile) {
        const profileId = createdProfile.subjectId;
        setProfiles((current) =>
          current.map((profile) =>
            profile.subjectId === profileId
              ? {
                  ...profile,
                  processCount: body.summary.processes,
                  processSummary: body.processes.slice(0, 3).map((process) => ({
                    cnjNumber: process.cnjNumber,
                    tribunal: process.tribunal ?? "BR",
                    lastActivityAt: process.lastPublicationAt
                      ? `${process.lastPublicationAt}T12:00:00.000Z`
                      : "1970-01-01T00:00:00.000Z",
                  })),
                }
              : profile,
          ),
        );
      }
      setSelectedProcess(undefined);
    } catch (caught) {
      setResult(undefined);
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível concluir a busca.",
      );
    } finally {
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(type, value);
  };

  const changeSession = (session: AuthenticatedWebSession | undefined) => {
    const generation = profileLoadGeneration.current + 1;
    profileLoadGeneration.current = generation;
    setAuthSession(session);
    if (session) {
      setError("");
      void loadProfiles(session, generation);
    } else {
      documentSession.current?.close();
      documentSession.current = undefined;
      setProfiles([]);
      setProfilesLoading(false);
      setResult(undefined);
      setSearchHistory([]);
      setSelectedProcess(undefined);
      setDownloadingPublication("");
      setPublicationChallenge(undefined);
      setDocumentStatus(undefined);
      setError("");
    }
  };

  const archiveProfile = async (profile: MonitoringProfile) => {
    if (!authSession) return;
    setProfileUpdatingId(profile.subjectId);
    setError("");
    try {
      const token = await authSession.getIdToken();
      await archiveMonitoringProfile(fetcher, token, profile);
      setProfiles((current) =>
        current.filter((item) => item.subjectId !== profile.subjectId),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível arquivar o perfil.",
      );
    } finally {
      setProfileUpdatingId("");
    }
  };

  const downloadPublicationCopy = async (
    process: SearchProcess,
    publication: SearchPublication,
  ) => {
    if (!authSession || publication.communicationNumber === undefined) {
      setError("Entre na sua conta para baixar a cópia da publicação.");
      return;
    }

    const operationId = `${process.cnjNumber}:${publication.communicationNumber}`;
    setDownloadingPublicationCopy(operationId);
    setDocumentStatus({ operationId, message: "Preparando cópia do DJEN…" });
    setError("");
    try {
      const token = await authSession.getIdToken();
      const document = await requestPublicationCopy(
        fetcher,
        token,
        cnjDigits(process.cnjNumber),
        publication.communicationNumber,
      );
      saveFile(document.blob, document.fileName);
      setDocumentStatus({ operationId, message: "Cópia DJEN baixada." });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível preparar a cópia da publicação.",
      );
      setDocumentStatus(undefined);
    } finally {
      setDownloadingPublicationCopy("");
    }
  };

  const downloadOriginalPublication = async (
    process: SearchProcess,
    publication: SearchPublication,
  ) => {
    if (!authSession || publication.communicationNumber === undefined) {
      setError("Entre na sua conta para abrir a publicação.");
      return;
    }

    const operationId = `${process.cnjNumber}:${publication.communicationNumber}`;
    setDownloadingPublication(operationId);
    setDocumentStatus({
      operationId,
      message: "Conectando ao worker brasileiro…",
    });
    documentSession.current?.close();
    documentSession.current = undefined;
    setPublicationChallenge(undefined);
    setError("");
    try {
      const token = await authSession.getIdToken();
      documentSession.current = openSession({
        path: `/api/v1/processes/${cnjDigits(process.cnjNumber)}/communications/${publication.communicationNumber}/document/session`,
        token,
        callbacks: {
          onStatus: () => {
            setDownloadingPublication(operationId);
            setDocumentStatus({
              operationId,
              message: "Aguardando resposta do tribunal…",
            });
          },
          onChallenge: (challenge) => {
            setDownloadingPublication("");
            setPublicationChallenge({
              operationId,
              imageDataUrl: challenge.imageDataUrl,
              expiresAt: challenge.expiresAt,
              answer: "",
            });
            setDocumentStatus({
              operationId,
              message: "Aguardando o código de segurança.",
            });
            if (challenge.rejected) {
              setError("O código não foi aceito. Tente novamente com a nova imagem.");
            }
          },
          onDocument: (document) => {
            saveFile(document.blob, document.fileName);
            setPublicationChallenge(undefined);
            setDownloadingPublication("");
            setDocumentStatus({
              operationId,
              message: "Download concluído.",
            });
            documentSession.current = undefined;
          },
          onError: (code) => {
            setError(documentSessionError(code));
            setPublicationChallenge(undefined);
            setDownloadingPublication("");
            setDocumentStatus(undefined);
            documentSession.current = undefined;
          },
        },
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível abrir a publicação.",
      );
      setDownloadingPublication("");
      setDocumentStatus(undefined);
    }
  };

  const completePublicationChallenge = (event: FormEvent) => {
    event.preventDefault();
    if (!authSession || !publicationChallenge) return;
    const answer = publicationChallenge.answer.trim();
    if (!answer) {
      setError("Digite o código de segurança exibido pelo tribunal.");
      return;
    }
    setDownloadingPublication(publicationChallenge.operationId);
    setDocumentStatus({
      operationId: publicationChallenge.operationId,
      message: "Validando o código no tribunal…",
    });
    setError("");
    try {
      documentSession.current?.answer(answer);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível validar o código de segurança.",
      );
      setDownloadingPublication("");
      setDocumentStatus({
        operationId: publicationChallenge.operationId,
        message: "Revise o código e tente novamente.",
      });
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#top">Ir para o conteúdo principal</a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Meu Processo — início">
          <span className="brand-mark" aria-hidden="true">MP</span>
          <span>Meu Processo</span>
        </a>
        <div className="topbar-actions">
          <div className="mode-switch" aria-label="Modo de visualização">
            <button
              type="button"
              aria-pressed={viewMode === "simple"}
              onClick={() => setViewMode("simple")}
            >
              Modo simples
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "advanced"}
              onClick={() => setViewMode("advanced")}
            >
              Modo avançado
            </button>
          </div>
          <AccountAccess
            loadClient={loadAuthClient}
            fetcher={fetcher}
            onSessionChange={changeSession}
          />
          <span className="source-badge">Fonte oficial · DJEN</span>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="page-title">
          <div className="eyebrow">Consulta privada em validação</div>
          <h1 id="page-title">Encontre publicações. Confirme cada processo.</h1>
          <p className="hero-copy">
            Consulte o Diário de Justiça Eletrônico Nacional e veja as publicações
            agrupadas pelo número único do processo. Seus perfis ficam vinculados à
            conta com identificadores protegidos e rótulos minimizados.
          </p>
        </section>

        <section className="workspace" aria-label="Nova consulta">
          <form className="search-panel" onSubmit={submit}>
            <fieldset className="target-types">
              <legend>Buscar por</legend>
              {(["name", "cpf", "cnpj"] as const).map((option) => (
                <label key={option} className={type === option ? "active" : ""}>
                  <input
                    type="radio"
                    name="target-type"
                    value={option}
                    checked={type === option}
                    onChange={() => {
                      setType(option);
                      setValue("");
                    }}
                  />
                  {option === "name" ? "Nome" : option.toUpperCase()}
                </label>
              ))}
            </fieldset>

            <label className="input-label" htmlFor="target-value">
              {labels[type].input}
            </label>
            <div className="search-row">
              <input
                id="target-value"
                name="target-value"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={labels[type].placeholder}
                autoComplete="off"
                required
              />
              <button type="submit" disabled={loading || profilesLoading}>
                {loading
                  ? "Consultando…"
                  : profilesLoading
                    ? "Carregando conta…"
                    : "Cadastrar e buscar"}
              </button>
            </div>

            {type !== "name" && (
              <p className="scope-note">
                <strong>Busca experimental:</strong> o DJEN não possui filtro por {type.toUpperCase()}.
                Só encontraremos publicações nas quais o documento aparece no texto.
              </p>
            )}
            <p className="privacy-note">
              O navegador não grava o nome ou documento informado. A conta recebe
              somente um rótulo minimizado; o identificador é cifrado no servidor.
            </p>
          </form>

          <aside className="saved-panel" aria-labelledby="saved-title">
            <div className="panel-heading">
              <h2 id="saved-title">Perfis monitorados</h2>
              <span>{profiles.length}</span>
            </div>
            {profilesLoading ? (
              <p className="empty-copy" role="status">Carregando perfis…</p>
            ) : profiles.length === 0 ? (
              <p className="empty-copy">Nenhum perfil ativo cadastrado.</p>
            ) : (
              <ul className="target-list">
                {profiles.map((profile) => (
                  <li key={profile.subjectId}>
                    <div className="profile-summary">
                      <span>
                        {profile.subjectType === "name"
                          ? "Nome"
                          : profile.subjectType.toUpperCase()}
                      </span>
                      <strong>{profile.displayLabel}</strong>
                      <small>
                        {profile.processCount === 1
                          ? "1 processo encontrado"
                          : `${profile.processCount} processos encontrados`}
                      </small>
                      {profile.processSummary.length > 0 ? (
                        <ul className="profile-process-summary">
                          {profile.processSummary.map((process) => (
                            <li key={`${profile.subjectId}:${process.cnjNumber}`}>
                              {process.cnjNumber} · {process.tribunal}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <small className="profile-awaiting">
                          Aguardando a primeira atualização.
                        </small>
                      )}
                    </div>
                    <button
                      className="profile-archive"
                      type="button"
                      disabled={profileUpdatingId === profile.subjectId}
                      onClick={() => void archiveProfile(profile)}
                      aria-label={`Arquivar perfil ${profile.displayLabel}`}
                    >
                      {profileUpdatingId === profile.subjectId
                        ? "Arquivando…"
                        : "Arquivar"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </section>

        {!authSession ? (
          <p className="auth-required-note">
            Entre com um e-mail confirmado para consultar e abrir publicações
            pela conexão brasileira.
          </p>
        ) : null}

        {error && <p className="error-banner" role="alert">{error}</p>}

        {searchHistory.length > 0 ? (
          <section className="search-history" aria-labelledby="search-history-title">
            <div className="search-history-heading">
              <div>
                <span className="eyebrow">Resultados agrupados</span>
                <h2 id="search-history-title">Consultas desta sessão</h2>
              </div>
              <span>{searchHistory.length}</span>
            </div>
            <ul>
              {searchHistory.map((search) => (
                <li key={search.target.id}>
                  <button
                    type="button"
                    aria-label={`Abrir consulta de ${search.target.displayValue}`}
                    onClick={() => {
                      setResult(search);
                      setSelectedProcess(undefined);
                    }}
                  >
                    <span className="search-history-main">
                      <strong>{search.target.displayValue}</strong>
                      <span>
                        {search.summary.processes === 1
                          ? "1 processo"
                          : `${search.summary.processes} processos`}
                      </span>
                    </span>
                    <span className="search-history-summary">
                      {search.processes.length > 0
                        ? search.processes
                            .slice(0, 3)
                            .map((process) =>
                              `${process.cnjNumber} · ${process.tribunal ?? "Tribunal não informado"}`
                            )
                            .join(" | ")
                        : "Nenhum processo agrupável nesta consulta."}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {result && (
          <section className="results" aria-labelledby="results-title">
            <div className="results-heading">
              <div>
                <div className="eyebrow">Resultado da consulta</div>
                <h2 id="results-title">{result.target.displayValue}</h2>
              </div>
              <div className="metric-row" aria-label="Resumo">
                <div><strong>{result.summary.processes}</strong><span>processos</span></div>
                <div><strong>{result.summary.publications}</strong><span>publicações</span></div>
              </div>
            </div>

            {result.warnings.map((warning) => (
              <p className="warning-banner" key={warning}>{warning}</p>
            ))}

            <aside className="process-radar" aria-labelledby="process-radar-title">
              <div>
                <span className="eyebrow">Radar Processual</span>
                <h3 id="process-radar-title">O que esta consulta conseguiu enxergar</h3>
                <p>Indícios da busca atual, não uma certidão negativa nem confirmação de identidade.</p>
              </div>
              <dl>
                <div><dt>Processos agrupados</dt><dd>{result.summary.processes}</dd></div>
                <div><dt>Tribunais identificados</dt><dd>{new Set(result.processes.map((item) => item.tribunal).filter(Boolean)).size}</dd></div>
                <div><dt>Confiança da estratégia</dt><dd>{result.source.confidence === "medium" ? "Moderada" : "Experimental"}</dd></div>
                <div><dt>Publicações sem processo</dt><dd>{result.summary.ungroupedPublications}</dd></div>
              </dl>
            </aside>

            {result.processes.length === 0 ? (
              <div className="empty-result">
                <h3>Nenhuma publicação agrupável encontrada</h3>
                <p>Isso não prova que não existam processos; indica apenas que a fonte e o filtro atuais não retornaram resultados.</p>
              </div>
            ) : (
              <>
                {selectedProcess ? (
                  <article
                    className="process-detail"
                    aria-labelledby="process-detail-title"
                  >
                    <div className="process-detail-heading">
                      <div>
                        <span className="court">
                          {selectedProcess.tribunal ?? "Tribunal não informado"}
                        </span>
                        <h3 id="process-detail-title">
                          Detalhe do processo {selectedProcess.cnjNumber}
                        </h3>
                      </div>
                      <button
                        type="button"
                        className="detail-close"
                        onClick={() => {
                          documentSession.current?.close();
                          documentSession.current = undefined;
                          setSelectedProcess(undefined);
                          setPublicationChallenge(undefined);
                          setDownloadingPublication("");
                          setDownloadingPublicationCopy("");
                          setDocumentStatus(undefined);
                        }}
                      >
                        Fechar detalhe
                      </button>
                    </div>
                    <dl className="process-meta">
                      <div><dt>Última publicação</dt><dd>{formatDate(selectedProcess.lastPublicationAt)}</dd></div>
                      <div><dt>Órgão</dt><dd>{selectedProcess.organ ?? "Não informado"}</dd></div>
                      <div><dt>Classe</dt><dd>{selectedProcess.className ?? "Não informada"}</dd></div>
                    </dl>
                    <div className="publication-list">
                      {selectedProcess.publications.map((publication) => {
                        const operationId = `${selectedProcess.cnjNumber}:${publication.communicationNumber ?? "none"}`;
                        return (
                          <div className="publication" key={publication.id}>
                            <time>{formatDate(publication.availableAt)}</time>
                            <p>{publication.summary || "Texto não informado pela fonte."}</p>
                            {publication.communicationNumber !== undefined ? (
                              <>
                                <button
                                  className="proxy-download"
                                  type="button"
                                  disabled={downloadingPublicationCopy === operationId}
                                  onClick={() =>
                                    void downloadPublicationCopy(selectedProcess, publication)
                                  }
                                >
                                  {downloadingPublicationCopy === operationId
                                    ? "Preparando cópia…"
                                    : "Baixar cópia da publicação"}
                                </button>
                                <small className="copy-disclaimer">
                                  Reprodução do texto oficial do DJEN; não substitui o original do tribunal.
                                </small>
                                {publication.documentAvailable ? (
                                  <button
                                    className="original-download"
                                    type="button"
                                    disabled={downloadingPublication === operationId}
                                    onClick={() =>
                                      void downloadOriginalPublication(
                                        selectedProcess,
                                        publication,
                                      )
                                    }
                                  >
                                    {downloadingPublication === operationId
                                      ? "Abrindo pelo Brasil…"
                                      : "Tentar documento original (experimental)"}
                                  </button>
                                ) : null}
                                {documentStatus?.operationId === operationId ? (
                                  <p
                                    className="document-session-status"
                                    aria-live="polite"
                                  >
                                    {documentStatus.message}
                                  </p>
                                ) : null}
                                {publicationChallenge?.operationId === operationId ? (
                                  <form
                                    className="document-challenge"
                                    onSubmit={(event) =>
                                      void completePublicationChallenge(event)
                                    }
                                  >
                                    <div className="challenge-heading">
                                      <strong>Confirmação do tribunal</strong>
                                      <span>
                                        Digite o código da imagem. Ele expira em poucos minutos.
                                      </span>
                                    </div>
                                    <img
                                      src={publicationChallenge.imageDataUrl}
                                      alt="Código de segurança exibido pelo tribunal"
                                      width="220"
                                      height="120"
                                    />
                                    <label htmlFor={`challenge-${operationId}`}>
                                      Código de segurança
                                    </label>
                                    <div className="challenge-actions">
                                      <input
                                        id={`challenge-${operationId}`}
                                        name="challenge-answer"
                                        value={publicationChallenge.answer}
                                        maxLength={32}
                                        autoComplete="off"
                                        spellCheck={false}
                                        pattern="[A-Za-z0-9]+"
                                        required
                                        onChange={(event) =>
                                          setPublicationChallenge((current) =>
                                            current
                                              ? {
                                                  ...current,
                                                  answer: event.target.value,
                                                }
                                              : current,
                                          )
                                        }
                                      />
                                      <button
                                        className="challenge-primary"
                                        type="submit"
                                        disabled={
                                          downloadingPublication === operationId
                                        }
                                      >
                                        Validar e baixar
                                      </button>
                                      <button
                                        className="challenge-secondary"
                                        type="button"
                                        onClick={() =>
                                          {
                                            documentSession.current?.close();
                                            documentSession.current = undefined;
                                            setPublicationChallenge(undefined);
                                            setDownloadingPublication("");
                                            setDocumentStatus(undefined);
                                          }
                                        }
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </form>
                                ) : null}
                              </>
                            ) : (
                              <span className="document-unavailable">
                                Publicação sem identificador para gerar a cópia.
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="detail-safety-note">
                      Resultado público do DJEN. Confirme identidade e conteúdo
                      no tribunal; nomes podem corresponder a homônimos.
                    </p>
                  </article>
                ) : null}

                {viewMode === "advanced" ? (
              <div className="advanced-portfolio">
                <div className="portfolio-intro">
                  <div>
                    <span className="court">Visão profissional</span>
                    <h3>Resultado técnico da consulta atual</h3>
                  </div>
                  <p>Validação pontual da fonte oficial; a carteira monitorada permanece acima.</p>
                </div>
                <div className="table-scroll" tabIndex={0} aria-label="Tabela da carteira de processos">
                  <table className="portfolio-table">
                    <thead>
                      <tr>
                        <th scope="col">Processo</th>
                        <th scope="col">Tribunal</th>
                        <th scope="col">Órgão</th>
                        <th scope="col">Classe</th>
                        <th scope="col">Publicações</th>
                        <th scope="col">Última publicação</th>
                        <th scope="col">Proveniência</th>
                        <th scope="col">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.processes.map((process) => (
                        <tr key={process.cnjNumber}>
                          <td className="process-number">{process.cnjNumber}</td>
                          <td>{process.tribunal ?? "Não informado"}</td>
                          <td>{process.organ ?? "Não informado"}</td>
                          <td>{process.className ?? "Não informada"}</td>
                          <td>{process.publicationCount}</td>
                          <td>{formatDate(process.lastPublicationAt)}</td>
                          <td><span className="provenance-chip">DJEN · oficial</span></td>
                          <td>
                            <button
                              type="button"
                              className="open-process"
                              onClick={() => setSelectedProcess(process)}
                            >
                              Abrir processo
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
                ) : (
              <div className="process-list">
                {result.processes.map((process) => (
                  <article className="process-card" key={process.cnjNumber}>
                    <div className="process-head">
                      <div>
                        <span className="court">{process.tribunal ?? "Tribunal não informado"}</span>
                        <h3>{process.cnjNumber}</h3>
                      </div>
                      <div className="publication-count">{process.publicationCount} publicações</div>
                    </div>
                    <button
                      type="button"
                      className="open-process"
                      onClick={() => setSelectedProcess(process)}
                    >
                      Abrir processo
                    </button>
                    <dl className="process-meta">
                      <div><dt>Última publicação</dt><dd>{formatDate(process.lastPublicationAt)}</dd></div>
                      <div><dt>Órgão</dt><dd>{process.organ ?? "Não informado"}</dd></div>
                      <div><dt>Classe</dt><dd>{process.className ?? "Não informada"}</dd></div>
                    </dl>
                    <div className="publication-list">
                      {process.publications.map((publication) => (
                        <div className="publication" key={publication.id}>
                          <time>{formatDate(publication.availableAt)}</time>
                          {(publication.communicationType ||
                            publication.medium ||
                            publication.documentType ||
                            publication.communicationNumber !== undefined) && (
                            <dl className="publication-meta" aria-label="Detalhes da publicação">
                              {publication.communicationType && (
                                <div><dt>Tipo</dt><dd>{publication.communicationType}</dd></div>
                              )}
                              {publication.medium && (
                                <div><dt>Meio</dt><dd>{publication.medium}</dd></div>
                              )}
                              {publication.documentType && (
                                <div><dt>Documento</dt><dd>{publication.documentType}</dd></div>
                              )}
                              {publication.communicationNumber !== undefined && (
                                <div>
                                  <dt>Identificador</dt>
                                  <dd>Comunicação {publication.communicationNumber}</dd>
                                </div>
                              )}
                            </dl>
                          )}
                          <p>{publication.summary || "Texto não informado pela fonte."}</p>
                          {publication.communicationNumber !== undefined ? (
                            <span className="proxy-available">
                              Cópia PDF do DJEN disponível
                              {publication.documentAvailable
                                ? " · original experimental"
                                : ""}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div className="provenance-rail">
                      <span>Origem dos dados</span>
                      <strong>DJEN · fonte oficial</strong>
                      <small>Confirme detalhes sensíveis na publicação original.</small>
                    </div>
                  </article>
                ))}
              </div>
                )}
              </>
            )}
          </section>
        )}

        {authSession ? (
          <>
            <ActivityCenter
              session={authSession}
              fetcher={fetcher}
              viewMode={viewMode}
              profileCount={profiles.filter((profile) => profile.status === "active").length}
              profilesLoading={profilesLoading}
            />
            <BillingPanel fetcher={fetcher} session={authSession} />
            <AccountDataControls
              fetcher={fetcher}
              session={authSession}
              saveFile={saveFile}
            />
          </>
        ) : null}
      </main>

      <footer>
        <span>Perfis protegidos · respostas privadas e sem cache</span>
        <span>Confirme informações críticas no tribunal de origem.</span>
      </footer>
    </div>
  );
}
