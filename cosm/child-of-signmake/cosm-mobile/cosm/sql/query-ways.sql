select json_object(
        'type',
        'Feature',
        'geometry',
        json(asgeojson(geombuffered)),
        'properties',
        json(properties)
    ) as geojson
from ways
limit 1000