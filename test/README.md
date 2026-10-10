Backend tests run the checked-in SQL in real PostgreSQL via PGlite. `auth.uid()`,
Supabase's identity rows, API roles, and Storage's base tables are local fixtures.
They verify database permissions and RPC behavior, not hosted Supabase Auth or
the external SMS/SMTP provider. Hosted delivery and two real accounts must pass
before enabling the respective login flags or claiming production sync.
