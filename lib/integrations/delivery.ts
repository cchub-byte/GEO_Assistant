import { prisma } from "@/lib/db";

export async function dispatchProjectEvent(projectId: string, eventType: string, payload: unknown) {
  const integrations = await prisma.integrationConfig.findMany({ where: { projectId, enabled: true } });
  for (const integration of integrations) {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        integrationId: integration.id,
        eventType,
        payload: JSON.stringify(payload),
        status: "queued"
      }
    });
    try {
      const body = integration.type === "feishu" ? toFeishuPayload(eventType, payload) : payload;
      const response = await fetch(integration.endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: response.ok ? "succeeded" : "failed",
          responseStatus: response.status,
          failureReason: response.ok ? null : await response.text().catch(() => "delivery_failed")
        }
      });
    } catch (error) {
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          failureReason: error instanceof Error ? error.message : "unknown_error",
          retryCount: { increment: 1 }
        }
      });
    }
  }
}

function toFeishuPayload(eventType: string, payload: unknown) {
  const content =
    typeof payload === "object" && payload !== null
      ? JSON.stringify(payload, null, 2).slice(0, 3500)
      : String(payload).slice(0, 3500);
  return {
    msg_type: "text",
    content: {
      text: `GEO ${eventType}\n${content}`
    }
  };
}

