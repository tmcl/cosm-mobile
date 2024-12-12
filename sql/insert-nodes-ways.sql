insert or replace into nodes_ways (way_id, version, observed, node_id, ordering)
    select t.value->>'id' as way_id, t.value->>'version', datetime('now'), n.value as node_id, n.key
    from json_each($json, '$.elements') as t
        join json_each(t.value->'nodes') n
    where t.value->>'type' = 'way'
        and t.value->'tags'->>'highway' is not null