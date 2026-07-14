ALTER TABLE "supplier"."fixtures"
  DROP CONSTRAINT IF EXISTS "fixtures_supplier_fixture_id_key";

ALTER TABLE "supplier"."fixtures"
  ADD CONSTRAINT "supplier_fixtures_source_identity_unique"
  UNIQUE ("supplier", "supplier_fixture_id");
