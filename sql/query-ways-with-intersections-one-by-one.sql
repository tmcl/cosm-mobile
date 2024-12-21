WITH RECURSIVE
    relatedways AS (
        SELECT id                                AS initiator,
               jsonb_object(CAST(id AS text), 1) AS acc,
               ways.*
        FROM ways
        WHERE ways.id = $required_id
        UNION
        SELECT initiator,
               jsonb_patch(acc, jsonb_object(CAST(ways.id AS text), 1)) AS acc,
               ways.*
        FROM ways
                 JOIN relatedways
                 JOIN nodes_ways AS candidate_nodes_ways ON ways.id = candidate_nodes_ways.way_id
                 JOIN nodes_ways AS known_nodes_ways ON relatedways.id = known_nodes_ways.way_id
            AND candidate_nodes_ways.node_id = known_nodes_ways.node_id
        WHERE ways.properties ->> '$.tags.name' = relatedways.properties ->> '$.tags.name'
          AND ways.properties ->> '$.tags.highway' = relatedways.properties ->> '$.tags.highway'
          AND acc -> ('$.' || CAST(ways.id AS text)) IS NULL),
    way_relations AS (SELECT initiator,
                             JSON_GROUP_ARRAY(
                                     cast(id as text)
                             ) sameroad
                      FROM relatedways
                      GROUP BY initiator),
    base_way_set as (SELECT *
                     FROM relatedways
                              JOIN way_relations ON relatedways.id = way_relations.initiator
                     WHERE relatedways.id = relatedways.initiator
                     --group by id
                     limit 1000)

select json_object(
               'type',
               'Feature',
               'id',
               cast(ways.id as text),
               'geometry',
               json(asgeojson(ways.geombuffered)),
               'properties',
               json(ways.properties)
       )                                                   as geojson,
       json_object(
               'type',
               'Feature',
               'id',
               cast(ways.id as text),
               'geometry',
               json(asgeojson(ways.geom)),
               'properties',
               json(ways.properties)
       )                                                   as centreline,
       json_group_array(json_object('ix', n.key, 'others', nodes_ways.way_id, 'node_tags', nodes.properties, 'way_tags',
                                    other_way.properties)) as other_ways,
       st_length(ways.geomgda)                             as length,
       ways.sameroad
from base_way_set as ways
         join json_each(ways.nodes) n
         left join nodes_ways on n.value = nodes_ways.node_id and nodes_ways.way_id <> ways.id
         left join nodes on nodes.id = nodes_ways.node_id
         left join ways as other_way on other_way.id = nodes_ways.way_id
group by ways.id
limit 1000