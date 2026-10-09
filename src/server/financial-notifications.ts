import type { FinancialStore } from "@/core/financial/store";
import type { AuditEvent, WorkspaceIdentity } from "@/core/financial/types";
import { getServerProviderForUser } from "./provider";
import { pluginRegistry } from "@/plugins/registry";
import { deliverFinancialOutbox } from "./financial-recovery";
import type { Invoice } from "@/core/entities";

/** Notifications are delivered at least once after the financial commit.
 * A failing consumer leaves leased work retryable; eventId is stable on retry. */
export async function drainFinancialNotifications(
  store: FinancialStore,
  workspace: WorkspaceIdentity,
  deadline?: number,
) {
  await deliverFinancialOutbox(
    store,
    workspace,
    async (topic, payload, id) => {
      if (topic !== "payment.confirmed") return;
      const audit = JSON.parse(payload) as AuditEvent;
      const timeline = await store.getInvoiceTimeline(
        workspace,
        audit.invoiceId,
        { limit: 1 },
      );
      const payment = timeline.payments.find(
        (item) => item.id === audit.detail.paymentId,
      );
      if (!payment) throw new Error("Financial notification payment missing");
      const current = await getServerProviderForUser(
        workspace.userId,
      ).getInvoice(audit.invoiceId);
      // The receipt describes the paid revision, even if the owner has since
      // edited/deleted the invoice. This is the canonical snapshot, not input
      // interpreted as executable content.
      const invoice = {
        ...JSON.parse(payment.invoice.fingerprint),
        status: "paid",
        updatedAt: payment.confirmedAt,
      } as Invoice;
      if (
        audit.detail.projectionMatched !== false &&
        audit.detail.projection !== false &&
        current?.status === "paid"
      ) {
        await pluginRegistry.emit("onInvoicePaid", invoice, {
          retryFailures: true,
        });
      }
      await pluginRegistry.emit(
        "onPaymentReceived",
        {
          invoice,
          amountCents: payment.money.minorUnits,
          currency: payment.money.currency,
          provider: payment.scope.provider,
          externalId: payment.providerPaymentId,
          eventId: id,
        },
        { retryFailures: true },
      );
    },
    50,
    deadline,
  );
}
