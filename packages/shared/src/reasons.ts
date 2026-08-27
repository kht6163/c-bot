export const DELIVERY_REASONS = [
  "unknown",
  "target_not_found",
  "target_self",
  "not_bot_chat",
  "runtime_offline",
  "delivery_timeout",
  "target_busy",
  "provider_auth_or_access",
  "provider_quota_limit",
  "provider_rate_limit",
  "provider_server_error",
  "context_overflow",
  "missing_config",
  "model_unavailable",
  "message_too_large",
] as const;

export type DeliveryReason = (typeof DELIVERY_REASONS)[number];

export function isDeliveryReason(value: string): value is DeliveryReason {
  return (DELIVERY_REASONS as readonly string[]).includes(value);
}
