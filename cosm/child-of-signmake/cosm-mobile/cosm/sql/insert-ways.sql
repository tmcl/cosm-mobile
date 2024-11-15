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
            t.value->'tags'->>'width',
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
),
buffereddata as (
    select id,
        observed,
        geom,
        transform(geom, 7855) as geomgda,
        buffer(transform(geom, 7855), width / 2) as geombufferedgda,
        version,
        nodes,
        properties,
        width
    from data
)
insert
    or replace into ways (
        id,
        observed,
        geom,
        geomgda,
        geombuffered,
        geombufferedgda,
        version,
        nodes,
        properties,
        width
    )
select id,
    observed,
    geom,
    transform(geom, 7855) as geomgda,
    transform(geombufferedgda, 4326) as geombuffered,
    geombufferedgda,
    version,
    nodes,
    properties,
    width
from buffereddata;