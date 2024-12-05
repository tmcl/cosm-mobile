insert
    or replace into nodes (id, observed, geom, version, properties)
select t.value->>'id',
    datetime(),
    MakePoint(t.value->>'lon', t.value->>'lat', 4326) as makepoint,
    t.value->>'version',
    jsonb(t.value)
from json_each($json, '$.elements') as t
where t.value->>'type' = 'node';