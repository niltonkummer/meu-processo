import type { Pool, PoolClient, QueryResultRow } from "pg";

import {
  BillingProjectionError,
  BillingValidationError,
  type BillingRepository,
  type BillingState,
} from "../application/personal-billing.js";
import type {
  BillingEventRepository,
  CanonicalBillingSubscriptionEvent,
} from "../application/billing-webhook.js";
import {
  RepositoryAccessDeniedError,
  type RepositoryContext,
} from "../application/foundation-repository.js";

type ConnectablePool = Pick<Pool, "connect">;

interface BillingStateRow extends QueryResultRow {
  provider_customer_ref: string;
  provider_subscription_ref: string | null;
  offer_code: "person" | null;
  subscription_status: BillingState["status"];
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

interface CustomerRow extends QueryResultRow {
  outcome: "created" | "existing";
  provider_customer_ref: string;
}
interface CheckoutReservationRow extends QueryResultRow {
  outcome: "reserved" | "created" | "expired";
  provider_customer_ref: string;
  provider_session_ref: string | null;
  expires_at: Date;
}
interface CheckoutCompletionRow extends QueryResultRow {
  outcome: "created" | "existing";
  provider_session_ref: string;
  expires_at: Date;
}
interface EventRow extends QueryResultRow {
  outcome: "applied" | "duplicate" | "stale" | "ignored";
  tenant_id: string | null;
}

const mapDatabaseError = (error: unknown): Error => {
  if (
    error instanceof RepositoryAccessDeniedError ||
    error instanceof BillingValidationError ||
    error instanceof BillingProjectionError
  ) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code) : undefined;
  if (code === "42501") return new RepositoryAccessDeniedError();
  if (code === "22023") return new BillingValidationError();
  if (code === "23505" || code === "23514" || code === "23503") {
    return new BillingProjectionError();
  }
  return error instanceof Error ? error : new Error("Billing database operation failed.");
};

const one = <T>(rows: readonly T[]): T => {
  if (rows.length !== 1) throw new BillingProjectionError();
  return rows[0]!;
};

export class PostgresBillingRepository implements BillingRepository {
  constructor(private readonly pool: ConnectablePool) {}

  async getState(context: RepositoryContext): Promise<BillingState | null> {
    return this.withTransaction(context, async (client) => {
      const result = await client.query<BillingStateRow>(
        "select * from app_private.get_tenant_billing_state()",
      );
      if (result.rows.length === 0) return null;
      const row = one(result.rows);
      return {
        providerCustomerRef: row.provider_customer_ref,
        providerSubscriptionRef: row.provider_subscription_ref,
        offerCode: row.offer_code,
        status: row.subscription_status,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
      };
    });
  }

  async bindCustomer(context: RepositoryContext, input: {
    provider: "stripe";
    providerCustomerRef: string;
    livemode: boolean;
    createdAt: Date;
  }) {
    return this.withTransaction(context, async (client) => {
      const row = one((await client.query<CustomerRow>(
        `select * from app_private.bind_tenant_billing_customer(
          $1::text,$2::text,$3::boolean,$4::timestamptz
        )`,
        [input.provider, input.providerCustomerRef, input.livemode, input.createdAt],
      )).rows);
      return {
        outcome: row.outcome,
        providerCustomerRef: row.provider_customer_ref,
      };
    });
  }

  async reserveCheckout(context: RepositoryContext, input: {
    requestId: string;
    offerCode: "person";
    requestedAt: Date;
  }) {
    return this.withTransaction(context, async (client) => {
      const row = one((await client.query<CheckoutReservationRow>(
        `select * from app_private.reserve_tenant_checkout_attempt(
          $1::uuid,$2::text,$3::timestamptz
        )`,
        [input.requestId, input.offerCode, input.requestedAt],
      )).rows);
      return {
        outcome: row.outcome,
        providerCustomerRef: row.provider_customer_ref,
        providerSessionRef: row.provider_session_ref,
        expiresAt: row.expires_at,
      };
    });
  }

  async completeCheckout(context: RepositoryContext, input: {
    requestId: string;
    providerSessionRef: string;
    completedAt: Date;
    expiresAt: Date;
  }) {
    return this.withTransaction(context, async (client) => {
      const row = one((await client.query<CheckoutCompletionRow>(
        `select * from app_private.complete_tenant_checkout_attempt(
          $1::uuid,$2::text,$3::timestamptz,$4::timestamptz
        )`,
        [input.requestId, input.providerSessionRef, input.completedAt, input.expiresAt],
      )).rows);
      return {
        outcome: row.outcome,
        providerSessionRef: row.provider_session_ref,
        expiresAt: row.expires_at,
      };
    });
  }

  private async withTransaction<T>(
    context: RepositoryContext,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `select set_config('app.current_user_id',$1,true),
                set_config('app.current_tenant_id',$2,true),
                set_config('statement_timeout','5000',true),
                set_config('lock_timeout','3000',true),
                set_config('idle_in_transaction_session_timeout','5000',true)`,
        [context.userId, context.tenantId],
      );
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw mapDatabaseError(error);
    } finally {
      client.release();
    }
  }
}

export class PostgresBillingEventRepository implements BillingEventRepository {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async apply(event: CanonicalBillingSubscriptionEvent, receivedAt: Date) {
    try {
      const row = one((await this.pool.query<EventRow>(
        `select * from app_private.apply_billing_subscription_event(
          $1::text,$2::text,$3::boolean,$4::bytea,$5::text,$6::text,
          $7::text,$8::text,$9::timestamptz,$10::timestamptz,$11::boolean,
          $12::timestamptz,$13::timestamptz
        )`,
        [
          event.providerEventRef, event.eventType, event.livemode,
          Buffer.from(event.payloadHash), event.providerCustomerRef,
          event.providerSubscriptionRef, event.offerCode,
          event.subscriptionStatus, event.currentPeriodStart,
          event.currentPeriodEnd, event.cancelAtPeriodEnd,
          event.providerCreatedAt, receivedAt,
        ],
      )).rows);
      return { outcome: row.outcome, tenantId: row.tenant_id };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
}
