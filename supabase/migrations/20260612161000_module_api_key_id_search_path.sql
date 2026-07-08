-- Follow-up to 20260612160000 (Session 9), caught by the security advisor:
-- pin module_api_key_id()'s search_path. The function touches no tables, but
-- a mutable search_path on anything in the op call chain is a lint-level
-- hazard — same hygiene as every other function in the chain.

ALTER FUNCTION public.module_api_key_id() SET search_path = public;
