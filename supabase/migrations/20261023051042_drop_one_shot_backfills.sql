-- Drop four one-shot conversion helpers whose job is done.
--
-- - `comment_reactions__words_to_emoji()` and `reactions__respell_stored()`
--   (CV-7c, 20261017108000): turned the six TV-U13 reaction words into emoji and
--   stored every key in one spelling. The migration ran each once; they stayed
--   only so a test could run them twice.
-- - `contacts__company_link_backfill()` (20261020142000): filled a contact's
--   company and works-at link once. The triggers `contacts_company_to_link` and
--   `entity_links_works_at_to_company` keep the two in step from then on.
-- - `contacts__emails_to_jsonb(text[], text)` (contacts v2, 20260628140000):
--   used only in the `ALTER COLUMN emails TYPE jsonb USING (…)` of that migration.
--
-- Probed on prod 2026-10-23 before writing this: every conversion is complete
-- (0 word reactions, 0 non-canonical keys in comments or chat messages, 0
-- contacts missing their company or works-at link, `contacts.emails` is jsonb).
-- Nothing depends on them, and no function body, policy, trigger, default,
-- index, view or cron job references them. Only their own migrations and
-- tests ever called them. Re-runnable.
DROP FUNCTION IF EXISTS public.comment_reactions__words_to_emoji();
DROP FUNCTION IF EXISTS public.reactions__respell_stored();
DROP FUNCTION IF EXISTS public.contacts__company_link_backfill();
DROP FUNCTION IF EXISTS public.contacts__emails_to_jsonb(text[], text);
