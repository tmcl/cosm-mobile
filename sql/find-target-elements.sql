WITH matchables AS (SELECT key, value, (SELECT COUNT(*) FROM JSON_EACH(json.value) AS count) AS count
                    FROM JSON_EACH($needles) AS json),
     tagmatchingnodes AS (SELECT nodes.rowid matchingrowid, COUNT(1) AS found, matchables.count AS wanted
                          FROM nodes
                                   JOIN matchables
                                   JOIN JSON_EACH(matchables.value) needle
                                   JOIN JSON_EACH(jsonb_extract(properties, '$.tags')) haystack
                                        ON needle.fullkey = haystack.fullkey AND needle.value = haystack.value
                          GROUP BY matchables.key, nodes.rowid
                          HAVING found = wanted)
SELECT nodes.id,
       nodes.observed,
       nodes.version,
       JSON_OBJECT(
               'type', 'Feature',
               'id', CAST(nodes.id AS TEXT),
               'geometry', JSON(asgeojson(geom)),
               'properties', JSON(jsonb_set(properties, '$.ways', jsonb_group_array(CAST(nodes_ways.way_id AS TEXT))))
       ) AS geojson
FROM nodes
         JOIN tagmatchingnodes ON tagmatchingnodes.matchingrowid = nodes.rowid
         JOIN nodes_ways ON nodes.id = nodes_ways.node_id
WHERE st_EnvelopesIntersects(geom, $minlon, $minlat, $maxlon, $maxlat)
  and nodes.rowid in (select rowid
                     from SpatialIndex
                     where f_table_name = 'nodes'
                       and f_geometry_column = 'geom'
                       and search_frame = st_envelope(makeline(makepoint($minlon, $minlat, 4326),
                                                               makepoint($maxlon, $maxlat, 4326))))
GROUP BY nodes.id
LIMIT 100