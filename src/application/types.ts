import type { QueryField, TargetType } from "../domain/search-target.js";

export interface DjenPublication {
  id?: string | number | undefined;
  numeroProcesso?: string | undefined;
  tribunal?: string | undefined;
  dataDisponibilizacao?: string | undefined;
  orgao?: string | undefined;
  classe?: string | undefined;
  tipoComunicacao?: string | undefined;
  meio?: string | undefined;
  tipoDocumento?: string | undefined;
  numeroComunicacao?: number | undefined;
  texto?: string | undefined;
  link?: string | undefined;
}

export interface DjenSearchResult {
  total: number;
  truncated: boolean;
  publications: DjenPublication[];
}

export interface DjenClient {
  search(query: { field: QueryField; value: string }): Promise<DjenSearchResult>;
}

export interface SearchPublication {
  id: string;
  availableAt?: string;
  organ?: string;
  className?: string;
  communicationType?: string;
  medium?: string;
  documentType?: string;
  communicationNumber?: number;
  documentAvailable?: true;
  summary: string;
}

export interface ProcessAggregate {
  cnjNumber: string;
  tribunal?: string;
  organ?: string;
  className?: string;
  publicationCount: number;
  lastPublicationAt?: string;
  publications: SearchPublication[];
}

export interface SearchResponse {
  target: {
    id: string;
    type: TargetType;
    displayValue: string;
  };
  source: {
    id: "DJEN";
    official: true;
    strategy: QueryField;
    confidence: "medium" | "experimental";
  };
  summary: {
    publications: number;
    processes: number;
    ungroupedPublications: number;
    truncated: boolean;
  };
  processes: ProcessAggregate[];
  warnings: string[];
}
