select json_object(
        'type', 'Feature',
        'geometry', json(asgeojson(geom)),
        'properties', json(properties)
    ) as geojson
from nodes
where properties->>'type' = 'node'
    and properties->'tags'->>'traffic_sign' is not null
limit 1000