WITH RECURSIVE
    relatedways AS (
      --  select * from (
                          SELECT
                              id AS initiator,
                              jsonb_object (CAST(id AS text), 1) AS acc,
                              ways.*
                          FROM
                              ways
                          WHERE
                              -- properties ->> '$.tags.name' = 'Wattle Valley Road'
                             st_EnvelopesIntersects(ways.geombuffered, $minlon, $minlat, $maxlon, $maxlat)
                             and ways.rowid in (
                               select rowid
                               from SpatialIndex
                               where f_table_name = 'ways'
                             and f_geometry_column = 'geombuffered'
                             and search_frame = st_envelope(makeline(makepoint($minlon, $minlat, 4326), makepoint($maxlon, $maxlat, 4326)))
                               )
                             --properties ->> '$.tags.name' = 'Wattle Valley Road' and
                          -- limit 32
                      -- )

        UNION
        SELECT
            initiator,
            jsonb_patch (acc, jsonb_object (CAST(ways.id AS text), 1)) AS acc,
            ways.*
        FROM
            ways
                JOIN relatedways
                JOIN nodes_ways AS candidate_nodes_ways ON ways.id = candidate_nodes_ways.way_id
                JOIN nodes_ways AS known_nodes_ways ON relatedways.id = known_nodes_ways.way_id
                AND candidate_nodes_ways.node_id = known_nodes_ways.node_id
        WHERE
            ways.properties ->> '$.tags.name' = relatedways.properties ->> '$.tags.name'
          AND ways.properties ->> '$.tags.highway' = relatedways.properties ->> '$.tags.highway'
          AND acc -> ('$.' || CAST(ways.id AS text)) IS NULL
    ),
    way_relations AS (
        SELECT
            initiator,
            JSON_GROUP_ARRAY(
                    id
            ) sameroad
        FROM
            relatedways
        GROUP BY
            initiator
    )
SELECT
    row_number() over (order by properties->>'$.tags.name'),
    json_array_length(sameroad),
    JSON(acc),
    properties->>'$.tags.name',
    acc ->> ('$.' || CAST(id AS text)),
    *
FROM
    relatedways
        JOIN way_relations ON relatedways.id = way_relations.initiator
WHERE
    relatedways.id = relatedways.initiator
--group by id
limit 1000;
