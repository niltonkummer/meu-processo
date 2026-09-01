import { useEffect, useRef, useState } from "react";

import type { AuthenticatedWebSession } from "./auth-client";
import {
  listAlertsPage,
  listCaseTimelinePage,
  markAlertRead,
  type CaseAlert,
  type CaseTimelineEvent,
} from "./case-activity-client";
import {
  listPersistedCasesPage,
  type PersistedPortfolioCase,
} from "./persisted-portfolio-client";
import {
  downloadPersistedDocument,
  listPersistedDocumentsPage,
  requestPersistedDocumentMaterialization,
  type DocumentMaterializationState,
  type PersistedCaseDocument,
} from "./persisted-document-client";

type ViewMode = "simple" | "advanced";

interface SelectedCase {
  readonly caseId: string;
  readonly cnjNumber: string;
  readonly tribunal: string;
  readonly sourceEventId?: string;
  readonly alertId?: string;
}

const MAX_PAGES = 100;

const saveDocumentBytes = (
  bytes: Uint8Array,
  mediaType: "application/pdf",
  fileName: string,
): void => {
  const blob = new Blob([Uint8Array.from(bytes)], { type: mediaType });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const safeMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const formatInstant = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));

const ensureNoOverlap = <T, K extends keyof T>(
  current: readonly T[],
  incoming: readonly T[],
  id: K,
): void => {
  const seen = new Set(current.map((item) => item[id]));
  if (incoming.some((item) => seen.has(item[id]))) {
    throw new Error("O servidor repetiu dados de uma página anterior.");
  }
};

const appendMissing = <T, K extends keyof T>(
  current: readonly T[],
  incoming: readonly T[],
  id: K,
): readonly T[] => {
  const seen = new Set(current.map((item) => item[id]));
  return [...current, ...incoming.filter((item) => !seen.has(item[id]))];
};

const identityLabel = (status: PersistedPortfolioCase["identityStatus"]) =>
  status === "confirmed" ? "Identificação confirmada" : "Possível homônimo";

function PortfolioCard({
  item,
  selected,
  onOpen,
}: {
  readonly item: PersistedPortfolioCase;
  readonly selected: boolean;
  readonly onOpen: (item: PersistedPortfolioCase) => void;
}) {
  const officialSources = item.sources.filter((source) => source.official).length;
  return (
    <li className={`portfolio-case-card ${selected ? "selected" : ""}`}>
      <div className="portfolio-case-heading">
        <div>
          <span className="activity-subject">{item.tribunal}</span>
          <strong translate="no">{item.cnjNumber}</strong>
        </div>
        <span className={`identity-state ${item.identityStatus}`}>
          {identityLabel(item.identityStatus)}
        </span>
      </div>
      <dl className="portfolio-case-facts">
        <div>
          <dt>Última atualização</dt>
          <dd><time dateTime={item.lastUpdatedAt}>{formatInstant(item.lastUpdatedAt)}</time></dd>
        </div>
        <div>
          <dt>Procedência</dt>
          <dd>{officialSources} fonte{officialSources === 1 ? "" : "s"} oficial{officialSources === 1 ? "" : "is"}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="activity-primary"
        aria-pressed={selected}
        onClick={() => onOpen(item)}
        aria-label={`Abrir processo ${item.cnjNumber}`}
      >
        Abrir processo
      </button>
    </li>
  );
}

