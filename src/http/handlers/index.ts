import type { PrivateRequestHandler } from "../private-api.js";
import { handlePrivateAlerts } from "./alerts.js";
import { handleAccountData } from "./account-data.js";
import { handlePrivateCases } from "./cases.js";
import { handleMonitoringProfiles } from "./monitoring-subjects.js";
import { handlePublicationProxy } from "./publications.js";
import { handlePublicationCopy } from "./publication-copy.js";
import { handleAuthenticatedSearch } from "./search.js";
import { handlePrivateSession } from "./session.js";
import { handlePrivateBilling } from "./billing.js";

// Order is part of the transport contract: specific publication routes are
// resolved before generic case/search fallbacks.
export const privateRequestHandlers: readonly PrivateRequestHandler[] = [
  handlePrivateSession,
  handlePrivateBilling,
  handleAccountData,
  handlePublicationCopy,
  handlePublicationProxy,
  handleMonitoringProfiles,
  handlePrivateAlerts,
  handlePrivateCases,
  handleAuthenticatedSearch,
];
