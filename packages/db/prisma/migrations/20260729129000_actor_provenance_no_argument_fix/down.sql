CREATE OR REPLACE FUNCTION validate_runtime_actor_fields()
RETURNS TRIGGER AS $$
DECLARE
  actor_id UUID;
  actor_field TEXT;
  new_payload JSONB;
  old_payload JSONB;
  new_actor_value UUID;
  old_actor_value UUID;
BEGIN
  IF current_user <> 'clearledger_runtime' THEN
    RETURN NEW;
  END IF;

  actor_id := app_current_actor_user_id();
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Workflow actor context is required';
  END IF;

  new_payload := to_jsonb(NEW);
  IF TG_OP = 'INSERT' THEN
    IF new_payload ->> 'createdByUserId' IS DISTINCT FROM actor_id::text THEN
      RAISE EXCEPTION 'Workflow creator must match the authenticated actor';
    END IF;
  ELSE
    old_payload := to_jsonb(OLD);
    IF new_payload ->> 'createdByUserId'
      IS DISTINCT FROM old_payload ->> 'createdByUserId'
    THEN
      RAISE EXCEPTION 'Workflow creator provenance is immutable';
    END IF;
  END IF;

  IF new_payload ->> 'updatedByUserId' IS DISTINCT FROM actor_id::text THEN
    RAISE EXCEPTION 'Workflow updater must match the authenticated actor';
  END IF;

  FOREACH actor_field IN ARRAY TG_ARGV
  LOOP
    new_actor_value := NULLIF(new_payload ->> actor_field, '')::UUID;
    old_actor_value := NULLIF(old_payload ->> actor_field, '')::UUID;
    IF new_actor_value IS NOT NULL
      AND new_actor_value IS DISTINCT FROM old_actor_value
      AND new_actor_value <> actor_id
    THEN
      RAISE EXCEPTION 'Workflow decision actor must match the authenticated actor';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