function PortfolioTable({
  cases,
  selectedCaseId,
  onOpen,
}: {
  readonly cases: readonly PersistedPortfolioCase[];
  readonly selectedCaseId: string | undefined;
  readonly onOpen: (item: PersistedPortfolioCase) => void;
}) {
  return (
    <div className="table-scroll persisted-portfolio-table" tabIndex={0} aria-label="Carteira persistida de processos">
      <table className="portfolio-table">
        <thead>
          <tr>
            <th scope="col">Processo</th>
            <th scope="col">Tribunal</th>
            <th scope="col">Identidade</th>
            <th scope="col">Atualização</th>
            <th scope="col">Procedência</th>
            <th scope="col">Ação</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((item) => {
            const officialSources = item.sources.filter((source) => source.official).length;
            const selected = selectedCaseId === item.caseId;
            return (
              <tr key={item.caseId} className={selected ? "selected" : undefined}>
                <td>
                  <strong className="process-number" translate="no">{item.cnjNumber}</strong>
                  <code className="portfolio-case-id" translate="no">{item.caseId}</code>
                </td>
                <td>{item.tribunal}</td>
                <td>{identityLabel(item.identityStatus)}</td>
                <td><time dateTime={item.lastUpdatedAt}>{formatInstant(item.lastUpdatedAt)}</time></td>
                <td>
                  {officialSources}/{item.sources.length} oficial{officialSources === 1 ? "" : "is"}
                </td>
                <td>
                  <button
                    type="button"
                    className="activity-primary compact"
                    aria-pressed={selected}
                    onClick={() => onOpen(item)}
                    aria-label={`Abrir processo ${item.cnjNumber}`}
                  >
                    Abrir
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AlertCard({
  alert,
  viewMode,
  marking,
  selected,
  onOpen,
  onMarkRead,
}: {
  readonly alert: CaseAlert;
  readonly viewMode: ViewMode;
  readonly marking: boolean;
  readonly selected: boolean;
  readonly onOpen: (alert: CaseAlert) => void;
  readonly onMarkRead: (alert: CaseAlert) => void;
}) {
  return (
    <li className={`activity-alert ${selected ? "selected" : ""}`}>
      <div className="activity-alert-rail" aria-hidden="true" />
      <div className="activity-alert-body">
        <div className="activity-alert-heading">
          <div>
            <span className="activity-subject">Perfil {alert.subjectLabel}</span>
            <strong translate="no">{alert.cnjNumber}</strong>
          </div>
          <span className={`read-state ${alert.status}`}>
            {alert.status === "unread" ? "Novo" : "Lido"}
          </span>
        </div>
        <div className="activity-alert-facts">
          <span>{alert.tribunal}</span>
          <time dateTime={alert.sourceOccurredAt}>{formatInstant(alert.sourceOccurredAt)}</time>
          <span>Correspondência ainda não verificada</span>
        </div>
        {viewMode === "advanced" ? (
          <dl className="activity-technical-facts">
            <div><dt>Case ID</dt><dd translate="no">{alert.caseId}</dd></div>
            <div><dt>Event ID</dt><dd translate="no">{alert.caseEventId}</dd></div>
          </dl>
        ) : null}
        <div className="activity-alert-actions">
          <button
            type="button"
            className="activity-primary"
            aria-pressed={selected}
            onClick={() => onOpen(alert)}
            aria-label={`Ver linha do tempo de ${alert.cnjNumber}`}
          >
            Ver linha do tempo
          </button>
          {alert.status === "unread" ? (
            <button
              type="button"
              className="activity-secondary"
              disabled={marking}
              onClick={() => onMarkRead(alert)}
              aria-label={`Marcar alerta de ${alert.cnjNumber} como lido`}
            >
              {marking ? "Marcando…" : "Marcar como lido"}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function TimelineEvent({
  event,
  sourceEventId,
  viewMode,
}: {
  readonly event: CaseTimelineEvent;
  readonly sourceEventId: string | undefined;
  readonly viewMode: ViewMode;
}) {
  const isSource = sourceEventId !== undefined && event.eventId === sourceEventId;
  return (
    <article
      className={`timeline-event ${isSource ? "source-event" : ""}`}
      aria-label={event.title}
      aria-current={isSource ? "true" : undefined}
    >
      <div className="timeline-marker" aria-hidden="true" />
      <div className="timeline-event-body">
        <div className="timeline-event-heading">
          <div>
            <time dateTime={event.occurredAt}>{formatInstant(event.occurredAt)}</time>
            <h4>{event.title}</h4>
          </div>
          {isSource ? <span className="origin-chip">Origem do alerta</span> : null}
        </div>
        <p>{event.description ?? "A fonte não forneceu um trecho textual."}</p>
        <ul className="timeline-sources" aria-label="Procedência do evento">
          {event.sources.map((source) => (
            <li key={source.sourceId}>
              <strong>{source.official ? "Fonte oficial" : "Fonte registrada"}</strong>
              <span>Coletado em {formatInstant(source.collectedAt)}</span>
              {viewMode === "advanced" ? <code translate="no">{source.sourceId}</code> : null}
            </li>
          ))}
        </ul>
        {viewMode === "advanced" ? (
          <div className="timeline-event-id" translate="no">Event ID · {event.eventId}</div>
        ) : null}
      </div>
    </article>
  );
}

function TimelinePanel({
  selected,
  viewMode,
  events,
  loading,
  loadingMore,
  error,
  nextCursor,
  onClose,
  onLoadMore,
  documents,
  documentsLoading,
  documentsLoadingMore,
  documentsError,
  documentsNextCursor,
  onLoadMoreDocuments,
  downloadingDocumentId,
  materializingDocumentId,
  documentMaterializationStates,
  documentMaterializationErrors,
  documentDownloadErrors,
  onDownloadDocument,
  onMaterializeDocument,
}: {
  readonly selected: SelectedCase;
  readonly viewMode: ViewMode;
  readonly events: readonly CaseTimelineEvent[];
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string;
  readonly nextCursor: string | null;
  readonly onClose: () => void;
  readonly onLoadMore: () => void;
  readonly documents: readonly PersistedCaseDocument[];
  readonly documentsLoading: boolean;
  readonly documentsLoadingMore: boolean;
  readonly documentsError: string;
  readonly documentsNextCursor: string | null;
  readonly onLoadMoreDocuments: () => void;
  readonly downloadingDocumentId: string;
  readonly materializingDocumentId: string;
  readonly documentMaterializationStates:
    Readonly<Record<string, DocumentMaterializationState>>;
  readonly documentMaterializationErrors: Readonly<Record<string, string>>;
  readonly documentDownloadErrors: Readonly<Record<string, string>>;
  readonly onDownloadDocument: (document: PersistedCaseDocument) => void;
  readonly onMaterializeDocument: (document: PersistedCaseDocument) => void;
}) {
  return (
    <section className="timeline-panel" aria-labelledby="timeline-title">
      <div className="timeline-panel-heading">
        <div>
          <span className="activity-kicker">{selected.tribunal} · fatos persistidos</span>
          <h3 id="timeline-title">
            Linha do tempo de <span translate="no">{selected.cnjNumber}</span>
          </h3>
        </div>
        <button type="button" className="timeline-close" onClick={onClose}>
          Fechar linha do tempo
        </button>
      </div>
      {viewMode === "advanced" ? (
        <div className="timeline-case-id" translate="no">Case ID · {selected.caseId}</div>
      ) : null}
      <div className="timeline-status" aria-live="polite">
        {loading ? "Carregando eventos do processo…" : null}
        {!loading && error ? <span role="alert">{error}</span> : null}
        {!loading && !error && events.length === 0
          ? "Processo persistido, mas ainda sem eventos coletados."
          : null}
      </div>
      {!loading && events.length > 0 ? (
        <div className="timeline-list">
          {events.map((event) => (
            <TimelineEvent
              key={event.eventId}
              event={event}
              sourceEventId={selected.sourceEventId}
              viewMode={viewMode}
            />
          ))}
        </div>
      ) : null}
      {nextCursor && !loading ? (
        <button
          type="button"
          className="activity-load-more"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "Carregando…" : "Carregar eventos anteriores"}
        </button>
      ) : null}
      <section className="case-documents" aria-labelledby="case-documents-title">
        <div className="case-documents-heading">
          <div>
            <span className="activity-kicker">Originais vinculados</span>
            <h4 id="case-documents-title">Documentos do processo</h4>
          </div>
          {documents.length > 0 ? (
            <span>{documents.length} carregado{documents.length === 1 ? "" : "s"}</span>
          ) : null}
        </div>
        <div className="document-status" aria-live="polite">
          {documentsLoading ? "Carregando documentos do processo…" : null}
          {!documentsLoading && documentsError ? <span role="alert">{documentsError}</span> : null}
          {!documentsLoading && !documentsError && documents.length === 0
            ? "Nenhum documento foi catalogado para este processo."
            : null}
        </div>
        {documents.length > 0 ? (
          <ul className="case-document-list">
            {documents.map((document) => {
              const requestedState =
                documentMaterializationStates[document.documentId];
              const materialization = document.artifact
                ? "Arquivo validado e pronto para download."
                : requestedState === "queued"
                  ? "Preparação solicitada. O arquivo passará por validação."
                  : requestedState === "processing"
                    ? "Arquivo em preparação e validação."
                    : requestedState === "available"
                      ? "Arquivo preparado; reabra o processo para atualizar."
                : document.availabilityStatus === "available"
                  ? "Disponível na fonte; arquivo ainda não preparado."
                  : document.availabilityStatus === "metadata_only"
                    ? "A fonte forneceu somente os metadados."
                    : document.availabilityStatus === "expired"
                      ? "A disponibilidade informada expirou."
                      : "Arquivo indisponível na última verificação.";
              return (
                <li key={document.documentId} className="case-document-card">
                  <div className="case-document-title">
                    <div>
                      <time dateTime={document.sourceCreatedAt}>{formatInstant(document.sourceCreatedAt)}</time>
                      <h5>{document.title}</h5>
                    </div>
                    <span>{document.documentType ?? "Tipo não informado"}</span>
                  </div>
                  <div className="case-document-facts">
                    <span>{document.source.official ? "Fonte oficial" : "Fonte registrada"}</span>
                    <span>{document.caseEventId ? "Vinculado a uma publicação exata" : "Vinculado ao processo"}</span>
                    <span>{materialization}</span>
                  </div>
                  {viewMode === "advanced" ? (
                    <dl className="document-technical-facts">
                      <div><dt>Document ID</dt><dd translate="no">{document.documentId}</dd></div>
                      <div><dt>Event ID</dt><dd translate="no">{document.caseEventId ?? "sem vínculo"}</dd></div>
                      <div><dt>Fonte</dt><dd translate="no">{document.source.sourceId}</dd></div>
                      <div><dt>Artefato</dt><dd translate="no">{document.artifact?.artifactId ?? "não materializado"}</dd></div>
                      {document.artifact ? (
                        <>
                          <div><dt>Tamanho</dt><dd>{document.artifact.sizeBytes.toLocaleString("pt-BR")} bytes</dd></div>
                          <div><dt>SHA-256</dt><dd translate="no">{document.artifact.sha256}</dd></div>
                        </>
                      ) : null}
                    </dl>
                  ) : null}
                  {document.artifact ? (
                    <button
                      type="button"
                      className="document-download-action"
                      disabled={downloadingDocumentId !== ""}
                      onClick={() => onDownloadDocument(document)}
                      aria-label={`Baixar ${document.title} em PDF`}
                    >
                      {downloadingDocumentId === document.documentId
                        ? "Baixando PDF…" : "Baixar PDF"}
                    </button>
                  ) : document.accessClass === "public_official" &&
                      document.source.official ? (
                    <button
                      type="button"
                      className="document-materialization-action"
                      disabled={
                        materializingDocumentId !== "" ||
                        downloadingDocumentId !== "" ||
                        requestedState !== undefined
                      }
                      onClick={() => onMaterializeDocument(document)}
                      aria-label={`Preparar ${document.title} para download`}
                    >
                      {materializingDocumentId === document.documentId
                        ? "Solicitando preparação…"
                        : requestedState === "queued"
                          ? "Preparação solicitada"
                          : requestedState === "processing"
                            ? "Em preparação"
                            : requestedState === "available"
                              ? "Arquivo preparado"
                              : "Preparar arquivo"}
                    </button>
                  ) : (
                    <button type="button" className="document-download-pending" disabled>
                      Download indisponível
                    </button>
                  )}
                  {documentMaterializationErrors[document.documentId] ? (
                    <p className="document-download-error" role="alert">
                      {documentMaterializationErrors[document.documentId]}
                    </p>
                  ) : null}
                  {documentDownloadErrors[document.documentId] ? (
                    <p className="document-download-error" role="alert">
                      {documentDownloadErrors[document.documentId]}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {documentsNextCursor && !documentsLoading ? (
          <button
            type="button"
            className="activity-load-more"
            disabled={documentsLoadingMore}
            onClick={onLoadMoreDocuments}
          >
            {documentsLoadingMore ? "Carregando…" : "Carregar documentos anteriores"}
          </button>
        ) : null}
      </section>
      <p className="timeline-safety">
        Fatos de fonte oficial. Confirme decisões e prazos no tribunal de origem.
      </p>
    </section>
  );
}

function ActivityCenterSession({
  session,
  fetcher,
  viewMode,
  profileCount = 0,
  profilesLoading = false,
}: {
  readonly session: AuthenticatedWebSession;
  readonly fetcher: typeof fetch;
  readonly viewMode: ViewMode;
  readonly profileCount?: number;
  readonly profilesLoading?: boolean;
}) {
  const [cases, setCases] = useState<readonly PersistedPortfolioCase[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [casesLoadingMore, setCasesLoadingMore] = useState(false);
  const [casesError, setCasesError] = useState("");
  const [casesCursor, setCasesCursor] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<readonly CaseAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsLoadingMore, setAlertsLoadingMore] = useState(false);
  const [alertsError, setAlertsError] = useState("");
  const [alertsCursor, setAlertsCursor] = useState<string | null>(null);
  const [markingAlertId, setMarkingAlertId] = useState("");
  const [selected, setSelected] = useState<SelectedCase>();
  const [events, setEvents] = useState<readonly CaseTimelineEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsLoadingMore, setEventsLoadingMore] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [eventsCursor, setEventsCursor] = useState<string | null>(null);
  const [documents, setDocuments] = useState<readonly PersistedCaseDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsLoadingMore, setDocumentsLoadingMore] = useState(false);
  const [documentsError, setDocumentsError] = useState("");
  const [documentsCursor, setDocumentsCursor] = useState<string | null>(null);
  const [downloadingDocumentId, setDownloadingDocumentId] = useState("");
  const [materializingDocumentId, setMaterializingDocumentId] = useState("");
  const [documentMaterializationStates, setDocumentMaterializationStates] =
    useState<Readonly<Record<string, DocumentMaterializationState>>>({});
  const [documentMaterializationErrors, setDocumentMaterializationErrors] =
    useState<Readonly<Record<string, string>>>({});
  const [documentDownloadErrors, setDocumentDownloadErrors] =
    useState<Readonly<Record<string, string>>>({});
  const initialGeneration = useRef(0);
  const timelineGeneration = useRef(0);
  const casePages = useRef(0);
  const alertPages = useRef(0);
  const timelinePages = useRef(0);
  const documentPages = useRef(0);

  useEffect(() => {
    const generation = initialGeneration.current + 1;
    initialGeneration.current = generation;
    timelineGeneration.current += 1;
    casePages.current = 0;
    alertPages.current = 0;
    timelinePages.current = 0;
    documentPages.current = 0;
    void (async () => {
      try {
        const token = await session.getIdToken();
        if (initialGeneration.current !== generation) return;
        await Promise.all([
          (async () => {
            try {
              const page = await listPersistedCasesPage(fetcher, token, { limit: 20 });
              if (initialGeneration.current !== generation) return;
              casePages.current = 1;
              setCases(page.items);
              setCasesCursor(page.nextCursor);
            } catch (error) {
              if (initialGeneration.current === generation) {
                setCasesError(safeMessage(error, "Não foi possível carregar a carteira."));
              }
            } finally {
              if (initialGeneration.current === generation) setCasesLoading(false);
            }
          })(),
          (async () => {
            try {
              const page = await listAlertsPage(fetcher, token, {
                limit: 20,
                status: "all",
              });
              if (initialGeneration.current !== generation) return;
              alertPages.current = 1;
              setAlerts(page.items);
              setAlertsCursor(page.nextCursor);
            } catch (error) {
              if (initialGeneration.current === generation) {
                setAlertsError(safeMessage(error, "Não foi possível carregar o acompanhamento."));
              }
            } finally {
              if (initialGeneration.current === generation) setAlertsLoading(false);
            }
          })(),
        ]);
      } catch (error) {
        if (initialGeneration.current === generation) {
          const message = safeMessage(error, "Não foi possível validar a sessão.");
          setCasesError(message);
          setAlertsError(message);
          setCasesLoading(false);
          setAlertsLoading(false);
        }
      }
    })();
    return () => {
      initialGeneration.current += 1;
      timelineGeneration.current += 1;
    };
  }, [fetcher, session]);

  const loadMoreCases = async () => {
    if (!casesCursor || casesLoadingMore || casePages.current >= MAX_PAGES) return;
    const cursor = casesCursor;
    setCasesLoadingMore(true);
    setCasesError("");
    try {
      const token = await session.getIdToken();
      const page = await listPersistedCasesPage(fetcher, token, {
        limit: 20,
        afterCaseId: cursor,
      });
      if (page.nextCursor === cursor) throw new Error("A paginação da carteira não avançou.");
      ensureNoOverlap(cases, page.items, "caseId");
      setCases((current) => appendMissing(current, page.items, "caseId"));
      casePages.current += 1;
      setCasesCursor(page.nextCursor);
    } catch (error) {
      setCasesError(safeMessage(error, "Não foi possível carregar mais processos."));
    } finally {
      setCasesLoadingMore(false);
    }
  };

  const loadMoreAlerts = async () => {
    if (!alertsCursor || alertsLoadingMore || alertPages.current >= MAX_PAGES) return;
    const cursor = alertsCursor;
    setAlertsLoadingMore(true);
    setAlertsError("");
    try {
      const token = await session.getIdToken();
      const page = await listAlertsPage(fetcher, token, {
        limit: 20,
        status: "all",
        cursor,
      });
      if (page.nextCursor === cursor) throw new Error("A paginação de alertas não avançou.");
      ensureNoOverlap(alerts, page.items, "alertId");
      setAlerts((current) => appendMissing(current, page.items, "alertId"));
      alertPages.current += 1;
      setAlertsCursor(page.nextCursor);
    } catch (error) {
      setAlertsError(safeMessage(error, "Não foi possível carregar mais alertas."));
    } finally {
      setAlertsLoadingMore(false);
    }
  };

  const openTimeline = async (candidate: SelectedCase) => {
    const generation = timelineGeneration.current + 1;
    timelineGeneration.current = generation;
    timelinePages.current = 0;
    documentPages.current = 0;
    setSelected(candidate);
    setEvents([]);
    setEventsCursor(null);
    setEventsError("");
    setEventsLoading(true);
    setDocuments([]);
    setDocumentsCursor(null);
    setDocumentsError("");
    setDocumentDownloadErrors({});
    setDocumentMaterializationStates({});
    setDocumentMaterializationErrors({});
    setDocumentsLoading(true);
    try {
      const token = await session.getIdToken();
      const [timelineResult, documentResult] = await Promise.allSettled([
        listCaseTimelinePage(fetcher, token, candidate.caseId, { limit: 20 }),
        listPersistedDocumentsPage(fetcher, token, candidate.caseId, { limit: 20 }),
      ]);
      if (timelineGeneration.current !== generation) return;
      if (timelineResult.status === "fulfilled") {
        timelinePages.current = 1;
        setEvents(timelineResult.value.items);
        setEventsCursor(timelineResult.value.nextCursor);
      } else {
        setEventsError(safeMessage(timelineResult.reason, "Não foi possível carregar a linha do tempo."));
      }
      if (documentResult.status === "fulfilled") {
        documentPages.current = 1;
        setDocuments(documentResult.value.items);
        setDocumentsCursor(documentResult.value.nextCursor);
      } else {
        setDocumentsError(safeMessage(documentResult.reason, "Não foi possível carregar os documentos."));
      }
    } catch (error) {
      if (timelineGeneration.current === generation) {
        const message = safeMessage(error, "Não foi possível validar a sessão.");
        setEventsError(message);
        setDocumentsError(message);
      }
    } finally {
      if (timelineGeneration.current === generation) {
        setEventsLoading(false);
        setDocumentsLoading(false);
      }
    }
  };

  const loadMoreEvents = async () => {
    if (!selected || !eventsCursor || eventsLoadingMore ||
        timelinePages.current >= MAX_PAGES) return;
    const generation = timelineGeneration.current;
    const cursor = eventsCursor;
    setEventsLoadingMore(true);
    setEventsError("");
    try {
      const token = await session.getIdToken();
      const page = await listCaseTimelinePage(fetcher, token, selected.caseId, {
        limit: 20,
        cursor,
      });
      if (timelineGeneration.current !== generation) return;
      if (page.nextCursor === cursor) throw new Error("A paginação da linha do tempo não avançou.");
      ensureNoOverlap(events, page.items, "eventId");
      setEvents((current) => appendMissing(current, page.items, "eventId"));
      timelinePages.current += 1;
      setEventsCursor(page.nextCursor);
    } catch (error) {
      if (timelineGeneration.current === generation) {
        setEventsError(safeMessage(error, "Não foi possível carregar mais eventos."));
      }
    } finally {
      if (timelineGeneration.current === generation) setEventsLoadingMore(false);
    }
  };

  const markRead = async (alert: CaseAlert) => {
    setMarkingAlertId(alert.alertId);
    setAlertsError("");
    try {
      const token = await session.getIdToken();
      const updated = await markAlertRead(fetcher, token, alert.alertId);
      if (
        updated.caseId !== alert.caseId ||
        updated.caseEventId !== alert.caseEventId ||
        updated.subjectId !== alert.subjectId ||
        updated.tenantCaseId !== alert.tenantCaseId
      ) throw new Error("O servidor devolveu um alerta diferente do solicitado.");
      setAlerts((current) => current.map((item) =>
        item.alertId === updated.alertId ? updated : item,
      ));
    } catch (error) {
      setAlertsError(safeMessage(error, "Não foi possível marcar o alerta como lido."));
    } finally {
      setMarkingAlertId("");
    }
  };

  const loadMoreDocuments = async () => {
    if (!selected || !documentsCursor || documentsLoadingMore ||
        documentPages.current >= MAX_PAGES) return;
    const generation = timelineGeneration.current;
    const cursor = documentsCursor;
    setDocumentsLoadingMore(true);
    setDocumentsError("");
    try {
      const token = await session.getIdToken();
      const page = await listPersistedDocumentsPage(fetcher, token, selected.caseId, {
        limit: 20,
        cursor,
      });
      if (timelineGeneration.current !== generation) return;
      if (page.nextCursor === cursor) throw new Error("A paginação de documentos não avançou.");
      ensureNoOverlap(documents, page.items, "documentId");
      setDocuments((current) => appendMissing(current, page.items, "documentId"));
      documentPages.current += 1;
      setDocumentsCursor(page.nextCursor);
    } catch (error) {
      if (timelineGeneration.current === generation) {
        setDocumentsError(safeMessage(error, "Não foi possível carregar mais documentos."));
      }
    } finally {
      if (timelineGeneration.current === generation) setDocumentsLoadingMore(false);
    }
  };

  const downloadDocument = async (item: PersistedCaseDocument) => {
    if (!selected || !item.artifact || item.caseId !== selected.caseId ||
        downloadingDocumentId !== "") return;
    const generation = timelineGeneration.current;
    const documentId = item.documentId;
    setDownloadingDocumentId(documentId);
    setDocumentDownloadErrors((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    try {
      const token = await session.getIdToken();
      const downloaded = await downloadPersistedDocument(
        fetcher, token, item.caseId, documentId,
        { sizeBytes: item.artifact.sizeBytes, sha256: item.artifact.sha256 },
      );
      if (timelineGeneration.current !== generation ||
          selected.caseId !== item.caseId) return;
      saveDocumentBytes(
        downloaded.bytes, downloaded.mediaType, downloaded.fileName,
      );
    } catch (error) {
      if (timelineGeneration.current === generation) {
        setDocumentDownloadErrors((current) => ({
          ...current,
          [documentId]: safeMessage(
            error, "Não foi possível baixar este documento.",
          ),
        }));
      }
    } finally {
      setDownloadingDocumentId((current) => current === documentId ? "" : current);
    }
  };

  const materializeDocument = async (item: PersistedCaseDocument) => {
    if (
      !selected || item.artifact || item.caseId !== selected.caseId ||
      item.accessClass !== "public_official" || !item.source.official ||
      materializingDocumentId !== "" || downloadingDocumentId !== "" ||
      documentMaterializationStates[item.documentId] !== undefined
    ) return;
    const generation = timelineGeneration.current;
    const documentId = item.documentId;
    setMaterializingDocumentId(documentId);
    setDocumentMaterializationErrors((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    try {
      const token = await session.getIdToken();
      const result = await requestPersistedDocumentMaterialization(
        fetcher, token, item.caseId, documentId,
      );
      if (timelineGeneration.current !== generation) return;
      setDocumentMaterializationStates((current) => ({
        ...current,
        [documentId]: result.state,
      }));
    } catch (error) {
      if (timelineGeneration.current === generation) {
        setDocumentMaterializationErrors((current) => ({
          ...current,
          [documentId]: safeMessage(
            error, "Não foi possível solicitar a preparação deste arquivo.",
          ),
        }));
      }
    } finally {
      setMaterializingDocumentId((current) =>
        current === documentId ? "" : current,
      );
    }
  };

  const closeTimeline = () => {
    timelineGeneration.current += 1;
    setSelected(undefined);
    setEvents([]);
    setEventsCursor(null);
    setEventsError("");
    setDocuments([]);
    setDocumentsCursor(null);
    setDocumentsError("");
    setDocumentDownloadErrors({});
    setDocumentMaterializationStates({});
    setDocumentMaterializationErrors({});
  };

  const unreadCount = alerts.filter((item) => item.status === "unread").length;

  return (
    <section className={`activity-center ${viewMode}`} aria-labelledby="portfolio-title">
      <div className="activity-center-heading portfolio-heading">
        <div>
          <span className="activity-kicker">Base monitorada</span>
          <h2 id="portfolio-title">Carteira de processos</h2>
          <p>Processos persistidos e separados pelo identificador interno exato.</p>
        </div>
        {cases.length > 0 ? <span className="portfolio-counter">{cases.length} carregado{cases.length === 1 ? "" : "s"}</span> : null}
      </div>

      <div className="activity-status" aria-live="polite">
        {casesLoading ? "Carregando carteira…" : null}
        {!casesLoading && casesError ? <span role="alert">{casesError}</span> : null}
      </div>

      {!casesLoading && cases.length === 0 && !casesError ? (
        <div className="activity-empty portfolio-empty">
          {profilesLoading ? (
            <><strong>Verificando seus perfis monitorados…</strong><span>A carteira será atualizada em seguida.</span></>
          ) : profileCount === 0 ? (
            <><strong>Sua carteira ainda não está monitorada.</strong><span>Cadastre um nome, CPF ou CNPJ para iniciar.</span></>
          ) : (
            <><strong>Monitoramento ativo, sem processos coletados.</strong><span>O worker ainda não projetou um processo para seus perfis.</span></>
          )}
        </div>
      ) : null}

      {cases.length > 0 ? (
        viewMode === "advanced" ? (
          <PortfolioTable
            cases={cases}
            selectedCaseId={selected?.caseId}
            onOpen={(item) => void openTimeline({
              caseId: item.caseId,
              cnjNumber: item.cnjNumber,
              tribunal: item.tribunal,
            })}
          />
        ) : (
          <ul className="portfolio-case-list">
            {cases.map((item) => (
              <PortfolioCard
                key={item.caseId}
                item={item}
                selected={selected?.caseId === item.caseId}
                onOpen={(candidate) => void openTimeline({
                  caseId: candidate.caseId,
                  cnjNumber: candidate.cnjNumber,
                  tribunal: candidate.tribunal,
                })}
              />
            ))}
          </ul>
        )
      ) : null}

      {casesCursor ? (
        <button
          type="button"
          className="activity-load-more"
          disabled={casesLoadingMore}
          onClick={() => void loadMoreCases()}
        >
          {casesLoadingMore ? "Carregando…" : "Carregar mais processos"}
        </button>
      ) : null}

      <section className="activity-feed" aria-labelledby="activity-title">
        <div className="activity-center-heading">
          <div>
            <span className="activity-kicker">Atualizações persistidas</span>
            <h2 id="activity-title">Acompanhamento</h2>
            <p>Novidades vinculadas ao processo e ao evento exatos.</p>
          </div>
          {unreadCount > 0 ? (
            <span className="unread-counter">{unreadCount} não lido{unreadCount === 1 ? "" : "s"}</span>
          ) : null}
        </div>

        <div className="activity-status" aria-live="polite">
          {alertsLoading ? "Carregando acompanhamento…" : null}
          {!alertsLoading && alertsError ? <span role="alert">{alertsError}</span> : null}
        </div>

        {!alertsLoading && alerts.length === 0 && !alertsError ? (
          <div className="activity-empty">
            <strong>Nenhuma novidade persistida ainda.</strong>
            <span>{profileCount > 0
              ? "O monitoramento está ativo e não produziu um novo alerta."
              : "Cadastre um perfil para iniciar o acompanhamento periódico."}</span>
          </div>
        ) : null}

        {alerts.length > 0 ? (
          <ul className="activity-alert-list">
            {alerts.map((alert) => (
              <AlertCard
                key={alert.alertId}
                alert={alert}
                viewMode={viewMode}
                marking={markingAlertId === alert.alertId}
                selected={selected?.alertId === alert.alertId}
                onOpen={(item) => void openTimeline({
                  alertId: item.alertId,
                  caseId: item.caseId,
                  sourceEventId: item.caseEventId,
                  cnjNumber: item.cnjNumber,
                  tribunal: item.tribunal,
                })}
                onMarkRead={(item) => void markRead(item)}
              />
            ))}
          </ul>
        ) : null}

        {alertsCursor ? (
          <button
            type="button"
            className="activity-load-more"
            disabled={alertsLoadingMore}
            onClick={() => void loadMoreAlerts()}
          >
            {alertsLoadingMore ? "Carregando…" : "Carregar alertas anteriores"}
          </button>
        ) : null}
      </section>

      {selected ? (
        <TimelinePanel
          selected={selected}
          viewMode={viewMode}
          events={events}
          loading={eventsLoading}
          loadingMore={eventsLoadingMore}
          error={eventsError}
          nextCursor={eventsCursor}
          onClose={closeTimeline}
          onLoadMore={() => void loadMoreEvents()}
          documents={documents}
          documentsLoading={documentsLoading}
          documentsLoadingMore={documentsLoadingMore}
          documentsError={documentsError}
          documentsNextCursor={documentsCursor}
          onLoadMoreDocuments={() => void loadMoreDocuments()}
          downloadingDocumentId={downloadingDocumentId}
          materializingDocumentId={materializingDocumentId}
          documentMaterializationStates={documentMaterializationStates}
          documentMaterializationErrors={documentMaterializationErrors}
          documentDownloadErrors={documentDownloadErrors}
          onDownloadDocument={(item) => void downloadDocument(item)}
          onMaterializeDocument={(item) => void materializeDocument(item)}
        />
      ) : null}
    </section>
  );
}

export function ActivityCenter(props: {
  readonly session: AuthenticatedWebSession;
  readonly fetcher: typeof fetch;
  readonly viewMode: ViewMode;
  readonly profileCount?: number;
  readonly profilesLoading?: boolean;
}) {
  return <ActivityCenterSession key={props.session.email} {...props} />;
}
