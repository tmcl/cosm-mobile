select json_object(
        'type',
        'Feature',
        'id',
        cast (ways.id as text),
        'geometry',
        json(asgeojson(ways.geombuffered)),
        'properties',
        json(ways.properties)
    ) as geojson,
    json_object(
        'type',
        'Feature',
        'id',
        cast (ways.id as text),
        'geometry',
        json(asgeojson(ways.geom)),
        'properties',
        json(ways.properties)
    ) as centreline,
    json_group_array(json_object('ix', n.key, 'others', nodes_ways.way_id, 'node_tags', nodes.properties, 'way_tags', other_way.properties)) as other_ways,
    st_length(ways.geomgda) as length
from ways
join json_each(ways.nodes) n
left join nodes_ways on n.value = nodes_ways.node_id and nodes_ways.way_id <> ways.id
left join nodes on nodes.id = nodes_ways.node_id
left join ways as other_way on other_way.id = nodes_ways.way_id
where st_EnvelopesIntersects(ways.geombuffered, $minlon, $minlat, $maxlon, $maxlat)
group by ways.id
limit 1000