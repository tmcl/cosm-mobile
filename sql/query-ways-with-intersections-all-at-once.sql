select json_group_array(jsonb(geojson)) as geojson
     , json_group_array(jsonb(centreline)) as centreline
     , json_group_object(id, jsonb(other_ways)) as other_ways
     , json_group_object(id, jsonb(sameroad)) as sameroad
from (
select cast(ways.id as text) as id,
    jsonb_object(
               'type',
               'Feature',
               'id',
               cast(ways.id as text),
               'geometry',
               jsonb(asgeojson(ways.geombuffered)),
               'properties',
               jsonb(ways.properties)
       )                                                   as geojson,
       jsonb_object(
               'type',
               'Feature',
               'id',
               cast(ways.id as text),
               'geometry',
               jsonb(asgeojson(ways.geom)),
               'properties',
               jsonb(ways.properties)
       )                                                   as centreline,
       jsonb_group_array(jsonb_object('ix', n.key, 'others', nodes_ways.way_id, 'node_tags', nodes.properties, 'way_tags',
                                    other_way.properties)) as other_ways,
       st_length(ways.geomgda)                             as length,
       ways_of_same_roads.road as sameroad
from ways
         join json_each(ways.nodes) n
         left join nodes_ways on n.value = nodes_ways.node_id and nodes_ways.way_id <> ways.id
         left join nodes on nodes.id = nodes_ways.node_id
         left join ways as other_way on other_way.id = nodes_ways.way_id
         left join ways_of_same_roads on ways_of_same_roads.way_id = ways.id
    where
    (st_EnvelopesIntersects(ways.geombuffered, $minlon, $minlat, $maxlon, $maxlat)
                and
             ways.rowid in (select rowid
                            from SpatialIndex
                            where f_table_name = 'ways'
                              and f_geometry_column = 'geombuffered'
                              and search_frame = st_envelope(makeline(makepoint($minlon, $minlat, 4326),
                                                                      makepoint($maxlon, $maxlat, 4326)))))
           or ways.id in (select atom from json_each($required_ids) where atom is not null)
group by ways.id
limit 1000) query