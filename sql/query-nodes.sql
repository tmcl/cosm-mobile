select json_object(
        'type', 'Feature',
        'id', cast(id as text),
        'geometry', json(asgeojson(geom)),
        'properties', json(properties)
    ) as geojson
from nodes
where properties->>'type' = 'node'
    and properties->'tags'->>'traffic_sign' is not null
    and st_EnvelopesIntersects(geom, $minlon, $minlat, $maxlon, $maxlat)
limit 1000