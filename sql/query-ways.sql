select json_object(
        'type',
        'Feature',
        'id',
        cast (id as text),
        'geometry',
        json(asgeojson(coalesce(geombuffered, geom))),
        'properties',
        json(properties)
    ) as geojson
from ways
where st_EnvelopesIntersects(coalesce(geombuffered, geom), $minlon, $minlat, $maxlon, $maxlat)
limit 1000