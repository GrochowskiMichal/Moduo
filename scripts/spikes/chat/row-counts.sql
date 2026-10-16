select table_schema || '.' || table_name || '=' ||
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema in ('public', 'auth', 'realtime', 'storage', '_realtime')
  and table_type = 'BASE TABLE'
order by 1;
