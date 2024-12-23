SELECT JSON_OBJECT(
               'type',
               'Feature',
               'id',
               CAST(id AS TEXT),
               'geometry',
               JSON(asgeojson(COALESCE(geombuffered, geom))),
               'properties',
               JSON(properties)
       ) AS geojson,
       JSON_OBJECT(
               'type',
               'Feature',
               'id',
               CAST(id AS TEXT),
               'geometry',
               JSON(asgeojson(geom)),
               'properties',
               JSON(properties)
       ) AS centrelines
FROM ways
WHERE st_EnvelopesIntersects(COALESCE(geombuffered, geom), $minlon, $minlat, $maxlon, $maxlat)
    and ways.rowid in (select rowid
                            from SpatialIndex
                            where f_table_name = 'ways'
                              and f_geometry_column in ('geombuffered', 'geom')
                              and search_frame = st_envelope(makeline(makepoint($minlon, $minlat, 4326),
                                                                      makepoint($maxlon, $maxlat, 4326))))

LIMIT $limit