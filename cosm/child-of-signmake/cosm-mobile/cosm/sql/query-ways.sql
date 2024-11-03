select json_object(
        'type',
        'Feature',
        'geometry',
        json(asgeojson(geombuffered)),
        'properties',
        json(properties)
    ) as geojson
from ways
where st_EnvelopesIntersects(geombuffered, $minlon, $minlat, $maxlon, $maxlat)
limit 1000