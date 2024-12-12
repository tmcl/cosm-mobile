select json_object(
        'type',
        'Feature',
        'id',
        cast (id as text),
        'geometry',
        json(asgeojson(geombuffered)),
        'properties',
        json(properties)
    ) as geojson,
    json_object(
        'type',
        'Feature',
        'id',
        cast (id as text),
        'geometry',
        json(asgeojson(geom)),
        'properties',
        json(properties)
    ) as centreline
from ways
where st_EnvelopesIntersects(geombuffered, $minlon, $minlat, $maxlon, $maxlat)
limit 1000