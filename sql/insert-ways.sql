with data as (
    select t.value->>'id' as id,
        datetime() as observed,
        setsrid(
            MakeLine(
                nodes.geom
                order by n.key
            ),
            4326
        ) as geom,
        t.value->>'version' as version,
        jsonb(t.value->'nodes') as nodes,
        jsonb(t.value) as properties,
        coalesce(
            case when typeof(t.value->'tags'->>'width') in ('integer' , 'real') and cast(t.value->'tags'->>'width' as real) > 0 then t.value->'tags'->>'width' end,
            t.value->'tags'->>'lanes' * 3.5,
            case
                when t.value->'tags'->>'highway' = 'footway' then 2
                when t.value->'tags'->>'highway' = 'service' then 3.5
                when coalesce(t.value->'tags'->>'oneway', 'no') = 'no' then 7
                else 3.5
            end
        ) as width
    from json_each($json, '$.elements') as t
        join json_each(t.value->'nodes') n
        join nodes on nodes.id = n.value
    where t.value->>'type' = 'way'
        and t.value->'tags'->>'highway' is not null
    group by t.value->>'id'
)
insert into ways (
        id,
        observed,
        geom,
        geomgda,
        version,
        nodes,
        properties,
        width
    )
select id,
    observed,
    geom,
    transform(geom, 7855) as geomgda,
    version,
    nodes,
    properties,
    width
from data
where true
on conflict(id) do update set version = excluded.version
      , observed = excluded.observed
      , geom = excluded.geom
    , geomgda = excluded.geomgda
    , geombuffered = excluded.geombuffered
    , geombufferedgda = excluded.geombufferedgda
    , nodes = excluded.nodes
    , properties = excluded.properties
    , width = excluded.width
    where ways.version <> excluded.version
;