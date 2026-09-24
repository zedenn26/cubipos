# CubiPOS complete schema backup

`cubipos-complete-schema.sql` is a single, runnable schema for a **fresh Supabase project**. It contains all numbered migrations, PostgreSQL functions, constraints, triggers, RLS policies, storage buckets, default country/tax configuration and the schema migration ledger.

It does not contain passwords, API keys, Supabase Auth users or existing transactional data.

## Restore into another Supabase project

1. Create the new Supabase project and wait for it to finish provisioning.
2. Open **SQL Editor** in the new project.
3. Create a new query and paste the complete contents of `cubipos-complete-schema.sql`.
4. Select **Run** and wait for the transaction to finish.
5. Verify the installation with:

```sql
select version, filename, applied_at
from public.mypos_schema_migrations
order by version;
```

The result should contain versions `0001` through `0018`.

Configure the new project URL and keys in `.env.local`, then bootstrap the first System Super Admin using the documented bootstrap command. Do not copy credentials from another project.

## Verify file integrity

From this directory, run one of:

```bash
sha256sum --check SHA256SUMS
```

```bash
shasum -a 256 --check SHA256SUMS
```

## Regenerate after database changes

From the project root:

```bash
npm run db:backup
```

Commit the updated SQL backup and `SHA256SUMS` whenever a new migration is added.
