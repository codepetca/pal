SET LOCAL lock_timeout = '2s';
--> statement-breakpoint
ALTER TABLE "profile_erasure_operations" ADD COLUMN "policy_version" text DEFAULT 'strict-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_erasure_operations" ADD CONSTRAINT "profile_erasure_operations_policy" CHECK ("profile_erasure_operations"."policy_version" IN ('strict-v1', 'pika-live-v1'));
--> statement-breakpoint
-- Keep 0013's binding/completion trigger unchanged. No legacy policy upgrades.
CREATE FUNCTION public.preserve_profile_erasure_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION 'profile erasure policy is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER profile_erasure_operations_preserve_policy
BEFORE UPDATE OF policy_version ON public.profile_erasure_operations
FOR EACH ROW EXECUTE FUNCTION public.preserve_profile_erasure_policy();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.preserve_profile_erasure_policy() FROM PUBLIC;
