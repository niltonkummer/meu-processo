import type { TenantScope } from "./access-control.js";

export type MonitoringTargetType = "name" | "cpf" | "cnpj" | "cnj" | "oab";
export type MonitoringTargetStatus = "active" | "inactive";

export interface MonitoringTarget {
  targetId: string;
  scope: TenantScope;
  type: MonitoringTargetType;
  displayValue: string;
  protectedReference: string;
  status: MonitoringTargetStatus;
  createdByUserId: string;
  createdAt: string;
  lastCheckedAt?: string;
}

export interface MonitoringSourceState {
  targetId: string;
  sourceId: string;
  status: "available" | "partial" | "unavailable";
  lastAttemptAt: string;
  lastSuccessfulAt?: string;
  nextAttemptAt?: string;
}

export interface AuditEvent {
  auditEventId: string;
  scope: TenantScope;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: "allowed" | "denied";
  occurredAt: string;
}
