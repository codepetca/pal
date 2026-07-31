export {
  SCHEMA_VERSION,
  V1_ERRORS,
  V1_EVENT_TYPES,
  type ClassroomJoinedEvent,
  type DailyLogCompletedEvent,
  type DailyLogWeekConfiguredEvent,
  type LearningItemCompletedEvent,
  type LearningItemViewedEvent,
  type OpaqueToken,
  type PeriodKey,
  type SessionStartedEvent,
  type V1Envelope,
  type V1Error,
  type V1EventType,
  type V1Metadata,
  type V1ValidationResult,
} from "./types";

export { isV1Payload, validateV1Event } from "./validate";
