SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
CREATE TABLE "profile_erasure_operations" (
	"integration_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"external_learner_id" text NOT NULL,
	"begun_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "profile_erasure_operations_integration_id_operation_id_pk" PRIMARY KEY("integration_id","operation_id"),
	CONSTRAINT "profile_erasure_operations_profile_uq" UNIQUE("integration_id","external_learner_id"),
	CONSTRAINT "profile_erasure_operations_membership_ref" CHECK ("profile_erasure_operations"."external_learner_id" ~ '^pika-membership-v1-[0-9a-f]{32}$'),
	CONSTRAINT "profile_erasure_operations_completion_order" CHECK ("profile_erasure_operations"."completed_at" IS NULL OR "profile_erasure_operations"."completed_at" >= "profile_erasure_operations"."begun_at")
);
--> statement-breakpoint
ALTER TABLE "profile_erasure_operations" ADD CONSTRAINT "profile_erasure_operations_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- This table is dormant: no grants, existing-table triggers, data enrollment,
-- learner deletion, or API activation. Future callers must use the lock protocol.
CREATE FUNCTION public.preserve_profile_erasure_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'profile erasure evidence cannot be removed' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'profile erasure must begin pending' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.integration_id IS DISTINCT FROM OLD.integration_id
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.external_learner_id IS DISTINCT FROM OLD.external_learner_id
     OR NEW.begun_at IS DISTINCT FROM OLD.begun_at
     OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at) THEN
    RAISE EXCEPTION 'profile erasure binding and completion are immutable' USING ERRCODE = '23514';
  END IF;
  -- Necessary, not sufficient completion evidence. The future service must also
  -- verify the resource inventory and serialize provisioning under the same lock.
  IF NEW.completed_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.learners
    WHERE integration_id = NEW.integration_id
      AND external_learner_id = NEW.external_learner_id
  ) THEN
    RAISE EXCEPTION 'profile erasure still has a learner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER profile_erasure_operations_preserve
BEFORE INSERT OR UPDATE OR DELETE ON public.profile_erasure_operations
FOR EACH ROW EXECUTE FUNCTION public.preserve_profile_erasure_operation();
--> statement-breakpoint
CREATE TRIGGER profile_erasure_operations_no_truncate
BEFORE TRUNCATE ON public.profile_erasure_operations
FOR EACH STATEMENT EXECUTE FUNCTION public.preserve_profile_erasure_operation();
--> statement-breakpoint
REVOKE ALL ON TABLE public.profile_erasure_operations FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.preserve_profile_erasure_operation() FROM PUBLIC;
